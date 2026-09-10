/* db-changes.js · 3층 오버라이드 저장소
 *
 * 원본을 절대 덮지 않는다. 화면에서 한 일을 변경 이력으로만 쌓고,
 * 읽는 쪽이 「오버라이드가 있으면 그걸 우선, 없으면 원본」 으로 겹쳐 본다.
 *
 * 그래야
 *   원래 값과 누가 언제 왜 바꿨는지를 역추적할 수 있다
 *   되돌리기가 이력 한 줄 삭제다
 *   알고리즘 계산 코드를 손댈 필요가 없다
 *
 * 저장소는 localStorage 하나다. 서버가 없다.
 */
(function () {
  'use strict';

  var CFG = window.CFG || {};
  var KEY = CFG.STORE_KEY || 'mtrl.db.v1';
  var EVENT = 'mtrl:db-change';

  /* 선언한 컬럼만 통과시킨다.
   * 화면이 실수로 넣은 필드가 섞이면 나중에 무엇이 진짜 스키마인지 모르게 된다.
   * seq 는 여기 없다. 화면이 만들지 않고 저장소가 붙인다 */
  var COLS = {
    attribute_overrides: ['q', 'dept', 'newType', 'approvedBy', 'approvedAt',
                          'priorVerdict', 'reason'],
    stock_transactions: ['q', 'dept', 'txnType', 'qty', 'txnAt', 'processedBy', 'note'],
    pooling_overrides: ['q', 'dept', 'action', 'by', 'at', 'note'],
    pr_drafts: ['q', 'dept', 'data', 'by', 'at'],
    /* 현장 QR 반납 접수 · 정본(우리 부서 743) 밖 자재도 들어온다.
     * 그래서 stock_transactions 와 섞지 않는다 · 부서 재고를 움직이면 안 되는 값이다 */
    qr_returns: ['code', 'dept', 'qty', 'unit', 'cond', 'by', 'at', 'note']
  };

  var listeners = [];

  /* localStorage 가 없거나 막힌 환경(사생활 보호 창 · 파일 접근 제한)이 있다.
   * 그때 화면이 멈추면 안 되므로 메모리에 담고 계속 돌린다.
   * 새로고침하면 사라지지만 시연은 안 깨진다 */
  var memory = null;
  var usingMemory = false;

  function store() {
    if (usingMemory) { return memory; }
    try {
      var raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      usingMemory = true;
      memory = memory || blank();
      return memory;
    }
  }

  function save(db) {
    if (usingMemory) { memory = db; return; }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      // 용량 초과나 접근 거부. 여기서 던지면 승인 버튼이 죽는다
      usingMemory = true;
      memory = db;
    }
  }

  function blank() {
    var db = { seq: 0 };
    for (var t in COLS) {
      if (Object.prototype.hasOwnProperty.call(COLS, t)) { db[t] = []; }
    }
    return db;
  }

  /* 저장해 둔 뒤에 테이블이 늘어났을 수 있다. 없는 테이블은 빈 배열로 채운다 */
  function normalize(db) {
    if (!db || typeof db !== 'object') { return blank(); }
    if (typeof db.seq !== 'number') { db.seq = 0; }
    for (var t in COLS) {
      if (!Object.prototype.hasOwnProperty.call(COLS, t)) { continue; }
      if (!Array.isArray(db[t])) { db[t] = []; }
    }
    return db;
  }

  function pick(table, row) {
    var out = {}, cols = COLS[table], i, k;
    for (i = 0; i < cols.length; i++) {
      k = cols[i];
      if (row[k] !== undefined) { out[k] = row[k]; }
    }
    return out;
  }

  function fire(detail) {
    var i;
    for (i = 0; i < listeners.length; i++) {
      try { listeners[i](detail); } catch (e) { /* 한 화면의 오류가 나머지를 막지 않게 */ }
    }
    try {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: detail }));
    } catch (e) {
      // 아주 오래된 브라우저. 구독자에게는 이미 알렸다
    }
  }

  var API = {
    KEY: KEY,
    EVENT: EVENT,
    TABLES: Object.keys(COLS),
    COLS: COLS,

    all: function () {
      return normalize(store() || blank());
    },

    rows: function (table) {
      if (!COLS[table]) { throw new Error('없는 테이블 · ' + table); }
      return this.all()[table].slice();
    },

    add: function (table, row) {
      if (!COLS[table]) { throw new Error('없는 테이블 · ' + table); }
      var db = this.all();
      var rec = pick(table, row || {});
      db.seq += 1;
      rec.seq = db.seq;          // 순번은 저장소가 붙인다
      db[table].push(rec);
      save(db);
      fire({ table: table, op: 'add', row: rec });
      return rec;
    },

    remove: function (table, seq) {
      if (!COLS[table]) { throw new Error('없는 테이블 · ' + table); }
      var db = this.all(), before = db[table].length;
      db[table] = db[table].filter(function (r) { return r.seq !== seq; });
      if (db[table].length === before) { return false; }
      save(db);
      fire({ table: table, op: 'remove', seq: seq });
      return true;
    },

    clear: function (table) {
      if (!COLS[table]) { throw new Error('없는 테이블 · ' + table); }
      var db = this.all();
      db[table] = [];
      save(db);
      fire({ table: table, op: 'clear' });
    },

    /* 시연 초기화. 3층만 비운다. 1층 · 2층은 손대지 않는다 */
    reset: function () {
      var db = blank();
      save(db);
      fire({ table: null, op: 'reset' });
    },

    /* 표는 안 바뀌었지만 화면은 다시 그려야 할 때 (담당자 확정처럼) */
    emit: function (detail) { fire(detail || { table: null, op: 'notify' }); },

    /* 지금 메모리로 돌고 있는가. 화면이 「저장되지 않는다」 고 알릴 때 쓴다 */
    isMemoryOnly: function () { return usingMemory; },

    on: function (fn) { if (typeof fn === 'function') { listeners.push(fn); } },
    off: function (fn) {
      listeners = listeners.filter(function (f) { return f !== fn; });
    }
  };

  /* 다른 탭에서 바꾼 것도 받는다. 폰과 노트북을 같이 띄워 시연할 때 필요하다 */
  try {
    window.addEventListener('storage', function (e) {
      if (e.key === KEY) { fire({ table: null, op: 'external' }); }
    });
  } catch (e) { /* 이벤트를 못 붙이는 환경이면 한 탭에서만 도는 것으로 둔다 */ }

  window.DB_CHANGES = API;
})();
