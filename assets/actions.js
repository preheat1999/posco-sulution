/* actions.js · Action Registry · 자연어(음성 · 글)가 이 앱을 움직이는 유일한 통로
 *
 * 챗봇의 라우터(serve.py /llm/route)는 「어느 action 을 어떤 값으로」 만 고른다.
 * 실행은 여기 등록된 것만 한다 · LLM 이 만든 URL · API 주소 · JS 코드는 어디서도 실행되지 않는다.
 *
 * 세 갈래 ·
 *   navigate  화면 이동 · 바로 실행
 *   query     조회 · 바로 실행 (읽기만 한다)
 *   mutation  DB 를 바꾸는 것 (구매신청 · 반납 · 판단 · 확정 · 공용 전환) · 실행 전 확인 창
 *
 * 규칙 ·
 *   - 화면은 SCREENS 표의 키로만 간다 · 파일명은 여기서 만든다 (입력값이 주소가 되지 않는다).
 *   - 자재코드는 Q + 숫자 7자리만 받는다 · 수량은 1 ~ 999 정수만 받는다.
 *   - 화면을 바꾸는 action 은 실제 화면(attr.html 등)이 이미 쓰는 같은 어댑터 호출을 쓴다 ·
 *     여기서 새 셈이나 새 저장 경로를 만들지 않는다 (두 길이 어긋나면 화면과 챗봇이 다른 말을 한다).
 *   - 어느 화면에서만 뜻이 있는 action 은 needs 로 적는다 · 다른 화면이면 챗봇이 먼저 그 화면으로 간다.
 *
 * 결과 모양 ·
 *   { kind:'navigate'|'query'|'mutation', text, table?, evidence?, link?, href?, unknown? }
 *   href 가 있으면 챗봇이 그 주소로 옮긴다 (남은 단계는 새 화면에서 이어 한다).
 */
