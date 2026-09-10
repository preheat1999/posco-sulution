"""BGE-M3 질의 인코더 — 질의 전용. 코퍼스는 인코딩하지 않는다."""
import os
from config import cfg, ROOT

os.environ.setdefault("HF_HUB_CACHE", str(ROOT / cfg.get("paths.models_cache_dir")))


class QueryEmbedder:
    def __init__(self):
        from sentence_transformers import SentenceTransformer
        self.model = SentenceTransformer(cfg.get("embedding.model_name"))
        self.model.max_seq_length = cfg.get("embedding.max_seq_length")
        self.prefix = cfg.get("embedding.query_prefix") or ""

    def encode(self, query):
        v = self.model.encode([self.prefix + query],
                              normalize_embeddings=cfg.get("embedding.normalize"),
                              show_progress_bar=False)[0]
        return v.tolist()
