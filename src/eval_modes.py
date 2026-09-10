"""리랭킹 후 top5 를 BM25 단독 vs 문서게이트로 비교 (LLM 호출 없음)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from store import ChunkStore
from bm25 import BM25Index
from search import Searcher
from rerank import Reranker
from embedder import QueryEmbedder
from vectorstore import VectorStore

CASES = [
    ("자재 입하 검수 절차가 어떻게 되나요?", "자재입하"),
    ("표준하도급계약서의 지체상금 기준은?", "표준하도급"),
    ("POS-Appia 물품등록이 반려됐는데 어떻게 하나요?", "물품등록 오류"),
    ("컨사인먼트 자재 신청 절차 알려주세요", "컨사인먼트"),
    ("자재공급사 평가는 어떤 기준으로 하나요?", "자재공급사 평가"),
    ("납품이 늦으면 물어야 하는 돈은 얼마인가요?", "지체상금|하도급|약관"),
    ("무재고품 운영 방식이 궁금해요", "무재고품"),
    ("비접촉식 진동 측정기를 조회하고 싶어요", "질문분류|질의응답|생산관리"),
    ("VMI 자재 증량 요청은 어떻게 하나요?", "SCC 증량|질의응답|무재고품"),
    ("Q3501342 어떤 자재인가요?", "질의응답|질문분류|생산관리"),
]
store, bm25 = ChunkStore(), BM25Index()
vs, emb, rr = VectorStore(), QueryEmbedder(), Reranker()
gate = Searcher(store, bm25, emb, vs)
plain = Searcher(store, bm25)

import re
def hit(cands, pat):
    return any(re.search(pat, c["metadata"]["file_name"]) for c in cands)

score = {"plain": 0, "gate": 0}
for q, pat in CASES:
    qv = emb.encode(q)
    p5 = rr.rerank(q, plain.retrieve(q)[0])
    g5 = rr.rerank(q, gate.retrieve(q, qv)[0])
    hp, hg = hit(p5, pat), hit(g5, pat)
    score["plain"] += hp; score["gate"] += hg
    print("=" * 74)
    print(f"Q: {q}   (정답문서 패턴: {pat})")
    print(f"  BM25단독 {'O' if hp else 'X'} :", [c["source"][:42] for c in p5[:3]])
    print(f"  문서게이트 {'O' if hg else 'X'} :", [c["source"][:42] for c in g5[:3]])
    ndocs_p = len({c["metadata"]["file_name"] for c in p5}); ndocs_g = len({c["metadata"]["file_name"] for c in g5})
    print(f"  top5 문서 다양성: BM25 {ndocs_p}종 / 게이트 {ndocs_g}종")
print(f"\n정답문서 top5 포함: BM25단독 {score['plain']}/{len(CASES)} · 문서게이트 {score['gate']}/{len(CASES)}")
