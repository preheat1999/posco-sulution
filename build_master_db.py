#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""build_master_db.py · 생성기. 이 프로젝트에 생성기는 이것 하나뿐이다.

여러 개로 나누면 한 파일만 옛 값으로 남아서 화면마다 다른 답을 하게 된다.
지난 리허설에서 실제로 그랬다 (자재 검색만 보험품 441종, 나머지는 302종).

입력   본선_반출 최종본/데이터/  CSV 11개 + JSON 3개
출력   assets/db-master.js  db-derived.js  db-biz.js  plan-data.js   브라우저용
       db/*.json  db/csv/*.csv  db/posco_mtrl.sqlite                배포용 공통 DB
       db/BUILD_REPORT.txt                                          검산 결과

브라우저용과 배포용을 **같은 함수에서** 낸다. 두 벌로 나누면 알고리즘 담당이
보는 값과 화면이 보는 값이 갈린다. 그게 이 프로젝트가 한 번 크게 틀린 지점이다.

실행
    PYTHONHASHSEED=0 PYTHONIOENCODING=utf-8 python -B build_master_db.py

PYTHONHASHSEED=0 을 빼면 집합 순서가 달라져 결과가 흔들린다.
결과는 콘솔이 아니라 db/BUILD_REPORT.txt 로 낸다 (Windows 콘솔에서 한글이 깨진다).
"""

import csv
import io
import json
import math
import os
import re
import sqlite3
import sys
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "본선_반출 최종본", "데이터")
# 알고리즘 담당에게 받은 파일을 두는 곳. 같은 이름이 있으면 반출본 대신 이걸 읽는다.
# 반출 폴더는 읽기 전용으로 남긴다 · 무엇이 주최측 값이고 무엇이 우리 값인지
# 심사에서 답할 수 있어야 한다
ALGO_IN = os.path.join(ROOT, "algo_in")
USED_ALGO = []
ASSETS = os.path.join(ROOT, "assets")
DB = os.path.join(ROOT, "db")
DB_CSV = os.path.join(DB, "csv")
REPORT = os.path.join(DB, "BUILD_REPORT.txt")

# 세션 부서. 반출 데이터에는 부서가 하나뿐이지만 PK 는 두 칸으로 유지한다
DEPT = "SEO26FF"

# 휴지구분 -> WO 번호에 쓰는 두 글자. 원천 코드 체계를 따른다
KIND_CODE = {"대수리": "AD", "중수리": "MR", "정기수리": "SD",
             "교체휴지": "CB", "공정휴지": "SB", "합리화": "RM"}

log = []


def say(s=""):
    log.append(s)


# ---------------------------------------------------------------- 타입 복원

def load_schema():
    with io.open(os.path.join(SRC, "스키마.json"), encoding="utf-8") as f:
        return json.load(f)


def cast(val, typ):
    """CSV 는 값을 전부 문자열로 만든다. 스키마가 시키는 대로 되돌린다.

    리허설에서 holdStd 하나가 숫자 1 대신 문자열 '1' 로 남아 102행이 어긋났다.
    이 값은 보험품 목표 산식의 max(raw, 설치수기준, 1) 에 들어가므로
    문자열로 두면 산식이 조용히 틀린다.
    「돌아간다」 와 「같은 값이 나온다」 는 다르다.
    """
    t = (typ or "str").split()[0]  # 스키마에 설명이 붙어 있는 칸이 있다
    s = (val or "").strip()
    if t == "num":
        if s == "":
            return None
        f = float(s)
        return int(f) if f == int(f) else f
    if t == "bool":
        return s == "O"
    if t == "list;":
        return [x for x in s.split(";") if x != ""]
    if t == "date":
        return s or None
    return s or None


def src_path(name):
    """받은 폴더에 같은 이름이 있으면 그것을 쓴다. 어느 것을 썼는지 기록한다."""
    over = os.path.join(ALGO_IN, name)
    if os.path.isfile(over):
        if name not in USED_ALGO:
            USED_ALGO.append(name)
        return over
    return os.path.join(SRC, name)


def read_csv(name, schema):
    cols = schema[name]
    path = src_path(name)
    # CSV 는 UTF-8 BOM 이다. utf-8-sig 로 열지 않으면 첫 컬럼명에 BOM 이 붙는다
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        rows = []
        for raw in csv.DictReader(f):
            row = {}
            for k, v in raw.items():
                if k is None:
                    continue
                row[k] = cast(v, cols.get(k, "str"))
            rows.append(row)
    return rows


def read_json(name):
    # BOM 이 붙어 오는 경우가 있다. utf-8-sig 로 열면 둘 다 읽힌다
    with io.open(src_path(name), encoding="utf-8-sig") as f:
        return json.load(f)


# ---------------------------------------------------------------- 산식 공용

def num(v):
    return 0.0 if v is None else float(v)


def due_date_of(stop_start, lt_mean, lt_std, lead):
    """발주 마감일 = 정지시작일 - (리드타임평균 + 선행일수 + 0.5 x 리드타임편차)

    내림(floor)이다. 리허설 값(QOC Servo 합리화 2026-09-06 -> 마감 2025-11-20 ·
    초과 287일)이 내림에서만 정확히 재현된다. round 로 하면 하루씩 밀린다.
    """
    off = math.floor(num(lt_mean) + lead + 0.5 * num(lt_std))
    return date.fromisoformat(stop_start) - timedelta(days=off)


def tone_of(left):
    """건강도 표정. 색만으로 구분하지 않으므로 표정도 값으로 정해 둔다.

    left 가 None 은 마감일이 없는 상태(자재 확보)다. fine 으로 둔다.
    자바스크립트에서 null < 3 은 참이라, null 을 먼저 거르지 않으면
    자재 확보 건이 「지금 신청」 으로 세어진다. 4건이 6건이 됐던 버그다.
    """
    if left is None:
        return "fine"
    if left >= 7:
        return "fine"
    if left >= 3:
        return "soon"
    return "over"


# ---------------------------------------------------------------- 층 만들기

def read_both_targets():
    """algo_in/06_목표재고_양속성.csv → {(q, dept): {targetIns, ...}}.

    스키마에 없는 파일이라 read_csv 를 쓰지 않는다. 있으면 싣고 없으면 빈 사전이다.
    이 값은 **사람이 속성을 바꾼 행에만** 쓴다 · 바꾸지 않은 행은 06 의 target 그대로다.
    """
    path = os.path.join(ALGO_IN, "06_목표재고_양속성.csv")
    if not os.path.exists(path):
        return {}
    out = {}
    with io.open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            out[(r["q"], r["dept"])] = {
                "targetIns": int(float(r["targetIns"])), "reasonIns": r["reasonIns"],
                "signalIns": r["signalIns"], "statusIns": r["statusIns"],
                "targetPln": int(float(r["targetPln"])), "reasonPln": r["reasonPln"],
                "signalPln": r["signalPln"], "statusPln": r["statusPln"],
            }
    return out


def build():
    schema = load_schema()

    depts = read_csv("01_부서.csv", schema)
    materials = read_csv("02_자재_정본.csv", schema)
    equipment = read_csv("03_설비.csv", schema)
    maintenance = read_csv("04_정비계획.csv", schema)
    attr = read_csv("05_속성판정_파생.csv", schema)
    stock = read_csv("06_적정재고_파생.csv", schema)
    pool = read_csv("07_정체자재.csv", schema)
    returns = read_csv("08_반납_거래상태.csv", schema)
    purchase = read_csv("09_구매신청_거래상태.csv", schema)
    tags = read_csv("10_QR태그.csv", schema)
    related = read_csv("11_연관자재.csv", schema)

    spec = read_json("명세상수.json")
    summary = read_json("요약값.json")

    asof = spec.get("asof")

    # 속성 두 가지 각각의 목표재고 · 엔진(feat/algo engine.py)을 전 품목 보험품 ·
    # 전 품목 계획품으로 각각 돌려 구운 값이다. 없으면 그냥 넘어간다 (예전 db 도 열려야 한다)
    both = read_both_targets()
    if both:
        n = 0
        for r in stock:
            b = both.get((r["q"], r["dept"]))
            if not b:
                continue
            r.update(b)
            n += 1
        say("       양속성 목표재고 실은 행 %d / %d" % (n, len(stock)))

    # trend 는 세미콜론 24개다. 스키마가 list; 로 잡아 주지만 원소는 문자열로 남는다
    for r in stock:
        r["trend"] = [int(x) if str(x).lstrip("-").isdigit() else float(x)
                      for x in (r.get("trend") or [])]

    master = {
        "meta": {
            "asof": asof,
            "source": "본선_반출 최종본/데이터 · CSV 11개 (더미 데이터)",
            "note": "현재고를 저장하지 않는다. stockDept(스냅샷) + Σ stock_transactions 로 계산한다",
            "pk": ["q", "dept"],
            "counts": {
                "materials": len(materials), "depts": len(depts),
                "equipment": len(equipment), "maintenance": len(maintenance),
                "maintenanceAll": 20104,  # 원천 행수. 우리 부서 · 기준일 이후만 반출됐다
            },
        },
        "depts": depts,
        "materials": materials,
        "equipment": equipment,
        "maintenance": maintenance,
    }

    derived = {
        "meta": {
            "asof": asof,
            "source": "알고리즘 담당 산출 · 2층 파생",
            "note": "화면은 산식을 만들지 않는다. meta.spec 에서 읽는다",
            "spec": spec,
        },
        "summary": summary,
        "attr": attr,
        "stock": stock,
        "pool": pool,
    }

    # 연관자재는 「이 자재와 함께 나가는 자재」 로 묶어 둔다.
    # 화면이 매번 743건을 훑지 않게 자재별 사전으로 낸다. 평면 배열은 CSV 왕복용으로 남긴다
    sets = {}
    for r in related:
        sets.setdefault(r["q"], []).append(
            {"q": r["rel"], "rate": r.get("rate"), "why": r.get("why")})

    biz = {
        "meta": {
            "asof": asof,
            "note": "여기에는 자재의 정체가 없다. 품명 · 단가 · 리드타임 · 등급은 정본에만 있다. "
                    "코드로 정본을 조인해서 쓴다",
        },
        "returns": returns,
        "purchase": purchase,
        "tags": tags,
        "sets": sets,
        "setRows": related,
    }

    plan = build_plan(materials, equipment, maintenance, stock, spec, asof)
    return master, derived, biz, plan, schema


def build_plan(materials, equipment, maintenance, stock, spec, asof):
    """정비계획 화면 데이터. 화면에서 마감일을 계산하지 않는다. 여기서 다 낸다.

    선행일수를 여기에 다시 적지 않는다. 명세상수.json 의 signalPln 문장에서 뽑는다.
    지난 리허설에서 검사기 쪽 값만 옛날 것(교체휴지 14 · 공정휴지 없음)으로
    남아 있었다. 지금 WO 가 합리화와 대수리뿐이라 드러나지 않았을 뿐이다.
    """
    lead = parse_lead_days(spec)
    base = date.fromisoformat(asof)

    mat = {r["q"] + "|" + r["dept"]: r for r in materials}
    stk = {r["q"] + "|" + r["dept"]: r for r in stock}
    eq_items = {r["name"]: [q for q in (r.get("items") or []) if q + "|" + DEPT in mat]
                for r in equipment}

    wos = []
    seen_wo = {}
    for r in maintenance:
        items = eq_items.get(r["eq"], [])
        need_qs = [q for q in items if num(stk.get(q + "|" + DEPT, {}).get("need")) > 0]

        # WO 마감일은 발주 필요 자재 중 「가장 일찍 걸어야 하는 것」 이다.
        # 리드타임이 가장 긴 자재가 마감을 정한다. 그래서 min 이다
        per = []
        for q in need_qs:
            m = mat[q + "|" + DEPT]
            per.append((due_date_of(r["stopStart"], m.get("ltMean"), m.get("ltStd"),
                                    lead.get(r["kind"], 0)), q))
        due = min(per)[0] if per else None
        driver = min(per)[1] if per else None

        lts = [num(mat[q + "|" + DEPT].get("ltMean")) for q in items]
        left = (due - base).days if due else None

        # 같은 (설비 · 휴지구분 · 정지시작일) 이 두 줄인 데이터가 있다 (12건).
        # WO 번호가 겹치면 화면에서 같은 카드가 두 장 뜬 것처럼 보인다
        no = wo_no(r["eq"], r["kind"], r["stopStart"])
        seen_wo[no] = seen_wo.get(no, 0) + 1
        if seen_wo[no] > 1:
            no = "%s-%d" % (no, seen_wo[no])

        wos.append({
            "wo": no,
            "eq": r["eq"], "kind": r["kind"],
            "stopStart": r["stopStart"], "reStart": r.get("reStart"),
            "planDate": r["stopStart"],       # 화면이 부르는 이름
            "hours": r.get("hours"), "crew": r.get("crew"),
            "factory": r.get("factory"), "line": r.get("line"), "dept": r.get("dept"),
            "mats": items,
            "needQs": need_qs,
            "matCount": len(items), "needCount": len(need_qs),
            "driver": driver,                 # 마감일을 정한 자재
            "dueDate": due.isoformat() if due else None,
            "left": left,
            "tone": tone_of(left),
            "ltMean": round(sum(lts) / len(lts), 1) if lts else 0,
            # 실데이터에서 작업내용 채움률이 0.0% 였다. 숨기지 않고 그대로 적는다
            "work": None,
        })

    # 급한 것이 위로. 자재 확보(마감일 없음)는 맨 아래
    order = {"over": 0, "soon": 1, "fine": 2}
    wos.sort(key=lambda w: (order[w["tone"]], w["left"] if w["left"] is not None else 10 ** 6,
                            w["stopStart"], w["eq"]))

    tone_count = {"over": 0, "soon": 0, "fine": 0}
    for w in wos:
        tone_count[w["tone"]] += 1

    return {
        "meta": {
            "asof": asof,
            "formula": "발주 마감일 = 정지시작일 - floor(리드타임평균 + 선행일수 + 0.5 x 리드타임편차)",
            "leadDays": lead,
            "woNote": "WO 번호는 원천에 없다. 설비 · 휴지구분 · 정지시작일로 만든 표시용 식별자다",
            "scope": "내 담당 = 우리 부서 설비에 걸리는 기준일 이후 정비계획 전건. "
                     "원천 20,104행 중 156행만 반출됐다",
            "dueNote": "WO 마감일은 발주 필요 자재 중 가장 이른 마감일이다. "
                       "발주 필요가 없으면 마감일이 없다 (자재 확보)",
            "counts": {"wos": len(wos), "tone": tone_count,
                       "mats": len({q for w in wos for q in w["mats"]})},
        },
        "wos": wos,
    }


def parse_lead_days(spec):
    """선행일수 6종을 명세상수의 문장에서 뽑는다. 상수는 한 곳에만 둔다."""
    txt = " ".join(spec.get("signalPln") or [])
    found = dict(re.findall(r"([가-힣]+)\s+(\d+)", txt))
    lead = {k: int(v) for k, v in found.items() if k in KIND_CODE}
    missing = [k for k in KIND_CODE if k not in lead]
    if missing:
        raise SystemExit("명세상수에서 선행일수를 못 찾았다 · " + ", ".join(missing))
    return lead


def wo_no(eq, kind, stop):
    """M + yymmdd + 휴지코드 + 2자리. 원천에 WO 번호가 없어 만든 표시용 식별자다.

    설비명에서 낸 두 자리는 파이썬 hash 를 쓰지 않는다.
    PYTHONHASHSEED 에 따라 값이 흔들려 같은 데이터에서 다른 번호가 나온다.
    """
    y = stop[2:4] + stop[5:7] + stop[8:10]
    chk = sum(ord(c) for c in eq) % 100
    return "M%s%s%02d" % (y, KIND_CODE.get(kind, "XX"), chk)


# ---------------------------------------------------------------- 내보내기

def js_dump(obj):
    # 한글을 이스케이프하지 않는다. 화면 소스를 사람이 읽을 수 있어야 한다
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def write_js(name, header, var, obj, tail=""):
    path = os.path.join(ASSETS, name)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* %s\n *\n" % name)
        for line in header:
            f.write(" * %s\n" % line)
        f.write(" *\n * build_master_db.py 가 만든다. 손으로 고치지 않는다.\n */\n")
        f.write("window.%s = %s;\n" % (var, js_dump(obj)))
        if tail:
            f.write(tail)
    return path


