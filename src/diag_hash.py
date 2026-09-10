import hashlib, json, os, unicodedata
from pathlib import Path
from dotenv import load_dotenv; load_dotenv()
from qdrant_client import QdrantClient

c = QdrantClient(url=os.environ["QDRANT_URL"], api_key=os.environ["QDRANT_API_KEY"], timeout=60)
pts, off = [], None
while True:
    b, off = c.scroll("material_rag", limit=1000, offset=off, with_payload=True, with_vectors=False)
    pts.extend(b)
    if off is None: break
target = {p.payload["doc_id"] for p in pts}

algos = {"md5": hashlib.md5, "sha1": hashlib.sha1, "sha256": hashlib.sha256,
         "sha512": hashlib.sha512, "blake2b": hashlib.blake2b}

def variants(p: Path):
    yield "name", p.name
    yield "stem", p.stem
    yield "name_nfc", unicodedata.normalize("NFC", p.name)
    yield "name_nfd", unicodedata.normalize("NFD", p.name)
    yield "stem_nfc", unicodedata.normalize("NFC", p.stem)
    yield "name_lower", p.name.lower()
    yield "posix", p.as_posix()
    yield "abs", str(p.resolve())
    yield "rel_raw", f"raw/{p.name}"

hits = {}
files = sorted(Path("raw").iterdir())
for p in files:
    data = p.read_bytes()
    for an, af in algos.items():
        for n in (8, 12, 16):
            if af(data).hexdigest()[:n] in target:
                hits.setdefault(f"bytes|{an}|{n}", []).append(p.name)
    for vn, v in variants(p):
        for an, af in algos.items():
            h = af(v.encode("utf-8")).hexdigest()
            for n in (8, 12, 16):
                if h[:n] in target:
                    hits.setdefault(f"{vn}|{an}|{n}", []).append(p.name)

if hits:
    for k, v in sorted(hits.items(), key=lambda x: -len(x[1])):
        print(f"{k}: {len(v)}건 매칭")
        for n in v[:3]: print("   ", n[:55])
else:
    print("문자열/바이트 해시 후보 전부 불일치 — doc_id 산출 방식이 파일 자체와 무관")
