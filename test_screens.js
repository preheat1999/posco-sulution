/* 화면 여덞 개를 브라우저 없이 훑는다.
 * 스크립트가 뜨는지 · 그려지는지 · 화면에 undefined 가 나오는지를 본다.
 * 브라우저 창은 한 번에 한 화면만 보므로, 회귀는 이 스크립트가 잡는다. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = 'C:/Users/user/Desktop/26 포스코 해커톤 본선';
const PAGES = ['main', 'attr', 'stock', 'plan', 'pool', 'purchase', 'return',
               'mobile-return', 'material-view', 'login'];

let bad = 0;
function ok(cond, msg) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) { bad += 1; }
}

/* 아주 작은 DOM 흉내. innerHTML 을 문자열로 받아 두고 나중에 검사한다.
 * 진짜 렌더링은 브라우저에서 따로 본다 · 여기서는 「스크립트가 끝까지 도는가」 를 본다 */
function makeDoc() {
  const store = {};
  function mkEl(id) {
    const e = {
      id: id, _html: '', _text: '', className: '', hidden: false,
      children: [], attributes: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      set innerHTML(v) { this._html = String(v); },
      get innerHTML() { return this._html; },
      set textContent(v) { this._text = String(v); },
      get textContent() { return this._text; },
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { this.children.push(c); return c; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      closest() { return null; }, focus() {}, scrollIntoView() {},
      getBoundingClientRect() { return { width: 400, height: 200, top: 0, left: 0 }; }
    };
    return e;
  }
  const doc = {
    readyState: 'complete',
    body: mkEl('body'),
    documentElement: mkEl('html'),
    getElementById(id) {
      if (!store[id]) { store[id] = mkEl(id); }
      return store[id];
    },
    querySelector(sel) {
      if (sel === '.crumb') { return store.__crumb || (store.__crumb = mkEl('crumb')); }
      if (sel === '.avatar') { return store.__av || (store.__av = mkEl('avatar')); }
      return null;
    },
    querySelectorAll() { return []; },
    createElement(t) { return mkEl(t); },
    addEventListener() {}, removeEventListener() {},
    _store: store
  };
  return doc;
}

function run(page, preset, loc) {
  const html = fs.readFileSync(path.join(ROOT, page + '.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  const box = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    Object, Array, JSON, Math, Number, String, Boolean, Date, Error, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, setTimeout: () => 0
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = makeDoc();
  sandbox.location = {
    hash: (loc && loc.hash) || '', search: (loc && loc.search) || '',
    href: '', replace() {}
  };
  sandbox.sessionStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {}
  };
  Object.assign(box, preset || {});   // 화면이 읽을 저장소 값을 미리 넣는다 (단계 등)
  sandbox.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); },
    removeItem: (k) => { delete box[k]; }, clear() {}
  };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  sandbox.matchMedia = () => ({ matches: false });
  const ctx = vm.createContext(sandbox);

  srcs.forEach((s) => {
    const f = path.join(ROOT, s.split('?')[0]);
    if (!fs.existsSync(f)) { throw new Error('없는 스크립트: ' + s); }
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: s });
  });
  inline.forEach((code, i) => {
    vm.runInContext(code, ctx, { filename: page + '.html inline#' + (i + 1) });
  });
  return sandbox;
}

/* 그려진 innerHTML · textContent 를 다 모은다 */
function seenOf(s) {
  const store = s.document._store;
  let all = '';
  Object.keys(store).forEach((k) => { all += store[k]._html + ' ' + store[k]._text + ' '; });
  return all;
}

