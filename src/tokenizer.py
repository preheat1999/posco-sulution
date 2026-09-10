"""BM25 토크나이저 — 색인과 질의가 반드시 같은 함수를 쓴다 (10절)."""
import re
from kiwipiepy import Kiwi

KEEP_POS = {"NNG", "NNP", "NNB", "NR", "SL", "SN", "VV", "VA", "XR"}
# 형태소 분석기가 쪼개면 검색이 안 되는 것들 — 정규식으로 원형을 함께 보존한다
CODE_RE = re.compile(r"\bQ[A-Z]?\d{6,8}\b", re.I)
SYSTEM_RE = re.compile(
    r"(POS-Appia|e-Pro\s?4\.0|e-Pro|MRO\s+e-Catalog|e-Catalog|VMI|SCC|CONSIGNMENT|ERP|MES)",
    re.I)
ALNUM_RE = re.compile(r"\b[A-Za-z]+(?:[-.][A-Za-z0-9]+)+\b")

_kiwi = None


def _get_kiwi():
    global _kiwi
    if _kiwi is None:
        _kiwi = Kiwi()
    return _kiwi


def tokenize(text: str):
    if not text:
        return []
    toks = []
    for m in CODE_RE.finditer(text):
        toks.append(m.group(0).lower())
    for m in SYSTEM_RE.finditer(text):
        toks.append(re.sub(r"\s+", " ", m.group(0)).lower())
    for m in ALNUM_RE.finditer(text):
        toks.append(m.group(0).lower())
    for tok in _get_kiwi().tokenize(text):
        if tok.tag in KEEP_POS:
            toks.append(tok.form.lower())
    return toks
