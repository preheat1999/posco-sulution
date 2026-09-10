"""추가 파생 지표 검증 — FAQ 로그에서 새로 만들어낼 수 있는 것들.

(a) 질문 → 답변 소요일 (지식 응답 지연)
(b) FAQ 본문의 자재코드 ↔ 자재 마스터 교집합 (문서-정형 연결 실측)
(c) 답변 집중도 (익명 — 이름은 쓰지 않고 순위별 비중만)
(d) 문서 신선도 vs 질문 연도 (노후 근거 위험)
"""
import re
import sqlite3
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import file_meta

PKG = Path(__file__).resolve().parent.parent.parent / "Chatbot_Start_Package"
DOCS = PKG / "01_데이터" / "원본문서_30건"
DB = Path(__file__).resolve().parent.parent / "data" / "structured" / "materials.db"
CODE_RE = re.compile(r"(?<![A-Za-z0-9])Q[A-Z]?\d{6,8}(?![0-9])")

line = lambda: print("\n" + "=" * 78)


def load_faq_raw(path, sheet="raw"):
    import openpyxl
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        if ws.title.strip().lower() != sheet:
            continue
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        hi = next((i for i, r in enumerate(rows[:6])
                   if r and any(str(c).strip() == "질문/답변" for c in r if c)), 0)
        header = [str(c).strip() if c is not None else "" for c in rows[hi]]
        for r in rows[hi + 1:]:
            out.append({header[j]: (r[j] if j < len(r) else None)
                        for j in range(len(header)) if header[j]})
    wb.close()
    return out


F = DOCS / "260810_설비자재구매실_구매지원 Assistant 포스위키 질의응답 내용.xlsx"
recs = load_faq_raw(F)
print(f"260810 raw 시트 {len(recs)}행 로드")

# ---------------------------------------------------------------- (a)
line()
print("[a] 질문 → 답변 소요일 (지식이 돌아오기까지 걸린 시간)")


def parse_dt(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    s = str(v).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:19], fmt)
        except ValueError:
            continue
    return None


threads = defaultdict(lambda: {"q": [], "a": []})
prev = None
for r in recs:
    title = str(r.get("제목") or "").strip()
    if not title:
        continue
    key = title
    dt = parse_dt(r.get("등록일"))
    role = str(r.get("질문/답변") or "")
    if dt:
        threads[key]["q" if "질문" in role else "a"].append(dt)

lags = []
for k, v in threads.items():
    if v["q"] and v["a"]:
        lag = (min(v["a"]) - min(v["q"])).total_seconds() / 86400
        if -1 <= lag <= 400:
            lags.append(lag)
if lags:
    lags.sort()
    n = len(lags)
    print(f"   측정 가능 스레드 {n}건")
    print(f"   평균 {statistics.mean(lags):.1f}일 · 중앙 {lags[n//2]:.1f}일"
          f" · 최소 {lags[0]:.2f}일 · 최대 {lags[-1]:.1f}일")
    band = Counter()
    for x in lags:
        band["당일" if x < 1 else "1~3일" if x < 3 else "3~7일" if x < 7
             else "7~30일" if x < 30 else "30일 이상"] += 1
    for k in ("당일", "1~3일", "3~7일", "7~30일", "30일 이상"):
        if band[k]:
            print(f"     {k:8s} {band[k]:5d}건 {band[k]/n:5.1%}")
    print(f"   → 90 분위 {lags[int(n*0.9)]:.1f}일 · 95 분위 {lags[int(n*0.95)]:.1f}일")
else:
    print("   측정 불가")

# ---------------------------------------------------------------- (b)
line()
print("[b] FAQ 본문의 자재코드 ↔ 자재 마스터 교집합 (문서-정형 연결)")
codes = Counter()
for r in recs:
    for m in CODE_RE.finditer(str(r.get("내용") or "") + " " + str(r.get("제목") or "")):
        codes[m.group(0).upper()] += 1
conn = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
master = {r[0].upper() for r in conn.execute("SELECT Item FROM master")}
inter = set(codes) & master
print(f"   FAQ 본문에서 추출한 자재코드 {len(codes)}종 (총 언급 {sum(codes.values())}회)")
print(f"   자재 마스터(743종)와 교집합: {len(inter)}종"
      f" ({len(inter)/max(len(codes),1):.1%} of FAQ 코드,"
      f" {len(inter)/len(master):.1%} of 마스터)")
print("   FAQ 에서 가장 많이 언급된 코드 상위 8 (마스터 보유 여부):")
for c, n in codes.most_common(8):
    print(f"     {c:12s} {n:4d}회  {'마스터O' if c in master else '마스터X'}")
if inter:
    rows = conn.execute(
        "SELECT Item, StockDept, UnitCost FROM master WHERE upper(Item) IN (%s)"
        % ",".join("?" * len(inter)), tuple(inter)).fetchall()
    print(f"   교집합 자재의 재고금액 합: "
          f"{sum((r[1] or 0)*(r[2] or 0) for r in rows)/1e8:.2f}억")

# ---------------------------------------------------------------- (c)
line()
print("[c] 답변 집중도 (익명 — 이름 대신 순위만 쓴다)")
answerers = Counter()
for r in recs:
    if "답변" in str(r.get("질문/답변") or ""):
        who = str(r.get("등록자정보") or "").strip()
        if who:
            answerers[who] += 1
tot = sum(answerers.values())
if tot:
    vals = sorted(answerers.values(), reverse=True)
    print(f"   답변 {tot}건 · 답변자 {len(answerers)}명")
    for k in (1, 5, 10, 20):
        if len(vals) >= k:
            print(f"     상위 {k:2d}명이 전체 답변의 {sum(vals[:k])/tot:5.1%}")
    print(f"   1건만 답변한 사람 {sum(1 for v in vals if v==1)}명"
          f" ({sum(1 for v in vals if v==1)/len(vals):.0%})")
    print("   ※ 이름은 시각화에 넣지 않는다. '상위 N명 비중' 만 쓴다.")

# ---------------------------------------------------------------- (d)
line()
print("[d] 문서 신선도 vs 질문 연도 (노후 근거 위험)")
docs = []
for p in sorted(DOCS.iterdir()):
    m = file_meta(p)
    docs.append((m["date"] or "-", m["doc_category"], p.name))
dated = [d for d in docs if d[0] != "-"]
print(f"   파일명에서 날짜를 얻은 문서 {len(dated)}/{len(docs)}건")
byyear = Counter(d[0][:4] for d in dated)
for y in sorted(byyear):
    print(f"     {y}  {'█'*byyear[y]} {byyear[y]}건")
print("   날짜 없는 문서(개정 시점 불명):")
for d in docs:
    if d[0] == "-":
        print(f"     {d[2][:60]}")
conn.close()
print("\n완료")
