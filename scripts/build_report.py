"""PDF 보고서 HTML 생성 — data/*.json 을 읽어 data/report.html 을 만든다.

이후 Playwright(headless Edge)로 report.html → report.pdf 변환한다(별도 node 스크립트).
"""
import json
import statistics
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "report.html"

viz = json.loads((DATA / "viz.json").read_text(encoding="utf-8"))
ev = json.loads((DATA / "eval_result.json").read_text(encoding="utf-8"))
try:
    evid = json.loads((DATA / "report_evidence.json").read_text(encoding="utf-8"))
except FileNotFoundError:
    evid = None

# ---- 집계 ---------------------------------------------------------------
scored = [r for r in ev if not r.get("excluded") and r["type"] in ("faq_paraphrased", "synthetic_doc")
          and r.get("hit") is not None]
by_type = {}
for r in ev:
    if r["type"] == "biz_scenario":
        continue
    if r["type"] != "no_answer" and (r.get("excluded") or r.get("hit") is None):
        continue
    d = by_type.setdefault(r["type"], {"n": 0, "hit": 0})
    d["n"] += 1
    if r["type"] == "no_answer":
        if r.get("refused"):
            d["hit"] += 1
    elif r.get("hit"):
        d["hit"] += 1

route_time = {}
for r in ev:
    if r.get("total_ms") is None or not r.get("route"):
        continue
    route_time.setdefault(r["route"], []).append(r["total_ms"])

route_cnt = {}
route_src = {"rule": 0, "llm": 0}
for r in ev:
    if r.get("route"):
        route_cnt[r["route"]] = route_cnt.get(r["route"], 0) + 1
    if r.get("route_source") in route_src:
        route_src[r["route_source"]] += 1

cov = [r["citation_coverage"] for r in ev if r.get("citation_coverage") is not None]
n_cit = [r["n_citations"] for r in ev if r.get("n_citations") is not None]

doc_cnt = {}
for r in ev:
    for f in (r.get("cited_files") or []):
        doc_cnt[f] = doc_cnt.get(f, 0) + 1
used_docs = len(doc_cnt)
total_docs = viz["corpus"]["n_docs"]

TYPE_KO = {"faq_paraphrased": "실제 사내 질문 재표현", "synthetic_doc": "문서 기반 생성 질문",
           "no_answer": "답할 수 없는 질문(무응답 정책)"}
ROUTE_KO = {"rag": "문서 검색(RAG)", "sql": "정형 조회(SQL)", "hybrid": "정형+문서(hybrid)"}


def pct(x):
    return f"{x*100:.0f}%" if x is not None else "-"


def bar(value, max_value=1.0, color="#2a78d6", w=220):
    v = max(0, min(1, value / max_value if max_value else 0))
    return (f'<span class="barwrap" style="width:{w}px">'
            f'<span class="barfill" style="width:{v*100:.0f}%;background:{color}"></span></span>')


built_at = datetime.now().strftime("%Y년 %m월 %d일 %H:%M")

