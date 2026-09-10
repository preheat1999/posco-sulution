"""챗봇 답변에 자동으로 붙는 시각화 판정.

사용자가 "시각화해줘"라고 요청하지 않아도, 질문 내용이 아래 두 부류 중 하나에
해당하면 답변에 흐름도 또는 차트를 함께 붙인다.

  1) 업무 흐름형 질문(예: "POS-Appia 물품등록 절차") → 문서에서 추출해 검증한
     흐름도(dashboard 의 8절과 동일한 스펙)를 붙인다.
  2) 집계 데이터형 질문(예: "자재 수요 패턴") → data/viz.json 에 이미 집계해 둔
     수치로 차트를 붙인다.

그 외 일반 산문 질문(예: 계약 조항 인용)에는 아무것도 붙이지 않는다 — 모든 답변에
차트를 강제로 붙이면 오히려 가독성이 떨어진다. 판정은 규칙(정규식)만으로 하고
LLM 을 추가로 부르지 않는다 — 지연·비용이 늘지 않는다.
"""
import json
import re
from pathlib import Path

VIZ_PATH = Path(__file__).resolve().parent.parent / "data" / "viz.json"
_viz_cache = None


def _load_viz():
    global _viz_cache
    if _viz_cache is None:
        try:
            _viz_cache = json.loads(VIZ_PATH.read_text(encoding="utf-8"))
        except FileNotFoundError:
            _viz_cache = {}
    return _viz_cache


def H(x1, x2, y):
    return f"M{x1},{y} L{x2},{y}"


def V(x, y1, y2):
    return f"M{x},{y1} L{x},{y2}"


