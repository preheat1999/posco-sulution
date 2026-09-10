/* chat.js · AI 자재 질의 서랍 (RAG)
 *
 * 오른쪽에서 밀려 나오는 380px 패널. 모든 화면이 같이 쓴다.
 *
 * **답을 지어내지 않는다.** 이 화면은 껍데기고, 답은 RAG 담당이 만드는
 * 엔드포인트에서 온다. CFG.CHAT_API 가 비어 있으면 「연동 예정」 이라고
 * 적고 추천 질문만 보여 준다.
 * 여기서 그럴싸한 답을 하드코딩하면 시연에서 아무 질문이나 던졌을 때 바로 들킨다.
 *
 * 연동되면 CFG.CHAT_API 에 주소를 넣는다. 그것 말고 고칠 것은 없다.
 */
(function () {
  'use strict';

  var CFG = window.CFG || {};
  var open = false;
  var log = [];        // {who:'me'|'ai', text, rows}

  /* 추천 질문은 우리가 가진 데이터로 답할 수 있는 것만 둔다.
   * 답할 수 없는 질문을 추천하면 그 자리에서 못 답한다 */
  var SUGGEST = [
    '이번 주 발주해야 할 자재',
    '감축 금액이 큰 자재 10개',
    '회색지대 31품목이 왜 보류됐나'
  ];

  function build() {
    var btn = document.createElement('button');
    btn.className = 'chatbtn';
    btn.id = 'chatbtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'AI 자재 질의');
    btn.innerHTML = '✦';

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
      if (s) { ask(s.getAttribute('data-ask')); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { toggle(false); }
    });
  }

  function toggle(on) {
    open = on;
    var p = document.getElementById('chatpane');
    p.hidden = !on;
    p.classList.toggle('on', on);
    if (on) { paint(); }
  }

  function paint() {
    var live = !!CFG.CHAT_API;
    var n = window.DB ? DB.meta().counts.materials : 0;

    document.getElementById('chatpane').innerHTML =
      '<div class="chat-top">' +
        '<div style="min-width:0">' +
          '<div class="chat-title">✦ AI 자재 질의</div>' +
          '<div class="chat-sub">부서 자재 ' + (window.UI ? UI.num(n) : n) +
            '품목 데이터로만 답합니다</div>' +
        '</div>' +
        '<button class="homebtn" type="button" id="chatx" aria-label="닫기">✕</button>' +
      '</div>' +

      '<div class="chat-body">' +
        (live ? log.map(bubble).join('') : offline()) +
      '</div>' +

      '<div class="chat-foot">' +
        '<div class="chat-chips">' + SUGGEST.map(function (s) {
          return '<button class="chip" type="button" data-ask="' +
            (window.UI ? UI.esc(s) : s) + '">' + (window.UI ? UI.esc(s) : s) + '</button>';
        }).join('') + '</div>' +
        '<div class="chat-input">' +
          '<input class="input" id="chatq" placeholder="' +
            (live ? '자재에 대해 물어보세요' : '연동 예정 · 아직 답할 수 없습니다') + '"' +
            (live ? '' : ' disabled') + '>' +
          '<button class="btn" type="button" id="chatsend"' + (live ? '' : ' disabled') +
            '>보내기</button>' +
        '</div>' +
      '</div>';
  }

  /* 연동 전 상태를 숨기지 않는다. 무엇이 준비됐고 무엇이 안 됐는지 적는다 */
  function offline() {
    return '<div class="callout pln"><span class="ci">✦</span>' +
      '<span><b>RAG 연동 예정 구간입니다</b>' +
      '질의 응답은 팀의 RAG 담당이 만드는 엔드포인트에서 옵니다. ' +
      '이 화면은 그 답을 받아 표와 그림으로 바꾸는 껍데기까지 준비돼 있습니다.</span></div>' +
      '<p class="note" style="margin-top:12px">연동되면 답마다 세 가지가 같이 나옵니다 · ' +
      '<b>한 문장 답</b> · 그 질문에 맞춰 만든 <b>표나 그림</b> · ' +
      '어느 데이터에서 왔는지 적은 <b>근거 줄</b>.</p>' +
      '<p class="note" style="margin-top:10px">지금은 아래 추천 질문을 눌러도 답하지 않습니다. ' +
      'assets/config.js 의 <b>CHAT_API</b> 가 비어 있습니다.</p>';
  }

  function bubble(m) {
    if (m.who === 'me') {
      return '<div class="chat-me">' + (window.UI ? UI.esc(m.text) : m.text) + '</div>';
    }
    return '<div class="chat-ai">' + (window.UI ? UI.esc(m.text) : m.text) +
      (m.src ? '<div class="chat-src">근거 · ' +
        (window.UI ? UI.esc(m.src) : m.src) + '</div>' : '') + '</div>';
  }

  /* 연동 전에는 아무 답도 만들지 않는다 */
  function ask(q) {
    if (!CFG.CHAT_API) {
      var b = document.querySelector('.chat-body');
      b.innerHTML = offline() +
        '<div class="chat-me" style="margin-top:12px">' +
        (window.UI ? UI.esc(q) : q) + '</div>' +
        '<div class="chat-ai">아직 답할 수 없습니다. RAG 엔드포인트가 연결되면 ' +
        '이 질문에 표와 함께 답합니다.</div>';
      return;
    }
    log.push({ who: 'me', text: q });
    paint();
    /* 실제 호출은 연동 시 여기에 붙는다. 지금 가짜 응답을 넣어 두지 않는다 */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }

  window.CHAT = { open: function () { toggle(true); }, close: function () { toggle(false); } };
})();
