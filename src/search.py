"""dense + BM25 → RRF 융합 → 카테고리 가중 → 하이드레이션."""
import logging
from config import cfg

log = logging.getLogger(__name__)


def rrf_fuse(rankings, k=10):
    """점수 스케일이 다르므로 순위만 쓴다 (원점수를 더하지 마라)."""
    fused = {}
    for ranking in rankings:
        for rank, (chunk_id, _score) in enumerate(ranking):
            fused[chunk_id] = fused.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(fused.items(), key=lambda x: -x[1])


class Searcher:
    def __init__(self, store, bm25, embedder=None, vectorstore=None):
        self.store, self.bm25 = store, bm25
        self.embedder, self.vs = embedder, vectorstore

    @property
    def mode(self):
        if cfg.get("retrieval.mode") == "hybrid" and self.vs is not None and self.vs.reachable:
            return "hybrid"
        return "bm25"

    def retrieve(self, query, query_vector=None):
        rankings = []
        if self.mode == "hybrid" and query_vector is not None:
            dense = self.vs.search(query_vector, limit=cfg.get("retrieval.dense_limit"))
            if dense:
                rankings.append(dense)
        rankings.append(self.bm25.search(query, limit=cfg.get("retrieval.bm25_limit")))
        fused = rrf_fuse(rankings, k=cfg.get("retrieval.rrf_k"))

        # 카테고리 가중
        if cfg.get("retrieval.category_weights.enabled"):
            weights = cfg.get("retrieval.category_weights.weights") or {}
            default = cfg.get("retrieval.category_weights.default_weight")
            scored = []
            for cid, s in fused:
                c = self.store.get(cid)
                cat = c["metadata"]["doc_category"] if c else None
                scored.append((cid, s * weights.get(cat, default)))
            fused = sorted(scored, key=lambda x: -x[1])

        candidates = fused[:cfg.get("retrieval.candidate_k")]

        # 하이드레이션 — 로컬에 없는 chunk_id 는 조용히 버린다
        hydrated, dropped = [], 0
        for cid, s in candidates:
            c = self.store.get(cid)
            if c is None or not c.get("raw_text"):
                dropped += 1
                continue
            hydrated.append({"chunk_id": cid, "fuse_score": s,
                             "raw_text": c["raw_text"], "text": c["text"],
                             "metadata": c["metadata"],
                             "source": self.store.source_label(cid)})
        if dropped:
            log.warning("하이드레이션 실패로 버린 후보 %d건", dropped)
        return hydrated, dropped
