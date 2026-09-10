# -*- coding: utf-8 -*-
"""DB(dev 브랜치 db/csv/02_자재_정본.csv) 기반 1·2단계 통합 실행기.

1단계는 DB 1층 자재 정본 + 이 폴더의 원시 이력(TSV·core_spare_parts)을 입력으로
classify_one 로직을 실행한다. 2단계는 1단계 확정 Type을 받아 engine.py/run_all.py
로직을 그대로 재사용해 적정재고를 계산한다. 어느 단계도 DB에 쓰지 않는다 —
DB(db/)는 읽기 전용 입력이고, 모든 산출물은 이 스크립트가 지정한 출력 폴더의
파일로만 나간다.

산출: 판정.csv · 적정재고.csv · 정체.csv · 명세상수.json · 요약값.json
      (컬럼명·허용값은 D_알고리즘팀원_요청서.md / 본선_반출 최종본/데이터/스키마.json 규격)

버그 수정 (기존 connect_both.py/classify_one 대비):
  - ASOF 를 2026-09-03 하나로 통일 (1단계도 2단계와 동일 기준일)
  - 매칭 실패 시 폴백을 항상 명시적 빈 딕셔너리로 처리
  - maintenance.csv 가 없으면 조용히 넘어가지 않고 즉시 오류로 중단
"""
import csv
import importlib.util
import json
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).parent
ASOF = date(2026, 9, 3)  # 1·2단계 공통 기준일 (기존 09-07/09-03 불일치 해소)

DB_MASTER_CSV = ROOT / "db" / "csv" / "02_자재_정본.csv"
DOG_DIR = ROOT / "DOG Type" / "Dummy Data"
CORE_SPARE_CSV = ROOT / "DOG Type" / "Core Spare Parts" / "core_spare_parts.csv"
TXN_HISTORY_CSV = ROOT / "txn_history.csv"
MAINTENANCE_CSV = ROOT / "maintenance.csv"
ENGINE_PY = ROOT / "engine.py"
RUN_ALL_PY = ROOT / "run_all.py"

OUT_DIR = ROOT / "db_output"
EMPTY = {}

VALID_TYPES = {"보험품", "계획품"}
EXCLUDED_ITEM_TYPES = {"consignment", "일일공급품", "자가재"}
ROLL_WORDS = ("roll", "roller")
DEPT_WAREHOUSES = {"QFC01", "QHB24", "QHB25", "QHB27", "QVC03", "QVC07"}


# ==================== 공용 유틸 ====================
def clean(value):
    return (value or "").strip()


def parse_date(value):
    text = clean(value)
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def number(value, default=0.0):
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return default


def key_from(row, code_name="Qcode", dept_name="Dept Code"):
    return clean(row.get(code_name) or row.get("Item") or row.get("q")), \
        clean(row.get(dept_name) or row.get("DeptCode") or row.get("부서코드") or row.get("dept"))


