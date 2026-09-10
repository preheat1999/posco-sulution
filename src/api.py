"""FastAPI 앱 — /api/health, /api/chat. 필드명을 바꾸지 마라(프론트엔드 계약)."""
import logging, os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import cfg
from store import ChunkStore
from bm25 import BM25Index
from search import Searcher
import answer as answer_mod

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


@app.get("/api/health")
def health():
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
        "auth_required": bool(os.environ.get("RAG_API_TOKEN")),
    }


@app.post("/api/chat")
def chat(req: ChatRequest, x_api_token: str | None = Header(default=None)):
    token = os.environ.get("RAG_API_TOKEN")
    if token and x_api_token != token:
        raise HTTPException(status_code=401, detail="invalid token")
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    t0 = time.time()
    trace, metrics = [], {}
    q = req.question.strip()

    qv = None
    if STATE["searcher"].mode == "hybrid" and STATE["embedder"]:
        t = time.time(); qv = STATE["embedder"].encode(q)
        metrics["embed_ms"] = int((time.time() - t) * 1000); trace.append("embed")

    t = time.time()
    candidates, dropped = STATE["searcher"].retrieve(q, qv)
    metrics["retrieve_ms"] = int((time.time() - t) * 1000)
    metrics["dropped_candidates"] = dropped
    trace.append("retrieve")

    if not candidates:
        return {"question": q, "answer": cfg.get("workflow.no_answer_message"),
                "no_answer": True, "citations": [],
                "metrics": {**metrics, "total_ms": int((time.time() - t0) * 1000)},
                "route": "rag", "trace": trace}

    t = time.time()
    top = (STATE["reranker"].rerank(q, candidates) if STATE["reranker"]
           else candidates[:cfg.get("retrieval.top_k")])
    metrics["rerank_ms"] = int((time.time() - t) * 1000); trace.append("rerank")

    t = time.time()
    res = answer_mod.generate(q, top, req.history)
    metrics["generate_ms"] = int((time.time() - t) * 1000); trace.append("generate")

    usage = res["usage"] or {}
    metrics.update({"total_ms": int((time.time() - t0) * 1000),
                    "citation_coverage": round(res["coverage"], 3),
                    "input_tokens": usage.get("prompt_tokens"),
                    "output_tokens": usage.get("completion_tokens")})
    if not cfg.get("security.log_raw_query"):
        log.info("chat 완료 %sms 인용 %d건", metrics["total_ms"], len(res["citations"]))
    return {"question": q, "answer": res["answer"], "no_answer": res["no_answer"],
            "citations": res["citations"], "metrics": metrics,
            "route": "rag", "trace": trace}
