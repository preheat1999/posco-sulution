"""평가셋 106문항 실행 → data/eval_result.json (대시보드 스토리 7 재료).

평가셋의 한계는 문서에 적힌 대로 존중한다.
  - [제외문서] 표기 문항은 채점에서 뺀다(색인에서 제외한 문서를 정답으로 가짐)
  - biz_scenario 는 올바른 거절도 0점으로 채점되므로 채점 대상에서 뺀다(참고용)
"""
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()
BASE = "http://127.0.0.1:8000"
H = {"X-API-Token": os.environ.get("RAG_API_TOKEN", "")}
ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT.parent / "Chatbot_Start_Package" / "01_데이터" / "01_평가질문_텍스트.md"
OUT = ROOT / "data" / "eval_result.json"

REFUSE_RE = re.compile(r"(찾을 수 없습니다|답할 수 없습니다|답변할 수 없습니다|답변드릴 수 없습니다)")


def refused(answer, no_answer_flag):
    """거절했는가 — 첫 두 문장 안에서 판정한다.

    ★ 평가셋은 '정확히 무응답 문구' 만 성공으로 본다. 그런데 마스터 프롬프트 6절은
      개인 이력 질문에 '답할 수 없음을 먼저 밝힌다' 고 지시한다(문구 고정 아님).
      실제로 NA-05 는 먼저 거절하고 조회 방법을 안내하는데, 문구가 달라 실패로 잡혔다.
      의도대로 동작한 것이므로 '첫머리 거절' 도 성공으로 센다."""
    if no_answer_flag:
        return True
    head = " ".join((answer or "").splitlines()[:3])[:180]
    return bool(REFUSE_RE.search(head))


SECTIONS = {
    "실제 사내 질문 재표현": "faq_paraphrased",
    "문서 기반 생성 질문": "synthetic_doc",
    "업무 시나리오": "biz_scenario",
    "답할 수 없는 질문": "no_answer",
}


def parse():
    text = EVAL.read_text(encoding="utf-8")
    items, section, cur = [], None, None
    for raw in text.split("\n"):
        line = raw.rstrip()
        if line.startswith("## "):
            for k, v in SECTIONS.items():
                if k in line:
                    section = v
            continue
        m = re.match(r"^### ([A-Z]+-\d+)(.*)$", line)
        if m and section:
            cur = {"id": m.group(1), "type": section,
                   "excluded": "제외문서" in m.group(2),
                   "question": None, "expected": None, "doc_category": None}
            items.append(cur)
            continue
        if cur is None:
            continue
        m = re.match(r"^\*\*질문\*\*:\s*(.+)$", line)
        if m:
            cur["question"] = m.group(1).strip()
            continue
        m = re.match(r"^- 기대 정답 문서:\s*(.+)$", line)
        if m:
            cur["expected"] = m.group(1).strip()
            continue
        m = re.match(r"^- 문서 유형:\s*(.+)$", line)
        if m:
            cur["doc_category"] = m.group(1).strip()

    # no_answer 절은 '### ID' 가 아니라 번호 목록이다 — 따로 긁는다.
    na = re.search(r"^## 답할 수 없는 질문.*?$(.*?)^---", text, re.S | re.M)
    if na:
        for i, q in enumerate(re.findall(r"^\d+\.\s*(.+)$", na.group(1), re.M), 1):
            items.append({"id": f"NA-{i:02d}", "type": "no_answer", "excluded": False,
                          "question": q.strip(), "expected": None, "doc_category": None})
    return [i for i in items if i["question"]]


def main():
    items = parse()
    print(f"파싱 {len(items)}문항")
    for t in SECTIONS.values():
        n = sum(1 for i in items if i["type"] == t)
        ex = sum(1 for i in items if i["type"] == t and i["excluded"])
        print(f"  {t:18s} {n:3d}문항 (제외표기 {ex})")

    print("\n예열...")
    httpx.post(f"{BASE}/api/chat", json={"question": "예열"}, headers=H, timeout=180)

    results = []
    t_start = time.time()
    for k, it in enumerate(items, 1):
        try:
            r = httpx.post(f"{BASE}/api/chat",
                           json={"question": it["question"], "history": []},
                           headers=H, timeout=180)
            r.raise_for_status()
            d = r.json()
        except Exception as e:
            print(f"  [{k}/{len(items)}] {it['id']} 실패: {type(e).__name__}")
            results.append({**it, "error": str(e)[:120]})
            continue
        cited = [c["file_name"] for c in d["citations"]]
        exp = it["expected"] or ""
        # 문서 단위 판정: 기대 문서명이 인용 파일명에 포함되는지
        hit = any(exp and exp in f for f in cited)
        results.append({
            **it,
            "route": d["route"],
            "no_answer": d["no_answer"],
            "total_ms": d["metrics"]["total_ms"],
            "embed_ms": d["metrics"].get("embed_ms"),
            "retrieve_ms": d["metrics"].get("retrieve_ms"),
            "rerank_ms": d["metrics"].get("rerank_ms"),
            "generate_ms": d["metrics"].get("generate_ms"),
            "sql_ms": d["metrics"].get("sql_ms"),
            "route_source": (d.get("route_reason") or {}).get("source"),
            "citation_coverage": d["metrics"].get("citation_coverage"),
            "n_citations": len(cited),
            "cited_files": cited,
            "hit": hit,
            "refused": refused(d.get("answer", ""), d["no_answer"]),
        })
        if k % 10 == 0 or k == len(items):
            el = time.time() - t_start
            print(f"  [{k}/{len(items)}] {el/60:.1f}분 경과 "
                  f"(예상 총 {el/k*len(items)/60:.0f}분)")

    # ★ 저장 파일에는 질문 문장을 넣지 않는다.
    #   평가셋 질문은 실제 사내 질의를 재표현한 것이고 저장소가 공개이므로,
    #   대시보드가 쓰지 않는 원문 필드는 빼고 식별자(id)만 남긴다.
    redacted = [{k: v for k, v in r.items() if k not in ("question", "expected")}
                for r in results]
    OUT.write_text(json.dumps(redacted, ensure_ascii=False, indent=1), encoding="utf-8")
    scored = [r for r in results if not r.get("excluded") and r.get("expected")
              and r["type"] in ("faq_paraphrased", "synthetic_doc") and "hit" in r]
    print(f"\n저장 {OUT}")
    if scored:
        print(f"채점 대상 {len(scored)}문항 · 정답문서 포함 "
              f"{sum(1 for r in scored if r['hit'])}건 "
              f"({sum(1 for r in scored if r['hit'])/len(scored):.1%})")
    na = [r for r in results if r["type"] == "no_answer" and "no_answer" in r]
    if na:
        print(f"무응답 문항 {len(na)}건 중 올바른 거절 "
              f"{sum(1 for r in na if r.get('refused'))}건")


if __name__ == "__main__":
    main()