# db-biz.js 뒤에 붙는다. 업무 화면에 나오는 자재코드를 한 곳에서 낸다.
# 불변식 2(업무 화면 자재 ∩ 분석 화면 자재 ≠ ∅)를 화면에서도 확인할 수 있어야 한다
BIZ_TAIL = """
/* 업무 화면에 등장하는 자재코드 전부. 정본과의 교집합을 확인할 때 쓴다 */
window.DB_BIZ.codes = function () {
  var out = {}, b = window.DB_BIZ, i, k;
  for (i = 0; i < b.returns.length; i++) { out[b.returns[i].q] = 1; }
  for (i = 0; i < b.purchase.length; i++) { out[b.purchase[i].q] = 1; }
  for (i = 0; i < b.tags.length; i++) { out[b.tags[i].q] = 1; }
  for (k in b.sets) {
    if (!Object.prototype.hasOwnProperty.call(b.sets, k)) { continue; }
    out[k] = 1;
    for (i = 0; i < b.sets[k].length; i++) { out[b.sets[k][i].q] = 1; }
  }
  return Object.keys(out).sort();
};

/* 이 자재와 함께 나가는 자재. 없으면 빈 배열이다 */
window.DB_BIZ.related = function (q) {
  return (window.DB_BIZ.sets && window.DB_BIZ.sets[q]) || [];
};
"""


