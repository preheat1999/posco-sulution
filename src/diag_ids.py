import json, os, collections
from dotenv import load_dotenv; load_dotenv()
from qdrant_client import QdrantClient

local_docs, local_ids = {}, []
for line in open("data/chunks/chunks.jsonl", encoding="utf-8"):
    c = json.loads(line)
    local_docs.setdefault(c["doc_id"], c["metadata"]["file_name"])
    local_ids.append(c["chunk_id"])

c = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=60)
pts, off = [], None
while True:
    b, off = c.scroll("material_rag", limit=1000, offset=off, with_payload=True, with_vectors=False)
    pts.extend(b)
    if off is None: break

qd = collections.Counter(p.payload["doc_id"] for p in pts)
qcat = {p.payload["doc_id"]: (p.payload.get("doc_category"), p.payload.get("file_type")) for p in pts}
print(f"Qdrant 고유 doc_id {len(qd)} / 로컬 고유 doc_id {len(local_docs)}")
print("교집합:", set(qd) & set(local_docs))
print("\nQdrant doc_id (청크수 순):")
for d, n in qd.most_common():
    print(f"  {d} n={n:5d} {qcat[d]}")
print("\n로컬 doc_id:")
for d, fn in local_docs.items():
    print(f"  {d}  {fn[:55]}")
print("\nQdrant chunk_id 샘플:", [p.payload["chunk_id"] for p in pts[:3]])
print("로컬  chunk_id 샘플:", local_ids[:3])
