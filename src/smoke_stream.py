"""스트리밍 엔드포인트 확인 — 이벤트가 '도착하는 시각'을 함께 본다.

한 번에 몰려서 오면(버퍼링) 진행표시로서 의미가 없으므로 경과시간을 찍는다.
"""
import json
import os
import sys
import time

import httpx
from dotenv import load_dotenv

load_dotenv()
BASE = "http://127.0.0.1:8000"
H = {"X-API-Token": os.environ.get("RAG_API_TOKEN", "")}


def run(question):
    t0 = time.time()
    n_delta, first_delta, chars, result = 0, None, 0, None
    print("=" * 72)
    print("Q:", question)
    with httpx.stream("POST", f"{BASE}/api/chat/stream",
                      json={"question": question, "history": []},
                      headers=H, timeout=180) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line.strip():
                continue
            ev = json.loads(line)
            el = time.time() - t0
            if ev["type"] == "stage":
                print(f"  [{el:6.2f}s] 단계 · {ev['name']}"
                      + (f" ({ev['ms']}ms)" if ev.get("ms") is not None else ""))
            elif ev["type"] == "delta":
                n_delta += 1
                chars += len(ev["text"])
                if first_delta is None:
                    first_delta = el
                    print(f"  [{el:6.2f}s] 첫 글자 도착")
            elif ev["type"] == "replace":
                print(f"  [{el:6.2f}s] 인용 보강으로 답변 교체")
            elif ev["type"] == "error":
                print(f"  [{el:6.2f}s] 오류: {ev['message']}")
            else:
                result = ev
                print(f"  [{el:6.2f}s] 최종 결과")
    if result is None:
        print("  !! result 이벤트 없음")
        return False
    m = result["metrics"]
    print(f"  조각 {n_delta}개 · {chars}자 · 첫 글자 {first_delta}"
          f" · 총 {m['total_ms']}ms · 인용 {len(result['citations'])}건"
          f" · no_answer={result['no_answer']}")
    print("  답변:", result["answer"][:110].replace("\n", " "))
    # 무응답처럼 한 문장짜리 답변은 조각이 1개인 것이 정상이므로 판정 대상이 아니다.
    if result["no_answer"] or chars < 80:
        print("  스트리밍 판정: N/A (흘릴 내용이 짧음)")
        return True
    ok = n_delta > 1 and first_delta is not None and first_delta < m["total_ms"] / 1000
    print("  스트리밍 판정:", "PASS (점진 도착)" if ok else "FAIL (한 번에 도착)")
    return ok


if __name__ == "__main__":
    qs = sys.argv[1:] or ["자재 입하 검수 절차를 알려주세요",
                          "우주선 부품 재고를 알려주세요"]
    print("예열...")
    httpx.post(f"{BASE}/api/chat", json={"question": "예열"}, headers=H, timeout=180)
    all_ok = all(run(q) for q in qs)
    print("\n전체:", "PASS" if all_ok else "확인 필요")