def write_json(path, obj):
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    return path


def write_csv(name, rows, cols):
    """배포용 CSV 를 다시 낸다. 타입이 복원된 뒤의 값이라 원본과 대조하기 좋다."""
    path = os.path.join(DB_CSV, name)
    # Excel 에서 한글이 깨지지 않게 UTF-8 BOM 으로 낸다
    with io.open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            out = {}
            for c in cols:
                v = r.get(c)
                if isinstance(v, list):
                    v = ";".join(str(x) for x in v)
                elif isinstance(v, bool):
                    v = "O" if v else "X"
                elif v is None:
                    v = ""
                out[c] = v
            w.writerow(out)
    return path


SQL_TABLES = {
    "depts": ("01_부서.csv", ["code"]),
    "materials": ("02_자재_정본.csv", ["q", "dept"]),
    "equipment": ("03_설비.csv", ["name"]),
    "maintenance": ("04_정비계획.csv", ["eq", "kind", "stopStart"]),
    "attr": ("05_속성판정_파생.csv", ["q", "dept"]),
    "stock": ("06_적정재고_파생.csv", ["q", "dept"]),
    "pool": ("07_정체자재.csv", ["q", "dept"]),
    "returns_tx": ("08_반납_거래상태.csv", ["q"]),
    "purchase_tx": ("09_구매신청_거래상태.csv", ["q"]),
    "qr_tags": ("10_QR태그.csv", ["q"]),
    "related": ("11_연관자재.csv", ["q", "rel"]),
}


