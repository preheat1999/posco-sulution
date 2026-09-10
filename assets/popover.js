/* popover.js · 근거 팝오버
 *
 * AI 가 정한 값 옆에는 ? 버튼을 둔다. 누르면 산식 · 점수 · 원본값이 나온다.
 * 근거를 숨기지 않는 것이 이 서비스의 핵심이라 모든 판정에 붙인다.
 *
 * 산식 문장을 여기에 적지 않는다. 화면이 DB.meta().spec 에서 읽어 넘긴다.
 * 여기 적어 두면 명세가 바뀔 때 팝오버만 옛 값으로 남는다.
 */
(function () {
  'use strict';

  var box = null;
  var anchor = null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hide() {
    if (box && box.parentNode) { box.parentNode.removeChild(box); }
    box = null;
    anchor = null;
  }

  /* opt = { title, rows: [[라벨, 값], ...], formula, note } */
  function show(el, opt) {
    hide();
    if (!el || !opt) { return; }
    opt.rows = opt.rows || [];

    box = document.createElement('div');
    box.className = 'pop';
    box.setAttribute('role', 'dialog');

    var html = '';
    if (opt.title) { html += '<div class="pop-head">' + esc(opt.title) + '</div>'; }
    opt.rows.forEach(function (r) {
      html += '<div class="pop-row"><span class="pop-k">' + esc(r[0]) +
              '</span><span class="pop-v">' + esc(r[1]) + '</span></div>';
    });
    if (opt.formula) { html += '<div class="pop-formula">' + esc(opt.formula) + '</div>'; }
    if (opt.note) { html += '<div class="note" style="margin-top:8px">' + esc(opt.note) + '</div>'; }
    box.innerHTML = html;
    document.body.appendChild(box);

    anchor = el;
    place();
  }

  /* 화면 밖으로 나가지 않게 가둔다. 표 오른쪽 끝의 ? 를 누르면 쉽게 넘친다 */
  function place() {
    if (!box || !anchor) { return; }
    var r = anchor.getBoundingClientRect();
    var w = box.offsetWidth, h = box.offsetHeight;
    var sx = window.pageXOffset, sy = window.pageYOffset;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    var left = r.left + sx - w / 2 + r.width / 2;
    left = Math.max(sx + 10, Math.min(left, sx + vw - w - 10));

    var top = r.bottom + sy + 8;
    if (r.bottom + h + 12 > vh) { top = r.top + sy - h - 8; }   // 아래가 좁으면 위로
    if (top < sy + 8) { top = sy + 8; }

    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (box && (t === box || box.contains(t))) { return; }
    if (t && t.closest && t.closest('.askbtn')) { return; }   // 열기는 각 화면이 한다
    hide();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hide(); }
  });

  window.addEventListener('resize', place);
  /* 스크롤하면 앵커가 움직인다. 따라다니게 하지 않고 닫는다.
   * 긴 표에서 팝오버가 허공에 떠 있는 것보다 낫다 */
  window.addEventListener('scroll', hide, true);

  window.POP = { show: show, hide: hide };
})();
