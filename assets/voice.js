/* voice.js · 마이크 → 글자
 *
 * 챗봇 입력칸 옆 마이크 버튼이 부른다. 글자가 되면 그다음은 글로 친 질문과 완전히 같다 ·
 * 음성 전용 Agent 는 없다 (CHAT.ask → 같은 라우터 → 같은 도구).
 *
 * 두 길 ·
 *   1) 서버 STT (CFG.STT · serve.py /stt) · MediaRecorder 로 녹음해 소리 바이트를 보낸다.
 *      키(OPENAI_API_KEY)는 서버에 있고 브라우저로 내려오지 않는다.
 *   2) 브라우저 내장 인식 (Web Speech · Chrome) · 서버 키가 없을 때 그대로 시연되게 하는 대체 길.
 *      녹음 파일 없이 브라우저가 글자를 준다.
 *
 * 상태 · idle → recording → transcribing → (챗봇이 executing) → idle.
 * 마이크는 https 나 localhost 에서만 열린다 · 폰이 IP 주소(http)로 들어오면 브라우저가 막는다 ·
 * 그때는 버튼이 그 이유를 말한다.
 */
window.VOICE = (function () {
  'use strict';

  var CFG = window.CFG || {};
  var state = 'idle';
  var rec = null;          // MediaRecorder
  var chunks = [];
  var stream = null;
  var sr = null;           // SpeechRecognition
  var onState = function () {};
  var onText = function () {};
  var onError = function () {};
  var MAX_MS = 15000;      // 한 명령은 15초면 넉넉하다 · 그 뒤엔 스스로 멈춘다
  var stopTimer = null;

  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function secure() { return window.isSecureContext !== false; }
  function canRecord() { return secure() && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && !!window.MediaRecorder; }

  /* 어느 길이 열려 있나 · 'server' | 'browser' | null. 이유도 같이 준다 */
  function mode() {
    if (!secure()) {
      /* 막힌 이유만 적으면 「그래서 어디로 가라는 거냐」 가 남는다 ·
       * 서버가 https 주소를 내려 줬으면 그 주소를 그대로 눌러 갈 수 있게 적는다 */
      var go = CFG.SECURE_URL
        ? ' · 마이크를 쓰려면 <a href="' + CFG.SECURE_URL + location.pathname +
          '" style="color:var(--b1)">' + CFG.SECURE_URL + '</a> 로 들어오세요'
        : '';
      return { mode: null, html: !!go,
               why: '마이크는 https 에서만 열립니다 (지금 ' + location.origin + ')' + go };
    }
    if (CFG.STT && canRecord()) { return { mode: 'server', why: '서버 음성 인식 (' + (CFG.STT_MODEL || 'whisper') + ')' }; }
    if (SR()) { return { mode: 'browser', why: '브라우저 내장 음성 인식 · .env 에 OPENAI_API_KEY 를 넣으면 서버 인식으로 바뀝니다' }; }
    if (CFG.STT) { return { mode: null, why: '이 브라우저는 녹음(MediaRecorder)을 지원하지 않습니다' }; }
    return { mode: null, why: '이 브라우저는 음성 인식을 지원하지 않습니다 · Chrome 에서 열거나 .env 에 OPENAI_API_KEY 를 넣어 주세요' };
  }

  function set(s, extra) { state = s; onState(s, extra || {}); }

  // ---------------------------------------------------------------- 시작 · 멈춤
  function start() {
    if (state !== 'idle') { stop(); return; }
    var m = mode();
    if (!m.mode) { onError(m.why); return; }
    if (m.mode === 'server') { startRecorder(); } else { startBrowser(); }
  }

  function stop() {
    if (stopTimer) { window.clearTimeout(stopTimer); stopTimer = null; }
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (e) { /* 무시 */ } return; }
    if (sr) { try { sr.stop(); } catch (e) { /* 무시 */ } return; }
    set('idle');
  }

  /* 1 · 녹음해서 서버로 */
  function startRecorder() {
    chunks = [];
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
      stream = st;
      var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
        .filter(function (t) { return window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0];
      rec = type ? new MediaRecorder(st, { mimeType: type }) : new MediaRecorder(st);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) { chunks.push(e.data); } };
      rec.onstop = function () {
        st.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
        var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        rec = null;
        if (!blob.size) { set('idle'); onError('녹음된 소리가 없습니다'); return; }
        transcribe(blob);
      };
      rec.start();
      set('recording', { mode: 'server' });
      stopTimer = window.setTimeout(stop, MAX_MS);
    }).catch(function (e) {
      set('idle');
      onError(/denied|NotAllowed/i.test(String(e && e.name || e)) ? '마이크 사용을 허용해 주세요 (주소창 왼쪽 자물쇠)'
        : '마이크를 열지 못했습니다 · ' + String(e && e.message || e));
    });
  }

  function transcribe(blob) {
    set('transcribing');
    var t0 = Date.now();
    fetch(CFG.STT, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.detail || ('HTTP ' + r.status)); } return j; }); })
      .then(function (j) {
        set('idle');
        var text = String(j.text || '').trim();
        if (!text) { onError('말을 알아듣지 못했습니다 · 다시 말해 주세요'); return; }
        onText(text, { mode: 'server', ms: Date.now() - t0, model: j.model });
      })
      .catch(function (e) { set('idle'); onError('음성 인식 실패 · ' + String(e && e.message || e)); });
  }

  /* 2 · 브라우저 내장 */
  function startBrowser() {
    var C = SR();
    sr = new C();
    sr.lang = 'ko-KR';
    sr.interimResults = true;
    sr.maxAlternatives = 1;
    sr.continuous = false;
    var finalText = '';
    var t0 = Date.now();
    sr.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) { finalText += r[0].transcript; } else { interim += r[0].transcript; }
      }
      onState('recording', { mode: 'browser', interim: (finalText + interim).trim() });
    };
    sr.onerror = function (e) {
      var why = { 'not-allowed': '마이크 사용을 허용해 주세요 (주소창 왼쪽 자물쇠)', 'no-speech': '말을 알아듣지 못했습니다 · 다시 말해 주세요',
                  'network': '브라우저 음성 인식이 인터넷에 닿지 못했습니다', 'audio-capture': '마이크가 없습니다' }[e.error] || ('음성 인식 오류 · ' + e.error);
      sr = null; set('idle'); onError(why);
    };
    sr.onend = function () {
      if (!sr) { return; }           // onerror 가 먼저 정리했다
      sr = null;
      if (stopTimer) { window.clearTimeout(stopTimer); stopTimer = null; }
      var text = finalText.trim();
      set('idle');
      if (text) { onText(text, { mode: 'browser', ms: Date.now() - t0 }); }
      else { onError('말을 알아듣지 못했습니다 · 다시 말해 주세요'); }
    };
    try { sr.start(); set('recording', { mode: 'browser' }); }
    catch (e) { sr = null; set('idle'); onError('음성 인식을 시작하지 못했습니다 · ' + String(e && e.message || e)); }
    stopTimer = window.setTimeout(stop, MAX_MS);
  }

  return {
    start: start, stop: stop, mode: mode,
    state: function () { return state; },
    on: function (h) { onState = h.state || onState; onText = h.text || onText; onError = h.error || onError; }
  };
})();
