/* 대장이 없을 때(FALLBACK) 트렌드가 어떻게 나오는지 본다.
 * 화면은 DB 가 없어도 떠야 하고, 그때 값은 반드시 「시연용」 으로 표시돼야 한다. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = 'C:/Users/user/Desktop/26 포스코 해커톤 본선';

function run(withDb) {
  /* window 를 전역 객체 자체로 둔다.
   * 브라우저에서는 window.DB 가 곧 전역 DB 라서 코드가 맨몸 DB 로 쓴다.
   * window 를 따로 만들면 그 코드가 여기서만 ReferenceError 를 낸다 */
  const box = {};
  const sandbox = { console,
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    Object, Array, JSON, Math, Number, String, Boolean, Date, Error, RegExp, isNaN, parseInt, parseFloat };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); }, removeItem: (k) => { delete box[k]; }, clear: () => {}
  };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  const win = sandbox;
  const ctx = vm.createContext(sandbox);
  const files = withDb
    ? ['config.js', 'ui.js', 'db-master.js', 'db-derived.js', 'db-changes.js', 'db.js', 'analysis-data.js']
    : ['config.js', 'ui.js', 'analysis-data.js'];
  files.forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8'), ctx, { filename: f });
  });
  return win.ANALYSIS;
}

let bad = 0;
function ok(cond, msg) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) { bad += 1; }
}

console.log('--- 대장 있을 때 ---');
const A = run(true);
const t = A.trend(13);
ok(t.src === 'derived', 'src=derived · 원천에서 만든 값이다 (' + t.src + ')');
ok(t.months.length === 13, '13개월 (' + t.months.length + ')');
ok(t.dept.length === 13 && t.all.length === 13, '선 두 개가 같은 길이');
ok(t.dept.every((v, i) => i === 0 || v >= t.dept[i - 1]), '부서 선이 뒤로 안 간다 (입고 누적)');
ok(t.dir === 'up', '방향 up -> 빨간 선 (' + t.dir + ')');
ok(t.pct > 150 && t.pct < 200, '증감 +' + t.pct.toFixed(1) + '%');
ok(t.max === Math.max.apply(null, t.all), 'y 최댓값은 전사 선의 마지막');
ok(t.missing === 39, '입고일 없는 39품목을 곡선에서 뺐다 (' + t.missing + ')');
ok(t.missingAmt > 0, '뺀 금액을 적어 둔다 ' + t.missingAmt);
ok(t.months[0] === '2025-09' && t.months[12] === '2026-09',
   '기준일에서 12개월 뒤로 (' + t.months[0] + ' ~ ' + t.months[12] + ')');

console.log('--- 대장 없을 때 ---');
const B = run(false);
const d = B.trend(13);
ok(B.live === false, 'live=false');
ok(d.src === 'demo', 'src=demo · 화면이 「시연용 값」 배지를 띄운다 (' + d.src + ')');
ok(d.months.length === 13 && d.dept.length === 13, '길이는 같다');
ok(d.dir === 'up', '방향이 나온다 (' + d.dir + ')');
ok(d.dept.every((v) => v > 0), '0 이 없다 · 빈 차트가 안 뜬다');
ok(d.missing === 0, '시연용에는 「빠진 품목」 을 적지 않는다');

console.log(bad ? ('trend check FAIL problems=' + bad) : 'trend check PASS');
process.exit(bad ? 1 : 0);
