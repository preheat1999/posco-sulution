/* test_db_api.js · 브라우저 API 를 Node 로 시험한다.
 *
 * localStorage 가 없으므로 메모리로 흉내 내는 가짜를 만든다.
 * 화면을 열지 않고도 「승인하면 요약이 움직이는가」 를 확인할 수 있어야 한다.
 * 그게 이 시스템의 심장이고, 심사에서 물어보는 것도 그것이다.
 *
 * 결과는 콘솔이 아니라 db/DB_API_TEST.txt 로 낸다
 * (Windows 콘솔에서 한글이 깨진다).
 *
 * 실행 · node test_db_api.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'db', 'DB_API_TEST.txt');

const lines = [];
let fails = 0;

function say(s) { lines.push(s === undefined ? '' : s); }

function ok(cond, msg) {
  say((cond ? '  OK   ' : '  FAIL ') + msg);
  if (!cond) { fails += 1; }
  return cond;
}

/* 가짜 저장소. localStorage 와 같은 네 함수만 있으면 db-changes.js 가 돈다 */
function fakeStorage() {
  const box = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); },
    removeItem: (k) => { delete box[k]; },
    clear: () => { Object.keys(box).forEach((k) => { delete box[k]; }); }
  };
}

function boot() {
  const win = {};
  win.localStorage = fakeStorage();
  win.addEventListener = () => {};
  win.removeEventListener = () => {};
  win.dispatchEvent = () => true;
  win.console = console;

  const sandbox = {
    window: win,
    console,
    CustomEvent: function (type, o) { this.type = type; this.detail = o && o.detail; },
    Object, Array, JSON, Math, Number, String, Boolean, Date, Error, RegExp, isNaN
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  /* 로드 순서를 지킨다. 어댑터가 DB 보다 먼저 실행되면 빈 배열이 되고 오류도 안 난다 */
  const order = ['config.js', 'db-master.js', 'db-derived.js', 'db-changes.js',
                 'db.js', 'db-biz.js'];
  for (const f of order) {
    const p = path.join(ROOT, 'assets', f);
    if (!fs.existsSync(p)) { throw new Error('없는 파일 · assets/' + f); }
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return win;
}

function run() {
  const win = boot();
  const DB = win.DB;

  say('='.repeat(70));
  say('db.js 자체 시험');
  say('='.repeat(70));
  say();

  if (!DB) {
    say('  FAIL window.DB 가 만들어지지 않았다. 로드 순서를 확인한다');
    fails += 1;
    return;
  }

  const meta = DB.meta();
  say('기준일 ' + meta.asof + ' · 자재 ' + meta.counts.materials + '종 · PK ' + meta.pk);
  say();

  // 1 · 한 건 조회
  say('[1] DB.item 이 품명 · 단가 · 목표재고를 준다');
  const a = DB.item('Q4039953');
  ok(!!a, 'Q4039953 을 찾았다');
  ok(!!(a && a.name), '품명 · ' + (a && a.name));
  ok(!!(a && a.price > 0), '단가 · ' + (a && a.price));
  ok(a && a.target !== undefined, '목표재고 · ' + (a && a.target));
  ok(a && a.typeSrc === 'algorithm' || a && a.typeSrc === 'master',
     '속성 출처 · ' + (a && a.typeSrc) + ' (아직 사람이 승인한 것이 없다)');

  // 2 · 주소와 문장에서도 코드를 뽑는다
  say();
  say('[2] 주소 · 문장에서도 코드를 뽑는다 (QR 과 챗봇이 그렇게 준다)');
  const b = DB.item('http://x/material-view.html?code=Q4039953');
  const c = DB.item('Q4039953 재고 있어?');
  ok(b && b.q === 'Q4039953', '주소에서 · ' + (b && b.q));
  ok(c && c.q === 'Q4039953', '문장에서 · ' + (c && c.q));
  ok(DB.item('QFC01') === null, '창고코드(QFC01)는 자재로 잡히지 않는다');
  ok(DB.item('Q00101') === null, '거래코드(Q00101)는 자재로 잡히지 않는다');

  // 3 · 목록과 요약이 같은 값을 본다
  say();
  say('[3] DB.list 와 요약이 같은 값을 본다');
  const shipped = DB.summary().shipped;
  const ins = DB.list({ type: '보험품' }).length;
  const pln = DB.list({ type: '계획품' }).length;
  ok(ins === shipped.insItems, '보험품 ' + ins + ' · 요약 ' + shipped.insItems);
  ok(pln === shipped.plnItems, '계획품 ' + pln + ' · 요약 ' + shipped.plnItems);
  ok(DB.list().length === 743, '전체 ' + DB.list().length + '건');
  ok(DB.find('Hydraulic').length > 0, 'find(품명) 이 걸린다 · ' + DB.find('Hydraulic').length + '건');

  // 4 · 조치
  say();
  say('[4] 요약의 조치가 발주 120 · 유지 142 · 감축 481 이다');
  const s0 = DB.summary();
  ok(s0.action['발주'] === 120, '발주 ' + s0.action['발주']);
  ok(s0.action['유지'] === 142, '유지 ' + s0.action['유지']);
  ok(s0.action['감축'] === 481, '감축 ' + s0.action['감축']);
  ok(s0.nowAmt === shipped.nowAmt,
     '현행재고 ' + s0.nowAmt + ' · 요약 ' + shipped.nowAmt);
  say('       2차 버킷팅 ' + JSON.stringify(s0.bucket));
  ok(s0.bucket['보험품→계획품'] === 149 && s0.bucket['계획품→보험품'] === 90 &&
     s0.bucket['현행유지'] === 31, '버킷 149 / 90 / 31 · 대시보드가 이 값을 쓴다');

  // 5 · 승인하면 요약이 움직인다  <- 이 시스템의 핵심
  say();
  say('[5] 회색지대 한 건을 계획품으로 승인하면 요약이 움직인다');
  const gray = DB.list({ verdict: '회색지대' })[0];
  ok(!!gray, '회색지대 자재를 찾았다 · ' + (gray && gray.q) + ' (정본 ' + (gray && gray.baseType) + ')');
  const before = { ins: s0.insItems, pln: s0.plnItems };
  const want = gray.baseType === '보험품' ? '계획품' : '보험품';
  DB.approveAttr({ q: gray.q, dept: gray.dept, newType: want, reason: '시험' });
  const s1 = DB.summary();
  const after = DB.item(gray.q, gray.dept);
  ok(after.type === want, '속성이 ' + want + ' 이 됐다');
  ok(after.typeSrc === 'override', '출처가 override 다');
  ok(s1.insItems !== before.ins || s1.plnItems !== before.pln,
     '요약이 움직였다 · 보험품 ' + before.ins + '->' + s1.insItems +
     ' · 계획품 ' + before.pln + '->' + s1.plnItems);
  ok(after.verdict === '회색지대', '알고리즘 판정값은 그대로 남는다 (근거 화면이 그걸 보여 준다)');

  // 6 · 반납 · 불출이 재고와 조치를 움직인다
  say();
  say('[6] 재고 3인 자재를 3개 불출하면 재고 0 · 조치 발주');
  const cand = DB.list(function () { return true; })
    .filter((r) => r.stockSeed === 3 && Number(r.target) > 0)[0];
  ok(!!cand, '재고 3 · 목표 있는 자재 · ' + (cand && cand.q) +
     ' (목표 ' + (cand && cand.target) + ')');
  DB.txn({ q: cand.q, dept: cand.dept, type: '불출', qty: 3, note: '시험' });
  const c6 = DB.item(cand.q, cand.dept);
  ok(c6.stock === 0, '재고 ' + cand.stockSeed + ' -> ' + c6.stock);
  ok(c6.actionNow === '발주', '조치 ' + c6.actionNow);
  ok(c6.needNow === Number(cand.target), '지금 필요 ' + c6.needNow);
  ok(c6.need === cand.need, '알고리즘이 낸 need 는 그대로 · ' + c6.need);

  say();
  say('[6-2] 반납하면 되돌아온다 (부호는 종류가 정한다)');
  DB.txn({ q: cand.q, dept: cand.dept, type: '반납', qty: 3 });
  const c62 = DB.item(cand.q, cand.dept);
  ok(c62.stock === 3, '재고 ' + c62.stock + ' · 트랜잭션 ' + c62.txns + '건');

  // 7 · 되돌리기
  say();
  say('[7] undo 하면 되돌아온다');
  const ch = DB.changes();
  const lastTxn = ch.stock_transactions[ch.stock_transactions.length - 1];
  DB.undo('stock_transactions', lastTxn.seq);
  ok(DB.item(cand.q, cand.dept).stock === 0, '반납을 되돌려 재고 0');
  ok(DB.revertAttr(gray.q, gray.dept), 'revertAttr 이 승인을 되돌린다');
  const g7 = DB.item(gray.q, gray.dept);
  ok(g7.typeSrc === 'master', '출처가 정본으로 돌아왔다 · ' + g7.typeSrc);

  // 8 · 잘못된 입력은 막는다
  say();
  say('[8] 잘못된 입력 네 가지가 전부 예외를 던진다');
  // 조회는 null 을 주고 쓰기는 던진다. 한 줄에 && 로 이으면 조회가 끊어서 시험이 헛돈다
  ok(DB.item('Q9999999') === null, '정본에 없는 코드 조회는 null 이다');
  ok(throws(() => DB.approveAttr({ q: 'Q9999999', newType: '보험품' })),
     '정본에 없는 자재코드로 승인하면 던진다');
  ok(throws(() => DB.approveAttr({ q: 'Q4039953', newType: '회색지대' })),
     '보험품 · 계획품이 아닌 승인값');
  ok(throws(() => DB.txn({ q: 'Q4039953', type: '폐기', qty: 1 })),
     '넷이 아닌 트랜잭션 종류');
  ok(throws(() => DB.txn({ q: 'Q4039953', type: '반납', qty: 0 })),
     '0 이하의 수량');
  ok(throws(() => DB.txn({ q: 'Q4039953', type: '반납', qty: -3 })),
     '음수 수량 (부호는 종류가 정한다)');

  // 9 · 시연 초기화
  say();
  say('[9] DB.reset() 하면 처음 값으로 돌아온다');
  DB.approveAttr({ q: gray.q, dept: gray.dept, newType: want });
  DB.txn({ q: cand.q, dept: cand.dept, type: '불출', qty: 1 });
  DB.reset();
  const s9 = DB.summary();
  ok(s9.action['발주'] === 120 && s9.action['유지'] === 142 && s9.action['감축'] === 481,
     '조치가 처음 값으로 · ' + JSON.stringify(s9.action));
  ok(DB.item(gray.q, gray.dept).typeSrc === 'master', '승인 이력이 비었다');
  ok(DB.changes().attribute_overrides.length === 0, '3층이 비었다');

  // 곁들이 · 업무 테이블에 자재의 정체가 없는지
  say();
  say('[10] 업무 테이블에 자재의 정체가 없다 (불변식 3)');
  const BIZ = win.DB_BIZ;
  const banned = ['name', 'price', 'ltMean', 'ltStd', 'grade', 'type', 'target'];
  const leaked = [];
  ['returns', 'purchase', 'tags'].forEach((t) => {
    (BIZ[t] || []).forEach((r) => {
      banned.forEach((k) => { if (r[k] !== undefined) { leaked.push(t + '.' + k); } });
    });
  });
  ok(leaked.length === 0, '품명 · 단가 · 리드타임 · 등급이 없다 · 샌 칸 ' +
     (leaked.length ? leaked.join(', ') : '없음'));

  say();
  say('[11] 업무 화면 자재와 분석 화면 자재의 교집합이 있다 (불변식 2)');
  const bizCodes = BIZ.codes();
  const inMaster = bizCodes.filter((q) => DB.item(q));
  ok(inMaster.length > 0, '업무 자재 ' + bizCodes.length + '종 중 정본에 있는 것 ' +
     inMaster.length + '종 · ' + inMaster.slice(0, 3).join(' '));
  ok(inMaster.length === bizCodes.length,
     '업무 화면의 모든 코드가 정본 안에 있다 (밖에 있으면 눌러도 빈 화면이 뜬다)');
}

function throws(fn) {
  try { fn(); return false; } catch (e) { return true; }
}

try {
  run();
} catch (e) {
  say('');
  say('시험이 중간에 죽었다 · ' + e.message);
  say(e.stack);
  fails += 1;
}

say();
say('='.repeat(70));
say(fails ? ('시험 실패 ' + fails + '건') : '시험 통과 · 문제 0건');
say('='.repeat(70));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log('db api test ' + (fails ? 'FAIL' : 'PASS') + ' (problems=' + fails +
            ') -> db/DB_API_TEST.txt');
process.exit(fails ? 1 : 0);
