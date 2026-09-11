/* ko-en.js · 「너트」 라고 말하면 Nut 을 찾는다.
 *
 * 왜 필요한가 ·
 * 음성 인식은 한국어로 받아쓴다 (language=ko). 그런데 우리 자재명은 전부 영어다 ·
 * 「너트 재고 알려줘」 라고 말하면 글자는 「너트」 로 오고, 품명에는 「Nut」 이라 적혀 있어
 * 한 글자도 겹치지 않는다. 찾는 게 없다고 답한다. 소리는 같은데 글자가 다를 뿐이다.
 *
 * 어떻게 푸는가 · 사전을 손으로 만들지 않는다 (자재명이 바뀌면 사전이 먼저 낡는다).
 *   1. 우리 정본의 품명 · 품목군에서 **영어 낱말을 모은다** (지금 75개 · 닫힌 집합이다).
 *   2. 한글을 로마자로 편다 (너트 → neoteu).
 *   3. 양쪽을 **자음 뼈대**로 줄인다 · 한국어가 구별하지 않는 소리를 같은 칸에 넣는다 ·
 *      r · l → L / b · v → B / p · f → P / g · k → K / d · t → T / j · z · ch → J.
 *      모음은 버린다 (「으」 처럼 한국어가 끼워 넣는 모음이 여기서 저절로 사라진다).
 *        너트 → NT · nut → NT          볼트 → BLT · bolt → BLT
 *        밸브 → BLB · valve → BLB      베어링 → BLN · bearing → BLN
 *   4. 뼈대끼리 견준다 (편집거리) · 완전히 같으면 바로, 한 글자 차이는 뼈대가 5자 이상일 때만
 *      받아들인다. 느슨하게 잡으면 「발주(BLJ)」 가 「valve(BLB)」 로 둔갑한다 · 실제로 그랬다.
 *   5. 소리가 아니라 **뜻**으로 옮겨야 하는 말(유압 → Hydraulic)만 따로 적어 둔다.
 *      그것도 품명에 실제로 있는 낱말일 때만 쓴다 · 없는 낱말로 옮기면 검색이 0건이 된다.
 *
 * 어디서 쓰나 · 음성으로 들어온 문장(chat.js) · 그리고 검색이 0건일 때 한 번 더(db.js find).
 * 바꾼 말은 화면에 그대로 적는다 (너트 → Nut) · 무엇으로 찾았는지 사람이 알아야 한다.
 */