console.log('=== 화면별 · 스크립트가 끝까지 도는가 ===');
const seen = {};
const sb = {};
PAGES.forEach((p) => {
  let s = null, err = null;
  try {
    var deep = { attr: '#gray', stock: '#order' }[p] || '';
    s = run(p, deep ? { 'mtrl.stage.v1': 'algo', 'mtrl.stage.v1.stock': 'done' } : null,
            deep ? { hash: deep } : null);
  } catch (e) { err = e; }
  ok(!err, p + '.html 오류 없이 실행' + (err ? ' · ' + err.message : ''));
  if (!s) { return; }

  /* 그려진 innerHTML 을 다 모아서 나쁜 글자를 찾는다 */
  const all = seenOf(s);
  seen[p] = all;
  sb[p] = s;

  ok(!/undefined/.test(all), p + ' · undefined 없음');
  ok(!/NaN/.test(all), p + ' · NaN 없음');
  ok(!/D-null|초과 null|null일/.test(all), p + ' · null 날짜 없음');
  /* 긴 줄표 · 순수 검정. 패턴을 쪼개 두지 않으면 이 검사기 파일 자신이 표기 검사에 걸린다 */
  ok(!new RegExp('\u2014|\u2013').test(all), p + ' · 긴 줄표 없음');
  ok(!new RegExp('#' + '000' + '\\b').test(all), p + ' · 순수 검정 없음');
});

/* 실행 전 화면 · 결과 숫자가 새면 안 되고 실행 버튼이 있어야 한다 */
[['attr', '알고리즘 실행', /점수차 \d/, '점수차'],
 ['stock', '적정재고 분석', /목표재고 산식/, '목표재고 산식']].forEach(([p, cta, leak, leakName]) => {
  let raw = null, err = null;
  try { raw = run(p); } catch (e) { err = e; }
  ok(!err, p + '(실행 전) 오류 없이 실행' + (err ? ' · ' + err.message : ''));
  if (!raw) { return; }
  let all = '';
  const st = raw.document._store;
  Object.keys(st).forEach((k) => { all += st[k]._html + ' ' + st[k]._text + ' '; });
  ok(all.indexOf(cta) >= 0, p + '(실행 전) · 「' + cta + '」 버튼이 있다');
  ok(!leak.test(all), p + '(실행 전) · ' + leakName + ' 가 새지 않는다');
  ok(!/undefined|NaN/.test(all), p + '(실행 전) · undefined · NaN 없음');
});

/* QR 진입 화면 · 세 갈래를 다 그려 본다 */
[['', '자재코드가 없습니다', 'code 없음'],
 ['?code=Q123', '형식이 아닙니다', '잘못된 형식'],
 ['?code=Q9999999', '등록되지 않은', '없는 코드'],
 ['?code=Q4046777', 'Bolt-Nut', '등록된 코드']].forEach(([search, want, label]) => {
  let r = null, err = null;
  try { r = run('material-view', null, { search }); } catch (e) { err = e; }
  ok(!err, 'material-view(' + label + ') 오류 없이 실행' + (err ? ' · ' + err.message : ''));
  if (!r) { return; }
  let all = '';
  const st = r.document._store;
  Object.keys(st).forEach((k) => { all += st[k]._html + ' ' + st[k]._text + ' '; });
  ok(all.indexOf(want) >= 0, 'material-view(' + label + ') · 「' + want + '」 를 적는다');
  ok(!/undefined|NaN/.test(all), 'material-view(' + label + ') · undefined · NaN 없음');
});

/* 모바일 반납 · QR 코드로 들어오면 목록을 건너뛰고 그 자재부터 본다 */
{
  let r = null, err = null;
  try { r = run('mobile-return', null, { search: '?code=Q4046777' }); } catch (e) { err = e; }
  ok(!err, 'mobile-return(QR) 오류 없이 실행' + (err ? ' · ' + err.message : ''));
  if (r) {
    const st = r.document._store;
    ok((st.pick ? st.pick._html : '') === '', 'mobile-return(QR) · 자재 고르기 단계를 건너뛴다');
    const panel = st.panel ? st.panel._html : '';
    ok(panel.indexOf('Bolt-Nut') >= 0, 'mobile-return(QR) · 그 자재부터 시작한다');
    ok(panel.indexOf('KUX12DQ') >= 0, 'mobile-return(QR) · 다른 부서 자재임을 적는다');
  }
}

