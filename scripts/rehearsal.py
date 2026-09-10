"""시연 리허설 — 데모 질문을 실제로 실행해 응답시간·근거를 기록한다.

발표에서는 '사전 검증 수치'와 '당일 실측 수치'를 구분해 말해야 하므로,
여기서 나온 값을 그대로 인용한다. 결과는 data/rehearsal.md 로 저장한다.
"""
import json
import os
import statistics
import time
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()
BASE = "http://127.0.0.1:8000"
H = {"X-API-Token": os.environ.get("RAG_API_TOKEN", "")}
OUT = Path(__file__).resolve().parent.parent / "data" / "rehearsal.md"

DEMO = [
    ("1 절차형", "자재 입하 검수 절차가 어떻게 되나요?", "기자재반입센터 / 자재입하 및 저장관리 지침"),
    ("2 계약 조항", "표준하도급계약서의 지체상금 기준을 알려주세요.", "표준하도급계약서 제N조"),
    ("3 시스템 오류", "POS-Appia 물품등록이 반려됐는데 어떻게 해야 하나요?",
     "물품등록 오류설명 / POS-Appia 매뉴얼 / 포스위키"),
    ("4 근거 없음", "우주선 부품 재고를 알려주세요.", "찾을 수 없습니다"),
    ("4-b 범위 밖", "김OO 대리가 지난달 신청한 자재 목록 보여주세요.", "개인 이력은 답할 수 없음"),
    # ★ 시나리오 예시는 Q3501342 지만 샘플 master.csv(743건)에 없다 → Q1000108 로 시연한다
    ("5 정형 수치", "Q1000108 현재 재고와 리드타임을 알려주세요.", "표 + [DB: ...] 기준일"),
    ("5-b 하이브리드", "Q1000108 재고 알려주고 발주 신청 절차도 알려줘", "표 + 문서 인용"),
]
BACKUP = [
    ("예비1", "VMI 자재 증량 요청은 어떻게 하나요?", "SCC 증량 요청 매뉴얼 / 포스위키"),
    ("예비2", "컨사인먼트 자재 신청 절차를 알려주세요", "컨사인먼트자재신청 사용자매뉴얼"),
    ("예비3", "자재공급사 평가는 어떤 기준으로 하나요?", "자재공급사 평가관리지침"),
    ("예비4", "중고자재를 등록하려면 어떻게 하나요?", "중고자재관리시스템 매뉴얼"),
    ("예비5", "계약 전 사전입고 프로세스가 뭔가요?", "계약전 사전입고 프로세스 안내"),
]


def ask(q):
    t0 = time.time()
    r = httpx.post(f"{BASE}/api/chat", json={"question": q, "history": []},
                   headers=H, timeout=180)
    r.raise_for_status()
    d = r.json()
    d["_wall"] = time.time() - t0
    return d


def run(cases, title, lines):
    rows = []
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")
    lines.append(f"\n## {title}\n")
    lines.append("| # | 질문 | 경로 | 응답시간 | 근거 | 인용률 | 출처 |")
    lines.append("|---|---|---|---|---|---|---|")
    for name, q, expect in cases:
        d = ask(q)
        m = d["metrics"]
        secs = m["total_ms"] / 1000
        cits = d["citations"]
        srcs = " · ".join(c["source"].split(" > ")[0][:34] for c in cits[:2]) or "—"
        print(f"\n[{name}] {q}")
        print(f"  경로 {d['route']:6s} · {secs:5.1f}초 · 인용 {len(cits)}건 "
              f"· 인용률 {m.get('citation_coverage', 0):.0%} · no_answer={d['no_answer']}")
        print(f"  기대: {expect}")
        for c in cits[:3]:
            print(f"   [{c['index']}] {c['source'][:70]}")
        print(f"  답변: {d['answer'][:150].replace(chr(10), ' ')}")
        rows.append((name, secs, d["route"], len(cits)))
        lines.append(f"| {name} | {q} | {d['route']} | {secs:.1f}초 | {len(cits)}건 "
                     f"| {m.get('citation_coverage', 0):.0%} | {srcs} |")
    return rows


def main():
    lines = [f"# 시연 리허설 실측 기록\n",
             f"측정 시각: {datetime.now():%Y-%m-%d %H:%M}  ",
             "구성: hybrid(Qdrant dense 문서게이트 + 로컬 BM25) · Cross-Encoder 리랭킹 "
             "· google/gemini-3.1-flash-lite\n"]
    print("예열...")
    ask("예열")

    rows = run(DEMO, "데모 질문", lines)
    rows += run(BACKUP, "예비 질문", lines)

    rag = [s for n, s, r, c in rows if r == "rag"]
    sql = [s for n, s, r, c in rows if r == "sql"]
    hyb = [s for n, s, r, c in rows if r == "hybrid"]
    cits = [c for n, s, r, c in rows]

    lines.append("\n## 당일 실측 요약\n")
    lines.append("| 경로 | 건수 | 평균 | 최소 | 최대 |")
    lines.append("|---|---|---|---|---|")
    for label, xs in (("RAG (문서)", rag), ("SQL (정형)", sql), ("hybrid", hyb)):
        if xs:
            lines.append(f"| {label} | {len(xs)} | {statistics.mean(xs):.1f}초 "
                         f"| {min(xs):.1f}초 | {max(xs):.1f}초 |")
    lines.append(f"\n- 인용 건수 평균 **{statistics.mean(cits):.1f}건**"
                 f" (최대 {max(cits)}건)")
    lines.append(f"- 전체 {len(rows)}개 질의 모두 응답 성공")

    print("\n" + "=" * 78)
    print("당일 실측 요약")
    for label, xs in (("RAG (문서)", rag), ("SQL (정형)", sql), ("hybrid", hyb)):
        if xs:
            print(f"  {label:12s} {len(xs)}건 · 평균 {statistics.mean(xs):5.1f}초 "
                  f"· 범위 {min(xs):.1f}~{max(xs):.1f}초")
    print(f"  인용 평균 {statistics.mean(cits):.1f}건")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n기록 저장: {OUT}")


if __name__ == "__main__":
    main()
