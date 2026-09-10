/* test_actions.js · Action Registry 검사기
 *
 *   node test_actions.js
 *
 * 무엇을 보나 ·
 *   1) tools.json 의 action 이 전부 ACTIONS 에 구현돼 있고, 구현만 있고 선언 없는 것이 없다
 *   2) 화면 이동은 표에 있는 파일로만 간다 · 실제 파일이 있다 · 입력값이 주소가 되지 않는다
 *   3) 값 검사 · 이상한 코드 · 수량 · 화면 이름을 거른다
 *   4) DB 를 바꾸는 action 은 전부 mutation 이고 확인 창 명세를 만든다 · 실행하면 3층에 줄이 생긴다
 *   5) 「이 자재」 · 코드가 없으면 문맥의 자재를 쓴다
 *   6) 실행이 실제 화면과 같은 어댑터를 쓴다 · 값이 화면과 어긋나지 않는다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
let fails = 0;
function say(s) { process.stdout.write(s + '\n'); }
function ok(cond, label) {
  say((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) { fails += 1; }
}

function env() {
  const box = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    Object, Array, JSON, Math, Number, String, Boolean, Date, Error, RegExp,
    isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, setTimeout: () => 0,
    location: { hash: '', search: '', pathname: '/stock.html', origin: 'http://localhost' },
    PAGE: 'stock'
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); },
    removeItem: (k) => { delete box[k]; }, clear() {}
  };
  sandbox.sessionStorage = sandbox.localStorage;
  sandbox.addEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  const ctx = vm.createContext(sandbox);
  ['assets/config.js', 'assets/ui.js', 'assets/db-master.js', 'assets/db-derived.js',
   'assets/db-changes.js', 'assets/db.js', 'assets/db-biz.js', 'assets/plan-data.js',
   'assets/analysis-data.js', 'assets/screen-data.js', 'assets/qr-items.js',
   'assets/catalog.js', 'assets/ask.js', 'assets/actions.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return sandbox;
}

const W = env();
const { DB, SCREEN, ASK, ACTIONS } = W;
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/tools.json'), 'utf8'));
// multi_step 은 순서를 담는 봉투다 · 서버가 펼치고 브라우저는 실행하지 않는다 (구현이 없어야 맞다)
const declared = (spec.actions || []).filter((a) => a.name !== 'multi_step').map((a) => a.name);
ok((spec.actions || []).some((a) => a.name === 'multi_step' && a.kind === 'plan'), 'multi_step 봉투 도구가 선언돼 있다 (kind=plan)');
ok(!ACTIONS.kindOf('multi_step'), 'multi_step 은 브라우저에서 실행되지 않는다 (서버가 펼친다)');

say('=== [1] 선언과 구현이 맞는가 ===');
ok(declared.length >= 12, 'tools.json 에 action 이 ' + declared.length + '개 선언돼 있다');
declared.forEach((n) => ok(!!ACTIONS.kindOf(n), '선언된 ' + n + ' 이 구현돼 있다'));
ACTIONS.names().forEach((n) => ok(declared.indexOf(n) >= 0, '구현된 ' + n + ' 이 선언돼 있다'));
(spec.actions || []).filter((a) => a.name !== 'multi_step').forEach((a) => {
  ok(a.kind === ACTIONS.kindOf(a.name), a.name + ' 의 갈래가 선언(' + a.kind + ')과 구현(' + ACTIONS.kindOf(a.name) + ')에서 같다');
  ok(a.description && a.description.length > 10, a.name + ' 에 「언제 쓰는지」 설명이 있다');
});
const askNames = ASK.tools();
ok(declared.every((n) => askNames.indexOf(n) < 0), 'action 이름이 조회 도구(ASK)와 겹치지 않는다');

say('');
say('=== [2] 화면 이동은 표에 있는 파일로만 ===');
Object.keys(ACTIONS.screens).forEach((k) => {
  const f = ACTIONS.screens[k].file;
  ok(fs.existsSync(path.join(ROOT, f)), k + ' → ' + f + ' 파일이 있다');
});
let r = ACTIONS.run('navigate', { screen: 'stock', section: 'order' });
ok(r && r.href === 'stock.html#order', '「stock · order」 → stock.html#order');
r = ACTIONS.run('navigate', { screen: '적정재고 분석', section: '감축' });
ok(r && r.href === 'stock.html#cut', '제목 · 칸 이름으로 불러도 간다 (적정재고 분석 · 감축 → stock.html#cut)');
r = ACTIONS.run('navigate', { screen: 'https://evil.example/x.html' });
ok(r && r.unknown, '주소를 화면 이름으로 넣으면 거절한다');
r = ACTIONS.run('navigate', { screen: 'evidence' });
ok(r && r.unknown, '준비 중 화면(evidence)은 표에 없어 가지 않는다');
r = ACTIONS.run('navigate', { screen: 'stock', section: '<script>alert(1)</script>' });
ok(r && !r.unknown && r.href === 'stock.html', '모르는 칸은 버리고 화면만 간다 (입력값이 주소에 들어가지 않는다)');
ok(ACTIONS.run('없는도구', {}) === null, '등록되지 않은 도구는 null (실행 없음)');

say('');
say('=== [3] 값 검사 ===');
ok(ACTIONS.code('q1000108 찾아줘') === 'Q1000108', '코드는 Q + 7자리만 뽑는다 (소문자도)');
ok(ACTIONS.code('A12345') === null, 'A12345 같은 모양은 코드가 아니다');
ok(ACTIONS.qty('10') === 10 && ACTIONS.qty(0, 1) === 1 && ACTIONS.qty(5000) === 999, '수량은 1~999 정수 · 없으면 기본값');
r = ACTIONS.run('searchMaterial', { text: 'Q9999999' });
ok(r && r.unknown, '없는 코드는 모른다고 한다');
r = ACTIONS.run('submitPurchaseRequest', { code: 'A12345', qty: 10 }, {});
ok(r && r.unknown, '코드도 문맥도 없으면 구매신청을 만들지 않고 코드를 묻는다');

say('');
say('=== [4] DB 변경은 전부 mutation · 확인 창 · 실제로 3층에 남는다 ===');
const first = DB.list()[0];
const Q = first.q;
const MUT = ['submitPurchaseRequest', 'returnMaterial', 'judgeMaterial', 'commitAttr', 'convertToPool'];
MUT.forEach((n) => ok(ACTIONS.kindOf(n) === 'mutation', n + ' 은 mutation 이다'));
['navigate', 'searchMaterial', 'openMaterialDetail', 'getInventoryStatus', 'openPurchaseRequest',
 'openReturnPage', 'runAttrAlgorithm', 'runStockAnalysis'].forEach((n) => {
  ok(ACTIONS.kindOf(n) !== 'mutation', n + ' 은 확인 없이 바로 간다 (읽기 · 이동)');
});
let spec1 = ACTIONS.confirmSpec('submitPurchaseRequest', { code: Q, qty: 3 }, {});
ok(spec1 && spec1.title && spec1.rows.length >= 2, '구매신청 확인 창에 자재 · 수량이 적힌다');
ok(ACTIONS.confirmSpec('navigate', { screen: 'stock' }) === null, '이동에는 확인 창이 없다');

const before = DB.changes();
const n0 = { pr: before.pr_drafts.length, ret: before.qr_returns.length, attr: before.attribute_overrides.length };
r = ACTIONS.run('submitPurchaseRequest', { code: Q, qty: 3 }, {});
ok(r && !r.unknown && DB.changes().pr_drafts.length === n0.pr + 1, '구매신청 초안이 pr_drafts 에 한 줄 는다');
const draft = DB.changes().pr_drafts.slice(-1)[0];
ok(draft.q === Q && JSON.parse(draft.data).data.qty === 3, '초안의 자재 · 수량이 말한 값이다 (' + Q + ' · 3)');
const stock0 = DB.item(Q).stock;
r = ACTIONS.run('returnMaterial', { code: Q, qty: 2 }, {});
ok(r && !r.unknown && DB.changes().qr_returns.length === n0.ret + 1, '반납이 qr_returns 에 한 줄 는다');
ok(DB.item(Q).stock === stock0 + 2, '정본 자재 반납은 보유 수량도 움직인다 (' + stock0 + ' → ' + DB.item(Q).stock + ')');
ok(DB.changes().qr_returns.slice(-1)[0].cond === '', '물품 상태는 비어 있다 (반납 뒤 사람이 정한다)');
/* 공용 전환은 의사(pool_actions)와 재고 이동(stock_transactions)을 같이 남긴다 ·
 * DB.txn 이 txnType 을 못 받아 조용히 오류가 나던 자리라 여기서 지킨다 */
