"""9절 — Qdrant point 표본과 로컬 chunk_id 대조."""
import json, os, sys, collections
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()
from qdrant_client import QdrantClient

local = {}
docs = collections.Counter()
for line in open("data/chunks/chunks.jsonl", encoding="utf-8"):
    c = json.loads(line)
    local[c["chunk_id"]] = c
    docs[c["doc_id"]] += 1
print(f"로컬 청크 {len(local)} / 문서 {len(docs)}")

c = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=60)
info = c.get_collection("material_rag")
print(f"Qdrant points={info.points_count} status={info.status}")

pts, off = [], None
while True:
    batch, off = c.scroll("material_rag", limit=1000, offset=off,
                          with_payload=True, with_vectors=False)
    pts.extend(batch)
    if off is None:
        break
print(f"Qdrant payload 전량 수집: {len(pts)}")

skipped = hit = miss = 0
miss_docs, hit_docs = collections.Counter(), collections.Counter()
for p in pts:
    pl = p.payload
    if pl.get("doc_category") == "faq" and pl.get("file_type") in ("xlsx", "xlsb"):
        skipped += 1
        continue
    if pl["chunk_id"] in local:
        hit += 1; hit_docs[pl["doc_id"]] += 1
    else:
        miss += 1; miss_docs[pl["doc_id"]] += 1
total = hit + miss
rate = hit / total if total else 0
print(f"\n표본 300 → FAQ엑셀 제외 {skipped} / 대조대상 {total}")
print(f"일치 {hit} · 불일치 {miss} → 일치율 {rate:.1%}")
print("\n문서별 불일치 상위:")
for d, n in miss_docs.most_common(10):
    ex = next((x["metadata"]["file_name"] for x in local.values() if x["doc_id"] == d), "(로컬에 없는 문서)")
    print(f"  {d} miss={n:3d} hit={hit_docs[d]:3d}  {ex[:52]}")
verdict = "hybrid (정상)" if rate >= .95 else ("hybrid 유지 (부분)" if rate >= .70 else "BM25 단독으로 전환")
print(f"\n판정: {verdict}")
