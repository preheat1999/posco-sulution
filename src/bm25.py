"""저장된 어휘·IDF 로 BM25 점수 계산 (재계산하지 않는다)."""
import json
from collections import defaultdict
from config import cfg
from tokenize_ko import tokenize


class BM25Index:
    def __init__(self, path=None):
        d = json.loads((path or cfg.path("paths.bm25_index")).read_text(encoding="utf-8"))
        self.k1, self.b = d["k1"], d["b"]
        self.avgdl, self.n_docs = d["avgdl"], d["n_docs"]
        self.vocab, self.idf = d["vocab"], d["idf"]
        self.doc_len, self.postings = d["doc_len"], d["postings"]

    def search(self, query, limit=20):
        toks = tokenize(query)
        scores = defaultdict(float)
        for tok in set(toks):
            tid = self.vocab.get(tok)
            if tid is None:
                continue
            idf = self.idf[str(tid)]
            for chunk_id, f in self.postings[str(tid)]:
                dl = self.doc_len.get(chunk_id, self.avgdl)
                denom = f + self.k1 * (1 - self.b + self.b * dl / self.avgdl)
                scores[chunk_id] += idf * (f * (self.k1 + 1)) / denom
        return sorted(scores.items(), key=lambda x: -x[1])[:limit]
