/* test_ask.js · 챗봇이 우리 데이터로 답한 값이 화면 숫자와 같은가.
 *
 * 이 검사기가 지키는 것 ·
 *   1) 도구의 답이 화면 어댑터 값과 **같은 숫자**다 (챗봇만 다른 값을 말하면 안 된다)
 *   2) 카탈로그(assets/catalog.js)가 코드와 어긋나지 않는다
 *      · 적어 둔 필드가 실제 DB 행에 있고, 화면 키가 실제 html 파일이다
 *   3) 값이 바뀌면 답도 바뀐다 (확정 전 · 후로 같은 질문을 다시 물어본다)
 *   4) 모르는 것은 모른다고 한다 (없는 자재코드 · 없는 용어)
 *   5) 규칙 매치(ASK.fast)가 자재코드와 자주 묻는 말을 제대로 잡는다
 *
 * 라우터(LLM)는 여기서 부르지 않는다 · 도구를 고르는 일과 답하는 일은 따로다.
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

function env() {
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
    removeItem: (k) => { delete box[k]; }, clear() {}
  };
  sandbox.addEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  const ctx = vm.createContext(sandbox);
  ['assets/config.js', 'assets/ui.js', 'assets/db-master.js', 'assets/db-derived.js',
   'assets/db-changes.js', 'assets/db.js', 'assets/db-biz.js', 'assets/plan-data.js',
   'assets/analysis-data.js', 'assets/screen-data.js', 'assets/qr-items.js',
   'assets/catalog.js', 'assets/ask.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return sandbox;
}

const W = env();
const { DB, SCREEN, ASK, CATALOG, UI, ANALYSIS } = W;

/* 답 안의 숫자만 뽑는다 · 「1,200품목」 → 1200 */
function nums(r) {
  const txt = (r.text || '') + ' ' +
    (r.table ? r.table.rows.map((x) => x.join(' ')).join(' ') : '') + ' ' +
    (r.evidence || []).map((p) => p[1]).join(' ');
  return (txt.match(/[\d,]+(?:\.\d+)?/g) || []).map((s) => Number(s.replace(/,/g, '')));
}
function has(r, n) { return nums(r).indexOf(n) >= 0; }

say('=== [1] 도구 답이 화면 숫자와 같은가 ===');
const sum = DB.summary();
const sc = SCREEN.stockCounts();

const order = ASK.run('count_action', { action: '발주' });
ok(!order.unknown && has(order, sc.order),
   '발주 필요 · 챗봇 = 적정재고 표 ' + sc.order + '품목');
const cut = ASK.run('count_action', { action: '감축' });
ok(has(cut, sc.cut), '감축 대상 · ' + sc.cut + '품목');

const cutAmt = ASK.run('money_summary', { kind: 'cut' });
ok(cutAmt.text.indexOf(UI.won(sum.cutAmt)) >= 0,
   '감축 금액 · 요약과 같은 ' + UI.won(sum.cutAmt));
const fin = ASK.run('money_summary', { kind: 'finance' });
ok(fin.text.indexOf(UI.won(sum.finance)) >= 0, '금융비용 절감 · ' + UI.won(sum.finance));
ok((fin.evidence || []).some((p) => String(p[1]).indexOf(String(sum.financeRate)) >= 0),
   '금융비용 근거에 명세 상수(기여율 ' + sum.financeRate + ')를 적는다');

const attr = ASK.run('attr_status', {});
const ac = SCREEN.attrCounts();
ok(has(attr, ac.all) && has(attr, ac.excluded),
   '속성 판단 · 손댈 것 ' + ac.all + ' · 제외대상 ' + ac.excluded);
ok(ac.all + ac.excluded === 743, '손댈 것 + 제외대상 = 743');

const plan = ASK.run('plan_status', {});
const pc = SCREEN.planCounts();
ok(has(plan, pc.wos) && has(plan, pc.over + pc.soon),
   '적정구매시점 · 이 달 ' + pc.wos + '건 · 마감 ' + (pc.over + pc.soon) + '건');

const pool = ASK.run('pool_status', {});
const poc = SCREEN.poolCounts();
ok(has(pool, poc.all) && pool.text.indexOf(UI.won(poc.getAmt)) >= 0,
   '공용 전환 · 정체 ' + poc.all + '품목 · 회수 ' + UI.won(poc.getAmt));
ok(poc.getAmt === sum.poolAmt, '공용 전환 회수액 = 요약 회수액 (화면끼리도 같다)');

const ret = ASK.run('return_status', {});
ok(has(ret, SCREEN.retList('all').length), '반납 · 대상 ' + SCREEN.retList('all').length + '건');

say('');
say('=== [2] 자재 한 건 · 순위 표 ===');
const one = DB.list()[0];
const det = ASK.run('material_detail', { code: one.q });
ok(!det.unknown && det.text.indexOf(one.q) >= 0, '자재 한 건 · ' + one.q);
ok(has(det, one.targetNow) && has(det, one.stock),
   '목표 ' + one.targetNow + ' · 보유 ' + one.stock + ' 을 그대로 적는다');
