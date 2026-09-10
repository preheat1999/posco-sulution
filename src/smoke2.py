import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from store import ChunkStore
from bm25 import BM25Index
from search import Searcher
from rerank import Reranker
from embedder import QueryEmbedder
from vectorstore import VectorStore
import answer as answer_mod

store, bm25 = ChunkStore(), BM25Index()
vs, emb, rr = VectorStore(), QueryEmbedder(), Reranker()
se = Searcher(store, bm25, emb, vs)
print(f"mode={se.mode} qdrant={vs.reachable}/{vs.points}\n")
for q in ["납품이 늦으면 물어야 하는 돈은 얼마인가요?",
          "POS-Appia 물품등록이 반려됐는데 어떻게 하나요?",
          "우주선 부품 재고를 알려주세요"]:
    t0 = time.time(); qv = emb.encode(q); t_emb = time.time() - t0
    docs = se.dense_doc_ranks(qv)
    t = time.time(); cand, dropped = se.retrieve(q, qv); t_ret = time.time() - t
    t = time.time(); top = rr.rerank(q, cand); t_rr = time.time() - t
    t = time.time(); res = answer_mod.generate(q, top); t_gen = time.time() - t
    print("=" * 76)
    print("Q:", q)
    print(f"  게이트 문서 {len(docs)}건 · 후보 {len(cand)} · 버림 {dropped}")
    print(f"  embed {t_emb*1000:.0f}ms · retrieve {t_ret*1000:.0f}ms · rerank {t_rr*1000:.0f}ms · generate {t_gen*1000:.0f}ms · total {(time.time()-t0)*1000:.0f}ms")
    print(res["answer"][:420])
    for c in res["citations"]:
        print(f"   [{c['index']}] {c['source'][:64]} | snippet: {c['snippet'][:46]}")
    print("  no_answer:", res["no_answer"], "coverage:", round(res["coverage"], 2))
