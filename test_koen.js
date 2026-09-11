/* test_koen.js · 「말한 대로」 가 아니라 「적힌 대로」 찾는지 본다.
 *
 * 음성 인식은 한국어로 받아쓰고 품명은 영어다 · 그 사이를 ko-en.js 가 잇는다.
 * 여기서 보는 것은 세 가지다 ·
 *   1. 자재 낱말이 영어로 바뀌는가 (너트 → Nut)
 *   2. 업무 한국어가 **안 바뀌는가** (발주가 Valve 가 되면 안 된다 · 뼈대가 한 글자 차이다)
 *   3. 바꾼 낱말로 실제로 자재가 걸리는가 (0건이면 바꾼 보람이 없다)
 *
 * 실행 · node test_koen.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
let fails = 0;
const lines = [];

function say(s) { lines.push(s === undefined ? '' : s); }
function ok(cond, msg) {
  say((cond ? '  OK   ' : '  FAIL ') + msg);
  if (!cond) { fails += 1; }
  return cond;
}

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
  const sandbox = {
    window: win, console,
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    Object, Array, JSON, Math, Number, String, Boolean, Date, Error, RegExp, isNaN
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  ['config.js', 'db-master.js', 'db-derived.js', 'db-changes.js', 'db.js', 'ko-en.js']
    .forEach((f) => {
      const p = path.join(ROOT, 'assets', f);
      if (!fs.existsSync(p)) { throw new Error('없는 파일 · assets/' + f); }
      vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
    });
  return win;
}

const win = boot();
const K = win.KOEN;
const DB = win.DB;

say('='.repeat(70));
say('ko-en · 한국어 음성 → 영어 자재명');
say('='.repeat(70));
say();

const L = K.lexicon();
say('품명에서 모은 영어 낱말 ' + L.length + '개 · 가장 많이 나오는 것 ' +
    L.slice(0, 8).map((x) => x.show + '(' + x.n + ')').join(' '));
say();

// 1 · 사용자가 말한 자재 단위 여섯 가지가 반드시 된다
say('[1] 자재 단위 · 말한 대로 영어가 되는가');
const MUST = [
  ['밸브', 'valve'], ['볼트', 'bolt'], ['너트', 'nut'], ['베어링', 'bearing'],
  ['실린더', 'cylinder'], ['롤러', 'roller']
];
MUST.forEach(([ko, en]) => {
  const m = K.match(ko);
  ok(!!m && m.word === en,
     ko + ' → ' + (m ? m.en : '못 찾음') + (m ? ' (' + m.how + ' · 뼈대 ' +
     K.key(K.roman(ko)) + '=' + K.key(en) + ')' : ''));
});

// 2 · 그 밖의 낱말도 같은 방법으로 걸린다
say();
say('[2] 같은 방법으로 걸리는 다른 낱말들');
[['펌프', 'pump'], ['모터', 'motor'], ['커플링', 'coupling'], ['조인트', 'joint'],
 ['필터', 'filter'], ['씰', 'seal'], ['패킹', 'packing'], ['기어', 'gear'],
 ['벨트', 'belt'], ['체인', 'chain'], ['유압', 'hydraulic'], ['공압', 'pneumatics'],
 ['전기', 'electrical'], ['고무', 'rubber'], ['금속', 'metal'], ['구리', 'copper']
].forEach(([ko, en]) => {
  const m = K.match(ko);
  ok(!!m && m.word === en, ko + ' → ' + (m ? m.en : '못 찾음') + ' (기대 ' + en + ')');
});

// 3 · 업무 한국어는 건드리지 않는다  <- 여기가 무너지면 챗봇이 엉뚱한 걸 찾는다
say();
say('[3] 업무 한국어는 그대로 둔다 (뼈대가 비슷해도)');
['재고', '발주', '감축', '공용화', '반납', '구매', '신청', '목표', '적정', '보유',
 '금액', '부서', '설비', '정비', '오늘', '이번', '알려줘', '보여줘', '얼마', '현황'
].forEach((t) => {
  const m = K.match(t);
  ok(!m, t + ' 은 그대로 (' + (m ? '→ ' + m.en + ' 로 잘못 바뀐다' : '안 바뀐다') + ')');
});

// 4 · 문장 통째로
say();
say('[4] 문장을 바꾼다 · 자재 낱말만 영어가 된다');
[['너트 재고 알려줘', 'Nut 재고 알려줘'],
 ['볼 베어링 몇 개 있어', 'Ball Bearing 몇 개 있어'],
 ['유압 실린더 발주 필요한 거 보여줘', 'Hydraulic Cylinder 발주 필요한 거 보여줘'],
 ['롤러 감축 가능 금액 얼마야', 'Roller 감축 가능 금액 얼마야'],
 ['오늘 할 일 알려줘', '오늘 할 일 알려줘']
].forEach(([src, want]) => {
  const r = K.translate(src);
  ok(r.text === want, '「' + src + '」 → 「' + r.text + '」' +
     (r.text === want ? '' : ' · 기대 「' + want + '」'));
});

// 5 · 바꾼 말로 실제 자재가 걸리는가 (0건이면 바꾼 보람이 없다)
say();
say('[5] 바꾼 낱말로 자재가 실제로 걸린다');
MUST.concat([['펌프', 'pump'], ['조인트', 'joint'], ['유압', 'hydraulic']])
  .forEach(([ko]) => {
    const en = K.term(ko);
    const hit = en ? DB.find(en).length : 0;
    ok(hit > 0, ko + ' → ' + en + ' · ' + hit + '건');
  });

// 6 · 검색이 0건이면 db.find 가 스스로 한 번 더 시도한다
say();
say('[6] DB.find 가 한국어로 들어와도 스스로 옮겨 찾는다');
/* 같은 것을 두 가지로 적은 품명이 있다 (Bearing 2건 · BRG 17건) ·
 * 한국어로 물으면 둘 다 훑으므로 영어 낱말 하나로 찾을 때보다 많을 수 있다 */
