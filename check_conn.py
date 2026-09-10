import os, json, httpx
from dotenv import load_dotenv
load_dotenv()

print("=== 1) Qdrant ===")
try:
    from qdrant_client import QdrantClient
    c = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=60)
    info = c.get_collection("material_rag")
    print("points_count:", info.points_count)
    print("status:", info.status)
    cfg = info.config.params.vectors
    print("vectors:", {k: (v.size, v.distance) for k, v in cfg.items()} if isinstance(cfg, dict) else cfg)
except Exception as e:
    print("QDRANT_FAIL:", type(e).__name__, str(e)[:300])

print("\n=== 2) OpenRouter ===")
try:
    r = httpx.post("https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
                 "Content-Type": "application/json"},
        json={"model": "google/gemini-3.1-flash-lite",
              "messages": [{"role": "user", "content": "ping"}],
              "max_tokens": 5, "temperature": 0},
        timeout=60)
    print("HTTP", r.status_code)
    print(r.text[:400])
except Exception as e:
    print("LLM_FAIL:", type(e).__name__, str(e)[:300])
