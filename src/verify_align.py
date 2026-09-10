"""색인 벡터 vs 로컬 청크 임베딩 코사인 비교 — chunk_id 정렬(내용 일치) 검증."""
import json, os, random
import numpy as np
from dotenv import load_dotenv; load_dotenv()
os.environ["HF_HUB_CACHE"] = os.path.abspath("./models"); os.environ["HF_HUB_OFFLINE"] = "1"
from qdrant_client import QdrantClient, models
from sentence_transformers import SentenceTransformer

local = {}
for line in open("data/chunks/chunks.jsonl", encoding="utf-8"):
    c = json.loads(line); local[c["chunk_id"]] = c

c = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=60)
random.seed(7)
by_doc = {}
for cid, ch in local.items():
    by_doc.setdefault(ch["doc_id"], []).append(cid)
# 청크가 많은 문서 8건을 골라 doc_id(인덱스 있음)로 필터링해 벡터를 받는다
docs = sorted(by_doc, key=lambda d: -len(by_doc[d]))[:8]
sample = set()
for d in docs:
    sample |= set(random.sample(by_doc[d], min(6, len(by_doc[d]))))

got = []
for d in docs:
    off = None
    while True:
        b, off = c.scroll("material_rag", limit=1000, offset=off, with_payload=True,
                          with_vectors=True,
                          scroll_filter=models.Filter(must=[models.FieldCondition(
                              key="doc_id", match=models.MatchValue(value=d))]))
        got.extend(x for x in b if x.payload["chunk_id"] in sample)
        if off is None: break
print(f"표본 {len(sample)} → 색인에서 회수 {len(got)}")

m = SentenceTransformer("BAAI/bge-m3")
rows = []
for p in got:
    cid = p.payload["chunk_id"]
    ch = local[cid]
    v_idx = np.array(p.vector["dense"], dtype=np.float32)
    emb = m.encode([ch["text"], ch["raw_text"]], normalize_embeddings=True, show_progress_bar=False)
    rows.append((cid, float(emb[0] @ v_idx), float(emb[1] @ v_idx), ch["metadata"]["file_name"]))

t = np.array([r[1] for r in rows]); r_ = np.array([r[2] for r in rows])
print(f"\ntext(헤더포함)  코사인 평균 {t.mean():.3f}  중앙 {np.median(t):.3f}  ≥0.95 {(t>=.95).mean():.0%}")
print(f"raw_text        코사인 평균 {r_.mean():.3f}  중앙 {np.median(r_):.3f}  ≥0.95 {(r_>=.95).mean():.0%}")
best = "text" if t.mean() >= r_.mean() else "raw_text"
s = t if best == "text" else r_
print(f"\n색인이 임베딩한 필드로 추정: {best}")
print("정렬 불량(<0.8) 문서별:")
bad = {}
for (cid, a, b, fn), sc in zip(rows, s):
    if sc < 0.8: bad[fn] = bad.get(fn, 0) + 1
for fn, n in sorted(bad.items(), key=lambda x: -x[1])[:10]:
    print(f"  {n}건  {fn[:58]}")
print(f"\n정렬 양호(≥0.8) 비율: {(s>=.8).mean():.1%}")