const pool0 = { p: DB.changes().pooling_overrides.length, t: DB.changes().stock_transactions.length };
const st0 = DB.item(Q).stock;
r = ACTIONS.run('convertToPool', { code: Q }, {});
ok(r && !r.unknown, '공용 전환이 오류 없이 기록된다' + (r && r.unknown ? ' · ' + r.text : ''));
ok(DB.changes().pooling_overrides.length === pool0.p + 1, '공용 전환 의사가 3층에 한 줄 는다');
ok(DB.changes().stock_transactions.length === pool0.t + 1, '재고 거래도 한 줄 는다');
ok(DB.item(Q).stock === st0 - 1, '공용 전환은 보유를 줄인다 (' + st0 + ' → ' + DB.item(Q).stock + ')');

r = ACTIONS.run('judgeMaterial', { code: Q, type: '계획품' }, {});
ok(r && !r.unknown && DB.item(Q).judged === '계획품', '속성 판단이 attribute_overrides 에 남고 judged 로 보인다');
ok(DB.item(Q).pending, '확정 전에는 대기(pending)다 · 다른 화면은 아직 옛 속성');
r = ACTIONS.run('commitAttr', {}, {});
ok(r && !r.unknown && !DB.item(Q).pending && DB.item(Q).type === '계획품', '확정하면 type 이 바뀐다 (적정재고가 이 속성으로 계산)');
DB.reset();
ok(DB.changes().pr_drafts.length === 0, '초기화하면 지워진다 (검사 뒤 정리)');

