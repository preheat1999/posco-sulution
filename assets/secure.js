/* secure.js · http 로 들어왔으면 같은 자리의 https 로 올려 준다.
 *
 * 왜 · 마이크(getUserMedia)와 음성 인식은 **보안 컨텍스트**에서만 열린다.
 * 현장 QR 을 찍고 들어오면 http 로 떨어지고, 그 화면에서는 챗봇 마이크가 막힌다 ·
 * 「마이크를 쓰려면 이 주소로 다시 들어오세요」 를 사람이 한 번 더 눌러야 했다.
 * 반납을 끝내고 바로 말로 물어보려는 사람에게 그 한 번이 시연을 끊는다.
 *
 * 어떻게 · 서버가 https 를 함께 열고 있을 때만(CFG.SECURE_URL) 올린다.
 * 포트는 그 주소에서 읽고, **호스트는 지금 들어온 그대로** 쓴다 ·
 * 랜 카드가 둘이면 서버가 아는 IP 와 사람이 실제로 찍고 들어온 IP 가 다를 수 있다.
 *
 * 한 번만 시도한다 · 자체 서명 인증서라 「고급 → 계속」 을 안 누르면 https 가 안 열린다.
 * 그때 뒤로 가기를 누르면 다시 http 다 · 여기서 또 올리면 사람이 갇힌다.
 * 그래서 시도했다는 표시를 세션에 남기고, 두 번째부터는 화면 안내(voice.js)에 맡긴다.
 */
(function () {
  'use strict';

  var CFG = window.CFG || {};
  var KEY = 'mtrl.https.tried';

  function local() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
  }

  function tried() {
    try { return window.sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function mark() {
    try { window.sessionStorage.setItem(KEY, '1'); } catch (e) { /* 무시 */ }
  }

  /* 올릴 수 있나 · 이유까지 돌려준다 (콘솔에서 왜 안 올라갔는지 보려고) */
  function target() {
    if (location.protocol !== 'http:') { return null; }      // 이미 https 다
    if (local()) { return null; }                            // localhost 는 그 자체로 보안 컨텍스트다
    if (CFG.HTTPS_UPGRADE === false) { return null; }         // 꺼 두고 싶을 때
    if (!CFG.SECURE_URL) { return null; }                    // 서버가 https 를 안 열었다
    if (tried()) { return null; }                            // 한 번 해 봤다 · 또 하면 갇힌다
    var m = /^https:\/\/[^/:]+(?::(\d+))?/.exec(String(CFG.SECURE_URL));
    if (!m) { return null; }
    var port = m[1] ? ':' + m[1] : '';
    return 'https://' + location.hostname + port +
           location.pathname + location.search + location.hash;
  }

  var to = target();
  if (to) {
    mark();
    /* replace 로 간다 · 뒤로 가기를 눌렀을 때 http 주소가 사이에 끼지 않게 한다 */
    location.replace(to);
  }

  window.SECURE = { target: target, tried: tried };
})();
