"""대시보드 집계 — CSV·엑셀·청크를 읽어 data/viz.json 으로 굽는다.

★ 원문은 넣지 않는다. 집계 수치와 라벨만 넣는다(대외비 문서가 JSON 으로 새지 않게).
★ 개인정보(등록자 이름)는 넣지 않는다. '상위 N명 비중' 같은 익명 집계만 넣는다.
"""
import json
import re
import sqlite3
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT.parent / "Chatbot_Start_Package"
DOCS = PKG / "01_데이터" / "원본문서_30건"
DB = ROOT / "data" / "structured" / "materials.db"
OUT = ROOT / "data" / "viz.json"
ASOF = date(2026, 9, 3)
CODE_RE = re.compile(r"(?<![A-Za-z0-9])Q[A-Z]?\d{6,8}(?![0-9])")

V = {"meta": {"asof": ASOF.isoformat(),
              "note": "정형데이터(자재·정비·불출)는 연습용 샘플입니다. 실제 사내 자재 데이터가 아닙니다.",
              "built_at": datetime.now().strftime("%Y-%m-%d %H:%M")}}


def conn_ro():
    c = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


def rows(c, sql, p=()):
    cur = c.execute(sql, p)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def pairs(counter, top=None, other_label="기타"):
    items = counter.most_common()
    if top and len(items) > top:
        head = items[:top]
        tail = sum(v for _, v in items[top:])
        return [{"label": str(k), "value": v} for k, v in head] + \
               [{"label": f"{other_label} {len(items)-top}종", "value": tail}]
    return [{"label": str(k), "value": v} for k, v in items]


# ============================================================ FAQ 엑셀
def load_faq(path, sheet="raw"):
    import openpyxl
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        if ws.title.strip().lower() != sheet:
            continue
        rr = [list(r) for r in ws.iter_rows(values_only=True)]
        hi = next((i for i, r in enumerate(rr[:6])
                   if r and any(str(c).strip() == "질문/답변" for c in r if c)), 0)
        hdr = [str(c).strip() if c is not None else "" for c in rr[hi]]
        for r in rr[hi + 1:]:
            out.append({hdr[j]: (r[j] if j < len(r) else None)
                        for j in range(len(hdr)) if hdr[j]})
    wb.close()
    return out


def load_faq_xlsb(path):
    from pyxlsb import open_workbook
    out = []
    with open_workbook(str(path)) as wb:
        for name in wb.sheets:
            if name.strip().lower() != "raw":
                continue
            with wb.get_sheet(name) as sh:
                rr = [[c.v for c in r] for r in sh.rows()]
            hi = next((i for i, r in enumerate(rr[:6])
                       if r and any(str(c).strip() == "질문/답변" for c in r if c)), 0)
            hdr = [str(c).strip() if c is not None else "" for c in rr[hi]]
            for r in rr[hi + 1:]:
                out.append({hdr[j]: (r[j] if j < len(r) else None)
                            for j in range(len(hdr)) if hdr[j]})
    return out


F_BUY = DOCS / "260810_설비자재구매실_구매지원 Assistant 포스위키 질의응답 내용.xlsx"
F_CLS = DOCS / "260128_(광양)설비기술부_포스위키 질문분류.xlsx"
F_PRD = DOCS / "260127_(광양)설비기술부_포스위키 생산관리분야 질문, 답변 리스트.xlsb"

buy, cls_, prd = load_faq(F_BUY), load_faq(F_CLS), load_faq_xlsb(F_PRD)
print(f"FAQ 로드: 구매 {len(buy)} · 질문분류 {len(cls_)} · 생산관리 {len(prd)}")

V["faq"] = {"n_rows": len(buy) + len(cls_) + len(prd),
            "n_files": 3,
            "sources": ["구매지원 포스위키 질의응답", "포스위키 질문분류", "생산관리 질문·답변"]}

# 1.1 질문 주제 (상세구분)
V["faq"]["topics"] = pairs(Counter(str(r.get("상세구분")).strip()
                                   for r in cls_ if r.get("상세구분")), top=12)
