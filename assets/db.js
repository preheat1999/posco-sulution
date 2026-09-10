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

  /* 담당자가 확정한 지점 · 3층 attribute_overrides 의 seq 하나로 적는다.
   * 이 값보다 나중에 쌓인 판단은 「확정 대기」 이고, 이 DB 를 읽는 어떤 화면도 쓰지 않는다 */
  var COMMIT_KEY = (CFG.STAGE_KEY || 'mtrl.stage.v1') + '.commit';
  function commitRead() {
    try {
      var raw = window.localStorage.getItem(COMMIT_KEY);
      return raw ? JSON.parse(raw) : { seq: 0, at: '', n: 0 };
    } catch (e) { return { seq: 0, at: '', n: 0 }; }
  }
  function commitWrite(v) {
    try { window.localStorage.setItem(COMMIT_KEY, JSON.stringify(v)); } catch (e) { /* 무시 */ }
  }

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

    /* 사람의 판단은 확정된 것만 쓴다.
     * judged 는 「사람이 고른 값」, pending 은 「아직 확정 안 된 판단」 이다.
     * 속성값 판단 화면만 이 둘을 보고, 다른 화면은 type 만 본다 */
    var cm = commitRead();
    var applied = !!ov && Number(ov.seq) <= Number(cm.seq || 0);
    var type, src;
    if (applied) { type = ov.newType; src = 'override'; }
    else if (CONFIRMED.indexOf(a.verdict) >= 0) { type = a.verdict; src = 'algorithm'; }
    else { type = m.type; src = 'master'; }
    var judged = ov ? ov.newType : null;
    var pending = (ov && !applied) ? ov : null;

    var seed = Number(m.stockDept) || 0;
    var stock = seed + t.delta;
    var target = Number(s.target) || 0;

    /* 확정 속성의 목표재고.
     *
     * 06 의 target 은 그 행의 속성으로 계산된 값 하나뿐이다. 사람이 속성을 바꾸면
     * 그것은 「다른 속성으로 계산한 값」 이 되고, 화면은 다시 계산할 수 없다 ·
     * μ_LT + SS 에 필요한 소요 이력(txn_history 22,625행)이 반출 데이터에 없다.
     *
     * 그래서 알고리즘 엔진을 전 품목 보험품 · 전 품목 계획품으로 각각 돌려
     * 두 목표를 미리 구워 2층에 실었다 (targetIns · targetPln).
     * 기준 재현 743/743 일치 · db/ENGINE_REPRO.txt.
     *
     * 확정 속성이 06 의 속성과 다르면 구운 값을 쓴다. 같으면 06 값 그대로다 ·
     * 손대지 않은 행의 숫자는 반출 그대로 남는다 */
    var stockType = s.type || m.type;
    var stale = applied && type !== stockType;
    var targetNow = target, recalc = null;
    var reasonNow = s.reason, signalNow = s.signal, statusNow = s.status;
    if (stale) {
      var baked = type === '보험품'
        ? { t: s.targetIns, why: s.reasonIns, sig: s.signalIns, st: s.statusIns }
        : { t: s.targetPln, why: s.reasonPln, sig: s.signalPln, st: s.statusPln };
      if (baked.t === undefined || baked.t === null || baked.t === '') {
        /* 구운 값이 없는 db (예전 파일)에서는 명세로 판단할 수 있는 것만 본다 */
        if (type === '계획품' && !m.ceq) {
          targetNow = 0;
          recalc = { done: true, rule: '명세 · 핵심설비가 아닌 계획품은 목표 0',
                     from: target, to: 0, src: 'spec' };
        } else {
          recalc = { done: false, rule: '구운 목표가 없습니다 · 엔진 재계산 필요',
                     from: target, to: null, src: 'none' };
        }
      } else {
        targetNow = Number(baked.t) || 0;
        reasonNow = baked.why || s.reason;
        signalNow = baked.sig || s.signal;
        statusNow = baked.st || s.status;
        recalc = { done: true, src: 'engine',
                   rule: '엔진이 ' + type + ' 으로 계산한 목표입니다',
                   from: target, to: targetNow, why: reasonNow };
      }
    }

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
      /* 속성 두 가지 각각의 목표 · 엔진이 미리 구운 값이다.
       * 화면이 「계획품으로 바꾸면 목표가 몇이 되는지」 를 미리 보여 줄 때도 쓴다 */
      targetIns: s.targetIns, reasonIns: s.reasonIns,
      targetPln: s.targetPln, reasonPln: s.reasonPln,
      action: s.action, reason: s.reason, signal: s.signal, status: s.status,
      sigEq: s.sigEq, sigKind: s.sigKind, stopDate: s.stopDate,
      dueDate: s.dueDate, dDays: s.dDays, expect: s.expect,
      issues: s.issues, trend: s.trend,
      poolGrade: p.poolGrade, poolAge: p.ageDays, staleValue: p.staleValue,
      // 3층
      type: type, typeSrc: src, override: ov,
      /* 사람이 고른 값과 그 확정 여부 · 속성값 판단 화면만 쓴다 */
      judged: judged, pending: pending, committed: applied,
      stock: stock, stockDelta: t.delta, txns: t.n, txnRows: t.rows,
      pooled: !!pl, poolAction: pl ? pl.action : null,
      /* need 와 needNow 를 둘 다 둔 이유
       * need 는 알고리즘이 낸 값이라 근거 화면에서 그대로 보여 줘야 하고,
       * needNow 는 반납 후의 지금 상태다.
       * 반납하면 needNow 만 줄고 알고리즘 산출값은 그대로 남는다 */
      /* 적정재고가 어느 속성으로 계산됐는지 · 확정 속성과 다르면 stale.
       * stale 이어도 targetNow · reasonNow · signalNow 는 확정 속성 쪽 값이다 */
      stockType: stockType, stale: stale, recalc: recalc, targetNow: targetNow,
      reasonNow: reasonNow, signalNow: signalNow, statusNow: statusNow,
      needNow: Math.max(0, targetNow - stock),
      actionNow: stock < targetNow ? '발주' : (stock === targetNow ? '유지' : '감축')
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
        bucket: { '보험품→계획품': 0, '계획품→보험품': 0, '현행유지': 0, '판정일치': 0, '배제': 0 },
        holdOpen: 0,
        /* 속성이 바뀌어 적정재고를 다시 봐야 하는 행 · 그중 엔진 재계산이 남은 행 */
        staleN: 0, recalcN: 0,
        /* 판단은 했지만 아직 확정하지 않은 행 · 이 값이 0 이 아니면 다른 화면은
         * 아직 알고리즘 판정 속성을 쓰고 있다는 뜻이다 */
        judgedN: 0, waitingN: 0
      };
      var nowAmt = 0, tgtAmt = 0, cutAmt = 0, i, r, price, b;

      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        bump(out.verdict, r.verdict);
        bump(out.action, r.actionNow);
        bump(out.grade, r.grade);
        bump(out.signal, r.signalNow || r.signal);
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
        /* 사람이 아직 확정하지 않은 회색지대. 「해야 할 건수」 는 이 값이다.
         * bucket 은 2층 판정을 1층 정본과 견준 값이라 승인해도 안 줄어든다.
         * 사이드바 배지에 bucket 을 쓰면 대시보드는 30, 배지는 31 로 어긋난다 */
        if (b === '현행유지' && !r.judged) { out.holdOpen += 1; }

        price = Number(r.price) || 0;
        nowAmt += price * (Number(r.stock) || 0);
        tgtAmt += price * (Number(r.targetNow) || 0);
        if (r.stale) { out.staleN += 1; if (r.recalc && !r.recalc.done) { out.recalcN += 1; } }
        if (r.judged) { out.judgedN += 1; if (r.pending) { out.waitingN += 1; } }
        // 감축 가능액은 목표를 넘는 만큼이다. 목표가 더 크면 0 이다
        cutAmt += price * Math.max(0, (Number(r.stock) || 0) - (Number(r.targetNow) || 0));
      }

      out.insItems = out.type['보험품'] || 0;
      out.plnItems = out.type['계획품'] || 0;
      out.nowAmt = Math.round(nowAmt);
      out.tgtAmt = Math.round(tgtAmt);
      out.cutAmt = Math.round(cutAmt);
      out.zeroTarget = rows.filter(function (r2) { return (Number(r2.targetNow) || 0) === 0; }).length;

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

    /* 속성 판단 · 확정만 지운다. 반납 · 초안 · 공용 전환은 그대로 남는다 ·
     * 속성값 판단 화면의 「초기화」 가 쓴다 */
    clearAttr: function () {
      var rows = C ? C.rows('attribute_overrides') : [];
      var n = rows.length;
      rows.slice().reverse().forEach(function (r) { C.remove('attribute_overrides', r.seq); });
      commitWrite({ seq: 0, at: '', n: 0 });
      invalidate();
      if (C) { C.emit(); }
      return n;
    },

    /* 여기까지의 판단을 확정한다. 이 순간부터 다른 화면이 그 속성으로 계산한다 */
    commitAttr: function () {
      var rows = C ? C.rows('attribute_overrides') : [];
      var seq = rows.reduce(function (t, r) { return Math.max(t, Number(r.seq) || 0); }, 0);
      var t = new Date();
      function p(n) { return (n < 10 ? '0' : '') + n; }
      var at = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' +
        p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds());
      var info = { seq: seq, at: at, n: rows.length };
      commitWrite(info);
      invalidate();
      if (C) { C.emit(); }        // 화면들이 다시 그린다
      return info;
    },

    /* 확정 지점 · 확정된 건수와 대기 건수 */
    commitInfo: function () {
      var cm = commitRead();
      var rows = C ? C.rows('attribute_overrides') : [];
      var done = 0, waiting = 0;
      rows.forEach(function (r) {
        if (Number(r.seq) <= Number(cm.seq || 0)) { done += 1; } else { waiting += 1; }
      });
      return { seq: Number(cm.seq || 0), at: cm.at || '', done: done, waiting: waiting,
               total: rows.length };
    },

    /* 판단 취소 · 화면이 {q, dept} 로 부르기도 한다. 둘 다 받는다
     * (객체로 부르면 조용히 아무 것도 안 되던 버그가 있었다) */
    revertAttr: function (q, dept) {
      if (q && typeof q === 'object') { dept = q.dept; q = q.q; }
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

    /* 현장 QR 반납 접수.
     *
     * 정본에 있는 자재라면 stock_transactions(반납)로 재고가 움직인다.
     * 정본 밖 자재(다른 부서 식별표)는 우리 부서 재고를 건드릴 수 없으므로
     * 접수 이력만 남긴다 · 화면이 그 사실을 그대로 적는다 */
    qrReturn: function (o) {
      o = o || {};
      var code = String(o.code || '').trim().toUpperCase();
      if (!/^Q\d{7}$/.test(code)) { throw new Error('자재코드는 Q 와 숫자 7자리다'); }
      var qty = Math.abs(Number(o.qty) || 0);
      if (!qty) { throw new Error('반납 수량이 없다'); }
      var inMaster = !!MAT[key(code, o.dept || DEFAULT_DEPT)];
      var row = C.add('qr_returns', {
        code: code, dept: o.dept || '', qty: qty, unit: o.unit || '',
        cond: o.cond || '', by: o.by || '담당자', at: o.at || nowStamp(),
        note: o.note || ''
      });
      /* 우리 부서 자재면 재고도 같이 움직인다 */
      if (inMaster) {
        C.add('stock_transactions', {
          q: code, dept: o.dept || DEFAULT_DEPT, txnType: '반납', qty: qty,
          txnAt: o.at || nowStamp(), processedBy: o.by || '담당자',
          note: 'QR 반납 · ' + (o.cond || '')
        });
      }
      invalidate();
      return { row: row, inMaster: inMaster };
    },

    /* 접수 이력 · 최근 것이 뒤다 */
    qrReturns: function (code) {
      var rows = C ? C.rows('qr_returns') : [];
      if (!code) { return rows; }
      var c = String(code).trim().toUpperCase();
      return rows.filter(function (r) { return r.code === c; });
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
