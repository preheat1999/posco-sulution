"""01_검증_체크리스트.md 2단계 관문 자동 확인. 한글 질의는 파일/파이썬으로 보낸다."""
import json, os, sys, time
import httpx
from dotenv import load_dotenv
load_dotenv()
BASE = "http://127.0.0.1:8000"
H = {"X-API-Token": os.environ.get("RAG_API_TOKEN", "")}
ok = lambda b: "PASS" if b else "FAIL"
results = []

h = httpx.get(f"{BASE}/api/health", timeout=30).json()
print(json.dumps(h, ensure_ascii=False, indent=2))
results += [
    ("1 /api/health status=ok", h.get("status") == "ok"),
    ("2 n_chunks = Qdrant points 6901", h.get("n_chunks") == 6901),
    ("3 vectorstore.reachable + hybrid", h["vectorstore"]["reachable"] and "hybrid" in h["retrieval"]),
    ("4 models_loaded", h.get("models_loaded") is True),
]

print("\n예열 질의...")
t = time.time()
httpx.post(f"{BASE}/api/chat", json={"question": "예열"}, headers=H, timeout=180)
print(f"  예열 {time.time()-t:.1f}초")

def ask(q):
    r = httpx.post(f"{BASE}/api/chat", json={"question": q}, headers=H, timeout=180)
    r.raise_for_status()
    return r.json()

d = ask("자재 입하 검수 절차를 알려주세요")
cits = d["citations"]
print("\n[Q1]", d["answer"][:300])
for c in cits[:3]:
    print(f"   [{c['index']}] {c['source'][:66]}")
print("metrics:", d["metrics"])
import re
nums = {int(n) for n in re.findall(r"\[(\d+)\]", d["answer"])}
results += [
    ("5 인용 2개 이상", len(cits) >= 2),
    ("6 citations 비어있지 않음", len(cits) > 0),
    ("7 snippet 비어있지 않음", all(c["snippet"].strip() for c in cits)),
    ("8 [n] ↔ citations index 1:1", nums == {c["index"] for c in cits}),
    ("9 출처 표기 형식", any(">" in c["source"] for c in cits)),
    ("10 metrics 단계별 존재", all(k in d["metrics"] for k in
                                 ("embed_ms", "retrieve_ms", "rerank_ms", "generate_ms"))),
    ("11 응답시간 5~15초", 3000 <= d["metrics"]["total_ms"] <= 20000),
    ("13 하이드레이션 버림 0에 가까움", d["metrics"].get("dropped_candidates", 0) <= 2),
]

d2 = ask("우주선 부품 재고를 알려주세요")
print("\n[Q2]", d2["answer"][:120])
results.append(("12 무응답 정책", d2["no_answer"] and "찾을 수 없습니다" in d2["answer"]))

r = httpx.post(f"{BASE}/api/chat", json={"question": "테스트"}, timeout=30)
results.append(("보안4 토큰 없이 401", r.status_code == 401))

print("\n" + "=" * 60)
for name, passed in results:
    print(f"  [{ok(passed)}] {name}")
n_fail = sum(1 for _, p in results if not p)
print(f"\n통과 {len(results)-n_fail}/{len(results)}")
