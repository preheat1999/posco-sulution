"""NDJSON 스트리밍 엔드포인트 (마스터 프롬프트 8-2).

한 줄 = 이벤트 1건.
  {"type":"rewrite","question":...}                후속 질문을 독립 질문으로 재작성함
  {"type":"stage","name":...,"index":n,"ms":...}   단계 완료
  {"type":"delta","text":...}                      답변 조각
  {"type":"replace","answer":...}                  인용 보강으로 답변 교체
  {"type":"result", ...}                           최종 결과 (인용·metrics)
  {"type":"error","message":...}
"""
import json
import time

from config import cfg
import answer as answer_mod
import router
import intent
import structured
import visuals

STAGES = ["질의 분석", "사내 문서 검색", "근거 정밀 선별", "답변 작성"]
NL = "\n"


def _line(obj):
    return json.dumps(obj, ensure_ascii=False) + NL


def event_stream(state, question, history, log):
    """질의 1건을 처리하며 이벤트를 순서대로 흘린다."""
    t0 = time.time()
    trace, metrics = [], {}
    q = question
    try:
        searcher = state["searcher"]

        # (1) 질의 분석 — 후속 질문 재작성(필요할 때만) + 질의 임베딩
        t = time.time()
        search_q = q
        if answer_mod.needs_rewrite(q, history):
            search_q = answer_mod.rewrite_followup(q, history)
            metrics["rewrite_ms"] = int((time.time() - t) * 1000)
            if search_q != q:
                trace.append("rewrite")
                yield _line({"type": "rewrite", "question": search_q})
        # 자동 시각화 판정 — 사용자가 요청하지 않아도 흐름형·집계형 질문에는 붙인다.
        # search_q 만으로 판정하는 규칙(정규식)이지만, 결국 근거를 못 찾아 무응답으로
        # 끝날 수도 있으므로 여기서는 계산만 해 두고 이벤트는 최종 result 에서만 보낸다
        # (미리 보여줬다가 무응답으로 뒤집히면 화면이 어색해진다).
        visual = visuals.detect(search_q)

        # 경로 판정 (8-5) — 규칙으로 확정되면 LLM 을 부르지 않는다
        decision = router.route(search_q)
        route_name = decision["route"]
        trace.append("route")
        if route_name != "rag":
            yield _line({"type": "route", "route": route_name,
                         "source": decision["source"], "reason": decision["reason"]})

        t_emb = time.time()
        qv = None
        if route_name != "sql" and searcher.mode == "hybrid" and state["embedder"]:
            qv = state["embedder"].encode(search_q)
        metrics["embed_ms"] = int((time.time() - t_emb) * 1000)
        trace.append("embed")
        yield _line({"type": "stage", "name": STAGES[0], "index": 0,
                     "ms": int((time.time() - t) * 1000)})

        # 정형 조회 — 검색·리랭킹을 건너뛰므로 RAG 보다 빠르다
        sql_result = None
        if route_name in ("sql", "hybrid"):
            t = time.time()
            it = intent.resolve(search_q)
            if it is None:
                # 조회 대상을 정하지 못했다 → 문서 경로로 넘긴다.
                # 억지로 표를 만들어 보여주는 것이 답하지 않는 것보다 나쁘다.
                route_name = "rag"
                decision = {**decision,
                            "reason": decision["reason"] + " → 조회 대상 불명, 문서 경로로 전환"}
                trace.append("sql_skipped")
                yield _line({"type": "route", "route": "rag", "source": decision["source"],
                             "reason": decision["reason"]})
                if qv is None and searcher.mode == "hybrid" and state["embedder"]:
                    qv = state["embedder"].encode(search_q)   # sql 로 보고 건너뛴 임베딩
            else:
                sql_result = structured.run(it["template"], it["args"])
                metrics["sql_ms"] = int((time.time() - t) * 1000)
                metrics["sql_template"] = it["template"]
                metrics["sql_rows"] = len(sql_result.get("rows") or [])
                trace.append("sql")
                yield _line({"type": "stage", "name": "사내 데이터 조회", "index": 1,
                             "ms": metrics["sql_ms"], "rows": metrics["sql_rows"]})
            if route_name == "sql":
                res = answer_mod.generate_sql(search_q, sql_result)
                yield _line({"type": "delta", "text": res["answer"]})
                metrics["total_ms"] = int((time.time() - t0) * 1000)
                metrics["citation_coverage"] = 1.0
                yield _line({"type": "stage", "name": STAGES[3], "index": 3,
                             "ms": metrics.get("sql_ms", 0)})
                yield _line({"type": "result", "question": q,
                             "rewritten_question": (search_q if search_q != q else None),
                             "answer": res["answer"], "no_answer": res["no_answer"],
                             "citations": [], "metrics": metrics, "route": "sql",
                             "route_reason": decision, "trace": trace, "visual": visual})
                return

        # (2) 사내 문서 검색 — dense 문서게이트 + 로컬 BM25 → RRF → 하이드레이션
        t = time.time()
        candidates, dropped = searcher.retrieve(search_q, qv)
        metrics["retrieve_ms"] = int((time.time() - t) * 1000)
        metrics["dropped_candidates"] = dropped
        trace.append("retrieve")
        yield _line({"type": "stage", "name": STAGES[1], "index": 1,
                     "ms": metrics["retrieve_ms"], "candidates": len(candidates)})

        if not candidates:
            metrics["total_ms"] = int((time.time() - t0) * 1000)
            yield _line({"type": "result", "question": q,
                         "answer": cfg.get("workflow.no_answer_message"),
                         "no_answer": True, "citations": [], "metrics": metrics,
                         "route": route_name, "route_reason": decision,
                         "trace": trace, "visual": None})
            return

        # (3) 근거 정밀 선별 — Cross-Encoder 리랭킹
        t = time.time()
        top = (state["reranker"].rerank(search_q, candidates) if state["reranker"]
               else candidates[:cfg.get("retrieval.top_k")])
        metrics["rerank_ms"] = int((time.time() - t) * 1000)
        trace.append("rerank")
        yield _line({"type": "stage", "name": STAGES[2], "index": 2,
                     "ms": metrics["rerank_ms"], "sources": len(top)})

        # (4) 답변 작성 — LLM 토큰을 흘린다
        t = time.time()
        res = None
        if route_name == "hybrid" and sql_result is not None:
            hres = answer_mod.generate_hybrid(search_q, sql_result, top, history)
            yield _line({"type": "delta", "text": hres["answer"]})
            gen = [("result", hres)]
        else:
            gen = answer_mod.generate_iter(search_q, top, history)
        for kind, payload in gen:
            if kind == "delta":
                yield _line({"type": "delta", "text": payload})
            elif kind == "stage":
                yield _line({"type": "stage", "name": payload, "index": 4})
            elif kind == "replace":
                yield _line({"type": "replace", "answer": payload})
            else:
                res = payload
        metrics["generate_ms"] = int((time.time() - t) * 1000)
        trace.append("generate")
        yield _line({"type": "stage", "name": STAGES[3], "index": 3,
                     "ms": metrics["generate_ms"]})

        usage = res["usage"] or {}
        metrics.update({"total_ms": int((time.time() - t0) * 1000),
                        "citation_coverage": round(res["coverage"], 3),
                        "input_tokens": usage.get("prompt_tokens"),
                        "output_tokens": usage.get("completion_tokens")})
        if not cfg.get("security.log_raw_query"):
            log.info("chat/stream 완료 %sms 인용 %d건",
                     metrics["total_ms"], len(res["citations"]))
        # 근거를 못 찾아 거절한 답변에는 붙이지 않는다 — 없는 내용을 그림으로 꾸며 보여주면 안 된다.
        out_visual = visual if not res["no_answer"] else None
        yield _line({"type": "result", "question": q, "rewritten_question":
                     (search_q if search_q != q else None), "answer": res["answer"],
                     "no_answer": res["no_answer"], "citations": res["citations"],
                     "metrics": metrics, "route": route_name,
                     "route_reason": decision, "trace": trace, "visual": out_visual})
    except Exception as e:  # 스트림 도중 예외는 이벤트로 알린다(연결만 끊기면 원인을 모른다)
        log.exception("chat/stream 실패")
        yield _line({"type": "error", "message": f"{type(e).__name__}: {e}"})