say('');
say('=== [5] 「이 자재」 · 문맥 ===');
const ctx = { selectedCode: Q };
r = ACTIONS.run('getInventoryStatus', {}, ctx);
ok(r && !r.unknown && r.text.indexOf(Q) >= 0, '코드 없이 「이 자재」 라고 하면 문맥의 자재를 본다');
r = ACTIONS.run('openPurchaseRequest', {}, ctx);
ok(r && r.href === 'purchase.html#q=' + Q, '「이 자재 구매신청 화면 열어」 → purchase.html#q=' + Q);
r = ACTIONS.run('openReturnPage', {}, ctx);
ok(r && r.href === 'mobile-return.html#' + Q, '「이 자재 반납 화면」 → mobile-return.html#' + Q);
const ctx2 = {};
r = ACTIONS.run('searchMaterial', { text: Q.slice(0, 5) }, ctx2);
ok(r && !r.unknown && /^Q\d{7}$/.test(ctx2.selectedCode || ''), '검색하면 첫 건이 「이 자재」 가 된다 (' + ctx2.selectedCode + ')');
r = ACTIONS.run('openMaterialDetail', {}, ctx2);
ok(r && r.href === 'stock.html#q=' + ctx2.selectedCode, '그 뒤 「적정재고 화면에서 보여줘」 가 그 자재로 간다');
r = ACTIONS.run('openReturnPage', { code: 'Q4046777' }, {});
ok(r && !r.unknown && r.href === 'mobile-return.html#Q4046777', 'QR 자재(정본 밖)도 반납 화면은 열린다');

say('');
say('=== [6] 실행이 화면과 같은 값을 낸다 ===');
SCREEN.setStockStage('raw');
r = ACTIONS.run('runStockAnalysis', {}, {});
const sc = SCREEN.stockCounts();
ok(SCREEN.stockStage() === 'done', '적정재고 분석 실행 뒤 단계가 done 이다 (화면의 「분석」 버튼과 같다)');
ok(r.text.indexOf(String(sc.order)) >= 0 && r.text.indexOf(String(sc.cut)) >= 0, '답의 발주 · 감축 수가 화면 값과 같다 (' + sc.order + ' · ' + sc.cut + ')');
SCREEN.setStage('raw');
r = ACTIONS.run('runAttrAlgorithm', {}, {});
ok(SCREEN.stage() === 'algo' && r.href === 'attr.html#all', '알고리즘 실행 뒤 단계가 algo · 전체 칸으로 간다');
ok(ACTIONS.needs('runAttrAlgorithm') === 'attr', 'runAttrAlgorithm 은 attr 화면에서만 · 다른 화면이면 먼저 이동한다');
r = ACTIONS.run('getInventoryStatus', { code: Q }, {});
const d = ASK.run('material_detail', { code: Q });
ok(r.text === d.text, '재고 상태 답이 조회 도구(material_detail)와 글자까지 같다');

say('');
say('=== [7] 안전 · LLM 이 만든 것은 실행되지 않는다 ===');
const src = fs.readFileSync(path.join(ROOT, 'assets/actions.js'), 'utf8') +
  fs.readFileSync(path.join(ROOT, 'assets/chat.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'assets/voice.js'), 'utf8');
ok(!/\beval\s*\(|new Function\s*\(|innerHTML\s*=\s*[a-z]*\.(input|text)\b/.test(src), 'eval · new Function · 입력값 innerHTML 이 없다');
ok(!/location\.href\s*=\s*(p|pick|a|input)\./.test(src), '입력값이 그대로 location.href 가 되는 곳이 없다');
const server = fs.readFileSync(path.join(ROOT, 'serve.py'), 'utf8');
ok(/OPENAI_API_KEY/.test(server) && !/C\.STT_KEY|OPENAI_API_KEY.*body\.append/.test(server), 'STT 키는 서버에만 · config.local.js 로 내려가지 않는다');
ok(/re\.match\(r'\^Q\[0-9\]\{7\}\$', sel\)/.test(server), '라우터로 가는 문맥 코드는 Q+7자리만 통과한다');

say('');
say(fails ? 'actions check FAIL (' + fails + ')' : 'actions check PASS');
process.exit(fails ? 1 : 0);
