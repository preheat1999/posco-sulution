import sys, uvicorn
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    uvicorn.run("api:app", host=host, port=8000, log_level="info")
