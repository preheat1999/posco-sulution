"""chunks.jsonl 을 메모리 dict 로 적재 (chunk_id -> 레코드). 본문의 유일한 출처."""
import json
from config import cfg


class ChunkStore:
    def __init__(self, path=None):
        path = path or cfg.path("paths.chunks_file")
        self.by_id = {}
        self.doc_ids = set()
        with open(path, encoding="utf-8") as f:
            for line in f:
                c = json.loads(line)
                self.by_id[c["chunk_id"]] = c
                self.doc_ids.add(c["doc_id"])

    def __len__(self):
        return len(self.by_id)

    def get(self, chunk_id):
        return self.by_id.get(chunk_id)

    def source_label(self, chunk_id):
        """7절 출처 표기 — 문서 유형별로 형식이 다르다."""
        c = self.by_id.get(chunk_id)
        if not c:
            return ""
        m = c["metadata"]
        loc, fn = m.get("location") or {}, m["file_name"]
        if loc.get("slide") is not None:
            t = loc.get("slide_title")
            return f"{fn} > 슬라이드 {loc['slide']}" + (f" ({t})" if t else "")
        if loc.get("clause"):
            return f"{fn} > {loc['clause']}"
        if loc.get("page") is not None:
            return f"{fn} > p.{loc['page']}"
        if loc.get("sheet") is not None:
            return f"{fn} > 시트 {loc['sheet']} {loc.get('row')}행"
        if loc.get("section_path"):
            return f"{fn} > " + " > ".join(loc["section_path"][-2:])
        return fn
