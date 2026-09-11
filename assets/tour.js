/* tour.js · 튜토리얼 · 세 단계 퀘스트
 *
 * 로그인한 뒤 대시보드에 들어오면 바로 뜬다 (login.html 이 mtrl.tour.pending 을 적어 둔다).
 *
 *   시작   대시보드 · 세 칸이 무엇인지
 *   1단계  분석 · 보유목적 판단 → 적정재고 분석   (정량 효과 → 퀘스트 달성)
 *   2단계  업무 · 적정구매시점 → 구매신청 → 자재반납 (정성 효과 → 퀘스트 달성)
 *   3단계  질의 · AI 자재 질의 (RAG + 음성)        (전체 달성)
 *
 * 왜 명암인가 · 글로만 「오른쪽 위 카드를 보세요」 라고 적으면 눈이 그 카드를 못 찾는다.
 * 어두운 판에 구멍을 하나 내면 찾을 것이 하나뿐이라 읽기 전에 이미 보인다.
 *
 * 왜 창을 한 번만 만드나 · 걸음마다 innerHTML 을 새로 넣으면 구멍(.tspot)이 새 요소가 되어
 * **움직이는 느낌이 사라진다.** 그래서 판 · 구멍 · 카드는 한 번만 만들고
 * 걸음마다 style 과 카드 속만 바꾼다 → 구멍이 이전 자리에서 다음 자리로 미끄러진다.
 *
 * 튜토리얼은 화면을 실제로 움직인다 · 알고리즘 실행 · 적정재고 분석 · PR 초안 1건 ·
 * 공용 전환 1건은 **각 화면의 버튼과 같은 길**로 실행한다 (3층에만 쌓이고 시연 초기화로 지워진다).
 *
 * 주소에 ?notour=1 을 주면 뜨지 않는다.
 * **캡처와 렌더 검사에 반드시 필요하다.** 안 그러면 안내가 화면을 덮어
 * 스크린샷이 전부 안내창이 되고, 검사기는 표가 비었다고 잡는다.
 *
 * 폰 화면(mobile-return · material-view)에는 이 파일을 싣지 않는다 ·
 * 현장에서 QR 을 찍었는데 안내창이 앞을 막으면 안 된다.
 */