ok((det.evidence || []).some((p) => String(p[1]).indexOf(String(one.targetIns)) >= 0),
   '속성별 목표(보험품 ' + one.targetIns + ' · 계획품 ' + one.targetPln + ')를 근거에 적는다');
ok(det.table && det.table.rows.length >= 6, '자재 한 건은 표로 준다');

const top = ASK.run('top_materials', { by: 'cut', limit: 5 });
ok(top.table && top.table.rows.length === 5, '순위 표 5행');
const first = DB.list().filter((r) => r.stock > r.targetNow)
  .sort((a, b) => ((b.stock - b.targetNow) * b.price) - ((a.stock - a.targetNow) * a.price))[0];
ok(top.table.rows[0][0].indexOf(first.q) >= 0,
   '감축 금액 1위가 실제 1위와 같다 · ' + first.q);
ok(ASK.run('top_materials', { by: 'cut', limit: 99 }).table.rows.length <= 10,
   '표는 10행을 넘기지 않는다');

say('');
say('=== [3] 서비스 설명 · 카탈로그가 코드와 맞는가 ===');
const row = DB.item(one.q);
const terms = CATALOG.terms();
const badField = terms.filter((t) => t.field && !(t.field in row));
ok(badField.length === 0, '사전의 모든 필드가 실제 DB 행에 있다' +
   (badField.length ? ' · 없는 것 ' + badField.map((t) => t.field).join(',') : ''));

const screens = CATALOG.screens();
const badFile = Object.keys(screens)
  .filter((k) => !fs.existsSync(path.join(ROOT, screens[k].file)));
ok(badFile.length === 0, '사전의 모든 화면이 실제 파일이다' +
   (badFile.length ? ' · 없는 것 ' + badFile.join(',') : ''));

const badWhere = terms.filter((t) => !screens[t.where]);
ok(badWhere.length === 0, '사전의 화면 키가 모두 유효하다');

const st = ASK.run('explain_term', { term: 'stale' });
ok(!st.unknown && st.kind === 'about' && st.text.indexOf('stale') >= 0, 'stale 뜻을 답한다');
ok((st.evidence || []).some((p) => p[0] === '지금 값'),
   '뜻만 말하지 않고 지금 값도 같이 적는다');
const heat = ASK.run('explain_screen', { screen: 'stock', topic: '히트맵 상자 크기' });
ok(!heat.unknown && heat.text.indexOf('과부족 금액') >= 0, '히트맵 상자 크기를 설명한다');
const src = ASK.run('data_source', { topic: '목표재고' });
ok(!src.unknown && src.text.indexOf('06') >= 0, '목표재고 출처를 답한다');
ok(src.text.indexOf('2층') >= 0, '어느 층에서 왔는지 적는다');

say('');
say('=== [4] 모르는 것은 모른다고 하는가 ===');
ok(ASK.run('material_detail', { code: 'Q9999999' }).unknown, '없는 자재코드');
ok(ASK.run('material_detail', { code: '자재' }).unknown, '자재코드 형식이 아니면 거절');
ok(ASK.run('explain_term', { term: '회식 장소' }).unknown, '사전에 없는 말');
ok(ASK.run('count_action', { action: '폐기' }).unknown, '없는 조치');
ok(ASK.run('money_summary', { kind: 'xxx' }).unknown, '없는 금액 종류');
ok(ASK.run('nope', {}) === null, '없는 도구는 null');

say('');
say('=== [5] 규칙 매치 (LLM 없이 잡는 질문) ===');
const F = [
  ['Q1000108 목표재고 알려줘', 'material_detail'],
  ['지금 발주 필요 몇 품목이야', 'count_action'],
  ['감축 금액 얼마야', 'money_summary'],
  ['금융비용 절감 얼마', 'money_summary'],
  ['회색지대 몇 품목이야', 'attr_status'],
  ['기준일 언제야', 'data_source'],
  // 아래 셋은 시연 중에 문서 · 합계로 새어 나갔던 문장이다
  ['오늘 할 일에는 뭐가 있어', 'today_tasks'],
  ['대시보드 데이터들에 대해 설명해줘', 'explain_screen'],
  ['감축 금액 큰 자재 5개 알려줘', 'top_materials']
];
F.forEach(([q, want]) => {
  const hit = ASK.fast(q);
  ok(hit && hit.tool === want, '「' + q + '」 → ' + want + (hit ? '' : ' (못 잡음)'));
});
ok(ASK.fast('자재 반납 절차 알려줘') === null, '문서 질문은 규칙이 잡지 않는다');
ok(ASK.fast('회식 장소 추천') === null, '엉뚱한 질문도 잡지 않는다');