# ===================================================================
# 1) 업무 흐름 4종 — dashboard.html 8절과 동일한 노드·엣지 스펙(단일 출처화 원칙 위배를
#    피하려 했으나, 대시보드는 정적 페이지라 서버 데이터에 의존하지 않는다. 프론트는
#    이 스펙을 그대로 받아 그리기만 한다).
# ===================================================================
FLOWS = {
    "material_inbound": {
        "title": "자재 입하 · 검수 프로세스",
        "source": "근거: 자재입하 및 저장관리 지침(V45) · 기자재반입센터 검사작업 지침",
        "trigger": re.compile(r"(입하|반입).{0,6}(검수|절차|과정|프로세스)|검수.{0,6}절차"),
        "w": 880, "h": 180,
        "nodes": [
            {"x": 10, "y": 20, "t": "납품 도착", "k": "accent"},
            {"x": 175, "y": 20, "t": "기자재반입센터\n경유"},
            {"x": 340, "y": 20, "t": "신분 확인 · CCTV\n납품명세서 대조"},
            {"x": 520, "y": 20, "t": "수량 · 사양\n일치?"},
            {"x": 700, "y": 0, "t": "입하 확정", "k": "accent"},
            {"x": 700, "y": 62, "t": "불합격 조치", "k": "warn"},
            {"x": 175, "y": 108, "t": "사용부서\n직접 납품"},
            {"x": 340, "y": 108, "t": "사용부서장\n납품 확인"},
            {"x": 700, "y": 124, "t": "ERP 입고 처리"},
        ],
        "edges": [
            {"d": H(142, 175, 40)}, {"d": H(307, 340, 40)}, {"d": H(472, 520, 40)},
            {"d": "M652,40 L676,40 L676,20 L700,20", "label": "일치", "lx": 676, "ly": 14},
            {"d": "M652,40 L676,40 L676,82 L700,82", "label": "불일치", "lx": 676, "ly": 100},
            {"d": "M76,60 L76,128 L175,128", "label": "미경유", "lx": 120, "ly": 122},
            {"d": H(307, 340, 128)}, {"d": "M472,128 L700,128"},
            {"d": V(766, 40, 124), "dash": True},
        ],
        "notes": [{"x": 10, "y": 172,
                   "t": "근무시간 외(평일 17:00~익일 08:00·휴일) 납품은 사전 협의 후 익일 근무일에 입하 처리"}],
    },
    "pos_appia_register": {
        "title": "POS-Appia 물품등록 → 회송 → 재신청",
        "source": "근거: 물품등록 오류설명·재신청 가이드 · POS-Appia 매뉴얼",
        "trigger": re.compile(r"(물품\s*등록|POS-?Appia).{0,10}(절차|과정|프로세스|방법|어떻게|반려|회송)"
                              r"|반려.{0,10}물품\s*등록"),
        "w": 880, "h": 180,
        "nodes": [
            {"x": 10, "y": 50, "t": "물품등록 신청", "k": "accent"},
            {"x": 180, "y": 50, "t": "검토"},
            {"x": 330, "y": 50, "t": "오류 유형 판정"},
            {"x": 520, "y": 8, "t": "등록 완료", "k": "accent"},
            {"x": 520, "y": 92, "t": "회송(반려)", "k": "warn"},
            {"x": 700, "y": 92, "t": "기존 신청 삭제\n→ 신규 신청"},
        ],
        "edges": [
            {"d": H(142, 180, 70)}, {"d": H(312, 330, 70)},
            {"d": "M462,70 L490,70 L490,28 L520,28", "label": "정상", "lx": 492, "ly": 22},
            {"d": "M462,70 L490,70 L490,112 L520,112", "label": "오류", "lx": 492, "ly": 132},
            {"d": H(652, 700, 112)},
            {"d": "M766,92 L766,150 L76,150 L76,90", "label": "재신청 루프", "lx": 420, "ly": 164, "dash": True},
        ],
        "notes": [{"x": 10, "y": 20,
                   "t": "오류 유형: 품명선정 · 중복등록 · 조달구분 지정 · 항목값 입력위치 · 등록대상 아님"}],
        "caption": "진행 현황은 POS-Appia 앱의 [조회 → 신청이력 조회 → 검토자 현황보기]에서 확인합니다.",
    },
    "supplier_eval": {
        "title": "자재공급사 평가 프로세스",
        "source": "근거: 자재공급사 평가관리지침 M10089(V53)",
        "trigger": re.compile(r"공급사.{0,10}평가.{0,10}(절차|기준|과정|방법)|평가.{0,10}(절차|과정).{0,10}공급사"),
        "w": 880, "h": 140,
        "nodes": [
            {"x": 10, "y": 40, "t": "신규 등록 심사", "k": "accent"},
            {"x": 190, "y": 40, "t": "기본 자격 확인\n신용등급 · ISO"},
            {"x": 380, "y": 40, "t": "등록"},
            {"x": 530, "y": 40, "t": "성과 분석\n(기존 공급사)"},
            {"x": 720, "y": 10, "t": "등급 부여\nS / A / B / C", "k": "accent"},
            {"x": 720, "y": 76, "t": "거래 제한 · 제재", "k": "warn"},
        ],
        "edges": [
            {"d": H(142, 190, 60)}, {"d": H(322, 380, 60)}, {"d": H(512, 530, 60)},
            {"d": "M662,60 L692,60 L692,30 L720,30"},
            {"d": "M662,60 L692,60 L692,96 L720,96"},
        ],
        "notes": [],
    },
    "chatbot_flow": {
        "title": "이 챗봇의 처리 흐름",
        "source": "질문 하나가 지나가는 경로",
        "trigger": re.compile(r"(챗봇|시스템|너).{0,10}(어떻게|동작|작동|구조|원리|만들어)"),
        "w": 930, "h": 175,
        "nodes": [
            {"x": 10, "y": 62, "t": "질문", "k": "accent", "w": 84},
            {"x": 120, "y": 62, "t": "후속질문\n재작성"},
            {"x": 280, "y": 62, "t": "경로 판정\n(규칙 → LLM)"},
            {"x": 460, "y": 6, "t": "SQL 조회\n고정 템플릿"},
            {"x": 460, "y": 62, "t": "dense 문서게이트\n+ 로컬 BM25"},
            {"x": 460, "y": 122, "t": "두 경로 병합"},
            {"x": 640, "y": 62, "t": "리랭킹\nCross-Encoder"},
            {"x": 800, "y": 62, "t": "LLM 답변\n+ [n] 인용", "k": "accent", "w": 112},
        ],
        "edges": [
            {"d": H(94, 120, 82)}, {"d": H(252, 280, 82)},
            {"d": "M412,82 L436,82 L436,26 L460,26", "label": "sql", "lx": 436, "ly": 20},
            {"d": H(412, 460, 82), "label": "rag", "lx": 436, "ly": 76},
            {"d": "M412,82 L436,82 L436,142 L460,142", "label": "hybrid", "lx": 434, "ly": 160},
            {"d": H(592, 640, 82)}, {"d": H(772, 800, 82)},
            {"d": "M592,26 L616,26 L616,60 L800,60", "dash": True},
        ],
        "notes": [{"x": 10, "y": 170,
                   "t": "정형(sql) 경로는 검색·리랭킹을 건너뛰므로 RAG 보다 빠릅니다 — 실측 2~3초"}],
    },
}