# 1.2 기술 분야 (LEVEL3)
lv = Counter()
for r in cls_ + prd:
    if r.get("LEVEL3"):
        lv[str(r["LEVEL3"]).strip()] += 1
V["faq"]["fields"] = pairs(lv)
# 기술주제별분포
V["faq"]["themes"] = pairs(Counter(str(r.get("기술주제별분포")).strip()
                                   for r in cls_ if r.get("기술주제별분포")))
# 1.3 연도 × 주제 (상위 5 + 기타)
top5 = [d["label"] for d in V["faq"]["topics"][:5]]
yt = defaultdict(Counter)
for r in cls_:
    y = str(r.get("등록일") or "")[:4]
    t = str(r.get("상세구분") or "").strip()
    if y.isdigit():
        yt[y][t if t in top5 else "그 외"] += 1
V["faq"]["topic_by_year"] = {
    "years": sorted(yt),
    "series": [{"label": t, "values": [yt[y].get(t, 0) for y in sorted(yt)]}
               for t in top5 + ["그 외"]]}
# 연도별 전체 질문
yr = Counter()
for r in buy + cls_ + prd:
    y = str(r.get("등록일") or "")[:4]
    if y.isdigit():
        yr[y] += 1
V["faq"]["by_year"] = [{"label": y, "value": yr[y]} for y in sorted(yr)]


# 1.4 질문 → 답변 소요일
def parse_dt(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    s = str(v).strip()
    for f in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:19], f)
        except ValueError:
            pass
    return None


th = defaultdict(lambda: {"q": [], "a": []})
for r in buy:
    t = str(r.get("제목") or "").strip()
    dt = parse_dt(r.get("등록일"))
    if not t or not dt:
        continue
    th[t]["q" if "질문" in str(r.get("질문/답변") or "") else "a"].append(dt)
lags = sorted((min(v["a"]) - min(v["q"])).total_seconds() / 86400
              for v in th.values() if v["q"] and v["a"]
              if -1 <= (min(v["a"]) - min(v["q"])).total_seconds() / 86400 <= 400)
band = Counter()
for x in lags:
    band["당일" if x < 1 else "1~3일" if x < 3 else "3~7일" if x < 7
         else "7~30일" if x < 30 else "30일+"] += 1
