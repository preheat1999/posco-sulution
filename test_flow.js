/* test_flow.js · 화면 사이로 데이터가 제대로 흐르는가.
 *
 * 이 검사기가 지키는 것 세 가지 ·
 *   1) 판단만 하면 어떤 화면의 숫자도 움직이지 않는다 (확정 게이트)
 *   2) 확정하면 목표재고 · 조치 · 신호 · 금액이 **엔진이 그 속성으로 낸 값** 으로 바뀐다
 *   3) 같은 뜻의 숫자는 화면마다 같다 (적정재고 · 대시보드 · 적정구매시점 · 공용 전환)
 *
 * 화면을 열지 않고 어댑터(DB · SCREEN · ANALYSIS)만 돌려 본다.
 * 화면은 어댑터가 준 값을 그리기만 하므로, 여기서 맞으면 화면에서도 맞다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const OUT = [];
let bad = 0;

function say(s) { OUT.push(s === undefined ? '' : String(s)); console.log(s === undefined ? '' : s); }
function ok(cond, label) {
  if (!cond) { bad += 1; }
  say((cond ? 'PASS  ' : 'FAIL  ') + label);
  return cond;
}

/* localStorage 가 없으니 메모리로 흉내 낸다 */
function makeEnv() {
  const box = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    Object, Array, JSON, Math, Number, String, Boolean, Date, Error, RegExp,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, setTimeout: () => 0
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); },
    removeItem: (k) => { delete box[k]; }, clear() { Object.keys(box).forEach((k) => delete box[k]); }
  };
  sandbox.addEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  const ctx = vm.createContext(sandbox);
  ['assets/config.js', 'assets/ui.js', 'assets/db-master.js', 'assets/db-derived.js',
   'assets/db-changes.js', 'assets/db.js', 'assets/db-biz.js', 'assets/plan-data.js',
   'assets/analysis-data.js', 'assets/screen-data.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return sandbox;
}

const W = makeEnv();
const { DB, SCREEN: S, ANALYSIS: A, UI } = W;

/* 화면들이 보여 주는 값을 한 자리에 모은다. 이 묶음이 같으면 화면도 같다 */
function snap() {
  const s = DB.summary();
  const sc = S.stockCounts();
  const pc = S.planCounts();
  const pool = S.poolCounts();
  const heat = S.stockHeat();
  return {
    ins: s.type['보험품'], pln: s.type['계획품'],
    order: s.action['발주'], keep: s.action['유지'], cut: s.action['감축'],
    red: s.signal.red || 0,
    tgtAmt: s.tgtAmt, cutAmt: s.cutAmt, finance: s.finance, poolAmt: s.poolAmt,
    zeroTarget: s.zeroTarget, staleN: s.staleN, recalcN: s.recalcN,
    scOrder: sc.order, scCut: sc.cut, scKeep: sc.keep,
    planNow: pc.now, planOrderAmt: pc.orderAmt,
    poolGet: pool.get, poolGetAmt: pool.getAmt,
    heatShort: heat.shortN, heatOver: heat.overN,
    dashCut: A.money ? A.money().cutAmt : null
  };
}

say('=== [1] 시작 상태 · 확정이 없으면 반출 값 그대로 ===');
const base = snap();
say('    ' + JSON.stringify({ ins: base.ins, pln: base.pln, order: base.order,
  cut: base.cut, staleN: base.staleN }));
ok(base.staleN === 0, '확정이 없으니 목표를 다시 잡은 행이 0 이다');
ok(DB.commitInfo().done === 0 && DB.commitInfo().waiting === 0, '확정 · 대기가 모두 0 이다');

/* 바꿀 자재 두 건 · 보험품 → 계획품, 계획품 → 보험품 */
const insRow = DB.list().filter((r) => r.type === '보험품' && r.targetPln !== r.target)[0];
const plnRow = DB.list().filter((r) => r.type === '계획품' && r.targetIns !== r.target)[0];
ok(!!insRow && !!plnRow, '양쪽 방향으로 시험할 자재를 찾았다 · ' +
   (insRow && insRow.q) + ' · ' + (plnRow && plnRow.q));