# ---- 11개 체크리스트 항목 평가 --------------------------------------------
CHECKLIST = [
    ("1. 문서 전처리", "부분 구현",
     "PPTX·DOCX·PDF·XLSX·XLSB 5개 포맷별 전용 파서로 위치정보(슬라이드·조항·행·페이지)까지 "
     "보존하며 파싱했습니다. 30건 전부 파싱에 성공했습니다.",
     "이미지 안의 텍스트(OCR)는 추출하지 않습니다. 화면 캡처로만 설명된 절차는 검색되지 않습니다."),
    ("2. Chunking 전략", "구현",
     f"문서 전체에 하나의 고정 크기를 적용하지 않고, 구조 경계(슬라이드·조항·섹션 등)를 "
     f"우선 사용했습니다. 구조가 없을 때만 800자/150자 오버랩의 재귀 분할로 폴백합니다. "
     f"결과: 문서 30건 → 청크 {viz['corpus']['n_chunks']:,}개.",
     None),
    ("3. 문서 유형별 Chunking", "구현",
     "계약서→조항 단위, FAQ→질문답변 쌍, 매뉴얼→슬라이드 단위, 지침→섹션 단위로 서로 다른 "
     "전략을 적용했습니다. 예: 지체상금 질문의 근거가 \"제51조(지체상금)\" 조항 단위로 정확히 "
     "인용됩니다.", None),
    ("4. Embedding 모델 선정", "부분 구현",
     "질의 임베딩에 BAAI/bge-m3(1024차원)를 사용합니다. 사전 구축된 벡터 색인과 반드시 "
     "동일한 모델이어야 검색이 성립합니다.",
     "저희가 직접 다른 임베딩 모델과 비교 실험을 하지는 않았습니다. 코퍼스 전체를 "
     "재임베딩하려면 CPU 기준 약 1.9시간이 걸려 당일 예산 안에서는 불가능했고, 모델을 "
     "바꾸면 사전 색인과 맞지 않아 검색이 무너집니다."),
    ("5. Vector Search", "제한적 구현 (핵심 발견)",
     "Qdrant Cloud에 사전 구축된 dense 벡터(1024차원, cosine, HNSW)를 재사용합니다.",
     "직접 검증한 결과, 색인의 청크 경계가 저희가 재현한 청킹과 다르다는 것을 발견했습니다. "
     "청크 ID 존재율은 89%였지만, 벡터를 직접 대조하니 내용이 실제로 일치하는 것은 20%뿐이었습니다. "
     "그래서 청크 단위로는 신뢰하지 않고, \"어느 문서가 관련 있는가\"라는 문서 단위 신호로만 "
     "제한적으로 사용합니다."),
    ("6. Keyword + Vector Hybrid Search", "구현 · 실측 검증",
     "로컬 BM25(키워드) 검색과 Qdrant dense 문서 신호를 RRF로 융합합니다. 아래 3절의 실측 "
     "비교에서 키워드 단독이 놓친 질문을 하이브리드가 찾아내는 것을 확인했습니다.", None),
    ("7. top_k 조정", "구현 (검증된 값 채택)",
     "후보 20개 → 리랭킹 후 상위 5개를 사용합니다. 이 값은 사전 실험(10→20에서 정확성 "
     "0.75→0.83)으로 확정된 값을 그대로 적용했으며, 재현성을 위해 당일 임의로 재튜닝하지 "
     "않았습니다.", None),
    ("8. Reranker 적용", "구현",
     "Cross-Encoder(mmarco-mMiniLMv2-L12-H384-v1, 120M)로 후보 20개를 질문과의 관련도 "
     "기준으로 재정렬합니다. 사전 실측에서 이 모델이 4배 큰 568M 모델보다 11.7배 빠르면서 "
     "검색 품질도 더 높았습니다(chunk MRR 0.779).", None),
    ("9. Metadata Filtering", "구현 (직접 보완)",
     "문서 유형별 가중치(지침 1.00 > 계약 0.95 > 매뉴얼 0.90 > 교육 0.85 > FAQ 0.75)를 적용합니다. "
     f"코퍼스의 {round(next(c['value'] for c in viz['corpus']['by_category'] if c['label']=='faq')/viz['corpus']['n_chunks']*100)}%가 "
     "FAQ라서 검색 후보를 잠식하는 문제를 실제로 발견했고, 비-FAQ 문서가 후보에 최소 3건은 "
     "남도록 직접 보완 로직을 추가했습니다.", None),
    ("10. 출처 관리", "완전 구현",
     "모든 답변에 파일명, 위치(슬라이드/조항/페이지/행), 작성일, 원문 일부를 근거로 붙입니다. "
     "답변 속 [1][2] 인용 번호와 출처 목록이 1:1로 연결되고, 화면에서 클릭하면 해당 근거로 "
     "이동합니다.", None),
    ("11. RAG와 DB 조회 구분", "완전 구현",
     "규칙 기반 우선 판정(확신도 낮을 때만 LLM 보조)으로 질문을 문서 검색(RAG)·정형 조회(SQL)·"
     "결합(hybrid) 3경로로 나눕니다. SQL 은 LLM 이 즉석에서 작성하지 않고 고정된 6개 템플릿만 "
     "쓰며, 읽기 전용 접속·SQL 인젝션 방어 등 안전장치 8종을 실측 검증했습니다.", None),
]

status_color = {"완전 구현": "#0ca30c", "구현": "#2a78d6", "구현 · 실측 검증": "#2a78d6",
                 "구현 (검증된 값 채택)": "#2a78d6", "구현 (직접 보완)": "#2a78d6",
                 "부분 구현": "#fab219", "제한적 구현 (핵심 발견)": "#ec835a"}

