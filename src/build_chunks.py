"""1파/2파 파싱·청킹 실행. 사용: python src/build_chunks.py [--wave 1|2]"""
import argparse, json, sys, time, traceback
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from common import file_meta, doc_id_of, STRATEGY
from parsers import PARSERS, convert_legacy
from chunker import CHUNKERS, assign_ids, deduplicate

RAW = Path("raw"); PROC = Path("data/processed"); CH = Path("data/chunks")
FAQ_EXCEL = {  # 2파에서 추가 (3절)
    "260810_설비자재구매실_구매지원 Assistant 포스위키 질의응답 내용.xlsx",
    "260128_(광양)설비기술부_포스위키 질문분류.xlsx",
    "260127_(광양)설비기술부_포스위키 생산관리분야 질문, 답변 리스트.xlsb",
}


def strategy_for(meta):
    """training 은 pdf=page / ppt=slide, guideline pptx 는 section→slide 폴백."""
    cat, ft = meta["doc_category"], meta["file_type"]
    s = STRATEGY[cat]
    if cat == "training":
        s = "page" if ft == "pdf" else "slide"
    if cat == "guideline" and ft in ("pptx", "ppt"):
        s = "slide"
    if cat == "faq" and ft in ("pptx", "ppt"):
        s = "slide"          # POS-Appia FAQ 는 PPT 다 (엑셀 qa_pair 아님)
    if ft in ("xlsx", "xlsb") and cat != "faq":
        s = "record"
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wave", type=int, default=1)
    args = ap.parse_args()
    PROC.mkdir(parents=True, exist_ok=True); CH.mkdir(parents=True, exist_ok=True)

    files = sorted(RAW.iterdir())
    if args.wave == 1:
        files = [f for f in files if f.name not in FAQ_EXCEL]

    metas = []
    for p in files:
        m = file_meta(p)
        m["path"] = p
        m["doc_id"] = doc_id_of(p)
        metas.append(m)
    # 중복 제거 시 최신본이 살아남도록: date 내림차순 → file_name 내림차순 (6절)
    metas.sort(key=lambda m: (m["date"] or "0000-00-00", m["file_name"]), reverse=True)

    all_chunks, ok, failed, report = [], [], [], []
    for m in metas:
        p, t0 = m["path"], time.time()
        ft = m["file_type"]
        try:
            if ft in ("ppt", "doc"):
                conv = convert_legacy(p, Path("data/converted"))
                if conv is None:
                    failed.append((m["file_name"], "레거시 변환 실패 (MS Office COM 없음)"))
                    continue
                p, ft = conv, conv.suffix.lstrip(".")
            elements = PARSERS[ft](p)
            strat = strategy_for(m)
            chunks = CHUNKERS[strat](elements, m)
            chunks = assign_ids(chunks, m["doc_id"], m)
            all_chunks.extend(chunks)
            ok.append(m["file_name"])
            PROC.joinpath(f"{m['doc_id']}.json").write_text(
                json.dumps({"doc_id": m["doc_id"], "file_name": m["file_name"],
                            "n_elements": len(elements),
                            "elements": [{k: v for k, v in e.items() if k != "cells"}
                                         for e in elements]},
                           ensure_ascii=False), encoding="utf-8")
            report.append({"file_name": m["file_name"], "doc_id": m["doc_id"],
                           "doc_category": m["doc_category"], "strategy": strat,
                           "n_elements": len(elements), "n_chunks": len(chunks),
                           "sec": round(time.time() - t0, 1)})
            print(f"  OK {len(chunks):5d}청크 {strat:9s} {time.time()-t0:5.1f}s  {m['file_name'][:50]}", flush=True)
        except Exception as e:
            failed.append((m["file_name"], f"{type(e).__name__}: {e}"))
            print(f"  FAIL {m['file_name'][:50]} — {type(e).__name__}: {e}", flush=True)
            traceback.print_exc(limit=2)

    kept, n_in, n_cross = deduplicate(all_chunks)
    out = CH / "chunks.jsonl"
    if args.wave == 2 and out.exists():
        pass
    with open(out, "w", encoding="utf-8") as f:
        for c in kept:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")

    by_cat = {}
    for c in kept:
        by_cat[c["metadata"]["doc_category"]] = by_cat.get(c["metadata"]["doc_category"], 0) + 1
    rep = {"wave": args.wave, "n_docs_ok": len(ok), "n_docs_failed": len(failed),
           "failed": failed, "n_chunks_before_dedup": len(all_chunks),
           "dedup_in_doc": n_in, "dedup_cross_doc": n_cross,
           "n_chunks": len(kept), "by_category": by_cat, "per_doc": report}
    (CH / "_report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n성공 {len(ok)} / 실패 {len(failed)}")
    print(f"청크 {len(all_chunks)} → 중복제거(문서내 {n_in}, 문서간 {n_cross}) → {len(kept)}")
    print("유형별:", by_cat)
    for fn, why in failed:
        print("  실패:", fn, "—", why)


if __name__ == "__main__":
    main()
