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

  // ================================================================ 속성값 판단
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
    { key: 'done', label: '승인 완료' }
  ];

  function attrBucket(r) {
    if (r.typeSrc === 'override') { return 'done'; }
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
      insBase: 0, plnBase: 0, stale: 0, recalc: 0 };
    all.forEach(function (r) {
      var b = attrBucket(r);
      c[b] += 1;
      if (b !== 'out' && b !== 'same') { c.all += 1; }
      if (r.baseType === '보험품') { c.insBase += 1; } else if (r.baseType === '계획품') { c.plnBase += 1; }
      if (r.stale) { c.stale += 1; if (r.recalc && !r.recalc.done) { c.recalc += 1; } }
    });
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
      { n: 1, title: '속성별로 다른 공식', right: '보험품 ' + ins + ' · 계획품 ' + pln,
        open: true, kind: 'formula',
        ins: ins, pln: pln,
        insFormula: sp.insFormula || [], plnFormula: sp.plnFormula || [],
        z: sp.z || {}, sl: sp.sl || {}, zNote: sp.zNote || '', plnNote: sp.plnNote || '' },
      { n: 2, title: '목표재고 계산', right: UInum(s.items) + '품목', kind: 'target',
        note: sp.formula || '' },
      { n: 3, title: '조치 판정', right: '발주 ' + (s.action['발주'] || 0) +
          ' · 유지 ' + (s.action['유지'] || 0) + ' · 감축 ' + (s.action['감축'] || 0),
        kind: 'table', signalIns: sp.signalIns || [], signalPln: sp.signalPln || [] },
      { n: 4, title: '공용화 후보', right: UInum(s.poolItems) + '품목 · 회수 ' + won(s.poolAmt),
        kind: 'pool', pool: sp.pool || [], stale: sp.stale || '',
        items: s.poolItems, amt: s.poolAmt, hold: s.poolHoldItems, holdAmt: s.poolHoldAmt },
      { n: 5, title: '금융비용 절감', right: '연 ' + won(s.finance), kind: 'fin',
        text: sp.finance || '', rate: s.financeRate, interest: s.financeInterest,
        cutAmt: s.cutAmt, poolAmt: s.poolAmt, finance: s.finance },
      { n: 6, title: '무재고 99.2% 는 오류가 아닙니다', right: '목표 0 · ' + UInum(zeroT) + '품목',
        kind: 'zero', zeroTarget: zeroT, items: s.items }
    ];
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
        ? (UInum(r.target) + ' → ' + (r.recalc && r.recalc.done ? UInum(r.targetNow) : '재계산 대기'))
        : UInum(r.target)],
      ['조치', r.actionNow || '미확인']
    ].concat(r.stale ? [['속성 변경', r.stockType + ' → ' + r.type + ' · ' + r.recalc.rule]] : []);
  }

  // ================================================================ 정비계획
  /* PLAN 은 생성기가 만든 2층 값이다. 화면이 쓸 모양으로만 바꾼다.
   * WO 번호는 원천에 없다 · 설비 · 휴지구분 · 정지시작일로 만든 표시용 식별자다 */
  function planList(sort) {
    var P = window.PLAN;
    if (!P) { return []; }
    var out = P.wos.slice();
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

  function planCounts() {
    var P = window.PLAN;
    if (!P) { return { wos: 0, over: 0, now: 0, mats: 0 }; }
    var c = P.meta.counts;
    /* 「지금 신청」 은 마감 초과가 아니라 재고가 예상 소요보다 적은 건이다.
     * 마감을 넘겼다는 것과 지금 신청해야 한다는 것은 다르다 */
    var nowN = live ? DB.list({ dueDate: function (v) { return !!v; } })
      .filter(function (r) { return r.signal === 'red'; }).length : 0;
    return { wos: c.wos, over: c.tone.over, now: nowN, mats: c.mats };
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
        needOrder: !!need[q], signal: r.signal, ltMean: r.ltMean, price: r.price
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
      fill: due === null ? null : [Math.min(at(due), at(now)), Math.max(at(due), at(now))]
    };
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
  function prList() {
    var B = window.DB_BIZ;
    if (!B || !live) { return []; }
    return (B.purchase || []).map(function (p) {
      var r = DB.item(p.q) || {};
      return {
        q: p.q, name: r.name || '품명 미확인', qty: p.qty, active: p.active, warn: p.warn,
        wo: p.wo, kind: p.kind, eq: p.eq, planDate: p.planDate,
        price: r.price, amount: Math.round((Number(r.price) || 0) * (Number(p.qty) || 0)),
        ltMean: r.ltMean, grade: r.grade, type: r.type, csp: r.csp, unit: unitOf(p.q)
      };
    });
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
  function retTabs() {
    var B = window.DB_BIZ;
    var list = (B && B.returns) || [];
    var c = {};
    list.forEach(function (r) { c[r.cond] = (c[r.cond] || 0) + 1; });
    var tabs = [{ key: 'all', label: '전체', n: list.length }];
    Object.keys(c).forEach(function (k) { tabs.push({ key: k, label: k, n: c[k] }); });
    return tabs;
  }

  function retList(tab) {
    var B = window.DB_BIZ;
    if (!B || !live) { return []; }
    var out = (B.returns || []).map(function (t) {
      var r = DB.item(t.q) || {};
      return {
        q: t.q, name: r.name || '품명 미확인', cond: t.cond, left: t.left, off: t.off,
        wo: t.wo, asm: t.asm, code: t.code, issueWh: t.issueWh, acc: t.acc,
        locator: t.locator, unit: unitOf(t.q),
        stock: r.stock, target: r.target, actionNow: r.actionNow, price: r.price,
        /* 반납 트랜잭션 종류. 부호는 config 가 정한다 · 화면이 정하지 않는다 */
        txnType: '반납'
      };
    });
    if (tab && tab !== 'all') { out = out.filter(function (r) { return r.cond === tab; }); }
    return out;
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
   * 승인(3층)이 하나라도 있으면 실행한 뒤라는 뜻이므로 algo 로 본다 */
  var STAGE_KEY = (window.CFG || {}).STAGE_KEY || 'mtrl.stage.v1';
  function stage() {
    var v = null;
    try { v = window.localStorage.getItem(STAGE_KEY); } catch (e) { v = null; }
    if (v === 'algo') { return 'algo'; }
    if (live && (DB.changes().attribute_overrides || []).length) { return 'algo'; }
    return 'raw';
  }
  function setStage(v) {
    try { window.localStorage.setItem(STAGE_KEY, v); } catch (e) { /* 무시 */ }
  }

  /* 사람의 확정을 알고리즘 담당의 경계 파일 형식으로 낸다.
   * 03_연동_인터페이스.md · classification_result.csv (Qcode, DeptCode, Type, 신뢰도, 판단근거)
   * 엔진은 이 파일을 읽어 보험품 · 계획품 행만 Type 을 바꾸고 적정재고를 다시 낸다.
   * 확정이 없는 행은 알고리즘 판정을 그대로 낸다 · 회색지대는 엔진이 원본 Type 을 쓴다 */
  function exportClassification() {
    var lines = ['Qcode,DeptCode,Type,신뢰도,판단근거'];
    rows().forEach(function (r) {
      var human = r.typeSrc === 'override';
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
    planList: planList, planCounts: planCounts, planMats: planMats, planAxis: planAxis,
    prSteps: prSteps, prList: prList, prDraft: prDraft,
    retTabs: retTabs, retList: retList, retEffect: retEffect,
    stage: stage, setStage: setStage, exportClassification: exportClassification,
    /* 승인 · 반납이 일어나면 화면이 다시 그려져야 한다 */
    on: function (fn) { if (live) { DB.on(fn); } }
  };
})();
