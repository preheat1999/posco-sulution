"""파싱 — 문서를 '요소(element)' 리스트로 만든다. 위치 정보는 출처 표기의 원천이므로 보존한다."""
import re
from pathlib import Path
from common import normalize, table_to_markdown

CLAUSE_RE = re.compile(r"^제\s*(\d+)\s*조\s*(?:\(([^)]{1,60})\))?")
NUMBERING_RE = re.compile(r"^(\d+(?:\.\d+){0,3})[.)]?\s+\S")


def _shape_texts(shape):
    """도형 트리를 재귀 순회하며 (종류, 텍스트) 를 뽑는다."""
    out = []
    if shape.shape_type == 6 and hasattr(shape, "shapes"):  # GROUP
        for s in shape.shapes:
            out.extend(_shape_texts(s))
        return out
    if getattr(shape, "has_table", False):
        rows = [[c.text for c in row.cells] for row in shape.table.rows]
        md = table_to_markdown(rows)
        if md:
            out.append(("table", md))
        return out
    if getattr(shape, "has_text_frame", False):
        t = normalize(shape.text_frame.text)
        if t:
            out.append(("text", t))
    return out


def parse_pptx(path: Path):
    from pptx import Presentation
    prs = Presentation(str(path))
    elements = []
    for i, slide in enumerate(prs.slides, start=1):
        title = ""
        try:
            if slide.shapes.title is not None:
                title = normalize(slide.shapes.title.text).replace("\n", " ")
        except Exception:
            title = ""
        parts = []
        for shape in slide.shapes:
            try:
                parts.extend(_shape_texts(shape))
            except Exception:
                continue
        try:
            notes = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ""
        except Exception:
            notes = ""
        body = "\n".join(t for _, t in parts)
        if normalize(notes):
            body = (body + "\n" + normalize(notes)).strip()
        elements.append({
            "kind": "slide",
            "text": body,
            "location": {"slide": i, "slide_title": title, "slide_end": i},
            "low_quality": len(body) < 30,
        })
    return elements


def parse_docx(path: Path):
    import docx
    d = docx.Document(str(path))
    elements, section_path, clause = [], [], None
    body = d.element.body
    para_map = {p._p: p for p in d.paragraphs}
    tbl_map = {t._tbl: t for t in d.tables}
    for child in body.iterchildren():
        if child in para_map:
            p = para_map[child]
            t = normalize(p.text)
            if not t:
                continue
            style = (p.style.name or "") if p.style is not None else ""
            level = None
            m = re.match(r"(?:Heading|제목)\s*(\d+)", style)
            if m:
                level = int(m.group(1))
            elif NUMBERING_RE.match(t) and len(t) < 80:
                level = NUMBERING_RE.match(t).group(1).count(".") + 1
            cm = CLAUSE_RE.match(t)
            if cm:
                clause = f"제{cm.group(1)}조" + (f"({cm.group(2)})" if cm.group(2) else "")
            if level:
                section_path = section_path[: level - 1] + [t]
            elements.append({
                "kind": "heading" if level else "paragraph",
                "level": level,
                "text": t,
                "location": {"section_path": list(section_path), "clause": clause},
                "low_quality": False,
            })
        elif child in tbl_map:
            tb = tbl_map[child]
            md = table_to_markdown([[c.text for c in row.cells] for row in tb.rows])
            if md:
                elements.append({
                    "kind": "table", "level": None, "text": md,
                    "location": {"section_path": list(section_path), "clause": clause},
                    "low_quality": False,
                })
    return elements


def parse_pdf(path: Path):
    elements = []
    try:
        import pdfplumber
        with pdfplumber.open(str(path)) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                t = normalize(page.extract_text() or "")
                elements.append({"kind": "page", "text": t,
                                 "location": {"page": i, "page_end": i},
                                 "low_quality": len(t) < 30})
        if any(e["text"] for e in elements):
            return elements
    except Exception:
        elements = []
    import fitz
    doc = fitz.open(str(path))
    for i, page in enumerate(doc, start=1):
        t = normalize(page.get_text())
        elements.append({"kind": "page", "text": t,
                         "location": {"page": i, "page_end": i},
                         "low_quality": len(t) < 30})
    return elements


def parse_xlsx(path: Path):
    import openpyxl
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    elements = []
    for ws in wb.worksheets:
        for r, row in enumerate(ws.iter_rows(values_only=True), start=1):
            cells = ["" if c is None else str(c) for c in row]
            if not any(c.strip() for c in cells):
                continue
            elements.append({"kind": "row", "text": None, "cells": cells,
                             "location": {"sheet": ws.title, "row": r, "row_end": r},
                             "low_quality": False})
    wb.close()
    return elements


def parse_xlsb(path: Path):
    from pyxlsb import open_workbook
    elements = []
    with open_workbook(str(path)) as wb:
        for name in wb.sheets:
            with wb.get_sheet(name) as sheet:
                for r, row in enumerate(sheet.rows(), start=1):
                    cells = ["" if c.v is None else str(c.v) for c in row]
                    if not any(c.strip() for c in cells):
                        continue
                    elements.append({"kind": "row", "text": None, "cells": cells,
                                     "location": {"sheet": name, "row": r, "row_end": r},
                                     "low_quality": False})
    return elements


def convert_legacy(path: Path, outdir: Path):
    """레거시 .ppt/.doc → .pptx/.docx (MS Office COM). 실패하면 None."""
    outdir.mkdir(parents=True, exist_ok=True)
    target = outdir / (path.stem + (".pptx" if path.suffix.lower() == ".ppt" else ".docx"))
    if target.exists():
        return target
    try:
        import win32com.client as win32
        if path.suffix.lower() == ".ppt":
            app = win32.Dispatch("PowerPoint.Application")
            pres = app.Presentations.Open(str(path.resolve()), WithWindow=False)
            pres.SaveAs(str(target.resolve()), 24)  # ppSaveAsOpenXMLPresentation
            pres.Close(); app.Quit()
        else:
            app = win32.Dispatch("Word.Application")
            app.Visible = False
            doc = app.Documents.Open(str(path.resolve()))
            doc.SaveAs(str(target.resolve()), 16)  # wdFormatXMLDocument
            doc.Close(); app.Quit()
        return target if target.exists() else None
    except Exception:
        return None


PARSERS = {"pptx": parse_pptx, "docx": parse_docx, "pdf": parse_pdf,
           "xlsx": parse_xlsx, "xlsb": parse_xlsb}