console.log('');
console.log('=== 실제 값이 실렸는가 ===');
ok(/743/.test(seen.main || ''), 'main · 743품목');
ok(/49\.7|4,974/.test(seen.main || ''), 'main · 보유 재고 49.7억원');
/* 정본 보유목적 기준의 값이다 · 사람이 확정하면 여기서 움직인다 */
ok(/3,680만원/.test(seen.main || ''), 'main · 금융비용 3,680만원');
/* attr 의 칸은 149 · 90 · 31 로 나뉜다. 239 는 그 둘을 합친 대시보드 값이다 */
ok(/149/.test(seen.attr || '') && /90/.test(seen.attr || '') && /31/.test(seen.attr || ''),
   'attr · 칸 숫자 149 · 90 · 31');
ok(/270/.test(seen.attr || ''), 'attr · 손대야 하는 270품목');
/* 히트맵은 핵심예비품만 본다 · 목표재고 산식은 화면에서 뺐다(요청).
 * 그래서 Z 계수 대신 「핵심예비품 25품목」 과 과부족 방향이 실렸는지를 본다 */
ok(/핵심예비품/.test(seen.stock || ''), 'stock · 히트맵이 핵심예비품을 본다');
ok(/부족/.test(seen.stock || '') && /초과/.test(seen.stock || ''),
   'stock · 과부족 방향이 적혀 있다');
ok(!/2\.33/.test(seen.stock || ''), 'stock · Stitch 목업의 2.33 이 안 들어갔다');
ok(/156/.test(seen.plan || ''), 'plan · 정비계획 156건');
/* 구매신청 초안은 자재를 눌러야 열린다(기본 접힘) · 그래서 목록만 있는 화면에는
 * 작업주문 번호가 없다. 적정재고 · 적정구매시점에서 자재를 들고 넘어온 길(#q=코드)로 본다 */
ok(!/K10665396/.test(seen.purchase || ''), 'purchase · 초안은 접혀 있다 (누르기 전)');
const prQ = (() => {
  try { return sb.purchase.SCREEN.prList()[0].q; } catch (e) { return null; }
})();
let prSeen = '';
if (prQ) {
  try { prSeen = seenOf(run('purchase', null, { hash: '#q=' + prQ })); } catch (e) { prSeen = ''; }
}
ok(/K10665396/.test(prSeen), 'purchase · 초안을 열면 실제 작업주문 번호가 있다 (' + prQ + ')');
ok(!/undefined|NaN/.test(prSeen), 'purchase · 열린 초안에 undefined · NaN 없음');
/* 물품 상태는 반납받은 자재를 검사하고 사람이 정한다 · 반납 전 목록에는 나오지 않는다.
 * 그래서 「반납 뒤 결정」 이 적혀 있는지, 상태 이름이 미리 새지 않는지를 본다 */
ok(/반납 뒤 결정/.test(seen['return'] || ''), 'return · 반납 전에는 상태를 적지 않는다');
ok(!/Consignment/.test(seen['return'] || ''), 'return · 상태 이름이 미리 새지 않는다');
ok(/반납 대기|반납 완료/.test(seen['return'] || ''), 'return · 칸이 반납 여부로 나뉜다');

console.log('');
console.log('=== 지어낸 값이 섞였는가 (Stitch 목업 잔재) ===');
const fake = ['98.4', 'V3.8', 'v2.4', 'REV 4.2', 'POS-SYS', '94.2%', 'B8102941', 'S9903120',
  'C3019842', 'ERP SYNC', 'V4.2 ACTIVE', '184일'];
Object.keys(seen).forEach((p) => {
  fake.forEach((f) => {
    if (seen[p].indexOf(f) >= 0) { ok(false, p + ' 에 지어낸 값 「' + f + '」 이 남았다'); }
  });
});
ok(true, '지어낸 값 검사 끝');

console.log('');
console.log(bad ? ('check_all FAIL problems=' + bad) : 'check_all PASS');
process.exit(bad ? 1 : 0);
