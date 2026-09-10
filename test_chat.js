/* test_chat.js · 채팅 서랍의 두 규칙을 시험한다.
 *
 *   1) 마크다운이 제대로 그려지는가 · 표 · 목록 · 굵게 · 코드 · 그리고 HTML 이 새지 않는가
 *   2) 답변의 [n] 이 citations[n] 과 1:1 로 이어지는가 · 짝이 없는 번호는 흐린 칩이 되는가
 *
 * 서버 없이 돈다 · 렌더 규칙만 본다. 실제 응답은 브라우저에서 확인한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
let bad = 0;
function ok(c, msg) { if (!c) { bad += 1; } console.log((c ? 'PASS  ' : 'FAIL  ') + msg); }

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/md.js'), 'utf8'), sandbox, { filename: 'md.js' });
const MD = sandbox.MD;

console.log('=== 마크다운 ===');
let h = MD.render('1. 첫째 **굵게** [1].\n2. 둘째 `코드` [2][3].\n\n- 글머리\n- 둘');
ok(/<ol><li>첫째 <strong>굵게<\/strong> \[1\]\.<\/li><li>둘째 <code>코드<\/code> \[2\]\[3\]\.<\/li><\/ol>/.test(h),
   '번호 목록 · 굵게 · 코드 · 인용 표시는 그대로 남는다');
ok(/<ul><li>글머리<\/li><li>둘<\/li><\/ul>/.test(h), '글머리 목록');

h = MD.render('| 자재 | 재고 | 목표 |\n|---|---:|---|\n| Q1 | 1,200 | 3 |\n| Q2 | 0 | 1 |');
ok(/<div class="md-table"><table><thead><tr><th>자재<\/th><th>재고<\/th><th>목표<\/th><\/tr>/.test(h), '표 머리');
ok(/<td>Q1<\/td><td class="num">1,200<\/td><td class="num">3<\/td>/.test(h), '표 칸 · 숫자는 오른쪽 정렬');
ok((h.match(/<tr>/g) || []).length === 3, '표 줄 수 3 (머리 1 · 몸 2)');

h = MD.render('<script>alert(1)</script> **bold** & <b>x</b>');
ok(h.indexOf('<script>') < 0 && h.indexOf('&lt;script&gt;') >= 0, 'HTML 은 글자로만 남는다');
ok(h.indexOf('<strong>bold</strong>') >= 0 && h.indexOf('&amp;') >= 0, '이스케이프 뒤에 마크다운을 얹는다');

h = MD.render('## 제목\n\n본문 줄1\n줄2\n\n> 인용\n\n```\ncode **x**\n```');
ok(/<h4>제목<\/h4>/.test(h), '답변 안의 ## 은 h4 (화면 제목과 겹치지 않게)');
ok(/<p>본문 줄1<br>줄2<\/p>/.test(h), '단락 안 줄바꿈');
ok(/<blockquote>인용<\/blockquote>/.test(h), '인용');
ok(/<pre><code>code \*\*x\*\*<\/code><\/pre>/.test(h), '코드 블록 안은 마크다운을 안 얹는다');

h = MD.render('링크 [문서](https://example.com/a) 와 [x](javascript:alert(1))');
ok(/<a href="https:\/\/example.com\/a" target="_blank" rel="noopener">문서<\/a>/.test(h), 'http 링크만 링크가 된다');
ok(h.indexOf('javascript:') < 0 || h.indexOf('<a href="javascript') < 0, 'javascript: 는 링크가 되지 않는다');

console.log('');
console.log('=== 인용 연결 (chat.js 의 linkCites 규칙을 그대로 재현) ===');
/* chat.js 는 브라우저 전용이라 여기서는 같은 규칙을 그대로 옮겨 시험한다 ·
 * 규칙이 바뀌면 이 함수도 같이 바꿔야 한다 */
function linkCites(html, byIdx, ti) {
  return html.split(/(<[^>]+>)/g).map(function (part) {
    if (part.charAt(0) === '<') { return part; }
    return part.replace(/\[(\d{1,2})\]/g, function (m, n) {
      if (byIdx[Number(n)]) {
        return '<button class="cite" type="button" data-cite="' + n + '" data-turn="' + ti + '">' + n + '</button>';
      }
      return '<span class="cite off">' + n + '</span>';
    });
  }).join('');
}
const byIdx = { 1: {}, 2: {}, 3: {} };
h = linkCites(MD.render('절차는 [1] 이고, 예외는 [2][3] · 없는 번호 [5] · `코드 [1]`'), byIdx, 0);
ok((h.match(/<button class="cite"/g) || []).length === 4, '짝이 있는 [1] [2] [3] 과 코드 안 [1] 까지 칩 4개');
ok(/<span class="cite off">5<\/span>/.test(h), '짝 없는 [5] 는 흐린 칩');
ok(h.indexOf('data-cite="2"') >= 0 && h.indexOf('data-cite="3"') >= 0, '연속 인용 [2][3] 이 각각 칩이 된다');
ok(h.indexOf('[') < 0 || !/\[\d\]/.test(h.replace(/<[^>]+>/g, '')), '글자 마디에 [n] 이 남지 않는다');

console.log('');
console.log(bad ? ('chat check FAIL problems=' + bad) : 'chat check PASS');
process.exit(bad ? 1 : 0);