def _match_flow(question):
    for fid, spec in FLOWS.items():
        if spec["trigger"].search(question):
            return {"kind": "flow", "id": fid, "title": spec["title"],
                    "source": spec.get("source"), "caption": spec.get("caption"),
                    "w": spec["w"], "h": spec["h"], "nodes": spec["nodes"],
                    "edges": spec["edges"], "notes": spec.get("notes", [])}
    return None


# ===================================================================
# 2) 집계 데이터 차트 — data/viz.json (대시보드와 같은 원천, 집계 수치만)
# ===================================================================
CHART_TRIGGERS = [
    (re.compile(r"수요.{0,4}(패턴|유형|경향)"), "demand_pattern"),
    (re.compile(r"(질문|문의).{0,6}(주제|유형|경향|많이)"), "faq_topics"),
    (re.compile(r"(정체|잠긴|불용|불출.{0,4}없).{0,6}재고|재고.{0,6}(정체|잠김)"), "dead_stock"),
]


def _build_chart(key):
    v = _load_viz()
    if not v:
        return None
    if key == "demand_pattern":
        d = v.get("demand", {})
        classes = d.get("classes")
        if not classes:
            return None
        return {"kind": "chart", "chart": "stackbar", "id": key,
                "title": "자재 수요 패턴 구성 (Syntetos–Boylan 분류)",
                "source": f"불출 이력이 있는 자재 {d.get('n_with_history', '-')}종 기준 · 연습용 샘플 데이터",
                "data": classes,
                "caption": "Intermittent(간헐 수요)가 가장 많습니다 — 통계적으로 예측하기 어려운 "
                           "자재가 다수라는 뜻이며, 그래서 규정·경험이 담긴 문서 근거가 중요해집니다."}
    if key == "faq_topics":
        topics = v.get("faq", {}).get("topics")
        if not topics:
            return None
        return {"kind": "chart", "chart": "hbar", "id": key,
                "title": "실무자 질문 주제 분포",
                "source": "사내 질의응답 로그 집계", "data": topics[:10], "caption": None}
    if key == "dead_stock":
        m = v.get("material", {})
        ds, qc = m.get("dead_stock"), m.get("quadrant_counts")
        if not ds or not qc:
            return None
        return {"kind": "chart", "chart": "stackbar", "id": key,
                "title": "재고 회전 현황 (보유량 vs 실제 불출)",
                "source": f"불출 이력 없는 재고 {ds['n']}종 · {ds['value']:,}원 "
                          f"(전체 재고금액의 {ds['share']*100:.0f}%) · 연습용 샘플 데이터",
                "data": qc, "caption": None}
    return None


def _match_chart(question):
    for pat, key in CHART_TRIGGERS:
        if pat.search(question):
            c = _build_chart(key)
            if c:
                return c
    return None


def detect(question):
    """질문 문장 하나로 시각화를 판정한다. 해당 없으면 None(일반 산문 답변 유지)."""
    if not question:
        return None
    return _match_flow(question) or _match_chart(question)
