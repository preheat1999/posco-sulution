"""config.yaml + .env 로더. cfg.get("retrieval.top_k") 처럼 점 표기로 접근한다."""
import os
from pathlib import Path
import yaml
from dotenv import load_dotenv

load_dotenv()
_ROOT = Path(__file__).resolve().parent.parent


class Config:
    def __init__(self, path=None):
        p = Path(path) if path else _ROOT / "config" / "config.yaml"
        self._d = yaml.safe_load(p.read_text(encoding="utf-8"))
        if self.get("embedding.provider") != "local":
            raise RuntimeError("embedding.provider 는 local 이어야 한다 (외부 임베딩 금지)")

    def get(self, dotted, default=None):
        cur = self._d
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur

    def path(self, dotted):
        return _ROOT / self.get(dotted)


cfg = Config()
ROOT = _ROOT


def env(name, default=None):
    return os.environ.get(name, default)
