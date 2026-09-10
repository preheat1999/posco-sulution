/* org.js · 조직 트리
 *
 * 로그인 화면과 주간 리포트의 수신자 선택기가 **같은 데이터**를 쓴다.
 * 두 곳에 따로 두면 어긋난다. 리포트에 없는 사람이 로그인에 뜨거나 그 반대가 된다.
 *
 * 계층은 부 → 섹션 → 파트다. 사람이 붙는 단위는 맨 아래 파트다.
 * 부서코드(dept)도 파트에 붙는다. 섹션에 붙이면 파트가 달라도 같은 재고를
 * 보게 되어 「내 자재」 라는 말이 뜻을 잃는다.
 *
 * 이름을 압연 쪽으로 둔 이유.
 * 반출 데이터의 설비 14기가 FM Main Motor · FM Crop Shear · Stand Main TR ·
 * QOC Servo 처럼 전부 열연 압연 설비다. 조직 이름만 하역 쪽이면
 * 화면에서 설비와 소속이 어긋나 보인다.
 * 다만 1층 정본의 부서 표(db-master.js depts[0].path)에는 원천 CSV 값이
 * 그대로 남아 있다. 정본은 손대지 않는다. 화면에 뜨는 소속 이름은
 * 로그인이 고른 이 트리에서 온다.
 *
 * 부서코드(dept)는 실제 원장에 있는 것만 넣는다.
 * 반출 데이터에는 SEO26FF 하나뿐이다. 없는 코드를 지어 넣으면
 * 화면이 그 코드로 조회하다 빈 화면을 띄우고, 불변식 4(모든 DeptCode 가
 * 부서 표에 있다)가 잡는다. 그래서 다른 파트는 dept 를 비워 두고
 * 「이 시연 데이터에 없다」 고 화면에 적는다.
 *
 * 사람 정보는 시연용이다. 인사 DB 와 연동하지 않는다.
 * 메일 주소도 시연용 도메인을 쓴다. 공개 저장소에 실제처럼 보이는
 * 사내 주소를 새로 만들지 않는다.
 */
(function () {
  'use strict';

  var CFG = window.CFG || {};

  var ROLE = { LEAD: '정비 리더', OWNER: '정비 담당자', BUY: '구매 담당자' };

  var TREE = {
    division: '압연설비 1부',
    sections: [
      {
        name: '열연정비 1섹션',
        parts: [
          {
            name: 'FM기계파트',
            dept: 'SEO26FF',              // 실제 원장에 있는 코드
            eqGroup: '열연 압연설비군',
            tel: '061-790-1111',
            people: [
              { name: '이예열', rank: '사원', role: ROLE.OWNER, mail: 'yeyeol.lee@demo.local' },
              { name: '박정민', rank: '대리', role: ROLE.OWNER, mail: 'jungmin.park@demo.local' },
              { name: '한상우', rank: '과장', role: ROLE.LEAD, mail: 'sangwoo.han@demo.local' },
              { name: '오세진', rank: '차장', role: ROLE.LEAD, mail: 'sejin.oh@demo.local' },
              { name: '윤도현', rank: '대리', role: ROLE.BUY, mail: 'dohyun.yoon@demo.local' }
            ]
          },
          { name: 'RM기계파트', dept: null, eqGroup: '열연 압연설비군', people: [] },
          { name: '전기파트', dept: null, eqGroup: '열연 압연설비군', people: [] }
        ]
      },
      {
        name: '열연정비 2섹션',
        parts: [
          { name: '가열로파트', dept: null, eqGroup: '가열로설비군', people: [] },
          { name: '권취기파트', dept: null, eqGroup: '권취설비군', people: [] }
        ]
      }
    ]
  };

  function sections() { return TREE.sections.map(function (s) { return s.name; }); }

  function parts(sectionName) {
    var s = TREE.sections.filter(function (x) { return x.name === sectionName; })[0];
    return s ? s.parts : [];
  }

  function part(partName) {
    var i, j, ps;
    for (i = 0; i < TREE.sections.length; i++) {
      ps = TREE.sections[i].parts;
      for (j = 0; j < ps.length; j++) {
        if (ps[j].name === partName) { return ps[j]; }
      }
    }
    return null;
  }

  /* 부서코드가 있는 파트. 이 시연 데이터로 실제 조회가 되는 것들이다 */
  function liveParts() {
    var out = [], i, j, ps;
    for (i = 0; i < TREE.sections.length; i++) {
      ps = TREE.sections[i].parts;
      for (j = 0; j < ps.length; j++) {
        if (ps[j].dept) { out.push({ section: TREE.sections[i].name, part: ps[j] }); }
      }
    }
    return out;
  }

  function people(partName) {
    var p = part(partName);
    return p ? p.people : [];
  }

  function person(partName, name) {
    return people(partName).filter(function (p) { return p.name === name; })[0] || null;
  }

  /* 리더는 리포트를 받는다. 담당자는 매일 화면에 들어오지만 리더는 안 들어온다.
   * 리더가 안 보면 승인이 안 나고, 승인이 안 나면 라벨이 안 쌓인다 */
  function leaders(partName) {
    return people(partName).filter(function (p) { return p.role === ROLE.LEAD; });
  }

  var DEFAULT = {
    section: '열연정비 1섹션',
    part: 'FM기계파트',
    name: '이예열'
  };

  /* 로그인이 고른 소속. 모든 화면의 빵조각 · 리포트 수신자 · 담당 설비에 쓰인다 */
  function load() {
    var s = null;
    try {
      var raw = window.localStorage.getItem(CFG.SESSION_KEY || 'mtrl.session.v1');
      s = raw ? JSON.parse(raw) : null;
    } catch (e) {
      s = null;   // 저장소가 막힌 환경. 기본값으로 도는 것이 화면이 안 뜨는 것보다 낫다
    }
    /* 조직 이름이 바뀌면 예전 세션값은 트리에 없는 파트를 가리킨다.
     * 그대로 두면 빵조각이 빈칸이 되므로 기본값으로 되돌린다 */
    if (!s || !s.part || !part(s.part)) { s = fill(DEFAULT); }
    return s;
  }

  function fill(pick) {
    var pt = part(pick.part) || part(DEFAULT.part);
    var per = person(pt.name, pick.name) || pt.people[0] || null;
    var sec = pick.section || DEFAULT.section;
    return {
      division: TREE.division,
      section: sec,
      part: pt.name,
      dept: pt.dept,
      eqGroup: pt.eqGroup,
      tel: pt.tel || null,
      name: per ? per.name : null,
      rank: per ? per.rank : null,
      role: per ? per.role : null,
      mail: per ? per.mail : null,
      path: TREE.division + ' · ' + sec + ' · ' + pt.name
    };
  }

  function save(pick) {
    var s = fill(pick);
    try {
      window.localStorage.setItem(CFG.SESSION_KEY || 'mtrl.session.v1', JSON.stringify(s));
    } catch (e) {
      // 저장이 안 되면 이번 세션만 기본값으로 돈다. 화면을 멈추지는 않는다
    }
    return s;
  }

  window.ORG = {
    ROLE: ROLE,
    division: TREE.division,
    tree: TREE,
    sections: sections,
    parts: parts,
    part: part,
    liveParts: liveParts,
    people: people,
    person: person,
    leaders: leaders,
    load: load,
    save: save,
    fill: fill,
    DEFAULT: DEFAULT
  };
})();
