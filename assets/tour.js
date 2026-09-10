/* tour.js · 첫 방문 안내
 *
 * 왼쪽 아래 고정 버튼. 첫 방문이면 자동으로 뜬다.
 *
 * 주소에 ?notour=1 을 주면 뜨지 않는다.
 * **캡처와 렌더 검사에 반드시 필요하다.** 안 그러면 안내가 화면을 덮어
 * 스크린샷이 전부 안내창이 되고, 검사기는 표가 비었다고 잡는다.
 *
 * 스크립트 순서에서 가장 마지막이다. 다른 화면 요소가 다 그려진 뒤에
 * 무엇을 가리킬지 정해야 한다.
 */
(function () {
  'use strict';

  var SEEN = 'mtrl.tour.seen.v1';

  /* 화면마다 할 말이 다르다. 없는 화면은 안내 버튼만 두고 자동으로 뜨지 않는다 */
  var STEPS = {
    main: [
      ['지금 할 일 한 줄을 먼저', '숫자를 나열하지 않습니다. 「지금」 한 줄을 키워 두고 「이번 주 · 기회 · 검토」 는 접어 뒀습니다. 무엇을 먼저 하면 되는지만 내려 줍니다.'],
      ['모든 판정에 근거가 붙습니다', 'AI 가 정한 값 옆의 ? 를 누르면 산식과 점수가 그대로 나옵니다. 근거를 숨기지 않는 것이 이 서비스의 핵심입니다.'],
      ['화면끼리 값이 흐릅니다', '속성값 판단에서 한 건을 승인하면 이 대시보드와 적정재고 숫자가 같이 움직입니다.']
    ],
    attr: [
      ['처음에는 원본 속성만 보입니다', '정본 743품목에 적힌 보험품 · 계획품입니다. 「알고리즘 실행」 을 눌러야 판정 결과와 점수가 올라옵니다. 실행 시각을 초까지 남깁니다.'],
      ['판단과 확정은 다른 일입니다', '자재마다 판단하고 마지막에 「담당자 확정」 을 누릅니다. 확정하기 전까지 적정재고 · 적정구매시점은 알고리즘 판정 속성을 그대로 씁니다.'],
      ['확정하면 목표재고가 다시 잡힙니다', '보험품 확정 라벨이 0종이라 지도학습을 할 수 없습니다. 그래서 규칙으로 점수를 매겨 제안하고, 담당자 확정을 첫 라벨로 씁니다. 확정 속성으로 계산한 목표재고 · 조치 · 금액이 다른 화면에 같이 흐릅니다.']
    ],
    stock: [
      ['들어오면 분석 전입니다', '보유 수량과 속성만 있는 상태입니다. 「적정재고 분석」 을 누르면 확정 속성으로 계산한 목표재고 · 조치 · 금액이 올라옵니다.'],
      ['한 칸이 한 품목입니다', '핵심예비품의 과부족을 상자로 깔았습니다. 상자 넓이가 과부족 금액이고, 색은 방향입니다 · 부족은 파랑 · 초과는 빨강.'],
      ['상자나 보유 수량을 누르면 산식이 열립니다', '그 자재의 목표재고가 어떤 값으로 나왔는지 그대로 보여 줍니다. 목표 0 은 계획품 무재고 원칙이라 오류가 아닙니다.']
    ],
    plan: [
      ['한 달치만 봅니다', '반출된 156건은 넉 달에 걸쳐 있습니다. 한 부서가 한 달에 세우는 정비계획은 서른 건 남짓이라, 기준일부터 30일 안의 건만 올립니다.'],
      ['표정이 발주 시점을 알려 줍니다', '7일 이상 웃음 · 3~6일 무표정 · 2일 이하나 초과는 찡그림입니다. 색만으로 구분하지 않습니다.'],
      ['부족한 자재는 구매신청으로 바로 넘어갑니다', 'WO 를 펼쳐 「구매신청 초안 만들기」 를 누르면 초안을 만들고 구매신청 화면으로 옮겨 갑니다. 그 화면의 초안에 이 자재와 이 정비계획이 채워져 있습니다.']
    ],
    pool: [
      ['사는 대신 가져옵니다', '1.5년 이상 정체된 자재 중 전사에 남는 것이 있으면 우리 부서 장부에서 내리고 다른 부서가 쓰게 합니다. 그만큼 금융비용이 줄어듭니다.'],
      ['보류는 회수액에 넣지 않습니다', '핵심예비품이면서 보험품인 자재는 설비 정지에 직접 걸립니다. 전부 더하면 회수액이 부풀려집니다.'],
      ['전환은 3층에 기록됩니다', '정본과 판정값은 그대로 남습니다. 시연 초기화로 되돌릴 수 있습니다.']
    ],
    evidence: [
      ['「몇 % 개선?」 에 답하지 않습니다', '비교할 현행 기준이 0건이라 그 수치를 만들면 거짓이 됩니다. 대신 0건이라는 사실을 SQL 로 보여 줍니다.'],
      ['실제 스키마명을 그대로 씁니다', '접속 정보만 바꾸면 실데이터로 돌아갑니다.'],
      ['빈칸을 어느 화면이 채우는지까지', '문제만 보여 주면 불평이고, 채우는 화면을 보여 줘야 해결입니다.']
    ]
  };

  var i = 0;
  var steps = [];
  var back = null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function close() {
    if (back && back.parentNode) { back.parentNode.removeChild(back); }
    back = null;
    try { window.localStorage.setItem(SEEN, '1'); } catch (e) { /* 저장 안 되면 매번 뜬다 */ }
  }

  function draw() {
    if (!back) { return; }
    var s = steps[i] || ['', ''];
    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div><div class="sub">둘러보기 ' + (i + 1) + ' / ' + steps.length + '</div>' +
          '<h3>' + esc(s[0]) + '</h3></div>' +
          '<button class="modal-x" type="button" data-act="x" aria-label="닫기">&times;</button>' +
        '</div>' +
        '<p style="font-size:13px;line-height:1.75;color:var(--text-2)">' + esc(s[1]) + '</p>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">' +
          (i > 0 ? '<button class="btn line" type="button" data-act="prev">이전</button>' : '') +
          '<button class="btn line" type="button" data-act="x">그만 보기</button>' +
          '<button class="btn" type="button" data-act="next">' +
            (i === steps.length - 1 ? '시작하기' : '다음') + '</button>' +
        '</div>' +
      '</div>';
  }

  function open() {
    var page = window.PAGE || '';
    steps = STEPS[page] || STEPS.main;
    i = 0;
    back = document.createElement('div');
    back.className = 'modal-back on';
    back.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) { if (e.target === back) { close(); } return; }
      if (act === 'x') { close(); return; }
      if (act === 'prev') { i = Math.max(0, i - 1); draw(); return; }
      if (act === 'next') {
        if (i >= steps.length - 1) { close(); } else { i += 1; draw(); }
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
    b.addEventListener('click', open);
    document.body.appendChild(b);
  }

  function start() {
    /* ?notour=1 이면 버튼만 두고 자동으로 열지 않는다 */
    var noTour = /[?&]notour=1/.test(window.location.search);
    button();
    if (noTour) { return; }
    var seen = null;
    try { seen = window.localStorage.getItem(SEEN); } catch (e) { seen = '1'; }
    if (!seen && STEPS[window.PAGE || '']) { open(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.TOUR = { open: open, close: close, STEPS: STEPS };
})();