window.KOEN = (function () {
  'use strict';

  // ---------------------------------------------------------------- 한글 → 로마자
  var CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '',
             'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
  var JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe',
              'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
  var JONG = ['', 'g', 'k', 'ks', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls',
              'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];

  function roman(s) {
    var out = '', i, c;
    for (i = 0; i < s.length; i += 1) {
      c = s.charCodeAt(i) - 0xAC00;
      if (c >= 0 && c <= 11171) {
        out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
      } else {
        out += s[i];
      }
    }
    return out.toLowerCase();
  }

  // ---------------------------------------------------------------- 자음 뼈대
  /* 한국어 귀가 구별하지 않는 소리를 한 칸에 모은다.
   * 모음을 버리는 것이 요점이다 · 「nut / 너트」 의 차이는 모음(u ↔ eo)과
   * 끼워 넣은 「으」 뿐이고, 자음(n · t)은 같다 */
  function key(word) {
    var s = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!s) { return ''; }
    s = s.replace(/ng/g, 'N').replace(/ch/g, 'J').replace(/sh/g, 'S')
         .replace(/ph/g, 'P').replace(/th/g, 'T').replace(/ck/g, 'K')
         .replace(/qu/g, 'K').replace(/x/g, 'KS');
    /* c 는 뒤에 오는 모음이 정한다 · cylinder 는 S, casting 은 K */
    s = s.replace(/c([eiy])/g, 'S$1').replace(/c/g, 'K');
    var map = { r: 'L', l: 'L', b: 'B', v: 'B', p: 'P', f: 'P', g: 'K', k: 'K',
                d: 'T', t: 'T', j: 'J', z: 'J', s: 'S', m: 'M', n: 'N', q: 'K' };
    var out = '', i, ch;
    for (i = 0; i < s.length; i += 1) {
      ch = s[i];
      if (ch >= 'A' && ch <= 'Z') { out += ch; continue; }          // 위에서 이미 옮긴 것
      if ('aeiouwy'.indexOf(ch) >= 0) { continue; }                  // 모음 · 반모음은 버린다
      if (ch === 'h') { out += 'H'; continue; }                       // ㅎ 은 소리가 난다
      if (map[ch]) { out += map[ch]; }
    }
    return out.replace(/(.)\1+/g, '$1');        // 겹친 자음은 하나로 (roller → L)
  }

  /* 모음만 거칠게 뽑는다 · 자음 뼈대가 같은 말을 가를 때만 쓴다.
   * 볼트와 벨트는 뼈대가 둘 다 BLT 다 · 가르는 것은 모음(o ↔ e)뿐이다 */
  function vkey(word) {
    var s = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    var out = '', i;
    var two = { ae: 'A', eo: 'O', eu: 'U', oe: 'O', wo: 'O', wi: 'I', ui: 'I',
                ya: 'A', yo: 'O', yu: 'U', ye: 'E' };
    for (i = 0; i < s.length; i += 1) {
      var p = s.substr(i, 2);
      if (two[p]) { out += two[p]; i += 1; continue; }
      var c = s[i];
      if (c === 'a') { out += 'A'; } else if (c === 'e') { out += 'E'; }
      else if (c === 'i' || c === 'y') { out += 'I'; }
      else if (c === 'o') { out += 'O'; } else if (c === 'u') { out += 'U'; }
    }
    return out;
  }

  function lev(a, b) {
    var m = a.length, n = b.length, i, j, prev, tmp;
    if (!m) { return n; }
    if (!n) { return m; }
    var row = [];
    for (j = 0; j <= n; j += 1) { row[j] = j; }
    for (i = 1; i <= m; i += 1) {
      prev = row[0]; row[0] = i;
      for (j = 1; j <= n; j += 1) {
        tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1,
                          prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[n];
  }

  // ---------------------------------------------------------------- 어휘
  /* 품명 · 품목군 · 설비명에서 영어 낱말을 모은다.
   * 손으로 적은 목록을 두지 않는 이유 · 자재가 바뀌면 그 목록이 먼저 낡고,
   * 없는 낱말로 옮기면 검색이 0건이 된다. 있는 낱말로만 옮긴다 */
  var LEX = null;
  function lexicon() {
    if (LEX) { return LEX; }
    var freq = {}, form = {};
    function eat(text) {
      String(text || '').split(/[^A-Za-z]+/).forEach(function (w) {
        if (w.length < 2) { return; }
        var k = w.toLowerCase();
        freq[k] = (freq[k] || 0) + 1;
        if (!form[k] || (w[0] >= 'A' && w[0] <= 'Z')) { form[k] = w; }
      });
    }
    var rows = (window.DB && window.DB.list) ? window.DB.list() : [];
    rows.forEach(function (r) { eat(r.name); eat(r.group); });
    if (window.DB && window.DB.equipment) {
      try {
        (window.DB.equipment() || []).forEach(function (e) { eat(e.name); });
      } catch (e) { /* 설비 목록이 없어도 품명만으로 충분하다 */ }
    }
    LEX = Object.keys(freq).map(function (k) {
      /* 끝소리 r 을 한국어가 흘리는 낱말인지 표시해 둔다 (filter → 필터) ·
       * 끝이 l 인 낱말(general → 제너럴)은 한국어도 그 소리를 낸다 · 흘리면 안 된다 */
      return { w: k, show: form[k], n: freq[k], key: key(k), vkey: vkey(k),
               softR: /re?$/.test(k) && !/le?$/.test(k) };
    }).filter(function (x) {
      /* 설비명에 섞인 라인 약호(EP · FM · TR · RM · QOC)는 자재 낱말이 아니다 ·
       * 두세 글자라 아무 말에나 걸린다 (「얼마야」 가 RM 이 됐다) */
      return !(x.show === x.show.toUpperCase() && x.show.length <= 3 && x.w !== 'brg');
    }).sort(function (a, b) { return b.n - a.n; });
    return LEX;
  }

  /* 소리가 아니라 뜻으로 옮기는 말 · 음차가 아니라서 뼈대가 닿지 않는다.
   * 값은 「품명에 있어야 하는 낱말」 이다 · 없으면 그 줄은 버린다(아래 alias 참고) */
  var MEAN = {
    '유압': 'hydraulic', '공압': 'pneumatics', '전기': 'electrical', '전자': 'electron',
    '기어': 'gear', '톱니바퀴': 'gear', '이음': 'joint', '축이음': 'coupling',
    '연결': 'coupling', '회전': 'rotary', '강철': 'steel', '주철': 'iron',
    '구리': 'copper', '동': 'copper', '고무': 'rubber', '금속': 'metal',
    '주물': 'casting', '주조': 'casting', '바퀴': 'wheel', '밀봉': 'seal',
    '기계가공': 'machining', '가공': 'machining', '공용': 'common', '예비품': 'spare',
    '송풍기': 'blower', '열교환기': 'exchanger', '윤활유': 'grease', '제어': 'control',
    '계장': 'instrument', '수동': 'manual', '마모': 'abrasion', '쐐기': 'wedge',
    '롤': 'roller', '롤러': 'roller', '축받이': 'bearing',
    /* 영어 ea 는 낱말마다 소리가 다르다 (seal 은 「실」, bearing 은 「베어」) ·
     * 소리로는 가를 수 없어 여기에 적는다 */
    '씰': 'seal', '실': 'seal'
  };

  /* 우리 업무에서 쓰는 한국어 · 자재명이 아니다.
   * 이걸 두지 않으면 「발주(BLJ)」 가 「valve(BLB)」 로 둔갑한다 · 한 글자 차이다 */
  var STOP = ('재고 자재 발주 감축 공용화 반납 구매 신청 목표 적정 보유 목적 판단 분석 '
    + '금액 가격 단가 수량 개수 품목 품명 부서 설비 정비 계획 보험 오늘 이번 지금 현재 '
    + '알려 알려줘 보여 보여줘 찾아 찾아줘 검색 확인 얼마 몇개 어디 어떤 무엇 뭐야 있어 '
    + '없어 해줘 대해 대한 관련 상태 현황 목록 리스트 화면 이동 열어 열어줘 모두 전체 '
    + '부족 초과 과잉 정체 회수 절감 비용 기준 어제 내일 주간 월간 시점 마감 납기 '
    + '가능 필요 추천 판정 확정 대기 이유 근거 방법 시작 종료 나머지 그리고 얼마나 '
    + '정도 보류 수준 이상 이하 미만 경우 부분 상황 결과 문제 내용 자료 담당 운영 작업 '
    + '공정 현장 공장 창고 입고 출고 불출 이송 점검 수리 교체 교환 폐기 등록 조회 입력 '
    + '출력 저장 전송 완료 진행 취소 승인 반려 요청 응답 변경 추가 삭제 수정 검토 보고').split(' ');

  /* 「얼마야」 처럼 어미가 붙어 오는 말도 걸러야 한다 ·
   * 앞에서부터 잘라 보아 업무 한국어가 나오면 자재명이 아니다 (얼마야 → 얼마) */
  function stop(t) {
    var i;
    for (i = t.length; i >= 2; i -= 1) {
      if (STOP.indexOf(t.slice(0, i)) >= 0) { return true; }
    }
    return false;
  }

  /* 같은 것을 가리키는 두 표기 · 품명은 줄임말을 섞어 쓴다 (Bearing 2건 · BRG 17건).
   * 하나만 찾으면 나머지를 놓친다 · 찾을 때는 둘 다 쓴다 */
  var SYN = { bearing: ['bearing', 'brg'], brg: ['bearing', 'brg'] };

  // ---------------------------------------------------------------- 한 낱말 맞추기
  /* 뼈대가 같으면 바로 받는다. 한 글자 차이는 뼈대가 5자 이상일 때만 받는다 ·
   * 짧은 말일수록 한 글자가 뜻을 통째로 바꾼다 (발주 → valve 가 그 예다) */
  function match(token) {
    var t = String(token || '').trim();
    if (!/^[가-힣]+$/.test(t) || stop(t)) { return null; }
    var L = lexicon();
    function pick(word) {
      var i;
      for (i = 0; i < L.length; i += 1) { if (L[i].w === word) { return L[i]; } }
      return null;
    }
    if (MEAN[t]) {
      var m = pick(MEAN[t]);
      // 품명에 없는 낱말로는 옮기지 않는다 · 옮겨 봐야 0건이다
      if (m) { return { en: m.show, word: m.w, how: '뜻', d: 0 }; }
    }
    var rm = roman(t);
    var k = key(rm), v = vkey(rm);
    /* 뼈대가 두 자는 돼야 한다 · 한 자짜리는 아무 말에나 걸린다
     * (「내용」 도 「너희」 도 뼈대가 N 하나라 Non 이 됐다).
     * 뼈대가 한 자인 자재 낱말(롤러 · 기어)은 아래 MEAN 에 적어 두었다 */
    if (k.length < 2) { return null; }

    var cands = [], i, cand, d;
    for (i = 0; i < L.length; i += 1) {
      cand = L[i];
      if (!cand.key) { continue; }
      d = lev(k, cand.key);
      /* 영어 끝의 r 은 한국어가 발음하지 않는다 (filter → 필터 · motor → 모터) ·
       * 끝의 L 하나를 뺀 모양이 딱 맞으면 같은 말로 본다 */
      if (d === 1 && cand.softR && cand.key.length >= 3 &&
          cand.key.replace(/L$/, '') === k) { d = 0; }
      if (d > 1) { continue; }
      /* 한 글자 차이는 뼈대가 길 때만 봐준다 ·
       * 짧은 말은 한 글자가 뜻을 통째로 바꾼다 (발주 BLJ → valve BLB) */
      if (d === 1 && Math.max(k.length, cand.key.length) < 5) { continue; }
      /* 자음만 보면 우리말 조사 · 부사가 자재명으로 둔갑한다 (「중에」 JN = chain JN).
       * 모음도 어느 정도는 맞아야 한다 · 한국어가 끼워 넣는 「으」 한 자쯤은 봐준다 */
      var vd = lev(v, cand.vkey);
      if (vd > 1 + Math.floor(k.length / 4)) { continue; }
      cands.push({ en: cand.show, word: cand.w, how: '소리', d: d, vd: vd, n: cand.n });
    }
    if (!cands.length) { return null; }
    /* 뼈대가 같은 것이 여럿이면 모음이 가른다 (볼트 ↔ 벨트) ·
     * 모음까지 같으면 품명에 더 자주 나오는 쪽이다 */
    cands.sort(function (a, b) { return (a.d - b.d) || (a.vd - b.vd) || (b.n - a.n); });
    return cands[0];
  }

  /* 찾을 때 쓸 영어 낱말들 · 줄임말이 따로 있으면 같이 준다 (bearing · BRG) */
  function terms(token) {
    var m = match(token);
    if (!m) { return []; }
    var list = SYN[m.word] ? SYN[m.word].slice() : [m.word];
    /* 품명에 적힌 모양 그대로 돌려준다 (bearing → Bearing · brg → BRG) ·
     * 화면에 「베어링 → bearing · brg」 라고 적히면 우리가 만든 말처럼 보인다 */
    var L = lexicon();
    return list.map(function (w) {
      var i;
      for (i = 0; i < L.length; i += 1) { if (L[i].w === w) { return L[i].show; } }
      return w;
    });
  }

  // ---------------------------------------------------------------- 문장 바꾸기
  /* 한글 덩어리만 골라 바꾼다 · 나머지 글자는 손대지 않는다.
   * 바꾼 짝(너트 → Nut)을 같이 돌려준다 · 화면이 그대로 보여 줘야 한다 */
  function translate(text) {
    var s = String(text || '');
    var pairs = [], seen = {};
    var out = s.replace(/[가-힣]+/g, function (tok) {
      var m = match(tok);
      if (!m) { return tok; }
      if (!seen[tok]) { seen[tok] = 1; pairs.push([tok, m.en, m.how]); }
      return m.en;
    });
    return { text: out, pairs: pairs, changed: pairs.length > 0 };
  }

  /* 검색어 하나를 바꾼다 · 「너트」 처럼 낱말 하나로 들어올 때 쓴다 */
  function term(text) {
    var m = match(String(text || '').trim());
    return m ? m.en : null;
  }

  return { translate: translate, term: term, terms: terms, match: match,
           roman: roman, key: key, vkey: vkey, lexicon: lexicon,
           MEAN: MEAN, SYN: SYN, STOP: STOP };
})();
