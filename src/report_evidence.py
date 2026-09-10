"""PDF 보고서용 근거 수집 — BM25 단독 vs 문서게이트 하이브리드, 리랭킹 전/후 비교.

API 서버(LLM 호출 큐)에 부하를 주지 않도록 검색 파이프라인만 직접 호출한다.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from store import ChunkStore
from bm25 import BM25Index
from search import Searcher
from embedder import QueryEmbedder
from vectorstore import VectorStore
from rerank import Reranker

OUT = Path(__file__).resolve().parent.parent / "data" / "report_evidence.json"

QUERIES = [
    ("자재 입하 검수 절차가 어떻게 되나요?", r"자재입하"),
    ("납품이 늦으면 물어야 하는 돈은 얼마인가요?", r"지체상금|하도급|약관"),
    ("POS-Appia 물품등록이 반려됐는데 어떻게 하나요?", r"물품등록 오류|POS-Appia"),
]

print("모델 로드 중...")
t0 = time.time()
store, bm25 = ChunkStore(), BM25Index()
vs, emb, rr = VectorStore(), QueryEmbedder(), Reranker()
gate = Searcher(store, bm25, emb, vs)
plain = Searcher(store, bm25)
print(f"로드 완료 {time.time()-t0:.1f}s · Qdrant reachable={vs.reachable}")

result = {
    "corpus": {"n_chunks": len(store), "vocab": len(bm25.vocab), "avgdl": round(bm25.avgdl, 1)},
    "qdrant": {"reachable": vs.reachable, "points": vs.points},
    "cases": [],
}

for q, pat in QUERIES:
    import re
    t = time.time()
    bm25_cands, _ = plain.retrieve(q)
    bm25_ms = (time.time() - t) * 1000

    t = time.time()
    qv = emb.encode(q)
    gate_cands, _ = gate.retrieve(q, qv)
    gate_ms = (time.time() - t) * 1000

    t = time.time()
    bm25_top5 = rr.rerank(q, bm25_cands)
    plain_rerank_ms = (time.time() - t) * 1000
    t = time.time()
    gate_top5 = rr.rerank(q, gate_cands)
    gate_rerank_ms = (time.time() - t) * 1000

    def hit(cands):
        return any(re.search(pat, c["metadata"]["file_name"]) for c in cands)

    def brief(cands):
        return [{"file": c["metadata"]["file_name"], "loc": c["source"], "score": round(c["score"], 3)}
                for c in cands[:3]]

    case = {
        "question": q, "expect_pattern": pat,
        "bm25_only": {"hit_top5": hit(bm25_top5), "top3": brief(bm25_top5),
                      "retrieve_ms": round(bm25_ms), "rerank_ms": round(plain_rerank_ms)},
        "doc_gate_hybrid": {"hit_top5": hit(gate_top5), "top3": brief(gate_top5),
                            "retrieve_ms": round(gate_ms), "rerank_ms": round(gate_rerank_ms)},
        "pre_rerank_top3_bm25": [c["metadata"]["file_name"] for c in bm25_cands[:3]],
        "post_rerank_top3_bm25": [c["metadata"]["file_name"] for c in bm25_top5[:3]],
    }
    result["cases"].append(case)
    print(f"\nQ: {q}")
    print(f"  BM25단독      hit={case['bm25_only']['hit_top5']} top1={case['bm25_only']['top3'][0]['file'][:40]}")
    print(f"  문서게이트     hit={case['doc_gate_hybrid']['hit_top5']} top1={case['doc_gate_hybrid']['top3'][0]['file'][:40]}")

OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n저장: {OUT}")
