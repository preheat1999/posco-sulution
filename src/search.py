"""dense + BM25 → RRF 융합 → 카테고리 가중 → 하이드레이션."""
import logging
from config import cfg

log = logging.getLogger(__name__)


def rrf_fuse(rankings, k=10):
    """점수 스케일이 다르므로 순위만 쓴다 (원점수를 더하지 마라)."""
    fused = {}
    for ranking in rankings:
        for rank, (chunk_id, _score) in enumerate(ranking):
            fused[chunk_id] = fused.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(fused.items(), key=lambda x: -x[1])


class Searcher:
    def __init__(self, store, bm25, embedder=None, vectorstore=None):
        self.store, self.bm25 = store, bm25
        self.embedder, self.vs = embedder, vectorstore

    @property
    def mode(self):
        if cfg.get("retrieval.mode") == "hybrid" and self.vs is not None and self.vs.reachable:
            return "hybrid"
        return "bm25"

    def dense_doc_ranks(self, query_vector):
        """dense 히트에서 doc_id 만 뽑아 문서 순위를 만든다.

        ★ chunk_id 는 쓰지 않는다. 색인의 청크 경계가 로컬과 달라 번호가 밀려 있어
          chunk_id 로 본문을 채우면 같은 문서의 다른 위치가 채워진다(정합 20%).
          doc_id 는 파일명 SHA1 이라 30/30 일치하므로 문서 신호는 신뢰할 수 있다."""
        hits = self.vs.search(query_vector, limit=cfg.get("retrieval.doc_gate.dense_limit"))
        ranks = {}
        for chunk_id, _score in hits:
            doc_id = chunk_id.rsplit("-c", 1)[0]
            # 로컬에 청크가 없는 문서(1파의 FAQ 엑셀)는 게이트 슬롯을 낭비하므로 건너뛴다.
            # 2파에서 그 문서들이 들어오면 자동으로 게이트에 참여한다.
            if doc_id not in self.store.doc_ids:
                continue
            if doc_id not in ranks:
                ranks[doc_id] = len(ranks)          # 최초 등장 순서 = 문서 순위
        top = cfg.get("retrieval.doc_gate.doc_top")
        return {d: r for d, r in ranks.items() if r < top}

    def retrieve(self, query, query_vector=None):
        k = cfg.get("retrieval.rrf_k")
        bm25_hits = self.bm25.search(query, limit=max(cfg.get("retrieval.bm25_limit"), 300))
        bm25_rank = {cid: i for i, (cid, _s) in enumerate(bm25_hits)}

        doc_ranks = {}
        if (self.mode == "hybrid" and query_vector is not None
                and cfg.get("retrieval.doc_gate.enabled")):
            doc_ranks = self.dense_doc_ranks(query_vector)

        # ★ 문서 가중은 곱셈으로 넣는다.
        #   덧셈으로 주면 상위 문서의 '모든' 청크가 같은 가산점을 받아, 청크가 많은 문서
        #   하나가 후보를 전부 차지하고 다른 문서의 정답 청크를 밀어낸다(실측 확인).
        #   곱셈은 BM25 가 매긴 관련도 순서를 보존한 채 문서만 끌어올린다.
        w = cfg.get("retrieval.doc_gate.doc_weight")
        fused_scores = {}
        for cid, r in bm25_rank.items():
            s = 1.0 / (k + r + 1)
            c = self.store.get(cid)
            if c is not None:
                dr = doc_ranks.get(c["doc_id"])
                if dr is not None:
                    s *= 1.0 + w / (1.0 + dr)
            fused_scores[cid] = s
        fused = sorted(fused_scores.items(), key=lambda x: -x[1])
        self.last_doc_ranks = doc_ranks

        # 카테고리 가중
        if cfg.get("retrieval.category_weights.enabled"):
            weights = cfg.get("retrieval.category_weights.weights") or {}
            default = cfg.get("retrieval.category_weights.default_weight")
            scored = []
            for cid, s in fused:
                c = self.store.get(cid)
                cat = c["metadata"]["doc_category"] if c else None
                scored.append((cid, s * weights.get(cat, default)))
            fused = sorted(scored, key=lambda x: -x[1])

        candidate_k = cfg.get("retrieval.candidate_k")
        candidates = fused[:candidate_k]

        # 비-FAQ 후보 최소 보장.
        # ★ FAQ 청크가 코퍼스의 83%(5,756/6,928)라 상위 후보를 통째로 잠식한다.
        #   실제로 "자재 입하 검수 절차" 에서 지침 문서가 FAQ 에 밀려났다.
        #   지침·계약·매뉴얼이 최소 몇 건은 후보에 남도록 하위 FAQ 와 교체한다.
        min_non_faq = cfg.get("retrieval.category_weights.min_non_faq_candidates") or 0
        if min_non_faq:
            def is_faq(cid):
                c = self.store.get(cid)
                return bool(c) and c["metadata"]["doc_category"] == "faq"

            n_non_faq = sum(1 for cid, _ in candidates if not is_faq(cid))
            if n_non_faq < min_non_faq:
                need = min_non_faq - n_non_faq
                chosen = set(cid for cid, _ in candidates)
                extra = [(cid, s) for cid, s in fused[candidate_k:]
                         if cid not in chosen and not is_faq(cid)][:need]
                if extra:
                    keep = [(cid, s) for cid, s in candidates if not is_faq(cid)]
                    faqs = [(cid, s) for cid, s in candidates if is_faq(cid)]
                    faqs = faqs[:max(0, len(faqs) - len(extra))]   # 하위 FAQ 를 덜어낸다
                    candidates = sorted(keep + faqs + extra, key=lambda x: -x[1])
                    log.info("비-FAQ 후보 %d건 보강", len(extra))

        # 하이드레이션 — 로컬에 없는 chunk_id 는 조용히 버린다
        hydrated, dropped = [], 0
        for cid, s in candidates:
            c = self.store.get(cid)
            if c is None or not c.get("raw_text"):
                dropped += 1
                continue
            hydrated.append({"chunk_id": cid, "fuse_score": s,
                             "raw_text": c["raw_text"], "text": c["text"],
                             "metadata": c["metadata"],
                             "source": self.store.source_label(cid)})
        if dropped:
            log.warning("하이드레이션 실패로 버린 후보 %d건", dropped)
        return hydrated, dropped