// 순위 질문은 합계가 아니라 표로 · 개수도 문장에서 읽는다
const rk = ASK.fast('감축 금액 큰 자재 5개 알려줘');
ok(rk && rk.input.by === 'cut' && rk.input.limit === 5, '순위 질문에서 기준과 개수를 읽는다');
ok(ASK.fast('감축 금액 얼마야').tool === 'money_summary', '순위 규칙이 합계 질문을 먹지 않는다');

// 화면 이름은 제목 · 파일명 어느 쪽으로 불러도 찾는다 (LLM 이 「대시보드」 로 넘긴다)
['main', '대시보드', 'main.html'].forEach((w) => {
  const r = ASK.run('explain_screen', { screen: w });
  ok(r && !r.unknown && r.text.indexOf('대시보드') >= 0, '화면 이름 「' + w + '」 를 찾는다');
});
ok(ASK.run('explain_screen', { screen: '없는화면' }).unknown, '없는 화면은 모른다고 한다');

// 오늘 할 일은 어댑터가 센 값이어야 한다 (챗봇이 따로 세면 화면과 어긋난다)
const td = ASK.run('today_tasks', {});
const tdRows = ANALYSIS.todo().filter((r) => r.n > 0);
ok(td && !td.unknown && td.table.rows.length === tdRows.length,
  '오늘 할 일 줄 수가 어댑터와 같다 (' + tdRows.length + '줄)');
ok(td.text.indexOf(String(tdRows.reduce((x, r) => x + r.n, 0))) >= 0 ||
  td.text.indexOf(String(tdRows.reduce((x, r) => x + r.n, 0)).replace(
    /\B(?=(\d{3})+(?!\d))/g, ',')) >= 0,
  '오늘 할 일 합계가 어댑터 합계와 같다');

say('');
say('=== [6] 값이 바뀌면 답도 바뀌는가 ===');
const before = { cut: sc.cut, cutAmt: sum.cutAmt };
const many = DB.list().filter((r) => r.type === '보험품' && r.targetPln !== r.target).slice(0, 15);
many.forEach((r) => DB.approveAttr({ q: r.q, dept: r.dept, newType: '계획품', reason: '시험' }));

const midCut = ASK.run('count_action', { action: '감축' });
ok(has(midCut, SCREEN.stockCounts().cut) && SCREEN.stockCounts().cut === before.cut,
   '판단만 했을 때는 답이 그대로다 · 감축 ' + before.cut + '품목');
const midAttr = ASK.run('attr_status', {});
ok(midAttr.text.indexOf('확정 대기 ' + UI.num(15)) >= 0, '확정 대기 15품목을 알린다');

DB.commitAttr();
const afterCut = ASK.run('count_action', { action: '감축' });
const nowCut = SCREEN.stockCounts().cut;
ok(nowCut !== before.cut, '확정 뒤 감축 품목 수가 움직였다 · ' + before.cut + ' → ' + nowCut);
ok(has(afterCut, nowCut), '챗봇도 바뀐 값으로 답한다');
const afterAmt = ASK.run('money_summary', { kind: 'cut' });
ok(afterAmt.text.indexOf(UI.won(DB.summary().cutAmt)) >= 0,
   '감축 금액도 따라 바뀐다 · ' + UI.won(before.cutAmt) + ' → ' + UI.won(DB.summary().cutAmt));
ok((ASK.run('count_action', { action: '감축' }).evidence || [])
   .some((p) => String(p[1]).indexOf('확정 속성으로 목표를 다시 잡은') >= 0),
   '확정이 반영됐다는 사실을 근거에 적는다');
DB.clearAttr();
ok(SCREEN.stockCounts().cut === before.cut, '초기화하면 처음 값으로 돌아온다');

say('');
say('=== [7] 도구 목록이 tools.json 과 맞는가 ===');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/tools.json'), 'utf8'));
const declared = spec.tools.map((t) => t.name).filter((n) => n !== 'ask_documents');
const impl = ASK.tools();
const missing = declared.filter((n) => impl.indexOf(n) < 0);
const extra = impl.filter((n) => declared.indexOf(n) < 0);
ok(missing.length === 0, 'tools.json 의 도구가 모두 구현돼 있다' +
   (missing.length ? ' · 없는 것 ' + missing.join(',') : ''));
ok(extra.length === 0, '구현만 있고 선언이 없는 도구가 없다' +
   (extra.length ? ' · ' + extra.join(',') : ''));
ok(spec.tools.every((t) => t.description && t.description.length > 20),
   '모든 도구에 「언제 쓰는지」 설명이 있다');

say('');
say(bad ? ('ask check FAIL problems=' + bad) : 'ask check PASS');
fs.writeFileSync(path.join(ROOT, 'db', 'ASK_CHECK.txt'), OUT.join('\n') + '\n', 'utf8');
process.exit(bad ? 1 : 0);
