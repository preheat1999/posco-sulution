"""Cross-Encoder 리랭킹. max_length 512 는 구조적 상한 — 넘기면 텐서 오류."""
import os
from config import cfg, ROOT

os.environ.setdefault("HF_HUB_CACHE", str(ROOT / cfg.get("paths.models_cache_dir")))


class Reranker:
    def __init__(self):
        from sentence_transformers import CrossEncoder
        self.model = CrossEncoder(cfg.get("reranker.model_name"),
                                  max_length=cfg.get("reranker.max_length"))

    def rerank(self, query, candidates, top_k=None):
        if not candidates:
            return []
        top_k = top_k or cfg.get("reranker.rerank_top_k")
        pairs = [(query, c["raw_text"]) for c in candidates]
        scores = self.model.predict(pairs, batch_size=cfg.get("reranker.batch_size"),
                                    show_progress_bar=False)
        for c, s in zip(candidates, scores):
            c["score"] = float(s)
        return sorted(candidates, key=lambda c: -c["score"])[:top_k]
