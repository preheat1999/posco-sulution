"""정형 조회 — 고정 SQL 템플릿 + 안전장치 5겹 (05_정형데이터_라우팅_프롬프트.md C·D·E절).

★ LLM 에게 SQL 을 작성시키지 않는다. LLM 은 템플릿 이름과 인자만 고른다.
  같은 (템플릿, 인자)면 언제나 같은 SQL, 같은 결과가 나온다 — 재현성이 최우선 원칙이다.

A안: 원천 CSV 만 적재했으므로 적정재고 산출이 필요한 order_urgent·pooling_candidates 는
     구현하지 않는다. 라우터가 그 의도로 분류하면 답할 수 없음을 밝힌다.
"""
import json
import re
import sqlite3

from config import cfg, ROOT

# 안전장치 2: 정적 SQL 검사
FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|PRAGMA|CREATE|REPLACE|VACUUM)\b",
    re.I)
# 안전장치 4: 뷰 화이트리스트 — raw 테이블 직접 조회 금지
ALLOWED_VIEWS = {"v_item_status", "v_equipment_schedule", "v_demand_monthly"}

# 파라미터 바인딩이 불가능한 자리(ORDER BY/GROUP BY)는 이 딕셔너리로만 치환한다
SORTABLE = {"stock_value", "unit_cost", "stock_dept", "stock_all", "lead_time_mean",
            "supplier_count", "lead_time_std"}
GROUPABLE = {"type", "grade", "warehouse", "sourcing_group", "procurement_type",
             "is_critical"}

# A안에서 만들 수 없는 템플릿 — 적정재고 산출 결과가 필요하다
UNAVAILABLE = {
    "order_urgent": "발주 신호등(즉시발주·발주임박)",
    "pooling_candidates": "공용화 후보(정체 자재)",
}
UNAVAILABLE_MSG = (
    "적정재고 산출 결과가 없어 답할 수 없습니다. "
    "반입한 원천 데이터에는 자재 마스터·불출이력·정비계획만 있고, "
    "적정재고와 발주 신호등은 별도 산출 과정을 거쳐야 합니다.")

LABELS = {
    "item": "자재코드", "type": "속성", "is_critical": "핵심예비품",
    "is_critical_equipment": "핵심설비", "warehouse": "창고",
    "sourcing_group": "소싱그룹", "procurement_type": "조달구분",
    "stock_dept": "부서재고", "stock_all": "전사재고", "unit_cost": "단가(원)",
    "lead_time_mean": "리드타임(일)", "lead_time_std": "리드타임편차",
    "supplier_count": "공급사수", "receiving_date": "최근입고일",
    "linked_equipment": "연결설비", "holding_std": "보유기준",
    "stock_value": "재고금액(원)", "equipment": "설비", "maint_kind": "수리구분",
    "stop_start": "정지시작", "restart": "재가동", "stop_hours": "정지시간",
    "factory": "공장", "line": "라인", "linked_items": "연결자재수",
    "linked_stock": "연결자재재고", "month": "월", "qty_out": "불출",
    "qty_in": "입고", "txn_count": "거래건수", "n_items": "자재수",
    "total_stock_value": "재고금액(원)", "dimension": "구분",
}


def _db_uri():
    return f"file:{(ROOT / cfg.get('structured.db_path')).as_posix()}?mode=ro"


def connect():
    """안전장치 1: 읽기전용 커넥션.

    가장 중요한 방어다. 코드 검사는 우회 가능성이 남지만 mode=ro 는 OS 수준에서 막는다."""
    conn = sqlite3.connect(_db_uri(), uri=True,
                           timeout=cfg.get("structured.query.timeout_seconds"))
    conn.row_factory = sqlite3.Row
    return conn


def _check_sql(sql):
    if FORBIDDEN_RE.search(sql):
        raise ValueError("금지된 SQL 키워드")
    if sql.strip().rstrip(";").count(";"):          # 안전장치 3: 단일문 강제
        raise ValueError("복수 문장은 허용하지 않는다")
    used = set(re.findall(r"\bv_[a-z_]+", sql))
    if not used or not used <= ALLOWED_VIEWS:
        raise ValueError(f"허용되지 않은 대상: {used - ALLOWED_VIEWS}")


def _limit(args, default=20):
    try:
        n = int(args.get("limit", default))
    except (TypeError, ValueError):
        n = default
    return max(1, min(n, cfg.get("structured.query.max_rows")))


# ---- 템플릿 6종 (A안) --------------------------------------------------------

def t_item_detail(args):
    return ("SELECT item, type, is_critical, warehouse, sourcing_group, procurement_type,"
            " stock_dept, stock_all, unit_cost, stock_value, lead_time_mean,"
            " supplier_count, receiving_date, linked_equipment"
            " FROM v_item_status WHERE item = :item LIMIT :_limit",
            {"item": str(args.get("item", "")), "_limit": 1})


def t_item_list(args):
    where, p = [], {}
    for key, col in (("type", "type"), ("warehouse", "warehouse"),
                     ("sourcing_group", "sourcing_group"),
                     ("procurement_type", "procurement_type")):
        if args.get(key):
            where.append(f"{col} = :{key}")
            p[key] = str(args[key])
    if args.get("is_critical") is not None:
        where.append("is_critical = :is_critical")
        p["is_critical"] = "O" if args["is_critical"] in (True, "O", "true", 1) else "X"
    if args.get("min_stock_value"):
        where.append("stock_value >= :min_stock_value")
        p["min_stock_value"] = float(args["min_stock_value"])
    sort = args.get("sort_by") if args.get("sort_by") in SORTABLE else "stock_value"
    order = "ASC" if str(args.get("order", "desc")).lower() == "asc" else "DESC"
    p["_limit"] = _limit(args)
    sql = ("SELECT item, type, is_critical, warehouse, sourcing_group, stock_dept,"
           " unit_cost, stock_value, lead_time_mean FROM v_item_status"
           + (" WHERE " + " AND ".join(where) if where else "")
           + f" ORDER BY {sort} {order} LIMIT :_limit")
    return sql, p