[['너트', 'nut'], ['밸브', 'valve'], ['베어링', 'bearing']].forEach(([ko, en]) => {
  const a = DB.find(ko).length;
  const b = DB.find(en).length;
  ok(a > 0 && a >= b, ko + ' 로 찾아 ' + a + '건 (' + en + ' 만으로는 ' + b + '건)');
});
ok(DB.find('베어링').length === 19, '베어링 은 Bearing 과 BRG 를 함께 본다 · ' +
   DB.find('베어링').length + '건');
ok(DB.find('없는말입니다').length === 0, '없는 말은 그대로 0건이다');

// 7 · 흔한 우리말 148 개를 훑어 오검출을 센다
//     여기가 조용해야 챗봇이 엉뚱한 자재를 찾지 않는다
say();
say('[7] 흔한 우리말을 훑는다 · 자재명으로 둔갑하면 안 된다');
const COMMON = ('중에 그리고 하지만 그런데 여기서 저기 이것 그것 저것 우리 너희 사람 하나 '
  + '둘 셋 오늘 어제 내일 지금 아까 이제 조금 많이 아주 매우 정말 진짜 가장 제일 다시 '
  + '먼저 나중 시간 하루 이틀 사흘 이번 저번 다음 이전 처음 마지막 오전 오후 새벽 아침 '
  + '점심 저녁 자리 문서 내용 방법 이유 결과 문제 해결 상황 경우 부분 전부 일부 나머지 '
  + '이상 이하 미만 초과 정도 수준 상태 변경 추가 삭제 수정 확인 검토 보고 회의 담당 '
  + '책임 관리 운영 작업 공정 현장 공장 창고 입고 출고 불출 이송 점검 수리 교체 교환 '
  + '폐기 등록 조회 입력 출력 저장 전송 완료 진행 대기 보류 취소 승인 반려 요청 응답 '
  + '부장 과장 대리 사원 안전 품질 생산 설계 예산 실적 평균 최대 최소 합계 비율 증가 '
  + '감소 유지 개선 효과 원인 대책 일정 기간 단계 순서 사용자 고객 업체 공급 납품 계약 '
  + '견적 발행 이름 숫자 글자 사진 그림 화면 버튼 표시 선택').split(' ');
const wrong = COMMON.map((w) => [w, K.match(w)]).filter((x) => x[1]);
ok(wrong.length === 0, COMMON.length + '개 중 잘못 바뀌는 말 ' + wrong.length + '개' +
   (wrong.length ? ' · ' + wrong.map((x) => x[0] + '→' + x[1].en).join(' ') : ''));

say();
say('='.repeat(70));
say(fails ? 'ko-en check FAIL problems=' + fails : 'ko-en check PASS');

const out = path.join(ROOT, 'db', 'KOEN_CHECK.txt');
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(lines.join('\n').replace(/[^\x00-\x7F]/g, (c) => c));
console.log(fails ? 'ko-en check FAIL problems=' + fails : 'ko-en check PASS');
process.exitCode = fails ? 1 : 0;