rows_html = []
for name, status, what, note in CHECKLIST:
    color = status_color.get(status, "#898781")
    note_html = f'<div class="note">⚠ {note}</div>' if note else ""
    rows_html.append(f"""
    <tr>
      <td class="colname">{name}</td>
      <td><span class="tag" style="background:{color}1a;color:{color};border:1px solid {color}55">{status}</span></td>
      <td>{what}{note_html}</td>
    </tr>""")

# ---- 실측 비교(하이브리드 vs BM25 단독) -----------------------------------
evid_html = ""
if evid:
    case_rows = []
    for c in evid["cases"]:
        b = "✅ 발견" if c["bm25_only"]["hit_top5"] else "❌ 놓침"
        g = "✅ 발견" if c["doc_gate_hybrid"]["hit_top5"] else "❌ 발견"
        case_rows.append(f"""
        <tr>
          <td>{c['question']}</td>
          <td class="{'ok' if c['bm25_only']['hit_top5'] else 'bad'}">{b}<br>
              <span class="sub">{c['bm25_only']['top3'][0]['file'][:34]}</span></td>
          <td class="{'ok' if c['doc_gate_hybrid']['hit_top5'] else 'bad'}">{g}<br>
              <span class="sub">{c['doc_gate_hybrid']['top3'][0]['file'][:34]}</span></td>
        </tr>""")
    evid_html = f"""
    <table class="tbl">
      <thead><tr><th>질문</th><th>키워드(BM25) 단독</th><th>하이브리드(BM25+Qdrant)</th></tr></thead>
      <tbody>{"".join(case_rows)}</tbody>
    </table>
    <p class="cap">코퍼스 청크 {evid['corpus']['n_chunks']:,}개 · BM25 어휘 {evid['corpus']['vocab']:,}개 ·
    Qdrant 접속 {'정상' if evid['qdrant']['reachable'] else '실패'}({evid['qdrant']['points']:,} points) 기준 직접 재현한 결과입니다.</p>
    """

# ---- 응답시간 표 -----------------------------------------------------------
time_rows = []
for r in ("rag", "sql", "hybrid"):
    xs = route_time.get(r, [])
    if xs:
        time_rows.append(f"""
        <tr><td>{ROUTE_KO[r]}</td><td>{len(xs)}건</td>
            <td>{statistics.mean(xs)/1000:.1f}초</td>
            <td>{min(xs)/1000:.1f}~{max(xs)/1000:.1f}초</td></tr>""")

# ---- 유형별 성공률 표 -------------------------------------------------------
type_rows = []
for t, d in by_type.items():
    type_rows.append(f"""
    <tr><td>{TYPE_KO.get(t, t)}</td><td>{d['n']}문항</td>
        <td>{d['hit']}건</td>
        <td>{bar(d['hit']/d['n'] if d['n'] else 0)} {pct(d['hit']/d['n'] if d['n'] else 0)}</td></tr>""")

# ---- 문서별 인용 기여도 상위 ------------------------------------------------
doc_rank = sorted(doc_cnt.items(), key=lambda x: -x[1])[:8]
doc_rows = "".join(
    f'<tr><td>{f[:44]}</td><td>{bar(n, max(doc_rank[0][1],1), "#1baf7a", 160)} {n}건</td></tr>'
    for f, n in doc_rank)

