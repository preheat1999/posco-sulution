/* tour.js · 둘러보기 · 여섯 화면을 순서대로 설명한다
 *
 * Dashboard → 속성값 판단 → 적정재고 분석 → 적정구매시점 → 구매신청 → 자재반납.
 *
 * 한 화면에서 설명이 끝나면 「다음 화면」 이 실제로 그 화면으로 옮겨 가고 거기서 이어 뜬다.
 * 어디까지 봤는지는 localStorage 에 둔다 (mtrl.tour.v2) · 새로 고쳐도 이어진다.
 *
 * 주소에 ?notour=1 을 주면 뜨지 않는다.
 * **캡처와 렌더 검사에 반드시 필요하다.** 안 그러면 안내가 화면을 덮어
 * 스크린샷이 전부 안내창이 되고, 검사기는 표가 비었다고 잡는다.
 *
 * 폰 화면(mobile-return · material-view)은 PAGE 가 'return' 이지만 코스가 아니다 ·
 * 파일 이름까지 맞을 때만 자동으로 뜬다. 현장에서 QR 을 찍었는데 안내창이 덮으면 안 된다.
 *
 * 스크립트 순서에서 가장 마지막이다. 다른 화면 요소가 다 그려진 뒤에 뜬다.
 */
(function () {
  'use strict';

  var SEEN = 'mtrl.tour.seen.v1';
  var AT = 'mtrl.tour.v2';

  /* 코스 · 사람이 실제로 일하는 순서다.
   * 공용 전환은 메뉴에서 뺐으므로 코스에도 없다 (적정재고 안에서 들어간다) */
  var COURSE = [
    { page: 'main', file: 'main.html', name: 'Dashboard' },
    { page: 'attr', file: 'attr.html', name: '속성값 판단' },
    { page: 'stock', file: 'stock.html', name: '적정재고 분석' },
    { page: 'plan', file: 'plan.html', name: '적정구매시점' },
    { page: 'purchase', file: 'purchase.html', name: '구매신청' },
    { page: 'return', file: 'return.html', name: '자재반납' }
  ];

  /* 화면마다 할 말. 값을 적지 않는다 · 숫자는 화면이 말하고 여기서는 「무엇을 보는 곳인가」 만 말한다.
   * (여기 숫자를 적어 두면 데이터가 바뀔 때 이 파일만 옛말이 된다) */
  var STEPS = {
    main: [
      ['자재를 다시 판단해서 재고를 줄이는 일입니다',
       '우리 부서가 맡은 자재 743품목이 보험품(설비 정지에 대비해 갖고 있는 것)인지 ' +
       '계획품(정비 일정에 맞춰 사는 것)인지 다시 판단하고, 그 속성으로 목표재고를 잡아 ' +
       '살 것과 줄일 것을 정합니다. 여섯 화면을 순서대로 보여 드립니다.'],
      ['첫 화면은 세 칸입니다',
       '무엇을 맡았나(속성 분류) · 얼마를 쥐고 있나(보유와 목표) · 언제까지인가(이번 주 정비계획). ' +
       '그 아래 띠는 바로 손이 가는 세 곳입니다 · 재분류 추천 · 재고 절감 · 긴급 발주.'],
      ['모든 숫자에 근거가 붙습니다',
       '값 옆의 ? 를 누르면 산식 · 점수 · 모집단 · 기준일이 그대로 나옵니다. ' +
       '정답 라벨이 0건이라 정확도를 말하지 않습니다 · 담당자 승인이 첫 라벨입니다.'],
      ['화면끼리 값이 흐릅니다',
       '속성값 판단에서 확정하면 이 대시보드와 적정재고 · 적정구매시점 숫자가 같이 움직입니다. ' +
       '오른쪽 아래 ✦ AI 자재 질의에 사내 규정을 묻거나 「적정재고 탭으로 가줘」 처럼 시킬 수도 있습니다.']
    ],
    attr: [
      ['처음에는 원본 속성만 보입니다',
       '정본 743품목에 적힌 보험품 · 계획품입니다. 「알고리즘 실행」 을 눌러야 판정 결과와 점수가 ' +
       '올라옵니다 · 언제 판단했는지 시각을 초까지 남깁니다.'],
      ['점수 두 개로 판단합니다',
       '단가 · 리드타임 · 사용 이력 · 핵심설비 여부 같은 7가지를 가중합해 보험품 점수와 계획품 점수를 ' +
       '매깁니다. 두 점수 차이가 작으면 회색지대로 남겨 사람에게 넘깁니다 · 애매한 것을 기계가 ' +
       '억지로 정하지 않습니다.'],
      ['판단과 확정은 다른 일입니다',
       '자재마다 판단하고 마지막에 「담당자 확정」 을 누릅니다. 확정하기 전까지 다른 화면은 ' +
       '알고리즘 판정 속성으로 계산합니다 · 몇 품목이 대기 중인지 대시보드가 알려 줍니다.'],
      ['확정하면 목표재고가 다시 잡힙니다',
       '보험품은 리드타임 동안 버틸 안전재고를 두고, 계획품은 무재고가 원칙이라 목표가 달라집니다. ' +
       '두 속성의 목표를 미리 계산해 두었기 때문에 확정하는 순간 적정재고가 그 속성으로 바뀝니다.']
    ],
    stock: [
      ['들어오면 분석 전입니다',
       '보유 수량과 속성만 있는 상태입니다. 「적정재고 분석」 을 누르면 확정 속성으로 계산한 ' +
       '목표재고 · 조치 · 금액이 올라옵니다.'],
      ['한 칸이 한 품목입니다',
       '핵심예비품의 과부족을 상자로 깔았습니다. 넓이가 과부족 금액이고 색은 방향입니다 · ' +
       '부족은 파랑 · 초과는 빨강. 금액 차이가 수백 배라 넓이는 눌러서 그리고 그 눈금을 아래에 적습니다.'],
      ['상자나 보유 수량을 누르면 산식이 열립니다',
       '그 자재의 목표재고가 어떤 값으로 나왔는지 그대로 보여 줍니다. ' +
       '목표가 0 인 것은 계획품 무재고 원칙이라 오류가 아닙니다.'],
      ['여기서 구매신청으로 넘어갑니다',
       '조치 표의 「PR 초안」 을 누르면 그 자재로 초안을 만들고 구매신청 화면으로 옮겨 갑니다. ' +
       '아래 칸에는 1.5년 이상 정체된 자재를 공용으로 돌려 회수하는 후보도 있습니다.']
    ],
    plan: [
      ['정비계획(WO) 단위로 봅니다',
       '기본은 이번 주 WO 이고, 마감 급한 순 · 휴지일순으로도 볼 수 있습니다. ' +
       '이번 주 여섯 건은 자재 확보 · 마감 임박 · 마감 초과를 한 화면에 보이려고 ' +
       '날짜만 이번 주로 옮긴 시연 일정입니다 · 설비 · 자재 · 재고는 원천 값 그대로입니다.'],
      ['마감일은 거꾸로 셉니다',
       '휴지 시작일에서 리드타임 평균 + 수리계획 선행일수 + 0.5 × 표준편차를 뺀 날이 발주 마감입니다. ' +
       '표정이 남은 일수를 말합니다 · 7일 이상 웃음 · 3~6일 무표정 · 2일 이하나 초과는 찡그림.'],
      ['WO 를 펼치면 소요 자재가 나옵니다',
       '어느 자재가 몇 개 필요하고 지금 몇 개 있는지, 부족분이 몇 개인지 한 표로 봅니다. ' +
       '타 부서에 남는 수량이 있으면 사지 않고 가져올 수 있다고 같이 알려 줍니다.'],
      ['부족한 자재는 구매신청으로 넘어갑니다',
       '「구매신청 초안 만들기」 를 누르면 초안을 만들고 구매신청 화면으로 옮겨 갑니다. ' +
       '그 초안에 이 자재와 이 정비계획이 채워져 있습니다.']
    ],
    purchase: [
      ['초안은 채워져서 옵니다',
       '적정재고나 적정구매시점에서 넘어오면 그 자재가 골라져 있고 수량 · 정비계획 · 설비가 ' +
       '채워져 있습니다. 목록에서 다른 자재를 골라 새로 만들 수도 있습니다.'],
      ['값마다 어디서 왔는지 적습니다',
       '각 칸의 ? 를 누르면 값 · 출처 · 「AI 채움」 여부가 나옵니다. ' +
       '원천에 없는 값은 지어내지 않고 없다고 적습니다.'],
      ['저장은 초안까지입니다',
       '초안은 사람이 한 일(3층)로 남고, PR 발행은 사내 시스템 연동 예정입니다 · 되는 척하지 않습니다. ' +
       '왼쪽 아래 「시연 초기화」 로 전부 되돌릴 수 있습니다.']
    ],
    'return': [
      ['현장에서 QR 을 찍습니다',
       '자재식별표의 QR 을 찍으면 자재 정보 화면이 뜨고, 맞는지 확인하면 반납 화면으로 넘어갑니다. ' +
       '폰에서 바로 됩니다 · 이 목록의 QR 카드에서도 같은 화면을 열 수 있습니다.'],
      ['사람이 정하는 것은 수량입니다',
       '반납 수량을 − + 로 정하고 반납자를 확인합니다. 물품 상태(양호 · 수리 필요)는 ' +
       '반납한 뒤 검사에서 정합니다 · 미리 정해 두지 않습니다.'],
      ['반납은 재고에 바로 반영됩니다',
       '회수 금액과 함께 기록되고, 우리 부서 자재면 보유 수량이 늘어 적정재고와 발주 필요 숫자가 ' +
       '같이 움직입니다. 물품 상태는 「반납 완료」 칸에서만 보입니다.']
    ],

    /* 코스 밖 화면 · 자동으로 뜨지 않고 「둘러보기」 를 누르면 이 말만 한다 */
    pool: [
      ['사는 대신 가져옵니다',
       '1.5년 이상 정체된 자재 중 전사에 남는 것이 있으면 우리 부서 장부에서 내리고 ' +
       '다른 부서가 쓰게 합니다. 그만큼 금융비용이 줄어듭니다.'],
      ['보류는 회수액에 넣지 않습니다',
       '핵심예비품이면서 보험품인 자재는 설비 정지에 직접 걸립니다. ' +
       '전부 더하면 회수액이 부풀려집니다.'],
      ['전환은 기록으로 남습니다',
       '정본과 판정값은 그대로 두고 사람이 한 일만 3층에 적습니다 · 시연 초기화로 되돌립니다.']
    ],
    evidence: [
      ['「몇 % 개선?」 에 답하지 않습니다',
       '비교할 현행 기준이 0건이라 그 수치를 만들면 거짓이 됩니다. 대신 0건이라는 사실을 SQL 로 보여 줍니다.'],
      ['실제 스키마명을 그대로 씁니다', '접속 정보만 바꾸면 실데이터로 돌아갑니다.'],
      ['빈칸을 어느 화면이 채우는지까지',
       '문제만 보여 주면 불평이고, 채우는 화면을 보여 줘야 해결입니다.']
    ]
  };

  var at = 0;        // 코스에서 몇 번째 화면인가 (코스 밖이면 -1)
  var i = 0;         // 그 화면의 몇 번째 설명인가
  var steps = [];
  var back = null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function file() {
    var f = String(window.location.pathname || '').split('/').pop();
    return f || 'main.html';
  }

  /* 지금 화면이 코스의 몇 번째인가 · 파일 이름까지 맞아야 한다.
   * mobile-return.html 은 PAGE 가 'return' 이지만 코스가 아니다 */
  function here() {
    var f = file(), n = -1;
    COURSE.forEach(function (c, k) { if (c.file === f) { n = k; } });
    return n;
  }

  function save() {
    if (at < 0) { return; }
    try { window.localStorage.setItem(AT, JSON.stringify({ at: at, step: i })); }
    catch (e) { /* 저장이 안 되면 다음 화면에서 이어지지 않는다 · 그래도 화면은 돈다 */ }
  }

  function clear() {
    try {
      window.localStorage.removeItem(AT);
      window.localStorage.setItem(SEEN, '1');
    } catch (e) { /* 무시 */ }
  }

  function close(done) {
    if (back && back.parentNode) { back.parentNode.removeChild(back); }
    back = null;
    if (done !== false) { clear(); }
  }

  /* 다른 화면으로 옮겨 가며 이어 본다 · 옮겨 갈 곳과 몇 번째 설명부터인지를 적어 두고 주소를 바꾼다 */
  function go(k, step) {
    var c = COURSE[k];
    if (!c) { return; }
    at = k;
    i = step === 'last' ? Math.max(0, (STEPS[c.page] || []).length - 1) : (step || 0);
    save();
    if (c.file === file()) { draw(); return; }
    close(false);
    window.location.href = c.file;
  }

  function head() {
    if (at < 0) {
      return '<div class="sub">둘러보기 ' + (i + 1) + ' / ' + steps.length + '</div>';
    }
    var chips = COURSE.map(function (c, k) {
      return '<button class="tchip' + (k === at ? ' on' : (k < at ? ' done' : '')) +
        '" type="button" data-go="' + k + '">' + esc(c.name) + '</button>';
    }).join('');
    return '<div class="sub">화면 ' + (at + 1) + ' / ' + COURSE.length +
      ' · 설명 ' + (i + 1) + ' / ' + steps.length + '</div>' +
      '<div class="tsteps">' + chips + '</div>';
  }

  function draw() {
    if (!back) { return; }
    var page = at >= 0 ? COURSE[at].page : (window.PAGE || 'main');
    steps = STEPS[page] || STEPS.main;
    if (i > steps.length - 1) { i = steps.length - 1; }
    var s = steps[i] || ['', ''];
    var last = i === steps.length - 1;
    var nextC = at >= 0 ? COURSE[at + 1] : null;
    var nextLabel = !last ? '다음'
      : (nextC ? nextC.name + ' →' : (at >= 0 ? '끝내기' : '시작하기'));

    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div style="min-width:0">' + head() +
            '<h3>' + esc(s[0]) + '</h3></div>' +
          '<button class="modal-x" type="button" data-act="x" aria-label="닫기">&times;</button>' +
        '</div>' +
        '<p style="font-size:13px;line-height:1.75;color:var(--text-2)">' + esc(s[1]) + '</p>' +
        '<div class="tacts">' +
          ((i > 0 || at > 0)
            ? '<button class="btn line" type="button" data-act="prev">이전</button>' : '') +
          '<button class="btn line" type="button" data-act="x">그만 보기</button>' +
          '<button class="btn" type="button" data-act="next">' + esc(nextLabel) + '</button>' +
        '</div>' +
      '</div>';
  }

  function open(startAt) {
    at = startAt === undefined ? here() : startAt;
    i = 0;
    if (at >= 0 && COURSE[at].file !== file()) { go(at, 0); return; }
    if (at >= 0) { save(); }
    back = document.createElement('div');
    back.className = 'modal-back on';
    back.addEventListener('click', function (e) {
      var t = e.target;
      var jump = t.getAttribute && t.getAttribute('data-go');
      if (jump !== null && jump !== undefined && jump !== '') { go(Number(jump), 0); return; }
      var act = t.getAttribute && t.getAttribute('data-act');
      if (!act) { if (t === back) { close(); } return; }
      if (act === 'x') { close(); return; }
      if (act === 'prev') {
        if (i > 0) { i -= 1; save(); draw(); }
        else if (at > 0) { go(at - 1, 'last'); }
        return;
      }
      if (act === 'next') {
        if (i < steps.length - 1) { i += 1; save(); draw(); return; }
        if (at >= 0 && COURSE[at + 1]) { go(at + 1, 0); return; }
        close();
      }
    });
    document.body.appendChild(back);
    draw();
  }

  function button() {
    if (document.querySelector('.tourbtn')) { return; }
    var b = document.createElement('button');
    b.className = 'tourbtn';
    b.type = 'button';
    b.textContent = '둘러보기';
    b.addEventListener('click', function () { open(); });
    document.body.appendChild(b);
  }

  function start() {
    /* ?notour=1 이면 버튼만 두고 자동으로 열지 않는다 */
    var noTour = /[?&]notour=1/.test(window.location.search);
    button();
    if (noTour) { return; }

    var n = here();
    /* 채팅 서랍이 열려 있으면 자동으로 열지 않는다 · 겹치면 둘 다 못 읽는다 */
    var chatOpen = (function () {
      var p = document.getElementById('chatpane');
      return !!(p && !p.hidden);
    })();
    if (chatOpen || n < 0) { return; }

    /* 앞 화면에서 「다음 화면」 을 눌러 넘어온 경우 · 적어 둔 자리에서 이어 뜬다 */
    var saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(AT) || 'null'); }
    catch (e) { saved = null; }
    if (saved && Number(saved.at) === n) {
      open(n);
      i = Math.max(0, Number(saved.step) || 0);
      draw();
      return;
    }

    /* 처음 온 사람에게는 그 화면 설명부터 시작한다 (「이전」 으로 앞 화면도 볼 수 있다) */
    var seen = null;
    try { seen = window.localStorage.getItem(SEEN); } catch (e) { seen = '1'; }
    if (!seen) { open(n); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* 밖에서 부르는 길 · TOUR.open() 은 지금 화면부터, TOUR.open(0) 은 대시보드부터 */
  window.TOUR = { open: open, close: close, COURSE: COURSE, STEPS: STEPS };
})();
