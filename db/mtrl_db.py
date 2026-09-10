#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""mtrl_db.py · 파이썬에서 쓰는 조회 API. 화면의 assets/db.js 와 **같은 구조**다.

왜 이걸 두는가
    알고리즘 담당과 화면이 각자 CSV 를 읽으면 반드시 갈린다.
    지난번에 자재 검색만 보험품 441종, 나머지 화면은 302종을 보고 있었다.
    그래서 조회 입구를 양쪽 다 하나로 만든다.
    함수 이름 · 필드 이름 · 층을 겹치는 순서가 db.js 와 같다.

    db.js      DB.item(q, dept)   DB.list(filter)   DB.summary()   DB.meta()
    mtrl_db.py db.item(q, dept)   db.list(**f)      db.summary()   db.meta()

쓰는 법
    import sys; sys.path.insert(0, 'db')
    from mtrl_db import DB

    db = DB()                              # db/ 의 json 을 읽는다
    row = db.item('Q4039953')              # 한 건. 층이 겹쳐진 값이 나온다
    ins = db.list(type='보험품')            # 필터. 값 · 배열 · 함수 다 된다
    db.summary()['action']                 # {'발주':120,'유지':142,'감축':481}
    db.spec()['z']['S']                    # 2.58 · 산식 상수는 여기서만 읽는다

    import pandas as pd
    df = db.frame()                        # 743행 DataFrame
    df = db.sql('select q,target,action from stock where action="발주"')

절대 규칙 세 개
    1  원본을 덮지 않는다. 사람이 바꾼 것은 3층(overrides)으로만 쌓는다
    2  현재고를 저장하지 않는다. stockSeed + Σ 트랜잭션으로 매번 계산한다
    3  요약을 손으로 적지 않는다. summary() 는 행에서 다시 센 값을 준다
