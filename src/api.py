"""FastAPI 앱 — /api/health, /api/chat. 필드명을 바꾸지 마라(프론트엔드 계약)."""
import logging, os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import cfg
from store import ChunkStore
from bm25 import BM25Index
from search import Searcher
import answer as answer_mod
import stream_api
import router
import intent
import structured
import visuals

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("api")
app = FastAPI(title="포스코 자재관리 RAG 챗봇")
app.add_middleware(CORSMiddleware, allow_origins=cfg.get("api.allowed_origins"),
                   allow_methods=["*"], allow_headers=["*"])

STATE = {"store": None, "bm25": None, "searcher": None,
         "embedder": None, "reranker": None, "vs": None, "models_loaded": False}


class ChatRequest(BaseModel):
    question: str
    category: str | None = None
    history: list | None = None


@app.on_event("startup")
def startup():
    t0 = time.time()
    STATE["store"] = ChunkStore()
    STATE["bm25"] = BM25Index()
    log.info("청크 %d · BM25 어휘 %d 적재", len(STATE["store"]), len(STATE["bm25"].vocab))

    if cfg.get("retrieval.mode") == "hybrid":
        try:
            from vectorstore import VectorStore
            STATE["vs"] = VectorStore()
            log.info("Qdrant reachable=%s points=%s", STATE["vs"].reachable, STATE["vs"].points)
        except Exception as e:
            log.warning("Qdrant 연결 실패 — BM25 단독으로 계속한다: %s", e)

    if cfg.get("api.preload_models"):
        from embedder import QueryEmbedder
        from rerank import Reranker
        if cfg.get("retrieval.mode") == "hybrid":
            STATE["embedder"] = QueryEmbedder()
        STATE["reranker"] = Reranker()
        STATE["models_loaded"] = True
        log.info("모델 로드 완료 (%.1f초)", time.time() - t0)

    STATE["searcher"] = Searcher(STATE["store"], STATE["bm25"],
                                 STATE["embedder"], STATE["vs"])


WEB = Path(__file__).resolve().parent.parent / "web" / "index.html"


@app.get("/", response_class=HTMLResponse)
def ui():
    """최소 채팅 UI — 외부 의존성 없는 단일 HTML (화면은 토큰 없이 연다)."""
    if not WEB.exists():
        return HTMLResponse("<h1>web/index.html 이 없습니다</h1>", status_code=404)
    return FileResponse(WEB)


WEBDIR = Path(__file__).resolve().parent.parent / "web"
DATADIR = Path(__file__).resolve().parent.parent / "data"


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard():
    """데이터 분석 대시보드 — 외부 CDN 없이 인라인 SVG 로 그린다."""
    f = WEBDIR / "dashboard.html"
    if not f.exists():
        return HTMLResponse("<h1>web/dashboard.html 이 없습니다</h1>", status_code=404)
    return FileResponse(f)


@app.get("/web/{name}")
def web_asset(name: str):
    """대시보드가 쓰는 정적 파일. 경로 이탈을 막기 위해 파일명만 받는다."""
    f = (WEBDIR / name).resolve()
    if f.parent != WEBDIR.resolve() or not f.exists():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(f)


@app.get("/api/viz")
def viz():
    """집계 수치만 담긴 JSON (문서 원문·개인정보 없음). 없으면 만들라고 알린다."""
    f = DATADIR / "viz.json"
    if not f.exists():
        raise HTTPException(status_code=404,
                            detail="data/viz.json 없음 — python scripts/build_viz.py 실행")
    return FileResponse(f, media_type="application/json")


@app.get("/api/eval")
def eval_result():
    f = DATADIR / "eval_result.json"
    if not f.exists():
        raise HTTPException(status_code=404,
                            detail="data/eval_result.json 없음 — python scripts/run_eval.py 실행")
    return FileResponse(f, media_type="application/json")


@app.get("/api/health")
def health(request: Request):
    vs = STATE["vs"]
    reachable = bool(vs and vs.reachable)
    mode = STATE["searcher"].mode if STATE["searcher"] else "bm25"
    return {
        "status": "ok" if STATE["store"] else "loading",
        "models_loaded": STATE["models_loaded"],
        "n_chunks": (vs.points if reachable else len(STATE["store"])),
        "local_chunks": len(STATE["store"]) if STATE["store"] else 0,
        "retrieval": "hybrid(qdrant_dense+local_bm25)" if mode == "hybrid" else "bm25",
        "vectorstore": {"collection": cfg.get("vectorstore.collection_name"),
                        "points": vs.points if vs else 0, "reachable": reachable},
        "llm": {"provider": cfg.get("llm.provider"), "model": cfg.get("llm.model")},
        # 이 호출자에게 토큰이 필요한지 알려준다(로컬 시연은 불필요) → UI 가 입력칸을 숨긴다
        "auth_required": not _auth_ok(request, None),
        "auth_required_remote": bool(os.environ.get("RAG_API_TOKEN")),
    }


LOCALHOST = {"127.0.0.1", "::1", "localhost"}


def _is_local(request):
    """요청의 실제 소스 IP 로만 판단한다.

    X-Forwarded-For 같은 헤더는 클라이언트가 마음대로 넣을 수 있으므로 믿지 않는다."""
    client = getattr(request, "client", None)
    return bool(client) and client.host in LOCALHOST


def _auth_ok(request, x_api_token):
    token = os.environ.get("RAG_API_TOKEN")
    if not token:
        return True                                   # 토큰 미설정 = 인증 없음
    if x_api_token == token:
        return True
    # 시연 편의: 서버가 도는 노트북 자신에서 온 요청은 토큰을 요구하지 않는다.
    # 외부(같은 네트워크의 다른 PC)는 그대로 401 이다.
    return bool(cfg.get("security.allow_localhost_without_token")) and _is_local(request)