def write_sqlite(master, derived, biz, plan, schema):
    """알고리즘 담당이 SQL · pandas 로 바로 붙을 수 있는 한 파일.

    컬럼 이름을 JS 자산과 **똑같이** 둔다. 이름을 바꾸면 양쪽 코드가 갈린다.
    테이블 이름만 영문이다. 배포 호스팅에서 한글 키가 깨진다.
    """
    path = os.path.join(DB, "posco_mtrl.sqlite")
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    cur = con.cursor()

    data = {
        "depts": master["depts"], "materials": master["materials"],
        "equipment": master["equipment"], "maintenance": master["maintenance"],
        "attr": derived["attr"], "stock": derived["stock"], "pool": derived["pool"],
        "returns_tx": biz["returns"], "purchase_tx": biz["purchase"],
        "qr_tags": biz["tags"], "related": biz["setRows"],
    }

    for table, (csv_name, pk) in SQL_TABLES.items():
        cols = [c for c in schema[csv_name] if not c.startswith("_")]
        decl = []
        for c in cols:
            t = (schema[csv_name][c] or "str").split()[0]
            kind = {"num": "REAL", "bool": "INTEGER"}.get(t, "TEXT")
            decl.append('"%s" %s' % (c, kind))

        # 선언 PK 가 데이터에서 유일하지 않은 표가 있다 (04_정비계획 12건 중복).
        # 데이터를 고치지 않는다. 대리키로 받고 선언 PK 에는 색인만 건다.
        # PK 로 밀어 넣으면 INSERT 가 터지거나 12행이 조용히 사라진다
        keys = [tuple(str(r.get(c)) for c in pk) for r in data[table]]
        unique_pk = len(keys) == len(set(keys))
        if unique_pk:
            decl.append('PRIMARY KEY (%s)' % ", ".join('"%s"' % c for c in pk))
        else:
            decl.insert(0, '"rid" INTEGER PRIMARY KEY AUTOINCREMENT')
        cur.execute('CREATE TABLE "%s" (%s)' % (table, ", ".join(decl)))
        if not unique_pk:
            cur.execute('CREATE INDEX "ix_%s_pk" ON "%s" (%s)'
                        % (table, table, ", ".join('"%s"' % c for c in pk)))
        rows = []
        for r in data[table]:
            vals = [] if unique_pk else [None]  # 대리키는 저장소가 붙인다
            for c in cols:
                v = r.get(c)
                if isinstance(v, list):
                    v = ";".join(str(x) for x in v)
                elif isinstance(v, bool):
                    v = 1 if v else 0
                vals.append(v)
            rows.append(vals)
        cur.executemany('INSERT INTO "%s" VALUES (%s)'
                        % (table, ",".join("?" * len(rows[0]))), rows)

    # 3층은 브라우저(localStorage)에 쌓인다. 알고리즘 쪽에서도 같은 모양으로
    # 주고받을 수 있게 빈 테이블을 같이 둔다. 컬럼은 선언한 것만 통과한다
    cur.execute('CREATE TABLE "attribute_overrides" (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                'q TEXT, dept TEXT, newType TEXT, approvedBy TEXT, approvedAt TEXT, '
                'priorVerdict TEXT, reason TEXT)')
    cur.execute('CREATE TABLE "stock_transactions" (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                'q TEXT, dept TEXT, txnType TEXT, qty REAL, txnAt TEXT, processedBy TEXT, note TEXT)')
    cur.execute('CREATE TABLE "pooling_overrides" (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                'q TEXT, dept TEXT, action TEXT, by_ TEXT, at_ TEXT, note TEXT)')
    cur.execute('CREATE TABLE "pr_drafts" (seq INTEGER PRIMARY KEY AUTOINCREMENT, '
                'q TEXT, dept TEXT, data TEXT, by_ TEXT, at_ TEXT)')

    # 산식 · 요약 · 정비계획은 통째로 둔다. 화면과 알고리즘이 같은 것을 읽는다
    cur.execute('CREATE TABLE "meta" (k TEXT PRIMARY KEY, v TEXT)')
    cur.executemany('INSERT INTO "meta" VALUES (?,?)', [
        ("asof", master["meta"]["asof"]),
        ("pk", "q|dept"),
        ("spec", json.dumps(derived["meta"]["spec"], ensure_ascii=False)),
        ("summary", json.dumps(derived["summary"], ensure_ascii=False)),
        ("plan", json.dumps(plan, ensure_ascii=False)),
        ("master_meta", json.dumps(master["meta"], ensure_ascii=False)),
    ])

    # 조회를 자주 하는 축에만 색인을 둔다
    cur.execute('CREATE INDEX ix_stock_action ON "stock" (action)')
    cur.execute('CREATE INDEX ix_attr_verdict ON "attr" (verdict)')
    cur.execute('CREATE INDEX ix_mat_name ON "materials" (name)')
    con.commit()
    con.close()
    return path


