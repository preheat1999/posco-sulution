import os, time
os.environ["HF_HUB_CACHE"] = os.path.abspath("./models")
os.environ["HF_HUB_OFFLINE"] = "1"
from sentence_transformers import SentenceTransformer, CrossEncoder

t=time.time(); m = SentenceTransformer("BAAI/bge-m3"); print(f"bge-m3 loaded {time.time()-t:.1f}s")
v = m.encode(["자재 입하 검수 절차"], normalize_embeddings=True)
print("dim:", v.shape[1], "norm:", round(float((v[0]**2).sum()**0.5),4))
t=time.time(); ce = CrossEncoder("cross-encoder/mmarco-mMiniLMv2-L12-H384-v1", max_length=512); print(f"reranker loaded {time.time()-t:.1f}s")
print("score:", ce.predict([("자재 입하 검수 절차", "기자재반입센터 검사작업 지침에 따라 입하 자재를 검수한다")]))
t=time.time(); m.encode(["테스트 질의"], normalize_embeddings=True); print(f"query encode {time.time()-t:.2f}s")
