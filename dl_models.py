import os, time
os.environ["HF_HUB_CACHE"] = os.path.abspath("./models")
os.environ["HF_HUB_OFFLINE"] = "0"
os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
from huggingface_hub import snapshot_download

jobs = [
    ("BAAI/bge-m3",
     ["*.json", "*.txt", "*.model", "*.safetensors", "*.bin", "1_Pooling/*"],
     ["onnx/*", "openvino/*", "*.onnx", "*.xml", "colbert_linear.pt", "sparse_linear.pt", "imgs/*"]),
    ("cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
     ["*.json", "*.txt", "*.model", "*.safetensors", "*.bin", "1_Pooling/*"],
     ["onnx/*", "openvino/*", "*.onnx", "*.xml"]),
]
for repo, allow, ignore in jobs:
    t = time.time()
    p = snapshot_download(repo_id=repo, allow_patterns=allow, ignore_patterns=ignore)
    print(f"OK {repo} -> {p} ({time.time()-t:.0f}s)", flush=True)
print("DONE")
