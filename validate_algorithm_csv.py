#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""validate_algorithm_csv.py · 알고리즘 담당에게 받은 CSV 를 넣기 전에 돌리는 검문소.

왜 필요한가
    받은 파일을 그냥 넣으면 화면이 반쪽만 보이거나, 더 나쁘게는
    **오류 없이 조용히 틀린 숫자**가 나온다.
    지난번에 holdStd 하나가 문자열로 남아 102행이 어긋났고,
    기준일이 두 곳(09-07 · 09-03)이라 마감일이 4일씩 밀렸다.
    둘 다 화면에서는 정상처럼 보였다.

쓰는 법
    python validate_algorithm_csv.py <받은폴더>
    python validate_algorithm_csv.py C:\\받은것\\2026-09-10

    통과하면 그 폴더의 파일을 본선_반출 최종본/데이터/ 에 덮고
    build_master_db.py 를 다시 돌린다.

    결과는 콘솔이 아니라 db/VALIDATE_REPORT.txt 로 낸다
    (Windows 콘솔에서 한글이 깨진다).

무엇을 보는가
    1  743행인가
    2  PK(q,dept)가 정본 743 조합과 정확히 같은가
    3  값이 허용 목록 안에 있는가 (verdict 5종 · signal 4종 · grade 4종 ...)
    4  action 을 target 과 stockDept 로 다시 계산해도 같은가
    5  need = max(0, target - stockDept) 인가
    6  요약값을 행에서 다시 세도 같은가
    7  숫자 컬럼이 문자열로 오지 않았는가
    8  기준일이 하나인가
    9  컬럼이 빠지거나 늘지 않았는가
   10  em-dash · en-dash 가 섞이지 않았는가
