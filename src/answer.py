"""프롬프트 조립 → LLM 호출 → [n] 인용 파싱 → citations 생성."""
import json, os, re, time
import httpx
from config import cfg
import prompts

PII_PATTERNS = [
    (re.compile(r"\b\d{6}-[1-4]\d{6}\b"), "[주민번호]"),
    (re.compile(r"\b01[016-9]-?\d{3,4}-?\d{4}\b"), "[전화번호]"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"), "[이메일]"),
]
CITE_RE = re.compile(r"\[(\d{1,2})\]")

# 후속 질문 재작성은 **이력이 있고 지시어가 감지될 때만** 호출한다(프롬프트 원문 4절).
# 항상 부르면 LLM 호출이 1회 늘어 응답시간만 길어진다.
DEICTIC_RE = re.compile(
    r"(그건|그거|그것|그럼|그러면|거기|여기|이건|이거|이것|저건|저거|"
    r"아까|방금|위에서|앞에서|그때|그 절차|그 서류|그 방법|그 시스템|해당)")


def needs_rewrite(question, history):
    """지시어가 섞였거나 너무 짧아 그것만으로 검색할 수 없는 질문인가."""
    if not history:
        return False
    q = question.strip()
    return bool(DEICTIC_RE.search(q)) or len(q) <= 12


def rewrite_followup(question, history):
    """앞 대화를 몰라도 이해되는 독립 질문으로 바꾼다. 실패하면 원문을 그대로 쓴다."""
    turns = []
    for t in (history or [])[-4:]:
        turns.append(f"사용자: {(t.get('question') or '')[:400]}\n"
                     f"어시스턴트: {(t.get('answer') or '')[:400]}")
    try:
        text, _usage, _m = call_llm(
            "너는 질문을 독립적으로 재작성하는 도구다. 다른 말을 덧붙이지 마라.",
            prompts.FOLLOWUP_REWRITE.format(history="\n".join(turns), question=question))
        out = (text or "").strip().split("\n")[0].strip()
        # 모델이 장황하게 답하면 신뢰하지 않고 원문을 쓴다
        if out and 4 <= len(out) <= 200:
            return out
    except Exception:
        pass
    return question


def mask_pii(text):
    """LLM 호출 직전에만 적용한다 — 검색·랭킹은 원문으로 해야 품질이 유지된다."""
    if not cfg.get("security.mask_pii"):
        return text
    for pat, rep in PII_PATTERNS:
        text = pat.sub(rep, text)
    return text


def build_context(chunks):
    """번호 블록. 본문은 text 가 아니라 raw_text 를 쓴다."""
    limit, used, blocks = cfg.get("llm.max_context_chars"), 0, []
    for i, c in enumerate(chunks, start=1):
        date = c["metadata"].get("date")
        head = f"[{i}] 출처: {c['source']}" + (f" (작성일 {date})" if date else "")
        block = head + "\n" + c["raw_text"]
        if blocks and used + len(block) > limit:
            break
        blocks.append(block)
        used += len(block)
    return "\n\n".join(blocks), len(blocks)


def build_history(history):
    if not history:
        return ""
    turns = []
    for t in history[-4:]:
        q, a = (t.get("question") or "")[:400], (t.get("answer") or "")[:400]
        turns.append(f"사용자: {q}\n어시스턴트: {a}")
    return prompts.HISTORY_BLOCK.format(turns="\n".join(turns))


def _pgpt_headers():
    """apiKey/empNo/compNo JSON 을 Base64 로 감싼 Bearer 토큰 (P-GPT 인증 규격)."""
    import base64
    auth = {
        "apiKey": os.environ["PGPT_API_KEY"],
        "empNo": os.environ["PGPT_EMP_NO"],
        "compNo": os.environ.get("PGPT_COMP_NO", "30"),
    }
    token = base64.b64encode(json.dumps(auth).encode()).decode()
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _call_pgpt(system, user, model=None):
    """P-GPT 일반 API. 429/5xx 재시도만 한다(모델 폴백 없음).

    ★ 백엔드(DigitalOcean)는 pgpt.posco.com 에 네트워크로 닿지 않는다(DNS 실패, 실측 확인).
      그래서 이 함수는 운영 경로에서는 호출되지 않고, provider 를 로컬에서 "p-gpt" 로
      바꿔 사내망 PC에서 직접 테스트할 때만 쓴다. 실제 브라우저 직접 호출 경로는
      /api/rag/prepare + dev/assets/chat.js 의 streamPGPT() 다."""
    m = model or cfg.get("llm.pgpt_model")
    last = None
    for attempt in range(cfg.get("llm.max_retries")):
        try:
            r = httpx.post(cfg.get("llm.pgpt_endpoint"),
                           headers=_pgpt_headers(),
                           json={"model": m,
                                 "messages": [{"role": "system", "content": system},
                                              {"role": "user", "content": user}],
                                 "need_origin": bool(cfg.get("llm.need_origin", True))},
                           timeout=cfg.get("llm.timeout_seconds"))
            if r.status_code in (429,) or r.status_code >= 500:
                time.sleep(2 ** attempt)
                last = f"{r.status_code} {m}"
                continue
            r.raise_for_status()
            d = r.json()
            return (d["choices"][0]["message"]["content"] or "",
                    d.get("usage", {}), m)
        except httpx.HTTPError as e:
            last = str(e)
            time.sleep(2 ** attempt)
    raise RuntimeError(f"P-GPT 호출 실패: {last}")


def _call_openrouter(system, user, model=None):
    """OpenRouter 백업 경로. 429/5xx 재시도, 404/410 은 모델 폴백."""
    models = [model or cfg.get("llm.model")] + list(cfg.get("llm.fallback_models") or [])
    key = os.environ["OPENROUTER_API_KEY"]
    last = None
    for m in models:
        for attempt in range(cfg.get("llm.max_retries")):
            try:
                r = httpx.post("https://openrouter.ai/api/v1/chat/completions",
                               headers={"Authorization": f"Bearer {key}",
                                        "Content-Type": "application/json"},
                               json={"model": m,
                                     "messages": [{"role": "system", "content": system},
                                                  {"role": "user", "content": user}],
                                     "temperature": cfg.get("llm.temperature"),
                                     "max_tokens": cfg.get("llm.max_tokens")},
                               timeout=cfg.get("llm.timeout_seconds"))
                if r.status_code in (404, 410):
                    last = f"{r.status_code} {m}"
                    break                      # 모델이 내려감 → 다음 모델
                if r.status_code in (429,) or r.status_code >= 500:
                    time.sleep(2 ** attempt)
                    last = f"{r.status_code} {m}"
                    continue
                r.raise_for_status()
                d = r.json()
                return (d["choices"][0]["message"]["content"] or "",
                        d.get("usage", {}), m)
            except httpx.HTTPError as e:
                last = str(e)
                time.sleep(2 ** attempt)
    raise RuntimeError(f"LLM 호출 실패: {last}")


def call_llm(system, user, model=None):
    """provider 설정에 따라 P-GPT 또는 OpenRouter 로 라우팅한다."""
    if cfg.get("llm.provider") == "p-gpt":
        return _call_pgpt(system, user, model)
    return _call_openrouter(system, user, model)


def _pgpt_stream(system, user, model=None):
    """P-GPT SSE 스트리밍. `data:` 뒤 공백 유무를 모두 처리하고 최상위 `response` 를 delta 로 쓴다.

    OpenAI 호환 choices[].delta.content 도 보조 fallback 으로 처리한다(문서 형식이 바뀔 경우 대비)."""
    m = model or cfg.get("llm.pgpt_model")
    text, usage = "", {}
    with httpx.stream("POST", cfg.get("llm.pgpt_stream_endpoint"),
                      headers=_pgpt_headers(),
                      json={"model": m,
                            "messages": [{"role": "system", "content": system},
                                         {"role": "user", "content": user}]},
                      timeout=cfg.get("llm.timeout_seconds")) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line or not line.startswith("data:"):
                continue
            payload = line[len("data:"):].strip()
            if payload == "[DONE]":
                break
            try:
                d = json.loads(payload)
            except ValueError:
                continue
            if d.get("usage"):
                usage = d["usage"]
            piece = d.get("response")
            if piece is None:
                for ch in d.get("choices") or []:
                    piece = (ch.get("delta") or {}).get("content")
                    if piece:
                        break
            if piece:
                text += piece
                yield ("delta", piece)
    yield ("done", (text, usage, m))


def call_llm_stream(system, user, model=None):
    """provider 설정에 따라 P-GPT 또는 OpenRouter 스트림으로 라우팅한다.

    ("delta", 조각) 을 **도착하는 즉시** 흘리고 마지막에 ("done", (본문, usage, 모델)).
    ★ 조각을 모아뒀다가 한꺼번에 내보내면 진행표시로서 의미가 없다(실측으로 확인).

    폴백이 있는 이유: 스트리밍은 제공사·프록시 사정으로 끊길 수 있는데,
    시연 중 답변이 통째로 사라지는 것보다 조금 늦게 한 번에 나오는 편이 낫다.
    ★ P-GPT 스트림이 실패했을 때는 call_llm() 이 같은 provider(P-GPT)로 재시도한다 —
      OpenRouter 자동 전환은 과금을 유발할 수 있어 사용자 승인 없이 하지 않는다."""
    stream_fn = _pgpt_stream if cfg.get("llm.provider") == "p-gpt" else _openrouter_stream
    text, usage, m = "", {}, model or cfg.get("llm.model")
    try:
        for kind, payload in stream_fn(system, user, model):
            if kind == "delta":
                yield ("delta", payload)
            else:
                text, usage, m = payload
        if text.strip():
            yield ("done", (text, usage, m))
            return
    except Exception:
        pass
    # 폴백 (재시도 포함, 동일 provider). 조각으로 나눠 흘릴 수 없으므로 완성본을 한 번에 준다.
    text, usage, m = call_llm(system, user, model)
    if text:
        yield ("delta", text)
    yield ("done", (text, usage, m))


def _openrouter_stream(system, user, model=None):
    m = model or cfg.get("llm.model")
    key = os.environ["OPENROUTER_API_KEY"]
    with httpx.stream("POST", "https://openrouter.ai/api/v1/chat/completions",
                      headers={"Authorization": f"Bearer {key}",
                               "Content-Type": "application/json"},
                      json={"model": m,
                            "messages": [{"role": "system", "content": system},
                                         {"role": "user", "content": user}],
                            "temperature": cfg.get("llm.temperature"),
                            "max_tokens": cfg.get("llm.max_tokens"),
                            "stream": True,
                            "stream_options": {"include_usage": True}},
                      timeout=cfg.get("llm.timeout_seconds")) as r:
        r.raise_for_status()
        text, usage = "", {}
        for line in r.iter_lines():
            if not line or line.startswith(":"):
                continue
            if not line.startswith("data: "):
                continue
            payload = line[6:].strip()
            if payload == "[DONE]":
                break
            try:
                d = json.loads(payload)
            except ValueError:
                continue
            if d.get("usage"):
                usage = d["usage"]
            for ch in d.get("choices") or []:
                piece = (ch.get("delta") or {}).get("content") or ""
                if piece:
                    text += piece
                    yield ("delta", piece)
        yield ("done", (text, usage, m))


def parse_citations(answer, chunks):
    """답변의 [n] 중 실제 존재하는 번호만 citations 로 만든다."""
    used, out = [], []
    for m in CITE_RE.finditer(answer):
        n = int(m.group(1))
        if 1 <= n <= len(chunks) and n not in used:
            used.append(n)
    for n in sorted(used):
        c = chunks[n - 1]
        out.append({"index": n, "chunk_id": c["chunk_id"],
                    "file_name": c["metadata"]["file_name"],
                    "source": c["source"], "date": c["metadata"].get("date"),
                    "snippet": c["raw_text"][:200],
                    "score": round(c.get("score", c.get("fuse_score", 0.0)), 4)})
    return out


def sentence_citation_coverage(answer):
    sents = [s for s in re.split(r"(?<=[.!?。])\s+|\n", answer) if len(s.strip()) > 10]
    if not sents:
        return 1.0
    return sum(1 for s in sents if CITE_RE.search(s)) / len(sents)


def build_rag_prompt(question, chunks, history=None):
    """RAG 시스템/유저 프롬프트 조립. /api/rag/prepare(브라우저 P-GPT 직접호출)와
    generate()/generate_iter() 가 공유한다 — 프롬프트가 두 곳에서 갈리면 안 된다."""
    no_answer = cfg.get("workflow.no_answer_message")
    context, n_used = build_context(chunks)
    system = prompts.RAG_SYSTEM.format(no_answer=no_answer)
    user = prompts.RAG_USER.format(context=mask_pii(context),
                                   history=build_history(history),
                                   question=question)
    return system, user, context, n_used


def generate_iter(question, chunks, history=None):
    """generate() 의 스트리밍판. ("delta", 조각) 을 흘리다가 ("result", dict) 로 끝난다."""
    no_answer = cfg.get("workflow.no_answer_message")
    system, user, context, n_used = build_rag_prompt(question, chunks, history)
    answer, usage, model = "", {}, cfg.get("llm.model")
    for kind, payload in call_llm_stream(system, user):
        if kind == "delta":
            yield ("delta", payload)          # 도착 즉시 통과시킨다
        else:
            answer, usage, model = payload

    answer = answer.strip()
    coverage = sentence_citation_coverage(answer)
    no_ans = no_answer[:20] in answer
    if not no_ans and coverage < cfg.get("llm.min_citation_coverage"):
        yield ("stage", "인용 보강")
        boosted, usage2, _ = call_llm(system,
                                      prompts.CITATION_BOOST.format(context=mask_pii(context),
                                                                    answer=answer))
        if boosted.strip():
            answer = boosted.strip()
            coverage = sentence_citation_coverage(answer)
            for k in ("prompt_tokens", "completion_tokens"):
                usage[k] = usage.get(k, 0) + usage2.get(k, 0)
            yield ("replace", answer)

    yield ("result", {"answer": answer, "no_answer": no_ans,
                      "citations": parse_citations(answer, chunks[:n_used]),
                      "coverage": coverage, "usage": usage, "model": model})


def generate(question, chunks, history=None):
    no_answer = cfg.get("workflow.no_answer_message")
    system, user, context, n_used = build_rag_prompt(question, chunks, history)
    answer, usage, model = call_llm(system, user)
    answer = answer.strip()

    coverage = sentence_citation_coverage(answer)
    no_ans = no_answer[:20] in answer
    if not no_ans and coverage < cfg.get("llm.min_citation_coverage"):
        boosted, usage2, _ = call_llm(system,
                                      prompts.CITATION_BOOST.format(context=mask_pii(context),
                                                                    answer=answer))
        if boosted.strip():
            answer = boosted.strip()
            coverage = sentence_citation_coverage(answer)
            for k in ("prompt_tokens", "completion_tokens"):
                usage[k] = usage.get(k, 0) + usage2.get(k, 0)

    return {"answer": answer, "no_answer": no_ans,
            "citations": parse_citations(answer, chunks[:n_used]),
            "coverage": coverage, "usage": usage, "model": model}


def _params_label(args):
    return ", ".join(f"{k}={v}" for k, v in (args or {}).items()) or "인자 없음"


def generate_sql(question, result):
    """정형 경로 답변. 표는 LLM 이 그대로 옮기고, 숫자를 다시 만들지 않는다."""
    notice = cfg.get("structured.sample_notice")
    if not result.get("ok"):
        return {"answer": result["message"] + "\n\n" + notice, "no_answer": True,
                "citations": [], "coverage": 1.0, "usage": {},
                "model": cfg.get("llm.model")}
    table = result["table"] or "(조회 결과 없음)"
    if result.get("truncated"):
        table += f"\n\n(상한 {cfg.get('structured.query.max_rows')}행에 걸려 이하 생략)"
    answer, usage, model = call_llm(
        prompts.SQL_SYSTEM,
        prompts.SQL_USER.format(template=result["template"],
                                params=_params_label(result["args"]),
                                table=table, citation=result["citation"],
                                question=question))
    answer = (answer or "").strip()
    if result["citation"] not in answer:      # 출처 줄이 빠지면 우리가 붙인다
        answer += "\n\n" + result["citation"]
    return {"answer": answer + "\n\n" + notice,
            "no_answer": not result["rows"], "citations": [], "coverage": 1.0,
            "usage": usage, "model": model}


def generate_hybrid(question, result, chunks, history=None):
    """정형 수치 + 문서 근거를 한 답변에서 합친다. 자재-문서 조인에 의존하지 않는다."""
    no_answer = cfg.get("workflow.no_answer_message")
    notice = cfg.get("structured.sample_notice")
    context, n_used = build_context(chunks)
    table = (result.get("table") or "") if result.get("ok") else ""
    citation = result.get("citation", "") if result.get("ok") else ""
    if not table:
        table = result.get("message") or "(조회 결과 없음)"
    answer, usage, model = call_llm(
        prompts.HYBRID_SYSTEM.format(no_answer=no_answer),
        prompts.HYBRID_USER.format(template=result.get("template", "-"),
                                   params=_params_label(result.get("args")),
                                   table=table, citation=citation,
                                   context=mask_pii(context), question=question))
    answer = (answer or "").strip()
    if citation and citation not in answer:
        answer += "\n\n" + citation
    return {"answer": answer + "\n\n" + notice,
            "no_answer": no_answer[:20] in answer,
            "citations": parse_citations(answer, chunks[:n_used]),
            "coverage": sentence_citation_coverage(answer),
            "usage": usage, "model": model}
