#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""test_verify_negative.py · 검산이 정말 보고 있는지 확인한다.

통과만 보고 넘어가면 검산이 아무것도 안 보고 있어도 알 수 없다.
지난 리허설에서 자재코드 검사 두 줄이 정확히 그 상태였다
(heredoc 으로 넘긴 정규식의 \\b 가 백스페이스 문자가 되어 조용히 통과).

반출 자료는 읽기 전용이므로 파일을 고치지 않는다. 메모리에서만 깨뜨린다.

실행
    PYTHONHASHSEED=0 PYTHONIOENCODING=utf-8 python -B test_verify_negative.py
"""

import io
import json
import os
import sys

import build_master_db as B

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "db", "NEGATIVE_TEST.txt")

CASES = []


def case(name, expect, mutate):
    CASES.append((name, expect, mutate))


# 리허설에서 실제로 겪은 것들을 그대로 깨뜨려 본다
case("holdStd 를 문자열로 되돌린다", "숫자 컬럼에 문자열",
     lambda m, d, b, p: m["materials"][0].__setitem__("holdStd", "1"))

case("요약의 목표0 을 999 로 바꾼다", "목표0",
     lambda m, d, b, p: d["summary"].__setitem__("zeroTarget", 999))

case("조치 한 건을 손으로 뒤집는다", "조치",
     lambda m, d, b, p: flip_action(d["stock"][0]))

case("자재 한 행을 지운다", "743",
     lambda m, d, b, p: m["materials"].pop())

case("없는 부서코드를 심는다", "부서 표",
     lambda m, d, b, p: m["materials"][0].__setitem__("dept", "NOPE99"))

case("단가를 흔들어 현행재고액을 깬다", "현행재고",
     lambda m, d, b, p: m["materials"][0].__setitem__("price", 1))

case("trend 를 23개로 줄인다", "trend",
     lambda m, d, b, p: d["stock"][0].__setitem__("trend", d["stock"][0]["trend"][:23]))

case("데이터에 em-dash 를 심는다", "em-dash",
     lambda m, d, b, p: m["materials"][0].__setitem__("name", "Wear—Plate"))

case("마감일 없는 건을 「지금 신청」 으로 세게 만든다", "마감일 없는 건",
     lambda m, d, b, p: mark_null_as_over(p))

case("판정 한 건을 바꿔 요약과 어긋나게 한다", "판정",
     lambda m, d, b, p: d["attr"][0].__setitem__("verdict", "회색지대"))


def flip_action(row):
    """지금 값과 다른 값으로 바꾼다.

    처음에는 그냥 '발주' 를 넣었는데 그 행이 이미 '발주' 여서 아무것도 안 바뀌었고,
    검사기가 놓친 것처럼 보였다. 시험이 틀리면 검사기를 의심하게 된다
    """
    row["action"] = "감축" if row.get("action") != "감축" else "발주"


def mark_null_as_over(plan):
    for w in plan["wos"]:
        if w["left"] is None:
            w["tone"] = "over"
            return
    raise SystemExit("마감일 없는 WO 가 없어 이 시험을 못 한다")


def run():
    lines = ["검사기 역시험 · 일부러 깨뜨려 잡히는지 본다", "=" * 66, ""]
    ok_all = True

    # 0) 멀쩡한 상태에서는 통과해야 한다
    m, d, b, p, sch = B.build()
    B.log[:] = []
    bad = B.verify(m, d, b, p, sch)
    lines.append("[기준] 안 깨뜨린 상태 · 문제 %d건 %s" % (len(bad), "OK" if not bad else "FAIL"))
    if bad:
        ok_all = False
        lines += ["    " + x for x in bad[:5]]
    lines.append("")

    for name, expect, mutate in CASES:
        m, d, b, p, sch = B.build()   # 매번 새로 읽는다. 앞 시험이 남으면 무엇이 잡혔는지 모른다
        mutate(m, d, b, p)
        B.log[:] = []
        bad = B.verify(m, d, b, p, sch)
        hit = [x for x in bad if expect in x]
        good = bool(hit)
        ok_all = ok_all and good
        lines.append("%s %s" % ("잡힘  " if good else "놓침  ", name))
        lines.append("        기대 키워드 「%s」 · 걸린 항목 %d건" % (expect, len(bad)))
        if bad:
            lines.append("        %s" % bad[0][:110])
        lines.append("")

    lines.append("=" * 66)
    lines.append("역시험 %s · %d개 중 %d개 잡힘"
                 % ("통과" if ok_all else "실패", len(CASES),
                    sum(1 for n, e, mu in CASES if True)) if ok_all else
                 "역시험 실패 · 놓친 검사가 있다")
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print("negative test %s -> db/NEGATIVE_TEST.txt" % ("PASS" if ok_all else "FAIL"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(run())
