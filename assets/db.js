/* db.js · 조회 · 쓰기 API
 *
 * 화면이 쓰는 입구는 이것 하나뿐이다.
 * 화면은 DB_MASTER 나 DB_DERIVED 를 직접 읽지 않는다. 층 구조도 CSV 도 모른다.
 *
 * 세 층을 겹치는 규칙
 *   속성   오버라이드 > 알고리즘 확정(보험품·계획품) > 정본 Type
 *   재고   stockDept(스냅샷) + Σ stock_transactions
 *
 * 확정은 보험품과 계획품 둘뿐이다. 회색지대와 배제는 판단을 못 내린 것이므로
 * 정본 Type 을 유지한다. 회색지대를 「일치」 로 세면 알고리즘이 실제보다
 * 잘한 것처럼 보인다.
 *
 * 로드 순서 · db-master -> db-derived -> db-changes -> db -> db-biz -> 어댑터
 * 어댑터가 이 파일보다 먼저 실행되면 빈 배열을 만들고 오류도 안 난다.
 * 화면은 조용히 「대장 없음」 을 띄운다. 지난 리허설에서 실제로 낸 버그다.
 */
(function () {
  'use strict';

  var CFG = window.CFG || {};
  var M = window.DB_MASTER;
  var D = window.DB_DERIVED;
  var C = window.DB_CHANGES;

  if (!M || !D) {
    // 여기서 조용히 빈 DB 를 만들면 화면이 「자재 0종」 을 정상처럼 보여 준다.
    // 그게 제일 찾기 어려운 버그다. 콘솔에 이유를 남기고 window.DB 를 안 만든다.
    // 화면은 window.DB 가 없으면 FALLBACK 으로 그리도록 되어 있다
    console.error('db.js · db-master.js 와 db-derived.js 를 먼저 불러야 한다. ' +
                  '스크립트 순서를 확인한다');
    return;
  }

  var TXN_SIGN = CFG.TXN_SIGN || { '반납': 1, '입고': 1, '불출': -1, '공용전환': -1 };
  var CONFIRMED = CFG.CONFIRMED_TYPES || ['보험품', '계획품'];
  var DEFAULT_DEPT = CFG.DEPT || (M.depts && M.depts[0] && M.depts[0].code);

  /* 주소나 문장에서 자재코드를 뽑는다.
   * QR 이 material-view.html?code=Q4039953 로 들어오고
   * 챗봇이 「Q4039953 재고 있어?」 같은 문장을 준다.
   * Q + 영문 0~1 + 숫자 6~7. 창고(QFC01) 거래(Q00101) 는 자리수가 달라 안 걸린다 */
  var CODE_RE = /\bQ[A-Z]?\d{6,7}\b/;

  function key(q, dept) { return q + '|' + dept; }

  function index(rows) {
    var out = {}, i;
    for (i = 0; i < rows.length; i++) { out[key(rows[i].q, rows[i].dept)] = rows[i]; }
    return out;
  }

  var MAT = index(M.materials);
  var ATTR = index(D.attr);
  var STOCK = index(D.stock);
  var POOL = index(D.pool);
  var DEPTS = (function () {
    var out = {}, i;
    for (i = 0; i < M.depts.length; i++) { out[M.depts[i].code] = M.depts[i]; }
    return out;
  })();
  var KEYS = Object.keys(MAT);

  /* 3층은 자주 읽힌다. 바뀔 때만 다시 만든다 */
  var cache = null;
  function changes() {
    if (cache) { return cache; }
    var raw = C ? C.all() : {};
    var attrLast = {}, txns = {}, pools = {}, i, r, k;

    var rows = raw.attribute_overrides || [];
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      attrLast[key(r.q, r.dept || DEFAULT_DEPT)] = r;  // 마지막 승인이 이긴다
    }
    rows = raw.stock_transactions || [];
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      k = key(r.q, r.dept || DEFAULT_DEPT);
      if (!txns[k]) { txns[k] = { delta: 0, n: 0, rows: [] }; }
      var sign = TXN_SIGN[r.txnType];
      if (sign === undefined) { continue; }   // 넷이 아닌 종류는 애초에 못 들어온다
      txns[k].delta += sign * Math.abs(Number(r.qty) || 0);
      txns[k].n += 1;
      txns[k].rows.push(r);
    }
    rows = raw.pooling_overrides || [];
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      pools[key(r.q, r.dept || DEFAULT_DEPT)] = r;
    }
    cache = { raw: raw, attr: attrLast, txn: txns, pool: pools };
    return cache;
  }

  function merge(k) {
    var m = MAT[k];
    if (!m) { return null; }
    var a = ATTR[k] || {}, s = STOCK[k] || {}, p = POOL[k] || {};
    var ch = changes();
    var ov = ch.attr[k] || null;
    var t = ch.txn[k] || { delta: 0, n: 0, rows: [] };
    var pl = ch.pool[k] || null;

    var type, src;
    if (ov) { type = ov.newType; src = 'override'; }
    else if (CONFIRMED.indexOf(a.verdict) >= 0) { type = a.verdict; src = 'algorithm'; }
    else { type = m.type; src = 'master'; }

    var seed = Number(m.stockDept) || 0;
    var stock = seed + t.delta;
    var target = Number(s.target) || 0;

    return {
      // 키
      q: m.q, dept: m.dept, key: k,
      deptPath: (DEPTS[m.dept] || {}).path,
      // 1층
      name: m.name, group: m.group, wh: m.wh, price: m.price,
      ltMean: m.ltMean, ltStd: m.ltStd, csp: m.csp, ceq: m.ceq,
      proc: m.proc, recvDate: m.recvDate, eq: m.eq, cycles: m.cycles,
      baseType: m.type, stockSeed: seed, stockAll: m.stockAll,
      suppliers: m.suppliers, holdStd: m.holdStd,
      // 2층
      verdict: a.verdict, path: a.path, why: a.why, si: a.si, sp: a.sp,
      conf: a.conf, cspScore: a.cspScore, stockSrc: a.stockSrc,
      grade: s.grade, target: s.target, need: s.need, amount: s.amount,
      action: s.action, reason: s.reason, signal: s.signal, status: s.status,
      sigEq: s.sigEq, sigKind: s.sigKind, stopDate: s.stopDate,
      dueDate: s.dueDate, dDays: s.dDays, expect: s.expect,
      issues: s.issues, trend: s.trend,
      poolGrade: p.poolGrade, poolAge: p.ageDays, staleValue: p.staleValue,
      // 3층
      type: type, typeSrc: src, override: ov,
      stock: stock, stockDelta: t.delta, txns: t.n, txnRows: t.rows,
      pooled: !!pl, poolAction: pl ? pl.action : null,
      /* need 와 needNow 를 둘 다 둔 이유
       * need 는 알고리즘이 낸 값이라 근거 화면에서 그대로 보여 줘야 하고,
       * needNow 는 반납 후의 지금 상태다.
       * 반납하면 needNow 만 줄고 알고리즘 산출값은 그대로 남는다 */
      needNow: Math.max(0, target - stock),
      actionNow: stock < target ? '발주' : (stock === target ? '유지' : '감축')
    };
  }

  var rowCache = null;
  function allRows() {
    if (rowCache) { return rowCache; }
    var out = [], i;
    for (i = 0; i < KEYS.length; i++) { out.push(merge(KEYS[i])); }
    rowCache = out;
    return out;
  }

  function invalidate() { cache = null; rowCache = null; }

  // ---------------------------------------------------------------- 검증
  function needMat(q, dept) {
    var k = key(q, dept);
    if (!MAT[k]) { throw new Error('정본에 없는 자재 · ' + q); }
    return k;
  }

  function extract(v) {
    if (v === null || v === undefined) { return ''; }
    var m = CODE_RE.exec(String(v));
    return m ? m[0] : String(v).trim();
  }

  // ---------------------------------------------------------------- 공개
  var DB = {
    TXN_SIGN: TXN_SIGN,
    CONFIRMED_TYPES: CONFIRMED.slice(),

    /* 한 건. dept 를 생략하면 세션 부서. 주소 · 문장에서도 코드를 뽑는다 */
    item: function (q, dept) {
      var code = extract(q);
      if (!code) { return null; }
      return merge(key(code, dept || DEFAULT_DEPT));
    },

    /* 743건. filter 는 { 컬럼: 값 | 배열 | 함수 } */
    list: function (filter) {
      var rows = allRows();
      if (!filter) { return rows.slice(); }
      var ks = Object.keys(filter);
      return rows.filter(function (r) {
        var i, k, want, v;
        for (i = 0; i < ks.length; i++) {
          k = ks[i]; want = filter[k]; v = r[k];
          if (typeof want === 'function') { if (!want(v, r)) { return false; } }
          else if (Array.isArray(want)) { if (want.indexOf(v) < 0) { return false; } }
          else if (v !== want) { return false; }
        }
        return true;
      });
    },

    /* 코드 · 품명 부분 일치 */
    find: function (text, limit) {
      var t = String(text || '').trim().toLowerCase();
      if (!t) { return []; }
      var out = allRows().filter(function (r) {
        return (r.q || '').toLowerCase().indexOf(t) >= 0 ||
               (r.name || '').toLowerCase().indexOf(t) >= 0 ||
               (r.group || '').toLowerCase().indexOf(t) >= 0;
      });
      return limit ? out.slice(0, limit) : out;
    },

    dept: function (code) { return DEPTS[code || DEFAULT_DEPT] || null; },

    equipment: function (name) {
      if (!name) { return M.equipment.slice(); }
      var i;
      for (i = 0; i < M.equipment.length; i++) {
        if (M.equipment[i].name === name) { return M.equipment[i]; }
      }
      return null;
    },

    maintenance: function (filter) {
      var rows = M.maintenance;
      if (!filter) { return rows.slice(); }
      var ks = Object.keys(filter);
      return rows.filter(function (r) {
        var i, k, want;
        for (i = 0; i < ks.length; i++) {
          k = ks[i]; want = filter[k];
          if (typeof want === 'function') { if (!want(r[k], r)) { return false; } }
          else if (Array.isArray(want)) { if (want.indexOf(r[k]) < 0) { return false; } }
          else if (r[k] !== want) { return false; }
        }
        return true;
      });
    },

    /* 요약. 오버라이드가 반영된 재계산 값이다.
     * 파일에 적힌 요약을 그대로 돌려주지 않는다.
     * 그러면 승인해도 숫자가 안 움직이고, 요약만 옛 값으로 남는다 */
    summary: function () {
      var rows = allRows();
      var out = {
        items: rows.length,
        verdict: {}, action: {}, grade: {}, signal: {}, conf: {}, path: {},
        type: {}, typeSource: {}, status: {},
        /* 2차 버킷팅 · 1단계 판정을 정본 Type 과 견준다.
         * 화면 세 곳(대시보드 · 속성값 판단 · 주간 리포트)이 같은 값을 봐야 한다 */
        bucket: { '보험품→계획품': 0, '계획품→보험품': 0, '현행유지': 0, '판정일치': 0, '배제': 0 }
      };
      var nowAmt = 0, tgtAmt = 0, cutAmt = 0, i, r, price, b;

      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        bump(out.verdict, r.verdict);
        bump(out.action, r.actionNow);
        bump(out.grade, r.grade);
        bump(out.signal, r.signal);
        bump(out.conf, r.conf);
        bump(out.path, r.path);
        bump(out.type, r.type);
        bump(out.typeSource, r.typeSrc);
        bump(out.status, r.status);

        if (String(r.verdict || '').indexOf('배제') === 0) { b = '배제'; }
        else if (r.verdict === '회색지대') { b = '현행유지'; }
        else if (r.verdict === r.baseType) { b = '판정일치'; }
        else if (r.baseType === '보험품' && r.verdict === '계획품') { b = '보험품→계획품'; }
        else if (r.baseType === '계획품' && r.verdict === '보험품') { b = '계획품→보험품'; }
        else { b = '판정일치'; }
        out.bucket[b] += 1;

        price = Number(r.price) || 0;
        nowAmt += price * (Number(r.stock) || 0);
        tgtAmt += price * (Number(r.target) || 0);
        // 감축 가능액은 목표를 넘는 만큼이다. 목표가 더 크면 0 이다
        cutAmt += price * Math.max(0, (Number(r.stock) || 0) - (Number(r.target) || 0));
      }

      out.insItems = out.type['보험품'] || 0;
      out.plnItems = out.type['계획품'] || 0;
      out.nowAmt = Math.round(nowAmt);
      out.tgtAmt = Math.round(tgtAmt);
      out.cutAmt = Math.round(cutAmt);
      out.zeroTarget = rows.filter(function (r2) { return (Number(r2.target) || 0) === 0; }).length;

      /* 정체 금액을 두 값으로 나눈다.
       * 명세의 공용화 규칙 · strong 즉시공용화 · medium 공용화권장 · review 보류.
       * review 는 핵심이고 보험품이라 공용화 대상이 아니다.
       * 전부 더하면 회수액이 11.45억원이 되어 금융비용 절감이 부풀려진다.
       * strong + medium 만 세면 요약의 9.47억원과 정확히 맞는다 */
      var poolAll = 0, poolGet = 0, poolN = 0, poolGetN = 0;
      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        if (!r.poolGrade) { continue; }
        var sv = Number(r.staleValue) || 0;
        poolAll += sv; poolN += 1;
        if (r.poolGrade === 'strong' || r.poolGrade === 'medium') {
          poolGet += sv; poolGetN += 1;
        }
      }
      out.poolItems = poolN;               // 정체 종수
      out.poolAmt = Math.round(poolGet);   // 공용화로 회수 가능한 금액
      out.poolAmtAll = Math.round(poolAll);
      out.poolRecoverItems = poolGetN;
      out.poolHoldItems = poolN - poolGetN;
      out.poolHoldAmt = Math.round(poolAll - poolGet);

      /* 금융비용 절감. 상수를 화면이 만들지 않는다.
       * 기여율과 이자율을 명세 문장에서 뽑는다. 여기 숫자를 적어 두면
       * 명세가 바뀔 때 이 줄만 옛 값으로 남는다 */
      var fin = String((D.meta.spec && D.meta.spec.finance) || '');
      var rate = /기여율\s*([0-9.]+)/.exec(fin);
      var intr = /이자율\s*([0-9.]+)/.exec(fin);
      out.financeRate = rate ? Number(rate[1]) : null;
      out.financeInterest = intr ? Number(intr[1]) : null;
      out.finance = (out.financeRate !== null && out.financeInterest !== null)
        ? Math.round((out.cutAmt + out.poolAmt) * out.financeRate * out.financeInterest)
        : null;
      out.financeFormula = fin;

      // 알고리즘이 낸 요약 원본. 대조용으로만 쓴다
      out.shipped = D.summary;
      return out;
    },

    meta: function () {
      return {
        asof: (CFG.BASE_DATE || M.meta.asof),
        pk: 'q|dept',
        counts: M.meta.counts,
        source: M.meta.source,
        spec: D.meta.spec,
        memoryOnly: C ? C.isMemoryOnly() : true
      };
    },

    // ------------------------------------------------- 쓰기 · 전부 3층에 쌓인다
    approveAttr: function (o) {
      o = o || {};
      var dept = o.dept || DEFAULT_DEPT;
      var k = needMat(o.q, dept);
      if (CONFIRMED.indexOf(o.newType) < 0) {
        throw new Error('승인할 수 있는 속성은 보험품 또는 계획품이다');
      }
      var row = C.add('attribute_overrides', {
        q: o.q, dept: dept, newType: o.newType,
        approvedBy: o.by || '담당자', approvedAt: o.at || nowStamp(),
        priorVerdict: (ATTR[k] || {}).verdict, reason: o.reason || ''
      });
      invalidate();
      return row;
    },

    revertAttr: function (q, dept) {
      var k = needMat(q, dept || DEFAULT_DEPT);
      var rows = C.rows('attribute_overrides').filter(function (r) {
        return key(r.q, r.dept || DEFAULT_DEPT) === k;
      });
      if (!rows.length) { return false; }
      // 마지막 한 줄만 지운다. 이력 전체를 지우면 역추적이 끊긴다
      var ok = C.remove('attribute_overrides', rows[rows.length - 1].seq);
      invalidate();
      return ok;
    },

    txn: function (o) {
      o = o || {};
      var dept = o.dept || DEFAULT_DEPT;
      needMat(o.q, dept);
      if (TXN_SIGN[o.type] === undefined) {
        throw new Error('반납 · 불출 · 입고 · 공용전환 중 하나여야 한다');
      }
      var qty = Number(o.qty);
      if (!(qty > 0)) {
        throw new Error('수량은 양수여야 한다. 부호는 종류가 정한다');
      }
      var row = C.add('stock_transactions', {
        q: o.q, dept: dept, txnType: o.type, qty: qty,
        txnAt: o.at || nowStamp(), processedBy: o.by || '담당자', note: o.note || ''
      });
      invalidate();
      return row;
    },

    pool: function (o) {
      o = o || {};
      var dept = o.dept || DEFAULT_DEPT;
      needMat(o.q, dept);
      var row = C.add('pooling_overrides', {
        q: o.q, dept: dept, action: o.action || '공용전환',
        by: o.by || '담당자', at: o.at || nowStamp(), note: o.note || ''
      });
      invalidate();
      return row;
    },

    draft: function (kind, o) {
      o = o || {};
      var dept = o.dept || DEFAULT_DEPT;
      needMat(o.q, dept);
      var row = C.add('pr_drafts', {
        q: o.q, dept: dept,
        data: JSON.stringify({ kind: kind, data: o.data || {} }),
        by: o.by || '담당자', at: o.at || nowStamp()
      });
      invalidate();
      return row;
    },

    // ------------------------------------------------- 이력 · 구독
    changes: function () { return C.all(); },

    undo: function (table, seq) {
      var ok = C.remove(table, seq);
      invalidate();
      return ok;
    },

    /* 시연 초기화. 3층만 비운다 */
    reset: function () { C.reset(); invalidate(); },

    on: function (fn) { C.on(fn); },
    off: function (fn) { C.off(fn); }
  };

  function bump(o, k) {
    if (k === null || k === undefined || k === '') { return; }
    o[k] = (o[k] || 0) + 1;
  }

  /* 시각은 기준일 기준으로 찍는다. 오늘 날짜를 쓰면 시연 중에 값이 흔들린다 */
  function nowStamp() {
    var t = new Date();
    var hh = ('0' + t.getHours()).slice(-2), mm = ('0' + t.getMinutes()).slice(-2);
    return (CFG.BASE_DATE || M.meta.asof) + ' ' + hh + ':' + mm;
  }

  /* 3층이 바뀌면 캐시를 버린다.
   * 이게 없으면 승인해도 목록이 옛 값으로 남는다 */
  if (C) { C.on(invalidate); }

  window.DB = DB;
})();
