/* catalog.js · 이 서비스가 자기 자신을 설명하는 사전
 *
 * 「stale 이 무슨 뜻이야」 「히트맵 상자 크기가 뭘 뜻해」 「이 수치 어디서 왔어」 같은
 * 질문에 답하려면 화면 · 항목 · 용어의 뜻이 데이터로 있어야 한다.
 * 주석에만 있으면 화면이 읽을 수 없다.
 *
 * 규칙 ·
 *   - 여기 적는 것은 **사실**이다. 산식 값은 적지 않고 meta().spec 에서 읽는다
 *     (여기 숫자를 적어 두면 명세가 바뀔 때 이 파일만 옛 값으로 남는다).
 *   - field 는 실제 DB 행 필드 이름이어야 한다 · test_ask.js 가 대조한다.
 *   - screen 은 실제 html 파일이어야 한다 · 같은 검사기가 대조한다.
 */
window.CATALOG = (function () {
  'use strict';

  /* 화면 · 무엇을 보여 주고 무엇을 할 수 있는가 */
  var SCREENS = {
    main: {
      file: 'main.html', title: '대시보드',
      what: '담당 자재 743품목의 지금 상태를 세 칸으로 모은다 · 무엇을 맡았나(AI 보유목적 분류) · ' +
        '얼마를 쥐고 있나(보유와 목표재고) · 언제까지인가(이번 주 정비계획).',
      does: ['숫자를 눌러 그 값이 나온 화면으로 바로 간다',
             '속성 판단의 확정 대기 건수를 알려 준다 (다른 화면이 아직 옛 속성을 쓴다는 뜻)',
             '갱신 · 승인 · 반납 뒤 다시 셈한다'],
      parts: {
        '도넛': '743품목을 손대야 하는 갈래로 나눈다 · 보험품→계획품 · 계획품→보험품 · 현행유지 · 판단 완료 · 판정일치 · 배제',
        '견주기 막대': '보유 금액과 목표재고 금액을 두 줄로 견준다 · 빗금 칸이 목표를 넘는 몫(감축 가능)이다',
        '이번 주 정비계획': '적정구매시점 화면의 이번 주 WO 와 같은 값이다 · 막대는 자재를 얼마나 확보했는지다',
        '흐름 띠': '바로 손이 가는 세 곳 · 재분류 추천 · 재고 절감 · 긴급 발주'
      }
    },
    attr: {
      file: 'attr.html', title: '보유목적 판단', also: '속성값 판단',
      what: '자재가 보험품인지 계획품인지 정한다. 처음엔 정본 속성만 보이고, ' +
        '「알고리즘 실행」 을 누르면 7요인 가중합 판정 결과가 올라온다. ' +
        '사람이 자재마다 판단하고 마지막에 「담당자 확정」 을 누른다.',
      does: ['알고리즘 실행 (판정 결과 · 점수 · 신뢰도를 올린다)',
             '체크박스로 그 칸 전체를 골라 한 번에 판단',
             '담당자 확정 (이 순간부터 다른 화면이 그 속성으로 계산한다)',
             '확정 내보내기 (classification_result.csv · 엔진에 되돌려 넣는 파일)',
             '초기화 (판단 · 확정 · 실행 단계만 지운다)'],
      parts: {
        '점수 축': '보험품 점수와 계획품 점수의 우세도를 점 하나로 놓는다 · 계획품이 우세하면 왼쪽(파랑), 보험품이 우세하면 오른쪽(코랄), 회색지대는 가운데(호박)',
        '제외대상': '판정 근거 목록에 올리지 않는 자재 · 사전 배제 + 판정일치를 합친 수다',
        '단계 줄': '원본 속성 → 알고리즘 실행 → 담당자 확정 → 적정재고 분석 · 네 칸이 각각 누를 수 있다'
      }
    },
    stock: {
      file: 'stock.html', title: '적정재고 분석',
      what: '자재마다 목표재고를 잡고 보유와 견줘 조치를 낸다. 들어오면 분석 전이고 ' +
        '「적정재고 분석」 을 누르면 확정 속성으로 계산한 결과가 올라온다.',
      does: ['적정재고 분석 실행 · 다시 분석',
             '조치 표에서 PR 초안을 만들어 구매신청 화면으로 넘어가기',
             '보유 수량을 눌러 그 자재의 목표재고 계산 분해 보기'],
      parts: {
        '히트맵': '핵심예비품 중 과부족 금액이 큰 것만 상자로 깐다 · 한 상자가 한 품목이다',
        '상자 크기': '과부족 금액이다 (|보유 − 목표| × 단가). 금액 차이가 800배까지 나서 그대로 쓰면 큰 상자 둘이 판을 다 먹는다 · 그래서 금액^0.7 로 눌러 그리고 그 눈금을 화면 아래에 적는다',
        '상자 색': '방향이다 · 부족은 파랑, 초과는 빨강. 농도는 목표 대비 어긋난 배수 네 단계다',
        '단계 3 · 4 · 5': '손으로 할 일만 남겼다 · 조치 판정 · 공용화 후보 · 금융비용 절감'
      }
    },
    plan: {
      file: 'plan.html', title: '적정구매시점',
      what: '정비계획에 걸린 자재를 언제까지 발주해야 하는지 본다. 기준일부터 30일 안의 ' +
        '정비계획만 올린다 (반출된 156건은 넉 달에 걸쳐 있다).',
      does: ['WO 를 펼쳐 소요 필수 자재와 과부족 보기',
             '구매신청 초안 만들기 → 구매신청 화면으로 이어짐',
             '수리계획 배지의 ? 로 마감일 산식과 선행일수 보기'],
      parts: {
        '이번 주 WO': '이번 주에 정비하는 건과 이번 주가 발주 마감인 건을 함께 본다 · 시연을 위해 날짜만 이번 주로 옮긴 여섯 건이고 설비 · 자재 · 재고는 원천 값이다',
        '표정': '발주 마감까지 남은 날 · 7일 이상 웃음 · 3~6일 무표정 · 2일 이하나 초과는 찡그림',
        '타임라인': '발주 마감선 · 기준일(오늘) · 휴지 착수 세 점을 실제 날짜 간격대로 놓는다'
      }
    },
    pool: {
      file: 'pool.html', title: '공용 전환',
      what: '1.5년 이상 정체된 자재 중 전사에 남는 것을 우리 부서 장부에서 내리고 ' +
        '다른 부서가 쓰게 한다. 사는 대신 가져오는 일이다.',
      does: ['공용 전환 실행 (확인창을 거쳐 3층에 기록 · 부서 재고에서 빠진다)'],
      parts: {
        '보류': '핵심예비품이면서 보험품인 자재 · 설비 정지에 직접 걸려서 회수 금액에 넣지 않는다',
        '회수 가능': '즉시공용화 · 공용화권장 판정을 받은 자재의 묶인 금액 합'
      }
    },
    purchase: {
      file: 'purchase.html', title: '구매신청 (PR)',
      what: '발주가 필요한 자재의 구매신청서 초안을 만든다. AI 가 채운 칸에는 ✦ 가 붙고 ' +
        '? 를 누르면 그 값이 어디서 왔는지 나온다.',
      does: ['초안 저장 · 되돌리기', '적정재고 · 적정구매시점에서 넘어온 자재로 바로 작성'],
      parts: {
        '납기희망일': '요청일 + 리드타임 평균으로 채운다 · AI 채움 표시가 붙는다',
        '4단 파이프라인': '초안 · 검토 · 승인 · 발주 · 마지막 단계는 사내 시스템 연동이라 파선이다'
      }
    },
    'return': {
      file: 'return.html', title: '자재반납 (QR)',
      what: '불출 후 남은 자재를 반납한다. 칸은 전체 · 반납 대기 · 반납 완료다.',
      does: ['반납 실행 (재고가 늘고 조치가 다시 판정된다)', '반납 효과 미리보기'],
      parts: {
        '물품 상태': '신품 · 중고 · 불용 판정은 반납받은 자재를 검사하고 담당자가 정한다 · 그래서 반납 완료 칸에서만 보여 준다',
        'QR': '자재식별표 QR 을 찍으면 자재 확인 화면이 열린다 · make_qr.py 가 만든다'
      }
    },
    'material-view': {
      file: 'material-view.html', title: '자재 확인 (QR 진입)',
      what: '자재식별표 QR 을 찍으면 열리는 화면. 식별표 항목을 그대로 보여 주고 ' +
        '반납자를 확인한 뒤 모바일 반납 2단계로 넘긴다.',
      does: ['반납 → 확인 팝업 → 모바일 반납으로 인계'],
      parts: {
        '반납자': '사번 · 이름을 여기서 확인한다 · 그 값으로 반납 이력이 남는다'
      }
    }
  };

  /* 항목 · 용어. field 가 있으면 실제 DB 행 필드다 (검사기가 존재를 확인한다) */
  var TERMS = [
    { key: '보험품', field: 'type', what: '돌발 고장에 대비해 일정 수량을 상시 보관하는 자재. 목표재고는 μ_LT + 안전재고로 잡는다.', where: 'attr' },
    { key: '계획품', field: 'type', what: '정비 일정에 맞춰 직납받는 자재. 상시 재고 0 이 원칙이다.', where: 'attr' },
    { key: '회색지대', field: 'verdict', what: '보험품 점수와 계획품 점수 차이가 작아 알고리즘이 판단을 보류한 자재. 사람이 확정해야 라벨이 생긴다.', where: 'attr' },
    { key: '제외대상', what: '보유목적 판단 목록에 올리지 않는 자재 · 사전 배제(소모품 · 순환품)와 판정일치를 합친 수다. 743 = 손대야 하는 것 + 제외대상.', where: 'attr' },
    { key: '판단', field: 'judged', what: '사람이 고른 속성. 확정하기 전이라 다른 화면은 아직 쓰지 않는다.', where: 'attr' },
    { key: '확정', field: 'committed', what: '「담당자 확정」 을 누른 판단. 이 순간부터 적정재고 · 적정구매시점 · 대시보드가 그 속성으로 계산한다. 3층 attribute_overrides 의 seq 하나로 적는다.', where: 'attr' },
    { key: '확정 대기', field: 'pending', what: '판단은 했지만 아직 확정하지 않은 자재. 이 수가 0 이 아니면 다른 화면은 알고리즘 판정 속성을 쓰고 있다는 뜻이다.', where: 'attr' },
    { key: 'stale', field: 'stale', what: '확정 속성이 적정재고를 계산할 때 쓴 속성과 다르다는 표시. 이때 목표재고를 그 속성으로 다시 잡는다 (화면에는 「확정 반영」 으로 적는다).', where: 'stock' },
    { key: 'target', field: 'target', what: '반출된 06 파생의 목표재고 · 그 행의 속성(stockType)으로 엔진이 계산한 값이다.', where: 'stock' },
    { key: 'targetNow', field: 'targetNow', what: '지금 써야 하는 목표재고. 확정 속성이 06 의 속성과 같으면 target 과 같고, 다르면 그 속성으로 구운 값(targetIns · targetPln)이다.', where: 'stock' },
    { key: 'targetIns', field: 'targetIns', what: '이 자재를 보험품으로 봤을 때의 목표재고 · 엔진을 전 품목 보험품으로 돌려 미리 구운 값이다.', where: 'stock' },
    { key: 'targetPln', field: 'targetPln', what: '이 자재를 계획품으로 봤을 때의 목표재고 · 엔진을 전 품목 계획품으로 돌려 미리 구운 값이다.', where: 'stock' },
    { key: '조치', field: 'actionNow', what: '보유와 지금 목표를 견준 결과 · 발주(적다) · 유지(같다) · 감축(넘는다).', where: 'stock' },
    { key: '부족분', field: 'needNow', what: '지금 목표 − 보유 · 0 보다 클 때만 발주 대상이다.', where: 'stock' },
    { key: '핵심예비품', field: 'csp', what: '설비 정지에 직접 걸리는 자재로 지정된 것(CSP). 등급이 S 로 올라가고 히트맵은 이 자재만 본다.', where: 'stock' },
    { key: '핵심설비', field: 'ceq', what: '자재가 걸린 설비가 핵심설비인지(CEQ). 계획품 목표를 0 으로 둘지 가르는 값이다 · 엔진은 equipment_map 으로 다시 보므로 정본 값과 11행 다르다.', where: 'stock' },
    { key: '등급', field: 'grade', what: '7요인 중요도 상위 5 / 20 / 60% 로 S · A · B · C. 안전계수 Z 가 등급마다 다르다 (핵심예비품은 무조건 S).', where: 'stock' },
    { key: '신호', field: 'signalNow', what: '발주 급함 표시 · red 즉시발주 · yellow 발주임박 · green 여유 · gray 재고불요나 충분.', where: 'stock' },
    { key: '정체', field: 'poolAge', what: '마지막 입고 뒤 지난 날 수. 548일(1.5년) 이상이고 최근 소요가 없으면 공용화 후보다.', where: 'pool' },
    { key: '묶인 금액', field: 'staleValue', what: '정체 자재가 붙잡고 있는 금액 · 공용 전환하면 회수되는 몫이다.', where: 'pool' },
    { key: '발주 마감일', field: 'dueDate', what: '정지시작일 − floor(리드타임평균 + 선행일수 + 0.5 × 리드타임편차). 하루라도 늦으면 휴지에 못 맞추므로 내림이다.', where: 'plan' },
    { key: '선행일수', what: '수리계획마다 다른 준비 기간 · 합리화 60 · 대수리 45 · 중수리 21 · 정기수리 14 · 교체휴지 10 · 공정휴지 7일.', where: 'plan' },
    { key: '예상 소요', field: 'expect', what: '이 정비 건에서 쓸 것으로 본 수량. 정비계획에 걸린 56행만 원천에 있어서, 없는 행은 「원천에 없음」 이라고 적고 부족분은 목표재고 기준으로 센다.', where: 'plan' },
    { key: '현재고', field: 'stock', what: '부서 보유 수량. 저장하지 않고 스냅샷(stockDept) + 3층 거래(반납 · 불출 · 공용전환)의 합으로 계산한다.', where: 'stock' },
    { key: '전사 보유', field: 'stockAll', what: '회사 전체 보유 수량. 부서 보유보다 많으면 그만큼은 사지 않고 이관받을 수 있다.', where: 'pool' },
    { key: '금융비용 절감', what: '(감축 금액 + 공용화 회수) × 기여율 × 이자율. 상수는 명세에서 읽는다.', where: 'stock' },
    { key: '기준일', what: '데이터 스냅샷 날짜. 화면의 모든 숫자는 이 날짜 기준이다 · 지금 보는 시각과 다른 값이다.', where: 'main' }
  ];

  /* 출처 · 어느 값이 어디서 왔는가 */
  var SOURCES = [
    { topic: '자재 정본', layer: '1층 정본', from: '02_자재_정본.csv (743행)',
      what: '자재코드 · 품명 · 창고 · 단가 · 리드타임 · 핵심예비품 · 보유 수량 스냅샷. 읽기 전용이다.' },
    { topic: '속성 판정', layer: '2층 파생', from: '05_속성판정_파생.csv (algo_in/)',
      what: '알고리즘 담당이 7요인 가중합으로 낸 판정 · 점수(si · sp) · 신뢰도 · 판정 경로.' },
    { topic: '목표재고', layer: '2층 파생', from: '06_적정재고_파생.csv + algo_in/06_목표재고_양속성.csv',
      what: '엔진이 계산한 목표재고 · 조치 · 신호. 속성 두 가지 각각의 목표를 미리 구워 두어서 사람이 속성을 바꾸면 그 값으로 바뀐다 (기준 재현 743/743 일치).' },
    { topic: '정체 자재', layer: '2층 파생', from: '07_정체자재.csv',
      what: '정체 일수 · 묶인 금액 · 공용화 판정(strong · medium · review).' },
    { topic: '정비계획', layer: '1층 정본', from: '04_정비계획.csv (156행) → assets/plan-data.js',
      what: '설비 · 수리계획 · 정지시작일. 마감일은 명세 산식으로 계산해 실었다. WO 번호는 원천에 없어 표시용으로 만든 값이다.' },
    { topic: '사람이 한 일', layer: '3층 오버라이드', from: 'localStorage · mtrl.db.v1',
      what: '속성 판단 · 확정 · 반납 · 공용 전환 · 구매신청 초안 · QR 반납 접수. 쌓기만 하고 지우지 않는다 (되돌리기는 이력을 하나 더 쌓는다).' },
    { topic: '명세 상수', layer: '2층 파생', from: '명세상수.json → meta().spec',
      what: '산식 · 안전계수 Z · 등급 규칙 · 7요인 가중치 · 금융비용 상수. 화면은 상수를 만들지 않고 여기서 읽는다.' },
    { topic: '사내 문서', layer: '외부 RAG', from: 'RAG 서버 · 사내 지침 · 매뉴얼 · FAQ 30건 (6,901조각)',
      what: '절차 · 규정 질문의 근거. 답마다 [n] 인용과 출처가 붙는다. 우리 자재 데이터는 이 서버로 보내지 않는다.' }
  ];

  function screens() { return SCREENS; }
  function terms() { return TERMS; }
  function sources() { return SOURCES; }

  /* 용어 찾기 · 정확히 같은 이름 → 이름에 포함 → 설명에 포함 순으로 본다.
   * 한글 조사 때문에 완전 일치가 잘 안 맞아서 포함 검사를 같이 쓴다 */
  function findTerm(q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) { return null; }
    var i;
    for (i = 0; i < TERMS.length; i += 1) {
      if (TERMS[i].key.toLowerCase() === s) { return TERMS[i]; }
    }
    for (i = 0; i < TERMS.length; i += 1) {
      var k = TERMS[i].key.toLowerCase();
      if (s.indexOf(k) >= 0 || k.indexOf(s) >= 0) { return TERMS[i]; }
      if (TERMS[i].field && TERMS[i].field.toLowerCase() === s) { return TERMS[i]; }
    }
    for (i = 0; i < TERMS.length; i += 1) {
      if (TERMS[i].what.toLowerCase().indexOf(s) >= 0) { return TERMS[i]; }
    }
    return null;
  }

  function findSource(q) {
    var s = String(q || '').trim().toLowerCase();
    var i;
    for (i = 0; i < SOURCES.length; i += 1) {
      if (SOURCES[i].topic.toLowerCase().indexOf(s) >= 0 ||
          s.indexOf(SOURCES[i].topic.toLowerCase()) >= 0) { return SOURCES[i]; }
    }
    for (i = 0; i < SOURCES.length; i += 1) {
      if (SOURCES[i].what.toLowerCase().indexOf(s) >= 0) { return SOURCES[i]; }
    }
    return null;
  }

  return {
    screens: screens, terms: terms, sources: sources,
    findTerm: findTerm, findSource: findSource
  };
})();
