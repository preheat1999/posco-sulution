/* analysis-data.js · 화면 어댑터
 *
 * 화면은 계산하지 않는다. 화면이 필요한 모양으로 바꿔 주는 곳이 여기다.
 * **DB API 만 쓴다.** DB_MASTER · DB_DERIVED 를 직접 읽지 않는다.
 * 층 구조가 바뀌어도 화면을 고칠 필요가 없어야 한다.
 *
 * 반드시 db.js 뒤에 로드한다.
 * 앞에 두면 window.DB 가 없어서 조용히 FALLBACK 으로 그리고,
 * 화면은 「대장 없음」 을 정상처럼 보여 준다. 지난 리허설에서 실제로 낸 버그다.
 */
(function () {
  'use strict';

  var live = !!window.DB;

  /* DB 가 없을 때 쓸 작은 배열.
   * 코드는 전부 정본 743 안에 있는 실제 코드다.
   * 없는 코드를 쓰면 눌렀을 때 빈 화면이 뜨고 검사기 불변식 1 이 잡는다 */
  var FALLBACK = {
    asof: null,
    counts: { equipment: 14, materials: 743 },
    bucket: { '판단 완료': 0, '보험품→계획품': 149, '계획품→보험품': 90,
              '현행유지': 31, '판정일치': 340, '배제': 133 },
    action: { '발주': 120, '유지': 142, '감축': 481 },
    signal: { red: 67, yellow: 59, green: 129, gray: 488 },
    money: { nowAmt: 4974493448, tgtAmt: 5788775890, cutAmt: 2970514193,
             poolAmt: 946739938, poolItems: 262, finance: 36038738,
             financeRate: 0.2, financeInterest: 0.046 },
    needRows: [
      { q: 'Q4604630', name: 'General Pump (Ready)', eq: null, type: '보험품', grade: 'S',
        stock: 0, target: 1, needNow: 1, price: 1503362000, csp: true, signal: 'red' },
      { q: 'Q4521625', name: 'Drive Coupling', eq: null, type: '보험품', grade: 'S',
        stock: 0, target: 1, needNow: 1, price: 1040000000, csp: true, signal: 'red' },
      { q: 'Q1074772', name: 'WEDGE SEGMENT MANDREL', eq: null, type: '보험품', grade: 'S',
        stock: 0, target: 4, needNow: 4, price: 52155000, csp: true, signal: 'red' }
    ],
    dueRows: [
      { q: 'Q4439266', name: 'Hydraulic Cylinder(Critical)', sigEq: 'QOC Servo',
        sigKind: '대수리', grade: 'S', dDays: -332, dueDate: '2025-10-06',
        signal: 'red', status: '즉시발주', expect: 1, stock: 0 }
    ]
  };

  function esc(s) { return window.UI ? UI.esc(s) : String(s === null ? '' : s); }

  // ---------------------------------------------------------------- 기본
  function meta() {
    if (!live) { return { asof: FALLBACK.asof, counts: FALLBACK.counts, live: false }; }
    var m = DB.meta();
    return { asof: m.asof, counts: m.counts, live: true };
  }

  function summary() {
    if (!live) {
      return {
        items: FALLBACK.counts.materials,
        bucket: FALLBACK.bucket, action: FALLBACK.action, signal: FALLBACK.signal,
        nowAmt: FALLBACK.money.nowAmt, tgtAmt: FALLBACK.money.tgtAmt,
        cutAmt: FALLBACK.money.cutAmt, poolAmt: FALLBACK.money.poolAmt,
        poolItems: FALLBACK.money.poolItems, finance: FALLBACK.money.finance,
        financeRate: FALLBACK.money.financeRate,
        financeInterest: FALLBACK.money.financeInterest,
        judgedN: 0, waitingN: 0, staleN: 0, recalcN: 0
      };
    }
    return DB.summary();
  }

  // ---------------------------------------------------------------- 도넛
  /* 743종을 「사람이 아직 손대야 하는가」 로 나눈다.
   *
   * 처음에는 DB.summary().bucket 을 그대로 썼다. 그런데 그 값은 2층 판정을
   * 1층 정본과 견준 것이라 **승인해도 움직이지 않는다.** 승인은 3층에 쌓이므로
   * verdict 는 그대로 남기 때문이다.
   * 그러면 이 시스템의 핵심(승인 한 건이 화면을 움직인다)이 대시보드에서 안 보인다.
   *
   * 그래서 사람이 판단한 건(judged)을 「판단 완료」 로 따로 센다.
   * 담당자가 한 건 승인하면 초록 조각이 커지고 주황 조각이 줄어든다.
   * 알고리즘 판정값 자체는 근거 화면을 위해 그대로 남아 있다 */
  var DONUT_ORDER = [
    { key: '판단 완료', label: '판단 완료', color: 'var(--ok)', act: true },
    { key: '보험품→계획품', label: '보험품 → 계획품', color: 'var(--plan)', act: true },
    { key: '계획품→보험품', label: '계획품 → 보험품', color: 'var(--insur)', act: true },
    { key: '현행유지', label: '현행유지', color: 'var(--core)', act: true },
    /* 손댈 필요 없는 두 조각은 네이비로 가라앉힌다.
     * 회색으로 두면 도넛에서 이것들이 먼저 눈에 온다 · 763종 중 473종이라 면적이 크다 */
    { key: '판정일치', label: '판정일치', color: 'var(--slate)', act: false },
    { key: '배제', label: '배제', color: 'var(--slate-2)', act: false }
  ];

  function bucketOf(r) {
    // 사람이 확정한 것이 먼저다. 이미 처리된 건을 「해야 할 일」 로 다시 세면 안 된다
    /* 사람이 판단한 것 · 확정 전이라도 「판단 완료」 다.
   * 확정 여부는 대시보드의 확정 대기 칩이 따로 알린다 */
    if (r.judged) { return '판단 완료'; }
    var v = r.verdict, t = r.baseType;
    if (String(v || '').indexOf('배제') === 0) { return '배제'; }
    if (v === '회색지대') { return '현행유지'; }
    if (v === t) { return '판정일치'; }
    if (t === '보험품' && v === '계획품') { return '보험품→계획품'; }
    if (t === '계획품' && v === '보험품') { return '계획품→보험품'; }
    return '판정일치';
  }

  function donut() {
    var b = {}, i, total = 0;
    for (i = 0; i < DONUT_ORDER.length; i++) { b[DONUT_ORDER[i].key] = 0; }

    if (live) {
      var rows = DB.list();
      for (i = 0; i < rows.length; i++) { b[bucketOf(rows[i])] += 1; }
      total = rows.length;
    } else {
      var fb = FALLBACK.bucket;
      for (var k in fb) {
        if (Object.prototype.hasOwnProperty.call(fb, k)) { b[k] = fb[k]; total += fb[k]; }
      }
    }

    var segs = DONUT_ORDER.map(function (d) {
      return {
        key: d.key, label: d.label, color: d.color, act: d.act, n: b[d.key],
        pct: total ? (b[d.key] / total * 100) : 0
      };
    });
    return {
      total: total, segs: segs,
      change: b['보험품→계획품'] + b['계획품→보험품'],
      hold: b['현행유지'],
      done: b['판단 완료']
    };
  }

  // ---------------------------------------------------------------- 돈
  /* 「이만큼 빼도 된다」 를 한눈에 느끼게 하려면 세 값이 같이 있어야 한다.
   *   지금 재고에서 목표를 넘는 몫 (감축 가능)
   *   그 몫이 재고에서 차지하는 비중
   *   그래서 해마다 남는 돈 (금융비용 절감)
   * 셋 중 하나만 보여 주면 그냥 큰 숫자로 지나간다 */
  function money() {
    var s = summary();
    var now = Number(s.nowAmt) || 0;
    var cut = Number(s.cutAmt) || 0;
    var keep = Math.max(0, now - cut);
    var need = Math.max(0, (Number(s.tgtAmt) || 0) - keep);   // 목표에 못 미치는 몫
    return {
      nowAmt: now, tgtAmt: Number(s.tgtAmt) || 0,
      cutAmt: cut, keepAmt: keep, needAmt: need,
      cutPct: now ? (cut / now * 100) : 0,
      poolAmt: Number(s.poolAmt) || 0,
      poolItems: Number(s.poolItems) || 0,
      finance: s.finance === null || s.finance === undefined ? null : Number(s.finance),
      rate: s.financeRate, interest: s.financeInterest,
      cutItems: (s.action && s.action['감축']) || 0,
      orderItems: (s.action && s.action['발주']) || 0
    };
  }

  // ---------------------------------------------------------------- 오늘 할 일
  /* 「지금」 은 재고가 목표의 절반에 못 미치는 것(즉시발주 신호)이다.
   *
   * 정비 일정에 묶인 56건으로 세면 0건이 나온다. 그 56건은 마감을 넘겼지만
   * 재고로 버티고 있어 need 가 0이기 때문이다.
   * 세는 단위를 헷갈리면 「지금 할 일」 이 사라지거나 부풀려진다 */
  function todo() {
    var s = summary(), m = money();
    var sig = s.signal || {};
    var d = donut();
    var out = [];

    out.push({
      tone: 'now', tag: '지금', n: sig.red || 0, unit: '품목',
      text: '재고가 목표의 절반에 못 미칩니다',
      why: '현재고 0 이거나 목표의 절반 미만인 자재입니다. 리드타임이 긴 것부터 봅니다',
      acts: [['적정재고 분석 열기', 'stock.html#order']]
    });
    out.push({
      tone: 'week', tag: '이번 주', n: sig.yellow || 0, unit: '품목',
      text: '목표재고에 못 미쳐 발주가 임박했습니다',
      why: '이번 주에 신청하면 리드타임 안에 들어옵니다',
      acts: [['발주 필요 목록 보기', 'stock.html#order']]
    });
    out.push({
      tone: 'chance', tag: '기회', n: m.cutItems, unit: '품목',
      text: '목표재고보다 재고가 많습니다 · ' + won(m.cutAmt) + ' 감축 가능',
      why: '공용 전환하거나 다음 발주를 미루면 됩니다. 안 해도 되지만 하면 돈이 남습니다',
      acts: [['공용 전환 검토', 'stock.html#cut']]
    });
    out.push({
      tone: 'review', tag: '검토', n: d.hold, unit: '품목',
      text: '알고리즘이 확정하지 못했습니다' +
            (d.done ? ' · 지금까지 ' + d.done + '건 승인' : ''),
      why: '점수 차이가 작아 판단을 보류한 건입니다. 담당자 승인이 첫 라벨이 됩니다. ' +
           '승인하면 이 숫자가 줄어듭니다',
      acts: [['속성값 판단 열기', 'attr.html']]
    });
    return out;
  }

  function won(v) { return window.UI ? UI.won(v) : String(v); }

  // ---------------------------------------------------------------- 발주 마감일
  /* 정비 일정에 묶인 자재. dDays 오름차순.
   * 얼굴은 남은 일수로 정한다. 신호(red/gray)는 재고 기준이라 따로 배지로 낸다.
   * 둘을 한 아이콘에 섞으면 무엇을 보고 급한지 알 수 없다 */
  function dueList(limit) {
    if (!live) { return { rows: FALLBACK.dueRows.slice(0, limit || 5), total: 56, now: 6 }; }
    var rows = DB.list({ dueDate: function (v) { return !!v; } });
    rows.sort(function (a, b) { return Number(a.dDays) - Number(b.dDays); });
    var nowN = rows.filter(function (r) { return (r.signalNow || r.signal) === 'red'; }).length;
    return { rows: limit ? rows.slice(0, limit) : rows, total: rows.length, now: nowN };
  }

  // ---------------------------------------------------------------- 진행 파이프라인
  /* 선형 진행이 아니라 단계마다 건이 쌓이는 모양이다.
   *
   * 원천에 EAM · ERP 상태 코드가 없다. 그래서 지어내지 않고
   * **우리 시스템이 실제로 하는 일**을 단계로 둔다.
   * 마지막 단계는 사내 시스템 연동이라 「연동 예정」 으로 적는다.
   * 되는 척하면 심사에서 한 번에 들킨다 */
  function pipelines() {
    var BIZ = window.DB_BIZ;
    var ch = live ? DB.changes() : { pr_drafts: [], stock_transactions: [] };
    var pr = (BIZ && BIZ.purchase) || [];
    var rt = (BIZ && BIZ.returns) || [];

    var prDraft = (ch.pr_drafts || []).length;
    var prBlock = pr.filter(function (p) { return !p.active; }).length;
    var prReady = pr.filter(function (p) { return p.active; }).length;

    var txnReturn = (ch.stock_transactions || []).filter(function (t) {
      return t.txnType === '반납';
    }).length;

    return [
      {
        title: '구매신청 (PR)', ico: '🛒', href: 'purchase.html',
        total: pr.length, unit: '건',
        steps: [
          { name: '대상 확인', sub: '작업주문에 걸린 자재', n: pr.length, state: 'done' },
          { name: '자재 정보 보완', sub: '구매 불가 상태', n: prBlock, state: prBlock ? 'doing' : 'done' },
          { name: '초안 작성', sub: 'AI 가 두 시스템 항목을 채운다', n: prDraft, state: 'doing' },
          { name: 'PR 발행', sub: 'EAM · ERP 연동 예정', n: 0, state: 'wait' }
        ],
        note: prReady + '건은 바로 신청할 수 있고 ' + prBlock +
              '건은 자재 정보를 보완해야 합니다. 발행은 사내 시스템 연동 예정 구간입니다.'
      },
      {
        title: '자재반납 (QR)', ico: '↩', href: 'return.html',
        total: rt.length, unit: '건',
        steps: [
          { name: 'QR 스캔 대기', sub: '불출 잔여가 있는 자재', n: rt.length, state: 'done' },
          { name: '유형 판정', sub: '규칙으로 7갈래 즉시 판정', n: rt.length, state: 'done' },
          { name: '반납 실행', sub: '재고 트랜잭션으로 기록', n: txnReturn, state: 'doing' },
          { name: '입고 완료', sub: '창고 시스템 연동 예정', n: 0, state: 'wait' }
        ],
        note: '반납을 실행하면 재고가 바로 다시 계산되고 적정재고 조치도 같이 바뀝니다.'
      }
    ];
  }

  // ---------------------------------------------------------------- 설비별 자재
  /* 발주가 필요한 자재를 금액 큰 순으로. 위에서부터 처리하면 금액 큰 것을 먼저 본다.
   * 설비 연결이 비어 있는 건이 많다. 「미확인」 이라고 적고 지어내지 않는다 */
  function needRows(limit) {
    if (!live) {
      return { rows: FALLBACK.needRows.slice(0, limit || 5), total: 120, linked: 9, unlinked: 111 };
    }
    var rows = DB.list({ needNow: function (v) { return Number(v) > 0; } });
    var linked = rows.filter(function (r) { return !!r.eq; });
    var free = rows.filter(function (r) { return !r.eq; });
    /* 설비가 연결된 것을 위로 올린다.
     * 금액만으로 줄 세우면 설비 연결이 있는 9품목이 전부 아래로 밀려
     * 「설비별 자재 현황」 카드에 설비명이 하나도 안 뜬다.
     * 743품목 중 설비 연결이 있는 것은 131품목뿐이다. 원천의 한계이므로
     * 숨기지 않고 카드에 몇 품목이 미연결인지 적는다 */
    var byAmt = function (a, b) {
      return (Number(b.needNow) * Number(b.price)) - (Number(a.needNow) * Number(a.price));
    };
    linked.sort(byAmt);
    free.sort(byAmt);
    var all = linked.concat(free);
    return {
      rows: limit ? all.slice(0, limit) : all,
      total: rows.length, linked: linked.length, unlinked: free.length
    };
  }

  // ---------------------------------------------------------------- 재고 금액 트렌드
  /* 「우리 부서 자재 금액이 오르고 있나」 를 선 하나로 보여 준다.
   *
   * 원천 CSV 11개 어디에도 **월말 재고 스냅샷이 없다.** 그래서 월별 재고를
   * 그대로 읽을 수는 없다. 대신 지금 보유 중인 자재를 입고일(recvDate)
   * 기준으로 되쌓는다. 「이 재고가 어떻게 쌓여 왔는가」 는 이 방법으로
   * 정확히 나오고, 「그 달의 월말 재고」 와는 다르다.
   * 그 차이를 화면과 근거 팝오버에 그대로 적는다. 지어낸 값이 아니다.
   *
   * 값이 어긋나는 곳도 적어 둔다.
   *   recvDate 가 없는 39품목은 곡선에 안 들어간다. 그래서 마지막 점이
   *   보유 재고 총액보다 1.2억원 적다.
   *   불출로 이미 빠진 수량은 과거 시점에도 빠진 것으로 그려진다.
   *
   * 초록 선은 같은 자재 743종의 **전사 보유**(stockAll)다.
   * 원천에 사업장 칸이 없어 「광양소」 로 못 쓴다. 없는 칸을 만들지 않는다. */
  function monthKeys(base, n) {
    var y = Number(String(base).slice(0, 4)), m = Number(String(base).slice(5, 7));
    var out = [], i, mm, yy;
    for (i = n - 1; i >= 0; i--) {
      mm = m - i; yy = y;
      while (mm <= 0) { mm += 12; yy -= 1; }
      out.push(yy + '-' + (mm < 10 ? '0' + mm : String(mm)));
    }
    return out;
  }

  /* 데이터가 없을 때 쓰는 시연용 곡선.
   * 반드시 src 를 'demo' 로 돌려준다. 화면이 「시연용」 배지를 띄운다.
   * 실제 값처럼 보이게 두면 안 된다 */
  function demoTrend(n) {
    var ms = monthKeys(CFG_BASE(), n), dept = [], all = [], i, k;
    for (i = 0; i < ms.length; i++) {
      k = i / (ms.length - 1);
      dept.push(Math.round(1.72e9 * (1 + 1.82 * k * k)));
      all.push(Math.round(2.56e9 * (1 + 2.52 * k * k)));
    }
    return finishTrend(ms, dept, all, 'demo', 0, 0);
  }

  function CFG_BASE() {
    var m = meta();
    return m.asof || (window.CFG && CFG.BASE_DATE) || '2026-09-03';
  }

  function finishTrend(ms, dept, all, src, missing, missingAmt) {
    var f = dept[0], l = dept[dept.length - 1];
    /* 방향은 창 전체의 처음과 끝으로 정한다.
     * 오르면 빨강, 내리면 파랑 · 색이 뜻을 갖는다 */
    var dir = l > f ? 'up' : (l < f ? 'down' : 'flat');
    var max = Math.max.apply(null, all.concat(dept)) || 1;
    return {
      src: src, months: ms, dept: dept, all: all,
      max: max,
      deptFirst: f, deptLast: l,
      allFirst: all[0], allLast: all[all.length - 1],
      pct: f ? ((l / f - 1) * 100) : null,
      allPct: all[0] ? ((all[all.length - 1] / all[0] - 1) * 100) : null,
      dir: dir,
      missing: missing, missingAmt: missingAmt
    };
  }

  function trend(n) {
    n = n || 13;
    if (!live) { return demoTrend(n); }

    var rows = DB.list();
    var ms = monthKeys(CFG_BASE(), n);
    var dept = [], all = [], i, j, r, end, d, a;
    var missing = 0, missingAmt = 0;

    for (j = 0; j < rows.length; j++) {
      if (!rows[j].recvDate) {
        missing += 1;
        missingAmt += (Number(rows[j].price) || 0) * (Number(rows[j].stock) || 0);
      }
    }

    for (i = 0; i < ms.length; i++) {
      /* 그 달 말까지 들어온 것만 센다. 문자열 비교로 충분하다 (ISO 날짜) */
      end = ms[i] + '-31';
      d = 0; a = 0;
      for (j = 0; j < rows.length; j++) {
        r = rows[j];
        if (!r.recvDate || String(r.recvDate) > end) { continue; }
        d += (Number(r.price) || 0) * (Number(r.stock) || 0);
        a += (Number(r.price) || 0) * (Number(r.stockAll) || 0);
      }
      dept.push(Math.round(d));
      all.push(Math.round(a));
    }

    /* 곡선이 한 점도 안 나오면(입고일이 전부 비었으면) 시연용으로 돌린다.
     * 빈 차트를 띄우면 화면이 고장난 것처럼 보인다 */
    if (!dept[dept.length - 1]) { return demoTrend(n); }
    return finishTrend(ms, dept, all, 'derived', missing, Math.round(missingAmt));
  }

  /* 타부서 보유가 있으면 사는 대신 이관받을 수 있다. 사는 것보다 싸다 */
  function transferable(r) {
    var all = Number(r.stockAll) || 0, mine = Number(r.stock) || 0;
    return Math.max(0, all - mine);
  }

  window.ANALYSIS = {
    live: live,
    bucketOf: bucketOf,
    meta: meta,
    summary: summary,
    donut: donut,
    money: money,
    todo: todo,
    dueList: dueList,
    pipelines: pipelines,
    needRows: needRows,
    trend: trend,
    transferable: transferable,
    DONUT_ORDER: DONUT_ORDER,
    /* 승인 · 반납이 일어나면 화면이 다시 그려져야 한다.
     * 어댑터가 구독을 대신 걸어 주면 화면마다 DB 존재 여부를 확인하지 않아도 된다 */
    on: function (fn) { if (live) { DB.on(fn); } }
  };
})();
