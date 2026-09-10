"""질문 경로 판정 — 규칙 우선, 애매한 것만 LLM (05_정형데이터_라우팅_프롬프트.md B절).

규칙으로 확정된 질문은 LLM 을 부르지 않는다. 같은 질문에 항상 같은 경로가 나오고
비용·지연이 0 이다. 애매한 것만 LLM 에 넘겨 그만큼만 비결정성을 감수한다.
실측: 규칙 전용 60% → rule_then_llm 92.5% (홀드아웃 40문항).
"""
import json
import re

from config import cfg

# ★ \b 를 쓰지 마라. 한글도 \w 라서 "Q3501342는" 처럼 조사가 붙으면 매칭에 실패한다.
# 마스터에는 QS424543 처럼 문자가 하나 끼는 코드도 있다.
ITEM_CODE_RE = re.compile(r"(?<![A-Za-z0-9])Q[A-Z]?\d{6,8}(?![0-9])")

SQL_PATTERNS = [
    "적정재고", "현재고", "재고량", "재고", "발주", "신호등", "즉시발주", "발주임박",
    "리드타임", "단가", "정체", "공용화", "감축", "목표재고", "몇 개", "몇개", "몇 종",
    "몇종", "얼마", "총액", "합계", "총계", "상위", "top", "순위", "목록", "리스트",
    "집계", "통계", "평균", "현황", "불출", "소요량", "정지일정", "정지", "휴지",
    "보유량", "부족", "등급별", "속성별", "창고별", "예비품", "대수리", "중수리",
    "정비계획", "빨간불", "노란불", "분포", "핵심", "조치", "조달구분", "소싱그룹",
]
RAG_PATTERNS = [
    "방법", "절차", "어떻게", "규정", "지침", "기준", "무엇인가", "무슨 뜻", "뜻이",
    "정의", "용어", "매뉴얼", "가이드", "약관", "계약", "신청", "등록", "작성", "제출",
    "문의", "담당", "시스템", "메뉴", "오류", "에러", "안내", "설명해", "교육", "감가",
    "누구", "결재", "승인", "품의", "상신",
]
# 정형 신호와 함께 나오면 개수와 무관하게 hybrid
STRONG_RAG = ["절차", "방법", "규정", "지침", "약관", "매뉴얼", "기준", "담당", "신청",
              "등록", "작성", "제출", "감가", "누구", "결재", "승인", "품의", "상신"]
# 단독으로는 확신도 0.5 로 낮춰 LLM 이 다시 본다.
# ★ 이 장치가 정확도를 75% → 95% 로 올렸다. 흔한 단어 하나에 확신하면 안 된다.
WEAK_SQL = ["재고", "얼마", "현황", "목록", "리스트", "몇 개", "몇개", "몇 종", "몇종",
            "부족", "평균", "순위", "상위", "분포", "조치", "핵심", "보유량", "정지"]
WEAK_RAG = ["어떻게", "안내", "문의", "시스템", "기준", "설명해", "누구", "작성", "등록"]
HYBRID_PATTERNS = ["그리고", "함께", "같이", "또한", "및", "절차도", "방법도", "규정도",
                   "어떻게 해야", "무엇을 해야", "뭘 해야", "어떤 절차"]

ROUTER_PROMPT = """사내 자재관리 챗봇의 질문 분류기입니다. 아래 질문을 세 경로 중 하나로 분류하세요.

- sql: 자재의 수치·재고·발주·금액·목록·집계를 묻는 질문. 데이터베이스로 답합니다.
- rag: 규정·절차·방법·용어·시스템 사용법을 묻는 질문. 사내 문서로 답합니다.
- hybrid: 위 둘을 한 번에 요구하는 질문.

데이터베이스로 답할 수 있는 것:
{catalog}

질문: {question}

JSON 만 출력하세요. 다른 말은 쓰지 마세요.
{{"route": "sql|rag|hybrid", "reason": "20자 이내 근거"}}"""

