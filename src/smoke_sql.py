"""정형 조회 안전장치 확인 (D절 5겹) — 여기가 통과해야 나머지를 붙인다."""
import sys, sqlite3
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import structured as S

checks = []

r = S.run("item_detail", {"item": "Q1000108"})
print("item_detail:", r["rows"][:1])
checks.append(("정상 조회", r["ok"] and len(r["rows"]) == 1))

# 안전장치: 인젝션 — 문자열로 바인딩되었다면 0행이어야 한다
inj = S.run("item_detail", {"item": "Q1000108' OR '1'='1"})
print("인젝션 결과 행수:", len(inj["rows"]))
checks.append(("인젝션 0행", len(inj["rows"]) == 0))

# 안전장치 1: 읽기전용 커넥션 — OS 수준에서 쓰기 차단
try:
    with S.connect() as c:
        c.execute("DELETE FROM master")
    checks.append(("쓰기 차단", False))
except sqlite3.OperationalError as e:
    print("쓰기 시도 →", type(e).__name__, e)
    checks.append(("쓰기 차단", True))

# 안전장치 2·4: 금지 키워드 / 뷰 화이트리스트
for bad, name in [("DELETE FROM v_item_status", "금지 키워드"),
                  ("SELECT * FROM master", "raw 테이블 차단"),
                  ("SELECT 1 FROM v_item_status; DROP TABLE master", "복수 문장 차단")]:
    try:
        S._check_sql(bad); ok = False
    except ValueError as e:
        ok = True; print(f"{name} → 거부: {e}")
    checks.append((name, ok))

# A안 미구현 템플릿
u = S.run("order_urgent", {})
print("order_urgent:", u["message"][:40])
checks.append(("적정재고 템플릿은 답할 수 없음을 밝힘", not u["ok"] and "적정재고" in u["message"]))

# 집계 기준 화이트리스트
try:
    S.run("summary_by", {"dimension": "item; DROP TABLE master"}); ok = False
except ValueError:
    ok = True
checks.append(("집계 기준 화이트리스트", ok))

print()
for n, ok in checks:
    print(f"  [{'PASS' if ok else 'FAIL'}] {n}")
print(f"\n통과 {sum(1 for _, o in checks if o)}/{len(checks)}")