def t_summary_by(args):
    dim = args.get("dimension")
    if dim not in GROUPABLE:
        raise ValueError(f"집계 기준은 {sorted(GROUPABLE)} 중 하나여야 한다 (받은 값: {dim})")
    return (f"SELECT {dim} AS dimension, COUNT(*) AS n_items,"
            " ROUND(SUM(stock_value)) AS total_stock_value"
            f" FROM v_item_status GROUP BY {dim} ORDER BY total_stock_value DESC"
            " LIMIT :_limit", {"_limit": _limit(args, 50)})


def t_portfolio_totals(args):
    return ("SELECT COUNT(*) AS n_items, ROUND(SUM(stock_value)) AS total_stock_value,"
            " ROUND(AVG(lead_time_mean), 1) AS lead_time_mean,"
            " SUM(CASE WHEN is_critical = 'O' THEN 1 ELSE 0 END) AS n_critical"
            " FROM v_item_status LIMIT :_limit", {"_limit": 1})


def t_equipment_schedule(args):
    where, p = [], {}
    if args.get("equipment"):
        where.append("equipment LIKE :equipment")
        p["equipment"] = f"%{args['equipment']}%"
    if args.get("maint_kind"):
        where.append("maint_kind = :maint_kind")
        p["maint_kind"] = str(args["maint_kind"])
    if args.get("since"):
        where.append("stop_start >= :since")
        p["since"] = str(args["since"])
    if args.get("until"):
        where.append("stop_start <= :until")
        p["until"] = str(args["until"])
    if args.get("only_linked"):
        where.append("linked_items > 0")
    p["_limit"] = _limit(args)
    return ("SELECT equipment, maint_kind, stop_start, restart, stop_hours, factory,"
            " line, linked_items, linked_stock FROM v_equipment_schedule"
            + (" WHERE " + " AND ".join(where) if where else "")
            + " ORDER BY stop_start DESC LIMIT :_limit", p)


def t_demand_history(args):
    return ("SELECT item, month, qty_out, qty_in, txn_count FROM v_demand_monthly"
            " WHERE item = :item ORDER BY month DESC LIMIT :_limit",
            {"item": str(args.get("item", "")), "_limit": _limit(args, 24)})


TEMPLATES = {
    "item_detail": t_item_detail,
    "item_list": t_item_list,
    "summary_by": t_summary_by,
    "portfolio_totals": t_portfolio_totals,
    "equipment_schedule": t_equipment_schedule,
    "demand_history": t_demand_history,
}


def to_markdown(rows, columns):
    """결과 표를 마크다운으로. LLM 은 이 표를 그대로 옮기기만 한다(숫자 환각 차단)."""
    if not rows:
        return ""
    head = [LABELS.get(c, c) for c in columns]
    out = ["| " + " | ".join(head) + " |",
           "| " + " | ".join("---" for _ in head) + " |"]
    for r in rows:
        cells = []
        for c in columns:
            v = r[c]
            if v is None:
                v = "-"
            elif isinstance(v, float):
                # 원천 값을 반올림하지 않는다 — 소수부가 있으면 그대로 보존한다.
                # (단가 1422189.73 을 1,422,190 으로 보이면 CSV 와 대조할 때 어긋난다)
                v = f"{v:,.0f}" if v == int(v) else f"{v:,.2f}"
            elif isinstance(v, int):
                v = f"{v:,}"
            cells.append(str(v).replace("|", "\\|"))
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def run(template, args=None):
    """{ok, template, args, sql, columns, rows, table, citation, truncated, message}"""
    args = args or {}
    if template in UNAVAILABLE:
        return {"ok": False, "template": template, "args": args,
                "message": UNAVAILABLE_MSG, "rows": [], "table": "", "citation": ""}
    if template not in TEMPLATES:
        return {"ok": False, "template": template, "args": args,
                "message": f"알 수 없는 조회 템플릿: {template}",
                "rows": [], "table": "", "citation": ""}

    sql, params = TEMPLATES[template](args)
    _check_sql(sql)
    max_rows = cfg.get("structured.query.max_rows")
    with connect() as conn:
        cur = conn.execute(sql, params)
        columns = [d[0] for d in cur.description]
        fetched = cur.fetchmany(max_rows + 1)
    truncated = len(fetched) > max_rows
    rows = fetched[:max_rows]

    asof = cfg.get("structured.asof")
    source = {"equipment_schedule": "maintenance.csv",
              "demand_history": "txn_history.csv"}.get(template, "master.csv")
    return {"ok": True, "template": template, "args": args, "sql": sql,
            "columns": columns, "rows": [dict(r) for r in rows],
            "table": to_markdown(rows, columns),
            "citation": f"[DB: {template} / 원천 {source}, 기준일 {asof}]",
            "truncated": truncated,
            "message": "" if rows else "조회 결과가 없습니다. 조건을 바꿔 다시 물어보세요."}
