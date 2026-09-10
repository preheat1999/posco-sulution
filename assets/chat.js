/* chat.js · AI 자재 질의 서랍 (사내 RAG)
 *
 * 오른쪽에서 밀려 나오는 380px 패널. 모든 화면이 같이 쓴다.
 *
 * 질문이 세 갈래다 ·
 *   1) 이 서비스의 숫자 · 「발주 필요 몇 품목」 「감축 금액 얼마」 「Q1000108 목표재고」
 *      → 브라우저 안에서 어댑터로 답한다 (assets/ask.js) · 즉시 · 숫자가 LLM 을 거치지 않는다
 *   2) 이 서비스의 화면 · 용어 · 출처 · 「stale 이 뭐야」 「히트맵 상자 크기」
 *      → 카탈로그(assets/catalog.js)로 답한다
 *   3) 사내 규정 · 절차 → RAG 서버(문서 30건 · 6,901조각)가 답한다 · 6~11초 걸린다
 *
 * 어느 갈래인지 고르는 것은 질의 라우터다 ·
 *   먼저 규칙(ASK.fast)으로 맞춰 보고, 안 맞으면 serve.py 의 /llm/route 가 도구 하나를
 *   골라 준다 (질문 문장과 도구 목록만 LLM 에 보낸다 · 자재 값은 보내지 않는다).
 *   데이터로 못 찾으면 문서에 다시 물어보고, 그래도 없으면 없다고 적는다.
 *
 * 이 파일이 화면에서 하는 일 ·
 *   1) RAG 스트림(NDJSON)의 진행 단계와 글자를 도착하는 대로 그린다.
 *   2) 답변의 [n] 인용을 citations[n] 출처 카드와 연결한다 · 출처 없는 답처럼 보이면 안 된다.
 *   3) 근거를 못 찾은 답(no_answer)은 경고 톤으로 따로 보인다.
 *   4) 데이터 · 설명 답에는 「어느 함수 · 어느 필드 · 기준일」 근거와 화면 링크를 붙인다.
 *
 * 토큰(X-API-Token)은 코드에 두지 않는다 · 저장소가 공개라서다.
 *
 * 부르는 길 두 가지 ·
 *   1) 프록시 (CFG.CHAT_PROXY) · serve.py 가 띄운 같은 출처의 /rag 를 부른다.
 *      토큰은 서버가 붙이고, CORS 는 애초에 생기지 않는다 (폰도 그대로 된다).
 *   2) 직접 · CFG.CHAT_API 가 RAG 서버 주소일 때. 그때는 토큰이 필요하고
 *      서버 허용 목록에 있는 주소(localhost:3000 등)에서만 열린다.
 */
