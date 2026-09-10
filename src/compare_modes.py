"""BM25 단독 vs 문서수준 dense 게이트 비교."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from store import ChunkStore
from bm25 import BM25Index
from search import Searcher
from embedder import QueryEmbedder
from vectorstore import VectorStore

QUERIES = [
    "자재 입하 검수 절차를 알려주세요",
    "표준하도급계약서의 지체상금 기준은?",
    "POS-Appia 물품등록이 반려됐는데 어떻게 하나요?",
    "컨사인먼트 자재 신청 절차 알려주세요",
    "자재공급사 평가는 어떤 기준으로 하나요?",
    "납품이 늦으면 물어야 하는 돈",          # 동의어/구어체 — dense 가 유리해야 함
    "무재고품 운영 방식이 궁금해요",
]
store, bm25 = ChunkStore(), BM25Index()
vs, emb = VectorStore(), QueryEmbedder()
print(f"Qdrant reachable={vs.reachable} points={vs.points}\n")
se = Searcher(store, bm25, emb, vs)

for q in QUERIES:
    qv = emb.encode(q)
    docs = se.dense_doc_ranks(qv)
    plain, _ = Searcher(store, bm25).retrieve(q)
    gated, _ = se.retrieve(q, qv)
    print("=" * 78)
    print("Q:", q)
    print("  dense 가 지목한 문서:")
    for d, r in sorted(docs.items(), key=lambda x: x[1]):
        fn = next((c["metadata"]["file_name"] for c in store.by_id.values()
                   if c["doc_id"] == d), "(로컬에 없는 문서=FAQ엑셀)")
        print(f"    {r+1}. {fn[:60]}")
    print("  BM25 단독 top3      :", [c["source"][:46] for c in plain[:3]])
    print("  문서게이트 top3     :", [c["source"][:46] for c in gated[:3]])