CATALOG = """- 자재 1건 상세 (현재고·단가·리드타임·창고·연결설비)
- 조건별 자재 목록 (속성·등급·창고·소싱그룹·조달구분)
- 기준별 집계 (자재수·현재고금액)
- 전체 총계 (종수·현재고금액)
- 설비 정지일정과 해당 설비 예비품 현황
- 자재별 월 불출 추이
※ 적정재고·발주신호등·공용화 후보는 산출 결과가 없어 답할 수 없습니다."""


def _hits(question, patterns):
    return [p for p in patterns if p in question]


def rule_route(question):
    """(경로, 확신도, 근거) 또는 (None, 0.0, 근거) — 판정 불가."""
    q = question.lower()
    has_code = bool(ITEM_CODE_RE.search(question))
    sql_hits = _hits(q, [p.lower() for p in SQL_PATTERNS])
    rag_hits = _hits(q, [p.lower() for p in RAG_PATTERNS])
    strong_rag = _hits(q, [p.lower() for p in STRONG_RAG])
    conj = _hits(q, [p.lower() for p in HYBRID_PATTERNS])
    only_weak_sql = sql_hits and all(h in [w.lower() for w in WEAK_SQL] for h in sql_hits)
    only_weak_rag = rag_hits and all(h in [w.lower() for w in WEAK_RAG] for h in rag_hits)

    if has_code and strong_rag:
        return "hybrid", 0.9, "자재코드 + 절차어"
    if has_code and not rag_hits:
        return "sql", 0.95, "자재코드만 있음"
    if sql_hits and strong_rag:
        return "hybrid", 0.85, "정형신호 + 강한절차어"
    if sql_hits and rag_hits and conj:
        return "hybrid", 0.8, "정형+비정형 신호 + 접속어"
    if sql_hits and rag_hits:
        if len(sql_hits) > len(rag_hits):
            return "sql", 0.7, "정형 신호가 더 많음"
        if len(rag_hits) > len(sql_hits):
            return "rag", 0.7, "비정형 신호가 더 많음"
        return "hybrid", 0.6, "양쪽 신호 동수"
    if sql_hits:
        return "sql", (0.5 if only_weak_sql else 0.85), \
               ("약한 정형신호만" if only_weak_sql else "강한 정형신호만")
    if rag_hits:
        return "rag", (0.5 if only_weak_rag else 0.85), \
               ("약한 비정형신호만" if only_weak_rag else "강한 비정형신호만")
    return None, 0.0, "신호 없음"


def llm_route(question):
    """규칙이 확신하지 못할 때만 호출한다. 질의당 약 +3.8초."""
    import answer as answer_mod
    try:
        text, _usage, _m = answer_mod.call_llm(
            "너는 질문 분류기다. JSON 만 출력한다.",
            ROUTER_PROMPT.format(catalog=CATALOG, question=question))
        m = re.search(r"\{.*\}", text or "", re.S)
        if m:
            d = json.loads(m.group(0))
            if d.get("route") in ("sql", "rag", "hybrid"):
                return d["route"], d.get("reason", "")[:40]
    except Exception:
        pass
    return None, ""


def route(question):
    """{route, source, confidence, reason} — source 는 rule | llm | default."""
    if not cfg.get("structured.enabled"):
        return {"route": "rag", "source": "disabled", "confidence": 1.0,
                "reason": "정형 모듈 비활성"}
    mode = cfg.get("structured.router.mode")
    threshold = cfg.get("structured.router.rule_confidence_threshold")
    default = cfg.get("structured.router.default_route")

    r, conf, why = rule_route(question)
    if mode == "rule":
        return {"route": r or default, "source": "rule" if r else "default",
                "confidence": conf, "reason": why}
    if mode != "llm" and r is not None and conf >= threshold:
        return {"route": r, "source": "rule", "confidence": conf, "reason": why}

    lr, lwhy = llm_route(question)
    if lr:
        return {"route": lr, "source": "llm", "confidence": 0.75,
                "reason": lwhy or "LLM 분류"}
    return {"route": r or default, "source": "default", "confidence": conf,
            "reason": why + " (LLM 분류 실패)"}
