"""프롬프트 조립 → LLM 호출 → [n] 인용 파싱 → citations 생성."""
import os, re, time
import httpx
from config import cfg
import prompts

PII_PATTERNS = [
    (re.compile(r"\b\d{6}-[1-4]\d{6}\b"), "[주민번호]"),
    (re.compile(r"\b01[016-9]-?\d{3,4}-?\d{4}\b"), "[전화번호]"),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"), "[이메일]"),
]
CITE_RE = re.compile(r"\[(\d{1,2})\]")


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


def call_llm(system, user, model=None):
    """OpenRouter. 429/5xx 재시도, 404/410 은 모델 폴백."""
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


def generate(question, chunks, history=None):
    no_answer = cfg.get("workflow.no_answer_message")
    context, n_used = build_context(chunks)
    system = prompts.RAG_SYSTEM.format(no_answer=no_answer)
    user = prompts.RAG_USER.format(context=mask_pii(context),
                                   history=build_history(history),
                                   question=question)
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
