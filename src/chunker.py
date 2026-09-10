"""청킹 — 문서 유형별 전략. chunk_id 는 문서 단위 순번이며 중복 제거 후 재부여하지 않는다."""
import hashlib, re
from common import CATEGORY_KO, normalize

CHUNK_SIZE, CHUNK_OVERLAP = 800, 150
MIN_CHUNK_SIZE, MAX_CHUNK_SIZE, MIN_KEEP_CHARS = 50, 2000, 15
SEPARATORS = ["\n\n", "\n", ". ", " "]


def context_header(meta: dict, location: dict) -> str:
    """[문서] 제목 (유형) / [슬라이드 N] 제목  — text 앞에만 붙이고 raw_text 에는 넣지 않는다."""
    lines = [f"[문서] {meta['title']} ({CATEGORY_KO.get(meta['doc_category'], '문서')})"]
    if location.get("slide") is not None:
        t = location.get("slide_title") or ""
        lines.append(f"[슬라이드 {location['slide']}]" + (f" {t}" if t else ""))
    elif location.get("page") is not None:
        lines.append(f"[페이지 {location['page']}]")
    elif location.get("sheet") is not None:
        lines.append(f"[{location['sheet']} 행 {location.get('row')}]")
    elif location.get("clause"):
        lines.append(f"[{location['clause']}]")
    elif location.get("section_path"):
        lines.append("[" + " > ".join(location["section_path"][-2:]) + "]")
    return "\n".join(lines)


def recursive_split(text, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP, seps=SEPARATORS):
    if len(text) <= size:
        return [text] if text.strip() else []
    sep = next((s for s in seps if s in text), None)
    if sep is None:
        return [text[i:i + size] for i in range(0, len(text), size - overlap)]
    parts, buf, out = text.split(sep), "", []
    for p in parts:
        cand = (buf + sep + p) if buf else p
        if len(cand) <= size:
            buf = cand
        else:
            if buf:
                out.append(buf)
            buf = p if len(p) <= size else ""
            if len(p) > size:
                out.extend(recursive_split(p, size, overlap, seps[seps.index(sep) + 1:]))
    if buf:
        out.append(buf)
    return [c for c in out if c.strip()]


def _pack(raw_text, location, strategy, meta):
    raw_text = raw_text.strip()
    if len(raw_text) < MIN_KEEP_CHARS:
        return None
    header = context_header(meta, location)
    return {"raw_text": raw_text, "text": header + "\n" + raw_text,
            "location": location, "strategy": strategy, "n_chars": len(raw_text)}


def chunk_by_slide(elements, meta, strategy="slide"):
    out = []
    for e in elements:
        c = _pack(e["text"], e["location"], strategy, meta)
        if c:
            out.append(c)
    return out


def chunk_by_page(elements, meta):
    return chunk_by_slide(elements, meta, strategy="page")


def chunk_by_clause(elements, meta):
    """제N조 단위로 묶는다. 조 앞의 서두는 별도 청크."""
    out, buf, loc = [], [], None
    for e in elements:
        cl = e["location"].get("clause")
        if cl != (loc.get("clause") if loc else None):
            if buf:
                c = _pack("\n".join(buf), loc, "clause", meta)
                if c:
                    out.append(c)
            buf, loc = [], dict(e["location"])
        buf.append(e["text"])
        if loc is None:
            loc = dict(e["location"])
    if buf:
        c = _pack("\n".join(buf), loc, "clause", meta)
        if c:
            out.append(c)
    # 조가 지나치게 길면 폴백 분할
    final = []
    for c in out:
        if len(c["raw_text"]) > MAX_CHUNK_SIZE:
            for piece in recursive_split(c["raw_text"]):
                p = _pack(piece, c["location"], "clause", meta)
                if p:
                    final.append(p)
        else:
            final.append(c)
    return final


def chunk_by_section(elements, meta):
    """제목 계층 단위. 제목이 전혀 없으면 recursive 로 폴백."""
    if not any(e.get("level") for e in elements):
        return chunk_recursive(elements, meta)
    out, buf, loc = [], [], None
    for e in elements:
        if e.get("level") and buf:
            c = _pack("\n".join(buf), loc, "section", meta)
            if c:
                out.append(c)
            buf, loc = [], dict(e["location"])
        if loc is None:
            loc = dict(e["location"])
        buf.append(e["text"])
    if buf:
        c = _pack("\n".join(buf), loc, "section", meta)
        if c:
            out.append(c)
    final = []
    for c in out:
        if len(c["raw_text"]) > MAX_CHUNK_SIZE:
            for piece in recursive_split(c["raw_text"]):
                p = _pack(piece, c["location"], "section", meta)
                if p:
                    final.append(p)
        else:
            final.append(c)
    return final


def chunk_recursive(elements, meta):
    out = []
    for e in elements:
        txt = e.get("text") or ""
        loc = e["location"]
        for piece in (recursive_split(txt) if len(txt) > CHUNK_SIZE else ([txt] if txt else [])):
            c = _pack(piece, loc, "recursive", meta)
            if c:
                out.append(c)
    return out


def assign_ids(chunks, doc_id, meta):
    """★ 순번은 문서 단위 0부터. 중복 제거 뒤 재부여하지 않는다."""
    out = []
    for i, c in enumerate(chunks):
        out.append({
            "chunk_id": f"{doc_id}-c{i:05d}",
            "doc_id": doc_id,
            "text": c["text"],
            "raw_text": c["raw_text"],
            "metadata": {**{k: meta[k] for k in
                            ("file_name", "title", "doc_category", "file_type", "date", "dept")},
                         "location": c["location"],
                         "strategy": c["strategy"],
                         "n_chars": c["n_chars"]},
        })
    return out


def dedup_hash(raw_text: str) -> str:
    s = re.sub(r"\s+", " ", raw_text).strip().lower()
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def deduplicate(all_chunks):
    """문서 내 중복: 전 유형. 문서 간 중복: faq·glossary 만 (계약서는 절대 제외)."""
    seen_global, out, n_in, n_cross = set(), [], 0, 0
    by_doc = {}
    for c in all_chunks:
        by_doc.setdefault(c["doc_id"], []).append(c)
    for doc_id, chunks in by_doc.items():
        seen_local = set()
        cat = chunks[0]["metadata"]["doc_category"]
        for c in chunks:
            if len(c["raw_text"]) < 40:
                out.append(c)
                continue
            h = dedup_hash(c["raw_text"])
            if h in seen_local:
                n_in += 1
                continue
            seen_local.add(h)
            if cat in ("faq", "glossary"):
                if h in seen_global:
                    n_cross += 1
                    continue
                seen_global.add(h)
            out.append(c)
    return out, n_in, n_cross


CHUNKERS = {"slide": chunk_by_slide, "page": chunk_by_page, "clause": chunk_by_clause,
            "section": chunk_by_section, "record": chunk_recursive,
            "recursive": chunk_recursive}
