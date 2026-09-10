/* ask.js · 이 서비스 데이터로 답하는 실행기
 *
 * 라우터(LLM)가 고른 도구 이름과 값을 받아 **브라우저 안에서** 답을 만든다.
 * 숫자는 언제나 어댑터(DB · SCREEN · ANALYSIS)에서 읽는다 ·
 * 여기서 산식을 새로 만들지 않고, 값이 LLM 을 거치지도 않는다 (지어낼 여지를 없앤다).
 *
 * 돌려주는 모양 ·
 *   { kind: 'data' | 'about', text, table?, evidence[], link?, unknown? }
 *   text     · 한 문장 답 (마크다운)
 *   table    · {head:[], rows:[[]]} 여러 건을 나열할 때만
 *   evidence · [['어디서 왔나', '무엇']] · 함수 · 필드 · 산식 · 기준일
 *   link     · {href, label} 그 값을 보여 주는 화면
 *
 * 규칙 · 못 찾으면 unknown: true 로 돌려준다. 비슷한 값을 대신 주지 않는다.
 */
window.ASK = (function () {
  'use strict';

  function DBok() { return !!(window.DB && window.SCREEN); }
  function num(v) { return window.UI ? UI.num(v) : String(v); }
  function won(v) { return window.UI ? UI.won(v) : String(v); }
  function asof() { return window.DB ? UI.date(DB.meta().asof) : ''; }

  /* 모든 데이터 답에 붙는 기준일 · 화면 숫자는 스냅샷 날짜 기준이다 */
  function base(ev) { return ev.concat([['기준일', asof() + ' 스냅샷']]); }

  // ================================================================ 도구
  var RUN = {};

  /* 조치별 건수 · 발주 · 유지 · 감축 */
  RUN.count_action = function (a) {
    var act = String(a.action || '').trim();
    var map = { '발주': 'order', '유지': 'keep', '감축': 'cut' };
    if (!map[act]) { return unknown('조치는 발주 · 유지 · 감축 세 가지입니다'); }
    var c = SCREEN.stockCounts();
    var s = DB.summary();
    var n = c[map[act]];
    var extra = act === '발주'
      ? '부족분을 채우는 데 ' + won(SCREEN.planCounts().orderAmt) + ' 정도가 듭니다'
      : (act === '감축' ? '목표를 넘는 몫이 ' + won(s.cutAmt) + ' 입니다'
         : '목표와 수량이 같아 손댈 것이 없습니다');
    return {
      kind: 'data',
      text: '지금 **' + act + '** 대상은 **' + num(n) + '품목**입니다 · ' + extra + '.',
      evidence: base([
        ['센 방법', 'SCREEN.stockCounts() · 보유(stock)와 지금 목표(targetNow) 비교'],
        ['전체', num(s.items) + '품목 · 발주 ' + num(c.order) + ' · 유지 ' + num(c.keep) +
          ' · 감축 ' + num(c.cut)],
        ['확정 반영', s.staleN ? '확정 속성으로 목표를 다시 잡은 ' + num(s.staleN) + '품목 포함'
          : '담당자 확정으로 바뀐 목표는 아직 없습니다']
      ]),
      link: { href: 'stock.html#' + (act === '감축' ? 'cut' : 'order'),
              label: '적정재고 분석에서 보기' }
    };
  };

  /* 금액 요약 */
  RUN.money_summary = function (a) {
    var s = DB.summary();
    var kind = String(a.kind || '').trim();
    var M = {
      now: ['지금 보유 재고', s.nowAmt, '자재 743품목의 보유 수량 × 단가',
            'main.html', '대시보드에서 보기'],
      target: ['목표재고 금액', s.tgtAmt, '지금 목표(targetNow) × 단가',
               'stock.html', '적정재고 분석에서 보기'],
      cut: ['감축 가능 금액', s.cutAmt, '목표를 넘는 몫 × 단가',
            'stock.html#cut', '감축 대상 보기'],
      pool: ['공용화 회수 금액', s.poolAmt, '정체 자재 중 즉시공용화 · 공용화권장 판정의 묶인 금액',
             'pool.html', '공용 전환에서 보기'],
      finance: ['금융비용 절감액', s.finance, s.financeFormula || '(감축 + 회수) × 기여율 × 이자율',
                'stock.html', '금융비용 단계 보기']
    };
    var m = M[kind];
    if (!m) { return unknown('금액은 보유 · 목표 · 감축 · 회수 · 금융비용 다섯 가지를 답할 수 있습니다'); }
    var ev = [['산출', m[2]]];
    if (kind === 'finance') {
      ev.push(['상수', '기여율 ' + s.financeRate + ' · 이자율 ' + s.financeInterest +
        ' (명세에서 읽은 값 · 화면이 만들지 않습니다)']);
      ev.push(['재료', '감축 ' + won(s.cutAmt) + ' + 회수 ' + won(s.poolAmt)]);
    }
    if (kind === 'cut') { ev.push(['대상', num(SCREEN.stockCounts().cut) + '품목']); }
    if (kind === 'pool') { ev.push(['대상', num(s.poolRecoverItems) + '품목 · 보류 ' +
      num(s.poolHoldItems) + '품목은 핵심 · 보험품이라 넣지 않습니다']); }
    return {
      kind: 'data',
      text: '**' + m[0] + '** 은 **' + won(m[1]) + '** 입니다.',
      evidence: base(ev),
      link: { href: m[3], label: m[4] }
    };
  };

  /* 속성값 판단 현황 */
  RUN.attr_status = function () {
    var c = SCREEN.attrCounts();
    var cm = DB.commitInfo();
    var stage = SCREEN.stage();
    return {
      kind: 'data',
      /* 판정 값은 2층에 이미 있다. 화면이 아직 「알고리즘 실행」 을 누르지 않았을 뿐이라
       * 숫자는 답하고 그 사실을 같이 적는다 */
      text: (stage === 'raw'
          ? '이 화면에서는 아직 **「알고리즘 실행」 을 누르지 않았습니다** (정본 속성만 보입니다) · '
          : '') +
        '손대야 하는 자재는 **' + num(c.all) + '품목**입니다 · ' +
        '보험품→계획품 ' + num(c.i2p) + ' · 계획품→보험품 ' + num(c.p2i) +
        ' · 회색지대 보류 ' + num(c.gray) + ' · 담당자 판단 ' + num(c.done) +
        (c.waiting ? ' · **확정 대기 ' + num(c.waiting) + '**' : ' · 확정 대기 없음') + '.',
      evidence: base([
        ['정본 속성', '보험품 ' + num(c.insBase) + ' · 계획품 ' + num(c.plnBase) +
          (stage === 'raw' ? ' (지금 화면에 보이는 값)' : '')],
        ['센 방법', 'SCREEN.attrCounts() · 2층 판정(verdict)을 정본 속성(baseType)과 견줌'],
        ['제외대상', num(c.excluded) + '품목 (사전 배제 ' + num(c.out) +
          ' · 판정일치 ' + num(c.same) + ') · 743 = 손대야 하는 것 + 제외대상'],
        ['확정', cm.done ? num(cm.done) + '품목 · ' + cm.at
          : '아직 확정한 판단이 없습니다 (다른 화면은 알고리즘 판정 속성을 씁니다)'],
        ['회색지대란', '보험품 점수와 계획품 점수 차이가 작아 알고리즘이 보류한 자재입니다']
      ]),
      link: { href: 'attr.html#gray', label: '속성값 판단에서 보기' }
    };
  };

  /* 자재 한 건 */
  RUN.material_detail = function (a) {
    var code = String(a.code || '').trim().toUpperCase();
    if (!/^Q[A-Z0-9]{6,8}$/.test(code)) {
      return unknown('자재코드는 Q 와 숫자 7자리입니다 (예 Q1000108)');
    }
    var r = DB.item(code);
    if (!r) {
      /* QR 로 등록한 자재일 수 있다 · 그것도 아니면 없는 코드다 */
      var qr = window.QRDB ? QRDB.get(code) : null;
      if (qr && !qr.inMaster) {
        return {
          kind: 'data',
          text: '**' + (code) + '** 은 우리 부서 자재 대장(743품목) 밖입니다 · ' +
            'QR 로 등록한 자재이고 재고부서가 ' + (qr.deptCode) + ' 입니다.',
          evidence: base([['품명', qr.name + (qr.spec ? ' · ' + qr.spec : '')],
                          ['출처', 'assets/qr-items.js · 자재식별표 QR']]),
          link: { href: 'material-view.html?code=' + encodeURIComponent(code), label: '자재 확인 화면' }
        };
      }
      return unknown('**' + (code) + '** 은 우리 부서 자재 743품목에 없습니다');
    }
    var d = SCREEN.attrDetail(r);
    var rows = [
      ['속성', r.type + (r.judged ? ' (담당자 ' + (r.committed ? '확정' : '판단 · 대기') + ')' : ' · ' + UI.srcLabel(r.typeSrc))],
      ['등급', r.grade + '등급' + (r.csp ? ' · 핵심예비품' : '')],
      ['현재고 → 목표', num(r.stock) + ' → ' + num(r.targetNow) +
        (r.stale ? ' (확정 속성으로 다시 잡음 · 반출값 ' + num(r.target) + ')' : '')],
      ['조치', r.actionNow + (r.needNow ? ' · 부족 ' + num(r.needNow) : '')],
      ['목표 산식', r.reasonNow || r.reason || '미확인'],
      ['리드타임', num(r.ltMean) + '일 (편차 ' + num(r.ltStd) + ')'],
      ['단가 · 재고금액', won(r.price) + ' · ' + won(r.price * r.stock)],
      ['판정 점수', '보험품 ' + (Number(r.si) || 0).toFixed(1) + ' · 계획품 ' +
        (Number(r.sp) || 0).toFixed(1) + ' · 신뢰도 ' + (d ? d.confText : '미확인')]
    ];
    return {
      kind: 'data',
      text: '**' + (r.name || '품명 미확인') + '** (' + (r.q) + ') · ' +
        r.type + ' · 목표 ' + num(r.targetNow) + ' · 보유 ' + num(r.stock) +
        ' · 조치 **' + r.actionNow + '**' +
        (r.reasonNow ? '\n\n목표가 그 값인 이유 · `' + r.reasonNow + '`' : ''),
      table: { head: ['항목', '값'], rows: rows },
      evidence: base([
        ['자재', 'DB.item(\'' + r.q + '\') · 1층 정본 + 2층 파생 + 3층 사람이 한 일'],
        ['속성별 목표', '보험품이면 ' + num(r.targetIns) + ' · 계획품이면 ' + num(r.targetPln) +
          ' (엔진을 각각 돌려 미리 구운 값)']
      ]),
      link: { href: 'attr.html#all', label: '이 자재의 판정 근거 보기' }
    };
  };

  /* 순위 표 */
  RUN.top_materials = function (a) {
    var by = String(a.by || '').trim();
    var lim = Math.max(1, Math.min(10, Number(a.limit) || 5));
    var rows = DB.list();
    var KEY = {
      cut: [function (r) { return Math.max(0, r.stock - r.targetNow) * (r.price || 0); },
            '감축 금액', function (r) { return won(Math.max(0, r.stock - r.targetNow) * (r.price || 0)); }],
      need: [function (r) { return Number(r.needNow) || 0; },
             '부족 수량', function (r) { return num(r.needNow); }],
      price: [function (r) { return Number(r.price) || 0; }, '단가', function (r) { return won(r.price); }],
      stock: [function (r) { return (Number(r.stock) || 0) * (Number(r.price) || 0); },
              '보유 금액', function (r) { return won(r.stock * r.price); }],
      stale: [function (r) { return Number(r.staleValue) || 0; },
              '묶인 금액', function (r) { return won(r.staleValue); }]
    };
    var k = KEY[by];
    if (!k) { return unknown('순위 기준은 감축 금액 · 부족 수량 · 단가 · 보유 금액 · 정체 금액입니다'); }
    var top = rows.filter(function (r) { return k[0](r) > 0; })
      .sort(function (x, y) { return k[0](y) - k[0](x); }).slice(0, lim);
    if (!top.length) { return unknown('그 기준에 해당하는 자재가 없습니다'); }
    return {
      kind: 'data',
      text: '**' + k[1] + '** 이 큰 자재 ' + num(top.length) + '건입니다.',
      table: {
        head: ['자재', '속성', k[1], '보유 → 목표', '조치'],
        rows: top.map(function (r) {
          return [(r.name || '품명 미확인') + ' · ' + r.q, r.type, k[2](r),
                  num(r.stock) + ' → ' + num(r.targetNow), r.actionNow];
        })
      },
      evidence: base([
        ['센 방법', 'DB.list() 전수 743품목을 ' + k[1] + ' 순으로 정렬'],
        ['금액', by === 'cut' ? '(보유 − 지금 목표) × 단가' : (by === 'stale'
          ? '2층 정체자재의 묶인 금액(staleValue)' : '정본 단가 · 보유 수량')]
      ]),
      link: { href: by === 'stale' ? 'pool.html' : 'stock.html#cut', label: '화면에서 보기' }
    };
  };

  /* 적정구매시점 */
  RUN.plan_status = function () {
    var c = SCREEN.planCounts();
    return {
      kind: 'data',
      text: '기준일부터 ' + num(c.mdays) + '일 안의 정비계획은 **' + num(c.wos) + '건**이고, ' +
        '발주 마감을 넘겼거나 임박한 것이 **' + num(c.over + c.soon) + '건**입니다 · ' +
        '예상 발주금액 ' + won(c.orderAmt) + '.',
      evidence: base([
        ['센 방법', 'SCREEN.planCounts() · 정비계획일이 기준일 +' + num(c.mdays) + '일 안인 건만'],
        ['전체', '반출 ' + num(c.all) + '건은 넉 달에 걸쳐 있어 이 화면은 한 달치만 봅니다'],
        ['소요 자재', num(c.mats) + '종'],
        ['이관 가능', c.moveN ? num(c.moveN) + '품목 · ' + won(c.moveAmt) + ' 은 사지 않고 가져올 수 있습니다'
          : '타 부서에 남는 수량이 없어 이관으로 덮을 몫은 없습니다']
      ]),
      link: { href: 'plan.html', label: '적정구매시점에서 보기' }
    };
  };

  RUN.pool_status = function () {
    var c = SCREEN.poolCounts();
    return {
      kind: 'data',
      text: '정체 자재는 **' + num(c.all) + '품목**이고, 지금 공용 전환할 수 있는 것이 ' +
        '**' + num(c.get) + '품목 · ' + won(c.getAmt) + '** 입니다' +
        (c.done ? ' · 이미 ' + num(c.done) + '품목 전환했습니다.' : '.'),
      evidence: base([
        ['센 방법', 'SCREEN.poolCounts() · 2층 정체자재 판정(strong · medium · review)'],
        ['보류', num(c.hold) + '품목 · ' + won(c.holdAmt) +
          ' · 핵심예비품이면서 보험품이라 회수 금액에 넣지 않습니다'],
        ['정체 기준', DB.meta().spec.stale || '명세에서 읽습니다']
      ]),
      link: { href: 'pool.html', label: '공용 전환에서 보기' }
    };
  };

  RUN.return_status = function () {
    var all = SCREEN.retList('all');
    var done = SCREEN.retList('done');
    var qr = DB.qrReturns ? DB.qrReturns() : [];
    return {
      kind: 'data',
      text: '반납 대상은 **' + num(all.length) + '건**이고 ' +
        '**' + num(done.length) + '건** 반납했습니다' +
        (qr.length ? ' · QR 접수 ' + num(qr.length) + '건.' : '.'),
      evidence: base([
        ['센 방법', 'SCREEN.retList() · 불출 후 남은 수량이 있는 자재'],
        ['반납 여부', '3층 이력(stock_transactions 반납 · qr_returns)으로 셉니다'],
        ['물품 상태', '신품 · 중고 · 불용 판정은 반납받은 뒤 담당자가 정합니다 · 그래서 반납 완료 칸에서만 보입니다']
      ]),
      link: { href: 'return.html', label: '자재반납에서 보기' }
    };
  };

  /* 용어 · 항목 뜻 */
  RUN.explain_term = function (a) {
    var t = window.CATALOG ? CATALOG.findTerm(a.term) : null;
    if (!t) {
      return unknown('「' + (a.term || '') + '」 는 이 서비스의 항목 사전에 없습니다');
    }
    var ev = [['어디에 나오나', screenTitle(t.where) + ' 화면']];
    if (t.field) { ev.push(['데이터 필드', t.field + ' (DB.item() 이 주는 값)']); }
    /* 값이 있는 용어면 지금 값을 같이 보여 준다 · 뜻만 알려 주면 화면과 이어지지 않는다 */
    var live = liveValue(t);
    if (live) { ev.push(['지금 값', live]); }
    return {
      kind: 'about',
      text: '**' + t.key + '** · ' + t.what,
      evidence: ev,
      link: { href: fileOf(t.where), label: screenTitle(t.where) + ' 열기' }
    };
  };

  /* 화면 설명 */
  RUN.explain_screen = function (a) {
    var S = window.CATALOG ? CATALOG.screens() : {};
    var s = pickScreen(S, a.screen);
    if (!s) { return unknown('그 화면을 찾지 못했습니다'); }
    var topic = String(a.topic || '').trim();
    var hit = null;
    if (topic) {
      Object.keys(s.parts || {}).forEach(function (k) {
        if (!hit && (k.indexOf(topic) >= 0 || topic.indexOf(k) >= 0 ||
          s.parts[k].indexOf(topic) >= 0)) { hit = [k, s.parts[k]]; }
      });
    }
    var text = hit
      ? '**' + s.title + ' · ' + hit[0] + '** · ' + hit[1]
      : '**' + s.title + '** · ' + s.what;
    var ev = [];
    if (hit) { ev.push(['이 화면', s.what]); }
    if (s.does && s.does.length) { ev.push(['여기서 할 수 있는 것', s.does.join(' · ')]); }
    if (!hit && s.parts) {
      Object.keys(s.parts).forEach(function (k) { ev.push([k, s.parts[k]]); });
    }
    return { kind: 'about', text: text, evidence: ev,
             link: { href: s.file, label: s.title + ' 열기' } };
  };

  /* 오늘 할 일 · main.html 의 「오늘 할 일」 과 같은 값이다 (ANALYSIS.todo) */
  RUN.today_tasks = function () {
    if (!window.ANALYSIS || !ANALYSIS.todo) {
      return unknown('오늘 할 일을 세는 어댑터가 이 화면에 없습니다');
    }
    var rows = ANALYSIS.todo().filter(function (r) { return (Number(r.n) || 0) > 0; });
    if (!rows.length) {
      return { kind: 'data', text: '지금 손대야 하는 일이 없습니다 · 대기 0품목입니다.',
               evidence: base([['센 방법', 'ANALYSIS.todo() · 대시보드와 같은 셈']]),
               link: { href: 'main.html', label: '대시보드 열기' } };
    }
    var total = rows.reduce(function (a2, r) { return a2 + (Number(r.n) || 0); }, 0);
    var first = rows[0];
    return {
      kind: 'data',
      text: '오늘 대기는 모두 **' + num(total) + '품목** 입니다 · 가장 급한 것은 ' +
        '**' + first.tag + ' · ' + num(first.n) + '품목** (' + first.text + ') 입니다.',
      table: {
        head: ['언제', '품목', '할 일', '가는 곳'],
        rows: rows.map(function (r) {
          return [r.tag, num(r.n) + (r.unit || '품목'), r.text,
                  (r.acts && r.acts[0] ? r.acts[0][0] : '')];
        })
      },
      evidence: base([
        ['센 방법', 'ANALYSIS.todo() · 대시보드 「오늘 할 일」 과 같은 값'],
        ['「지금」 기준', '재고가 목표의 절반에 못 미치는 자재다 (정비 마감이 아니다)'],
        ['「검토」 기준', '점수 차이가 작아 알고리즘이 보류한 건 · 담당자 판단이 첫 라벨이 된다']
      ]),
      link: { href: 'main.html', label: '대시보드에서 보기' }
    };
  };

  /* 출처 */
  RUN.data_source = function (a) {
    var s = window.CATALOG ? CATALOG.findSource(a.topic) : null;
    if (!s) {
      return unknown('「' + (a.topic || '') + '」 의 출처를 사전에서 찾지 못했습니다');
    }
    return {
      kind: 'about',
      text: '**' + s.topic + '** 은 ' + s.layer + ' · `' + s.from + '` 에서 옵니다 · ' + s.what,
      evidence: [['층', s.layer], ['파일', s.from],
                 ['기준일', asof() + ' 스냅샷'],
                 ['원칙', '1층 정본은 읽기 전용 · 2층은 알고리즘 산출 · 3층은 사람이 한 일']],
      link: { href: 'main.html', label: '대시보드 열기' }
    };
  };

  // ================================================================ 도우미

  /* 화면을 키 · 제목 · 파일명 어느 쪽으로 불러도 찾는다.
   * LLM 이 「대시보드」 라고 넘겨도 main 을 찾아야 한다 · 못 찾으면 문서로 새어 나간다 */
  function pickScreen(S, want) {
    var w = String(want || '').trim();
    if (!w) { return null; }
    if (S[w]) { return S[w]; }
    var k = w.replace(/\.html$/i, '');
    if (S[k]) { return S[k]; }
    var hit = null;
    Object.keys(S).forEach(function (key) {
      var s = S[key];
      if (hit) { return; }
      if (s.title === w || s.file === w || s.title.indexOf(w) >= 0 ||
        w.indexOf(s.title) >= 0) { hit = s; }
    });
    return hit;
  }

  /* 문장 안에 화면 이름이 있으면 그 키를 준다 */
  function screenWord(q, S) {
    var hit = null;
    Object.keys(S).forEach(function (key) {
      if (!hit && String(q).indexOf(S[key].title) >= 0) { hit = key; }
    });
    if (!hit && /대시보드|첫 화면|홈/.test(q)) { hit = 'main'; }
    return hit;
  }

  function esc(s) { return window.UI ? UI.esc(s) : String(s); }
  function unknown(why) { return { kind: 'data', unknown: true, text: why, evidence: [] }; }

  function fileOf(where) {
    var S = window.CATALOG ? CATALOG.screens() : {};
    return (S[where] && S[where].file) || 'main.html';
  }
  function screenTitle(where) {
    var S = window.CATALOG ? CATALOG.screens() : {};
    return (S[where] && S[where].title) || '대시보드';
  }

  /* 용어가 가리키는 지금 값 · 사전에 숫자를 적어 두지 않고 여기서 읽는다 */
  function liveValue(t) {
    if (!DBok()) { return null; }
    var s = DB.summary();
    var c = SCREEN.attrCounts();
    var M = {
      '보험품': num(s.type['보험품']) + '품목',
      '계획품': num(s.type['계획품']) + '품목',
      '회색지대': num(c.gray) + '품목 보류',
      '제외대상': num(c.excluded) + '품목',
      '판단': num(c.done) + '품목',
      '확정': num(DB.commitInfo().done) + '품목',
      '확정 대기': num(c.waiting) + '품목',
      'stale': num(s.staleN) + '품목',
      '조치': '발주 ' + num(s.action['발주']) + ' · 유지 ' + num(s.action['유지']) +
        ' · 감축 ' + num(s.action['감축']),
      '핵심예비품': num(DB.list().filter(function (r) { return r.csp; }).length) + '품목',
      '금융비용 절감': won(s.finance),
      '묶인 금액': '정체 ' + num(s.poolItems) + '품목 · 회수 가능 ' + won(s.poolAmt),
      '기준일': asof()
    };
    return M[t.key] || null;
  }

  // ================================================================ 빠른 길
  /* LLM 을 부르지 않고 바로 답할 수 있는 질문 · 자주 묻는 것과 자재코드다.
   * 라우터를 거치면 1초쯤 걸리는데, 이 질문들은 즉시 답하는 것이 낫다 */
  function fast(q) {
    var s = String(q || '').trim();
    var code = s.match(/\b(Q[0-9]{7})\b/i);
    if (code) { return { tool: 'material_detail', input: { code: code[1].toUpperCase() } }; }
    var has = function (a) { return a.every(function (w) { return s.indexOf(w) >= 0; }); };

    // 순위를 묻는 문장은 합계가 아니라 표로 답한다 (「감축 금액 큰 자재 5개」)
    var rank = /상위|top|순위|랭킹|리스트|목록|큰\s*(자재|품목|것)|많은\s*(자재|품목|것)|비싼|어떤\s*자재|무슨\s*자재/i.test(s);
    if (rank) {
      var by = /정체|묶인|묵힌/.test(s) ? 'stale'
        : (/부족|모자/.test(s) ? 'need'
          : (/단가|비싼|고가/.test(s) ? 'price'
            : (/보유|재고 금액/.test(s) ? 'stock'
              : (/감축|초과|줄일/.test(s) ? 'cut' : ''))));
      var n = s.match(/([0-9]{1,2})\s*(개|건|품목|가지)/);
      if (by) {
        return { tool: 'top_materials',
                 input: { by: by, limit: n ? Number(n[1]) : 5 } };
      }
    }

    if (has(['발주']) && /몇|건|품목|개/.test(s)) { return { tool: 'count_action', input: { action: '발주' } }; }
    if (has(['감축']) && /금액|얼마/.test(s)) { return { tool: 'money_summary', input: { kind: 'cut' } }; }
    if (has(['감축']) && /몇|건|품목|개/.test(s)) { return { tool: 'count_action', input: { action: '감축' } }; }
    if (/금융비용|절감액/.test(s)) { return { tool: 'money_summary', input: { kind: 'finance' } }; }
    if (/회색지대|확정 대기|판단 현황/.test(s)) { return { tool: 'attr_status', input: {} }; }
    if (/공용|정체/.test(s) && /얼마|회수|몇/.test(s)) { return { tool: 'pool_status', input: {} }; }
    if (/반납/.test(s) && /몇|건수|현황/.test(s)) { return { tool: 'return_status', input: {} }; }
    if (/기준일/.test(s)) { return { tool: 'data_source', input: { topic: '기준일' } }; }
    if (/오늘 할 일|할 일|해야 (할|하는)|뭐부터|먼저 뭐/.test(s)) {
      return { tool: 'today_tasks', input: {} };
    }
    // 화면을 설명해 달라는 문장은 문서로 보내지 않는다 (사내 문서에 우리 화면은 없다)
    if (/설명|뭐(가|를) (보여|나와)|어떤 (화면|데이터|값)|무슨 화면|뭐 하는 (화면|탭)/.test(s)) {
      var sc = window.CATALOG ? screenWord(s, CATALOG.screens()) : null;
      if (sc) { return { tool: 'explain_screen', input: { screen: sc } }; }
    }
    return null;
  }

  /* 도구 실행 · 없는 도구거나 데이터가 없으면 unknown */
  function run(tool, input) {
    if (!RUN[tool]) { return null; }
    if (!DBok()) { return unknown('데이터층이 아직 준비되지 않았습니다'); }
    try {
      return RUN[tool](input || {});
    } catch (e) {
      return unknown('값을 읽는 중 문제가 생겼습니다 · ' + (e && e.message ? e.message : e));
    }
  }

  function tools() { return Object.keys(RUN); }

  return { run: run, fast: fast, tools: tools };
})();