def read_csv(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def read_tsv(path):
    if not path or not Path(path).exists():
        return []
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


# ==================== 0. DB 1층 -> 알고리즘 입력 어댑터 ====================
MASTER_MAP = [
    ("Item", "q"), ("Type", "type"), ("CriticalSparePart", "csp"),
    ("CriticalEquipment", "ceq"), ("Warehouse", "wh"), ("SourcingGroup", "group"),
    ("StockDept", "stockDept"), ("StockAll", "stockAll"),
    ("SupplierCount", "suppliers"), ("UnitCost", "price"),
    ("LeadTimeMean", "ltMean"), ("LeadTimeStd", "ltStd"),
    ("CompletedCycles", "cycles"), ("ProcurementType", "proc"),
    ("ReceivingDate", "recvDate"), ("LinkedEquipment", "eq"),
    ("SparePartHoldingStd", "holdStd"), ("DeptCode", "dept"),
]


def load_master_from_db():
    """db/csv/02_자재_정본.csv -> {(Item,DeptCode): row-dict(algorithm 필드명)}."""
    if not DB_MASTER_CSV.exists():
        raise FileNotFoundError(
            f"{DB_MASTER_CSV} 이(가) 없습니다. dev 브랜치의 db/ 폴더를 먼저 받아오세요."
        )
    src = read_csv(DB_MASTER_CSV)
    master = {}
    for r in src:
        row = {a: r.get(b, "") for a, b in MASTER_MAP}
        key = (row["Item"], row["DeptCode"])
        master[key] = row
    return master


def equipment_map_from_db_row(row):
    """자재 정본 한 행 -> engine.py 가 기대하는 equipment_map 필드."""
    return {
        "LinkedEquipment": row.get("LinkedEquipment", ""),
        "SparePartHoldingStd": row.get("SparePartHoldingStd", ""),
    }


# ==================== 1. 1단계 — classify_one (버그 수정판) ====================
def build_events(rows, date_column, quantity_name="수량"):
    events = defaultdict(list)
    for row in rows:
        key = key_from(row)
        event_date = parse_date(row.get(date_column))
        if key[0] and key[1] and event_date:
            events[key].append((event_date, number(row.get(quantity_name))))
    return events


def percentile_score(value, thresholds, points):
    for threshold, point in thresholds:
        if value <= threshold:
            return point
    return points[-1][1]


def read_core_spares(path):
    if not path or not Path(path).exists():
        return set()
    rows = read_csv(path)
    return {key_from(row) for row in rows if all(key_from(row))}


def find_context(key, *row_lists):
    """매칭 실패는 항상 명시적으로 빈 딕셔너리 — '우연히 안 터지는' 폴백을 없앤다."""
    for rows in row_lists:
        for row in rows:
            if key_from(row) == key:
                return row
    return {}


def classify_one(key, outbound_ctx, inbound_ctx, stock_rows, core_spares):
    qcode, dept = key
    item_type = clean(outbound_ctx.get("Item Type") or inbound_ctx.get("Item Type")
                       or (stock_rows[0].get("Item Type") if stock_rows else ""))
    leaf = clean(outbound_ctx.get("Leaf Class") or inbound_ctx.get("Leaf Class")
                 or (stock_rows[0].get("Leaf Class") if stock_rows else ""))
    category = clean(outbound_ctx.get("Category") or inbound_ctx.get("Category")
                      or (stock_rows[0].get("Category") if stock_rows else ""))
    type_lower = item_type.lower()
    category_lower = category.lower()
    notes = []

    if qcode.upper().startswith("F") or type_lower in EXCLUDED_ITEM_TYPES:
        return result(key, "배제-소모품", "사전 배제", "소모품 규칙 적용", "", "", "HIGH")
    if any(word in leaf.lower() for word in ROLL_WORDS):
        return result(key, "배제-순환품", "사전 배제", "Roll 계열 Leaf Class 규칙 적용", "", "", "HIGH")
    if qcode.upper().startswith("QS"):
        return result(key, "보험품", "QS 확정", "Qcode QS 접두어 규칙 적용", "", "", "HIGH")
    if "spare part" in category_lower or "spare part" in type_lower:
        return result(key, "보험품", "Spare Part 확정", "Spare Part 계열 규칙 적용", "", "", "HIGH")

    outbound_events = outbound_ctx.get("events", [])
    inbound_events = inbound_ctx.get("events", [])
    stock_values = [number(row.get("수량")) for row in stock_rows]
    months = max(1, (ASOF.year - 2016) * 12 + ASOF.month - 9)
    out_months = {(d.year, d.month) for d, q in outbound_events if q > 0}
    in_months = {(d.year, d.month) for d, q in inbound_events if q > 0}
    avg_stock = sum(stock_values) / len(stock_values) if stock_values else 0
    total_out = sum(q for d, q in outbound_events)
    zero_stock_ratio = sum(1 for value in stock_values if value <= 0) / max(1, len(stock_values))
    out_ratio = len(out_months) / months
    annual_out = total_out / 10
    turnover = annual_out / avg_stock if avg_stock > 0 else None
    last_event = max([d for d, q in outbound_events + inbound_events], default=None)
    hold_years = (ASOF - last_event).days / 365.25 if last_event else 0

    core_score = 20 if key in core_spares else 0
    insurance_score = core_score + percentile_score(
        out_ratio, [(0.03, 10), (0.07, 8), (0.12, 6), (0.20, 4), (0.30, 2)], [(1, 0)])
    if turnover is not None:
        insurance_score += percentile_score(
            turnover, [(0.10, 10), (0.30, 8), (0.60, 6), (1.00, 3), (2.00, 1)], [(99, 0)])
    insurance_score += 20 if hold_years >= 1.5 else 0
    planned_score = percentile_score(
        zero_stock_ratio, [(0.10, 0), (0.25, 4), (0.40, 7), (0.60, 10), (0.80, 12)], [(1, 12)])
    if in_months and out_months:
        planned_score += 10 if len(out_months) <= 3 and len(in_months) <= 4 else 4
    if type_lower == "vmi":
        planned_score += 10
        notes.append("VMI")
    notes.extend([f"불출발생월비율={out_ratio:.3f}", f"재고0비율={zero_stock_ratio:.3f}"])
    si = min(100, insurance_score / 70 * 100)
    sp = min(100, planned_score / 32 * 100)
    difference = si - sp
    if si >= 55 and difference >= 15:
        decision = "보험품"
    elif sp >= 55 and difference <= -15:
        decision = "계획품"
    else:
        decision = "회색지대"
    confidence = "HIGH" if abs(difference) >= 25 else "MEDIUM" if abs(difference) >= 15 else "LOW"
    if core_score:
        notes.insert(0, "핵심 예비품 목록 일치 +20점")
    return result(key, decision, "시계열 점수", "; ".join(notes),
                  f"{si:.1f}", f"{sp:.1f}", confidence, core_score)


def result(key, decision, route, reason, insurance, planned, confidence, core_score=0):
    return {"Qcode": key[0], "DeptCode": key[1], "판정": decision, "판정경로": route,
            "판단근거": reason, "보험품점수": insurance, "계획품점수": planned,
            "신뢰도": confidence, "핵심예비품점수": core_score,
            "재고데이터출처": "DOG Type TSV + DB 자재정본"}


def stage_one(master, outbound_rows, inbound_rows, stock_rows, core_spares):
    out_map = build_events(outbound_rows, "Outbound Date")
    in_map = build_events(inbound_rows, "INbound Date")
    stock_map = defaultdict(list)
    for row in stock_rows:
        stock_map[key_from(row)].append(row)

    output = {}
    for key in master:
        ctx = find_context(key, outbound_rows, inbound_rows, stock_rows)
        outbound_ctx = dict(ctx)
        outbound_ctx["events"] = out_map.get(key, [])
        inbound_ctx = dict(ctx)
        inbound_ctx["events"] = in_map.get(key, [])
        output[key] = classify_one(key, outbound_ctx, inbound_ctx,
                                    stock_map.get(key, []), core_spares)
    return output


# ==================== 2. 2단계 — engine.py/run_all.py 재사용 ====================
def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def write_engine_inputs(work_dir, master, classification):
    """DB 기반 master + 1단계 결과를 engine.py 가 읽는 폴더 규격으로 써낸다."""
    work_dir.mkdir(parents=True, exist_ok=True)

    fields = [a for a, _ in MASTER_MAP]
    with (work_dir / "master.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in master.values():
            w.writerow(row)

    with (work_dir / "equipment_map.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["Item", "LinkedEquipment", "SparePartHoldingStd", "DeptCode"])
        w.writeheader()
        for row in master.values():
            w.writerow({"Item": row["Item"], "LinkedEquipment": row.get("LinkedEquipment", ""),
                        "SparePartHoldingStd": row.get("SparePartHoldingStd", ""),
                        "DeptCode": row["DeptCode"]})

    cls_fields = ["Qcode", "DeptCode", "판정", "판정경로", "판단근거", "보험품점수",
                  "계획품점수", "신뢰도", "핵심예비품점수", "재고데이터출처"]
    with (work_dir / "classification_result.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cls_fields)
        w.writeheader()
        w.writerows(classification.values())

    if not TXN_HISTORY_CSV.exists():
        raise FileNotFoundError(f"{TXN_HISTORY_CSV} 이(가) 없습니다. 2단계 수요원은 필수입니다.")
    if not MAINTENANCE_CSV.exists():
        # 0.5장 규칙: 조용히 0건 처리하지 않고 즉시 중단한다.
        raise FileNotFoundError(
            f"{MAINTENANCE_CSV} 이(가) 없습니다. 정비계획 연동이 필요하므로 실행을 중단합니다."
        )
    import shutil
    shutil.copyfile(TXN_HISTORY_CSV, work_dir / "txn_history.csv")
    shutil.copyfile(MAINTENANCE_CSV, work_dir / "maintenance.csv")


def run_stage_two(work_dir, output_dir):
    engine = load_module("engine", ENGINE_PY)
    engine.DATA = str(work_dir)
    engine.OUT = str(output_dir)
    engine.ASOF = ASOF
    output_dir.mkdir(parents=True, exist_ok=True)
    result_ = engine.compute()

    runner = load_module("run_all", RUN_ALL_PY)
    runner.E = engine
    runner.OUT = str(output_dir)
    runner.main()
    return engine, result_


# ==================== 3. issues / trend (신규 필드, 부록 [[project-new-output-fields-formula]]) ====================
def issues_and_trend(events, asof=ASOF):
    """events: [(date, qty), ...] 부서창고+QTY_OUT>0 필터를 이미 통과한 리스트.
    trend[0] = 23개월 전 달, trend[23] = 이번 달. issues = 이벤트(행) 개수 그 자체."""
    trend = [0.0] * 24
    issues = 0
    for d, q in events:
        months_ago = (asof.year - d.year) * 12 + (asof.month - d.month)
        if 0 <= months_ago < 24:
            trend[23 - months_ago] += q
            issues += 1
    return issues, trend


def demand_events_24m(demand_dict, key):
    """engine.load_txn() 이 만든 demand[key] = {date: qty} 를 (date,qty) 리스트로."""
    return sorted(demand_dict.get(key, {}).items())


# ==================== 4. 출력 어댑터 ====================
def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


def write_verdict_csv(path, classification):
    fields = ["q", "dept", "verdict", "path", "why", "si", "sp", "conf", "cspScore", "stockSrc"]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for (q, dept), r in classification.items():
            w.writerow({
                "q": q, "dept": dept, "verdict": r["판정"], "path": r["판정경로"],
                "why": r["판단근거"], "si": r["보험품점수"], "sp": r["계획품점수"],
                "conf": r["신뢰도"], "cspScore": r["핵심예비품점수"], "stockSrc": r["재고데이터출처"],
            })


def write_stock_csv(path, engine, result_, demand):
    items, targets, reasons = result_["items"], result_["targets"], result_["reasons"]
    crit = result_["crit"]
    q2eq, future = result_["q2eq"], result_["future"]

    LEAD_BUFFER = {"합리화": 60, "대수리": 45, "중수리": 21,
                   "정기수리": 14, "교체휴지": 10, "공정휴지": 7}

    fields = ["q", "dept", "type", "typeSrc", "grade", "target", "need", "amount",
              "action", "reason", "signal", "status", "sigEq", "sigKind", "stopDate",
              "dueDate", "dDays", "expect", "issues", "trend"]
    rows = []
    for c, it in items.items():
        target = targets[c]
        cur = it["stock_dept"]
        need = max(0, target - cur)
        action = "발주" if need > 0 else ("감축" if target < cur else "유지")

        sig_eq, sig_kind, stop_date, due_date, d_days, expect = "", "상시", "", "", "", ""
        if it["type"] == "계획품" and c in q2eq:
            cand = []
            for eq in q2eq[c]:
                for (dt, kind) in future.get((c[1], eq), []):
                    cand.append((dt, kind, eq))
            if cand:
                cand.sort()
                stop, kind, eq = cand[0]
                lt = it["lt_mean"] or 30
                buf = LEAD_BUFFER.get(kind, 14) + int(0.5 * (it["lt_std"] or 0))
                from datetime import timedelta
                order_by = stop - timedelta(days=int(lt) + buf)
                d = (order_by - ASOF).days
                sig_eq, sig_kind = eq, kind
                stop_date, due_date, d_days = str(stop), str(order_by), d
                if cur >= target:
                    signal, status = "gray", "재고충분"
                elif d <= 0:
                    signal, status = "red", "즉시발주"
                elif d <= 30:
                    signal, status = "yellow", "발주임박"
                else:
                    signal, status = "green", "여유"
                expect = target
            else:
                signal, status = _signal_reserve(cur, target)
        else:
            signal, status = _signal_reserve(cur, target)
            sig_eq = ";".join(q2eq.get(c, [])[:1])

        issues, trend = issues_and_trend(demand_events_24m(demand, c))

        rows.append({
            "q": c[0], "dept": c[1], "type": it["type"], "typeSrc": it["type_source"],
            "grade": crit[c]["grade"], "target": num(target), "need": num(need),
            "amount": round(need * it["unit_cost"]), "action": action, "reason": reasons[c],
            "signal": signal, "status": status, "sigEq": sig_eq, "sigKind": sig_kind,
            "stopDate": stop_date, "dueDate": due_date, "dDays": num(d_days) if d_days != "" else "",
            "expect": num(expect) if expect != "" else "", "issues": issues,
            "trend": ";".join(str(num(v) if v else 0) for v in trend),
        })

    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    return rows


def _signal_reserve(cur, tgt):
    if tgt <= 0:
        return "gray", "재고불요"
    if cur <= 0 or cur < tgt * 0.5:
        return "red", "즉시발주"
    if cur < tgt:
        return "yellow", "발주임박"
    if cur > tgt:
        return "gray", "충분"
    return "green", "여유"


def write_pool_csv(path, result_):
    fields = ["q", "dept", "ageDays", "staleValue", "poolGrade", "action"]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for s in sorted(result_["stale"], key=lambda x: -x["value"]):
            w.writerow({"q": s["item"], "dept": s["dept_code"], "ageDays": s["age"],
                        "staleValue": num(s["value"]), "poolGrade": s["pool_grade"],
                        "action": s["action"]})


def write_spec_json(path):
    spec = {
        "z": {"S": 2.58, "A": 2.05, "B": 1.65, "C": 1.28},
        "sl": {"S": 0.995, "A": 0.98, "B": 0.95, "C": 0.90},
        "insFormula": [
            "μ_LT = 일평균소요 x 리드타임평균",
            "SS = Z(등급) x 일표준편차 x sqrt(리드타임평균)",
            "norm = ceil(μ_LT + SS), 최소 ceil(1회소요규모) 보장",
            "raw = min(norm, 관측상한)   관측상한은 리드타임창 부트스트랩 400회의 최대값",
            "핵심(CSP·CEQ=O) → max(raw, 설치수기준, 1) · 비핵심 → raw",
            "소요 이력이 없으면 핵심은 max(설치수기준,1), 비핵심은 0",
        ],
        "plnFormula": [
            "핵심설비가 아니면 목표 0 (수리일정 발주로만 대응)",
            "최근 3년 무소요면 목표 0",
            "소요가 활발하지 않으면 목표 0 (λ < 1.0 또는 유휴 1.5년 초과)",
            "그 외 목표 = max(1, min(서비스수준 분위수, 상한 1))",
        ],
        "gradeRule": "7요인 가중합 백분위 상위 5/20/60% 로 S·A·B·C. 핵심예비품은 무조건 S",
        "factors": [
            {"k": "F5", "name": "공용성", "w": 0.50, "why": "타 부서에서 못 빌리는 품목의 품절이 가장 위험하다"},
            {"k": "F1", "name": "핵심설비", "w": 0.35, "why": ""},
            {"k": "F3", "name": "리드타임", "w": 0.05, "why": ""},
            {"k": "F4", "name": "대체성", "w": 0.04, "why": ""},
            {"k": "F6", "name": "고장확률", "w": 0.03, "why": ""},
            {"k": "F7", "name": "조달난이도", "w": 0.02, "why": ""},
            {"k": "F2", "name": "고장영향", "w": 0.01, "why": "원본 ERP 정비비가 보안으로 빠져 중위값 상수로 대체됐다"},
        ],
        "signalIns": [
            "목표 0 → 재고불요", "현재고 0 또는 목표의 절반 미만 → 즉시발주",
            "현재고 < 목표 → 발주임박", "현재고 > 목표 → 충분 · 같으면 여유",
        ],
        "signalPln": [
            "발주기준일 = 정지시작일 - (리드타임평균 + 선행일수 + 0.5 x 리드타임편차)",
            "선행일수 · 합리화 60 · 대수리 45 · 중수리 21 · 정기수리 14 · 교체휴지 10 · 공정휴지 7",
            "현재고 >= 예상소요 → 재고충분",
            "D <= 0 → 즉시발주 · 0 < D <= 30 → 발주임박 · D > 30 → 여유",
        ],
        "stale": "최종입고 후 548일(1.5년) 이상 · 최근 무소요 · 재고 있음 → 정체",
        "pool": [
            "전사재고 > 부서재고 → strong 즉시공용화",
            "핵심이고 보험품 → review 보류 · 재분류 검토",
            "그 외 → medium 공용화권장",
        ],
        "finance": "금융비용 절감 = (감축액 + 공용화 회수액) x 기여율 0.20 x 이자율 0.046",
        "source": "2단계 적정재고 · ALGORITHM_AND_PROMPT.md 부록 A~P",
        "asof": str(ASOF),
    }
    path.write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")


def write_summary_json(path, classification, stock_rows, pool_rows, engine_items):
    import collections
    verdict = collections.Counter(r["판정"] for r in classification.values())
    path_dist = collections.Counter(r["판정경로"] for r in classification.values())
    conf_dist = collections.Counter(r["신뢰도"] for r in classification.values())
    action_dist = collections.Counter(r["action"] for r in stock_rows)
    grade_dist = collections.Counter(r["grade"] for r in stock_rows)
    signal_dist = collections.Counter(r["signal"] for r in stock_rows)
    type_source_dist = collections.Counter(r["typeSrc"] for r in stock_rows)

    ins_rows = [r for r in stock_rows if r["type"] == "보험품"]
    pln_rows = [r for r in stock_rows if r["type"] == "계획품"]
    now_amt = sum((engine_items[(r["q"], r["dept"])]["stock_dept"]
                   * engine_items[(r["q"], r["dept"])]["unit_cost"]) for r in stock_rows)
    tgt_amt = sum((r["target"] or 0) * engine_items[(r["q"], r["dept"])]["unit_cost"]
                  for r in stock_rows)
    cut_amt = sum(max(0, engine_items[(r["q"], r["dept"])]["stock_dept"] - (r["target"] or 0))
                  * engine_items[(r["q"], r["dept"])]["unit_cost"] for r in stock_rows)
    pool_amt = sum(r["staleValue"] for r in pool_rows if r["poolGrade"] in ("strong", "medium"))
    interest, contrib = 0.046, 0.20
    finance_dept = (cut_amt + pool_amt) * contrib * interest

    ins_now = sum(engine_items[(r["q"], r["dept"])]["stock_dept"]
                  * engine_items[(r["q"], r["dept"])]["unit_cost"] for r in ins_rows)
    ins_tgt = sum((r["target"] or 0) * engine_items[(r["q"], r["dept"])]["unit_cost"] for r in ins_rows)
    pln_now = sum(engine_items[(r["q"], r["dept"])]["stock_dept"]
                  * engine_items[(r["q"], r["dept"])]["unit_cost"] for r in pln_rows)
    pln_tgt = sum((r["target"] or 0) * engine_items[(r["q"], r["dept"])]["unit_cost"] for r in pln_rows)

    zero_target = sum(1 for r in stock_rows if (r["target"] or 0) == 0)
    zero_pln = sum(1 for r in pln_rows if (r["target"] or 0) == 0)

    due_rows = [r for r in stock_rows if r["dDays"] != ""]
    due_over = sum(1 for r in due_rows if (r["dDays"] or 0) <= 0)
    due_order = sum(1 for r in due_rows if 0 < (r["dDays"] or 0) <= 30)
    due_order_amt = sum((r["amount"] or 0) for r in due_rows if 0 < (r["dDays"] or 0) <= 30)

    summary = {
        "items": len(stock_rows), "insItems": len(ins_rows), "plnItems": len(pln_rows),
        "nowAmt": round(now_amt), "tgtAmt": round(tgt_amt), "cutAmt": round(cut_amt),
        "poolAmt": round(pool_amt), "poolItems": len(pool_rows),
        "verdict": dict(verdict), "path": dict(path_dist), "conf": dict(conf_dist),
        "action": dict(action_dist), "grade": dict(grade_dist), "signal": dict(signal_dist),
        "zeroTarget": zero_target,
        "zeroTargetPct": round(zero_target / len(stock_rows) * 100, 1) if stock_rows else 0,
        "zeroPln": zero_pln,
        "zeroPlnPct": round(zero_pln / len(pln_rows) * 100, 1) if pln_rows else 0,
        "insNow": round(ins_now), "insTgt": round(ins_tgt),
        "plnNow": round(pln_now), "plnTgt": round(pln_tgt),
        "typeSource": dict(type_source_dist),
        "dueTotal": len(due_rows), "dueOver": due_over, "dueOrder": due_order,
        "dueOrderAmt": round(due_order_amt),
        "financeDept": round(finance_dept),
        "financeAll": round(2016_00000000 * 0.20 * 0.046 / 1e8, 2),  # 억원 단위
    }
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")


# ==================== 메인 ====================
def main():
    print(f"기준일(ASOF) = {ASOF}")
    master = load_master_from_db()
    print(f"DB 자재 정본 {len(master)}건 로드")

    outbound = read_tsv(DOG_DIR / "Outbound_Dummy.tsv")
    inbound = read_tsv(DOG_DIR / "Inbound_Dummy.tsv")
    stock = read_tsv(DOG_DIR / "Stock_Dummy.tsv")
    core_spares = read_core_spares(CORE_SPARE_CSV)
    print(f"1단계 원시 이력: Outbound {len(outbound)} · Inbound {len(inbound)} · "
          f"Stock {len(stock)} · 핵심예비품 {len(core_spares)}")

    classification = stage_one(master, outbound, inbound, stock, core_spares)
    import collections
    print("1단계 판정 분포:", dict(collections.Counter(r["판정"] for r in classification.values())))

    work_dir = OUT_DIR / "engine_input"
    write_engine_inputs(work_dir, master, classification)
    engine, result_ = run_stage_two(work_dir, OUT_DIR / "stage2_raw")

    demand = result_["demand"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_verdict_csv(OUT_DIR / "판정.csv", classification)
    stock_rows = write_stock_csv(OUT_DIR / "적정재고.csv", engine, result_, demand)
    write_pool_csv(OUT_DIR / "정체.csv", result_)
    write_spec_json(OUT_DIR / "명세상수.json")
    write_summary_json(OUT_DIR / "요약값.json", classification, stock_rows,
                       [{"staleValue": num(s["value"]), "poolGrade": s["pool_grade"]}
                        for s in result_["stale"]],
                       result_["items"])

    print(f"\n완료. 산출 폴더: {OUT_DIR}")
    print("다음: python validate_algorithm_csv.py", OUT_DIR)


if __name__ == "__main__":
    main()