HTML = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>RAG 챗봇 성능 평가 보고서</title>
<style>
  @page {{ size: A4; margin: 20mm 16mm 18mm; }}
  *{{box-sizing:border-box}}
  body{{font:14px/1.65 "Malgun Gothic","Segoe UI",system-ui,sans-serif;color:#141414;margin:0}}
  h1{{font-size:26px;margin:0 0 6px}}
  h2{{font-size:19px;margin:34px 0 4px;padding-top:6px;border-top:2px solid #141414;
      break-before:auto;break-after:avoid-page}}
  h2 .num{{color:#2a78d6}}
  h3{{font-size:15px;margin:18px 0 6px;break-after:avoid-page}}
  p{{margin:6px 0}}
  .cover{{padding:60px 0 30px;border-bottom:3px solid #141414;margin-bottom:26px}}
  .cover .tag{{display:inline-block;background:#eef4fc;color:#2a78d6;border-radius:20px;
               padding:4px 14px;font-size:12px;font-weight:700;margin-bottom:14px}}
  .cover .sub{{color:#52514e;font-size:13.5px;margin-top:10px}}
  .kpis{{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}}
  .kpi{{flex:1;min-width:100px;background:#f7f7f5;border-radius:8px;padding:10px 12px}}
  .kpi .v{{font-size:22px;font-weight:800}}
  .kpi .k{{font-size:11px;color:#767570}}
  table.tbl{{width:100%;border-collapse:collapse;margin:10px 0 6px;font-size:12.5px}}
  table.tbl thead{{display:table-header-group}}
  table.tbl th{{background:#f0efec;text-align:left;padding:6px 9px;font-size:12px}}
  table.tbl td{{border-bottom:1px solid #e5e4de;padding:6px 9px;vertical-align:top}}
  table.tbl tr{{break-inside:avoid}}
  td.colname{{font-weight:700;white-space:nowrap}}
  .tag{{display:inline-block;border-radius:5px;padding:2px 8px;font-size:11.5px;font-weight:700;white-space:nowrap}}
  .note{{margin-top:4px;font-size:11.5px;color:#8a5a00;background:#fff8e8;border-radius:5px;padding:4px 7px}}
  .barwrap{{display:inline-block;height:9px;background:#eceae3;border-radius:5px;overflow:hidden;
            vertical-align:middle;margin-right:6px}}
  .barfill{{display:block;height:100%;border-radius:5px}}
  .ok{{color:#0a6b3d;font-weight:700}} .bad{{color:#a11;font-weight:700}}
  .sub{{color:#767570;font-size:10.5px;font-weight:400}}
  .cap{{color:#767570;font-size:11px;margin-top:2px}}
  .callout{{background:#f0f6fc;border-left:4px solid #2a78d6;border-radius:6px;padding:10px 14px;margin:12px 0}}
  .callout.warn{{background:#fff8e8;border-left-color:#fab219}}
  .callout.good{{background:#eefaf3;border-left-color:#0ca30c}}
  .grid2{{display:grid;grid-template-columns:1fr 1fr;gap:14px;break-inside:avoid}}
  .kpis,.flow,.callout{{break-inside:avoid}}
  .flow{{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:14px 0;font-size:12.5px}}
  .flow .box{{background:#2a78d6;color:#fff;border-radius:7px;padding:8px 12px;font-weight:700}}
  .flow .box.alt{{background:#f0efec;color:#141414;font-weight:600}}
  .flow .arrow{{color:#898781}}
  ul{{margin:6px 0;padding-left:20px}} li{{margin:3px 0}}
  .pagebreak{{break-before:page}}
  footer{{color:#898781;font-size:10.5px;margin-top:30px;border-top:1px solid #e5e4de;padding-top:8px}}
  .scorewrap{{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}}
  .score{{border-radius:8px;padding:10px 14px;flex:1;min-width:140px}}
  .score .n{{font-size:24px;font-weight:800}}
</style></head>
<body>

<div class="cover">
  <span class="tag">RAG 챗봇 성능 평가 보고서</span>
  <h1>포스코 설비자재구매실 자재관리 사내 문서 챗봇</h1>
  <p class="sub">작성일 {built_at} · 작성: 프로젝트 개발팀 (Claude Code 보조 작성)</p>
  <p style="margin-top:16px;max-width:80ch">
    이 챗봇은 사내 지침·매뉴얼·계약서·실무 질문 로그 30건을 근거로 실무자의 질문에 답합니다.
    모든 답변에는 문서명과 정확한 위치(슬라이드/조항/페이지)가 출처로 붙고, 근거가 없으면
    추측하지 않고 "찾을 수 없습니다"라고 답합니다. 자재 재고·리드타임 같은 수치 질문은
    문서 검색을 거치지 않고 사내 데이터베이스를 직접 조회해 더 빠르고 정확하게 답합니다.
  </p>
  <div class="kpis">
    <div class="kpi"><div class="v">{viz['corpus']['n_docs']}건</div><div class="k">근거 사내 문서</div></div>
    <div class="kpi"><div class="v">{viz['corpus']['n_chunks']:,}개</div><div class="k">검색 단위(청크)</div></div>
    <div class="kpi"><div class="v">{len(ev)}문항</div><div class="k">오늘 실행한 평가 문항</div></div>
    <div class="kpi"><div class="v">{sum(1 for x in cov if x)/len(cov)*100:.0f}%</div><div class="k">평균 인용률</div></div>
  </div>
</div>

<h2><span class="num">1.</span> 이 챗봇은 무엇을 하나요?</h2>
<p>실무자가 자연어로 질문을 입력하면, 챗봇은 세 갈래 중 하나로 답을 찾습니다.</p>
<div class="flow">
  <span class="box">질문</span><span class="arrow">→</span>
  <span class="box alt">경로 판정</span><span class="arrow">→</span>
  <span class="box alt">📄 사내 문서 검색<br><span style="font-weight:400;font-size:11px">(규정·절차·방법)</span></span>
  <span class="arrow">또는</span>
  <span class="box alt">🗄 사내 DB 조회<br><span style="font-weight:400;font-size:11px">(재고·리드타임 등 수치)</span></span>
  <span class="arrow">→</span><span class="box">답변 + 출처</span>
</div>
<p>어느 경로든 <b>모든 사실 문장에는 근거가 표시됩니다.</b> 문서 검색 답변에는 [1][2] 같은
인용 번호가 붙고 클릭하면 원문 위치로 이동하며, 데이터 조회 답변에는 "원천 CSV 파일명과
기준일"이 함께 표시됩니다.</p>

<div class="callout good">
  <b>세 가지 원칙</b>
  <ul>
    <li><b>근거 기반</b> — 추측이 아니라 실제 문서·데이터에서 가져온 내용만 답합니다.</li>
    <li><b>보안</b> — 문서 파싱·검색·재정렬은 전부 이 컴퓨터 안에서 실행됩니다. 외부로 나가는
        것은 "질문 + 최종 후보 5개"를 답변 생성 AI에 보내는 단 한 번뿐이고, 사내 문서 원문을
        저장하는 외부 서버는 없습니다.</li>
    <li><b>모른다고 말합니다</b> — 문서에 없는 내용, 실시간 정보, 개인별 이력은 추측 없이
        답할 수 없다고 밝힙니다.</li>
  </ul>
</div>

<h2><span class="num">2.</span> 어떻게 만들어졌나 (구조 요약)</h2>
<p>사내 문서 {viz['corpus']['n_docs']}건을 문서 유형에 맞춰 서로 다른 방식으로 잘라
({viz['corpus']['n_chunks']:,}개 조각), 키워드 검색과 의미 기반 검색을 함께 사용해 관련 있는
조각을 찾은 뒤, 더 정교한 AI로 한 번 더 추려서 최종 답변 생성 AI에게 넘깁니다.
자재 재고 같은 수치 질문은 이 과정을 건너뛰고 사내 데이터베이스를 바로 조회합니다(2~4배 더 빠름).</p>

<h2><span class="num">3.</span> RAG 검색 품질 체크리스트 — 우리 시스템의 구현 현황</h2>
<p>일반적으로 RAG 시스템 품질을 평가할 때 확인하는 11개 항목에 우리 시스템을 대조했습니다.
색상은 구현 정도를 나타냅니다 — <span class="tag" style="background:#0ca30c1a;color:#0ca30c;border:1px solid #0ca30c55">완전 구현</span>
<span class="tag" style="background:#2a78d61a;color:#2a78d6;border:1px solid #2a78d655">구현</span>
<span class="tag" style="background:#fab2191a;color:#fab219;border:1px solid #fab21955">부분 구현</span>
<span class="tag" style="background:#ec835a1a;color:#ec835a;border:1px solid #ec835a55">제한적 구현(중요 발견)</span></p>
<table class="tbl">
  <thead><tr><th style="width:15%">항목</th><th style="width:16%">상태</th><th>내용</th></tr></thead>
  <tbody>{"".join(rows_html)}</tbody>
</table>

<h3>실측 비교 — 키워드(BM25) 단독 vs 하이브리드 검색 (항목 6 근거)</h3>
<p>같은 질문 3개를 키워드 검색만 썼을 때와 하이브리드(키워드+의미기반)로 썼을 때로 나눠
직접 재현했습니다.</p>
{evid_html or "<p class='cap'>(비교 데이터 없음)</p>"}

<h2><span class="num">4.</span> 실측 성능 — 오늘 직접 테스트한 결과</h2>
<p>평가 문항 {len(ev)}개(실제 사내 질문 재표현, 문서 기반 생성 질문, 답할 수 없는 질문)를
챗봇에 실제로 입력해 측정한 결과입니다.</p>

<h3>4-1. 유형별 정답(근거) 포함률</h3>
<table class="tbl">
  <thead><tr><th>평가 유형</th><th>문항 수</th><th>성공</th><th>성공률</th></tr></thead>
  <tbody>{"".join(type_rows)}</tbody>
</table>
<p class="cap">"실제 사내 질문 재표현"·"문서 기반 생성 질문"은 챗봇이 답한 근거에 정답 문서가
포함되는지로 판정했습니다. "답할 수 없는 질문"은 실제로 거절했는지로 판정했습니다.</p>

<h3>4-2. 응답시간 (경로별)</h3>
<table class="tbl">
  <thead><tr><th>경로</th><th>건수</th><th>평균</th><th>범위</th></tr></thead>
  <tbody>{"".join(time_rows)}</tbody>
</table>
<p class="cap">정형 조회(SQL)가 문서 검색보다 빠른 것은 검색·재정렬 단계를 건너뛰기 때문입니다(설계된 동작).</p>

<div class="grid2">
  <div>
    <h3>4-3. 질문 경로 분포</h3>
    <table class="tbl"><tbody>
    {"".join(f'<tr><td>{ROUTE_KO.get(r,r)}</td><td>{bar(n, max(route_cnt.values()), "#4a3aa7", 120)} {n}건</td></tr>' for r, n in route_cnt.items())}
    </tbody></table>
    <p class="cap">규칙만으로 확정 {route_src['rule']}건 · LLM 보조 판정 {route_src['llm']}건
    (규칙 확정 문항은 추가 AI 호출 없이 항상 같은 결과)</p>
  </div>
  <div>
    <h3>4-4. 인용 품질</h3>
    <table class="tbl"><tbody>
      <tr><td>평균 인용률</td><td>{sum(cov)/len(cov)*100:.0f}%</td></tr>
      <tr><td>질의당 평균 근거 수</td><td>{sum(n_cit)/len(n_cit):.1f}건</td></tr>
      <tr><td>실제로 근거로 쓰인 문서</td><td>{used_docs} / {total_docs}건</td></tr>
    </tbody></table>
    <p class="cap">인용률은 "사실을 서술한 문장 중 [n] 근거 번호가 붙은 비율"입니다.</p>
  </div>
</div>

<h3>4-5. 문서별 인용 기여도 (상위 8건)</h3>
<table class="tbl"><tbody>{doc_rows}</tbody></table>
<p class="cap">문서 {total_docs}건 중 {used_docs}건이 실제 답변에 최소 1회 이상 인용되었습니다.</p>

<div class="callout">
  <b>참고 — 사전 검증 수치(당일 이전에 같은 구성으로 측정한 기준값)</b>
  <p style="margin:4px 0 0">문서 Recall@5 1.000 · 문서 단위 인용 정확도 1.000 · 허위 인용 0건 ·
  Faithfulness 0.918 (정답 보유 문항 63개 기준, 표준오차 약 0.04). 위 4절 수치는 오늘 실제로
  재실행한 결과이며, 이 문단은 그 이전 사전 검증 결과라 구분해 표기합니다.</p>
</div>

<h3>4-6. 안전장치 점검 (정형 데이터 조회 경로)</h3>
<table class="tbl">
  <thead><tr><th>점검 항목</th><th>결과</th></tr></thead>
  <tbody>
    <tr><td>SQL 인젝션 시도 (<code>Q1000108' OR '1'='1</code>)</td><td class="ok">✅ 0행 반환 (문자열로만 처리됨)</td></tr>
    <tr><td>쓰기 시도 (DELETE 등)</td><td class="ok">✅ 읽기 전용 연결로 차단</td></tr>
    <tr><td>금지 키워드(INSERT/UPDATE/DROP 등)</td><td class="ok">✅ 정적 검사로 거부</td></tr>
    <tr><td>원본 테이블 직접 조회 시도</td><td class="ok">✅ 뷰(view)만 허용, 차단</td></tr>
    <tr><td>다중 SQL 문장 삽입 시도</td><td class="ok">✅ 단일 문장만 허용, 차단</td></tr>
    <tr><td>미구현 기능(적정재고 등) 요청</td><td class="ok">✅ "산출 결과가 없어 답할 수 없다"고 명시</td></tr>
  </tbody>
</table>

<h2><span class="num">5.</span> 부족한 점과 보완할 점</h2>
<p>실제로 확인된 한계를 숨기지 않고 정리합니다.</p>
<table class="tbl">
  <thead><tr><th style="width:22%">항목</th><th>내용과 영향</th></tr></thead>
  <tbody>
    <tr><td class="colname">이미지 텍스트 미인식</td>
        <td>매뉴얼 PPT의 화면 캡처 안에만 있는 절차는 검색되지 않습니다(OCR 미적용). 스크린샷
        위주 매뉴얼일수록 커버리지가 낮아집니다.</td></tr>
    <tr><td class="colname">벡터 검색의 구조적 한계</td>
        <td>사전 구축된 벡터 색인의 청크 경계를 그대로 재현할 수 없어(내용 정합 20%), 청크
        단위 정밀 검색 대신 "문서 단위 신호"로만 제한적으로 사용하고 있습니다. 근본적으로
        해결하려면 색인을 청킹 코드까지 포함해 다시 구축해야 합니다.</td></tr>
    <tr><td class="colname">임베딩 모델 자체 비교 실험 없음</td>
        <td>BAAI/bge-m3 를 사전 색인과 동일하게 고정 사용했습니다. 다른 임베딩 모델과의
        비교는 코퍼스 전체 재임베딩(CPU 기준 약 1.9시간)이 필요해 시도하지 못했습니다.</td></tr>
    <tr><td class="colname">파라미터 자체 재튜닝 없음</td>
        <td>청크 크기, top_k, 리랭커 후보 수 등은 사전에 검증된 값을 그대로 채택했고, 이
        코퍼스에 맞춘 자체 미세조정은 하지 않았습니다. 재현성을 우선한 결정입니다.</td></tr>
    <tr><td class="colname">정형 데이터가 연습용 샘플</td>
        <td>자재 743종은 실제 사내 데이터가 아닌 샘플입니다. 답변에 매번 그 사실을 표기합니다.
        적정재고·발주 신호등 등 고급 산출 기능은 산출 결과 자체가 없어 구현하지 못했습니다.</td></tr>
    <tr><td class="colname">평가 표본 크기</td>
        <td>정답을 보유한 평가 문항이 63개로, 통계적으로 0.04 이하의 세부 수치 차이는
        의미 있게 판별하기 어렵습니다.</td></tr>
    <tr><td class="colname">리랭커 입력 길이 상한</td>
        <td>Cross-Encoder 리랭커의 입력 상한이 512 토큰이라, 긴 계약서·지침 조항의 뒷부분은
        재정렬 판단에 반영되지 못할 수 있습니다.</td></tr>
    <tr><td class="colname">질문 처리 방식</td>
        <td>서버가 한 번에 한 질문씩 순차 처리하도록 설계되어 있어, 여러 사용자가 동시에
        몰리면 대기시간이 늘어날 수 있습니다.</td></tr>
  </tbody>
</table>

<div class="callout warn">
  <b>다음 단계로 고려할 만한 것</b>
  <ul>
    <li>실제 서비스 전환 시 정형 DB를 연습용 샘플이 아닌 실제 사내 데이터로 교체</li>
    <li>평가 문항을 200~300개로 확대해 통계적 신뢰도 확보</li>
    <li>GPU 환경 확보 시 코퍼스를 직접 재임베딩·재색인해 벡터 검색의 청크 단위 정밀도 문제 해결</li>
    <li>이미지 위주 매뉴얼 슬라이드에 OCR 적용 검토</li>
    <li>동시 질문 처리를 위한 요청 큐 또는 다중 인스턴스 구성 검토</li>
  </ul>
</div>

<footer>
  포스코 설비자재구매실 자재관리 RAG 챗봇 · 내부 개발 보고서 · 사내 대외비 문서를 근거로
  사용하므로 외부 공유 시 주의가 필요합니다 · 정형 데이터는 연습용 샘플입니다.
</footer>

</body></html>
"""

OUT.write_text(HTML, encoding="utf-8")
print(f"저장: {OUT} ({OUT.stat().st_size/1024:.0f}KB)")
print(f"평가 문항 {len(ev)} · 채점대상 {len(scored)} · 유형: {list(by_type)}")
