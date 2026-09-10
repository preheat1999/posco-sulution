"""원천 CSV 4종 → SQLite 적재 (정형 라우팅 A안).

A안은 원천 CSV 만 적재한다. 적정재고·신호등 산출 결과는 반입하지 않았으므로
관련 컬럼과 템플릿(order_urgent, pooling_candidates)은 만들지 않는다.

사용: python src/build_db.py
"""
import csv
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "Chatbot_Start_Package" / "01_데이터" / "정형데이터"
OUT = ROOT / "data" / "structured" / "materials.db"

# 부서창고 6개만 부서 수요로 인정한다 (데이터 명세 2절)
DEPT_SUBINV = ("QFC01", "QHB24", "QHB25", "QHB27", "QVC03", "QVC07")

TABLES = {
    "master": ("master.csv", [
        ("Item", "TEXT"), ("Type", "TEXT"), ("CriticalSparePart", "TEXT"),
        ("CriticalEquipment", "TEXT"), ("Warehouse", "TEXT"), ("SourcingGroup", "TEXT"),
        ("StockDept", "REAL"), ("StockAll", "REAL"), ("SupplierCount", "REAL"),
        ("UnitCost", "REAL"), ("LeadTimeMean", "REAL"), ("LeadTimeStd", "REAL"),
        ("CompletedCycles", "REAL"), ("ProcurementType", "TEXT"),
        ("ReceivingDate", "TEXT"), ("LinkedEquipment", "TEXT"),
        ("SparePartHoldingStd", "REAL")]),
    "txn_history": ("txn_history.csv", [
        ("Item", "TEXT"), ("ITEM_ID", "TEXT"), ("TXN_DATE", "TEXT"), ("SUBINV", "TEXT"),
        ("ORG_ID", "TEXT"), ("QTY_IN", "REAL"), ("QTY_OUT", "REAL"), ("TXN_CNT", "REAL")]),
    "equipment_map": ("equipment_map.csv", [
        ("Item", "TEXT"), ("LinkedEquipment", "TEXT"), ("SparePartHoldingStd", "REAL")]),
    "maintenance": ("maintenance.csv", [
        ("Equipment", "TEXT"), ("MaintKind", "TEXT"), ("StopStart", "TEXT"),
        ("ReStart", "TEXT"), ("StopHours", "REAL"), ("Manpower", "REAL"),
        ("Factory", "TEXT"), ("Line", "TEXT")]),
}

# 조회는 전부 v_ 뷰로만 한다 (안전장치 4겹: 뷰 화이트리스트)
VIEWS = {
    "v_item_status": """
        SELECT m.Item                                        AS item,
               m.Type                                        AS type,
               m.CriticalSparePart                           AS is_critical,
               m.CriticalEquipment                           AS is_critical_equipment,
               m.Warehouse                                   AS warehouse,
               m.SourcingGroup                               AS sourcing_group,
               m.ProcurementType                             AS procurement_type,
               m.StockDept                                   AS stock_dept,
               m.StockAll                                    AS stock_all,
               m.UnitCost                                    AS unit_cost,
               m.LeadTimeMean                                AS lead_time_mean,
               m.LeadTimeStd                                 AS lead_time_std,
               m.SupplierCount                               AS supplier_count,
               m.ReceivingDate                               AS receiving_date,
               m.LinkedEquipment                             AS linked_equipment,
               m.SparePartHoldingStd                         AS holding_std,
               ROUND(m.StockDept * m.UnitCost)               AS stock_value
        FROM master m
    """,
    "v_equipment_schedule": """
        SELECT mt.Equipment                                  AS equipment,
               mt.MaintKind                                  AS maint_kind,
               mt.StopStart                                  AS stop_start,
               mt.ReStart                                    AS restart,
               mt.StopHours                                  AS stop_hours,
               mt.Factory                                    AS factory,
               mt.Line                                       AS line,
               (SELECT COUNT(*) FROM master m
                 WHERE m.LinkedEquipment = mt.Equipment)     AS linked_items,
               (SELECT COALESCE(SUM(m.StockDept), 0) FROM master m
                 WHERE m.LinkedEquipment = mt.Equipment)     AS linked_stock
        FROM maintenance mt
    """,
    "v_demand_monthly": """
        SELECT t.Item                                        AS item,
               substr(t.TXN_DATE, 1, 7)                      AS month,
               SUM(t.QTY_OUT)                                AS qty_out,
               SUM(t.QTY_IN)                                 AS qty_in,
               COUNT(*)                                      AS txn_count
        FROM txn_history t
        WHERE t.SUBINV IN {dept}
        GROUP BY t.Item, substr(t.TXN_DATE, 1, 7)
    """.format(dept=str(DEPT_SUBINV)),
}


def load_csv(conn, table, filename, columns):
    path = SRC / filename
    cols = ", ".join(f'"{c}" {t}' for c, t in columns)
    conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.execute(f"CREATE TABLE {table} ({cols})")
    ph = ", ".join("?" for _ in columns)
    names = [c for c, _ in columns]
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for rec in csv.DictReader(f):
            rows.append([(rec.get(n) or None) for n in names])
    conn.executemany(f"INSERT INTO {table} VALUES ({ph})", rows)
    return len(rows)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    conn = sqlite3.connect(OUT)
    try:
        for table, (filename, columns) in TABLES.items():
            n = load_csv(conn, table, filename, columns)
            print(f"  {table:16s} {n:6d}행  ← {filename}")
        conn.execute("CREATE INDEX idx_master_item ON master(Item)")
        conn.execute("CREATE INDEX idx_txn_item ON txn_history(Item)")
        conn.execute("CREATE INDEX idx_maint_equip ON maintenance(Equipment)")
        conn.execute("CREATE INDEX idx_maint_start ON maintenance(StopStart)")
        for name, sql in VIEWS.items():
            conn.execute(f"DROP VIEW IF EXISTS {name}")
            conn.execute(f"CREATE VIEW {name} AS {sql}")
            n = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
            print(f"  뷰 {name:22s} {n:6d}행")
        conn.commit()
    finally:
        conn.close()
    print(f"\n생성 완료: {OUT} ({OUT.stat().st_size/1e6:.1f}MB)")


if __name__ == "__main__":
    sys.exit(main())
