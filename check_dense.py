import os
os.environ["HF_HUB_CACHE"] = os.path.abspath("./models"); os.environ["HF_HUB_OFFLINE"] = "1"
from dotenv import load_dotenv; load_dotenv()
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient

m = SentenceTransformer("BAAI/bge-m3")
c = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=60)
for q in ["자재 입하 검수 절차", "표준하도급계약서 지체상금"]:
    v = m.encode([q], normalize_embeddings=True)[0].tolist()
    hits = c.query_points(collection_name="material_rag", query=v, using="dense", limit=5, with_payload=True).points
    print(f"\n[{q}]")
    for h in hits:
        p = h.payload
        print(f"  {h.score:.3f} {p.get('doc_category'):9s} {p.get('file_name') or p.get('doc_id')}")
    print("  payload keys:", sorted(hits[0].payload.keys()))