(function () {
  'use strict';

  var CFG = window.CFG || {};
  var API = String(CFG.CHAT_API || '').replace(/\/+$/, '');
  var TOKEN_KEY = 'mtrl.chat.token';
  var PAGE = window.PAGE || '';

  var open = false;
  var busy = false;
  /* turns · {q, mode:'doc'|'data'|'about', status:'run'|'done'|'error', stages, text, res, err,
   *          local(ASK 결과), tool, routeMs} */
  var turns = [];
  var health = null;       // /api/health 결과 · null 이면 아직 모름
  var timer = null;

  /* 화면마다 다른 추천 질문.
   *
   * 여기 있는 열여덟 개는 **전부 실제로 물어보고 골랐다** (30개 후보 중).
   * 추천 질문을 눌렀는데 「근거를 못 찾았습니다」 가 나오면 시연에서 그 자리가 빈다 ·
   * 그래서 문서로 답이 나오고 출처가 붙는 것만 남겼다. 떨어진 것 예 ·
   *   「핵심예비품 지정 기준」 · 「적정재고는 어떻게 산정하나요」(route sql · 산출 결과가
   *   원천에 없다고 답한다) · 「정비 자재는 언제까지 발주해야 하나요」 · 「재고 실사」.
   *
   * 우리 대시보드 숫자(감축 금액 · 회색지대 건수)를 묻는 질문은 두지 않는다 ·
   * 그 답은 사내 문서가 아니라 이 화면들이 갖고 있다.
   * 질문을 고칠 때는 probe 로 다시 확인한다 (scratchpad/probe.py).
   */
  var SUGGEST = {
    main: ['자재 입하 검수 절차를 알려주세요', '보험품과 계획품의 차이는 무엇인가요',
           '자재 반납 절차를 알려주세요'],
    attr: ['보험품과 계획품은 어떻게 구분하나요', '중고자재 상태 판정은 어떻게 하나요',
           '자재 재고부서를 변경하는 방법은 무엇인가요'],
    stock: ['안전재고 보유 기준이 있나요', '장기 재고 자재는 어떻게 처리하나요',
            '자재 저장관리 기준을 알려주세요'],
    plan: ['구매요청 납기는 어떻게 정하나요', '긴급 구매신청 절차를 알려주세요',
           '계약 납기가 지연되면 어떤 조치를 하나요'],
    pool: ['공용자재 활용 절차를 알려주세요', '타 부서 자재를 이관받는 방법은 무엇인가요',
           '불용자재 처리 절차를 알려주세요'],
    purchase: ['구매신청 작성 방법을 알려주세요', '구매요구 승인 절차는 어떻게 되나요',
               '단가계약 자재는 어떻게 구매하나요'],
    'return': ['자재 반납 절차를 알려주세요', '당월 미불출 자재 반납 방법은 무엇인가요',
               'Consignment 자재는 어떻게 반납하나요']
  };
  var STAGES = ['질의 분석', '사내 문서 검색', '근거 정밀 선별', '답변 작성'];

  function esc(s) { return window.UI ? UI.esc(s) : String(s); }
  function el(id) { return document.getElementById(id); }
  /* 프록시로 부를 때는 토큰이 필요 없다 · 서버가 붙인다.
   * 직접 부를 때는 .env 에서 내려온 값 → 이 브라우저에 넣어 둔 값 순으로 찾는다 */
  var PROXY = !!CFG.CHAT_PROXY;
  function token() {
    if (PROXY) { return 'proxy'; }        // 화면이 「토큰 없음」 으로 멈추지 않게 하는 표시값
    if (CFG.CHAT_TOKEN) { return String(CFG.CHAT_TOKEN); }
    try { return window.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function tokenFromEnv() { return PROXY || !!CFG.CHAT_TOKEN; }
  function suggest() { return SUGGEST[PAGE] || SUGGEST.main; }

  // ---------------------------------------------------------------- 뼈대
  function build() {
    var btn = document.createElement('button');
    btn.className = 'chatbtn';
    btn.id = 'chatbtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'AI 자재 질의');
    /* 오른쪽 점은 연결 상태다 · 초록이면 붙었고 회색이면 아직이다 */
    btn.innerHTML = '<span class="cbi">✦</span><span class="cbt">AI 자재 질의</span>' +
      '<span class="cbd" id="cbd"></span>';

    var wrap = document.createElement('aside');
    wrap.className = 'chatpane';
    wrap.id = 'chatpane';
    wrap.setAttribute('hidden', '');
    document.body.appendChild(btn);
    document.body.appendChild(wrap);

    btn.addEventListener('click', function () { toggle(true); });

    wrap.addEventListener('click', function (e) {
      if (e.target.closest('#chatx')) { toggle(false); return; }
      var s = e.target.closest('[data-ask]');
      if (s) { ask(s.getAttribute('data-ask')); return; }
      if (e.target.closest('#chatsend')) { send(); return; }
      if (e.target.closest('#tokensave')) { saveToken(); return; }
      if (e.target.closest('#tokenclear')) { clearToken(); return; }
      var c = e.target.closest('[data-cite]');
      if (c) { showCite(c); return; }
      var src = e.target.closest('[data-src]');
      if (src) { src.classList.toggle('open'); return; }
      var rt = e.target.closest('#chatretry');
      if (rt) { ping(true); }
    });

    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'chatq' && !e.shiftKey) {
        e.preventDefault(); send();
      }
      if (e.key === 'Enter' && e.target && e.target.id === 'tokenin') {
        e.preventDefault(); saveToken();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { toggle(false); }
    });

    ping(false);
  }

  function toggle(on) {
    open = on;
    var p = el('chatpane');
    p.hidden = !on;
    p.classList.toggle('on', on);
    if (on) { paint(); focusInput(); }
  }

  function focusInput() {
    var q = el('chatq');
    if (q && !q.disabled) { try { q.focus(); } catch (e) { /* 무시 */ } }
  }

  // ---------------------------------------------------------------- 연결 확인
  /* /api/health 는 토큰이 없어도 열린다. 서버가 떠 있는지, 모델이 올라왔는지만 본다 */
  function ping(repaint) {
    if (!API || typeof fetch !== 'function') { health = { ok: false, why: 'noapi' }; dot(); return; }
    fetch(API + '/api/health').then(function (r) { return r.json(); }).then(function (j) {
      health = { ok: j && j.status === 'ok' && j.models_loaded === true, raw: j };
      dot(); if (repaint && open) { paint(); }
    }).catch(function (e) {
      /* fetch 자체가 실패하면 대개 CORS 나 다른 Wi-Fi 다. 원인을 짚어 준다 */
      health = { ok: false, why: 'fetch', err: String(e && e.message || e) };
      dot(); if (repaint && open) { paint(); }
    });
  }

  function dot() {
    var d = el('cbd');
    if (!d) { return; }
    d.className = 'cbd' + (health && health.ok && token() ? ' on' : '');
  }

  // ---------------------------------------------------------------- 그리기
  function paint() {
    var live = !!API;
    var tk = token();
    /* 문서가 안 붙어도 이 서비스 데이터 질문은 답할 수 있다 · 입력칸을 막지 않는다 */
    var usable = (live && tk) || !!CFG.ASK_ROUTE;
    var pane = el('chatpane');
    if (!pane) { return; }

    pane.innerHTML =
      '<div class="chat-top">' +
        '<div style="min-width:0">' +
          '<div class="chat-title">✦ AI 자재 질의</div>' +
          '<div class="chat-sub">' + subline() + '</div>' +
        '</div>' +
        '<button class="homebtn" type="button" id="chatx" aria-label="닫기">✕</button>' +
      '</div>' +

      '<div class="chat-body" id="chatbody" aria-live="polite">' +
        (!live ? offline() : (!tk ? tokenForm() : '')) +
        (health && !health.ok && live ? connWarn() : '') +
        (turns.length ? turns.map(turnHtml).join('')
          : (live && tk ? intro() : '')) +
      '</div>' +

      '<div class="chat-foot">' +
        '<div class="chat-chips">' + suggest().map(function (s) {
          return '<button class="chip" type="button" data-ask="' + esc(s) + '"' +
            (busy || !usable ? ' disabled' : '') + '>' + esc(s) + '</button>';
        }).join('') + '</div>' +
        '<div class="chat-input">' +
          '<input class="input" id="chatq" autocomplete="off" placeholder="' +
            (usable ? '이 서비스 숫자 · 화면 · 사내 문서를 물어보세요' : '연결 설정이 필요합니다') + '"' +
            (usable ? '' : ' disabled') + '>' +
          '<button class="btn" type="button" id="chatsend"' +
            (busy || !usable ? ' disabled' : '') + '>' +
            (busy ? '답변 중' : '보내기') + '</button>' +
        '</div>' +
        (tk
          ? '<div class="chat-tools">' + (tokenFromEnv()
            ? '<span class="chat-tsrc">' + (PROXY
              ? '서버 프록시 · 토큰은 서버에서 붙입니다'
              : '토큰 · .env') + '</span>'
            : '<button class="linkbtn" type="button" id="tokenclear">토큰 지우기</button>') +
            '</div>'
          : '') +
      '</div>';
    scrollEnd();
  }

  function subline() {
    if (!API) { return '연동 예정 · CHAT_API 가 비어 있습니다'; }
    if (!health) { return '연결 확인 중'; }
    if (!health.ok) { return '서버에 닿지 않습니다'; }
    var r = health.raw || {};
    return '사내 문서 ' + (window.UI ? UI.num(r.n_chunks || 0) : (r.n_chunks || 0)) +
      '조각 · ' + (r.llm && r.llm.model ? r.llm.model : 'LLM') + ' · 문서 근거로만 답합니다';
  }

  function intro() {
    var route = !!CFG.ASK_ROUTE;
    return '<div class="chat-ai chat-intro">' +
      '<b>세 가지를 물어볼 수 있습니다.</b><br>' +
      '<span class="mtag data">이 서비스 데이터</span> 발주 필요 몇 품목 · 감축 금액 · 자재 한 건 · 순위<br>' +
      '<span class="mtag about">서비스 설명</span> 항목 뜻 · 화면이 하는 일 · 이 수치의 출처<br>' +
      '<span class="mtag doc">사내 문서</span> 절차 · 규정 · 매뉴얼 (출처 번호가 붙습니다)<br>' +
      (route
        ? '앞의 둘은 <b>이 브라우저 안에서 즉시</b> 답하고, 문서 질문만 <b>6~11초</b> 걸립니다.'
        : '지금은 문서 질문만 됩니다 · 질의 라우터가 꺼져 있습니다 (.env 의 LLM_API_KEY).') +
      '</div>';
  }

  function offline() {
    return '<div class="callout pln"><span class="ci">✦</span>' +
      '<span><b>RAG 연동 전입니다</b>assets/config.js 의 <b>CHAT_API</b> 가 비어 있습니다.</span></div>';
  }

  /* 토큰은 저장소에 두지 않는다. 이 브라우저에 한 번 넣는다 */
  function tokenForm() {
    return '<div class="callout" style="background:var(--surface-2);border:1px solid var(--line)">' +
      '<span class="ci" style="color:var(--b1)">⚿</span>' +
      '<span><b style="color:var(--text)">접근 토큰을 넣어 주세요</b>' +
      'RAG 서버(' + esc(API) + ')는 X-API-Token 이 있어야 답합니다. ' +
      '토큰은 이 브라우저에만 저장되고 저장소에는 올라가지 않습니다.' +
      '<div class="chat-input" style="margin-top:10px">' +
        '<input class="input" id="tokenin" type="password" autocomplete="off" placeholder="X-API-Token">' +
        '<button class="btn" type="button" id="tokensave">저장</button>' +
      '</div></span></div>';
  }

  function connWarn() {
    var why;
    if (health.why !== 'fetch') {
      why = '서버가 살아 있지만 모델이 아직 올라오지 않았습니다.';
    } else if (PROXY) {
      /* 프록시를 쓰면 CORS 는 원인이 아니다 · RAG 서버가 꺼졌거나 다른 Wi-Fi 다 */
      why = '이 서버가 RAG 서버(' + esc(CFG.CHAT_API_UPSTREAM || '주소 미확인') +
        ')에 닿지 못했습니다. RAG 서버가 켜져 있는지, 같은 Wi-Fi 인지 확인하세요.';
    } else {
      why = '브라우저가 서버에 닿지 못했습니다. 이 화면의 주소(' + esc(location.origin) +
        ')가 서버의 허용 목록에 없거나(CORS), 다른 Wi-Fi 일 수 있습니다. ' +
        '허용된 주소는 http://localhost:3000 · :5173 · :8000 입니다 · ' +
        'serve.py 로 띄우면 프록시를 거쳐 어느 주소에서도 됩니다.';
    }
    return '<div class="callout ins"><span class="ci">!</span><span><b>연결되지 않았습니다</b>' +
      why + ' <button class="linkbtn" type="button" id="chatretry">다시 확인</button></span></div>';
  }

  // ---------------------------------------------------------------- 한 턴
  function turnHtml(t, i) {
    var me = '<div class="chat-me">' + esc(t.q) + '</div>';
    if (t.status === 'done' && t.local) { return me + localHtml(t, i); }
    if (t.status === 'error') {
      return me + '<div class="chat-ai noans"><span class="na-ico">!</span>' +
        '<div><b>답을 받지 못했습니다</b><div class="na-why">' + esc(t.err) + '</div></div></div>';
    }
    if (t.status === 'run') { return me + runningHtml(t, i); }
    return me + answerHtml(t, i);
  }

  /* 이 서비스 데이터 · 설명 답. 숫자는 어댑터에서 온 값이고 LLM 을 거치지 않았다 */
  function localHtml(t, i) {
    var r = t.local;
    if (r.unknown) {
      return '<div class="chat-ai noans" id="turn-' + i + '">' +
        '<span class="na-ico">?</span><div><b>답할 수 있는 값이 아닙니다</b>' +
        '<div class="md">' + MD.render(r.text) + '</div>' +
        '<div class="na-why">사내 문서에도, 이 서비스 데이터에도 없었습니다 · ' +
        '아래 추천 질문처럼 물어보면 답할 수 있습니다.</div></div></div>';
    }
    var tag = r.kind === 'about'
      ? '<span class="mtag about">서비스 설명</span>'
      : '<span class="mtag data">이 서비스 데이터</span>';
    var table = r.table ? tableHtml(r.table) : '';
    var ev = (r.evidence || []).length
      ? '<div class="chat-srcs"><div class="cs-h">근거 · 이 값이 나온 곳</div>' +
        r.evidence.map(function (p) {
          return '<div class="evrow"><span class="evk">' + esc(p[0]) + '</span>' +
            '<span class="evv">' + esc(p[1]) + '</span></div>';
        }).join('') + '</div>'
      : '';
    var link = r.link
      ? '<a class="btn line sm" href="' + esc(r.link.href) + '" style="margin-top:10px">' +
        esc(r.link.label) + ' →</a>'
      : '';
    var meta = '<div class="chat-meta">' + tag +
      (t.tool ? ' · ' + esc(t.tool) : '') +
      (t.routeMs ? ' · 라우터 ' + t.routeMs + 'ms' : ' · 규칙 매치') +
      ' · 브라우저 안에서 계산 (외부로 보내지 않음)</div>';
    return '<div class="chat-ai" id="turn-' + i + '">' +
      '<div class="md">' + MD.render(r.text) + '</div>' + table + ev + link + meta + '</div>';
  }

  function tableHtml(t) {
    return '<div class="md-table" style="margin-top:10px"><table><thead><tr>' +
      (t.head || []).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      (t.rows || []).map(function (row) {
        return '<tr>' + row.map(function (c, k) {
          var v = String(c === undefined || c === null ? '' : c);
          var numish = k > 0 && /\d/.test(v) && /^[\d,.\-+%\s원건개품목→]+$/.test(v);
          return '<td' + (numish ? ' class="num"' : '') + '>' + esc(v) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* 진행 중 · 단계 네 칸과 도착한 글자 */
  function runningHtml(t, i) {
    var done = {};
    (t.stages || []).forEach(function (s) { done[s.name] = s; });
    var cur = -1;
    STAGES.forEach(function (n, k) { if (done[n] && cur < k) { cur = k; } });
    var rows = STAGES.map(function (n, k) {
      var s = done[n];
      var cls = s ? 'done' : (k === cur + 1 ? 'now' : '');
      var extra = s ? (s.candidates ? ' · 후보 ' + s.candidates + '건'
        : (s.sources ? ' · 근거 ' + s.sources + '건' : '')) : '';
      return '<div class="st ' + cls + '"><i></i><span>' + esc(n) + '</span>' +
        '<b>' + (s ? (s.ms / 1000).toFixed(1) + 's' : (k === cur + 1 ? '…' : '')) + esc(extra) + '</b></div>';
    }).join('');
    var sec = t.t0 ? ((Date.now() - t.t0) / 1000).toFixed(0) : '0';
    var pre = '<div class="st ' + (t.tool ? 'done' : 'now') + '"><i></i><span>질문 갈래 고르기</span>' +
      '<b>' + (t.routeMs ? (t.routeMs / 1000).toFixed(1) + 's · ' + esc(t.tool || '') : '…') +
      '</b></div>';
    return '<div class="chat-ai run" id="turn-' + i + '">' +
      (CFG.ASK_ROUTE ? '<div class="stages">' + pre + '</div>' : '') +
      (t.fellBack ? '<div class="chat-rw">이 서비스 데이터에는 없어 사내 문서에 다시 물어봅니다</div>' : '') +
      (t.route && t.route !== 'rag' ? routeBadge(t.route) : '') +
      '<div class="stages">' + rows + '</div>' +
      (t.text ? '<div class="md live">' + MD.render(t.text) + '<span class="caret"></span></div>' : '') +
      '<div class="chat-meta">' + sec + '초 경과 · 사내 문서를 검색하고 근거를 다시 고르는 중입니다</div>' +
      '</div>';
  }

  function routeBadge(route) {
    var label = { sql: '정형 데이터 조회', hybrid: '문서 + 데이터' }[route] || route;
    return '<span class="badge plan" style="margin-bottom:8px">' + esc(label) + '</span> ';
  }

  /* 끝난 답 · 마크다운 → [n] 인용 칩 → 출처 카드 */
  function answerHtml(t, i) {
    var r = t.res || {};
    var cites = r.citations || [];
    var byIdx = {};
    cites.forEach(function (c) { byIdx[c.index] = c; });

    var html = MD.render(r.answer || t.text || '');
    html = linkCites(html, byIdx, i);

    var head = '';
    if (t.fellBack) {
      head += '<div class="chat-rw">이 서비스 데이터에는 없어서 사내 문서에서 찾았습니다</div>';
    }
    if (r.rewritten_question) {
      head += '<div class="chat-rw">앞 대화를 반영해 「' + esc(r.rewritten_question) +
        '」 로 이해하고 검색했습니다</div>';
    }
    if (r.route && r.route !== 'rag') { head += routeBadge(r.route); }

    if (r.no_answer) {
      /* 근거를 못 찾았다고 하면서도 「참고:」 로 문서를 붙여 오는 답이 있다.
       * 그 출처를 감추면 어디서 나온 참고인지 확인할 길이 없다 · 접어서 같이 둔다 */
      return '<div class="chat-ai noans" id="turn-' + i + '">' + head +
        '<span class="na-ico">⚠</span><div><b>사내 문서에서 근거를 찾지 못했습니다</b>' +
        '<div class="md">' + html + '</div>' +
        '<div class="na-why">이 답은 <b>확정 근거가 없습니다</b> · 그대로 업무에 쓰지 마세요. ' +
        '질문을 바꾸거나 담당자에게 확인하세요.</div>' +
        (cites.length
          ? '<div class="chat-srcs"><div class="cs-h">참고로 찾은 문서 ' + cites.length +
            '건 · 질문에 대한 답은 아닙니다</div>' +
            cites.map(function (c) { return srcCard(c, i); }).join('') + '</div>'
          : '') +
        '</div></div>';
    }

    /* 출처 줄 · 문서 답은 citations 가 출처다. 정형 데이터(sql) 답은 문서가 아니라 DB 를
     * 읽은 것이라 citations 가 비어 있고, 답 본문 끝의 [출처] 줄이 그 자리를 대신한다 ·
     * 그걸 「근거 없음」 으로 적으면 거짓이 된다 */
    var srcs;
    if (cites.length) {
      srcs = '<div class="chat-srcs"><div class="cs-h">출처 ' + cites.length + '건' +
        (r.metrics && r.metrics.citation_coverage !== undefined
          ? ' · 인용된 문장 ' + Math.round(r.metrics.citation_coverage * 100) + '%' : '') + '</div>' +
        cites.map(function (c) { return srcCard(c, i); }).join('') + '</div>';
    } else if (r.route === 'sql' || r.route === 'hybrid') {
      srcs = '<div class="chat-srcs"><div class="cs-h">출처 · 정형 데이터 조회 (본문 끝 [출처] 줄) · ' +
        '연습용 샘플 데이터입니다</div></div>';
    } else {
      srcs = '<div class="chat-srcs"><div class="cs-h warn">출처가 오지 않았습니다 · 근거 없는 답으로 보세요</div></div>';
    }

    var meta = r.metrics && r.metrics.total_ms
      ? '<div class="chat-meta">' + (r.metrics.total_ms / 1000).toFixed(1) + '초 · ' +
        ({ sql: '정형 데이터 조회', hybrid: '문서 + 데이터' }[r.route] || '사내 문서 근거') + '</div>' : '';

    return '<div class="chat-ai" id="turn-' + i + '">' + head +
      '<div class="md">' + html + '</div>' + srcs + meta + '</div>';
  }

  /* [n] 을 클릭 칩으로. 태그 안은 건드리지 않고 글자 마디에만 적용한다 ·
   * 짝이 되는 출처가 없으면 눌러도 갈 곳이 없으니 흐린 칩으로 둔다 */
  function linkCites(html, byIdx, ti) {
    return html.split(/(<[^>]+>)/g).map(function (part) {
      if (part.charAt(0) === '<') { return part; }
      return part.replace(/\[(\d{1,2})\]/g, function (m, n) {
        if (byIdx[Number(n)]) {
          return '<button class="cite" type="button" data-cite="' + n + '" data-turn="' + ti +
            '" title="출처 ' + n + ' 보기">' + n + '</button>';
        }
        return '<span class="cite off" title="이 번호의 출처가 오지 않았습니다">' + n + '</span>';
      });
    }).join('');
  }

  function srcCard(c, ti) {
    return '<div class="src" data-src="1" id="src-' + ti + '-' + c.index + '">' +
      '<div class="src-h"><span class="cite">' + c.index + '</span>' +
        '<span class="src-t">' + esc(c.source || c.file_name || '출처 미확인') + '</span>' +
        (c.date ? '<span class="src-d">' + esc(c.date) + '</span>' : '') + '</div>' +
      (c.snippet ? '<div class="src-s">' + esc(c.snippet) + '</div>' : '') +
      '</div>';
  }

  function showCite(btn) {
    var id = 'src-' + btn.getAttribute('data-turn') + '-' + btn.getAttribute('data-cite');
    var card = el(id);
    if (!card) { return; }
    card.classList.add('open', 'hit');
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    window.setTimeout(function () { card.classList.remove('hit'); }, 1400);
  }

  function scrollEnd() {
    var b = el('chatbody');
    if (b) { b.scrollTop = b.scrollHeight; }
  }

  // ---------------------------------------------------------------- 보내기
  function send() {
    var q = el('chatq');
    if (!q) { return; }
    var text = String(q.value || '').trim();
    if (!text) { return; }
    q.value = '';
    ask(text);
  }

  function saveToken() {
    var inp = el('tokenin');
    var v = inp ? String(inp.value || '').trim() : '';
    if (!v) { return; }
    try { window.localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* 무시 */ }
    dot(); paint(); focusInput();
  }

  function clearToken() {
    try { window.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 무시 */ }
    dot(); paint();
  }

  /* 질문 하나 · 어느 갈래인지 고르고 그 갈래로 답한다.
   *
   *   1 규칙 매치 (ASK.fast) · 자재코드 · 자주 묻는 말 → 즉시
   *   2 질의 라우터 (/llm/route) · 도구 하나를 고른다
   *   3 도구 실행 · 우리 데이터로 답한다 (숫자가 LLM 을 거치지 않는다)
   *   4 문서 · ask_documents 이거나 데이터로 못 찾았을 때 RAG 에 물어본다
   *
   * 서버는 한 번에 한 질문씩 처리한다 · 답이 오는 동안 새 질문을 막는다 */
  function ask(qtext) {
    if (busy) { return; }
    var t = { q: qtext, status: 'run', stages: [], text: '', t0: Date.now(), route: null };
    turns.push(t);
    busy = true;

    /* 1 · 규칙으로 바로 맞는 질문은 LLM 을 부르지 않는다 */
    var hit = window.ASK ? ASK.fast(qtext) : null;
    if (hit) {
      var quick = ASK.run(hit.tool, hit.input);
      if (quick && !quick.unknown) {
        t.local = quick; t.tool = hit.tool; t.status = 'done';
        busy = false; paint(); focusInput();
        return;
      }
    }

    paint();
    startTimer();

    if (!CFG.ASK_ROUTE) { toDocs(t, qtext); return; }

    routeQuestion(qtext).then(function (pick) {
      t.routeMs = pick && pick.ms;
      var tool = pick && pick.tool;
      t.tool = tool;
      if (!tool || tool === 'ask_documents') {
        toDocs(t, (pick && pick.input && pick.input.question) || qtext);
        return;
      }
      var out = window.ASK ? ASK.run(tool, pick.input) : null;
      if (out && !out.unknown) {
        t.local = out; t.status = 'done';
        stopTimer(); busy = false; paint(); focusInput();
        return;
      }
      /* 데이터로 못 찾았다 · 문서에 다시 물어본다 (사내 규정에는 있을 수 있다) */
      t.fellBack = out ? out.text : null;
      toDocs(t, qtext);
    }).catch(function () {
      /* 라우터가 안 되면 문서 쪽으로 보낸다 · 질문을 버리지 않는다 */
      toDocs(t, qtext);
    });
  }

  /* 라우터에 질문 문장만 보낸다 · 자재 값은 보내지 않는다 */
  function routeQuestion(q) {
    var hist = turns.slice(0, -1).slice(-2).map(function (x) { return { question: x.q }; });
    return fetch(CFG.ASK_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, history: hist })
    }).then(function (r) {
      if (!r.ok) { throw new Error('HTTP ' + r.status); }
      return r.json();
    });
  }

  /* 문서 갈래 · 지금까지와 같다 */
  function toDocs(t, question) {
    t.mode = 'doc';
    if (!API || !token()) {
      t.status = 'error';
      t.err = API ? '토큰이 없어 문서에 물어볼 수 없습니다' : 'RAG 주소(CHAT_API)가 없습니다';
      finish(t);
      return;
    }
    var history = turns.slice(0, -1).filter(function (x) { return x.status === 'done' && x.res; })
      .slice(-4).map(function (x) { return { question: x.q, answer: x.res.answer || '' }; });
    stream(question, history, t).then(function () {
      finish(t);
    }).catch(function (e) {
      t.status = 'error';
      t.err = friendly(e);
      finish(t);
    });
  }

  function finish(t) {
    if (t.status === 'run') { t.status = t.res ? 'done' : 'error'; }
    if (t.status === 'error' && !t.err) { t.err = '서버가 결과를 보내지 않았습니다'; }
    busy = false;
    stopTimer();
    paint();
    focusInput();
  }

  function friendly(e) {
    var m = String(e && e.message || e || '');
    if (/401|403/.test(m) && PROXY) {
      return '토큰이 맞지 않습니다 (' + m + ') · .env 의 CHAT_TOKEN 을 고치고 서버를 다시 띄우세요';
    }
    if (/401|403/.test(m)) {
      return tokenFromEnv()
        ? '토큰이 맞지 않습니다 (' + m + ') · .env 의 CHAT_TOKEN 을 확인하고 서버를 다시 띄우세요'
        : '토큰이 맞지 않습니다 (' + m + ') · 아래 「토큰 지우기」 뒤 다시 넣어 주세요';
    }
    if (/Failed to fetch|NetworkError|CORS/i.test(m)) {
      return '서버에 닿지 못했습니다 · 이 주소(' + location.origin + ')가 서버 허용 목록에 있는지, 같은 Wi-Fi 인지 확인하세요';
    }
    return m || '알 수 없는 오류';
  }

  /* 진행 중에는 1초마다 경과 시간만 다시 적는다 · 전체를 다시 그리면 스크롤이 튄다 */
  function startTimer() {
    stopTimer();
    timer = window.setInterval(function () {
      var t = turns[turns.length - 1];
      if (!t || t.status !== 'run') { stopTimer(); return; }
      repaintRun(t);
    }, 500);
  }
  function stopTimer() { if (timer) { window.clearInterval(timer); timer = null; } }

  function repaintRun(t) {
    var i = turns.length - 1;
    var node = el('turn-' + i);
    if (!node) { return; }
    var tmp = document.createElement('div');
    tmp.innerHTML = runningHtml(t, i);
    node.replaceWith(tmp.firstChild);
    scrollEnd();
  }

  /* NDJSON 스트림 · 한 줄이 이벤트 하나다. 줄이 잘려 오면 다음 덩어리와 이어 붙인다 */
  function stream(question, history, t) {
    return fetch(API + '/api/chat/stream', {
      method: 'POST',
      headers: PROXY
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', 'X-API-Token': token() },
      body: JSON.stringify({ question: question, category: null, history: history })
    }).then(function (res) {
      if (!res.ok) { throw new Error('HTTP ' + res.status); }
      if (!res.body || !res.body.getReader) {
        /* 스트림을 못 읽는 환경 · 통째로 받아서 마지막 result 만 쓴다 */
        return res.text().then(function (txt) { txt.split('\n').forEach(function (l) { onLine(l, t); }); });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { if (buf.trim()) { onLine(buf, t); } return; }
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function (l) { onLine(l, t); });
          return pump();
        });
      }
      return pump();
    });
  }

  function onLine(line, t) {
    line = String(line || '').trim();
    if (!line) { return; }
    var ev;
    try { ev = JSON.parse(line); } catch (e) { return; }   // 깨진 줄은 버린다
    if (ev.type === 'route') { t.route = ev.route || ev.name || null; repaintRun(t); return; }
    if (ev.type === 'stage') { t.stages.push(ev); repaintRun(t); return; }
    if (ev.type === 'delta') { t.text += String(ev.text || ''); repaintRun(t); return; }
    if (ev.type === 'result') { t.res = ev; t.status = 'done'; if (ev.route) { t.route = ev.route; } return; }
    if (ev.type === 'error') { throw new Error(ev.message || ev.detail || '서버 오류'); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  window.CHAT = {
    open: function () { toggle(true); },
    close: function () { toggle(false); },
    ask: function (q) { toggle(true); ask(q); },
    suggest: suggest
  };
})();