(function () {
  'use strict';

  var SEEN = 'mtrl.tour.seen.v1';
  var AT = 'mtrl.tour.v3';           // 걸음 번호를 적어 둔다 (화면을 옮겨도 이어진다)
  var PEND = 'mtrl.tour.pending';    // 로그인이 적어 둔다 · 대시보드에서 한 번 뜨고 지운다

  var STAGES = [
    { k: '시작', n: '대시보드' },
    { k: '1단계', n: '분석' },
    { k: '2단계', n: '업무' },
    { k: '3단계', n: '질의' }
  ];

  /* 한 걸음 ·
   *   st    단계 (0 시작 · 1 · 2 · 3)
   *   page  이 걸음을 보여 줄 화면
   *   sel   밝게 남길 곳 (쉼표로 여럿 · 보이는 첫 칸을 고른다 · 없으면 가운데 카드)
   *   kind  spot(기본) · intro(문제 제기 · 큰 카드) · effect(암전 + 숫자) · quest(달성)
   *   act   이 걸음을 그리기 전에 화면에서 할 일 (아래 ACTS)
   *
   * 숫자는 여기 적지 않는다 · effect 걸음이 그때 어댑터에서 읽는다.
   * 적어 두면 데이터가 바뀔 때 이 파일만 옛말이 된다 */
  var SCRIPT = [
    // ────────────────────────────────── 시작 · 대시보드
    { st: 0, page: 'main', kind: 'intro',
      t: '자재를 스스로 자제하는 AI 솔루션',
      b: '지금부터 <b>세 단계 퀘스트</b>로 안내합니다. ' +
         '1단계 분석 · 2단계 업무 연결 · 3단계 AI 질의 · 한 단계를 끝낼 때마다 성과를 보여 드립니다.',
      hint: '먼저 대시보드의 세 칸이 무엇인지부터 봅니다.' },

    { st: 0, page: 'main', sel: '#d-attr',
      t: '보유목적 분류',
      b: '담당 자재의 <b>보유목적 분류 현황</b>입니다. 그중 <b>변경을 제안한 값</b>을 ' +
         '따로 세어 보여 줍니다 · 사람이 볼 몫이 몇 품목인지 여기서 먼저 잡습니다.' },

    { st: 0, page: 'main', sel: '#d-stock',
      t: '적정재고 분석',
      b: '분류한 <b>보유목적에 맞추어</b> 적정재고를 산출합니다 · ' +
         '<b>구매가 필요한 자재</b>와 <b>공용화를 통해 감축 가능한 금액</b>을 한눈에 볼 수 있습니다.' },

    { st: 0, page: 'main', sel: '#d-due',
      t: '적정구매시점',
      b: '<b>정비계획</b>과 <b>조달 리드타임</b>을 분석하고 · ' +
         '<b>언제까지 구매신청</b>해야 하는지도 알려 줍니다.' },

    // ────────────────────────────────── 1단계 · 분석
    { st: 1, page: 'attr', kind: 'intro',
      t: '1단계 · 「감」과 「관행」을 걷어냅니다',
      b: '지금 적정재고량은 <b>담당자의 감</b>과 <b>관행</b>으로 정해집니다. ' +
         '기준이 사람마다 다르고, 왜 그 수량인지 설명하기 어렵습니다.<br>' +
         '그래서 <b>보유목적부터 다시 판단</b>하고, 그 판단으로 <b>적정재고를 계산</b>합니다.',
      hint: '이번 단계에서 두 화면을 지나갑니다 · 보유목적 판단 → 적정재고 분석' },

    { st: 1, page: 'attr', sel: '#runhero .rh-left h2, #runhero',
      t: '지금까지는 사람이 나눴습니다',
      b: '들어오면 <b>정본에 적힌 속성 그대로</b>입니다 · 보험품인지 계획품인지 ' +
         '사람이 판단해 적어 온 값입니다. 아직 아무 알고리즘도 닿지 않았습니다.' },

    { st: 1, page: 'attr', sel: '#runhero .rh-right h2, #run',
      t: '판단을 도와드릴까요?',
      b: '7가지 요인을 가중합해 <b>보험품 점수</b>와 <b>계획품 점수</b>를 매깁니다.<br>' +
         '<b>다음</b>을 누르면 알고리즘이 돌아갑니다.' },

    { st: 1, page: 'attr', act: 'runAlgo', sel: '#tabs, #list',
      t: '자재마다 추천이 붙었습니다',
      b: '칸을 눌러 <b>보험품 → 계획품</b> · <b>계획품 → 보험품</b> · <b>회색지대</b>로 갈라 봅니다 · ' +
         '점수 차이가 작으면 알고리즘이 정하지 않고 <b>사람에게 넘깁니다</b>.' },

    { st: 1, page: 'attr', act: 'pickRow', sel: '#panel',
      t: '근거를 보고 담당자가 정합니다',
      b: '자재를 누르면 <b>판정 근거</b>가 열립니다 · 점수를 만든 값과 최근 24개월 불출량까지 ' +
         '보고 나서 <b>추천대로</b> 보험품 · 계획품으로 나눌 수 있습니다.' },

    { st: 1, page: 'stock', sel: '#anahero .rh-right h2, #ana, #stat',
      t: '적정재고도 AI의 도움을 받아볼까요?',
      b: '확정한 보유목적으로 <b>목표재고</b>를 잡고, 보유와 견줘 <b>조치</b>를 판정합니다.<br>' +
         '<b>다음</b>을 누르면 분석이 돌아갑니다.' },

    { st: 1, page: 'stock', act: 'runStock', sel: '#heat',
      t: '금액이 큰 예비품부터 봅니다',
      b: '한 칸이 한 품목이고 <b>넓이가 과부족 금액</b>입니다 · 부족은 파랑 · 초과는 빨강.<br>' +
         '돈이 크게 묶인 예비품 현황을 미리 살펴볼 수 있습니다.' },

    { st: 1, page: 'stock', act: 'tabOrder', sel: '#stable, #steps',
      t: '설비가 멈춰도 빨리 복구하려면',
      b: '<b>발주 필요</b> 칸입니다 · 지금 사 두어야 정비 일정에 맞출 수 있는 자재입니다.<br>' +
         '<b>다음</b>을 누르면 한 건을 <b>PR 초안</b>으로 만들어 둡니다.' },

    { st: 1, page: 'stock', act: 'makeDraft', sel: '#stable, #steps',
      t: '이번엔 전사 재고를 줄여볼까요?',
      b: '<b>감축 대상</b>은 목표를 넘는 몫입니다 · 남는 수량을 <b>공용 전환</b>하면 ' +
         '다른 부서가 쓰고 우리 장부에서는 내려갑니다.<br>' +
         '<b>다음</b>을 누르면 한 건을 전환합니다.' },

    { st: 1, page: 'stock', act: 'poolOnce', kind: 'effect',
      t: '1단계 성과',
      b: '방금 <b>발주 초안 1건</b>과 <b>공용 전환 1건</b>을 처리했습니다 · ' +
         '같은 방식으로 <b>남아 있는 기회</b>는 이만큼입니다.',
      nums: 'stage1' },

    { st: 1, page: 'stock', kind: 'quest',
      t: '1단계 · 분석 완료',
      b: '「감」으로 정해 온 수량에 <b>근거</b>가 붙었습니다 · 이제 그 판단을 <b>업무로 잇습니다</b>.' },

    // ────────────────────────────────── 2단계 · 업무 연결
    { st: 2, page: 'plan', kind: 'intro',
      t: '2단계 · 흩어진 시스템을 한 줄로',
      b: '자재 하나를 사려면 <b>정비계획 · 재고 · 구매 · 반납</b>이 각각 다른 시스템에 있고 ' +
         '쓰는 방법도 다릅니다. 그래서 담당자가 화면을 옮겨 다니며 값을 옮겨 적습니다.<br>' +
         '이 서비스는 <b>정비계획 → 구매신청 → 반납</b>을 한 줄로 잇습니다.',
      hint: '이번 단계에서 세 화면을 지나갑니다 · 적정구매시점 → 구매신청 → 자재반납' },

    { st: 2, page: 'plan', sel: '#list, #sort',
      t: '이번 주 내 WO부터',
      b: '정비계획(WO) 단위로 봅니다 · 표정이 <b>구매신청 deadline</b>까지 남은 일수입니다 · ' +
         '작업 계획 일정에서 리드타임을 거꾸로 세 잡은 날입니다.' },

    { st: 2, page: 'plan', act: 'openWo', sel: '.wo.open .wo-body, #list',
      t: '무엇이 몇 개 모자란지까지',
      b: 'WO를 펼치면 <b>소요 자재 · 현재고 · 부족분</b>이 한 표로 나옵니다 · ' +
         '타 부서에 남는 수량이 있으면 <b>사지 않고 가져올 수 있다</b>고 같이 알려 줍니다.' },

    { st: 2, page: 'purchase', act: 'pickPr', sel: '#form, #list',
      t: '초안은 채워져서 옵니다',
      b: '자재를 누르면 <b>자재 · 수량 · 정비계획 · 설비가 이미 채워진</b> 신청서 초안이 열립니다 · ' +
         '적정재고나 적정구매시점에서 넘어오면 그 자재가 골라진 채로 옵니다.<br>' +
         '칸의 <b>?</b> 를 누르면 값 · 출처 · <b>AI 채움</b> 여부가 나옵니다 · 옮겨 적을 것이 없습니다.' },

    { st: 2, page: 'return', act: 'pickRet', sel: '#effect, #table-card',
      t: '남은 자재는 되돌립니다',
      b: '불출하고 남은 자재를 <b>자재반납신청서 초안</b>으로 만듭니다 · 수량을 고치면 ' +
         '<b>회수 금액</b>이 따라 바뀌고, 반납하면 <b>적정재고 숫자까지</b> 같이 움직입니다.',
      hint: '현장에서는 자재식별표 QR을 폰으로 찍어 3초에 끝냅니다 (모바일 시연은 따로).' },

    { st: 2, page: 'return', kind: 'effect',
      t: '2단계 성과',
      b: '값을 옮겨 적고 전화로 확인하는 일이 사라지면 <b>사람의 시간</b>이 남습니다.',
      nums: 'stage2' },

    { st: 2, page: 'return', kind: 'quest',
      t: '2단계 · 업무 연결 완료',
      b: '정비계획에서 반납까지 <b>한 줄</b>이 됐습니다 · 마지막으로 <b>물어보는 법</b>을 봅니다.' },

    // ────────────────────────────────── 3단계 · 질의
    { st: 3, page: 'main', act: 'openChat', sel: '.chatpane, .chatbtn',
      t: '3단계 · 모르는 건 무엇이든',
      b: 'RAG로 답합니다 · <b>자재 매뉴얼</b> + <b>현장 암묵지(포스위키)</b> + ' +
         '<b>이 웹사이트의 데이터</b>를 근거로 씁니다. 답에는 <b>출처</b>가 붙고, ' +
         '근거를 못 찾으면 <b>「모른다」</b>고 적습니다.' },

    { st: 3, page: 'main', sel: '.chat-input, .chatpane',
      t: '말로 물어봐도 됩니다',
      b: '🎤 <b>음성 인식(STT)</b>을 지원합니다 · 장갑을 낀 현장에서도 쓸 수 있습니다.<br>' +
         '「적정재고 탭으로 가줘」 처럼 <b>시키는 것</b>도 됩니다.' },

    { st: 3, page: 'main', kind: 'quest', last: true,
      t: '세 단계 퀘스트 완료',
      b: '분석 · 업무 연결 · AI 질의를 모두 보셨습니다.<br>' +
         '이제 <b>내 자재</b>로 직접 해 보세요 · 왼쪽 아래 <b>튜토리얼</b>로 언제든 다시 볼 수 있습니다.' }
  ];

  /* effect 걸음의 숫자 · 그때 어댑터에서 읽는다 (화면이 보는 값과 같아야 한다) */
  function figures(key) {
    var A = window.ANALYSIS, S = window.SCREEN;
    var out = [];
    if (key === 'stage1') {
      var w = A ? A.money() : null;
      var c = S && S.stockCounts ? S.stockCounts() : null;
      if (w) {
        out.push(['재고 감축 가능', UI.wonShort(w.cutAmt) + UI.wonShortUnit(w.cutAmt),
                  '목표재고를 넘는 몫 · ' + (c ? UI.num(c.cut) + '품목' : '')]);
        out.push(['연 금융비용 절감',
                  w.finance === null ? '산식 미확인' : UI.won(w.finance),
                  '감축 + 공용화 회수 기준 · 명세 상수']);
      }
      return out;
    }
    /* 2단계 · 사람의 시간이다 · 아직 확정 전 값이라 그렇게 적는다 */
    out.push(['정비 직원', '83 FTE', '옮겨 적기 · 확인 전화가 사라진 몫 (확정 전 · 추정)']);
    var p = S && S.planCounts ? S.planCounts() : null;
    out.push(['한 줄로 이은 일',
              (p ? UI.num(p.wos) : '—') + '건',
              '이 달 정비계획 → 구매신청 → 반납까지']);
    return out;
  }

  // ================================================================ 화면에서 할 일
  /* 튜토리얼이 화면을 실제로 움직인다 · 각 화면의 버튼과 같은 길로 부른다.
   * 결과가 올라오기를 기다려야 하는 것(알고리즘 · 분석)은 조건을 폴링한다 */
  var ACTS = {
    runAlgo: function () {
      var b = document.getElementById('run');
      if (window.SCREEN && SCREEN.stage() === 'algo') { return done(); }
      if (b) { b.click(); }
      return until(function () { return window.SCREEN && SCREEN.stage() === 'algo'; }, 7000);
    },
    pickRow: function () {
      var b = document.querySelector('#list .pick .pick-body');
      if (b) { b.click(); }
      return wait(260);
    },
    runStock: function () {
      var b = document.getElementById('ana');
      if (window.SCREEN && SCREEN.stockStage() === 'done') { return done(); }
      if (b) { b.click(); }
      return until(function () { return window.SCREEN && SCREEN.stockStage() === 'done'; }, 7000);
    },
    tabOrder: function () { return tab('order'); },
    /* PR 초안 · 화면의 「PR 초안」 은 확인 창을 띄우고 구매신청 화면으로 옮겨 간다.
     * 튜토리얼은 여기 머물러야 하므로 같은 DB 호출만 한다 (3층 pr_drafts).
     *
     * 순서가 중요하다 · DB 를 건드리면 화면이 다시 그려져 미리 잡아 둔 단추가 떨어진다(stale).
     * 그래서 초안을 먼저 만들고, 다시 그려진 뒤에 칸 단추를 **다시 찾아** 누른다 */
    makeDraft: function () {
      try {
        var r = DB.list({ actionNow: '발주' })[0];
        if (r) {
          DB.draft('PR', { q: r.q, data: { qty: r.needNow, unit: r.unit, why: '튜토리얼 · 발주 필요' } });
        }
      } catch (e) { /* 못 만들어도 튜토리얼은 이어진다 */ }
      return wait(240).then(function () { return tab('cut'); });
    },
    /* 공용 전환 · 화면의 확인 창을 열어 승인까지 누른다 (재고가 실제로 줄어든다).
     * 감축 칸에만 「공용 전환」 단추가 있으므로 칸이 아니면 먼저 옮긴다 */
    poolOnce: function () {
      return tab('cut').then(function () {
        var b = document.querySelector('[data-pool]');
        if (!b) { return done(); }
        b.click();
        return pool2();
      });
    },
    openWo: function () {
      var h = document.querySelector('.wo:not(.open) .wo-head');
      if (h) { h.click(); }
      return wait(300);
    },
    /* 구매신청 초안 · 자재반납신청서 초안은 둘 다 「자재를 눌러야」 열린다 (기본 접힘) ·
     * 설명과 화면이 어긋나지 않게 튜토리얼이 먼저 눌러 준다 */
    pickPr: function () {
      var b = document.querySelector('.picklist .pick');
      if (b) { b.click(); }
      return wait(320);
    },
    pickRet: function () {
      var b = document.querySelector('[data-pick]');
      if (b) { b.click(); }
      return wait(320);
    },
    openChat: function () {
      if (window.CHAT) { CHAT.open(); }
      return wait(340);
    }
  };

  /* 칸 단추는 표를 다시 그린다 · 누른 뒤 한 박자 기다린다 */
  function tab(key) {
    var b = document.querySelector('[data-stab="' + key + '"]');
    if (b) { b.click(); }
    return wait(300);
  }

  function pool2() {
    return wait(340).then(function () {
      var ok = document.querySelector('.modal-back [data-ok]');
      if (ok) { ok.click(); }
      return wait(460);
    }).then(function () {
      var x = document.querySelector('.modal-back [data-x]');
      if (x) { x.click(); }
      return wait(180);
    });
  }

  function done() { return { then: function (f) { f(); return done(); } }; }
  function wait(ms) {
    return new Promise(function (r) { window.setTimeout(r, ms); });
  }
  function until(test, ms) {
    var t0 = Date.now();
    return new Promise(function (r) {
      (function tick() {
        if (test() || Date.now() - t0 > ms) { r(); return; }
        window.setTimeout(tick, 120);
      })();
    });
  }

  // ================================================================ 상태
  var i = 0;
  var layer = null, spotEl = null, cardEl = null;
  var tied = false, busy = false;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function file() {
    var f = String(window.location.pathname || '').split('/').pop();
    return f || 'main.html';
  }
  function pageOf(f) {
    return { 'main.html': 'main', 'attr.html': 'attr', 'stock.html': 'stock',
             'plan.html': 'plan', 'purchase.html': 'purchase', 'return.html': 'return' }[f] || '';
  }
  function fileOf(p) {
    return { main: 'main.html', attr: 'attr.html', stock: 'stock.html',
             plan: 'plan.html', purchase: 'purchase.html', 'return': 'return.html' }[p];
  }
  function here() { return pageOf(file()); }

  function put(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  function save() { put(AT, String(i)); }

  /* 쉼표로 적은 선택자 중 실제로 보이는 첫 칸 · 숨은 버튼에 구멍을 내면 왼쪽 위가 밝아진다 */
  function pick(sel) {
    if (!sel) { return null; }
    var list = String(sel).split(',');
    for (var k = 0; k < list.length; k++) {
      var el = document.querySelector(list[k].trim());
      if (!el || !el.getBoundingClientRect) { continue; }
      var r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) { return el; }
    }
    return null;
  }

  // ================================================================ 그리기
  function close(finish) {
    if (layer && layer.parentNode) { layer.parentNode.removeChild(layer); }
    layer = spotEl = cardEl = null;
    if (tied) {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      tied = false;
    }
    if (finish !== false) { del(AT); put(SEEN, '1'); }
  }

  function build() {
    layer = document.createElement('div');
    layer.className = 'tour-layer on';
    /* 판 · 구멍 · 카드를 **한 번만** 만든다 · 걸음마다 새로 만들면 구멍이 미끄러지지 않는다 */
    layer.innerHTML = '<div class="tspot" id="tspot"></div><div class="tcard" id="tcard"></div>';
    spotEl = layer.querySelector('#tspot');
    cardEl = layer.querySelector('#tcard');
    layer.addEventListener('click', onClick);
    document.body.appendChild(layer);
    if (!tied) {
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      tied = true;
    }
  }

  function stageBar() {
    var st = SCRIPT[i].st;
    return '<div class="tst">' + STAGES.map(function (s, k) {
      return '<span class="tsi' + (k === st ? ' on' : (k < st ? ' done' : '')) + '">' +
        esc(s.k) + '<b>' + esc(s.n) + '</b></span>';
    }).join('') + '</div>';
  }

  function stepDots() {
    var st = SCRIPT[i].st;
    var mine = [];
    SCRIPT.forEach(function (s, k) { if (s.st === st) { mine.push(k); } });
    var at = mine.indexOf(i);
    return '<span class="tdots">' + mine.map(function (x, k) {
      return '<i class="' + (k === at ? 'on' : (k < at ? 'done' : '')) + '"></i>';
    }).join('') + '</span>';
  }

  function acts(s) {
    var last = i >= SCRIPT.length - 1;
    var next = last ? '시작하기' : (s.kind === 'quest' ? '다음 단계 →' : '다음');
    return '<div class="tacts">' +
      (i > 0 ? '<button class="btn line sm" type="button" data-act="prev">이전</button>' : '') +
      '<button class="btn line sm" type="button" data-act="x">그만 보기</button>' +
      '<button class="btn" type="button" data-act="next">' + esc(next) + '</button>' +
      '</div>';
  }

  function numsHtml(key) {
    var f = figures(key);
    return '<div class="tfig">' + f.map(function (x, k) {
      return '<div class="tfig-row" style="animation-delay:' + (0.25 + k * 0.55) + 's">' +
        '<span class="tfig-k">' + esc(x[0]) + '</span>' +
        '<b class="tfig-v">' + esc(x[1]) + '</b>' +
        '<span class="tfig-x">' + esc(x[2]) + '</span></div>';
    }).join('') + '</div>';
  }

  function render() {
    var s = SCRIPT[i];
    var kind = s.kind || 'spot';
    layer.className = 'tour-layer on k-' + kind + (kind === 'spot' ? '' : ' full');

    cardEl.innerHTML =
      '<div class="tcard-h">' +
        stageBar() + stepDots() +
        '<button class="modal-x" type="button" data-act="x" aria-label="닫기">&times;</button>' +
      '</div>' +
      (kind === 'quest' ? '<div class="tquest">✓<span>QUEST CLEAR</span></div>' : '') +
      '<h3>' + s.t + '</h3>' +
      '<p>' + s.b + '</p>' +
      (kind === 'effect' ? numsHtml(s.nums) : '') +
      (s.hint ? '<p class="thint">' + s.hint + '</p>' : '') +
      acts(s);

    /* 카드 속이 바뀔 때 한 번 살짝 올라오게 · 애니메이션을 다시 트기 위해 클래스를 떼고 붙인다 */
    cardEl.classList.remove('swap');
    void cardEl.offsetWidth;
    cardEl.classList.add('swap');

    aim(s.sel);
    if (kind === 'quest') { confetti(s.last ? 34 : 18); }
  }

  /* 밝게 남길 곳으로 스크롤한 뒤 구멍과 카드를 앉힌다 ·
   * 스크롤이 끝나기 전에 재면 엉뚱한 자리에 구멍이 난다 · 한 박자 기다린다 */
  function aim(sel) {
    var el = pick(sel);
    layer.setAttribute('data-sel', sel || '');
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (e) { el.scrollIntoView(); }
    }
    place();
    window.setTimeout(place, 120);
    window.setTimeout(place, 420);
  }

  function place() {
    if (!layer || !spotEl || !cardEl) { return; }
    var kind = (SCRIPT[i] || {}).kind || 'spot';
    var el = kind === 'spot' ? pick(layer.getAttribute('data-sel')) : null;
    var r = el ? el.getBoundingClientRect() : null;
    var vw = window.innerWidth, vh = window.innerHeight;

    if (!r || r.width < 4 || r.height < 4) {
      /* 가운데 카드 · 구멍은 접어 둔다 (없는 곳을 밝히면 더 헷갈린다) */
      layer.classList.add('full');
      spotEl.style.opacity = '0';
      cardEl.style.left = ''; cardEl.style.top = '';
      return;
    }
    layer.classList.remove('full');
    spotEl.style.opacity = '1';

    var pad = 10;
    var x = Math.max(6, r.left - pad), y = Math.max(6, r.top - pad);
    var w = Math.min(vw - 12, r.width + pad * 2);
    /* 화면보다 긴 칸은 윗부분만 비춘다 · 창이 화면을 다 먹으면 명암이 뜻을 잃는다 */
    var h = Math.min(r.height + pad * 2, Math.max(220, Math.round(vh * 0.56)));
    spotEl.style.left = x + 'px';
    spotEl.style.top = y + 'px';
    spotEl.style.width = w + 'px';
    spotEl.style.height = h + 'px';

    /* 카드는 구멍 아래 · 자리가 없으면 위 · 그래도 없으면 옆 */
    var cw = cardEl.offsetWidth || 430, ch = cardEl.offsetHeight || 240, gap = 16;
    var cx = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
    var cy;
    if (y + h + gap + ch <= vh - 12) { cy = y + h + gap; }
    else if (y - gap - ch >= 12) { cy = y - gap - ch; }
    else {
      cy = Math.max(12, Math.min(vh - ch - 12, r.top));
      cx = (r.left > vw / 2) ? Math.max(12, x - gap - cw) : Math.min(vw - cw - 12, x + w + gap);
    }
    cardEl.style.left = Math.round(cx) + 'px';
    cardEl.style.top = Math.round(cy) + 'px';
  }

  /* 미니멀 빵빠레 · 조각 몇 개가 떨어진다. 소리는 쓰지 않는다 (시연장에서 소리는 사고다) */
  function confetti(n) {
    var box = document.createElement('div');
    box.className = 'tconf';
    var cols = ['var(--b3)', 'var(--ok)', 'var(--core)', 'var(--insur)', 'var(--b1)'];
    var html = '';
    for (var k = 0; k < n; k++) {
      html += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;' +
        'background:' + cols[k % cols.length] + ';' +
        'animation-duration:' + (1.5 + Math.random() * 1.3).toFixed(2) + 's;' +
        'animation-delay:' + (Math.random() * 0.5).toFixed(2) + 's;' +
        'transform:rotate(' + Math.round(Math.random() * 180) + 'deg)"></i>';
    }
    box.innerHTML = html;
    document.body.appendChild(box);
    window.setTimeout(function () {
      if (box.parentNode) { box.parentNode.removeChild(box); }
    }, 3400);
  }

  // ================================================================ 걸음 옮기기
  function go(n) {
    if (n < 0) { n = 0; }
    if (n > SCRIPT.length - 1) { close(); return; }
    i = n;
    save();
    var s = SCRIPT[i];
    if (s.page !== here()) {
      /* 화면을 옮긴다 · 새 화면에서 이 걸음부터 이어 뜬다 */
      close(false);
      window.location.href = fileOf(s.page);
      return;
    }
    if (!layer) { build(); }
    if (!s.act || !ACTS[s.act] || busy) { render(); return; }
    /* 이 걸음 전에 화면에서 할 일이 있다 · 하는 동안 카드에 그렇게 적는다 */
    busy = true;
    cardEl.innerHTML = '<div class="tcard-h">' + stageBar() + stepDots() + '</div>' +
      '<h3>' + s.t + '</h3><p class="twait"><i></i>화면에서 실행하고 있습니다…</p>';
    layer.className = 'tour-layer on full';
    spotEl.style.opacity = '0';
    Promise.resolve(ACTS[s.act]()).then(function () {
      busy = false;
      if (layer) { render(); }
    }, function () { busy = false; if (layer) { render(); } });
  }

  function onClick(e) {
    var t = e.target;
    var jump = t.getAttribute && t.getAttribute('data-go');
    if (jump) { go(Number(jump)); return; }
    var act = t.getAttribute && t.getAttribute('data-act');
    if (!act || busy) { return; }
    if (act === 'x') { close(); return; }
    if (act === 'prev') { go(i - 1); return; }
    if (act === 'next') { go(i + 1); }
  }

  function open(n) {
    if (layer) { close(false); }
    i = typeof n === 'number' ? n : 0;
    go(i);
  }

  function start() {
    if (/[?&]notour=1/.test(window.location.search)) { return; }
    var p = here();
    if (!p) { return; }

    /* 앞 화면에서 넘어온 경우 · 적어 둔 걸음이 이 화면 것이면 이어 뜬다 */
    var saved = Number(get(AT));
    if (get(AT) !== null && !isNaN(saved) && SCRIPT[saved] && SCRIPT[saved].page === p) {
      open(saved);
      return;
    }

    /* 스스로 뜨는 것은 대시보드에서만 · 로그인 직후이거나 처음 온 사람 */
    if (p !== 'main') { return; }
    var chat = document.getElementById('chatpane');
    if (chat && !chat.hidden) { return; }
    if (get(PEND)) { del(PEND); open(0); return; }
    if (!get(SEEN)) { open(0); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* 밖에서 부르는 길 · 사이드바의 「튜토리얼」 이 TOUR.open(0) 을 부른다 */
  window.TOUR = { open: open, close: close, SCRIPT: SCRIPT, STAGES: STAGES };
})();