window.ACTIONS = (function () {
  'use strict';

  /* 갈 수 있는 화면 · 칸. 여기 없는 것은 못 간다 */
  var SCREENS = {
    main: { file: 'main.html', title: '대시보드', sections: {} },
    attr: { file: 'attr.html', title: '속성값 판단',
            sections: { all: '전체', i2p: '보험품→계획품', p2i: '계획품→보험품', gray: '회색지대', done: '판단 완료' } },
    stock: { file: 'stock.html', title: '적정재고 분석',
             sections: { order: '발주 필요', cut: '감축 대상', keep: '적정 유지', all: '전체' } },
    plan: { file: 'plan.html', title: '적정구매시점', sections: {} },
    pool: { file: 'pool.html', title: '공용 전환', sections: {} },
    purchase: { file: 'purchase.html', title: '구매신청 (PR)', sections: {} },
    'return': { file: 'return.html', title: '자재반납 (QR)', sections: {} }
  };
  /* 말로 부르는 이름 → 키. LLM 이 제목으로 넘겨도 찾는다 */
  var ALIAS = {
    '대시보드': 'main', '홈': 'main', '메인': 'main', 'dashboard': 'main',
    '속성': 'attr', '속성값': 'attr', '속성값 판단': 'attr', '속성 판단': 'attr',
    '적정재고': 'stock', '재고': 'stock', '적정재고 분석': 'stock', '재고 분석': 'stock',
    '적정구매시점': 'plan', '구매시점': 'plan', '정비계획': 'plan', '정비': 'plan',
    '공용': 'pool', '공용 전환': 'pool', '공용화': 'pool',
    '구매신청': 'purchase', '구매': 'purchase', 'pr': 'purchase',
    '반납': 'return', '자재반납': 'return', 'qr': 'return'
  };

  var R = {};

  // ================================================================ 값 검사
  function code(v) {
    var m = String(v || '').toUpperCase().match(/Q[0-9]{7}/);
    return m ? m[0] : null;
  }
  function qty(v, dflt) {
    var n = Math.round(Number(v));
    if (!isFinite(n) || n < 1) { return dflt || null; }
    return Math.min(999, n);
  }
  function screenKey(v) {
    var s = String(v || '').trim().replace(/\.html$/i, '');
    if (SCREENS[s]) { return s; }
    var low = s.toLowerCase();
    if (ALIAS[low]) { return ALIAS[low]; }
    var hit = null;
    Object.keys(ALIAS).forEach(function (a) { if (!hit && low.indexOf(a) >= 0) { hit = ALIAS[a]; } });
    if (!hit) {
      Object.keys(SCREENS).forEach(function (k) {
        if (!hit && (SCREENS[k].title === s || s.indexOf(SCREENS[k].title) >= 0)) { hit = k; }
      });
    }
    return hit;
  }
  function sectionKey(sk, v) {
    var secs = SCREENS[sk] ? SCREENS[sk].sections : {};
    var s = String(v || '').trim();
    if (!s) { return ''; }
    if (secs[s]) { return s; }
    var hit = '';
    Object.keys(secs).forEach(function (k) {
      if (!hit && (secs[k] === s || s.indexOf(secs[k]) >= 0 || secs[k].indexOf(s) >= 0)) { hit = k; }
    });
    /* 자주 쓰는 다른 말 */
    if (!hit && sk === 'stock') {
      if (/발주|부족|주문/.test(s)) { hit = 'order'; }
      else if (/감축|초과|줄/.test(s)) { hit = 'cut'; }
      else if (/유지/.test(s)) { hit = 'keep'; }        // 「적정」 은 화면 이름(적정재고)에도 있어 칸 근거가 못 된다
    }
    if (!hit && sk === 'attr') {
      if (/회색|보류|대기/.test(s)) { hit = 'gray'; }
      else if (/완료|판단한/.test(s)) { hit = 'done'; }
    }
    return hit;
  }
  function href(sk, section, extra) {
    var f = SCREENS[sk].file;
    var h = section ? section : '';
    if (extra) { h = (h ? h + '&' : '') + extra; }
    return h ? f + '#' + h : f;
  }
  function unknown(text) { return { unknown: true, text: text }; }
  function num(v) { return window.UI ? UI.num(v) : String(v); }
  function won(v) { return window.UI ? UI.won(v) : String(v); }
  function asof() { return window.DB ? DB.meta().asof : ''; }
  function item(c) { return window.DB && c ? DB.item(c) : null; }
  function page() { return window.PAGE || ''; }

  /* 「이 자재」 · 입력에 코드가 없으면 화면 문맥의 자재를 쓴다 */
  function pickCode(a, ctx) {
    return code(a && a.code) || code(ctx && ctx.selectedCode) || null;
  }

  // ================================================================ navigate
  R.navigate = {
    kind: 'navigate', label: '화면 이동',
    run: function (a) {
      var sk = screenKey(a.screen);
      if (!sk) { return unknown('갈 수 있는 화면이 아닙니다 · ' + Object.keys(SCREENS).map(function (k) { return SCREENS[k].title; }).join(' · ')); }
      var sec = sectionKey(sk, a.section);
      var sc = SCREENS[sk];
      /* 결과 칸으로 바로 가면 분석 전 화면이 아니라 결과를 본다 (stock.html 규칙과 같다) */
      return {
        kind: 'navigate',
        text: '**' + sc.title + (sec ? ' · ' + sc.sections[sec] : '') + '** 화면으로 갑니다.',
        href: href(sk, sec), screen: sk
      };
    }
  };

  // ================================================================ 자재 찾기 · 열기
  R.searchMaterial = {
    kind: 'query', label: '자재 검색',
    run: function (a, ctx) {
      var t = String(a.text || a.code || '').trim();
      if (!t) { return unknown('무엇을 찾을지 (자재코드나 품명) 말해 주세요'); }
      if (!window.DB) { return unknown('데이터층이 아직 준비되지 않았습니다'); }
      var c = code(t);
      var rows = c ? [item(c)].filter(Boolean) : DB.find(t, 8);
      if (!rows.length) {
        return unknown('「' + t + '」 에 맞는 자재가 우리 부서 743품목에 없습니다' +
          (c ? ' · 코드가 맞는지 확인해 주세요' : ' · 코드 앞 몇 자리나 품명 일부로 찾아 보세요'));
      }
      if (ctx) { ctx.selectedCode = rows[0].q; }
      return {
        kind: 'query',
        text: rows.length === 1
          ? '**' + rows[0].name + ' · ' + rows[0].q + '** 를 찾았습니다 · ' + rows[0].type + ' ' +
            (rows[0].grade || '') + '등급 · 보유 ' + num(rows[0].stock) + ' → 목표 ' + num(rows[0].targetNow) +
            ' · ' + rows[0].actionNow
          : '「' + t + '」 로 **' + num(rows.length) + '건** 찾았습니다 · 첫 건을 「이 자재」 로 둡니다.',
        table: rows.length === 1 ? null : {
          head: ['자재', '속성 · 등급', '보유 → 목표', '조치'],
          rows: rows.map(function (r) {
            return [(r.name || '품명 미확인') + ' · ' + r.q, (r.type || '') + ' ' + (r.grade || ''),
                    num(r.stock) + ' → ' + num(r.targetNow), r.actionNow || ''];
          })
        },
        evidence: [['찾은 곳', 'DB.find() · 코드 · 품명 부분 일치'], ['기준일', asof() + ' 스냅샷']],
        link: { href: 'stock.html#q=' + encodeURIComponent(rows[0].q), label: '적정재고 화면에서 보기' },
        selectedCode: rows[0].q
      };
    }
  };

  R.openMaterialDetail = {
    kind: 'navigate', label: '자재 상세 열기',
    run: function (a, ctx) {
      var c = pickCode(a, ctx);
      if (!c) { return unknown('어느 자재인지 코드를 말해 주세요 (예 · Q1000108)'); }
      var r = item(c);
      if (!r) { return unknown(c + ' 는 우리 부서 743품목에 없습니다'); }
      if (ctx) { ctx.selectedCode = c; }
      return { kind: 'navigate', text: '**' + r.name + ' · ' + c + '** 를 적정재고 화면에서 보여 드립니다.',
               href: 'stock.html#q=' + encodeURIComponent(c), screen: 'stock' };
    }
  };

  R.getInventoryStatus = {
    kind: 'query', label: '재고 상태',
    run: function (a, ctx) {
      var c = pickCode(a, ctx);
      if (!c) { return unknown('어느 자재의 재고인지 코드를 말해 주세요'); }
      if (!window.ASK) { return unknown('조회 도구가 이 화면에 없습니다'); }
      var out = ASK.run('material_detail', { code: c });
      if (out && !out.unknown) { out.kind = 'query'; if (ctx) { ctx.selectedCode = c; } }
      return out;
    }
  };

  // ================================================================ 구매신청
  R.openPurchaseRequest = {
    kind: 'navigate', label: '구매신청 화면 열기',
    run: function (a, ctx) {
      var c = pickCode(a, ctx);
      if (!c) { return { kind: 'navigate', text: '**구매신청** 화면으로 갑니다.', href: 'purchase.html', screen: 'purchase' }; }
      var r = item(c);
      if (!r) { return unknown(c + ' 는 우리 부서 자재가 아니라 구매신청 초안을 만들 수 없습니다'); }
      if (ctx) { ctx.selectedCode = c; }
      return { kind: 'navigate',
               text: '**' + r.name + ' · ' + c + '** 의 구매신청 초안 화면을 엽니다.',
               href: 'purchase.html#q=' + encodeURIComponent(c), screen: 'purchase' };
    }
  };

  /* 이 앱의 「구매신청」 은 PR 초안 저장까지다 (발행은 사내 시스템 연동 전) ·
   * purchase.html 의 「저장」 버튼과 같은 DB.draft 호출이다 */
  R.submitPurchaseRequest = {
    kind: 'mutation', label: '구매신청 초안 저장',
    confirm: function (a, ctx) {
      var c = pickCode(a, ctx); var r = item(c);
      if (!r) { return null; }
      var n = qty(a.qty, r.needNow > 0 ? r.needNow : 1);
      return { title: '구매신청 초안을 저장할까요?',
               rows: [['자재', r.name + ' · ' + c], ['수량', num(n) + ' ' + (r.unit || '')],
                      ['금액', won(n * (r.price || 0))], ['다음', 'PR 발행 · 사내 시스템 연동 예정']],
               note: '초안만 저장됩니다 · 구매신청 화면에서 다시 볼 수 있습니다', ok: '저장' };
    },
    run: function (a, ctx) {
      var c = pickCode(a, ctx);
      if (!c) { return unknown('어느 자재를 신청할지 코드를 말해 주세요'); }
      var r = item(c);
      if (!r) { return unknown(c + ' 는 우리 부서 자재가 아닙니다'); }
      var n = qty(a.qty, r.needNow > 0 ? r.needNow : 1);
      DB.draft('PR', { q: c, data: { qty: n, unit: r.unit, why: '음성 · 채팅 명령으로 저장' } });
      if (ctx) { ctx.selectedCode = c; }
      return { kind: 'mutation',
               text: '**' + r.name + ' · ' + c + '** 구매신청 초안 **' + num(n) + ' ' + (r.unit || '') +
                 '** 을 저장했습니다 · ' + won(n * (r.price || 0)) + '.',
               evidence: [['저장 위치', '3층 pr_drafts (DB.draft) · 구매신청 화면의 「저장」 과 같은 길'],
                          ['다음', 'PR 발행은 사내 시스템 연동 전 · 초안까지가 이 앱의 몫']],
               link: { href: 'purchase.html#q=' + encodeURIComponent(c), label: '구매신청 화면에서 보기' } };
    }
  };

  // ================================================================ 반납
  R.openReturnPage = {
    kind: 'navigate', label: '반납 화면 열기',
    run: function (a, ctx) {
      var c = pickCode(a, ctx);
      if (!c) { return { kind: 'navigate', text: '**자재반납** 화면으로 갑니다.', href: 'return.html', screen: 'return' }; }
      var r = item(c);
      var known = !!r || !!(window.QRDB && QRDB.get && QRDB.get(c));
      if (!known) { return unknown(c + ' 는 등록된 자재가 아니라 반납 화면을 열 수 없습니다'); }
      if (ctx) { ctx.selectedCode = c; }
      return { kind: 'navigate', text: '**' + (r ? r.name + ' · ' : '') + c + '** 반납 화면을 엽니다.',
               href: 'mobile-return.html#' + encodeURIComponent(c), screen: 'return' };
    }
  };

  /* mobile-return.html 의 「반납」 버튼과 같은 DB.qrReturn 호출 · 상태(cond)는 반납 뒤 사람이 정한다 */
  R.returnMaterial = {
    kind: 'mutation', label: '자재 반납',
    confirm: function (a, ctx) {
      var c = pickCode(a, ctx); var r = item(c);
      if (!c) { return null; }
      var n = qty(a.qty, 1);
      return { title: '반납을 접수할까요?',
               rows: [['자재', (r ? r.name + ' · ' : '') + c], ['수량', num(n) + ' ' + (r ? r.unit || '' : '')],
                      ['회수 금액', r ? won(n * (r.price || 0)) : '정본 밖 자재 · 접수만 기록'],
                      ['물품 상태', '반납 뒤 검사에서 정합니다']],
               ok: '반납 접수' };
    },
    run: function (a, ctx) {
      var c = pickCode(a, ctx);
      if (!c) { return unknown('어느 자재를 반납할지 코드를 말해 주세요'); }
      var r = item(c);
      var n = qty(a.qty, 1);
      var who = (ctx && ctx.who) || '담당자 (음성 명령)';
      DB.qrReturn({ code: c, qty: n, unit: r ? r.unit : '', cond: '', by: who,
                    note: '음성 · 채팅 명령 반납 · 상태 미정' });
      if (ctx) { ctx.selectedCode = c; }
      return { kind: 'mutation',
               text: '**' + (r ? r.name + ' · ' : '') + c + '** 반납 **' + num(n) + (r ? ' ' + (r.unit || '') : '') +
                 '** 을 접수했습니다' + (r ? ' · 회수 ' + won(n * (r.price || 0)) : ' · 정본 밖 자재라 접수만 기록') + '.',
               evidence: [['저장 위치', '3층 qr_returns (DB.qrReturn) · 반납 화면의 「반납」 과 같은 길'],
                          ['물품 상태', '반납 뒤 검사에서 사람이 정한다 · 지금은 「상태 미정」']],
               link: { href: 'return.html', label: '반납 목록에서 보기' } };
    }
  };

  // ================================================================ 속성값 판단
  R.runAttrAlgorithm = {
    kind: 'query', label: '속성 알고리즘 실행', needs: 'attr',
    run: function () {
      if (!window.SCREEN) { return unknown('어댑터가 이 화면에 없습니다'); }
      if (SCREEN.stage() === 'raw') { SCREEN.setStage('algo'); SCREEN.setStamp(SCREEN.nowStamp()); }
      var c = SCREEN.attrCounts ? SCREEN.attrCounts() : {};
      return { kind: 'query',
               text: '알고리즘 판정을 올렸습니다 · 손대야 하는 자재 **' + num(c.all || 0) + '품목** (회색지대 ' + num(c.gray || 0) + ').',
               href: 'attr.html#all', screen: 'attr', reload: true,
               evidence: [['한 일', 'SCREEN.setStage(\'algo\') · 속성값 판단 화면의 「알고리즘 실행」 과 같다']] };
    }
  };

  R.judgeMaterial = {
    kind: 'mutation', label: '속성 판단',
    confirm: function (a, ctx) {
      var c = pickCode(a, ctx); var r = item(c);
      if (!r) { return null; }
      var t = judgeType(a.type, r);
      return { title: '이 자재의 속성을 판단할까요?',
               rows: [['자재', r.name + ' · ' + c], ['지금 속성', r.type], ['판단', t || '(모름)'],
                      ['반영', '「담당자 확정」 을 눌러야 다른 화면에 적용됩니다']], ok: '판단' };
    },
    run: function (a, ctx) {
      var c = pickCode(a, ctx);
      if (!c) { return unknown('어느 자재를 판단할지 코드를 말해 주세요'); }
      var r = item(c);
      if (!r) { return unknown(c + ' 는 우리 부서 자재가 아닙니다'); }
      var t = judgeType(a.type, r);
      if (!t) { return unknown('보험품 · 계획품 · 현행유지 중 무엇으로 판단할지 말해 주세요'); }
      if (r.judged) { DB.revertAttr({ q: c, dept: r.dept }); }
      DB.approveAttr({ q: c, dept: r.dept, newType: t,
                       reason: t === r.baseType ? '담당자 확인 · 현행유지 (음성 명령)' : '담당자 판단 · 음성 명령' });
      if (ctx) { ctx.selectedCode = c; }
      return { kind: 'mutation',
               text: '**' + r.name + ' · ' + c + '** 를 **' + t + '** 으로 판단했습니다 · 「담당자 확정」 전까지는 대기입니다.',
               evidence: [['저장 위치', '3층 attribute_overrides (DB.approveAttr) · 속성값 판단 화면의 버튼과 같은 길']],
               link: { href: 'attr.html#done', label: '속성값 판단에서 보기' } };
    }
  };
  function judgeType(v, r) {
    var s = String(v || '');
    if (/보험/.test(s)) { return '보험품'; }
    if (/계획/.test(s)) { return '계획품'; }
    if (/유지|keep|그대로/.test(s)) { return r.baseType; }
    return null;
  }

  R.commitAttr = {
    kind: 'mutation', label: '담당자 확정',
    confirm: function () {
      var s = window.DB ? DB.summary() : {};
      return { title: '판단한 속성을 확정할까요?',
               rows: [['확정 대기', num(s.waitingN || 0) + '품목'], ['효과', '적정재고 · 공용 전환 · 구매시점이 이 속성으로 다시 계산됩니다']],
               ok: '확정' };
    },
    run: function () {
      if (!window.DB) { return unknown('데이터층이 없습니다'); }
      var info = DB.commitAttr();
      return { kind: 'mutation',
               text: '담당자 확정을 적었습니다 · 이제 다른 화면이 확정 속성으로 계산합니다' +
                 (info && info.n !== undefined ? ' (' + num(info.n) + '건)' : '') + '.',
               evidence: [['한 일', 'DB.commitAttr() · 속성값 판단 화면의 「담당자 확정」 과 같다']],
               link: { href: 'stock.html', label: '적정재고 분석 열기' } };
    }
  };

  // ================================================================ 적정재고 · 공용 전환
  R.runStockAnalysis = {
    kind: 'query', label: '적정재고 분석 실행',
    run: function () {
      if (!window.SCREEN) { return unknown('어댑터가 이 화면에 없습니다'); }
      if (SCREEN.stockStage() !== 'done') { SCREEN.setStockStage('done'); SCREEN.setStockStamp(SCREEN.nowStamp()); }
      var c = SCREEN.stockCounts ? SCREEN.stockCounts() : {};
      return { kind: 'query',
               text: '적정재고 분석 결과를 올렸습니다 · 발주 **' + num(c.order || 0) + '** · 감축 **' + num(c.cut || 0) + '** · 유지 **' + num(c.keep || 0) + '품목**.',
               href: 'stock.html#order', screen: 'stock', reload: true,
               evidence: [['한 일', 'SCREEN.setStockStage(\'done\') · 적정재고 화면의 「분석」 버튼과 같다']] };
    }
  };

  R.convertToPool = {
    kind: 'mutation', label: '공용 전환',
    confirm: function (a, ctx) {
      var c = pickCode(a, ctx); var r = item(c);
      if (!r) { return null; }
      return { title: '공용 전환으로 돌릴까요?',
               rows: [['자재', r.name + ' · ' + c], ['보유', num(r.stock) + ' ' + (r.unit || '')], ['기록', '공용 전환 1건 · 재고 거래 1건']],
               ok: '공용 전환' };
    },
    run: function (a, ctx) {
      var c = pickCode(a, ctx);
      if (!c) { return unknown('어느 자재를 공용 전환할지 코드를 말해 주세요'); }
      var r = item(c);
      if (!r) { return unknown(c + ' 는 우리 부서 자재가 아닙니다'); }
      DB.pool({ q: c, dept: r.dept, action: '공용전환', note: '음성 · 채팅 명령' });
      DB.txn({ q: c, dept: r.dept, txnType: '공용전환', qty: 1, note: '공용 전환 (음성 명령)' });
      if (ctx) { ctx.selectedCode = c; }
      return { kind: 'mutation',
               text: '**' + r.name + ' · ' + c + '** 를 공용 전환으로 기록했습니다.',
               evidence: [['저장 위치', '3층 pool_actions + stock_transactions · 공용 전환 화면의 버튼과 같은 길']],
               link: { href: 'pool.html', label: '공용 전환 화면에서 보기' } };
    }
  };

  // ================================================================ 실행
  /* 등록된 action 만 · 없는 이름은 null. 값 검사는 각 action 안에서 한다 */
  function run(name, input, ctx) {
    var a = R[name];
    if (!a) { return null; }
    try { return a.run(input || {}, ctx || {}); }
    catch (e) { return unknown('실행하지 못했습니다 · ' + (e && e.message ? e.message : e)); }
  }
  function confirmSpec(name, input, ctx) {
    var a = R[name];
    if (!a || a.kind !== 'mutation') { return null; }
    try { return a.confirm ? a.confirm(input || {}, ctx || {}) : { title: a.label + ' 을 진행할까요?' }; }
    catch (e) { return null; }
  }
  function kindOf(name) { return R[name] ? R[name].kind : null; }
  function needs(name) { return R[name] ? (R[name].needs || null) : null; }
  function names() { return Object.keys(R); }

  return { run: run, confirmSpec: confirmSpec, kindOf: kindOf, needs: needs, names: names,
           screens: SCREENS, screenKey: screenKey, sectionKey: sectionKey, code: code, qty: qty };
})();
