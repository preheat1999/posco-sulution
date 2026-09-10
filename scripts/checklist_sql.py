"""01_검증_체크리스트.md 4절 — 정형 경로(A안) 확인."""
import csv
import json
import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()
BASE = "http://127.0.0.1:8000"
H = {"X-API-Token": os.environ.get("RAG_API_TOKEN", "")}
MASTER = Path(__file__).resolve().parent.parent.parent / \
    "Chatbot_Start_Package" / "01_데이터" / "정형데이터" / "master.csv"


def ask(q):
    r = httpx.post(f"{BASE}/api/chat", json={"question": q, "history": []},
                   headers=H, timeout=180)
    r.raise_for_status()
    return r.json()


results = []
print("예열...")
ask("예열")

# 1. 자재코드 질문 → sql 경로
# ★ 체크리스트 4절 예시는 Q3501342 지만 이 코드는 샘플 master.csv(743건)에 없다.
#   문서(FAQ)에는 등장하나 정형 샘플에는 없어서 0행이 정상이다.
#   따라서 표·수치 검증은 실재하는 코드로 하고, 없는 코드는 아래에서 따로 확인한다.
ITEM = "Q1000108"
d = ask(f"{ITEM} 현재 재고 알려줘")
print("\n[1] route =", d["route"], "| 판정:", d.get("route_reason"),
      "|", d["metrics"]["total_ms"], "ms")
print(d["answer"][:420])
results.append(("1 route=sql", d["route"] == "sql"))
results.append(("1 응답 2~6초", d["metrics"]["total_ms"] <= 6000))
results.append(("1 표 포함", "|" in d["answer"]))

# 2. 원천·기준일 표기
results.append(("2 원천·기준일 표기",
                bool(re.search(r"\[DB: \w+ / 원천 \w+\.csv, 기준일 \d{4}-\d{2}-\d{2}\]",
                               d["answer"]))))

# 3. 표의 숫자가 CSV 값과 같은가 (LLM 이 재계산하지 않았는지)
row = None
with open(MASTER, encoding="utf-8-sig", newline="") as f:
    for rec in csv.DictReader(f):
        if rec["Item"] == ITEM:
            row = rec
            break
if row:
    print("\n[3] master.csv 원본:", {k: row[k] for k in
                                    ("Item", "Type", "StockDept", "StockAll", "UnitCost")})
    same = (row["StockDept"].split(".")[0] in d["answer"].replace(",", "")
            and row["Type"] in d["answer"])
    results.append(("3 표 숫자가 CSV 와 일치", same))
else:
    results.append(("3 표 숫자가 CSV 와 일치", False))

# 1-b. 샘플에 없는 자재코드 → 0행이지만 그 사실을 알려야 한다
dmiss = ask("Q3501342 현재 재고 알려줘")
print("\n[1-b] 없는 코드 route =", dmiss["route"], "| rows =",
      dmiss["metrics"].get("sql_rows"))
print("     ", dmiss["answer"][:100].replace("\n", " "))
results.append(("1-b 없는 코드는 결과 없음을 알림",
                dmiss["metrics"].get("sql_rows") == 0
                and ("없" in dmiss["answer"] or "확인" in dmiss["answer"])))

# 4. 적정재고 → A안에서는 답할 수 없다고 밝힌다
d4 = ask("적정재고가 부족한 자재 알려줘")
print("\n[4] route =", d4["route"], "|", d4["answer"][:150])
results.append(("4 적정재고는 답할 수 없음을 밝힘", "적정재고 산출 결과가 없어" in d4["answer"]))

# 7. 시연 데이터임을 밝히는가
results.append(("7 연습용 샘플임을 밝힘", "연습용 샘플" in d["answer"]))

# 라우팅 정확도 표본
CASES = [
    ("Q1000108 지금 몇 개 있어?", "sql"),
    ("속성별 재고 금액 알려줘", "sql"),
    ("전체 재고 얼마야?", "sql"),
    ("자재 입하 검수 절차를 알려주세요", "rag"),
    ("표준하도급계약서의 지체상금 기준은?", "rag"),
    ("Q1000108 재고 알려주고 발주 신청 절차도 알려줘", "hybrid"),
]
print("\n[라우팅 표본]")
hit = 0
for q, expect in CASES:
    r = ask(q)
    ok = r["route"] == expect
    hit += ok
    src = (r.get("route_reason") or {}).get("source", "-")
    print(f"  {'O' if ok else 'X'} {r['route']:6s} (기대 {expect:6s}, {src:7s})"
          f" {r['metrics']['total_ms']:5d}ms  {q[:34]}")
results.append((f"라우팅 표본 {hit}/{len(CASES)}", hit >= len(CASES) - 1))

print("\n" + "=" * 60)
for name, ok in results:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
n_fail = sum(1 for _, o in results if not o)
print(f"\n통과 {len(results)-n_fail}/{len(results)}")
