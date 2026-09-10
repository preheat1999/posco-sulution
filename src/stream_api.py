"""NDJSON 스트리밍 엔드포인트 (마스터 프롬프트 8-2).

한 줄 = 이벤트 1건.
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

        # (1) 질의 분석 — 질의 임베딩
        t = time.time()
        qv = None
        if searcher.mode == "hybrid" and state["embedder"]:
            qv = state["embedder"].encode(q)
        metrics["embed_ms"] = int((time.time() - t) * 1000)
        trace.append("embed")
        yield _line({"type": "stage", "name": STAGES[0], "index": 0,
                     "ms": metrics["embed_ms"]})

        # (2) 사내 문서 검색 — dense 문서게이트 + 로컬 BM25 → RRF → 하이드레이션
        t = time.time()
        candidates, dropped = searcher.retrieve(q, qv)
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
                         "route": "rag", "trace": trace})
            return

        # (3) 근거 정밀 선별 — Cross-Encoder 리랭킹
        t = time.time()
        top = (state["reranker"].rerank(q, candidates) if state["reranker"]
               else candidates[:cfg.get("retrieval.top_k")])
        metrics["rerank_ms"] = int((time.time() - t) * 1000)
        trace.append("rerank")
        yield _line({"type": "stage", "name": STAGES[2], "index": 2,
                     "ms": metrics["rerank_ms"], "sources": len(top)})

        # (4) 답변 작성 — LLM 토큰을 흘린다
        t = time.time()
        res = None
        for kind, payload in answer_mod.generate_iter(q, top, history):
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
        yield _line({"type": "result", "question": q, "answer": res["answer"],
                     "no_answer": res["no_answer"], "citations": res["citations"],
                     "metrics": metrics, "route": "rag", "trace": trace})
    except Exception as e:  # 스트림 도중 예외는 이벤트로 알린다(연결만 끊기면 원인을 모른다)
        log.exception("chat/stream 실패")
        yield _line({"type": "error", "message": f"{type(e).__name__}: {e}"})
