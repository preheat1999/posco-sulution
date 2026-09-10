import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from store import ChunkStore
from bm25 import BM25Index
from search import Searcher
from rerank import Reranker
import answer as answer_mod

store, bm25 = ChunkStore(), BM25Index()
se = Searcher(store, bm25)
rr = Reranker()
for q in ["자재 입하 검수 절차를 알려주세요",
          "표준하도급계약서의 지체상금 기준을 알려주세요",
          "우주선 부품 재고를 알려주세요"]:
    t0 = time.time()
    cand, dropped = se.retrieve(q)
    top = rr.rerank(q, cand)
    res = answer_mod.generate(q, top)
    print("=" * 70)
    print("Q:", q, f"({time.time()-t0:.1f}초, 후보 {len(cand)} 버림 {dropped})")
    print(res["answer"][:600])
    print("-- citations --")
    for c in res["citations"]:
        print(f"  [{c['index']}] {c['source'][:66]}  score={c['score']}")
        print(f"      snippet: {c['snippet'][:70]}")
    print("no_answer:", res["no_answer"], "| coverage:", round(res["coverage"], 2),
          "| model:", res["model"])