say('');
say('=== [2] 판단만 한다 · 다른 화면은 움직이지 않아야 한다 ===');
DB.approveAttr({ q: insRow.q, dept: insRow.dept, newType: '계획품', reason: '흐름 시험' });
DB.approveAttr({ q: plnRow.q, dept: plnRow.dept, newType: '보험품', reason: '흐름 시험' });
const mid = snap();
const midKeys = Object.keys(base).filter((k) => base[k] !== mid[k]);
ok(midKeys.length === 0, '판단만 했을 때 바뀐 값이 없다' +
   (midKeys.length ? ' · 바뀐 것 ' + midKeys.join(',') : ''));
ok(DB.commitInfo().waiting === 2, '확정 대기가 2건이다');
ok(DB.item(insRow.q, insRow.dept).judged === '계획품', '판단은 남아 있다');
ok(DB.item(insRow.q, insRow.dept).type === '보험품', '확정 전이라 type 은 그대로다');

say('');
say('=== [3] 확정한다 · 엔진이 그 속성으로 낸 목표로 바뀌어야 한다 ===');
const info = DB.commitAttr();
ok(info.seq > 0 && !!info.at, '확정 지점이 찍혔다 · seq ' + info.seq + ' · ' + info.at);

const a1 = DB.item(insRow.q, insRow.dept);
ok(a1.type === '계획품' && a1.committed, '보험품 → 계획품 확정이 반영됐다');
ok(a1.targetNow === a1.targetPln,
   '목표가 엔진의 계획품 값이다 · ' + a1.target + ' → ' + a1.targetNow +
   ' (구운 값 ' + a1.targetPln + ')');
ok(a1.reasonNow === a1.reasonPln, '근거도 계획품 근거다 · ' + a1.reasonNow);
ok(a1.needNow === Math.max(0, a1.targetNow - a1.stock), '부족분이 새 목표로 다시 계산됐다');
ok(a1.actionNow === (a1.stock < a1.targetNow ? '발주'
  : (a1.stock === a1.targetNow ? '유지' : '감축')), '조치도 새 목표 기준이다 · ' + a1.actionNow);

const a2 = DB.item(plnRow.q, plnRow.dept);
ok(a2.type === '보험품' && a2.targetNow === a2.targetIns,
   '계획품 → 보험품도 엔진 값이다 · ' + a2.target + ' → ' + a2.targetNow);
ok(String(a2.reasonNow).indexOf('보험') >= 0,
   '보험품 산식 근거가 붙었다 · ' + a2.reasonNow);

const after = snap();
ok(after.staleN === 2, '목표를 다시 잡은 행이 2 다');
ok(after.recalcN === 0, '엔진 재계산 대기가 없다 (양속성 목표를 구워 뒀다)');
ok(after.tgtAmt !== base.tgtAmt || after.cutAmt !== base.cutAmt,
   '목표재고 금액 · 감축 금액이 움직였다');

say('');
say('=== [4] 같은 뜻의 숫자가 화면마다 같은가 ===');
ok(after.order === after.scOrder && after.cut === after.scCut && after.keep === after.scKeep,
   '요약의 조치 수 = 적정재고 표의 칸 수 · 발주 ' + after.order +
   ' 유지 ' + after.keep + ' 감축 ' + after.cut);
ok(after.order + after.keep + after.cut === DB.list().length,
   '조치 세 칸의 합이 743 이다 · ' + (after.order + after.keep + after.cut));
ok(after.poolGetAmt === after.poolAmt,
   '공용 전환 화면의 회수액 = 요약의 회수액 · ' + UI.won(after.poolAmt));
ok(after.dashCut === after.cutAmt,
   '대시보드 감축액 = 요약 감축액 · ' + UI.won(after.cutAmt));
