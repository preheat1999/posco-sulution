import json, fitz, docx
from pathlib import Path
p = Path("raw/설비자재구매실 필독서(전자책) (2).pdf")
d = fitz.open(str(p))
print(f"PDF 총 페이지: {d.page_count}")
empty = [i for i, pg in enumerate(d, 1) if len(pg.get_text().strip()) < 15]
print(f"  텍스트 15자 미만 페이지: {len(empty)}건 {empty[:15]}")
local = [json.loads(l) for l in open("data/chunks/chunks.jsonl", encoding="utf-8")]
mine = [c for c in local if c["metadata"]["file_name"] == p.name]
print(f"  로컬 청크 {len(mine)} / 마지막 location {mine[-1]['metadata']['location']}")

f2 = "250924_A3_설비자재구매실_포스코 표준하도급계약서(25.9월 개정Ver.).docx"
dd = docx.Document(f"raw/{f2}")
print(f"\nDOCX 단락 {len(dd.paragraphs)} / 표 {len(dd.tables)}")
mine2 = [c for c in local if c["metadata"]["file_name"] == f2]
print(f"  로컬 청크 {len(mine2)} / 마지막 clause {mine2[-1]['metadata']['location'].get('clause')}")
print(f"  첫 clause {mine2[0]['metadata']['location'].get('clause')}")
