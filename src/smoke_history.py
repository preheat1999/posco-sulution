"""대화 이력 + 후속 질문 재작성 확인 (8-3).

검증 포인트
  1. 지시어가 없는 첫 질문은 재작성하지 않는다 (LLM 호출을 낭비하지 않는다)
  2. 지시어가 섞인 후속 질문은 독립 질문으로 재작성되어 검색된다
  3. 이력 없이 같은 후속 질문만 던지면 답하지 못한다 (= 이력이 실제로 기여했다)
"""
import json
import os
import time

import httpx
from dotenv import load_dotenv

load_dotenv()
BASE = "http://127.0.0.1:8000"
H = {"X-API-Token": os.environ.get("RAG_API_TOKEN", "")}


def ask(q, history=None):
    r = httpx.post(f"{BASE}/api/chat", json={"question": q, "history": history or []},
                   headers=H, timeout=180)
    r.raise_for_status()
    return r.json()


print("예열...")
ask("예열")

print("\n[1턴] 지시어 없는 첫 질문")
d1 = ask("표준하도급계약서의 지체상금 기준을 알려주세요")
print("  재작성:", d1.get("rewritten_question") or "(없음 — 정상)")
print("  trace:", d1["trace"], "· 인용", len(d1["citations"]), "건")
print("  답변:", d1["answer"][:90].replace("\n", " "))
history = [{"question": "표준하도급계약서의 지체상금 기준을 알려주세요", "answer": d1["answer"]}]

print("\n[2턴] 지시어가 섞인 후속 질문 — 이력 있음")
q2 = "그럼 그건 어떤 경우에 면제되나요?"
d2 = ask(q2, history)
print("  질문:", q2)
print("  재작성:", d2.get("rewritten_question") or "(없음)")
print("  trace:", d2["trace"], "· 인용", len(d2["citations"]), "건",
      "· rewrite_ms:", d2["metrics"].get("rewrite_ms"))
print("  답변:", d2["answer"][:200].replace("\n", " "))
for c in d2["citations"][:3]:
    print("   -", c["source"][:66])

print("\n[대조] 같은 후속 질문을 이력 없이")
d3 = ask(q2, [])
print("  재작성:", d3.get("rewritten_question") or "(없음 — 이력이 없으면 재작성하지 않는다)")
print("  no_answer:", d3["no_answer"], "· 인용", len(d3["citations"]), "건")
print("  답변:", d3["answer"][:110].replace("\n", " "))

print("\n" + "=" * 62)
checks = [
    ("첫 질문은 재작성하지 않는다", d1.get("rewritten_question") is None),
    ("후속 질문이 재작성된다", bool(d2.get("rewritten_question"))),
    ("재작성 질문에 지시어가 없다",
     not any(w in (d2.get("rewritten_question") or "그건")
             for w in ("그건", "그거", "그럼"))),
    ("후속 질문이 근거를 찾는다", len(d2["citations"]) > 0 and not d2["no_answer"]),
    ("이력 없으면 재작성하지 않는다", d3.get("rewritten_question") is None),
]
for name, ok in checks:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
print(f"\n통과 {sum(1 for _, o in checks if o)}/{len(checks)}")