def _guard(request, req, x_api_token):
    if not _auth_ok(request, x_api_token):
        raise HTTPException(status_code=401, detail="invalid token")
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")
    return req.question.strip()


@app.post("/api/chat/stream")
def chat_stream(request: Request, req: ChatRequest,
                x_api_token: str | None = Header(default=None)):
    """진행 단계 + 답변 토큰을 NDJSON 으로 흘린다 (8-2). 이벤트 계약은 stream_api.py."""
    q = _guard(request, req, x_api_token)
    return StreamingResponse(
        stream_api.event_stream(STATE, q, req.history, log),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/chat")
def chat(request: Request, req: ChatRequest,
         x_api_token: str | None = Header(default=None)):
    q = _guard(request, req, x_api_token)
    t0 = time.time()
    trace, metrics = [], {}

    # 후속 질문 재작성 — 이력이 있고 지시어가 감지될 때만 (8-3)
    search_q = q
    if answer_mod.needs_rewrite(q, req.history):
        t = time.time()
        search_q = answer_mod.rewrite_followup(q, req.history)
        metrics["rewrite_ms"] = int((time.time() - t) * 1000)
        if search_q != q:
            trace.append("rewrite")

    # 경로 판정 (8-5) — 규칙으로 확정되면 LLM 을 부르지 않는다
    t = time.time()
    decision = router.route(search_q)
    metrics["route_ms"] = int((time.time() - t) * 1000)
    trace.append("route")
    route_name = decision["route"]

    # 자동 시각화 판정 — 사용자가 요청하지 않아도 흐름형·집계형 질문에는 붙인다.
    # 규칙(정규식) 판정만 하므로 LLM 호출이 늘지 않는다.
    visual = visuals.detect(search_q)

    sql_result = None
    if route_name in ("sql", "hybrid"):
        t = time.time()
        it = intent.resolve(search_q)
        if it is None:
            # 조회 대상을 정하지 못했다 → 문서 경로로 넘긴다.
            # 억지로 표를 만들어 보여주는 것이 답하지 않는 것보다 나쁘다.
            route_name = "rag"
            decision = {**decision, "reason": decision["reason"] + " → 조회 대상 불명, 문서 경로로 전환"}
            trace.append("sql_skipped")
        else:
            sql_result = structured.run(it["template"], it["args"])
            metrics["sql_ms"] = int((time.time() - t) * 1000)
            metrics["sql_template"] = it["template"]
            metrics["sql_rows"] = len(sql_result.get("rows") or [])
            trace.append("sql")
        if route_name == "sql":
            res = answer_mod.generate_sql(search_q, sql_result)
            metrics["total_ms"] = int((time.time() - t0) * 1000)
            metrics["citation_coverage"] = 1.0
            usage = res["usage"] or {}
            metrics["input_tokens"] = usage.get("prompt_tokens")
            metrics["output_tokens"] = usage.get("completion_tokens")
            return {"question": q,
                    "rewritten_question": (search_q if search_q != q else None),
                    "answer": res["answer"], "no_answer": res["no_answer"],
                    "citations": [], "metrics": metrics, "route": "sql",
                    "route_reason": decision, "trace": trace, "visual": visual}

    qv = None
    if STATE["searcher"].mode == "hybrid" and STATE["embedder"]:
        t = time.time(); qv = STATE["embedder"].encode(search_q)
        metrics["embed_ms"] = int((time.time() - t) * 1000); trace.append("embed")

    t = time.time()
    candidates, dropped = STATE["searcher"].retrieve(search_q, qv)
    metrics["retrieve_ms"] = int((time.time() - t) * 1000)
    metrics["dropped_candidates"] = dropped
    trace.append("retrieve")

    if not candidates:
        return {"question": q, "answer": cfg.get("workflow.no_answer_message"),
                "no_answer": True, "citations": [],
                "metrics": {**metrics, "total_ms": int((time.time() - t0) * 1000)},
                "route": "rag", "trace": trace, "visual": None}

    t = time.time()
    top = (STATE["reranker"].rerank(search_q, candidates) if STATE["reranker"]
           else candidates[:cfg.get("retrieval.top_k")])
    metrics["rerank_ms"] = int((time.time() - t) * 1000); trace.append("rerank")

    t = time.time()
    if route_name == "hybrid" and sql_result is not None:
        res = answer_mod.generate_hybrid(search_q, sql_result, top, req.history)
    else:
        res = answer_mod.generate(search_q, top, req.history)
    metrics["generate_ms"] = int((time.time() - t) * 1000); trace.append("generate")

    usage = res["usage"] or {}
    metrics.update({"total_ms": int((time.time() - t0) * 1000),
                    "citation_coverage": round(res["coverage"], 3),
                    "input_tokens": usage.get("prompt_tokens"),
                    "output_tokens": usage.get("completion_tokens")})
    if not cfg.get("security.log_raw_query"):
        log.info("chat 완료 %sms 경로 %s 인용 %d건",
                 metrics["total_ms"], route_name, len(res["citations"]))
    # 근거를 못 찾아 거절한 답변에는 붙이지 않는다 — 없는 내용을 그림으로 꾸며 보여주면 안 된다.
    out_visual = visual if not res["no_answer"] else None
    return {"question": q,
            "rewritten_question": (search_q if search_q != q else None),
            "answer": res["answer"], "no_answer": res["no_answer"],
            "citations": res["citations"], "metrics": metrics,
            "route": route_name, "route_reason": decision, "trace": trace,
            "visual": out_visual}
