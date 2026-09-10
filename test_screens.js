/* 화면 여덞 개를 브라우저 없이 훑는다.
 * 스크립트가 뜨는지 · 그려지는지 · 화면에 undefined 가 나오는지를 본다.
 * 브라우저 창은 한 번에 한 화면만 보므로, 회귀는 이 스크립트가 잡는다. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = 'C:/Users/user/Desktop/26 포스코 해커톤 본선';
const PAGES = ['main', 'attr', 'stock', 'plan', 'purchase', 'return', 'mobile-return', 'login'];

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
  sandbox.location = { hash: (loc && loc.hash) || '', href: '', replace() {} };
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

console.log('=== 화면별 · 스크립트가 끝까지 도는가 ===');
const seen = {};
PAGES.forEach((p) => {
  let s = null, err = null;
  try {
    s = run(p, p === 'attr' ? { 'mtrl.stage.v1': 'algo' } : null,
            p === 'attr' ? { hash: '#gray' } : null);
  } catch (e) { err = e; }
  ok(!err, p + '.html 오류 없이 실행' + (err ? ' · ' + err.message : ''));
  if (!s) { return; }

  /* 그려진 innerHTML 을 다 모아서 나쁜 글자를 찾는다 */
  const store = s.document._store;
  let all = '';
  Object.keys(store).forEach((k) => { all += store[k]._html + ' ' + store[k]._text + ' '; });
  seen[p] = all;

  ok(!/undefined/.test(all), p + ' · undefined 없음');
  ok(!/NaN/.test(all), p + ' · NaN 없음');
  ok(!/D-null|초과 null|null일/.test(all), p + ' · null 날짜 없음');
  /* 긴 줄표 · 순수 검정. 패턴을 쪼개 두지 않으면 이 검사기 파일 자신이 표기 검사에 걸린다 */
  ok(!new RegExp('\u2014|\u2013').test(all), p + ' · 긴 줄표 없음');
  ok(!new RegExp('#' + '000' + '\\b').test(all), p + ' · 순수 검정 없음');
});

/* attr 의 원본 단계 · 알고리즘 숫자가 새면 안 되고 실행 버튼이 있어야 한다 */
{
  let raw = null, err = null;
  try { raw = run('attr'); } catch (e) { err = e; }
  ok(!err, 'attr(원본 단계) 오류 없이 실행' + (err ? ' · ' + err.message : ''));
  if (raw) {
    let all = '';
    const st = raw.document._store;
    Object.keys(st).forEach((k) => { all += st[k]._html + ' ' + st[k]._text + ' '; });
    ok(/알고리즘 실행/.test(all), 'attr(원본) · 실행 버튼이 있다');
    ok(!/점수차 \d/.test(all), 'attr(원본) · 점수차가 새지 않는다');
    ok(!/undefined|NaN/.test(all), 'attr(원본) · undefined · NaN 없음');
  }
}

console.log('');
console.log('=== 실제 값이 실렸는가 ===');
ok(/743/.test(seen.main || ''), 'main · 743품목');
ok(/49\.7|4,974/.test(seen.main || ''), 'main · 보유 재고 49.7억원');
ok(/3,604만원/.test(seen.main || ''), 'main · 금융비용 3,604만원');
/* attr 의 칸은 149 · 90 · 31 로 나뉜다. 239 는 그 둘을 합친 대시보드 값이다 */
ok(/149/.test(seen.attr || '') && /90/.test(seen.attr || '') && /31/.test(seen.attr || ''),
   'attr · 칸 숫자 149 · 90 · 31');
ok(/270/.test(seen.attr || ''), 'attr · 손대야 하는 270품목');
ok(/2\.58/.test(seen.stock || ''), 'stock · Z 계수 2.58 (명세 값)');
ok(!/2\.33/.test(seen.stock || ''), 'stock · Stitch 목업의 2.33 이 안 들어갔다');
ok(/156/.test(seen.plan || ''), 'plan · 정비계획 156건');
ok(/K10665396/.test(seen.purchase || ''), 'purchase · 실제 작업주문 번호');
ok(/Consignment|신품/.test(seen['return'] || ''), 'return · 실제 물품 상태');

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
