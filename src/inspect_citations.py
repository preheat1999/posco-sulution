"""데모 질문의 인용 근거를 자세히 본다 (후보 구성 확인용)."""
import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()
H = {"X-API-Token": os.environ.get("RAG_API_TOKEN", "")}
QS = sys.argv[1:] or ["자재 입하 검수 절차가 어떻게 되나요?",
                      "표준하도급계약서의 지체상금 기준을 알려주세요.",
                      "POS-Appia 물품등록이 반려됐는데 어떻게 해야 하나요?"]

for q in QS:
    d = httpx.post("http://127.0.0.1:8000/api/chat",
                   json={"question": q, "history": []}, headers=H, timeout=180).json()
    print("=" * 76)
    print("Q:", q)
    print(f"  {d['metrics']['total_ms']}ms · 인용 {len(d['citations'])}건 "
          f"· 인용률 {d['metrics'].get('citation_coverage', 0):.0%}")
    for c in d["citations"]:
        print(f"  [{c['index']}] score={c['score']:7.3f}  {c['source'][:74]}")
