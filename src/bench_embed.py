import json, os, time
os.environ["HF_HUB_CACHE"] = os.path.abspath("./models"); os.environ["HF_HUB_OFFLINE"] = "1"
from sentence_transformers import SentenceTransformer
chunks = [json.loads(l) for l in open("data/chunks/chunks.jsonl", encoding="utf-8")]
m = SentenceTransformer("BAAI/bge-m3")
m.encode(["예열"], normalize_embeddings=True, show_progress_bar=False)
for bs in (16, 32):
    texts = [c["text"] for c in chunks[:96]]
    t = time.time()
    m.encode(texts, batch_size=bs, normalize_embeddings=True, show_progress_bar=False)
    dt = time.time() - t
    print(f"batch={bs}: {len(texts)}청크 {dt:.1f}초 → {len(texts)/dt:.2f} chunk/s")
    print(f"   1,205청크 예상 {1205/(len(texts)/dt)/60:.1f}분 · 6,901청크 예상 {6901/(len(texts)/dt)/60:.1f}분")