# ---------------------------------------------------------------- 검산

def verify(master, derived, biz, plan, schema):
    """하나라도 어긋나면 멈추고 알린다. 조용히 진행하면 나중에 못 찾는다."""
    bad = []
    materials = master["materials"]
    attr, stock, pool = derived["attr"], derived["stock"], derived["pool"]
    summary = derived["summary"]
    asof = master["meta"]["asof"]

    def check(ok, msg):
        say(("  OK   " if ok else "  FAIL ") + msg)
        if not ok:
            bad.append(msg)

    say("[1] 행 수")
    check(len(materials) == 743, "자재 정본 743행 · 실제 %d" % len(materials))
    check(len(attr) == 743, "속성 판정 743행 · 실제 %d" % len(attr))
    check(len(stock) == 743, "적정재고 743행 · 실제 %d" % len(stock))
    check(len(pool) == 262, "정체 262행 · 실제 %d" % len(pool))
    check(len(master["depts"]) == 1, "부서 1행 · 실제 %d" % len(master["depts"]))
    check(len(master["equipment"]) == 14, "설비 14행 · 실제 %d" % len(master["equipment"]))
    check(len(master["maintenance"]) == 156, "정비계획 156행 · 실제 %d" % len(master["maintenance"]))

    say()
    say("[2] PK · 743 조합이 전체 모집단이다")
    mkeys = {r["q"] + "|" + r["dept"] for r in materials}
    check(len(mkeys) == 743, "정본 PK 중복 없음 · distinct %d" % len(mkeys))
    for label, rows in (("판정", attr), ("적정재고", stock), ("정체", pool)):
        keys = {r["q"] + "|" + r["dept"] for r in rows}
        check(keys <= mkeys, "%s 의 PK 가 전부 정본 안에 있다" % label)

    say()
    say("[3] 요약을 행에서 다시 센다 · 요약만 고치고 행은 안 고치는 실수를 잡는다")
    seed = {r["q"] + "|" + r["dept"]: r for r in materials}

    # 파생에 있는 PK 가 정본에 없을 수 있다. 그때 KeyError 로 죽으면
    # 「행수가 다르다」 대신 트레이스백이 뜬다. 검사기는 죽지 말고 알려야 한다
    orphan = [r["q"] + "|" + r["dept"] for r in stock if r["q"] + "|" + r["dept"] not in seed]
    check(not orphan, "적정재고의 PK 가 정본에 다 있다 · 없는 키 %d건 %s"
          % (len(orphan), orphan[:3]))

    act = {}
    for r in stock:
        if r["q"] + "|" + r["dept"] not in seed:
            continue
        # 조치 = target 과 stockDept 를 견준 결과다. 다시 계산해도 같아야 한다
        sd = num(seed[r["q"] + "|" + r["dept"]].get("stockDept"))
        tg = num(r.get("target"))
        a = "발주" if tg > sd else ("유지" if tg == sd else "감축")
        act[a] = act.get(a, 0) + 1
        if a != r.get("action"):
            bad.append("조치 불일치 %s|%s · 저장 %s · 재계산 %s" % (r["q"], r["dept"], r.get("action"), a))
    check(act == summary["action"], "조치 재계산 %s · 요약 %s" % (act, summary["action"]))

    vd = {}
    for r in attr:
        vd[r["verdict"]] = vd.get(r["verdict"], 0) + 1
    check(vd == summary["verdict"], "판정 재계산 %s" % vd)

    need_bad = [r["q"] for r in stock
                if r["q"] + "|" + r["dept"] in seed and
                num(r.get("need")) != max(0.0, num(r.get("target")) -
                                          num(seed[r["q"] + "|" + r["dept"]].get("stockDept")))]
    check(not need_bad, "need = max(0, target - stockDept) · 어긋난 행 %d" % len(need_bad))

    now_amt = round(sum(num(m.get("price")) * num(m.get("stockDept")) for m in materials))
    check(now_amt == summary["nowAmt"],
          "현행재고 Σ(price x stockDept) = %d · 요약 %d" % (now_amt, summary["nowAmt"]))

    zero_target = sum(1 for r in stock if num(r.get("target")) == 0)
    check(zero_target == summary["zeroTarget"],
          "목표0 %d · 요약 %d" % (zero_target, summary["zeroTarget"]))

    say()
    say("[4] 부서 · 신호 · 배제")
    dept_codes = {d["code"] for d in master["depts"]}
    check({r["dept"] for r in materials} <= dept_codes, "모든 dept 가 부서 표에 있다")
    sig = {r.get("signal") for r in stock}
    check({"red", "yellow", "green"} <= sig, "발주 신호 red · yellow · green 이 다 있다 · %s" % sorted(sig))
    qs_bad = [r["q"] for r in attr
              if r["q"].startswith("QS") and not (r["verdict"].startswith("배제") or
                                                  (r["verdict"] == "보험품" and r.get("path") == "QS 확정"))]
    check(not qs_bad, "QS 접두어 자재는 배제이거나 보험품(QS 확정) · 어긋난 건 %d" % len(qs_bad))

    say()
    say("[5] 타입이 복원됐는가 · 「돌아간다」 와 「같은 값이 나온다」 는 다르다")
    str_nums = []
    for r in materials:
        for c in ("holdStd", "stockDept", "price", "ltMean", "ltStd", "cycles", "stockAll", "suppliers"):
            if isinstance(r.get(c), str):
                str_nums.append("%s.%s" % (r["q"], c))
    check(not str_nums, "숫자 컬럼에 문자열이 남지 않았다 · 남은 것 %d" % len(str_nums))
    hs = [r for r in materials if r.get("holdStd") is not None]
    check(all(isinstance(r["holdStd"], (int, float)) for r in hs),
          "holdStd 가 숫자다 · 값이 있는 행 %d" % len(hs))
    tr_bad = [r["q"] for r in stock if len(r.get("trend") or []) not in (0, 24)]
    check(not tr_bad, "trend 가 24개다 · 어긋난 행 %d" % len(tr_bad))

    say()
    say("[6] 기준일이 한 곳에만 있는가")
    cfg = os.path.join(ASSETS, "config.js")
    cfg_date = None
    if os.path.exists(cfg):
        with io.open(cfg, encoding="utf-8") as f:
            m = re.search(r"BASE_DATE\s*:\s*'([0-9-]+)'", f.read())
            cfg_date = m.group(1) if m else None
    check(cfg_date == asof, "config.js BASE_DATE %s == 명세 asof %s" % (cfg_date, asof))

    say()
    say("[7] 정비계획 · 마감 초과가 나와야 시연이 된다")
    tc = plan["meta"]["counts"]["tone"]
    check(plan["meta"]["counts"]["wos"] == 156, "WO %d건" % plan["meta"]["counts"]["wos"])
    check(tc["over"] >= 3, "마감 초과 %d건 (3건 이상이어야 「지금 할 일」 이 생긴다)" % tc["over"])
    null_left_as_over = [w["wo"] for w in plan["wos"] if w["left"] is None and w["tone"] == "over"]
    check(not null_left_as_over, "마감일 없는 건이 「지금 신청」 으로 세어지지 않았다")

    say()
    say("[8] 글쓰기 규칙 · 데이터에 금지 문자가 있는가")
    dash = []
    for label, rows in (("materials", materials), ("attr", attr), ("stock", stock)):
        for r in rows:
            for k, v in r.items():
                if isinstance(v, str) and ("—" in v or "–" in v):
                    dash.append("%s.%s.%s" % (label, r.get("q"), k))
    check(not dash, "em-dash · en-dash 가 데이터에 없다 · 있는 칸 %d" % len(dash))

    say()
    say("[9] 선언 PK 가 데이터에서 유일한가")
    tables = {
        "01_부서.csv": master["depts"], "02_자재_정본.csv": materials,
        "03_설비.csv": master["equipment"], "04_정비계획.csv": master["maintenance"],
        "05_속성판정_파생.csv": attr, "06_적정재고_파생.csv": stock,
        "07_정체자재.csv": pool, "08_반납_거래상태.csv": biz["returns"],
        "09_구매신청_거래상태.csv": biz["purchase"], "10_QR태그.csv": biz["tags"],
        "11_연관자재.csv": biz["setRows"],
    }
    dup_found = []
    for name, rows in tables.items():
        pk = schema[name]["_pk"]
        keys = [tuple(str(r.get(c)) for c in pk) for r in rows]
        dup = len(keys) - len(set(keys))
        if dup:
            dup_found.append((name, "+".join(pk), dup))
            say("  주의  %s · PK %s 가 %d건 중복이다" % (name, "+".join(pk), dup))
        else:
            say("  OK   %s · PK %s 유일" % (name, "+".join(pk)))
    if dup_found:
        say("       -> 중복 표는 SQLite 에서 대리키(rid)로 받았다. 조인할 때 행이 불어난다.")
        say("          알고리즘 담당은 이 표를 GROUP BY 없이 조인하면 안 된다")

    say()
    say("[10] 반출 JSON 과 필드 단위 대조 · 리허설에서 holdStd 하나로 102행이 어긋났다")
    diff = compare_with_shipped(master, derived, biz)
    for line in diff["lines"]:
        say("  " + line)
    if USED_ALGO:
        # 받은 파일을 썼으면 불일치는 「알고리즘이 바꾼 값」 이다. 실패가 아니다.
        # 대신 어느 칸이 몇 건 바뀌었는지 적는다 · 심사에서 이 목록을 그대로 보여 준다
        say()
        say("  받은 파일을 썼으므로 위 불일치는 알고리즘이 바꾼 값이다 · 검산 실패가 아니다")
        for name in USED_ALGO:
            say("    받은 파일 · " + name)
        for tag, cols in field_delta(diff).items():
            for col, n in cols:
                say("    바뀐 칸 · %s.%s %d건" % (tag, col, n))
        check(True, "받은 파일 반영 · 필드 차이 %d건 (알고리즘 결과)" % diff["mismatch"])
    else:
        check(diff["mismatch"] == 0, "필드 불일치 %d건" % diff["mismatch"])

    return bad


