/* chat.js · AI 자재 질의 서랍 (사내 RAG)
 *
 * 오른쪽에서 밀려 나오는 380px 패널. 모든 화면이 같이 쓴다.
 *
 * 답은 여기서 만들지 않는다 · RAG 서버(CFG.CHAT_API)가 사내 문서 30건을 검색해 낸다.
 * 이 파일이 하는 일은 셋이다.
 *   1) 스트림(NDJSON)을 받아 진행 단계와 답변 글자를 도착하는 대로 그린다.
 *      한 답에 6~11초가 걸린다 · 스피너만 돌리면 멈춘 줄 안다.
 *   2) 답변의 [n] 인용을 citations[n] 출처 카드와 연결한다 · 출처 없는 답처럼 보이면 안 된다.
 *   3) 근거를 못 찾은 답(no_answer)은 경고 톤으로 따로 보인다.
 *
 * 토큰(X-API-Token)은 코드에 두지 않는다 · 저장소가 공개라서다.
 * 이 브라우저의 localStorage 에 한 번 넣어 두고 쓴다 (서랍 안에서 넣을 수 있다).
 */
(function () {
  'use strict';

  var CFG = window.CFG || {};
  var API = String(CFG.CHAT_API || '').replace(/\/+$/, '');
  var TOKEN_KEY = 'mtrl.chat.token';
  var PAGE = window.PAGE || '';

  var open = false;
  var busy = false;
  var turns = [];          // {q, status:'run'|'done'|'error', stages:[], text, res, err}
  var health = null;       // /api/health 결과 · null 이면 아직 모름
  var timer = null;

  /* 화면마다 다른 추천 질문 · 사내 문서(지침 · 매뉴얼 · FAQ)로 답할 수 있는 것만 둔다.
   * 우리 대시보드 숫자를 묻는 질문은 여기 두지 않는다 · 그 답은 문서에 없다 */
  var SUGGEST = {
    main: ['자재 입하 검수 절차를 알려주세요', '보험품과 계획품의 차이는 무엇인가요',
           '자재 반납 절차를 알려주세요'],
    attr: ['보험품과 계획품은 어떻게 구분하나요', '핵심예비품(CSP) 지정 기준은 무엇인가요',
           '자재 속성이 바뀌면 재고 기준은 어떻게 달라지나요'],
    stock: ['안전재고 산정 공식을 설명해 주세요', '적정재고를 초과한 자재는 어떻게 처리하나요',
            '리드타임이 긴 자재의 재고 기준은 어떻게 정하나요'],
    plan: ['정비계획에 맞춰 자재를 언제 발주해야 하나요', '발주 마감일은 어떻게 정하나요',
           '대수리와 중수리는 준비 기간이 어떻게 다른가요'],
    pool: ['공용화 대상 자재 판정 기준은 무엇인가요', '타 부서 자재를 이관받는 절차는 무엇인가요',
           '장기 정체 자재는 어떻게 처리하나요'],
    purchase: ['구매신청(PR) 작성 절차를 알려주세요', '납기희망일은 어떻게 정하나요',
               '긴급 발주는 어떻게 처리하나요'],
    'return': ['자재 반납 절차를 알려주세요', '당월 미불출 자재 반납 방법은 무엇인가요',
               'Consignment 자재 반납은 어떻게 하나요']
  };
  var STAGES = ['질의 분석', '사내 문서 검색', '근거 정밀 선별', '답변 작성'];

  function esc(s) { return window.UI ? UI.esc(s) : String(s); }
  function el(id) { return document.getElementById(id); }
  function token() {
    try { return window.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
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
            (busy || !tk ? ' disabled' : '') + '>' + esc(s) + '</button>';
        }).join('') + '</div>' +
        '<div class="chat-input">' +
          '<input class="input" id="chatq" autocomplete="off" placeholder="' +
            (live && tk ? '사내 지침 · 매뉴얼에서 찾아 답합니다' : '연결 설정이 필요합니다') + '"' +
            (live && tk ? '' : ' disabled') + '>' +
          '<button class="btn" type="button" id="chatsend"' +
            (busy || !live || !tk ? ' disabled' : '') + '>' +
            (busy ? '답변 중' : '보내기') + '</button>' +
        '</div>' +
        (tk ? '<div class="chat-tools"><button class="linkbtn" type="button" id="tokenclear">' +
          '토큰 지우기</button></div>' : '') +
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
    return '<div class="chat-ai chat-intro">' +
      '<b>사내 지침 · 매뉴얼 · FAQ 에서 찾아 답합니다.</b><br>' +
      '모든 사실 문장에 <span class="cite demo">1</span> 같은 출처 번호가 붙고, 누르면 원문 조각이 열립니다. ' +
      '한 답에 <b>6~11초</b>가 걸립니다 · 문서를 검색하고 근거를 다시 고르는 시간입니다.</div>';
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
    var why = health.why === 'fetch'
      ? '브라우저가 서버에 닿지 못했습니다. 이 화면의 주소(' + esc(location.origin) +
        ')가 서버의 허용 목록에 없거나(CORS), 다른 Wi-Fi 일 수 있습니다. ' +
        '허용된 주소는 http://localhost:3000 · :5173 · :8000 입니다.'
      : '서버가 살아 있지만 모델이 아직 올라오지 않았습니다.';
    return '<div class="callout ins"><span class="ci">!</span><span><b>연결되지 않았습니다</b>' +
      why + ' <button class="linkbtn" type="button" id="chatretry">다시 확인</button></span></div>';
  }

  // ---------------------------------------------------------------- 한 턴
  function turnHtml(t, i) {
    var me = '<div class="chat-me">' + esc(t.q) + '</div>';
    if (t.status === 'error') {
      return me + '<div class="chat-ai noans"><span class="na-ico">!</span>' +
        '<div><b>답을 받지 못했습니다</b><div class="na-why">' + esc(t.err) + '</div></div></div>';
    }
    if (t.status === 'run') { return me + runningHtml(t, i); }
    return me + answerHtml(t, i);
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
    return '<div class="chat-ai run" id="turn-' + i + '">' +
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
    if (r.rewritten_question) {
      head += '<div class="chat-rw">앞 대화를 반영해 「' + esc(r.rewritten_question) +
        '」 로 이해하고 검색했습니다</div>';
    }
    if (r.route && r.route !== 'rag') { head += routeBadge(r.route); }

    if (r.no_answer) {
      return '<div class="chat-ai noans" id="turn-' + i + '">' + head +
        '<span class="na-ico">⚠</span><div><b>사내 문서에서 근거를 찾지 못했습니다</b>' +
        '<div class="md">' + html + '</div>' +
        '<div class="na-why">이 답은 문서 근거가 없습니다 · 그대로 업무에 쓰지 마세요. ' +
        '질문을 바꾸거나 담당자에게 확인하세요.</div></div></div>';
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

  /* 서버는 한 번에 한 질문씩 처리한다 · 답이 오는 동안 새 질문을 막는다 */
  function ask(qtext) {
    if (busy || !API || !token()) { return; }
    var t = { q: qtext, status: 'run', stages: [], text: '', t0: Date.now(), route: null };
    turns.push(t);
    busy = true;
    paint();
    startTimer();

    /* 최근 4턴만 맥락으로 보낸다 · 그 이상은 서버도 쓰지 않는다 */
    var history = turns.slice(0, -1).filter(function (x) { return x.status === 'done' && x.res; })
      .slice(-4).map(function (x) { return { question: x.q, answer: x.res.answer || '' }; });

    stream(qtext, history, t).then(function () {
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
    if (/401|403/.test(m)) { return '토큰이 맞지 않습니다 (' + m + ') · 아래 「토큰 지우기」 뒤 다시 넣어 주세요'; }
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
      headers: { 'Content-Type': 'application/json', 'X-API-Token': token() },
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