"""

import io
import json
import os
import re
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))

# 기준일 · PK · 트랜잭션 부호는 assets/config.js 와 같은 값이어야 한다.
# 여기서 날짜를 새로 정의하지 않는다. meta()['asof'] 를 쓴다
TXN_SIGN = {"반납": +1, "입고": +1, "불출": -1, "공용전환": -1}
CONFIRMED_TYPES = ["보험품", "계획품"]
DEFAULT_DEPT = "SEO26FF"

# 주소나 문장에서 자재코드를 뽑는다. Q + 영문 0~1 + 숫자 6~7.
# 창고(QFC01)와 거래(Q00101)는 자리수가 달라 걸리지 않는다
CODE_RE = re.compile(r"\bQ[A-Z]?\d{6,7}\b")


def _read(name):
    with io.open(os.path.join(HERE, name), encoding="utf-8") as f:
        return json.load(f)


class DB(object):
    def __init__(self, changes=None, dept=DEFAULT_DEPT):
        """changes 는 브라우저에서 내보낸 3층 이력이다.

        화면에서 승인 · 반납을 한 뒤 그 상태로 알고리즘을 다시 돌려 보려면
        DB.changes() 결과를 json 으로 저장해 여기에 넣는다.
        없으면 2층까지만 겹친 상태(알고리즘 초기 판정)를 본다.
        """
        self._master = _read("master.json")
        self._derived = _read("derived.json")
        self._biz = _read("biz.json")
        self._plan = _read("plan.json")
        self.dept = dept

        if isinstance(changes, str):
            changes = _read(changes) if os.path.isabs(changes) else _read(changes)
        self._changes = changes or {}

        self._mat = {self._k(r): r for r in self._master["materials"]}
        self._attr = {self._k(r): r for r in self._derived["attr"]}
        self._stock = {self._k(r): r for r in self._derived["stock"]}
        self._pool = {self._k(r): r for r in self._derived["pool"]}
        self._depts = {d["code"]: d for d in self._master["depts"]}
        self._rows = None

    # ------------------------------------------------------------ 내부
    @staticmethod
    def _k(r):
        return r["q"] + "|" + r["dept"]

    def _rows_of(self, table):
        return self._changes.get(table) or []

    def _override_type(self, key):
        """3층에서 가장 마지막 승인을 찾는다. 이력은 쌓이고 덮이지 않는다."""
        last = None
        for r in self._rows_of("attribute_overrides"):
            if r.get("q", "") + "|" + r.get("dept", self.dept) == key:
                last = r
        return last

    def _stock_delta(self, key):
        """현재고 = 스냅샷 + Σ 트랜잭션.

        qty 는 언제나 양수로 들어오고 부호는 종류가 정한다.
        수량 필드를 고쳐 쓰면 두 번 반납했을 때 무엇이 맞는지 알 수 없다.
        """
        d, n = 0.0, 0
        for r in self._rows_of("stock_transactions"):
            if r.get("q", "") + "|" + r.get("dept", self.dept) != key:
                continue
            sign = TXN_SIGN.get(r.get("txnType"))
            if sign is None:
                continue  # 넷이 아닌 종류는 애초에 저장되지 않는다
            d += sign * abs(float(r.get("qty") or 0))
            n += 1
        return d, n

    def _merge(self, key):
        m = self._mat.get(key)
        if not m:
            return None
        a = self._attr.get(key) or {}
        s = self._stock.get(key) or {}
        p = self._pool.get(key) or {}

        # 속성 결정 순서 · 오버라이드 > 알고리즘 확정 > 정본.
        # 회색지대와 배제는 판단을 못 내린 것이므로 정본 Type 을 유지한다.
        # 회색지대를 「일치」 로 세면 알고리즘이 실제보다 잘한 것처럼 보인다
        ov = self._override_type(key)
        if ov:
            typ, src = ov.get("newType"), "override"
        elif a.get("verdict") in CONFIRMED_TYPES:
            typ, src = a["verdict"], "algorithm"
        else:
            typ, src = m.get("type"), "master"

        delta, txns = self._stock_delta(key)
        seed = float(m.get("stockDept") or 0)
        stock = seed + delta
        target = float(s.get("target") or 0)

        row = {
            # 키
            "q": m["q"], "dept": m["dept"], "key": key,
            "deptPath": (self._depts.get(m["dept"]) or {}).get("path"),
            # 1층
            "name": m.get("name"), "group": m.get("group"), "wh": m.get("wh"),
            "price": m.get("price"), "ltMean": m.get("ltMean"), "ltStd": m.get("ltStd"),
            "csp": m.get("csp"), "ceq": m.get("ceq"), "proc": m.get("proc"),
            "recvDate": m.get("recvDate"), "eq": m.get("eq"), "cycles": m.get("cycles"),
            "baseType": m.get("type"), "stockSeed": seed,
            "stockAll": m.get("stockAll"), "suppliers": m.get("suppliers"),
            "holdStd": m.get("holdStd"),
            # 2층
            "verdict": a.get("verdict"), "path": a.get("path"), "why": a.get("why"),
            "si": a.get("si"), "sp": a.get("sp"), "conf": a.get("conf"),
            "cspScore": a.get("cspScore"), "stockSrc": a.get("stockSrc"),
            "grade": s.get("grade"), "target": s.get("target"), "need": s.get("need"),
            "amount": s.get("amount"), "action": s.get("action"), "reason": s.get("reason"),
            "signal": s.get("signal"), "status": s.get("status"),
            "sigEq": s.get("sigEq"), "sigKind": s.get("sigKind"),
            "stopDate": s.get("stopDate"), "dueDate": s.get("dueDate"),
            "dDays": s.get("dDays"), "expect": s.get("expect"),
            "issues": s.get("issues"), "trend": s.get("trend"),
            "poolGrade": p.get("poolGrade"), "poolAge": p.get("ageDays"),
            "staleValue": p.get("staleValue"),
            # 3층
            "type": typ, "typeSrc": src, "override": ov,
            "stock": stock, "stockDelta": delta, "txns": txns,
            # 계산 · need 는 알고리즘이 낸 값, needNow 는 반납 후의 지금 상태다.
            # 반납하면 needNow 만 줄고 알고리즘 산출값은 그대로 남는다
            "needNow": max(0.0, target - stock),
            "actionNow": "발주" if stock < target else ("유지" if stock == target else "감축"),
        }
        return row

    # ------------------------------------------------------------ 조회
    def item(self, q, dept=None):
        """한 건. 주소나 문장에서 코드도 뽑는다.

        QR 이 'material-view.html?code=Q4039953' 로 들어오고
        챗봇이 'Q4039953 재고 있어?' 같은 문장을 준다
        """
        if not q:
            return None
        m = CODE_RE.search(str(q))
        code = m.group(0) if m else str(q).strip()
        return self._merge(code + "|" + (dept or self.dept))

    def all(self):
        if self._rows is None:
            self._rows = [self._merge(k) for k in self._mat]
        return self._rows

    def list(self, **flt):
        """필터는 { 컬럼: 값 | 배열 | 함수 } 다. db.js 의 DB.list 와 같다."""
        out = []
        for row in self.all():
            ok = True
            for k, want in flt.items():
                v = row.get(k)
                if callable(want):
                    ok = bool(want(v))
                elif isinstance(want, (list, tuple, set)):
                    ok = v in want
                else:
                    ok = v == want
                if not ok:
                    break
            if ok:
                out.append(row)
        return out

    def find(self, text, limit=20):
        t = (text or "").strip().lower()
        if not t:
            return []
        out = [r for r in self.all()
               if t in (r["q"] or "").lower() or t in (r["name"] or "").lower()]
        return out[:limit]

    def dept_of(self, code):
        return self._depts.get(code)

    def equipment(self, name=None):
        eq = self._master["equipment"]
        return next((e for e in eq if e["name"] == name), None) if name else eq

    def maintenance(self, **flt):
        rows = self._master["maintenance"]
        if not flt:
            return rows
        return [r for r in rows if all(r.get(k) == v for k, v in flt.items())]

    def plan(self):
        return self._plan

    def biz(self):
        return self._biz

    def spec(self):
        return self._derived["meta"]["spec"]

    def meta(self):
        return {
            "asof": self._master["meta"]["asof"],
            "pk": "q|dept",
            "counts": self._master["meta"]["counts"],
            "spec": self.spec(),
            "source": self._master["meta"]["source"],
        }

    def summary(self):
        """행에서 다시 센 요약. 3층이 있으면 그것이 반영된다.

        요약을 파일에서 그대로 읽지 않는다. 요약만 고치고 행은 안 고치는
        실수를 잡을 수 없게 되기 때문이다. 대조용 원본은 summary_shipped() 에 있다
        """
        rows = self.all()
        out = {"items": len(rows), "verdict": {}, "action": {}, "grade": {}, "signal": {},
               "conf": {}, "path": {}, "type": {}, "typeSource": {}}
        now = tgt = 0.0
        for r in rows:
            for k, f in (("verdict", "verdict"), ("grade", "grade"), ("signal", "signal"),
                         ("conf", "conf"), ("path", "path"), ("type", "type")):
                v = r.get(f)
                if v is not None:
                    out[k][v] = out[k].get(v, 0) + 1
            src = r.get("typeSrc")
            out["typeSource"][src] = out["typeSource"].get(src, 0) + 1
            # 조치는 지금 재고로 다시 센다. 반납하면 여기가 움직여야 한다
            a = r["actionNow"]
            out["action"][a] = out["action"].get(a, 0) + 1
            price = float(r.get("price") or 0)
            now += price * float(r.get("stock") or 0)
            tgt += price * float(r.get("target") or 0)
        out["insItems"] = out["type"].get("보험품", 0)
        out["plnItems"] = out["type"].get("계획품", 0)
        out["nowAmt"] = round(now)
        out["tgtAmt"] = round(tgt)
        out["zeroTarget"] = sum(1 for r in rows if float(r.get("target") or 0) == 0)
        return out

    def summary_shipped(self):
        """알고리즘이 낸 요약 원본. 내가 센 값과 대조할 때만 쓴다."""
        return self._derived["summary"]

    # ------------------------------------------------------------ 곁들이
    def frame(self):
        """pandas DataFrame. pandas 가 없으면 알려 준다."""
        try:
            import pandas as pd
        except ImportError:
            raise SystemExit("pandas 가 없다. pip install pandas 하거나 list() 를 쓴다")
        return pd.DataFrame(self.all())

    def sql(self, query, params=()):
        """db/posco_mtrl.sqlite 직결. 표는 CSV 와 같은 컬럼 이름이다.

        주의 · 여기서 나오는 값은 1층 · 2층 그대로다. 3층이 겹쳐지지 않는다.
        승인과 반납이 반영된 값이 필요하면 item() · list() 를 쓴다
        """
        path = os.path.join(HERE, "posco_mtrl.sqlite")
        con = sqlite3.connect(path)
        con.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in con.execute(query, params)]
        finally:
            con.close()


if __name__ == "__main__":
    # 자기 시험. 화면의 db.js 자체 시험과 같은 항목을 본다
    db = DB()
    lines = []
    lines.append("기준일 %s · 자재 %d종" % (db.meta()["asof"], db.meta()["counts"]["materials"]))
    r = db.item("material-view.html?code=Q4039953")
    lines.append("주소에서 코드 추출 · %s · %s · 단가 %s" % (r["q"], r["name"], r["price"]))
    lines.append("보험품 %d종 (요약 %d종)"
                 % (len(db.list(type="보험품")), db.summary_shipped()["insItems"]))
    lines.append("조치 재계산 %s" % db.summary()["action"])
    lines.append("요약 원본  %s" % db.summary_shipped()["action"])
    same = db.summary()["action"] == db.summary_shipped()["action"]
    lines.append("일치 %s" % ("OK" if same else "FAIL"))

    # 3층을 넣으면 값이 움직이는지
    ch = {"attribute_overrides": [{"q": "Q1000108", "dept": "SEO26FF", "newType": "계획품"}],
          "stock_transactions": [{"q": "Q1000108", "dept": "SEO26FF", "txnType": "반납", "qty": 3}]}
    db2 = DB(changes=ch)
    a = db2.item("Q1000108")
    lines.append("3층 반영 · type %s (%s) · 재고 %s -> %s · 조치 %s"
                 % (a["type"], a["typeSrc"], a["stockSeed"], a["stock"], a["actionNow"]))

    out = os.path.join(HERE, "MTRL_DB_SELFTEST.txt")
    with io.open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print("selftest %s -> db/MTRL_DB_SELFTEST.txt" % ("PASS" if same else "FAIL"))