V["faq"]["answer_lag"] = {
    "n": len(lags),
    "median": round(lags[len(lags) // 2], 2),
    "mean": round(statistics.mean(lags), 2),
    "p90": round(lags[int(len(lags) * .9)], 1),
    "p95": round(lags[int(len(lags) * .95)], 1),
    "max": round(lags[-1], 1),
    "bands": [{"label": k, "value": band[k]}
              for k in ("당일", "1~3일", "3~7일", "7~30일", "30일+") if band[k]]}

# 1.5 답변 집중도 (익명 — 이름은 넣지 않는다)
ans = Counter()
for r in buy:
    if "답변" in str(r.get("질문/답변") or ""):
        who = str(r.get("등록자정보") or "").strip()
        if who:
            ans[who] += 1
vals = sorted(ans.values(), reverse=True)
tot_a = sum(vals)
cum, lorenz = 0, []
for i, v in enumerate(vals, 1):
    cum += v
    lorenz.append({"x": round(i / len(vals), 4), "y": round(cum / tot_a, 4)})
V["faq"]["answer_concentration"] = {
    "n_answers": tot_a, "n_answerers": len(vals),
    "top1": round(sum(vals[:1]) / tot_a, 4),
    "top5": round(sum(vals[:5]) / tot_a, 4),
    "top10": round(sum(vals[:10]) / tot_a, 4),
    "top20": round(sum(vals[:20]) / tot_a, 4),
    "single_answer_people": sum(1 for v in vals if v == 1),
    "lorenz": lorenz[::max(1, len(lorenz) // 60)] + [lorenz[-1]]}

# 1.7 전문가 비율
ex = Counter()
for r in cls_ + prd:
    if r.get("전문가구분"):
        ex[str(r["전문가구분"]).strip()] += 1
V["faq"]["expert_ratio"] = {"expert": ex.get("전문가", 0), "normal": ex.get("일반", 0)}
# 1.8 설비별 질문 (미분류 분리)
eq = Counter()
unknown = 0
for r in cls_:
    v = str(r.get("설비구분") or "").strip()
    if not v or v == "-":
        unknown += 1
    else:
        eq[v] += 1
V["faq"]["equipment"] = {"items": pairs(eq, top=12), "unclassified": unknown}
# 질문/답변 비율 → 답변률
qn = sum(1 for r in buy + cls_ + prd if "질문" in str(r.get("질문/답변") or ""))
an = sum(1 for r in buy + cls_ + prd if "답변" in str(r.get("질문/답변") or ""))
V["faq"]["qa"] = {"questions": qn, "answers": an}
# 분류2 (구매 질문 유형)
V["faq"]["buy_kinds"] = pairs(Counter(str(r.get("분류2")).strip()
                                      for r in buy if r.get("분류2")))

# ============================================================ 정형
c = conn_ro()

# 2.x 자재
mat = rows(c, """SELECT m.Item item, m.Type type, m.CriticalSparePart csp,
                        m.Warehouse wh, m.SourcingGroup sg, m.ProcurementType proc,
                        m.StockDept stock, m.UnitCost cost, m.LeadTimeMean lt,
                        m.SupplierCount sup, m.ReceivingDate recv,
                        COALESCE(d.out_total,0) out_total, COALESCE(d.n_month,0) n_month
                 FROM master m LEFT JOIN
                   (SELECT item, SUM(qty_out) out_total, COUNT(*) n_month
                    FROM v_demand_monthly GROUP BY item) d ON d.item=m.Item""")
for r in mat:
    r["val"] = (r["stock"] or 0) * (r["cost"] or 0)
total_val = sum(r["val"] for r in mat)

quad = Counter()
for r in mat:
    hs, hd = (r["stock"] or 0) > 0, (r["out_total"] or 0) > 0
    quad[("재고 있음" if hs else "재고 없음") + " · " + ("불출 있음" if hd else "불출 없음")] += 1
dead = [r for r in mat if (r["stock"] or 0) > 0 and not (r["out_total"] or 0)]
short = [r for r in mat if not (r["stock"] or 0) and (r["out_total"] or 0) > 0]
V["material"] = {
    "n_items": len(mat), "total_value": round(total_val),
    "quadrant_counts": pairs(quad),
    "dead_stock": {"n": len(dead), "value": round(sum(r["val"] for r in dead)),
                   "share": round(sum(r["val"] for r in dead) / total_val, 4)},
    "shortage": {"n": len(short),
                 "critical": sum(1 for r in short if r["csp"] == "O")},
    # 2.1 산점 (로그축) — 개별 자재
    "scatter": [{"x": round(r["out_total"], 1), "y": round(r["stock"] or 0, 1),
                 "v": round(r["val"]), "c": r["csp"], "item": r["item"]}
                for r in mat],
}
# 2.3 ABC 파레토
sv = sorted((r for r in mat if r["val"] > 0), key=lambda r: -r["val"])
cum, pareto = 0, []
for i, r in enumerate(sv, 1):
    cum += r["val"]
    pareto.append({"i": i, "value": round(r["val"]), "cum": round(cum / total_val, 4)})
V["material"]["pareto"] = pareto
V["material"]["abc"] = [
    {"label": f"A ({sum(1 for p in pareto if p['cum']<=0.8)}종)", "value": 0.8},
    {"label": "B", "value": 0.15}, {"label": "C", "value": 0.05}]
# 2.4 정체 연차
stale = Counter()
for r in dead:
    y = (r["recv"] or "")[:4]
    stale[y if y.isdigit() else "불명"] += r["val"]
V["material"]["stale_by_year"] = [{"label": k, "value": round(v)}
                                  for k, v in sorted(stale.items())]
# 2.5 결품 목록
V["material"]["shortage_list"] = [
    {"item": r["item"], "out": round(r["out_total"], 1), "lt": r["lt"], "csp": r["csp"]}
    for r in sorted(short, key=lambda r: -r["out_total"])[:12]]
# 2.6 / 3.6 구성
V["material"]["by_type"] = pairs(Counter(r["type"] for r in mat))
V["material"]["by_proc"] = pairs(Counter(r["proc"] or "(미확인)" for r in mat))
V["material"]["by_wh"] = pairs(Counter(r["wh"] or "-" for r in mat))
V["material"]["by_sup"] = pairs(Counter(str(int(r["sup"])) + "곳" if r["sup"]
                                        else "미확인" for r in mat))

# 3.1 조달 리스크 지수
lt_max = max((r["lt"] or 0) for r in mat) or 1
for r in mat:
    sup = 1.0 if (r["sup"] or 1) <= 1 else (0.5 if r["sup"] == 2 else 0.2)
    r["risk"] = round(100 * (0.35 * (r["lt"] or 0) / lt_max + 0.25 * sup
                             + 0.2 * min(r["val"] / 1e8, 1.0)
                             + 0.15 * (1 if r["csp"] == "O" else 0)
                             + 0.05 * (1 if r["proc"] == "수입" else 0)), 1)
risk_sorted = sorted(mat, key=lambda r: -r["risk"])
V["material"]["risk_index"] = {
    "formula": "0.35×리드타임 + 0.25×공급사 희소성 + 0.20×재고금액 + 0.15×핵심예비품 + 0.05×수입",
    "top": [{"item": r["item"], "score": r["risk"], "lt": r["lt"],
             "sup": r["sup"], "csp": r["csp"], "proc": r["proc"],
             "value": round(r["val"])} for r in risk_sorted[:15]],
    "over70": sum(1 for r in mat if r["risk"] >= 70),
    "over50": sum(1 for r in mat if r["risk"] >= 50),
    "median": round(risk_sorted[len(risk_sorted) // 2]["risk"], 1)}
# 3.2 리드타임 × 단가
V["material"]["lt_cost"] = [{"x": r["lt"], "y": r["cost"], "v": round(r["val"]),
                             "c": r["csp"], "item": r["item"]}
                            for r in mat if r["lt"] and r["cost"]]
# 3.3 소싱그룹 단일공급사율
sg = rows(c, """SELECT SourcingGroup g, COUNT(*) n,
                       SUM(CASE WHEN COALESCE(SupplierCount,1)<=1 THEN 1 ELSE 0 END) single,
                       SUM(StockDept*UnitCost) val
                FROM master GROUP BY SourcingGroup HAVING n>=10 ORDER BY val DESC""")
V["material"]["sourcing_single"] = [
    {"label": (r["g"] or "-").replace("Q_", ""), "n": r["n"], "single": r["single"],
     "ratio": round(r["single"] / r["n"], 4), "value": round(r["val"] or 0)}
    for r in sg]
# 3.5 리드타임 분포
lts = sorted(r["lt"] for r in mat if r["lt"])
hb = Counter()
for x in lts:
    hb[min(int(x // 30) * 30, 360)] += 1
V["material"]["lt_hist"] = [{"label": f"{k}~{k+30}일" if k < 360 else "360일+",
                             "value": hb[k]} for k in sorted(hb)]
V["material"]["lt_stats"] = {"median": round(lts[len(lts) // 2], 1),
                             "mean": round(statistics.mean(lts), 1),
                             "max": round(lts[-1], 1)}

# ============================================================ 정비
mt = rows(c, "SELECT Equipment eq, MaintKind kind, StopStart s, StopHours h, Factory f, Line ln FROM maintenance")
V["maint"] = {"n": len(mt)}
V["maint"]["by_kind"] = pairs(Counter(r["kind"] for r in mt if r["kind"]))
V["maint"]["by_factory"] = pairs(Counter(r["f"] for r in mt if r["f"]))
V["maint"]["by_line"] = pairs(Counter(r["ln"] for r in mt if r["ln"]), top=12)
V["maint"]["by_year"] = [{"label": y, "value": v} for y, v in
                         sorted(Counter((r["s"] or "")[:4] for r in mt
                                        if (r["s"] or "")[:4].isdigit()).items())]
# 4.3 공장 × 수리구분 히트맵
kinds = [d["label"] for d in V["maint"]["by_kind"]]
facs = [d["label"] for d in V["maint"]["by_factory"]]
grid = defaultdict(int)
for r in mt:
    if r["f"] and r["kind"]:
        grid[(r["f"], r["kind"])] += 1
V["maint"]["heatmap"] = {"rows": facs, "cols": kinds,
                         "values": [[grid.get((f, k), 0) for k in kinds] for f in facs]}
# 4.5 정지시간 파레토
hrs = sorted((r["h"] for r in mt if r["h"] and r["h"] > 0), reverse=True)
tot_h = sum(hrs)
V["maint"]["hours_pareto"] = [
    {"label": f"상위 {p}%", "value": round(sum(hrs[:max(1, int(len(hrs) * p / 100))]) / tot_h, 4)}
    for p in (1, 5, 10, 20, 50, 100)]
V["maint"]["hours_stats"] = {"total": round(tot_h), "median": hrs[len(hrs) // 2],
                            "mean": round(statistics.mean(hrs), 1), "max": hrs[0]}
hh = Counter()
for x in hrs:
    hh[min(int(x // 48) * 48, 480)] += 1
V["maint"]["hours_hist"] = [{"label": f"{k}~{k+48}h" if k < 480 else "480h+",
                             "value": hh[k]} for k in sorted(hh)]
# 4.7 연 × 월 히트맵
ym = defaultdict(int)
years = sorted({(r["s"] or "")[:4] for r in mt if (r["s"] or "")[:4].isdigit()})
for r in mt:
    s = r["s"] or ""
    if len(s) >= 7 and s[:4].isdigit():
        ym[(s[:4], s[5:7])] += 1
V["maint"]["season"] = {"rows": years, "cols": [f"{m:02d}" for m in range(1, 13)],
                        "values": [[ym.get((y, f"{m:02d}"), 0) for m in range(1, 13)]
                                   for y in years]}
# 4.1 발주 데드라인
fut = rows(c, """SELECT mt.Equipment eq, mt.MaintKind kind, mt.StopStart s,
                        m.Item item, m.LeadTimeMean lt, m.StockDept stock,
                        m.CriticalSparePart csp
                 FROM maintenance mt JOIN master m ON m.LinkedEquipment=mt.Equipment
                 WHERE mt.StopStart > ? ORDER BY mt.StopStart""", (ASOF.isoformat(),))
late = []
for r in fut:
    try:
        y, m_, d_ = (int(x) for x in r["s"].split("-"))
        r["days_left"] = (date(y, m_, d_) - ASOF).days
    except Exception:
        continue
    if r["lt"] and r["days_left"] < r["lt"]:
        late.append(r)
V["maint"]["deadline"] = {
    "n_pairs": len(fut), "n_late": len(late),
    "share": round(len(late) / len(fut), 4) if fut else 0,
    "list": [{"date": r["s"], "eq": r["eq"], "kind": r["kind"], "item": r["item"],
              "lt": r["lt"], "stock": r["stock"], "days_left": r["days_left"],
              "gap": round((r["lt"] or 0) - r["days_left"])}
             for r in sorted(late, key=lambda r: -((r["lt"] or 0) - r["days_left"]))[:14]],
    # 간트: 향후 12개월 월별 정지 건수 + 위반 건수
    "by_month": None}
gm, lm = Counter(), Counter()
for r in fut:
    gm[r["s"][:7]] += 1
for r in late:
    lm[r["s"][:7]] += 1
months = sorted(gm)[:18]
V["maint"]["deadline"]["by_month"] = {
    "months": months,
    "total": [gm[m] for m in months],
    "late": [lm[m] for m in months]}

# ============================================================ 수요 패턴
dem = defaultdict(list)
for r in rows(c, "SELECT item, month, qty_out FROM v_demand_monthly ORDER BY item, month"):
    dem[r["item"]].append(r["qty_out"] or 0)
cls_cnt, pts = Counter(), []
for item, s in dem.items():
    nz = [v for v in s if v > 0]
    if len(nz) < 2:
        cls_cnt["단발(판정 불가)"] += 1
        continue
    adi = len(s) / len(nz)
    mean = statistics.mean(nz)
    cv2 = (statistics.pstdev(nz) / mean) ** 2 if mean else 0
    k = ("Smooth" if adi < 1.32 and cv2 < 0.49 else
         "Intermittent" if adi >= 1.32 and cv2 < 0.49 else
         "Erratic" if cv2 >= 0.49 and adi < 1.32 else "Lumpy")
    cls_cnt[{"Smooth": "Smooth (예측 쉬움)", "Intermittent": "Intermittent (간헐)",
             "Erratic": "Erratic (변동 큼)", "Lumpy": "Lumpy (예측 어려움)"}[k]] += 1
    pts.append({"x": round(adi, 3), "y": round(cv2, 3), "k": k, "item": item})
V["demand"] = {"classes": pairs(cls_cnt), "scatter": pts,
               "cut_adi": 1.32, "cut_cv2": 0.49,
               "n_with_history": len(pts) + cls_cnt["단발(판정 불가)"]}
# 5.3 월별 불출
mo = defaultdict(float)
for r in rows(c, "SELECT month, SUM(qty_out) q FROM v_demand_monthly GROUP BY month"):
    mo[r["month"]] = r["q"] or 0
V["demand"]["monthly"] = [{"label": k, "value": round(v)} for k, v in sorted(mo.items())]
# 5.4 불출 상위 자재
V["demand"]["top_items"] = [
    {"label": r["item"], "value": round(r["q"])}
    for r in rows(c, """SELECT item, SUM(qty_out) q FROM v_demand_monthly
                        GROUP BY item ORDER BY q DESC LIMIT 20""")]

# ============================================================ 창고 흐름
DEPT = ("QFC01", "QHB24", "QHB25", "QHB27", "QVC03", "QVC07")
wh = rows(c, """SELECT SUBINV w, SUM(QTY_IN) qin, SUM(QTY_OUT) qout, COUNT(*) n
                FROM txn_history GROUP BY SUBINV ORDER BY (qin+qout) DESC""")
V["flow"] = {
    "top": [{"label": r["w"], "qin": round(r["qin"] or 0), "qout": round(r["qout"] or 0),
             "n": r["n"], "dept": r["w"] in DEPT} for r in wh[:12]],
    "groups": [
        {"label": "부서창고 6곳", "qin": round(sum(r["qin"] or 0 for r in wh if r["w"] in DEPT)),
         "qout": round(sum(r["qout"] or 0 for r in wh if r["w"] in DEPT))},
        {"label": f"기타 {sum(1 for r in wh if r['w'] not in DEPT)}곳",
         "qin": round(sum(r["qin"] or 0 for r in wh if r["w"] not in DEPT)),
         "qout": round(sum(r["qout"] or 0 for r in wh if r["w"] not in DEPT))}],
    "n_warehouses": len(wh)}

# ============================================================ 7.7 코드 교집합
codes = Counter()
for r in buy:
    for m in CODE_RE.finditer(f"{r.get('내용') or ''} {r.get('제목') or ''}"):
        codes[m.group(0).upper()] += 1
master_codes = {r["item"].upper() for r in rows(c, "SELECT Item item FROM master")}
inter = set(codes) & master_codes
V["coverage"] = {"faq_codes": len(codes), "master_codes": len(master_codes),
                 "intersect": len(inter), "faq_mentions": sum(codes.values())}

# ============================================================ 코퍼스
chunks = [json.loads(l) for l in open(ROOT / "data/chunks/chunks.jsonl", encoding="utf-8")]
V["corpus"] = {
    "n_chunks": len(chunks),
    "by_category": pairs(Counter(x["metadata"]["doc_category"] for x in chunks)),
    "by_doc": [{"label": k, "value": v} for k, v in
               Counter(x["metadata"]["file_name"] for x in chunks).most_common()],
    "by_strategy": pairs(Counter(x["metadata"]["strategy"] for x in chunks)),
    "n_docs": len({x["doc_id"] for x in chunks})}

c.close()
OUT.write_text(json.dumps(V, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"\n저장: {OUT} ({OUT.stat().st_size/1e6:.2f}MB)")
for k in V:
    print(f"  {k}")
