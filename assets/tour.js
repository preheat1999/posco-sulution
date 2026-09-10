/* tour.js · 튜토리얼 · 화면을 어둡게 덮고 설명할 곳만 밝게 남긴다
 *
 * 로그인한 뒤 대시보드에 들어오면 바로 뜬다 (login.html 이 mtrl.tour.pending 을 적어 둔다).
 * 순서는 사람이 일하는 순서다 ·
 *   Dashboard → 보유목적 판단 → 적정재고 분석 → 적정구매시점 → 구매신청 → 자재반납.
 * 한 화면의 설명이 끝나면 「다음 화면」 이 실제로 그 화면으로 옮겨 가고 거기서 이어 뜬다.
 *
 * 왜 명암인가 · 글로만 「오른쪽 위 카드를 보세요」 라고 적으면 눈이 그 카드를 못 찾는다.
 * 어두운 판에 구멍을 하나 내면 찾을 것이 하나뿐이라 읽기 전에 이미 보인다.
 * 설명은 두 문장을 넘기지 않는다 · 게임 첫 화면처럼 짧게.
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

  var SEEN = 'mtrl.tour.seen.v1';    // 한 번 봤다
  var AT = 'mtrl.tour.v2';           // 코스 어디까지 · {at, step}
  var PEND = 'mtrl.tour.pending';    // 로그인이 적어 둔다 · 대시보드에서 한 번 뜨고 지운다

  /* 코스 · 공용 전환은 메뉴에서 뺐으므로 코스에도 없다 (적정재고 안에서 들어간다) */
  var COURSE = [
    { page: 'main', file: 'main.html', name: 'Dashboard' },
    { page: 'attr', file: 'attr.html', name: '보유목적 판단' },
    { page: 'stock', file: 'stock.html', name: '적정재고 분석' },
    { page: 'plan', file: 'plan.html', name: '적정구매시점' },
    { page: 'purchase', file: 'purchase.html', name: '구매신청' },
    { page: 'return', file: 'return.html', name: '자재반납' }
  ];

  /* 한 걸음 = [밝게 남길 곳(선택자) · 제목 · 두 문장].
   *
   * 선택자는 쉼표로 여럿 적을 수 있다 · 그중 **보이는 첫 칸**을 고른다
   * (적정재고는 분석 전에는 CTA, 분석 뒤에는 히트맵이 그 자리에 있다).
   * 선택자가 없거나(null) 그 자리가 화면에 없으면 가운데에 카드만 띄운다 ·
   * 없는 곳에 구멍을 내면 왼쪽 위 빈 자리가 밝아져서 더 헷갈린다.
   * 숫자는 적지 않는다 · 적어 두면 데이터가 바뀔 때 이 파일만 옛말이 된다 */
  var STEPS = {
    main: [
      [null, '재고를 스스로 줄이는 자재 시스템',
       '자재를 다시 판단해서 살 것과 줄일 것을 정합니다. 여섯 화면을 순서대로 짧게 보여 드릴게요.'],
      ['#d-attr', '① 무엇을 맡았나',
       '맡은 자재가 어떤 갈래로 나뉘는지 봅니다. 변경 제안과 판단 보류가 사람이 볼 몫입니다.'],
      ['#d-stock', '② 얼마를 쥐고 있나',
       '보유 금액과 목표재고를 나란히 견줍니다. 빗금 칸이 빼도 되는 몫입니다.'],
      ['#d-due', '③ 언제까지인가',
       '이번 주 정비계획입니다. 자재가 모자란 건은 여기서 구매신청으로 넘어갑니다.'],
      ['.chatbtn', '모르면 물어보세요',
       '사내 규정도, 이 서비스 숫자도 답합니다. 「적정재고 탭으로 가줘」 처럼 시킬 수도 있습니다.']
    ],
    attr: [
      ['#stageline', '원본 → 실행 → 확정',
       '들어오면 정본에 적힌 속성만 보입니다. 「알고리즘 실행」 을 눌러야 판정이 올라옵니다.'],
      ['#tabs', '점수 두 개로 가릅니다',
       '보험품 점수와 계획품 점수를 매기고, 차이가 작으면 회색지대로 남겨 사람에게 넘깁니다.'],
      ['#commit', '확정이 첫 라벨입니다',
       '정답 라벨이 없어서 담당자 확정을 첫 라벨로 씁니다. 누르는 순간부터 다른 화면이 그 속성으로 계산합니다.']
    ],
    stock: [
      ['#anahero, #stat', '들어오면 분석 전입니다',
       '「적정재고 분석」 을 누르면 확정된 속성으로 목표재고 · 조치 · 금액을 냅니다.'],
      ['#heat, #stat', '한 칸이 한 품목입니다',
       '넓이가 과부족 금액이고 색이 방향입니다 · 부족은 파랑 · 초과는 빨강.'],
      ['#steps', '조치에서 바로 신청합니다',
       '「PR 초안」 을 누르면 그 자재로 초안을 만들어 구매신청 화면으로 넘어갑니다.']
    ],
    plan: [
      ['#sort', '이번 주 정비계획부터',
       '정비계획(WO) 단위로 봅니다. 마감 급한 순 · 휴지일순으로도 볼 수 있습니다.'],
      ['#list', '표정이 발주 시점입니다',
       '휴지 시작일에서 리드타임을 거꾸로 세 마감을 잡습니다. 찡그리면 이미 늦었다는 뜻입니다.'],
      ['#stat', '한 달치만 봅니다',
       '기준일부터 30일 안의 계획입니다. 이번 주 여섯 건은 날짜만 옮긴 시연 일정입니다.']
    ],
    purchase: [
      ['#list', '자재는 골라져서 옵니다',
       '적정재고나 적정구매시점에서 넘어오면 그 자재가 이미 골라져 있습니다.'],
      ['#form', '값마다 출처가 붙습니다',
       '칸의 ? 를 누르면 값 · 출처 · 「AI 채움」 여부가 나옵니다. 없는 값은 없다고 적습니다.'],
      ['#steps', '초안까지가 우리 몫입니다',
       'PR 발행은 사내 시스템 연동 예정입니다 · 되는 척하지 않습니다.']
    ],
    'return': [
      ['#qr', 'QR 을 찍으면 시작합니다',
       '폰으로 찍으면 자재 정보가 뜨고, 맞는지 확인하면 반납 화면으로 넘어갑니다.'],
      ['#tabs', '사람이 정하는 건 수량입니다',
       '물품 상태는 반납한 뒤 검사에서 정합니다 · 「반납 완료」 칸에서만 보입니다.'],
      ['#effect', '재고에 바로 반영됩니다',
       '회수 금액만큼 보유가 늘고 적정재고 · 발주 필요 숫자가 같이 움직입니다.']
    ]
  };

  var at = 0;        // 코스에서 몇 번째 화면인가
  var i = 0;         // 그 화면의 몇 번째 걸음인가
  var steps = [];
  var layer = null;
  var tied = false;  // 창 크기 · 스크롤에 붙였나

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function file() {
    var f = String(window.location.pathname || '').split('/').pop();
    return f || 'main.html';
  }

  /* 지금 화면이 코스의 몇 번째인가 · 파일 이름까지 맞아야 한다 */
  function here() {
    var f = file(), n = -1;
    COURSE.forEach(function (c, k) { if (c.file === f) { n = k; } });
    return n;
  }

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

  function put(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* 무시 */ } }

  function save() { if (at >= 0) { put(AT, JSON.stringify({ at: at, step: i })); } }

  function close(done) {
    if (layer && layer.parentNode) { layer.parentNode.removeChild(layer); }
    layer = null;
    if (tied) {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      tied = false;
    }
    if (done !== false) { del(AT); put(SEEN, '1'); }
  }

  /* 다음 화면으로 옮겨 가며 이어 본다 · 갈 곳과 몇 번째 걸음인지 적어 두고 주소를 바꾼다 */
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

  // ---------------------------------------------------------------- 그리기
  function chips() {
    return '<div class="tsteps">' + COURSE.map(function (c, k) {
      return '<button class="tchip' + (k === at ? ' on' : (k < at ? ' done' : '')) +
        '" type="button" data-go="' + k + '">' + esc(c.name) + '</button>';
    }).join('') + '</div>';
  }

  function draw() {
    if (!layer) { return; }
    var page = COURSE[at] ? COURSE[at].page : (window.PAGE || 'main');
    steps = STEPS[page] || STEPS.main;
    if (i > steps.length - 1) { i = steps.length - 1; }
    var s = steps[i] || [null, '', ''];
    var last = i === steps.length - 1;
    var nextC = COURSE[at + 1];
    var nextLabel = !last ? '다음' : (nextC ? nextC.name + ' →' : '시작하기');

    layer.innerHTML =
      '<div class="tspot" id="tspot"></div>' +
      '<div class="tcard" id="tcard">' +
        '<div class="tcard-h">' +
          '<span class="tnum">' + (at + 1) + ' / ' + COURSE.length + '</span>' +
          '<span class="tdots">' + steps.map(function (x, k) {
            return '<i class="' + (k === i ? 'on' : (k < i ? 'done' : '')) + '"></i>';
          }).join('') + '</span>' +
          '<button class="modal-x" type="button" data-act="x" aria-label="닫기">&times;</button>' +
        '</div>' +
        '<h3>' + esc(s[1]) + '</h3>' +
        '<p>' + esc(s[2]) + '</p>' +
        chips() +
        '<div class="tacts">' +
          ((i > 0 || at > 0)
            ? '<button class="btn line sm" type="button" data-act="prev">이전</button>' : '') +
          '<button class="btn line sm" type="button" data-act="x">그만 보기</button>' +
          '<button class="btn sm" type="button" data-act="next">' + esc(nextLabel) + '</button>' +
        '</div>' +
      '</div>';
    aim(s[0]);
  }

  /* 밝게 남길 곳으로 스크롤한 뒤 구멍과 카드를 앉힌다.
   * 스크롤이 끝나기 전에 재면 엉뚱한 자리에 구멍이 난다 · 한 박자 기다린다 */
  function aim(sel) {
    var el = pick(sel);
    layer.setAttribute('data-sel', sel || '');
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) { el.scrollIntoView(); }
    }
    place();
    window.setTimeout(place, 60);
    if (!tied) {
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      tied = true;
    }
  }

  function place() {
    if (!layer) { return; }
    var spot = document.getElementById('tspot');
    var card = document.getElementById('tcard');
    if (!spot || !card) { return; }
    var el = pick(layer.getAttribute('data-sel'));
    var r = el ? el.getBoundingClientRect() : null;
    var vw = window.innerWidth, vh = window.innerHeight;

    /* 자리가 없거나(숨은 버튼 등) 화면 밖이면 구멍을 내지 않고 가운데에 카드만 둔다 */
    if (!r || r.width < 4 || r.height < 4) {
      layer.className = 'tour-layer on full';
      spot.style.display = 'none';
      card.style.left = ''; card.style.top = '';
      return;
    }

    var pad = 8;
    var x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    var w = Math.min(vw - 8, r.width + pad * 2);
    /* 화면보다 긴 칸은 윗부분만 비춘다 · 창이 화면을 다 먹으면 어둠이 없어서 명암이 뜻을 잃는다 */
    var h = Math.min(r.height + pad * 2, Math.max(200, Math.round(vh * 0.52)));
    layer.className = 'tour-layer on';
    spot.style.display = 'block';
    spot.style.left = x + 'px';
    spot.style.top = y + 'px';
    spot.style.width = w + 'px';
    spot.style.height = h + 'px';

    /* 카드는 구멍 아래 · 자리가 없으면 위 · 그래도 없으면 옆에 붙인다 */
    var cw = card.offsetWidth || 340, ch = card.offsetHeight || 220, gap = 14;
    var cx = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
    var cy;
    if (y + h + gap + ch <= vh - 12) { cy = y + h + gap; }
    else if (y - gap - ch >= 12) { cy = y - gap - ch; }
    else {
      cy = Math.max(12, Math.min(vh - ch - 12, r.top));
      cx = (r.left > vw / 2) ? Math.max(12, x - gap - cw) : Math.min(vw - cw - 12, x + w + gap);
    }
    card.style.left = Math.round(cx) + 'px';
    card.style.top = Math.round(cy) + 'px';
  }

  // ---------------------------------------------------------------- 열기 · 배선
  function open(startAt) {
    var n = startAt === undefined ? here() : startAt;
    if (n < 0) { n = 0; }
    at = n;
    i = 0;
    if (COURSE[at].file !== file()) { go(at, 0); return; }
    save();
    if (layer) { close(false); }
    layer = document.createElement('div');
    layer.className = 'tour-layer on';
    layer.addEventListener('click', function (e) {
      var t = e.target;
      var jump = t.getAttribute && t.getAttribute('data-go');
      if (jump) { go(Number(jump), 0); return; }
      var act = t.getAttribute && t.getAttribute('data-act');
      if (!act) { return; }               // 어두운 곳을 눌러도 닫지 않는다 (실수로 닫히면 다시 못 찾는다)
      if (act === 'x') { close(); return; }
      if (act === 'prev') {
        if (i > 0) { i -= 1; save(); draw(); } else if (at > 0) { go(at - 1, 'last'); }
        return;
      }
      if (act === 'next') {
        if (i < steps.length - 1) { i += 1; save(); draw(); return; }
        if (COURSE[at + 1]) { go(at + 1, 0); return; }
        close();
      }
    });
    document.body.appendChild(layer);
    draw();
  }

  function start() {
    /* ?notour=1 이면 아무것도 하지 않는다 (사이드바 버튼으로는 열 수 있다) */
    if (/[?&]notour=1/.test(window.location.search)) { return; }

    var n = here();
    if (n < 0) { return; }
    /* 채팅 서랍이 열려 있으면 뜨지 않는다 · 겹치면 둘 다 못 읽는다 */
    var p = document.getElementById('chatpane');
    if (p && !p.hidden) { return; }

    /* 1 · 앞 화면에서 「다음 화면」 을 눌러 넘어온 경우 · 적어 둔 자리에서 이어 뜬다 */
    var saved = null;
    try { saved = JSON.parse(get(AT) || 'null'); } catch (e) { saved = null; }
    if (saved && Number(saved.at) === n) {
      open(n);
      i = Math.max(0, Number(saved.step) || 0);
      draw();
      return;
    }

    /* 2 · 로그인하고 대시보드에 들어온 순간 · 또는 처음 온 사람.
     * 대시보드에서만 스스로 뜬다 · 다른 화면에 갔다가 돌아올 때마다 뜨면 방해가 된다 */
    if (n !== 0) { return; }
    var pending = get(PEND);
    if (pending) { del(PEND); open(0); return; }
    if (!get(SEEN)) { open(0); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* 밖에서 부르는 길 · 사이드바의 「튜토리얼」 이 TOUR.open(0) 을 부른다 */
  window.TOUR = { open: open, close: close, COURSE: COURSE, STEPS: STEPS };
})();
