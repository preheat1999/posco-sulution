/* nav.js · 사이드바
 *
 * 이 파일 하나가 사이드바를 그린다.
 * 각 페이지는 <head> 에 window.PAGE = 'main' 처럼 자기 키만 두고
 * <aside class="side" id="side"> 를 비워 둔다.
 * 사이드바 HTML 을 페이지마다 복사하면 메뉴 하나 바꾸는 데 13곳을 고치게 된다.
 *
 * 메뉴 구성은 와이어프레임 00_공통셸 을 따르되 「자재 검색」 을 관리에 같이 둔다.
 * 와이어프레임은 관리에 「데이터 근거」, 디자인 스펙은 「자재 검색」 을 적어 두어
 * 어느 한쪽만 따르면 화면 하나가 메뉴에서 사라진다.
 *
 * org.js 보다 뒤에 실행돼야 한다. 내 이름과 소속을 org 에서 읽는다.
 */
(function () {
  'use strict';

  var MENU = [
    {
      label: '관리',
      items: [
        { key: 'main', name: 'Dashboard', href: 'main.html', ico: '▤' },
        { key: 'search', name: '자재 검색', href: 'search.html', ico: '⌕', soon: true },
        { key: 'evidence', name: '데이터 근거', href: 'evidence.html', ico: '◈', soon: true }
      ]
    },
    {
      label: '분석',
      items: [
        { key: 'attr', name: '속성값 판단', href: 'attr.html', ico: '◐', count: 'gray' },
        { key: 'stock', name: '적정재고 분석', href: 'stock.html', ico: '▦', count: 'order' },
        { key: 'report', name: '주간 리포트', href: 'report.html', ico: '✉', soon: true }
      ]
    },
    {
      label: '업무',
      items: [
        /* 적정구매시점은 「언제 사야 하는가」 라서 분석이 아니라 업무다 ·
         * 구매신청 바로 위에 둔다 */
        { key: 'plan', name: '적정구매시점', href: 'plan.html', ico: '⚙', count: 'over' },
        { key: 'purchase', name: '구매신청 (PR)', href: 'purchase.html', ico: '🛒', count: 'pr' },
        { key: 'return', name: '자재반납 (QR)', href: 'return.html', ico: '↩', count: 'ret' }
      ]
    }
  ];

  /* 배지 숫자는 「해야 할 건수」 다. DB 가 없으면 배지를 안 그린다.
   * 숫자를 여기 적어 두면 데이터가 바뀔 때 사이드바만 옛 값으로 남는다 */
  function counts() {
    var out = {};
    if (!window.DB) { return out; }
    try {
      var s = window.DB.summary();
      /* 승인하면 줄어드는 값을 써야 한다.
       * bucket['현행유지'] 는 판정 기준이라 승인해도 안 줄고, 배지만 옛 값으로 남는다 */
      out.gray = s.holdOpen === undefined ? (s.bucket['현행유지'] || 0) : s.holdOpen;
      out.order = s.action['발주'] || 0;             // 발주 필요
      /* 적정구매시점 화면이 보는 것과 같은 수를 쓴다 · 화면은 한 달치(기준일+30일)만
       * 본다. 반출 전체 156건의 마감 초과(55)를 배지에 쓰면 화면과 어긋난다 */
      if (window.SCREEN && window.SCREEN.planCounts) {
        var pc = window.SCREEN.planCounts();
        out.over = (pc.over || 0) + (pc.soon || 0);
      } else if (window.PLAN && window.PLAN.meta) {
        out.over = window.PLAN.meta.counts.tone.over || 0;
      }
      if (window.DB_BIZ) {
        out.pr = (window.DB_BIZ.purchase || []).length;
        out.ret = (window.DB_BIZ.returns || []).length;
      }
    } catch (e) {
      // 요약을 못 내도 사이드바는 떠야 한다
    }
    return out;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function draw() {
    var side = document.getElementById('side');
    if (!side) { return; }

    var me = window.ORG ? window.ORG.load() : null;
    var n = counts();
    var page = window.PAGE || '';
    var html = '';

    html += '<div class="side-logo">' +
      '<div class="side-logo-mark">자</div>' +
      '<div class="side-logo-text">AI 자재<small>솔루션</small></div>' +
      '</div>';

    MENU.forEach(function (g) {
      html += '<div class="navgroup"><div class="navgroup-label">' + esc(g.label) + '</div>';
      g.items.forEach(function (it) {
        var c = it.count ? n[it.count] : null;
        /* 아직 만들지 않은 화면은 링크로 두지 않는다.
         * 누르면 404 가 뜨는 메뉴는 시연에서 제일 나쁜 것이다.
         * 「준비 중」 이라고 적어 두고 화면이 생기면 soon 만 지운다 */
        if (it.soon) {
          html += '<span class="navitem soon" aria-disabled="true">' +
            '<span class="navitem-ico" aria-hidden="true">' + it.ico + '</span>' +
            '<span class="navitem-body">' +
              '<span class="navitem-name">' + esc(it.name) + '</span>' +
              '<span class="navitem-sub">준비 중</span>' +
            '</span></span>';
          return;
        }
        html += '<a class="navitem' + (it.key === page ? ' on' : '') + '" href="' + esc(it.href) + '">' +
          '<span class="navitem-ico" aria-hidden="true">' + it.ico + '</span>' +
          '<span class="navitem-body">' +
            '<span class="navitem-name">' + esc(it.name) + '</span>' +
            (it.sub ? '<span class="navitem-sub">' + esc(it.sub) + '</span>' : '') +
          '</span>' +
          (c ? '<span class="navcount">' + c + '</span>' : '') +
          '</a>';
      });
      html += '</div>';
    });

    html += '<div class="side-foot">' +
      '<div class="side-me-name">' + esc(me ? me.name + ' ' + me.rank : '담당자') + '</div>' +
      '<div class="side-me-dept">' + esc(me ? me.section : '') + '</div>' +
      '<div class="side-links">' +
        /* 튜토리얼은 언제든 다시 볼 수 있어야 한다 · 처음(대시보드)부터 다시 돈다 */
        '<button class="btn line sm" type="button" id="navtour">튜토리얼</button>' +
        '<a class="btn line sm" href="login.html">소속 변경</a>' +
        '<button class="btn line sm" type="button" id="navreset">시연 초기화</button>' +
        /* 로그아웃은 세션만 지운다. 판단 · 확정 · 반납 이력(3층)은 남는다 ·
         * 다음 사람이 로그인하면 그 일이 이어져 있어야 한다 */
        '<button class="btn line sm" type="button" id="navout">로그아웃</button>' +
      '</div></div>';

    side.innerHTML = html;

    var tour = document.getElementById('navtour');
    if (tour) {
      tour.addEventListener('click', function () {
        /* 이 화면에 tour.js 가 없으면(폰 화면) 대시보드로 보내고 거기서 뜨게 한다 */
        if (window.TOUR) { TOUR.open(0); return; }
        try { window.localStorage.setItem('mtrl.tour.pending', '1'); } catch (e) { /* 무시 */ }
        window.location.href = 'main.html';
      });
    }

    var reset = document.getElementById('navreset');
    if (reset) {
      reset.addEventListener('click', function () {
        /* 3층만 비운다. 1층 · 2층은 손대지 않는다.
         * 시연 중에 앞 사람이 승인해 둔 것을 되돌릴 때 쓴다 */
        if (!window.DB) { return; }
        if (window.confirm('승인 · 반납 이력을 모두 지우고 처음 상태로 돌립니다. 계속할까요?')) {
          window.DB.reset();
          /* 단계도 처음으로. 승인이 없는데 「실행함」 상태만 남으면 어색하다 */
          try {
            var sk = (window.CFG || {}).STAGE_KEY || 'mtrl.stage.v1';
            [sk, sk + '.at', sk + '.stock', sk + '.stock.at'].forEach(function (k) {
              window.localStorage.removeItem(k);
            });
          } catch (e) { /* 저장소가 막힌 환경 · 무시 */ }
          window.location.reload();
        }
      });
    }

    var out = document.getElementById('navout');
    if (out) {
      out.addEventListener('click', function () {
        var go = function () {
          try {
            window.localStorage.removeItem((window.CFG || {}).SESSION_KEY || 'mtrl.session.v1');
          } catch (e) { /* 저장소가 막힌 환경 · 무시 */ }
          window.location.href = 'login.html';
        };
        if (window.UI && UI.confirm) {
          UI.confirm({
            title: '로그아웃할까요?',
            body: '로그인 화면으로 돌아갑니다.',
            rows: [['지우는 것', '로그인 세션 (소속 · 담당자)'],
                   ['남는 것', '속성 판단 · 확정 · 반납 · 초안 이력']],
            note: '이력까지 지우려면 「시연 초기화」 를 쓰세요.',
            ok: '로그아웃', onOk: go
          });
          return;
        }
        go();
      });
    }
  }

  /* 햄버거. .overlay 가 없으면 동작하지 않는다 */
  /* 접힌 상태를 기억한다. 화면을 옮길 때마다 다시 접게 만들면 안 된다 */
  var FOLD_KEY = 'mtrl.side.folded';
  function foldRead() {
    try { return window.localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { return false; }
  }
  function foldWrite(on) {
    try { window.localStorage.setItem(FOLD_KEY, on ? '1' : '0'); } catch (e) { /* 무시 */ }
  }

  function wire() {
    var side = document.getElementById('side');
    var hamb = document.getElementById('hamb');
    var over = document.getElementById('overlay');
    var layout = side && side.parentNode;
    if (!side || !hamb || !over || !layout) { return; }

    /* 넓은 화면에서는 접기(폭 0), 좁은 화면에서는 오버레이.
     * 같은 단추가 두 가지 일을 하는데, 그 경계는 CSS 의 960 과 같아야 한다 */
    function narrow() {
      try { return window.matchMedia('(max-width: 960px)').matches; }
      catch (e) { return false; }
    }
    function overlay(on) {
      side.classList.toggle('on', on);
      over.classList.toggle('on', on);
      hamb.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    function fold(on) {
      layout.classList.toggle('folded', on);
      hamb.setAttribute('aria-expanded', on ? 'false' : 'true');
      hamb.setAttribute('aria-label', on ? '메뉴 펼치기' : '메뉴 접기');
      foldWrite(on);
    }

    if (foldRead()) { layout.classList.add('folded'); }
    hamb.setAttribute('aria-label', foldRead() ? '메뉴 펼치기' : '메뉴 접기');

    hamb.addEventListener('click', function () {
      if (narrow()) { overlay(!side.classList.contains('on')); return; }
      fold(!layout.classList.contains('folded'));
    });
    over.addEventListener('click', function () { overlay(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') { return; }
      if (side.classList.contains('on')) { overlay(false); }
    });
  }

  function crumb() {
    /* 빵조각은 부문 · 파트 · 섹션 · 화면그룹 형태다.
     * 로그인에서 고른 소속이 들어간다 */
    var el = document.querySelector('.crumb');
    if (!el || !window.ORG) { return; }
    var me = window.ORG.load();
    var group = el.getAttribute('data-group') || '';
    el.textContent = me.path + (group ? ' · ' + group : '');
  }

  function avatar() {
    var el = document.querySelector('.avatar');
    if (!el || !window.ORG) { return; }
    var me = window.ORG.load();
    if (me.name) {
      el.textContent = me.name.slice(0, 1);
      el.setAttribute('title', me.name + ' ' + me.rank + ' · ' + me.role);
    }
  }

  function start() {
    draw();
    wire();
    crumb();
    avatar();
    /* 승인 · 반납이 일어나면 배지 숫자가 따라 움직여야 한다.
     * 안 그러면 사이드바만 옛 값으로 남는다 */
    if (window.DB) { window.DB.on(function () { draw(); wire(); }); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.NAV = { draw: draw, MENU: MENU };
})();
