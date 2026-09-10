/* screen-data.js · 분석 · 업무 화면 어댑터
 *
 * 화면은 계산하지 않는다. 화면이 필요한 모양으로 바꿔 주는 곳이 여기다.
 * **DB API 만 쓴다.** DB_MASTER · DB_DERIVED 를 직접 읽지 않는다.
 *
 * 반드시 db.js 뒤에 로드한다.
 * 앞에 두면 window.DB 가 없어서 조용히 빈 배열이 되고, 화면은
 * 「대장 없음」 을 정상처럼 보여 준다. 지난 리허설에서 실제로 낸 버그다.
 *
 * 대시보드는 analysis-data.js 를 쓴다. 이 파일은 나머지 다섯 화면이 쓴다.
 * 두 파일로 나눈 이유 · 대시보드는 요약만 보고, 이 화면들은 행을 하나씩 본다.
 */
(function () {
  'use strict';

  var live = !!window.DB;

  function rows() { return live ? DB.list() : []; }
  function spec() { return live ? (DB.meta().spec || {}) : {}; }

  /* 금액 큰 순. 위에서부터 처리하면 금액 큰 것을 먼저 본다 */
  function byAmt(a, b) {
    return (Number(b.stock) * Number(b.price)) - (Number(a.stock) * Number(a.price));
  }

  // ================================================================ 보유목적 판단
  /* 점수는 0~100 이다. 0.58 같은 값이 아니다.
   * 「점수차」 는 보험품 점수와 계획품 점수의 차이고, 이 값이 작을 때
   * 알고리즘이 판단을 보류한다(회색지대). 실제 데이터의 회색지대 점수차는
   * 2.60 ~ 13.30 이다. 임계치를 화면이 정하지 않는다 · 판정값을 그대로 읽는다 */
  function gap(r) { return Math.abs(Number(r.si) - Number(r.sp)); }

  var ATTR_TABS = [
    { key: 'all', label: '전체' },
    { key: 'i2p', label: '보험품 → 계획품' },
    { key: 'p2i', label: '계획품 → 보험품' },
    { key: 'gray', label: '현행유지' },
    { key: 'done', label: '판단 완료' }
  ];

  function attrBucket(r) {
    /* 사람이 판단한 것은 확정 전이라도 done 이다.
     * 확정했는지는 r.committed 로 따로 본다 · 두 개를 한 칸에 섞으면 목록에서 사라진다 */
    if (r.judged) { return 'done'; }
    var v = r.verdict, t = r.baseType;
    if (String(v || '').indexOf('배제') === 0) { return 'out'; }
    if (v === '회색지대') { return 'gray'; }
    if (v === t) { return 'same'; }
    if (t === '보험품' && v === '계획품') { return 'i2p'; }
    if (t === '계획품' && v === '보험품') { return 'p2i'; }
    return 'same';
  }

  function attrList(tab, sort) {
    var all = rows();
    var out = all.filter(function (r) {
      var b = attrBucket(r);
      if (tab === 'all') { return b !== 'out' && b !== 'same'; }
      return b === tab;
    });
    /* 기본은 금액 순이다. 점수차 순은 「알고리즘이 가장 헷갈린 것」 부터 본다 */
    out.sort(sort === 'gap' ? function (a, b) { return gap(a) - gap(b); } : byAmt);
    return out;
  }

  function attrCounts() {
    var all = rows(), c = { all: 0, i2p: 0, p2i: 0, gray: 0, done: 0, out: 0, same: 0,
      /* 원본 단계가 쓰는 정본 속성 수 · 적정재고를 다시 봐야 하는 행 수 */
      insBase: 0, plnBase: 0, stale: 0, recalc: 0, waiting: 0, fixed: 0 };
    /* 판정 근거에서 목록에 올리지 않는 것 · 사전 배제 + 판정일치.
     * 743 = 손대야 하는 것(all) + 제외(excluded) 로 항상 맞아떨어진다 */
    all.forEach(function (r) {
      var b = attrBucket(r);
      c[b] += 1;
      if (b !== 'out' && b !== 'same') { c.all += 1; }
      if (r.baseType === '보험품') { c.insBase += 1; } else if (r.baseType === '계획품') { c.plnBase += 1; }
      if (r.stale) { c.stale += 1; if (r.recalc && !r.recalc.done) { c.recalc += 1; } }
      if (r.pending) { c.waiting += 1; } else if (r.committed) { c.fixed += 1; }
    });
    c.excluded = c.out + c.same;
    return c;
  }

  /* 오른쪽 근거 패널이 쓸 모양.
   * 신뢰도를 퍼센트로 만들지 않는다. 원천에 없는 값이다.
   * 판정 데이터에 있는 것은 conf 등급(LOW · MEDIUM · HIGH)뿐이다 */
  function attrDetail(r) {
    if (!r) { return null; }
    var sp = spec();
    var f = (sp.factors || []).slice(0, 4);
    return {
      row: r,
      gap: gap(r),
      bucket: attrBucket(r),
      /* 판정 문장은 2층 값이다. 화면이 새로 쓰지 않는다 */
      verdictText: r.verdict === '회색지대'
        ? '보험품 점수와 계획품 점수의 차이가 ' + gap(r).toFixed(1) +
          '점으로 작아 알고리즘이 판단을 보류했습니다'
        : (String(r.verdict || '').indexOf('배제') === 0
          ? '판정 대상이 아닙니다 · ' + r.verdict
          : '알고리즘은 ' + r.verdict + ' 으로 봅니다'),
      params: [
        ['리드타임 평균', UInum(r.ltMean) + '일'],
        ['리드타임 표준편차', UInum(r.ltStd) + '일'],
        ['등록 공급사', UInum(r.suppliers) + '곳' + (Number(r.suppliers) === 1 ? ' (독점)' : ''),
          Number(r.suppliers) === 1 ? 'ins' : ''],
        ['연 사용 횟수', UInum(r.cycles) + '회'],
        ['자재 단가', won(r.price)],
        ['핵심예비품', r.csp ? '지정됨' : '아님', r.csp ? 'warn' : ''],
        ['조달', r.proc || '미확인'],
        ['판정 경로', r.path || '미확인']
      ],
      factors: f,
      /* 가중치는 명세에서 읽는다. 화면이 상수를 만들지 않는다 */
      weightText: (sp.factors || []).length
        ? (sp.factors || []).map(function (x) { return x.w + '×' + x.name; }).join(' + ')
        : '가중치를 명세에서 읽지 못했습니다',
      confText: { HIGH: '높음', MEDIUM: '보통', LOW: '낮음' }[r.conf] || r.conf || '미확인',
      why: r.why || ''
    };
  }

  // ================================================================ 적정재고
  var STOCK_TABS = [
    { key: 'all', label: '전체' },
    { key: 'order', label: '발주 필요' },
    { key: 'cut', label: '감축 대상' },
    { key: 'keep', label: '적정 유지' }
  ];

  function stockList(tab, q) {
    var out = rows().filter(function (r) {
      if (tab === 'order') { return r.actionNow === '발주'; }
      if (tab === 'cut') { return r.actionNow === '감축'; }
      if (tab === 'keep') { return r.actionNow === '유지'; }
      return true;
    });
    if (q) {
      var s = String(q).toUpperCase();
      out = out.filter(function (r) {
        return String(r.q).toUpperCase().indexOf(s) >= 0 ||
               String(r.name || '').toUpperCase().indexOf(s) >= 0;
      });
    }
    out.sort(byAmt);
    return out;
  }

  function stockCounts() {
    var c = { all: 0, order: 0, cut: 0, keep: 0 };
    rows().forEach(function (r) {
      c.all += 1;
      if (r.actionNow === '발주') { c.order += 1; }
      else if (r.actionNow === '감축') { c.cut += 1; }
      else if (r.actionNow === '유지') { c.keep += 1; }
    });
    return c;
  }

  /* 다섯 단계의 머리 숫자. 각 단계가 무엇을 세었는지도 같이 준다 */
  function stockSteps() {
    if (!live) { return []; }
    var s = DB.summary(), sp = spec();
    var ins = s.type['보험품'] || 0, pln = s.type['계획품'] || 0;
    var zeroT = s.zeroTarget || 0;
    return [
      /* 1(공식) · 2(목표재고 계산) · 6(무재고 설명)은 히트맵 아래 근거 줄로 옮겼다.
       * 분석 결과를 히트맵으로 먼저 보이고, 손으로 할 일(3 · 4 · 5)만 단계로 남긴다 */
      { n: 3, title: '조치 판정', right: '발주 ' + (s.action['발주'] || 0) +
          ' · 유지 ' + (s.action['유지'] || 0) + ' · 감축 ' + (s.action['감축'] || 0),
        open: true, kind: 'table',
        signalIns: sp.signalIns || [], signalPln: sp.signalPln || [] },
      { n: 4, title: '공용화 후보', right: UInum(s.poolItems) + '품목 · 회수 ' + won(s.poolAmt),
        kind: 'pool', pool: sp.pool || [], stale: sp.stale || '',
        items: s.poolItems, amt: s.poolAmt, hold: s.poolHoldItems, holdAmt: s.poolHoldAmt },
      { n: 5, title: '금융비용 절감', right: '연 ' + won(s.finance), kind: 'fin',
        text: sp.finance || '', rate: s.financeRate, interest: s.financeInterest,
        cutAmt: s.cutAmt, poolAmt: s.poolAmt, finance: s.finance }
    ];
  }

  // ================================================================ 적정재고 분석 단계
  /* 보유목적 판단과 같은 얼개 · 처음엔 분석 전이고, 사람이 「분석」 을 눌러야 결과가 올라온다.
   * 여기서 계산하는 것은 없다 · feat/algo 엔진이 확정 속성으로 낸 결과를 올린다.
   * 이 단계는 시연 초기화가 지운다 */
  var ST_KEY = ((window.CFG || {}).STAGE_KEY || 'mtrl.stage.v1') + '.stock';
  function stockStage() {
    var v = null;
    try { v = window.localStorage.getItem(ST_KEY); } catch (e) { v = null; }
    return v === 'done' ? 'done' : 'raw';
  }
  function setStockStage(v) {
    try { window.localStorage.setItem(ST_KEY, v); } catch (e) { /* 무시 */ }
  }
  function stockStamp() {
    try { return window.localStorage.getItem(ST_KEY + '.at') || ''; } catch (e) { return ''; }
  }
  function setStockStamp(v) {
    try { window.localStorage.setItem(ST_KEY + '.at', v); } catch (e) { /* 무시 */ }
  }

  /* 히트맵 · 핵심예비품 25품목.
   *
   * 자재 743품목을 다 깔면 한 칸이 13px 라 이름이 안 읽힌다. 설비 정지에 직접 걸리는
   * 핵심예비품(102품목) 중 **과부족 금액이 큰 25품목**만 고른다 · 이 화면에서 손이
   * 가야 하는 것이 그것이다.
   *
   * 상자 크기 = |보유 - 목표| × 단가 (과부족 금액) · 색 = 초과 빨강 · 부족 파랑.
   * 과부족이 0 인 품목은 넓이가 0 이라 애초에 들어가지 않는다 (수를 따로 적는다) */
  var HEAT_N = 20;
  function stockHeat(limit, pow) {
    /* 몇 개를 깔지 · 넓이 눈금을 얼마나 누를지는 화면이 정한다.
     * 좁은 화면에 스무 개를 깔면 글자가 하나도 안 들어간다 */
    var n = Number(limit) > 0 ? Number(limit) : HEAT_N;
    var p = Number(pow) > 0 ? Number(pow) : 0.7;
    if (!live) { return { boxes: [], items: 0, csp: 0, fine: 0, n: n, pow: p }; }
    var all = DB.list();
    var csp = all.filter(function (r) { return r.csp; });
    var boxes = csp.map(function (r) {
      var stock = Number(r.stock) || 0, target = Number(r.targetNow) || 0;
      var gap = stock - target;
      return {
        q: r.q, dept: r.dept, name: r.name || '품명 미확인',
        type: r.type, grade: r.grade, stock: stock, target: target,
        gap: gap, dir: gap > 0 ? 'over' : (gap < 0 ? 'short' : 'fine'),
        amt: Math.abs(gap) * (Number(r.price) || 0),
        /* 목표 대비 몇 배로 어긋났나 · 색 농도에 쓴다. 목표 0 은 나눌 수 없어 최대로 본다 */
        ratio: target > 0 ? Math.abs(gap) / target : (gap === 0 ? 0 : 9),
        stale: !!r.stale
      };
    });
    var fine = boxes.filter(function (b) { return b.dir === 'fine'; }).length;
    boxes = boxes.filter(function (b) { return b.dir !== 'fine' && b.amt > 0; })
      .sort(function (a, b) { return b.amt - a.amt; })
      .slice(0, n);
    boxes.forEach(function (b) {
      b.lvl = b.ratio >= 3 ? 4 : (b.ratio >= 1.5 ? 3 : (b.ratio >= 0.8 ? 2 : 1));
      /* 넓이는 금액을 0.7 승으로 눌러서 준다.
       *
       * 금액 차이가 15.0억 대 190만원(약 800배)이라 그대로 넓이에 쓰면 큰 상자 둘이
       * 판을 95% 먹고 나머지 열여덟 개가 글자도 안 들어가는 띠가 된다.
       * 순서와 크기 관계는 그대로 두면서(단조 증가) 격차만 눌렀다 ·
       * 「넓이가 금액에 정비례한다」 고 말하지 않고 눈금을 화면에 적는다 */
      b.value = Math.pow(b.amt, p);
    });
    var s = DB.summary();
    return {
      boxes: boxes, items: all.length, csp: csp.length, fine: fine, n: n, pow: p,
      overN: boxes.filter(function (b) { return b.dir === 'over'; }).length,
      shortN: boxes.filter(function (b) { return b.dir === 'short'; }).length,
      overAmt: boxes.reduce(function (t, b) { return t + (b.dir === 'over' ? b.amt : 0); }, 0),
      shortAmt: boxes.reduce(function (t, b) { return t + (b.dir === 'short' ? b.amt : 0); }, 0),
      staleN: s.staleN || 0, ins: s.type['보험품'] || 0, pln: s.type['계획품'] || 0
    };
  }

  /* 보유 수량을 눌렀을 때 보여 줄 분해. 원천에 없는 칸은 「미확인」 이라고 적는다 */
  function stockBreak(r) {
    return [
      ['창고', r.wh || '미확인'],
      ['창고 위치(BIN)', '미확인 · 원천에 없습니다'],
      ['부서 보유', UInum(r.stock) + (r.stockDelta ? ' (스냅샷 ' + UInum(r.stockSeed) +
        (r.stockDelta > 0 ? ' +' : ' ') + r.stockDelta + ')' : '')],
      ['전사 보유', UInum(r.stockAll)],
      ['타부서 보유', UInum(Math.max(0, Number(r.stockAll) - Number(r.stock))) + ' · 이관 후보'],
      ['목표재고', r.stale
        ? (UInum(r.target) + ' → ' + UInum(r.targetNow) + ' (확정 ' + r.type + ')')
        : UInum(r.target)],
      ['조치', r.actionNow || '미확인']
    ].concat(r.stale
      ? [['속성 변경', r.stockType + ' → ' + r.type],
         ['다시 잡은 근거', (r.recalc && r.recalc.why) || (r.recalc && r.recalc.rule) || '']]
      : []);
  }

  // ================================================================ 정비계획
  /* PLAN 은 생성기가 만든 2층 값이다. 화면이 쓸 모양으로만 바꾼다.
   * WO 번호는 원천에 없다 · 설비 · 휴지구분 · 정지시작일로 만든 표시용 식별자다 */
  /* 정렬 세 가지 · 이번 주 WO 가 기본이다.
   *
   * 「마감 급한 순」 은 156건 중 55건이 이미 마감을 넘겨서 목록이 붉은 것만 나온다.
   * 실제로 담당자가 아침에 보는 것은 이번 주에 손이 가는 WO 다 */
  /* 한 달치만 본다.
   *
   * 원천에서 반출된 156건은 기준일 이후 넉 달(9월 36 · 11월 72 · 12월 48)에 걸쳐 있다.
   * 한 부서가 한 달에 세우는 정비계획은 많아도 서른 건 남짓이라, 156건을 한 화면에
   * 늘어놓으면 「이번에 손댈 일」 이 사라진다. 기준일부터 30일 안의 건만 본다 ·
   * 나머지는 다음 달에 이 화면에서 다시 보게 된다 */
  var MONTH_DAYS = 30;
  function inMonth(w) {
    var P = window.PLAN;
    if (!P) { return false; }
    var d = String(w.planDate || w.stopStart || '');
    if (!d) { return false; }
    return d >= P.meta.asof && d <= shift(P.meta.asof, MONTH_DAYS);
  }
  function planMonth() {
    var P = window.PLAN;
    return P ? P.wos.filter(inMonth) : [];
  }

  function planList(sort) {
    var P = window.PLAN;
    if (!P) { return []; }
    if (sort === 'week') { return planWeek(); }
    var out = planMonth();
    out.sort(sort === 'stop'
      ? function (a, b) { return String(a.stopStart).localeCompare(String(b.stopStart)); }
      : function (a, b) {
        /* 마감일이 없는 건(자재 확보)은 뒤로 보낸다. null 을 먼저 거른다 */
        if (a.left === null && b.left === null) { return 0; }
        if (a.left === null) { return 1; }
        if (b.left === null) { return -1; }
        return a.left - b.left;
      });
    return out;
  }

  /* 이번 주 WO · 시연용으로 정비계획일을 조정한 여섯 건이다.
   *
   * 원천 156건은 정비계획일이 기준일 뒤로 흩어져 있고 마감은 55건이 이미 넘겼다.
   * 그래서 「이번 주」 로 좁히면 자재 확보 · 임박 · 초과가 한 화면에 같이 나오지 않는다.
   * 시연에서 세 상태를 같이 보이기 위해 **날짜만** 이번 주로 옮긴다 ·
   * 설비 · 자재 · 재고 · 부족분은 원천 값 그대로이고, 목록 아래에 그렇게 적는다.
   * demo 표시를 행에 남겨 두어 화면이 이 사실을 숨기지 못하게 한다 */
  var WEEK = null;
  function planWeek() {
    if (WEEK) { return WEEK; }
    var P = window.PLAN;
    if (!P) { return []; }
    var asof = P.meta.asof;
    var fine = P.wos.filter(function (w) { return w.needCount === 0 && w.matCount > 0; });
    var need = P.wos.filter(function (w) { return w.needCount > 0; });
    /* 설비가 겹치지 않게 골라야 여섯 줄이 서로 다른 일처럼 읽힌다 */
    var seen = {};
    function pick(pool, n) {
      var out = [];
      pool.forEach(function (w) {
        if (out.length >= n || seen[w.eq]) { return; }
        seen[w.eq] = true; out.push(w);
      });
      return out;
    }
    /* 이번 주(기준일 09-03 목요일 · 08-31 월 ~ 09-06 일).
     * 마감일은 정비계획일보다 앞이라, 마감이 이번 주인 건은 정비가 두세 주 뒤다 */
    var plan = [
      { t: 'over', due: -3, stop: 18 },     // 마감 초과 1건 · 이번 주 월요일이 마감이었다
      { t: 'soon', due: 2, stop: 25 },      // 마감 임박 1건 · 모레가 마감이다
      { t: 'fine', due: null, stop: -2 },   // 자재 확보 4건 · 이번 주 정비
      { t: 'fine', due: null, stop: -1 },
      { t: 'fine', due: null, stop: 1 },
      { t: 'fine', due: null, stop: 2 }
    ];
    var src = pick(need, 2).concat(pick(fine, 4));
    WEEK = plan.map(function (p, i) {
      var w = src[i];
      if (!w) { return null; }
      var row = {};
      Object.keys(w).forEach(function (k) { row[k] = w[k]; });
      row.demo = true;
      row.planDate = shift(asof, p.stop);
      /* WO 번호는 설비 · 휴지구분 · 정지시작일로 만든 표시용 식별자다(원천에 없다).
       * 날짜를 옮겼으면 번호의 날짜도 같이 옮겨야 둘이 어긋나지 않는다 */
      row.wo = 'M' + row.planDate.slice(2).replace(/-/g, '') + String(w.wo).slice(7);
      row.stopStart = row.planDate;
      row.reStart = shift(asof, p.stop + 4);
      row.dueDate = p.due === null ? null : shift(asof, p.due);
      row.left = p.due;
      row.tone = p.t;
      return row;
    }).filter(Boolean);
    return WEEK;
  }

  function shift(ymd, days) {
    var p = String(ymd).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + Number(days));
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  /* 머리 카드 다섯 장이 쓰는 값. 화면은 세지 않는다.
   *
   * 이관 가능 · 예상 발주금액은 여기서 센다 · 발주가 필요한 자재 중 다른 부서에
   * 남는 수량이 있으면 그만큼은 사지 않고 가져오면 된다 */
  function planCounts() {
    var P = window.PLAN;
    if (!P) { return { wos: 0, over: 0, soon: 0, now: 0, mats: 0,
                       moveN: 0, moveAmt: 0, orderAmt: 0, week: 0, all: 0, mdays: 30 }; }
    var month = planMonth();
    /* 「지금 신청」 은 마감 초과가 아니라 재고가 예상 소요보다 적은 건이다.
     * 마감을 넘겼다는 것과 지금 신청해야 한다는 것은 다르다 */
    var nowN = live ? DB.list({ dueDate: function (v) { return !!v; } })
      .filter(function (r) { return (r.signalNow || r.signal) === 'red'; }).length : 0;

    var moveN = 0, moveAmt = 0, orderAmt = 0;
    var mats = {};
    month.forEach(function (w) { (w.mats || []).forEach(function (q) { mats[q] = true; }); });
    if (live) {
      /* 이 달 정비계획에 걸린 자재만 본다. 전체 743 을 세면 이 화면의 값이 아니다 */
      var linked = mats;
      DB.list().forEach(function (r) {
        if (!linked[r.q]) { return; }
        var need = Number(r.needNow) || 0;
        if (need <= 0) { return; }
        var price = Number(r.price) || 0;
        var other = Math.max(0, (Number(r.stockAll) || 0) - (Number(r.stock) || 0));
        var move = Math.min(need, other);      // 이관으로 덮을 수 있는 수량
        if (move > 0) { moveN += 1; moveAmt += price * move; }
        orderAmt += price * (need - move);     // 사야 하는 몫
      });
    }
    return {
      wos: month.length,                     // 이 달 정비계획
      all: P.meta.counts.wos,                // 반출 전체 (기준일 이후 넉 달)
      mdays: MONTH_DAYS,
      over: month.filter(function (w) { return w.tone === 'over'; }).length,
      soon: month.filter(function (w) { return w.tone === 'soon'; }).length,
      now: nowN, mats: Object.keys(mats).length,
      moveN: moveN, moveAmt: moveAmt, orderAmt: orderAmt,
      week: planWeek().length
    };
  }

  /* 수리계획이 쓰이는 자리 · 마감일 산식의 선행일수다.
   * 「대수리라서 45일 먼저 발주해야 한다」 가 이 화면의 요점이다 */
  function planLead(kind) {
    var P = window.PLAN;
    var lead = (P && P.meta.leadDays) || {};
    return {
      kind: kind || '미확인',
      days: lead[kind] === undefined ? null : lead[kind],
      formula: (P && P.meta.formula) || '',
      all: lead,
      note: (P && P.meta.dueNote) || ''
    };
  }

  /* WO 한 건에 걸린 자재. needQs 는 발주가 필요한 것만이다.
   *
   * 부족분은 **목표재고 기준(needNow)** 으로 센다. WO 머리의 「발주 필요 N품목」 도
   * 같은 기준이라 표와 머리가 어긋나지 않는다.
   *
   * expect(이 정비 건의 예상 소요)는 알고리즘 결과에 정비계획에 걸린 56행만 있다.
   * 그걸로 과부족을 계산하면 나머지 687행이 전부 0 이 되어 표가 뜻을 잃는다.
   * 없는 행은 「원천에 없음」 이라고 적고 지어내지 않는다 */
  function planMats(wo) {
    if (!live) { return []; }
    var need = {};
    (wo.needQs || []).forEach(function (q) { need[q] = true; });
    return (wo.mats || []).map(function (q) {
      var r = DB.item(q);
      if (!r) { return { q: q, missing: true }; }
      var hasExpect = r.expect !== null && r.expect !== undefined && r.expect !== '';
      return {
        q: q, name: r.name, grade: r.grade, type: r.type,
        expect: hasExpect ? Number(r.expect) : null,
        stock: r.stock, target: r.target,
        need: Number(r.needNow) || 0,               // 목표재고 기준 부족분
        /* 예상 소요가 있는 행만 「이 정비 건 기준」 부족분을 같이 준다 */
        shortByExpect: hasExpect ? Math.max(0, Number(r.expect) - Number(r.stock || 0)) : null,
        needOrder: !!need[q], signal: r.signalNow || r.signal, ltMean: r.ltMean, price: r.price
      };
    });
  }

  /* 마감 · 오늘 · 휴지 세 점의 위치를 0~100 으로 준다.
   * 세 날짜를 그냥 적으면 순서가 안 보인다 */
  function planAxis(wo, asof) {
    var d = function (s) { return new Date(s + 'T00:00:00').getTime(); };
    var due = wo.dueDate ? d(wo.dueDate) : null;
    var now = d(asof), stop = d(wo.stopStart);
    var lo = Math.min.apply(null, [now, stop].concat(due ? [due] : []));
    var hi = Math.max.apply(null, [now, stop].concat(due ? [due] : []));
    var span = Math.max(1, hi - lo);
    var at = function (t) { return ((t - lo) / span) * 100; };
    return {
      due: due === null ? null : at(due), now: at(now), stop: at(stop),
      overdue: due !== null && due < now,
      /* 휴지 착수까지 며칠 남았나 · 점 옆에 D-일수를 적는다 */
      toStop: Math.round((stop - now) / 86400000),
      fill: due === null ? null : [Math.min(at(due), at(now)), Math.max(at(due), at(now))]
    };
  }

  // ================================================================ 공용 전환
  /* 정체 자재 · 공용화 판정은 2층(파생)에 있다. 화면이 등급을 매기지 않는다.
   *
   * strong 즉시공용화 · medium 공용화권장 · review 보류.
   * review 는 핵심예비품이면서 보험품이라 회수 금액에 넣지 않는다 ·
   * 전부 더하면 회수액이 11.45억원으로 부풀려진다 (요약은 9.47억원이다) */
  var POOL_TABS = [
    { key: 'get', label: '회수 가능' },
    { key: 'hold', label: '보류' },
    { key: 'done', label: '전환 완료' },
    { key: 'all', label: '전체' }
  ];
  function poolRows() {
    if (!live) { return []; }
    return DB.list().filter(function (r) { return !!r.poolGrade; }).map(function (r) {
      var can = r.poolGrade === 'strong' || r.poolGrade === 'medium';
      return {
        q: r.q, dept: r.dept, name: r.name || '품명 미확인', eq: r.eq,
        type: r.type, grade: r.grade, stock: r.stock,
        age: r.poolAge === undefined || r.poolAge === null ? null : Number(r.poolAge),
        amt: Number(r.staleValue) || 0, poolGrade: r.poolGrade,
        can: can, done: !!r.pooled, price: r.price
      };
    }).sort(function (a, b) { return b.amt - a.amt; });
  }
  function poolList(tab, query) {
    var out = poolRows();
    if (tab === 'get') { out = out.filter(function (r) { return r.can && !r.done; }); }
    if (tab === 'hold') { out = out.filter(function (r) { return !r.can && !r.done; }); }
    if (tab === 'done') { out = out.filter(function (r) { return r.done; }); }
    var q = String(query || '').trim().toLowerCase();
    if (!q) { return out; }
    return out.filter(function (r) {
      return String(r.q).toLowerCase().indexOf(q) >= 0 ||
        String(r.name).toLowerCase().indexOf(q) >= 0;
    });
  }
  function poolCounts() {
    var all = poolRows();
    var get = all.filter(function (r) { return r.can && !r.done; });
    var hold = all.filter(function (r) { return !r.can && !r.done; });
    var done = all.filter(function (r) { return r.done; });
    function sum(a) { return a.reduce(function (t, r) { return t + r.amt; }, 0); }
    return {
      all: all.length, items: live ? DB.list().length : 0,
      get: get.length, getAmt: sum(get),
      hold: hold.length, holdAmt: sum(hold),
      done: done.length, doneAmt: sum(done)
    };
  }
  function poolSpec() {
    var sp = spec();
    return { stale: sp.stale || '', pool: sp.pool || [] };
  }

  // ================================================================ 구매신청
  /* 원천에 EAM · ERP 상태 코드가 없다. 지어내지 않고
   * 우리 시스템이 실제로 하는 일만 단계로 둔다.
   * 마지막 단계는 사내 시스템 연동이라 「연동 예정」 으로 적는다 */
  function prSteps() {
    var B = window.DB_BIZ, ch = live ? DB.changes() : { pr_drafts: [] };
    var pr = (B && B.purchase) || [];
    var block = pr.filter(function (p) { return !p.active; }).length;
    var draft = (ch.pr_drafts || []).length;
    return [
      { k: 'STEP 01 · 완료', v: '대상 확인 ' + pr.length + '건', state: 'done', mark: '✓' },
      { k: 'STEP 02 · ' + (block ? '진행중' : '완료'), v: '자재 정보 보완 ' + block + '건',
        state: block ? 'doing' : 'done', mark: block ? '2' : '✓' },
      { k: 'STEP 03 · ' + (draft ? '진행중' : '대기'), v: '초안 작성 ' + draft + '건',
        state: 'doing', mark: '3' },
      { k: 'STEP 04 · 연동 예정', v: 'PR 발행 0건', state: 'wait', mark: '4' }
    ];
  }

  /* 구매 대상 목록. 정체는 정본에만 있으므로 코드로 조인한다 */
  /* 다른 화면에서 넘어온 자재 한 건을 후보 목록 모양으로 만든다.
   * 적정재고 분석의 「PR 초안」 이 이 화면으로 데려올 때 쓴다 ·
   * 후보 목록(DB_BIZ.purchase)에 없는 자재도 신청할 수 있어야 한다 */
  function prRow(q, wo) {
    if (!live || !q) { return null; }
    var r = DB.item(q);
    if (!r) { return null; }
    /* 3층에 쌓인 초안이 있으면 그 수량을 쓴다. 없으면 목표 대비 부족분이다.
     * data 칸은 문자열(JSON)로 들어간다 · 표가 선언한 컬럼만 통과하기 때문이다 */
    var rows3 = (DB.changes().pr_drafts || []).filter(function (x) { return x.q === q; });
    var last = rows3.length ? rows3[rows3.length - 1] : null;
    var saved = 0;
    if (last) {
      try {
        var body = typeof last.data === 'string' ? JSON.parse(last.data) : (last.data || {});
        saved = Number((body.data || body).qty) || 0;
      } catch (e) { saved = 0; }
    }
    var qty = saved || Number(r.needNow) || 0;
    return {
      q: r.q, name: r.name || '품명 미확인', qty: qty,
      active: (r.signalNow || r.signal) === 'red',
      warn: (r.signalNow || r.signal) === 'red' ? '즉시 발주' : '',
      wo: wo || null, kind: null, eq: r.eq, planDate: r.dueDate,
      price: r.price, amount: Math.round((Number(r.price) || 0) * qty),
      ltMean: r.ltMean, grade: r.grade, type: r.type, csp: r.csp, unit: unitOf(r.q),
      fromStock: true
    };
  }

  function prList(extraQ, extraWo) {
    var B = window.DB_BIZ;
    if (!B || !live) { return []; }
    var out = (B.purchase || []).map(function (p) {
      var r = DB.item(p.q) || {};
      return {
        q: p.q, name: r.name || '품명 미확인', qty: p.qty, active: p.active, warn: p.warn,
        wo: p.wo, kind: p.kind, eq: p.eq, planDate: p.planDate,
        price: r.price, amount: Math.round((Number(r.price) || 0) * (Number(p.qty) || 0)),
        ltMean: r.ltMean, grade: r.grade, type: r.type, csp: r.csp, unit: unitOf(p.q)
      };
    });
    /* 넘어온 자재가 후보에 없으면 맨 앞에 올린다 */
    if (extraQ && !out.filter(function (x) { return x.q === extraQ; }).length) {
      var ex = prRow(extraQ, extraWo);
      if (ex) { out.unshift(ex); }
    }
    return out;
  }

  function unitOf(q) {
    var B = window.DB_BIZ;
    var t = ((B && B.tags) || []).filter(function (x) { return x.q === q; })[0];
    return (t && t.unit) || 'EA';
  }

  /* 신청서 초안. 값마다 어디서 왔는지 같이 준다.
   * 「AI 가 채웠다」 고만 적으면 어디서 온 값인지 물어볼 수 없다 */
  function prDraft(p, asof) {
    if (!p) { return null; }
    var due = null;
    if (p.ltMean) {
      var t = new Date(asof + 'T00:00:00');
      t.setDate(t.getDate() + Math.round(Number(p.ltMean)));
      due = t.toISOString().slice(0, 10);
    }
    return [
      ['자재코드', p.q, '정본 자재 대장', false],
      ['신청 수량', UInum(p.qty) + ' ' + p.unit, '구매신청 대상 원천', false],
      ['품명', p.name, '정본 자재 대장', false],
      ['요청일', asof, '기준일', false],
      ['납기희망일', due ? (due + ' (리드타임 ' + UInum(p.ltMean) + '일 반영)') : '리드타임 미확인',
        '요청일 + 리드타임 평균', true],
      ['예산 계정', '미확인 · 원천에 없습니다', '', false],
      ['사용 설비', p.eq || '설비 미확인', '구매신청 대상 원천', false],
      /* 구매신청 원천의 wo 는 작업주문 번호다(K...). 정비계획 표시용 식별자(M...)와 다르다 */
      ['신청 사유', '작업주문 ' + (p.wo || '미확인') + ' 기준 소요 자재 부족',
        '구매신청 대상 원천의 작업주문', true]
    ];
  }

  // ================================================================ 자재반납
  /* 반납 유형은 원천의 물품 상태(cond)를 그대로 쓴다.
   * 명세의 7갈래 판정은 알고리즘이 내는 값이라 아직 데이터에 없다.
   * 없는 칸을 화면에서 만들지 않는다 · 대신 실제 상태별로 나눈다 */
  /* 칸은 반납 여부다 · 상태(신품 · 중고 · 불용)로 나누지 않는다.
   * 상태는 반납받은 자재를 검사하고 사람이 정하는 값이라, 반납 전에는 아직 없다 */
  function retTabs() {
    var all = retRows();
    var done = all.filter(function (r) { return r.returned; }).length;
    return [
      { key: 'all', label: '전체', n: all.length },
      { key: 'wait', label: '반납 대기', n: all.length - done },
      { key: 'done', label: '반납 완료', n: done }
    ];
  }

  /* 이 자재를 반납한 이력이 있는가 · 3층(반납 트랜잭션 · QR 반납 접수)을 본다 */
  function retDone(q) {
    if (!live) { return 0; }
    var ch = DB.changes();
    var n = (ch.stock_transactions || []).filter(function (t) {
      return t.q === q && t.txnType === '반납';
    }).length;
    n += (ch.qr_returns || []).filter(function (t) { return t.code === q; }).length;
    return n;
  }

  function retList(tab) {
    var out = retRows();
    if (tab === 'wait') { return out.filter(function (r) { return !r.returned; }); }
    if (tab === 'done') { return out.filter(function (r) { return r.returned; }); }
    return out;
  }

  function retRows() {
    var B = window.DB_BIZ;
    if (!B || !live) { return []; }
    return (B.returns || []).map(function (t) {
      var r = DB.item(t.q) || {};
      return {
        q: t.q, name: r.name || '품명 미확인', cond: t.cond, left: t.left, off: t.off,
        wo: t.wo, asm: t.asm, code: t.code, issueWh: t.issueWh, acc: t.acc,
        locator: t.locator, unit: unitOf(t.q),
        stock: r.stock, target: r.target, actionNow: r.actionNow, price: r.price,
        /* 반납한 이력이 있는가 · 상태는 이 줄에서만 보여 준다 */
        returned: retDone(t.q),
        /* 반납 트랜잭션 종류. 부호는 config 가 정한다 · 화면이 정하지 않는다 */
        txnType: '반납'
      };
    });
  }

  /* 반납하면 무엇이 바뀌는지 미리 보여 준다 */
  function retEffect(r) {
    if (!live) { return null; }
    var cur = DB.item(r.q);
    if (!cur) { return null; }
    var after = Number(cur.stock) + Number(r.left);
    var tgt = Number(cur.target);
    return {
      stock: [cur.stock, after],
      action: [cur.actionNow, after >= tgt ? (after > tgt ? '감축' : '유지') : '발주'],
      amount: Math.round((Number(cur.price) || 0) * Number(r.left))
    };
  }

  // ================================================================ 단계
  /* 원본 → 실행 → 확정. 「실행」 은 알고리즘을 여기서 돌리는 것이 아니라
   * feat/algo 엔진이 이 DB 로 이미 계산해 둔 결과(2층)를 화면에 올리는 것이다.
   * 그렇게 적는다 · 돌리는 척하면 안 된다.
   *
   * 승인이 쌓여 있어도 algo 로 보지 않는다. 「보유목적 판단」 을 누르고 들어오면
   * 언제나 원본 속성부터 본다 · 실행은 사람이 버튼으로 한다 */
  var STAGE_KEY = (window.CFG || {}).STAGE_KEY || 'mtrl.stage.v1';
  function stage() {
    var v = null;
    try { v = window.localStorage.getItem(STAGE_KEY); } catch (e) { v = null; }
    return v === 'algo' ? 'algo' : 'raw';
  }
  function setStage(v) {
    try { window.localStorage.setItem(STAGE_KEY, v); } catch (e) { /* 무시 */ }
  }

  /* 언제 판단했는지 · 실행한 시각을 그대로 남긴다.
   * 기준일(데이터 스냅샷 날짜)과 다른 값이라 따로 적는다 */
  var STAMP_KEY = STAGE_KEY + '.at';
  function stamp() {
    try { return window.localStorage.getItem(STAMP_KEY) || ''; } catch (e) { return ''; }
  }
  function setStamp(v) {
    try { window.localStorage.setItem(STAMP_KEY, v); } catch (e) { /* 무시 */ }
  }
  /* 년 · 월 · 일 · 시 · 분 · 초. 초까지 적어야 「언제 돌린 판단인가」 가 가려진다 */
  function nowStamp(d) {
    var t = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' +
      p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds());
  }

  /* 사람의 확정을 알고리즘 담당의 경계 파일 형식으로 낸다.
   * 03_연동_인터페이스.md · classification_result.csv (Qcode, DeptCode, Type, 신뢰도, 판단근거)
   * 엔진은 이 파일을 읽어 보험품 · 계획품 행만 Type 을 바꾸고 적정재고를 다시 낸다.
   * 확정이 없는 행은 알고리즘 판정을 그대로 낸다 · 회색지대는 엔진이 원본 Type 을 쓴다 */
  function exportClassification() {
    var lines = ['Qcode,DeptCode,Type,신뢰도,판단근거'];
    rows().forEach(function (r) {
      /* 확정한 것만 사람 값으로 낸다. 확정 대기는 아직 우리 안의 값이다 */
      var human = !!r.committed;
      var t = human ? r.type : (r.verdict || r.baseType);
      var conf = human ? 'HIGH' : (r.conf || '');
      /* 승인 사유는 이미 「담당자 확정 · …」 로 적혀 있다. 없을 때만 채운다 */
      var why = human ? ((r.override && r.override.reason) || '담당자 확정') : (r.why || '');
      lines.push([r.q, r.dept, t, conf, '"' + String(why).replace(/"/g, '""') + '"'].join(','));
    });
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }

  // ================================================================ 공통
  function UInum(v) { return window.UI ? UI.num(v) : String(v); }
  function won(v) { return window.UI ? UI.won(v) : String(v); }

  window.SCREEN = {
    live: live,
    ATTR_TABS: ATTR_TABS, STOCK_TABS: STOCK_TABS,
    attrBucket: attrBucket, attrList: attrList, attrCounts: attrCounts, attrDetail: attrDetail,
    gap: gap,
    stockList: stockList, stockCounts: stockCounts, stockSteps: stockSteps, stockBreak: stockBreak,
    planList: planList, planCounts: planCounts, planLead: planLead, planMats: planMats, planAxis: planAxis,
    prSteps: prSteps, prList: prList, prDraft: prDraft, prRow: prRow,
    retTabs: retTabs, retList: retList, retEffect: retEffect,
    stage: stage, setStage: setStage, exportClassification: exportClassification,
    POOL_TABS: POOL_TABS, poolList: poolList, poolCounts: poolCounts, poolSpec: poolSpec,
    stockStage: stockStage, setStockStage: setStockStage,
    stockStamp: stockStamp, setStockStamp: setStockStamp, stockHeat: stockHeat,
    stamp: stamp, setStamp: setStamp, nowStamp: nowStamp,
    /* 승인 · 반납이 일어나면 화면이 다시 그려져야 한다 */
    on: function (fn) { if (live) { DB.on(fn); } }
  };
})();
