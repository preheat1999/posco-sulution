/* qr-items.js
 *
 * 현장 자재식별표에 붙는 QR 로 들어오는 자재.
 *
 * 왜 따로 두나 ·
 *   1층 정본(743품목)은 반출 데이터라 손대지 않는다. 그런데 자재식별표는 우리 부서
 *   자재만 붙어 있는 것이 아니다 · 아래 Q4046777 은 재고부서가 KUX12DQ
 *   (광양 압연설비1부 열연정비1섹션 1열연RM전기파트) 이고 정본에 없는 코드다.
 *   그래서 정본에 억지로 끼우지 않고 「QR 로 들어온 자재」 표를 따로 둔다.
 *
 * 키는 자재코드 하나다 (PK · Q + 숫자 7자리). 여러 건을 등록해도 구조가 그대로다.
 * 값은 자재식별표에 인쇄된 항목만 담는다 · 없는 칸을 만들지 않는다.
 *
 * QR 이 여는 주소 · <배포된 사이트 주소>/mobile-return.html?code=Q4046777
 *   (자재 확인 화면을 거치게 하려면 material-view.html?code=... 로 만든다)
 * 도메인은 코드에 박지 않는다 · 화면은 실행 중인 주소(location.origin)를 읽어서 적는다.
 */
window.QR_ITEMS = {
  Q4046777: {
    code: 'Q4046777',
    unit: 'set',
    name: 'Bolt-Nut',
    spec: 'M8, P1.25x12Sx29L',
    wh: 'QFC01',
    qty: 5,
    price: 4135,
    recvDate: '2025-11-27',
    deptCode: 'KUX12DQ',
    deptPath: '광양 압연설비1부 열연정비1섹션 1열연RM전기파트',
    owner: '김헤정',
    tel: '061-790-1111',
    /* 이 값이 어디서 왔는지 화면이 그대로 적는다 */
    source: '자재식별표 QR'
  }
};

/* 코드 하나로 자재를 찾는 창구. 화면은 여기만 부른다 */
window.QRDB = (function () {
  'use strict';

  /* 자재코드 규칙 · Q + 숫자 7자리. 이 형식이 아니면 조회하지 않는다 */
  var FORM = /^Q\d{7}$/;

  function norm(code) {
    return String(code === undefined || code === null ? '' : code).trim().toUpperCase();
  }

  function valid(code) { return FORM.test(norm(code)); }

  /* QR 표 → 정본 순서로 찾는다.
   * 정본에 있는 코드로 QR 을 찍어도 그 자재가 나와야 한다 (743품목도 식별표가 있다) */
  function get(code) {
    var c = norm(code);
    if (!valid(c)) { return null; }
    var r = window.QR_ITEMS[c];
    if (r) {
      var out = {};
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
      out.inMaster = false;
      return out;
    }
    if (!window.DB || !window.DB.item) { return null; }
    var m = null;
    try { m = window.DB.item(c); } catch (e) { m = null; }
    if (!m) { return null; }
    /* 정본 자재를 식별표 모양으로 맞춰 준다 · 없는 칸은 비워 두고 화면이 「미확인」 을 적는다 */
    return {
      code: m.q, unit: (window.SCREEN && SCREEN.unitOfQ) ? SCREEN.unitOfQ(m.q) : 'EA',
      name: m.name, spec: m.group || '', wh: m.wh, qty: m.stock, price: m.price,
      recvDate: m.recvDate, deptCode: m.dept, deptPath: m.deptPath,
      owner: null, tel: null, source: '정본 자재 대장', inMaster: true, row: m
    };
  }

  /* 이 자재의 QR 주소. 배포된 곳이 어디든 실행 중인 주소를 그대로 쓴다 ·
   * 사내 서버로 옮겨도 화면에 적히는 주소가 맞는다 */
  function url(code, abs, page) {
    var c = norm(code);
    var path = (page || 'mobile-return.html') +
      '?code=' + encodeURIComponent(c || 'Q0000000');
    if (!abs) { return path; }
    try {
      var base = window.location.href.replace(/[^/]*$/, '');
      return base + path;
    } catch (e) { return path; }
  }

  function has(code) { return !!get(code); }
  function all() {
    return Object.keys(window.QR_ITEMS).map(function (k) { return window.QR_ITEMS[k]; });
  }

  return { FORM: FORM, valid: valid, norm: norm, get: get, has: has, all: all, url: url };
})();