ok(after.heatShort + after.heatOver <= 25 && after.heatShort + after.heatOver > 0,
   '히트맵 상자가 25개 이내다 · 부족 ' + after.heatShort + ' 초과 ' + after.heatOver);
const zeroNow = DB.list().filter((r) => (Number(r.targetNow) || 0) === 0).length;
ok(after.zeroTarget === zeroNow, '목표 0 품목 수가 지금 목표 기준이다 · ' + zeroNow);

say('');
say('=== [5] 되돌리기 · 초기화하면 처음 값으로 돌아온다 ===');
const n = DB.clearAttr();
ok(n === 2, '판단 2건을 지웠다');
const back = snap();
const diff = Object.keys(base).filter((k) => base[k] !== back[k]);
ok(diff.length === 0, '초기화하면 시작 상태와 완전히 같다' +
   (diff.length ? ' · 다른 것 ' + diff.join(',') : ''));
ok(DB.commitInfo().done === 0, '확정 지점도 지워졌다');

say('');
say('=== [6] 판단 → 확정을 여러 건 · 요약이 규칙대로 움직이는가 ===');
const many = DB.list().filter((r) => r.type === '보험품' && !r.ceq).slice(0, 20);
many.forEach((r) => DB.approveAttr({ q: r.q, dept: r.dept, newType: '계획품', reason: '일괄' }));
ok(DB.commitInfo().waiting === 20, '20건이 확정 대기다');
const beforeMany = snap();
ok(beforeMany.pln === base.pln, '확정 전이라 계획품 수가 그대로다 · ' + beforeMany.pln);
DB.commitAttr();
const afterMany = snap();
ok(afterMany.pln === base.pln + 20 && afterMany.ins === base.ins - 20,
   '확정 뒤 속성 수가 20건 옮겨졌다 · 보험품 ' + afterMany.ins + ' 계획품 ' + afterMany.pln);
/* 20건 모두 계획품 목표를 쓰는지 본다.
 * staleN 으로 세면 안 된다 · 06 의 목표가 이미 계획품으로 계산돼 있던 행은
 * 확정해도 목표가 그대로라 「다시 잡은 행」 에 들지 않는다 (값은 맞다) */
const usePln = many.every((r) => {
  const x = DB.item(r.q, r.dept);
  return Number(x.targetNow) === Number(x.targetPln);
});
ok(usePln, '20건 모두 계획품 목표를 쓴다 · 그중 다시 잡은 행 ' + afterMany.staleN);
/* 목표는 엔진이 구운 계획품 값이어야 한다.
 * 「비핵심설비면 0」 은 정본 ceq 로 판단할 수 없다 · 엔진은 equipment_map 으로 핵심설비를
 * 다시 보고, 정본 ceq 와 어긋나는 행이 11건 있다 (db/FLOW_CHECK.md 에 적었다).
 * 그래서 화면은 정본 ceq 로 0 을 만들지 않고 엔진이 낸 값을 쓴다 */
const wrong = many.filter((r) => {
  const a = DB.item(r.q, r.dept);
  return a.targetNow !== a.targetPln;
});
ok(wrong.length === 0, '20건 모두 엔진의 계획품 목표를 쓴다' +
   (wrong.length ? ' · 어긋난 행 ' + wrong.map((x) => x.q).join(',') : ''));
const zeroed = many.filter((r) => DB.item(r.q, r.dept).targetNow === 0).length;
ok(zeroed >= 18, '그 가운데 ' + zeroed + '건은 목표 0 이다 (계획품 무재고 원칙)');
ok(afterMany.cutAmt > base.cutAmt, '감축 금액이 늘었다 · ' +
   UI.won(base.cutAmt) + ' → ' + UI.won(afterMany.cutAmt));
DB.clearAttr();

say('');
say(bad ? ('flow check FAIL problems=' + bad) : 'flow check PASS');
fs.writeFileSync(path.join(ROOT, 'db', 'FLOW_CHECK.txt'), OUT.join('\n') + '\n', 'utf8');
process.exit(bad ? 1 : 0);