def field_delta(diff):
    """어느 표의 어느 칸이 몇 건 바뀌었나. 대조 함수가 세어 둔 값을 정렬만 한다."""
    return dict((k, sorted(v.items(), key=lambda x: -x[1]))
                for k, v in diff.get("bycol", {}).items())


def compare_with_shipped(master, derived, biz):
    """반출본의 db-master.json · db-derived.json · db-biz.json 과 대조한다.

    같은 데이터의 구조 그대로가 같이 왔으니 안 쓰면 아깝다.
    CSV 에서 다시 만든 값이 원본과 같은지 필드 단위로 본다.
    """
    lines, mismatch, bycol = [], 0, {}
    pairs = [
        ("db-master.json", master, ["depts", "materials", "equipment", "maintenance"], ["q", "dept"]),
        ("db-derived.json", derived, ["attr", "stock", "pool"], ["q", "dept"]),
        ("db-biz.json", biz, ["returns", "purchase", "tags", "sets"], ["q"]),
    ]
    for fname, built, tables, pk in pairs:
        path = os.path.join(SRC, fname)
        if not os.path.exists(path):
            lines.append("SKIP %s 없음" % fname)
            continue
        with io.open(path, encoding="utf-8") as f:
            ship = json.load(f)
        for t in tables:
            a, b = built.get(t) or [], ship.get(t) or []
            # sets 는 자재별 사전이다. 배열과 같은 잣대로 재면 키 수를 행 수로 착각한다
            if isinstance(a, dict) or isinstance(b, dict):
                if a == b:
                    lines.append("%s.%s 자재 %d건 · 관계 %d건 모든 필드 일치"
                                 % (fname, t, len(a), sum(len(v) for v in a.values())))
                else:
                    lines.append("%s.%s 사전 불일치 · 재현 키 %s · 원본 키 %s"
                                 % (fname, t, sorted(a), sorted(b)))
                    mismatch += 1
                continue
            if len(a) != len(b):
                lines.append("%s.%s 행수 %d vs %d" % (fname, t, len(a), len(b)))
                mismatch += 1
                continue
            n = 0
            for ra, rb in zip(a, b):
                for k in set(list(ra.keys()) + list(rb.keys())):
                    va, vb = ra.get(k), rb.get(k)
                    if isinstance(va, float) and isinstance(vb, (int, float)):
                        same = abs(va - float(vb)) < 1e-9
                    else:
                        same = va == vb
                    if not same:
                        if n < 5:
                            lines.append("%s.%s 불일치 %s.%s · 재현 %r · 원본 %r"
                                         % (fname, t, ra.get(pk[0]), k, va, vb))
                        # 칸별로도 센다. 줄은 5개까지만 남기므로 여기서 세야 한다
                        bycol.setdefault(t, {})
                        bycol[t][k] = bycol[t].get(k, 0) + 1
                        n += 1
            if n:
                mismatch += n
                lines.append("%s.%s 필드 불일치 %d건" % (fname, t, n))
            else:
                lines.append("%s.%s %d행 모든 필드 일치" % (fname, t, len(a)))
    return {"lines": lines, "mismatch": mismatch, "bycol": bycol}


