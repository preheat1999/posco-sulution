"""FAQ 엑셀(포스위키) 전용 파싱·청킹 — 7절 화이트리스트를 엄격히 지킨다.

★ 등록자정보·등록일·ITEMID·순번(NO)·전문가구분은 **색인 자체에 넣지 않는다.**
  개인정보를 애초에 들이지 않는 것이 마스킹보다 안전하다.
"""
import re
from common import normalize

ROLE_COL, TITLE_COL, CONTENT_COL = "질문/답변", "제목", "내용"
CONTEXT_COLS = ["지역", "분류", "분류1", "분류2", "LEVEL2", "LEVEL3",
                "기술주제별분포", "설비구분", "상세구분", "Q코드",
                "혜정 자체 대분류", "혜정 자체 중분류", "대분류(AI)", "중분류(AI)"]
# 화이트리스트에 없는 것은 전부 버린다 (아래는 확인된 실제 컬럼명)
EXCLUDE_COLS = {"등록자정보", "등록일", "ITEMID", "순번", "NO", "전문가구분"}
MAX_ANSWERS = 5


def _find_header(rows, max_scan=6):
    for i, row in enumerate(rows[:max_scan]):
        vals = [str(c).strip() if c is not None else "" for c in row]
        if ROLE_COL in vals and CONTENT_COL in vals and TITLE_COL in vals:
            return i, vals
    return None, None


def _sheet_rows_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    for ws in wb.worksheets:
        yield ws.title, [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()


def _sheet_rows_xlsb(path):
    from pyxlsb import open_workbook
    with open_workbook(str(path)) as wb:
        for name in wb.sheets:
            with wb.get_sheet(name) as sh:
                rows = []
                for r in sh.rows():
                    rows.append([c.v for c in r])
                yield name, rows


def parse_faq(path):
    """(sheet, row_no, {col: value}) 목록. 화이트리스트 컬럼만 남긴다."""
    reader = _sheet_rows_xlsb if path.suffix.lower() == ".xlsb" else _sheet_rows_xlsx
    sheets = list(reader(path))
    # 'raw' 시트가 있으면 그 시트만 쓴다 (대소문자 무시).
    # 이 통합문서들은 같은 데이터를 여러 시트에 복제해 두었다
    # (예: 질의응답·정리·raw·카테고리 분류가 모두 4156행으로 동일).
    # 사본을 함께 넣으면 근사중복 청크가 후보를 잠식해 근거 다양성이 떨어지고,
    # 시트명이 실명인 경우(이예열사원 등) 출처 표기에 개인정보가 들어간다.
    raw_sheets = [(n, r) for n, r in sheets if n.strip().lower() == "raw"]
    if raw_sheets:
        sheets = raw_sheets

    out = []
    for name, rows in sheets:
        hi, header = _find_header(rows)
        if hi is None:
            continue                      # 피벗 등 헤더가 없는 시트는 건너뛴다
        keep = {}
        for j, h in enumerate(header):
            h = (h or "").strip()
            if not h or h in EXCLUDE_COLS:
                continue
            if h in (ROLE_COL, TITLE_COL, CONTENT_COL) or h in CONTEXT_COLS:
                keep[j] = h
        for ri in range(hi + 1, len(rows)):
            row = rows[ri]
            rec = {}
            for j, h in keep.items():
                v = row[j] if j < len(row) else None
                if v is None:
                    continue
                v = normalize(str(v))
                if v:
                    rec[h] = v
            if rec.get(TITLE_COL) and rec.get(CONTENT_COL):
                out.append((name, ri + 1, rec))
    return out


def chunk_faq(records, meta):
    """제목을 키로 질문 행과 답변 행을 하나의 청크로 병합한다 (qa_pair)."""
    from chunker import context_header, MIN_KEEP_CHARS
    # ★ 제목이 같은 행을 전부 묶지 않고 **연속된 행**만 하나의 스레드로 묶는다.
    #   서로 다른 시점의 문의가 같은 제목을 쓰는 경우가 있어, 전역으로 묶으면
    #   무관한 질의응답이 한 청크에 섞여 검색 정밀도가 떨어진다.
    groups, prev = [], None
    for sheet, row, rec in records:
        key = (sheet, rec[TITLE_COL])
        if key != prev:
            groups.append({"sheet": sheet, "title": rec[TITLE_COL],
                           "rows": [], "ctx": {}, "q": [], "a": []})
            prev = key
        g = groups[-1]
        g["rows"].append(row)
        for c in CONTEXT_COLS:
            if c in rec and c not in g["ctx"]:
                g["ctx"][c] = rec[c]
        role = rec.get(ROLE_COL, "")
        (g["q"] if "질문" in role else g["a"]).append(rec[CONTENT_COL])

    out = []
    for g in groups:
        sheet, title = g["sheet"], g["title"]
        parts = [f"제목: {title}"]
        if g["ctx"]:
            parts.append(" · ".join(f"{k}: {v}" for k, v in g["ctx"].items()))
        for q in g["q"][:1]:
            parts.append(f"질문: {q}")
        for i, a in enumerate(g["a"][:MAX_ANSWERS], start=1):
            parts.append(f"답변{i}: {a}" if len(g["a"]) > 1 else f"답변: {a}")
        raw = "\n".join(parts).strip()
        if len(raw) < MIN_KEEP_CHARS:
            continue
        loc = {"sheet": sheet, "row": min(g["rows"]), "row_end": max(g["rows"])}
        out.append({"raw_text": raw, "text": context_header(meta, loc) + "\n" + raw,
                    "location": loc, "strategy": "qa_pair", "n_chars": len(raw)})
    return out
