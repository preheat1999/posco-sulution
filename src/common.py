"""공통 유틸 — 파일명 메타데이터, 문서 유형 분류, 텍스트 정규화."""
import hashlib, re, unicodedata
from pathlib import Path

# 01_색인구축_프롬프트.md 5절 — 위에서부터 우선 적용
CATEGORY_RULES = [
    ("contract",  ["계약서", "약관", "계약지침", "입찰유의서", "협약", "비밀유지", "하도급",
                   "특별약정", "code of conduct"]),
    ("faq",       ["faq", "질의응답", "질문", "q&a", "포스위키"]),
    ("glossary",  ["용어사전", "용어집"]),
    ("manual",    ["매뉴얼", "메뉴얼", "가이드북", "사용자", "가이드라인", "가이드"]),
    ("guideline", ["지침", "기준", "규정", "제도", "프로세스", "표준화"]),
    ("training",  ["교육", "필독서", "자료"]),
    ("report",    ["결과", "시나리오", "개선", "안)"]),
]

CATEGORY_KO = {"contract": "계약", "faq": "FAQ", "glossary": "용어",
               "manual": "매뉴얼", "guideline": "지침", "training": "교육",
               "report": "보고", "other": "문서"}

# 유형 → 청킹 전략 (6절)
STRATEGY = {"contract": "clause", "faq": "qa_pair", "glossary": "record",
            "manual": "slide", "guideline": "section", "training": "page",
            "report": "slide", "other": "recursive"}

FNAME_RE = re.compile(r"^(?P<date>\d{6,8})?_?(?P<grade>A\d)?_?(?P<dept>[^_]+)?_?(?P<title>.+)$")
BULLET_RE = re.compile(r"^[\s\u00a0]*[•·▪◦○●■□▶►*\-–—※]+[\s\u00a0]*")


def classify(file_name: str) -> str:
    low = file_name.lower()
    for cat, keys in CATEGORY_RULES:
        if any(k in low for k in keys):
            return cat
    return "other"


def parse_date(raw: str):
    """6자리(YYMMDD) 또는 8자리(YYYYMMDD) → ISO 날짜."""
    if not raw:
        return None
    if len(raw) == 6:
        yy = int(raw[:2])
        year = 2000 + yy if yy < 90 else 1900 + yy
        mm, dd = raw[2:4], raw[4:6]
    elif len(raw) == 8:
        year, mm, dd = int(raw[:4]), raw[4:6], raw[6:8]
    else:
        return None
    if not ("01" <= mm <= "12" and "01" <= dd <= "31"):
        return None
    return f"{year:04d}-{mm}-{dd}"


def file_meta(path: Path) -> dict:
    stem = path.stem
    m = FNAME_RE.match(stem)
    d = m.groupdict() if m else {}
    date = parse_date(d.get("date") or "")
    dept = d.get("dept")
    title = d.get("title") or stem
    # date/grade/dept 가 없는 파일명은 통째로 title 로 본다
    if not date and not d.get("grade"):
        dept, title = None, stem
    return {
        "file_name": path.name,
        "title": title,
        "doc_category": classify(path.name),
        "file_type": path.suffix.lower().lstrip("."),
        "date": date,
        "dept": dept,
    }


def doc_id_of(path: Path) -> str:
    """doc_id = SHA1(파일명)[:12].

    ★ 색인구축 프롬프트 4절은 "파일 내용의 SHA256 앞 12자"라고 적고 있으나,
      Qdrant 색인의 실제 doc_id 30건과 대조한 결과 파일명의 SHA1 앞 12자였다.
      (파일 내용 해시로는 30건 전부 불일치, 파일명 SHA1 로는 30건 전부 일치)
      색인과 연결하려면 이 방식을 따라야 한다."""
    return hashlib.sha1(path.name.encode("utf-8")).hexdigest()[:12]


def normalize(text: str) -> str:
    """NFKC 정규화 · 불릿 제거 · 공백 연속 축약."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u200b", "")
    lines = []
    for ln in text.split("\n"):
        ln = BULLET_RE.sub("", ln)
        ln = re.sub(r"[ \t\u00a0]+", " ", ln).strip()
        if ln:
            lines.append(ln)
    return "\n".join(lines)


def table_to_markdown(rows) -> str:
    rows = [[normalize(c).replace("\n", " ") for c in r] for r in rows]
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |",
           "| " + " | ".join(["---"] * width) + " |"]
    out += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(out)
