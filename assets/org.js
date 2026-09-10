/* org.js · 조직 트리
 *
 * 로그인 화면과 주간 리포트의 수신자 선택기가 **같은 데이터**를 쓴다.
 * 두 곳에 따로 두면 어긋난다. 리포트에 없는 사람이 로그인에 뜨거나 그 반대가 된다.
 *
 * 부서코드(dept)는 실제 원장에 있는 것만 넣는다.
 * 반출 데이터에는 SEO26FF 하나뿐이다. 없는 코드를 지어 넣으면
 * 화면이 그 코드로 조회하다 빈 화면을 띄우고, 불변식 4(모든 DeptCode 가
 * 부서 표에 있다)가 잡는다. 그래서 다른 섹션은 dept 를 비워 두고
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
    division: '설비자재부문',
    parts: [
      {
        name: '원료처리파트',
        sections: [
          {
            name: '원료정비섹션',
            dept: 'SEO26FF',              // 실제 원장에 있는 코드
            eqGroup: '하역설비군',
            tel: '061-790-1111',
            people: [
              { name: '이예열', rank: '사원', role: ROLE.OWNER, mail: 'yeyeol.lee@demo.local' },
              { name: '박정민', rank: '대리', role: ROLE.OWNER, mail: 'jungmin.park@demo.local' },
              { name: '한상우', rank: '과장', role: ROLE.LEAD, mail: 'sangwoo.han@demo.local' },
              { name: '오세진', rank: '차장', role: ROLE.LEAD, mail: 'sejin.oh@demo.local' },
              { name: '윤도현', rank: '대리', role: ROLE.BUY, mail: 'dohyun.yoon@demo.local' }
            ]
          },
          { name: '원료품질섹션', dept: null, eqGroup: '하역설비군', people: [] }
        ]
      },
      {
        name: '압연정비파트',
        sections: [
          { name: '열연정비섹션', dept: null, eqGroup: '압연설비군', people: [] },
          { name: '냉연정비섹션', dept: null, eqGroup: '압연설비군', people: [] }
        ]
      }
    ]
  };

  function parts() { return TREE.parts.map(function (p) { return p.name; }); }

  function sections(partName) {
    var p = TREE.parts.filter(function (x) { return x.name === partName; })[0];
    return p ? p.sections : [];
  }

  function section(sectionName) {
    var i, j, ss;
    for (i = 0; i < TREE.parts.length; i++) {
      ss = TREE.parts[i].sections;
      for (j = 0; j < ss.length; j++) {
        if (ss[j].name === sectionName) { return ss[j]; }
      }
    }
    return null;
  }

  /* 부서코드가 있는 섹션. 이 시연 데이터로 실제 조회가 되는 것들이다 */
  function liveSections() {
    var out = [], i, j, ss;
    for (i = 0; i < TREE.parts.length; i++) {
      ss = TREE.parts[i].sections;
      for (j = 0; j < ss.length; j++) {
        if (ss[j].dept) { out.push({ part: TREE.parts[i].name, section: ss[j] }); }
      }
    }
    return out;
  }

  function people(sectionName) {
    var s = section(sectionName);
    return s ? s.people : [];
  }

  function person(sectionName, name) {
    return people(sectionName).filter(function (p) { return p.name === name; })[0] || null;
  }

  /* 리더는 리포트를 받는다. 담당자는 매일 화면에 들어오지만 리더는 안 들어온다.
   * 리더가 안 보면 승인이 안 나고, 승인이 안 나면 라벨이 안 쌓인다 */
  function leaders(sectionName) {
    return people(sectionName).filter(function (p) { return p.role === ROLE.LEAD; });
  }

  var DEFAULT = {
    part: '원료처리파트',
    section: '원료정비섹션',
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
    if (!s || !s.section || !section(s.section)) { s = fill(DEFAULT); }
    return s;
  }

  function fill(pick) {
    var sec = section(pick.section) || section(DEFAULT.section);
    var per = person(sec.name, pick.name) || sec.people[0] || null;
    return {
      division: TREE.division,
      part: pick.part || DEFAULT.part,
      section: sec.name,
      dept: sec.dept,
      eqGroup: sec.eqGroup,
      tel: sec.tel || null,
      name: per ? per.name : null,
      rank: per ? per.rank : null,
      role: per ? per.role : null,
      mail: per ? per.mail : null,
      path: TREE.division + ' · ' + (pick.part || DEFAULT.part) + ' · ' + sec.name
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
    parts: parts,
    sections: sections,
    section: section,
    liveSections: liveSections,
    people: people,
    person: person,
    leaders: leaders,
    load: load,
    save: save,
    fill: fill,
    DEFAULT: DEFAULT
  };
})();
