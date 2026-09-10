"""시각화 후보 탐색 — 어떤 컬럼이 몇 개의 값으로 분포하는지 실제로 센다.

원본문서_30건 안의 표형 데이터(FAQ 엑셀 3건)와 정형데이터 CSV 4종을 프로파일한다.
카디널리티와 결측률을 보고 차트 형태를 정하기 위한 것이다.
"""
import csv
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

PKG = Path(__file__).resolve().parent.parent.parent / "Chatbot_Start_Package"
DOCS = PKG / "01_데이터" / "원본문서_30건"
CSVS = PKG / "01_데이터" / "정형데이터"


def show(title, counter, top=12):
    total = sum(counter.values())
    print(f"\n  [{title}] 고유값 {len(counter)} · 합계 {total}")
    for k, v in counter.most_common(top):
        k = (str(k)[:38] or "(빈값)")
        print(f"    {k:40s} {v:6d}  {v/total:5.1%}")
    if len(counter) > top:
        print(f"    ... 그 외 {len(counter)-top}종")


def profile_faq_xlsx(path, sheet_filter="raw"):
    import openpyxl
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    print(f"\n{'='*78}\n{path.name}")
    for ws in wb.worksheets:
        if ws.title.strip().lower() != sheet_filter:
            continue
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        header_i = next((i for i, r in enumerate(rows[:6])
                         if r and any(str(c).strip() == "질문/답변" for c in r if c)), 0)
        header = [str(c).strip() if c is not None else "" for c in rows[header_i]]
        body = rows[header_i + 1:]
        print(f"  시트 '{ws.title}' · 데이터 {len(body)}행 · 컬럼 {header}")
        for j, col in enumerate(header):
            if not col or col in ("내용", "제목"):
                continue
            vals = [(r[j] if j < len(r) else None) for r in body]
            nonnull = [v for v in vals if v not in (None, "")]
            c = Counter(str(v).strip() for v in nonnull)
            if col in ("등록일",):
                years = Counter(str(v)[:4] for v in nonnull)
                show(f"{col} (연도)", years, top=15)
                continue
            if 1 < len(c) <= 60:
                show(col, c)
            else:
                print(f"\n  [{col}] 고유값 {len(c)} — 카디널리티가 높아 차트 부적합")
    wb.close()


def profile_faq_xlsb(path):
    from pyxlsb import open_workbook
    print(f"\n{'='*78}\n{path.name}")
    with open_workbook(str(path)) as wb:
        for name in wb.sheets:
            if name.strip().lower() != "raw":
                continue
            with wb.get_sheet(name) as sh:
                rows = [[c.v for c in r] for r in sh.rows()]
            header_i = next((i for i, r in enumerate(rows[:6])
                             if r and any(str(c).strip() == "질문/답변" for c in r if c)), 0)
            header = [str(c).strip() if c is not None else "" for c in rows[header_i]]
            body = rows[header_i + 1:]
            print(f"  시트 '{name}' · 데이터 {len(body)}행 · 컬럼 {header}")
            for j, col in enumerate(header):
                if not col or col in ("내용", "제목"):
                    continue
                nonnull = [r[j] for r in body if j < len(r) and r[j] not in (None, "")]
                if col == "등록일":
                    show(f"{col} (연도)", Counter(str(v)[:4] for v in nonnull), top=15)
                    continue
                c = Counter(str(v).strip() for v in nonnull)
                if 1 < len(c) <= 60:
                    show(col, c)
                else:
                    print(f"\n  [{col}] 고유값 {len(c)} — 카디널리티 높음")


def profile_csv(name, cat_cols, num_cols=(), date_col=None):
    path = CSVS / name
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    print(f"\n{'='*78}\n{name} · {len(rows)}행 · 컬럼 {list(rows[0].keys())}")
    for col in cat_cols:
        c = Counter((r.get(col) or "(빈값)").strip() for r in rows)
        show(col, c)
    for col in num_cols:
        vals = []
        for r in rows:
            try:
                vals.append(float(r[col]))
            except (TypeError, ValueError):
                pass
        if vals:
            vals.sort()
            n = len(vals)
            print(f"\n  [{col}] n={n} 합계={sum(vals):,.0f} 평균={sum(vals)/n:,.1f}"
                  f" 중앙={vals[n//2]:,.1f} 최소={vals[0]:,.1f} 최대={vals[-1]:,.1f}")
    if date_col:
        years = Counter((r.get(date_col) or "")[:4] for r in rows if r.get(date_col))
        show(f"{date_col} (연도)", years, top=15)


if __name__ == "__main__":
    profile_faq_xlsx(DOCS / "260810_설비자재구매실_구매지원 Assistant 포스위키 질의응답 내용.xlsx")
    profile_faq_xlsx(DOCS / "260128_(광양)설비기술부_포스위키 질문분류.xlsx", "raw")
    profile_faq_xlsb(DOCS / "260127_(광양)설비기술부_포스위키 생산관리분야 질문, 답변 리스트.xlsb")
    profile_csv("master.csv",
                ["Type", "CriticalSparePart", "CriticalEquipment", "Warehouse",
                 "SourcingGroup", "ProcurementType", "SupplierCount"],
                ["StockDept", "StockAll", "UnitCost", "LeadTimeMean", "CompletedCycles"],
                "ReceivingDate")
    profile_csv("maintenance.csv", ["MaintKind", "Factory", "Line"],
                ["StopHours", "Manpower"], "StopStart")
    profile_csv("txn_history.csv", ["SUBINV"], ["QTY_OUT", "QTY_IN"], "TXN_DATE")
