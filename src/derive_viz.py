"""파생 지표 타당성 검증 — 새로 설계한 분석이 실제로 신호를 내는지 확인한다.

원천 CSV 를 그대로 그리는 것이 아니라, 조인·파생으로 의미를 만들어낸다.
기준일은 config 의 structured.asof (2026-09-03).
"""
import sqlite3
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

DB = Path(__file__).resolve().parent.parent / "data" / "structured" / "materials.db"
ASOF = date(2026, 9, 3)


def q(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


conn = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
line = lambda: print("\n" + "=" * 78)

# ---------------------------------------------------------------- 1
line()
print("[1] 재고 회전 사분면 — 보유량 vs 실제 불출 (적정재고 산출 없이 과잉·결품 진단)")
rows = q(conn, """
    SELECT m.Item AS item, m.Type AS type, m.CriticalSparePart AS csp,
           m.StockDept AS stock, m.UnitCost AS cost, m.LeadTimeMean AS lt,
           COALESCE(d.out_total, 0) AS out_total,
           COALESCE(d.months, 0)    AS months
    FROM master m
    LEFT JOIN (SELECT item, SUM(qty_out) AS out_total, COUNT(*) AS months
               FROM v_demand_monthly GROUP BY item) d ON d.item = m.Item
""")
for r in rows:
    r["mps"] = (r["stock"] / (r["out_total"] / 60.0)) if r["out_total"] else None  # 최근 5년 기준
buckets = Counter()
for r in rows:
    has_stock = (r["stock"] or 0) > 0
    has_demand = (r["out_total"] or 0) > 0
    buckets[("재고O" if has_stock else "재고X") + " / " + ("불출O" if has_demand else "불출X")] += 1
total_val = sum((r["stock"] or 0) * (r["cost"] or 0) for r in rows)
dead_val = sum((r["stock"] or 0) * (r["cost"] or 0)
               for r in rows if (r["stock"] or 0) > 0 and not (r["out_total"] or 0))
short = [r for r in rows if not (r["stock"] or 0) and (r["out_total"] or 0) > 0]
for k, v in buckets.most_common():
    print(f"   {k:20s} {v:4d}종  {v/len(rows):5.1%}")
print(f"   → 불출 이력 없는 재고 금액: {dead_val/1e8:,.1f}억 / 전체 {total_val/1e8:,.1f}억"
      f" ({dead_val/total_val:.1%})")
print(f"   → 재고 0 인데 불출 이력 있는 자재: {len(short)}종"
      f" (핵심예비품 {sum(1 for r in short if r['csp']=='O')}종)")

# ---------------------------------------------------------------- 2
line()
print("[2] 조달 리스크 지수 — 리드타임·공급사수·금액·핵심도를 한 점수로")
risk = []
lts = [r["lt"] for r in rows if r["lt"]]
lt_max = max(lts)
for r in q(conn, """SELECT Item AS item, LeadTimeMean AS lt, SupplierCount AS sup,
                           StockDept*UnitCost AS val, CriticalSparePart AS csp,
                           ProcurementType AS proc FROM master"""):
    lt = (r["lt"] or 0) / lt_max
    sup = 1.0 if (r["sup"] or 1) <= 1 else (0.5 if r["sup"] == 2 else 0.2)
    val = min((r["val"] or 0) / 1e8, 1.0)
    csp = 1.0 if r["csp"] == "O" else 0.0
    imp = 0.3 if r["proc"] == "수입" else 0.0
    r["score"] = round(100 * (0.35 * lt + 0.25 * sup + 0.2 * val + 0.15 * csp + 0.05 * imp), 1)
    risk.append(r)
risk.sort(key=lambda x: -x["score"])
print(f"   점수 분포: 최대 {risk[0]['score']} · 중앙 {risk[len(risk)//2]['score']}"
      f" · 최소 {risk[-1]['score']}")
print("   상위 5:")
for r in risk[:5]:
    print(f"     {r['item']} {r['score']:5.1f}점  LT={r['lt']}일 공급사={r['sup']}"
          f" 핵심={r['csp']} {r['proc']}")
print(f"   70점 이상 {sum(1 for r in risk if r['score']>=70)}종 ·"
      f" 50점 이상 {sum(1 for r in risk if r['score']>=50)}종")

# ---------------------------------------------------------------- 3
line()
print("[3] 발주 데드라인 — 정지 예정일까지 남은 일수 < 리드타임 이면 이미 늦었다")
fut = q(conn, """
    SELECT mt.Equipment AS eq, mt.MaintKind AS kind, mt.StopStart AS start,
           m.Item AS item, m.LeadTimeMean AS lt, m.StockDept AS stock,
           m.CriticalSparePart AS csp
    FROM maintenance mt
    JOIN master m ON m.LinkedEquipment = mt.Equipment
    WHERE mt.StopStart > ? ORDER BY mt.StopStart
""", (ASOF.isoformat(),))
print(f"   기준일 이후 정지 일정 × 연결자재 조합: {len(fut)}건")
late = miss = 0
for r in fut:
    y, m_, d_ = (int(x) for x in r["start"].split("-"))
    days = (date(y, m_, d_) - ASOF).days
    r["days_left"] = days
    if r["lt"] and days < r["lt"]:
        late += 1
        if not (r["stock"] or 0):
            miss += 1
print(f"   → 남은 일수 < 리드타임 (지금 발주해도 못 맞춤): {late}건")
print(f"   → 그중 재고까지 0 인 건: {miss}건  ★ 즉시 조치 대상")
if fut:
    soon = fut[:5]
    for r in soon:
        print(f"     {r['start']} {r['eq'][:26]:28s} {r['kind']:6s} {r['item']}"
              f" 재고={r['stock']:.0f} LT={r['lt']}일 남은={r['days_left']}일")

# ---------------------------------------------------------------- 4
line()
print("[4] 수요 패턴 4분류 (Syntetos-Boylan) — 어떤 자재를 예측할 수 있는가")
dem = defaultdict(list)
for r in q(conn, "SELECT item, month, qty_out FROM v_demand_monthly ORDER BY item, month"):
    dem[r["item"]].append(r["qty_out"] or 0)
cls = Counter()
for item, series in dem.items():
    nz = [v for v in series if v > 0]
    if len(nz) < 2:
        cls["단발(판정불가)"] += 1
        continue
    adi = len(series) / len(nz)                       # 평균 수요 간격
    mean = statistics.mean(nz)
    cv2 = (statistics.pstdev(nz) / mean) ** 2 if mean else 0
    if adi < 1.32 and cv2 < 0.49:
        cls["Smooth (예측 쉬움)"] += 1
    elif adi >= 1.32 and cv2 < 0.49:
        cls["Intermittent (간헐)"] += 1
    elif adi < 1.32 and cv2 >= 0.49:
        cls["Erratic (변동 큼)"] += 1
    else:
        cls["Lumpy (예측 매우 어려움)"] += 1
tot = sum(cls.values())
for k, v in cls.most_common():
    print(f"   {k:26s} {v:4d}종  {v/tot:5.1%}")
print(f"   (불출 이력이 있는 자재 {tot}종 기준 / 전체 743종)")

# ---------------------------------------------------------------- 5
line()
print("[5] 설비 노후화 신호 — 정비 빈도가 늘어나는 설비")
per = defaultdict(Counter)
for r in q(conn, "SELECT Equipment AS eq, StopStart AS s FROM maintenance WHERE StopStart<>''"):
    per[r["eq"]][r["s"][:4]] += 1
trend = []
for eq, years in per.items():
    early = sum(v for y, v in years.items() if y.isdigit() and 2010 <= int(y) <= 2017)
    late_ = sum(v for y, v in years.items() if y.isdigit() and 2018 <= int(y) <= 2026)
    if early + late_ >= 40:
        trend.append((eq, early, late_, late_ - early))
trend.sort(key=lambda x: -x[3])
print(f"   40건 이상 설비 {len(trend)}종")
for eq, e, l, d in trend[:6]:
    print(f"     {eq[:34]:36s} 2010-17 {e:4d} → 2018-26 {l:4d}  ({d:+d})")

# ---------------------------------------------------------------- 6
line()
print("[6] 정지시간 파레토 — 상위 몇 %가 전체 정지시간을 차지하는가")
hrs = sorted((r["h"] for r in q(conn, "SELECT StopHours AS h FROM maintenance WHERE StopHours>0")),
             reverse=True)
tot_h = sum(hrs)
acc = 0
for pct in (1, 5, 10, 20, 50):
    cut = max(1, int(len(hrs) * pct / 100))
    print(f"   상위 {pct:2d}% ({cut:5d}건) → 전체 정지시간의 {sum(hrs[:cut])/tot_h:5.1%}")

# ---------------------------------------------------------------- 7
line()
print("[7] 소싱그룹 공급사 집중도 — 이중화가 안 된 카테고리")
sg = q(conn, """SELECT SourcingGroup AS g, COUNT(*) AS n,
                       AVG(COALESCE(SupplierCount,1)) AS avg_sup,
                       SUM(StockDept*UnitCost) AS val,
                       SUM(CASE WHEN COALESCE(SupplierCount,1)<=1 THEN 1 ELSE 0 END) AS single
                FROM master GROUP BY SourcingGroup HAVING n>=10 ORDER BY val DESC""")
for r in sg[:8]:
    print(f"   {(r['g'] or '-')[:30]:32s} {r['n']:3d}종 단일공급사 {r['single']:3d}"
          f" ({r['single']/r['n']:4.0%}) 평균 {r['avg_sup']:.1f}곳"
          f" 금액 {(r['val'] or 0)/1e8:6.1f}억")

# ---------------------------------------------------------------- 8
line()
print("[8] 창고 흐름 — 입고·불출이 어디서 일어나는가 (Sankey 소재)")
wh = q(conn, """SELECT SUBINV AS w, SUM(QTY_IN) AS qin, SUM(QTY_OUT) AS qout, COUNT(*) AS n
                FROM txn_history GROUP BY SUBINV ORDER BY (qin+qout) DESC LIMIT 8""")
dept = ("QFC01", "QHB24", "QHB25", "QHB27", "QVC03", "QVC07")
for r in wh:
    tag = "부서창고" if r["w"] in dept else "기타"
    print(f"   {r['w']:8s} {tag:5s} 입고 {r['qin']:8,.0f} 불출 {r['qout']:8,.0f}"
          f" 거래 {r['n']:5d}")

conn.close()
print("\n완료")
