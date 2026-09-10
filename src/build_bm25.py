"""로컬 BM25 색인 생성 (10절). 색인 대상은 청크의 text 필드(문맥 헤더 포함)."""
import json, math, sys, time
from collections import Counter, defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from tokenizer import tokenize, KEEP_POS

K1, B = 1.2, 0.75


def main():
    t0 = time.time()
    chunks = [json.loads(l) for l in open("data/chunks/chunks.jsonl", encoding="utf-8")]
    vocab, postings, doc_len, df = {}, defaultdict(list), {}, Counter()
    for i, ch in enumerate(chunks):
        toks = tokenize(ch["text"])
        doc_len[ch["chunk_id"]] = len(toks)
        tf = Counter(toks)
        for tok, f in tf.items():
            tid = vocab.setdefault(tok, len(vocab))
            postings[tid].append([ch["chunk_id"], f])
            df[tid] += 1
        if (i + 1) % 200 == 0:
            print(f"  {i+1}/{len(chunks)} ({time.time()-t0:.0f}s)", flush=True)

    n = len(chunks)
    idf = {str(t): math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}
    avgdl = sum(doc_len.values()) / n if n else 0
    out = {"k1": K1, "b": B, "avgdl": avgdl, "n_docs": n,
           "tokenizer": {"mode": "kiwi", "keep_pos": sorted(KEEP_POS)},
           "vocab": vocab, "idf": idf,
           "doc_len": doc_len,
           "postings": {str(k): v for k, v in postings.items()}}
    Path("data/index").mkdir(parents=True, exist_ok=True)
    Path("data/index/bm25_index.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"\n청크 {n} · 어휘 {len(vocab)} · avgdl {avgdl:.1f} · {time.time()-t0:.0f}초")
    print(f"파일 크기 {Path('data/index/bm25_index.json').stat().st_size/1e6:.1f}MB")


if __name__ == "__main__":
    main()
