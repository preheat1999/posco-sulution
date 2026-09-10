"""템플릿·인자 선택 — LLM 은 SQL 을 쓰지 않고 '무엇을 조회할지'만 고른다.

규칙으로 확정되는 것(자재코드 1건 등)은 LLM 을 부르지 않는다.
같은 (템플릿, 인자)면 항상 같은 SQL 이 실행된다 — 재현성이 최우선이다.
"""
import json
import re

from router import ITEM_CODE_RE
from structured import GROUPABLE, SORTABLE, UNAVAILABLE

INTENT_PROMPT = """사내 자재관리 데이터베이스 조회 요청을 만드는 도구입니다.
아래 조회 템플릿 중 하나와 인자를 고르세요. SQL 은 쓰지 마세요.

[템플릿]
1. item_detail        자재 1건 상세.  인자: item(자재코드, 필수)
2. item_list          조건별 자재 목록.
   인자: type(보험품|계획품) warehouse sourcing_group procurement_type(국내|수입)
        is_critical(true|false) min_stock_value(정수)
        sort_by({sortable}) order(desc|asc) limit(기본 20)
3. summary_by         기준별 집계. 인자: dimension({groupable}, 필수)
4. portfolio_totals   전체 총계. 인자 없음
5. equipment_schedule 설비 정지일정.
   인자: equipment(부분일치) maint_kind(대수리|중수리|정기수리|합리화|교체휴지|공정휴지)
        since(YYYY-MM-DD) until(YYYY-MM-DD) only_linked(true|false) limit(기본 20)
6. demand_history     자재별 월 불출 추이. 인자: item(필수) limit(기본 24)

[답할 수 없는 것]
적정재고·발주 신호등·공용화 후보는 산출 결과가 없습니다.
그런 요청이면 template 을 "order_urgent" 또는 "pooling_candidates" 로 두세요.

★ 위 템플릿 중 어느 것으로도 답할 수 없는 질문이면 반드시 "none" 을 고르세요.
  억지로 비슷한 템플릿을 고르지 마세요. 질문과 무관한 표를 보여주는 것이
  답하지 않는 것보다 나쁩니다.

질문: {question}

JSON 만 출력하세요. 다른 말은 쓰지 마세요.
{{"template": "...", "args": {{...}}}}"""


def rule_intent(question):
    """규칙으로 확정되는 의도만 처리한다. 확정 못 하면 None."""
    q = question
    codes = ITEM_CODE_RE.findall(q)
    if codes:
        if any(w in q for w in ("불출", "추이", "사용량", "출고 이력", "소요")):
            return {"template": "demand_history", "args": {"item": codes[0]}}
        return {"template": "item_detail", "args": {"item": codes[0]}}
    if any(w in q for w in ("적정재고", "발주 신호", "신호등", "즉시발주", "발주임박")):
        return {"template": "order_urgent", "args": {}}
    if any(w in q for w in ("공용화", "정체 자재", "정체금액")):
        return {"template": "pooling_candidates", "args": {}}
    if any(w in q for w in ("전체 재고", "총 재고", "전체 총계", "총액", "전사 재고")):
        return {"template": "portfolio_totals", "args": {}}
    for word, dim in (("속성별", "type"), ("창고별", "warehouse"),
                      ("소싱그룹별", "sourcing_group"), ("조달구분별", "procurement_type")):
        if word in q:
            return {"template": "summary_by", "args": {"dimension": dim}}
    return None


def _clean(intent):
    """LLM 이 준 인자를 화이트리스트로 정리한다. 추측한 값이 SQL 로 새지 않게 한다."""
    from structured import TEMPLATES
    t = intent.get("template")
    if t not in TEMPLATES and t not in UNAVAILABLE:
        return None                         # "none" 및 알 수 없는 템플릿
    args = intent.get("args") or {}
    if not isinstance(args, dict):
        args = {}
    if t == "summary_by" and args.get("dimension") not in GROUPABLE:
        args["dimension"] = "type"
    if t == "item_list" and args.get("sort_by") not in SORTABLE:
        args.pop("sort_by", None)
    if t in ("item_detail", "demand_history"):
        m = ITEM_CODE_RE.search(str(args.get("item", "")))
        if not m:
            return None                     # 자재코드가 없으면 조회 자체가 불가능하다
        args["item"] = m.group(0)
    return {"template": t, "args": args}


def llm_intent(question):
    import answer as answer_mod
    try:
        text, _u, _m = answer_mod.call_llm(
            "너는 조회 요청 생성기다. JSON 만 출력한다.",
            INTENT_PROMPT.format(question=question,
                                 sortable="|".join(sorted(SORTABLE)),
                                 groupable="|".join(sorted(GROUPABLE))))
        m = re.search(r"\{.*\}", text or "", re.S)
        if m:
            d = json.loads(m.group(0))
            if d.get("template"):
                return _clean(d)
    except Exception:
        pass
    return None


def resolve(question):
    """{template, args, source} 또는 None — 조회 대상을 정하지 못한 경우.

    ★ 예전에는 못 정하면 전체 총계로 폴백했는데, "우주선 부품 재고" 처럼 DB 와 무관한
      질문에 전체 재고표를 보여주는 오답이 나왔다(무응답 정책이 깨졌다).
      정하지 못하면 None 을 돌려 문서 경로로 넘기고, 거기서도 근거가 없으면
      "찾을 수 없습니다"로 끝나야 한다."""
    r = rule_intent(question)
    if r:
        return {**r, "source": "rule"}
    r = llm_intent(question)
    if r:
        return {**r, "source": "llm"}
    return None


UNAVAILABLE_TEMPLATES = set(UNAVAILABLE)
