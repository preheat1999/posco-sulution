"""Qdrant dense 검색 래퍼 — 읽기 전용. 업서트·삭제·컬렉션 생성 코드를 두지 않는다."""
import os
from config import cfg


class VectorStore:
    def __init__(self):
        from qdrant_client import QdrantClient
        self.collection = cfg.get("vectorstore.collection_name")
        self.vector_name = cfg.get("vectorstore.dense_vector_name")
        self.client = QdrantClient(url=os.environ["QDRANT_URL"],
                                   api_key=os.environ["QDRANT_API_KEY"],
                                   timeout=cfg.get("vectorstore.timeout_seconds"))
        self.reachable, self.points = False, 0
        try:
            info = self.client.get_collection(self.collection)
            self.reachable, self.points = str(info.status) == "green", info.points_count
        except Exception:
            pass

    def search(self, vector, limit=20):
        if not self.reachable:
            return []
        try:
            hits = self.client.query_points(collection_name=self.collection, query=vector,
                                            using=self.vector_name, limit=limit,
                                            with_payload=True).points
            return [(h.payload["chunk_id"], float(h.score)) for h in hits]
        except Exception:
            self.reachable = False
            return []