# ---------------------------------------------------------------- 본체

def main():
    for d in (ASSETS, DB, DB_CSV):
        if not os.path.isdir(d):
            os.makedirs(d)

    master, derived, biz, plan, schema = build()

    say("=" * 70)
    say("build_master_db.py · 생성 보고")
    say("기준일 %s · PK Qcode|DeptCode" % master["meta"]["asof"])
    say("=" * 70)
    say()

    made = []
    # 브라우저용
    made.append(write_js("db-master.js", [
        "1층 정본 · 사내 원장 스냅샷. 대회 내내 고정이다",
        "현재고를 저장하지 않는다. stockDept 는 스냅샷 시드다",
    ], "DB_MASTER", master))
    made.append(write_js("db-derived.js", [
        "2층 파생 · 알고리즘 초기 판정값. 대회 내내 고정이다",
        "meta.spec 에 명세 상수가 통째로 들어 있다. 화면은 산식을 여기서 읽는다",
    ], "DB_DERIVED", derived))
    made.append(write_js("db-biz.js", [
        "업무 거래 상태 · 불출일 · 물품상태 · 잔여 · 계정 · 위치 · 구매 가능 여부",
        "품명 · 단가 · 리드타임 · 등급을 여기 두지 않는다. 자재의 정체는 정본에만 있다",
    ], "DB_BIZ", biz, BIZ_TAIL))
    made.append(write_js("plan-data.js", [
        "정비계획 화면 데이터. 마감일은 여기서 다 계산했다",
        "BASE_DATE 를 여기서 정의하지 않는다. config.js 것을 읽는다",
    ], "PLAN", plan))

    # 배포용 공통 DB
    made.append(write_json(os.path.join(DB, "master.json"), master))
    made.append(write_json(os.path.join(DB, "derived.json"), derived))
    made.append(write_json(os.path.join(DB, "biz.json"), biz))
    made.append(write_json(os.path.join(DB, "plan.json"), plan))
    made.append(write_json(os.path.join(DB, "spec.json"), derived["meta"]["spec"]))
    made.append(write_json(os.path.join(DB, "summary.json"), derived["summary"]))
    made.append(write_json(os.path.join(DB, "schema.json"), schema))

    tables = {
        "01_부서.csv": master["depts"], "02_자재_정본.csv": master["materials"],
        "03_설비.csv": master["equipment"], "04_정비계획.csv": master["maintenance"],
        "05_속성판정_파생.csv": derived["attr"], "06_적정재고_파생.csv": derived["stock"],
        "07_정체자재.csv": derived["pool"], "08_반납_거래상태.csv": biz["returns"],
        "09_구매신청_거래상태.csv": biz["purchase"], "10_QR태그.csv": biz["tags"],
        "11_연관자재.csv": biz["setRows"],
    }
    for name, rows in tables.items():
        cols = [c for c in schema[name] if not c.startswith("_")]
        made.append(write_csv(name, rows, cols))
    made.append(write_sqlite(master, derived, biz, plan, schema))

    say("만든 파일 %d개" % len(made))
    for p in made:
        say("  %8d  %s" % (os.path.getsize(p), os.path.relpath(p, ROOT).replace("\\", "/")))
    say()

    bad = verify(master, derived, biz, plan, schema)

    say()
    say("=" * 70)
    if bad:
        say("검산 실패 %d건" % len(bad))
        for b in bad[:20]:
            say("  - " + b)
    else:
        say("검산 통과 · 문제 0건")
    say("=" * 70)
    say()
    say("[인계] 알고리즘 담당에게 주는 것")
    say("  db/README.md            규칙과 주고받을 것")
    say("  db/posco_mtrl.sqlite    SQL · pandas 진입점")
    say("  db/csv/ 11개            타입 복원된 CSV (UTF-8 BOM)")
    say("  db/schema.json          컬럼별 타입 · PK · 허용값")
    say("  validate_algorithm_csv.py  받은 CSV 를 넣기 전에 돌리는 검문소")

    with io.open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(log) + "\n")

    # 콘솔에는 영문만 낸다. Windows 콘솔에서 한글이 깨진다
    print("build ok. files=%d, problems=%d" % (len(made), len(bad)))
    print("report -> db/BUILD_REPORT.txt")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