"""

import csv
import glob
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_DATA = os.path.join(ROOT, "본선_반출 최종본", "데이터")
REPORT = os.path.join(ROOT, "db", "VALIDATE_REPORT.txt")

# 파일 이름은 사람마다 다르게 온다. 번호나 이름 어느 쪽으로 와도 찾는다
PATTERNS = {
    "attr": ["05_*", "*판정*", "*classification*"],
    "stock": ["06_*", "*적정재고*", "*inventory*", "*target*"],
    "pool": ["07_*", "*정체*", "*stale*"],
    "spec": ["명세상수.json", "*spec*.json"],
    "summary": ["요약값.json", "*summary*.json"],
}

ENUMS = {
    "attr": {
        "verdict": ["보험품", "계획품", "회색지대", "배제-소모품", "배제-순환품"],
        "path": ["사전 배제", "QS 확정", "Spare Part 확정", "시계열 점수"],
        "conf": ["HIGH", "MEDIUM", "LOW"],
    },
    "stock": {
        "grade": ["S", "A", "B", "C"],
        "action": ["발주", "유지", "감축"],
        "signal": ["red", "yellow", "green", "gray"],
        "status": ["즉시발주", "발주임박", "여유", "충분", "재고불요", "재고충분"],
    },
    "pool": {
        "poolGrade": ["strong", "review", "medium"],
    },
}

# 이 컬럼이 문자열로 오면 산식이 조용히 틀린다
NUMERIC = {
    "attr": ["si", "sp", "cspScore"],
    "stock": ["target", "need", "amount", "dDays", "expect", "issues"],
    "pool": ["ageDays", "staleValue"],
}

log = []
problems = []


def say(s=""):
    log.append(s)


def check(ok, msg):
    say(("  OK   " if ok else "  FAIL ") + msg)
    if not ok:
        problems.append(msg)
    return ok


def warn(msg):
    say("  주의  " + msg)


def find(folder, key):
    for pat in PATTERNS[key]:
        hit = sorted(glob.glob(os.path.join(folder, pat)))
        hit = [h for h in hit if not os.path.isdir(h)]
        if key in ("spec", "summary"):
            hit = [h for h in hit if h.lower().endswith(".json")]
        else:
            hit = [h for h in hit if h.lower().endswith(".csv")]
        if hit:
            return hit[0]
    return None


def read_rows(path):
    """UTF-8 BOM 여부까지 같이 본다. Excel 에서 한글이 깨지는 원인이다."""
    with io.open(path, "rb") as f:
        head = f.read(3)
    bom = head == b"\xef\xbb\xbf"
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        rdr = csv.DictReader(f)
        rows = list(rdr)
        cols = rdr.fieldnames or []
    return rows, cols, bom


def as_num(v):
    """CSV 값이 숫자로 읽히는지 본다. 빈 칸은 None 이다."""
    s = (v or "").strip()
    if s == "":
        return None, True
    try:
        return float(s), True
    except ValueError:
        return None, False


def load_base():
    """정본 743 조합. 이것이 전체 모집단이고 기준이다."""
    path = os.path.join(BASE_DATA, "02_자재_정본.csv")
    if not os.path.exists(path):
        raise SystemExit("정본을 못 찾았다 · " + path)
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    seed = {}
    for r in rows:
        v, _ = as_num(r.get("stockDept"))
        seed[(r["q"], r["dept"])] = 0.0 if v is None else v
    return seed


def load_schema():
    with io.open(os.path.join(BASE_DATA, "스키마.json"), encoding="utf-8") as f:
        return json.load(f)


SCHEMA_FILE = {"attr": "05_속성판정_파생.csv", "stock": "06_적정재고_파생.csv",
               "pool": "07_정체자재.csv"}


def validate(folder):
    seed = load_base()
    schema = load_schema()
    base_keys = set(seed)
    say("=" * 70)
    say("받은 CSV 검문 · %s" % folder)
    say("정본 %d 조합이 기준이다" % len(base_keys))
    say("=" * 70)

    files = {k: find(folder, k) for k in PATTERNS}
    say()
    say("[0] 파일을 찾았는가")
    for k in ("attr", "stock", "pool", "spec", "summary"):
        p = files.get(k)
        if p:
            say("  OK   %-8s %s" % (k, os.path.basename(p)))
        elif k == "pool":
            warn("pool(정체) 파일이 없다. 정체 화면이 빈다. 나중에 받아도 된다")
        else:
            check(False, "%s 파일을 못 찾았다 (패턴 %s)" % (k, " · ".join(PATTERNS[k])))

    data = {}
    for k in ("attr", "stock", "pool"):
        if not files.get(k):
            continue
        rows, cols, bom = read_rows(files[k])
        data[k] = rows
        say()
        say("[%s] %s · %d행" % (k, os.path.basename(files[k]), len(rows)))
        check(bom, "UTF-8 BOM 이다 (없으면 Excel 에서 한글이 깨진다)")

        want = [c for c in schema[SCHEMA_FILE[k]] if not c.startswith("_")]
        missing = [c for c in want if c not in cols]
        extra = [c for c in cols if c not in want]
        check(not missing, "빠진 컬럼 없음 · 빠진 것 %s" % (missing or "없음"))
        if extra:
            warn("선언에 없는 컬럼이 왔다 %s · 무시된다" % extra)

        if k in ("attr", "stock"):
            check(len(rows) == 743, "743행 · 실제 %d행" % len(rows))
        keys = [(r.get("q"), r.get("dept")) for r in rows]
        check(all(k2[1] for k2 in keys), "dept 칸이 비어 있지 않다 (PK 는 두 칸이다)")
        dup = len(keys) - len(set(keys))
        check(dup == 0, "PK 중복 %d건" % dup)
        outside = sorted(set(keys) - base_keys)
        check(not outside, "정본 밖 PK %d건 %s" % (len(outside), outside[:3]))
        if k in ("attr", "stock"):
            miss = sorted(base_keys - set(keys))
            check(not miss, "빠진 PK %d건 %s" % (len(miss), miss[:3]))

        for col, allow in ENUMS[k].items():
            if col not in cols:
                continue
            badv = sorted({(r.get(col) or "").strip() for r in rows} - set(allow) - {""})
            check(not badv, "%s 값이 허용 목록 안에 있다 · 벗어난 값 %s" % (col, badv or "없음"))

        for col in NUMERIC[k]:
            if col not in cols:
                continue
            bad = [r.get("q") for r in rows if not as_num(r.get(col))[1]]
            check(not bad, "%s 가 숫자로 읽힌다 · 안 읽힌 행 %d건 %s" % (col, len(bad), bad[:3]))

        dash = [r.get("q") for r in rows
                for v in r.values() if isinstance(v, str) and ("—" in v or "–" in v)]
        check(not dash, "em-dash · en-dash 없음 · 섞인 행 %d건" % len(dash))

    # 적정재고는 산식을 다시 계산해 본다
    if "stock" in data:
        say()
        say("[산식] target 과 stockDept 로 다시 계산해도 같은가")
        bad_need, bad_act, act = [], [], {}
        for r in data["stock"]:
            key = (r.get("q"), r.get("dept"))
            if key not in seed:
                continue
            sd = seed[key]
            tg, ok_tg = as_num(r.get("target"))
            nd, ok_nd = as_num(r.get("need"))
            if not (ok_tg and ok_nd) or tg is None:
                continue
            if nd is None or abs(nd - max(0.0, tg - sd)) > 1e-9:
                bad_need.append(r.get("q"))
            a = "발주" if tg > sd else ("유지" if tg == sd else "감축")
            act[a] = act.get(a, 0) + 1
            if a != (r.get("action") or "").strip():
                bad_act.append("%s 저장 %s · 재계산 %s" % (r.get("q"), r.get("action"), a))
        check(not bad_need, "need = max(0, target - stockDept) · 어긋난 행 %d건 %s"
              % (len(bad_need), bad_need[:3]))
        check(not bad_act, "action 이 재계산과 같다 · 어긋난 행 %d건 %s"
              % (len(bad_act), bad_act[:2]))

        tr_bad = [r.get("q") for r in data["stock"]
                  if r.get("trend") is not None and
                  len([x for x in (r.get("trend") or "").split(";") if x != ""]) not in (0, 24)]
        check(not tr_bad, "trend 가 24개다 · 어긋난 행 %d건 %s" % (len(tr_bad), tr_bad[:3]))

        sig_have = {(r.get("signal") or "").strip() for r in data["stock"]}
        check({"red", "yellow", "green"} <= sig_have,
              "발주 신호 red · yellow · green 이 다 있다 (건강도 얼굴 3종) · %s" % sorted(sig_have))

    # 명세상수
    spec = None
    if files.get("spec"):
        with io.open(files["spec"], encoding="utf-8") as f:
            spec = json.load(f)
        say()
        say("[명세] 산식 상수")
        z = spec.get("z") or {}
        check(z.get("S") == 2.58 and z.get("A") == 2.05 and z.get("B") == 1.65 and z.get("C") == 1.28,
              "안전계수 Z 가 등급별이다 S2.58/A2.05/B1.65/C1.28 · 받은 값 %s" % z)
        lead_txt = " ".join(spec.get("signalPln") or [])
        for kind, days in (("합리화", "60"), ("대수리", "45"), ("중수리", "21"),
                           ("정기수리", "14"), ("교체휴지", "10"), ("공정휴지", "7")):
            check("%s %s" % (kind, days) in lead_txt,
                  "선행일수 %s %s일이 명세에 있다" % (kind, days))
        fac = {f.get("k"): f.get("w") for f in (spec.get("factors") or [])}
        check(fac.get("F5") == 0.50 and fac.get("F1") == 0.35,
              "7요인 가중치 F5 0.50 · F1 0.35 · 받은 값 %s" % fac)
        check(spec.get("asof") is not None, "명세에 기준일(asof)이 있다 · %s" % spec.get("asof"))

    # 요약값을 행에서 다시 센다
    if files.get("summary") and "stock" in data and "attr" in data:
        with io.open(files["summary"], encoding="utf-8") as f:
            summ = json.load(f)
        say()
        say("[요약] 행에서 다시 센 값과 같은가 · 요약만 고치고 행은 안 고치는 실수를 잡는다")
        vd = {}
        for r in data["attr"]:
            v = (r.get("verdict") or "").strip()
            vd[v] = vd.get(v, 0) + 1
        check(vd == (summ.get("verdict") or {}),
              "판정 재계산 %s · 요약 %s" % (vd, summ.get("verdict")))
        check(act == (summ.get("action") or {}),
              "조치 재계산 %s · 요약 %s" % (act, summ.get("action")))
        zt = sum(1 for r in data["stock"] if (as_num(r.get("target"))[0] or 0) == 0)
        check(zt == summ.get("zeroTarget"),
              "목표0 재계산 %d · 요약 %s" % (zt, summ.get("zeroTarget")))
        check(len(data["stock"]) == summ.get("items"),
              "items %s · 실제 %d" % (summ.get("items"), len(data["stock"])))
        if summ.get("financeDept") and summ.get("financeAll"):
            warn("절감액이 두 값이다 (부서 %s원 · 전사 %s억원). 화면에 모집단을 붙여 쓴다"
                 % (summ.get("financeDept"), summ.get("financeAll")))

    # 기준일이 하나인가
    say()
    say("[기준일] 하나여야 한다 · 지난번에 09-07 과 09-03 이 섞여 마감일이 4일 밀렸다")
    cfg = os.path.join(ROOT, "assets", "config.js")
    cfg_date = None
    if os.path.exists(cfg):
        import re
        m = re.search(r"BASE_DATE\s*:\s*'([0-9-]+)'", io.open(cfg, encoding="utf-8").read())
        cfg_date = m.group(1) if m else None
    if spec:
        check(spec.get("asof") == cfg_date,
              "명세 asof %s == config.js BASE_DATE %s" % (spec.get("asof"), cfg_date))
    dates = set()
    for k in ("attr", "stock"):
        for r in data.get(k, []):
            for c in ("stopDate", "dueDate"):
                if r.get(c):
                    dates.add(r[c][:4])
    if dates:
        say("  참고  날짜 컬럼의 연도 %s" % sorted(dates))

    return problems


def main():
    if len(sys.argv) < 2:
        print("usage: python validate_algorithm_csv.py <received folder>")
        return 2
    folder = sys.argv[1]
    if not os.path.isdir(folder):
        print("not a folder: %s" % folder)
        return 2

    validate(folder)

    say()
    say("=" * 70)
    if problems:
        say("검문 실패 %d건 · 이 상태로 넣으면 화면이 조용히 틀린다" % len(problems))
        for p in problems:
            say("  - " + p)
        say()
        say("고쳐 달라고 알고리즘 담당에게 이 파일을 그대로 보내면 된다")
    else:
        say("검문 통과 · 문제 0건")
        say()
        say("다음 순서")
        say("  1  받은 파일을 본선_반출 최종본/데이터/ 에 덮는다")
        say("  2  PYTHONHASHSEED=0 PYTHONIOENCODING=utf-8 python -B build_master_db.py")
        say("  3  python verify.py · node runtime_check.js")
    say("=" * 70)

    d = os.path.dirname(REPORT)
    if not os.path.isdir(d):
        os.makedirs(d)
    with io.open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(log) + "\n")
    print("validate %s (problems=%d) -> db/VALIDATE_REPORT.txt"
          % ("FAIL" if problems else "PASS", len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
