/* ui.js · 화면이 같이 쓰는 표시 함수
 *
 * 왜 이 파일이 있는가
 *   지난 리허설에서 날짜를 라벨 함수 없이 이어 붙였다가 화면에 「마감 D-null」
 *   이 그대로 출력됐다. 금액도 화면마다 만원과 억원을 섞어 써서
 *   「150,336만원」 처럼 읽을 수 없는 값이 나왔다.
 *   **라벨을 만드는 곳은 한 곳뿐이어야 한다.** 그게 이 파일이다.
 *
 * 여기에는 산식도 상수도 두지 않는다. 그건 DB.meta().spec 에서 읽는다.
 * 여기 있는 것은 「값을 사람이 읽는 글자로 바꾸는 규칙」 뿐이다.
 */
(function () {
  'use strict';

  var CFG = window.CFG || {};

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 천 단위 구분. null 은 0 이 아니라 「미확인」 이다.
   * 0 과 모르는 것을 같은 글자로 쓰면 데이터가 빈 것처럼 읽힌다 */
  function num(v, unit) {
    if (v === null || v === undefined || v === '') { return '미확인'; }
    var n = Number(v);
    if (!isFinite(n)) { return '미확인'; }
    var s = (Math.round(n * 100) / 100).toLocaleString('ko-KR');
    return unit ? s + unit : s;
  }

  /* 금액 · 1억 넘으면 억원, 아니면 만원. 절대 섞어 쓰지 않는다.
   * 「150,336만원」 은 사람이 읽을 수 없다. 「15.03억원」 으로 쓴다 */
  function won(v) {
    if (v === null || v === undefined || v === '') { return '미확인'; }
    var n = Number(v);
    if (!isFinite(n)) { return '미확인'; }
    if (n === 0) { return '0원'; }
    var abs = Math.abs(n);
    if (abs >= 1e8) { return (n / 1e8).toFixed(2).replace(/\.00$/, '') + '억원'; }
    if (abs >= 1e4) { return Math.round(n / 1e4).toLocaleString('ko-KR') + '만원'; }
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }

  /* 큰 숫자를 KPI 칸에 넣을 때. 억원 단위 한 자리까지 */
  function wonShort(v) {
    if (v === null || v === undefined) { return '미확인'; }
    var n = Number(v);
    if (!isFinite(n)) { return '미확인'; }
    if (Math.abs(n) >= 1e8) { return (n / 1e8).toFixed(1); }
    return Math.round(n / 1e4).toLocaleString('ko-KR');
  }
  function wonShortUnit(v) {
    var n = Number(v);
    return (isFinite(n) && Math.abs(n) >= 1e8) ? '억원' : '만원';
  }

  /* 날짜. 값이 없으면 「미확인」 이다. 절대 문자열을 그냥 이어 붙이지 않는다 */
  function date(v) {
    if (!v) { return '미확인'; }
    var s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
  }

  /* 짧은 날짜 · 9.6 처럼. 카드 오른쪽 좁은 칸에 쓴다 */
  function dateShort(v) {
    if (!v) { return '미확인'; }
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (!m) { return String(v); }
    return Number(m[2]) + '.' + Number(m[3]);
  }

  /* 남은 일수 라벨.
   *
   * **null 을 먼저 거른다.** 자바스크립트에서 null < 3 은 참이라
   * 마감일이 없는 건(자재 확보)이 「지금 신청」 으로 세어졌다. 4건이 6건이 됐다.
   * 그래서 이 함수가 유일한 출구다. left 를 직접 이어 붙이지 않는다 */
  function dleft(left) {
    if (left === null || left === undefined) { return '자재 확보'; }
    var n = Number(left);
    if (!isFinite(n)) { return '자재 확보'; }
    if (n < 0) { return '초과 ' + Math.abs(n).toLocaleString('ko-KR') + '일'; }
    if (n === 0) { return '오늘 마감'; }
    return 'D-' + n;
  }

  /* 건강도 표정. left 가 null 이면 fine 이다 (마감일이 없으니 급할 것이 없다) */
  function tone(left) {
    if (left === null || left === undefined) { return 'fine'; }
    var n = Number(left);
    if (!isFinite(n)) { return 'fine'; }
    var t = (CFG.DUE_TONE || { fine: 7, soon: 3 });
    if (n >= t.fine) { return 'fine'; }
    if (n >= t.soon) { return 'soon'; }
    return 'over';
  }

  /* 「지금 신청해야 하는가」 는 이 함수만으로 판단한다.
   * 비교 연산자를 화면에 흩뿌리면 null 이 다시 섞여 들어온다 */
  function isNow(left) { return tone(left) === 'over' && left !== null && left !== undefined; }

  /* 표정 SVG 를 직접 그린다. 색만으로 구분하지 않는다.
   * 색약인 사람도 표정으로 알 수 있어야 한다 */
  function face(t) {
    var col = { fine: 'var(--ok)', soon: 'var(--core)', over: 'var(--insur)' }[t] || 'var(--muted)';
    var mouth = {
      fine: 'M9 18 Q15 23 21 18',      // 웃음
      soon: 'M10 19 H20',              // 무표정
      over: 'M9 21 Q15 16 21 21'       // 찡그림
    }[t] || 'M10 19 H20';
    var label = { fine: '여유', soon: '준비', over: '지금 신청' }[t] || '';
    return '<svg class="face" viewBox="0 0 30 30" role="img" aria-label="' + esc(label) + '">' +
      '<circle cx="15" cy="15" r="13" fill="none" stroke="' + col + '" stroke-width="2"/>' +
      '<circle cx="10.5" cy="12" r="1.6" fill="' + col + '"/>' +
      '<circle cx="19.5" cy="12" r="1.6" fill="' + col + '"/>' +
      '<path d="' + mouth + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>';
  }

  /* 판정 표시 이름. 「회색지대」 는 화면에서만 「현행유지」 로 순화한다.
   * 내부 값은 그대로 둔다. 「일치 확인」 이 아니라 「판단 보류」 라는 뜻이므로
   * 신뢰도와 근거를 함께 내야 한다 */
  function verdict(v) {
    if (!v) { return '미확인'; }
    return (CFG.LABEL && CFG.LABEL[v]) || v;
  }

  function typeBadge(t) {
    if (!t) { return '<span class="badge">미확인</span>'; }
    var cls = t === '보험품' ? 'insur' : (t === '계획품' ? 'plan' : '');
    return '<span class="badge ' + cls + '">' + esc(t) + '</span>';
  }

  function verdictBadge(v) {
    if (!v) { return '<span class="badge">미확인</span>'; }
    var cls = v === '보험품' ? 'insur' : (v === '계획품' ? 'plan' : (v === '회색지대' ? 'core' : ''));
    return '<span class="badge ' + cls + '">' + esc(verdict(v)) + '</span>';
  }

  function gradeBadge(g) {
    if (!g) { return ''; }
    var cls = (g === 'S' || g === 'A') ? 'core' : '';
    return '<span class="badge ' + cls + '">' + esc(g) + '등급</span>';
  }

  /* 발주 신호. gray 는 「재고 불요」 라는 뜻이지 데이터가 빈 것이 아니다 */
  function signalBadge(sig, status) {
    var map = {
      red: ['insur', '즉시발주'], yellow: ['core', '발주임박'],
      green: ['ok', '여유'], gray: ['', '재고 불요']
    };
    var m = map[sig] || ['', '미확인'];
    return '<span class="badge ' + m[0] + '">' + esc(status || m[1]) + '</span>';
  }

  /* 속성이 어디서 왔는지. AI 가 정한 것과 사람이 정한 것이 구분되지 않으면
   * 신뢰가 무너진다. 그래서 값 아래에 반드시 출처를 적는다 */
  function srcLabel(src) {
    return { override: '담당자 승인', algorithm: '알고리즘 판정', master: '원본' }[src] || '미확인';
  }

  /* 비율. 분모가 0 이면 계산하지 않는다 (NaN% 가 화면에 나온다) */
  function pct(a, b, digits) {
    var n = Number(a), d = Number(b);
    if (!isFinite(n) || !isFinite(d) || d === 0) { return '미확인'; }
    return (n / d * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  /* 좁은 화면에서 긴 목록을 전부 그리면 문서 높이가 19만 px 이 된다 (실측).
   * 처음 N장만 그리고 「더 보기」 를 둔다 */
  function pager(rows, shown) {
    var cap = CFG.CARD_PAGE || 20;
    var narrow = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    var limit = narrow ? (shown || cap) : rows.length;
    return { rows: rows.slice(0, limit), rest: Math.max(0, rows.length - limit), limit: limit };
  }

  /* 접히는 영역 하나. 화면마다 따로 쓰면 「화살표만 돌고 내용은 그대로」 가 반복된다.
   * 위임으로 붙인다 · 안의 내용을 다시 그려도 다시 붙일 필요가 없다.
   * 머리 안의 링크와 버튼은 접기를 건드리지 않는다.
   * 머리를 <button> 으로 만들지 않은 이유 · 안에 「열기」 링크가 들어가는데
   * 버튼 안의 링크는 규격 위반이고 키보드로 링크에 닿지 못한다 */
  function accordion(scope) {
    var root = scope || document;

    function toggle(head, force) {
      var sect = head.parentNode;
      var on = force === undefined ? !sect.classList.contains('open') : !!force;
      sect.classList.toggle('open', on);
      head.setAttribute('aria-expanded', on ? 'true' : 'false');
      var ar = head.querySelector('.sect-arrow');
      if (ar) { ar.textContent = on ? '∧' : '∨'; }
      return on;
    }

    root.addEventListener('click', function (e) {
      var head = e.target.closest && e.target.closest('.sect-head');
      if (!head) { return; }
      if (e.target.closest('a, .btn, .askbtn, .linkq, input, select')) { return; }
      toggle(head);
    });

    /* 마우스만 되는 접기는 키보드 사용자에게 잠긴 문이다 */
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') { return; }
      var head = e.target.closest && e.target.closest('.sect-head');
      if (!head || head !== e.target) { return; }
      e.preventDefault();
      toggle(head);
    });

    return toggle;
  }

  window.UI = {
    esc: esc, num: num, won: won, wonShort: wonShort, wonShortUnit: wonShortUnit,
    date: date, dateShort: dateShort, dleft: dleft, tone: tone, isNow: isNow,
    face: face, verdict: verdict, typeBadge: typeBadge, verdictBadge: verdictBadge,
    gradeBadge: gradeBadge, signalBadge: signalBadge, srcLabel: srcLabel,
    pct: pct, pager: pager, accordion: accordion
  };
})();
