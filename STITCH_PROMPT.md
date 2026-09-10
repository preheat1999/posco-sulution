# Stitch 에 넘길 프롬프트

Google Stitch 는 **한 번에 한 화면**을 잘 만들고, 같은 세션 안에서 대화로 고쳐 나간다.
그래서 아래를 순서대로 쓴다.

1. `0 · BASE` 를 세션 처음에 한 번 붙인다 (디자인 시스템과 규칙을 심는다)
2. 화면 하나씩 `1 ~ 11` 을 붙인다. **대시보드(`1`)를 제일 먼저 만든다** · 나머지 화면이 그 결을 따라간다
3. 어긋나면 `12 · 고칠 때 쓰는 문장` 을 쓴다
4. 받아온 뒤 `13 · 받고 나서 확인할 것` 으로 검사한다

프롬프트 본문은 **영어로, 화면에 나갈 글자만 한국어**로 적었다.
디자인 도구는 구조 지시를 영어로 받을 때 색·간격·굵기를 덜 흘린다.
결과가 지시를 무시하면 그 부분만 한국어로 다시 말하면 된다.

숫자는 **전부 실제 데이터 값**이다. 지어낸 값을 받아 오면 우리 화면에 못 쓴다.

---

## 0 · BASE (세션 처음에 한 번)

```
Design a dark-mode internal web app for a steel mill's maintenance material management.
Desktop-first 1512x950, responsive down to 375px.
All visible UI text must be Korean, copied exactly from the strings I give you.
Do not translate them. Do not invent numbers. Do not add placeholder lorem text.

PRODUCT
"AI 자재 솔루션". It helps one maintenance engineer decide two things:
(1) whether each spare part is 보험품 (hold for insurance) or 계획품 (hold per plan),
(2) how much of it to keep in stock.
The system proposes with rules and a human must approve. That approval becomes the first label.
So every AI-derived number must be able to show its own evidence.

USER
One maintenance engineer. Breadcrumb reads: 압연설비 1부 · 열연정비 1섹션 · FM기계파트 · 관리
He owns 14 pieces of equipment and 743 material items worth 49.74억원.

DESIGN SYSTEM (use these exact values)
- background #090C12, card #141A27, control and chart track #1E2536
- card border: 1px hairline rgba(255,255,255,.07) plus inset top highlight rgba(255,255,255,.06)
- radius: 20px cards, 14px inner blocks, 999px pills
- text #F3F5F9, secondary #B3BAC9, label #7C859A
- blue scale, ALL data values come from here: #A9C4FF #7FA6FF #5B8CFF #3A63D9 #27408F
- muted navy for data that needs no action: #414C6B and #333C55
- meaning colors, only these three: coral #F0716F (insurance item, overdue, shortage),
  amber #F2B04E (caution, critical equipment, due this week), teal #33C48F (normal, savings, done)
- badges and chips: background = 16% alpha of the color, text = the color itself.
  never white text on a colored chip.
- filled button #3A63D9 with white text. #5B8CFF is for links and accents only.
- font: system UI stack (SF, Segoe UI Variable, Malgun Gothic). no web fonts.
- big numbers 24-40px, weight 600, letter-spacing -1px, tabular numerals.
  labels 10.5-11.5px. never use weight above 600 on numbers.
- depth comes from the three brightness steps and the hairline, not from heavy shadows.

HARD RULES
1. In every card the chart or figure is the largest element. Text is minimal and sits
   attached to the number it explains.
2. Never write a sentence where a number will do. Long explanations go behind a small
   circular "?" button (17px) that opens a popover.
3. Every AI-derived value has that "?" next to it.
4. Do not add colors. Six in total: the blue scale plus coral, amber, teal.
5. Separator is "·". Never use an em dash or en dash. Never use pure black #000.
6. An empty state says what to do next, never just "없음".
7. Every chart must be drawable by hand in SVG: line chart, donut, horizontal bar,
   dot-step pipeline. No 3D, no gradient-heavy charts, no chart-library look.
8. Chips, badges, pills and tabs never wrap. Meaning-carrying labels do wrap.
```

---

## 1 · 대시보드 (제일 먼저 · 나머지 화면의 기준)

```
Screen: 자재관리 대시보드 (dashboard). Left sidebar 230px, dark card #141A27.

SIDEBAR
logo "AI 자재 / 솔루션". Groups and items with a small count badge on the right:
group "관리": Dashboard · 자재 검색 (sub: POS APPIA) · 데이터 근거 (sub: 0건이 네 개)
group "분석": 속성값 판단 [31] · 적정재고 분석 [120] · 정비계획 소요 발주 [55] · 주간 리포트 (sub: 메일 발송)
group "업무": 구매신청 (PR) [6] · 자재반납 (QR) [10]
Count badges are coral on 16% coral. Bottom: "이예열 사원 / 열연정비 1섹션" and two small
outline buttons "소속 변경" "시연 초기화".

TOP BAR
breadcrumb "압연설비 1부 · 열연정비 1섹션 · FM기계파트 · 관리", h1 "자재관리 대시보드",
right side a pill "기준일 2026-09-03" and a round avatar "이". No description line under the h1.

ROW 1, two cards, left slightly wider (1.12fr / 1fr)

CARD A "담당 현황"
- top right small label "FM기계파트 · SEO26FF"
- huge number "49.7억원" (40px) with small label under it "보유 재고"
- next to the number a pill "+182% · 12개월" in coral on 16% coral, then a "?" button
- BELOW, taking the full card width, a large minimal line chart, about 590x150.
  Two lines only. No axis, no grid, no month labels, no fill.
  Line 1 coral #F0716F, 2.4px, rises steeply at the right end.
  Line 2 teal #33C48F, 1.6px, dashed, sits above line 1 and rises more steeply.
  A filled dot at the end of each line.
- under the chart a tiny legend, each entry a 12px line swatch in its own colour followed by
  the text: "우리 부서 48.54억원" (coral swatch) and "전사 90.31억원" (dashed teal swatch)
- a hairline, then three small value+label pairs in a row:
  "57.89억원 / 목표 재고"  "14기 / 담당 설비"  "743품목 / 담당 자재"

CARD B "오늘 할 일"
- header right: a badge "대기 638품목"
- ONE big block filling the card, background 16% coral, 1px coral border, radius 14:
  a small chip "지금" on the left, then "67품목" at 34px in coral,
  one line "재고가 목표의 절반에 못 미칩니다" with a "?",
  and a filled blue button "적정재고 분석 열기".
- at the bottom of the card, a full-width collapsed row on #1E2536:
  "나머지 3줄 · 이번 주 59 · 기회 481 · 검토 31" with a chevron on the right.

ROW 2, three equal cards

CARD C "✦ AI 속성 분류", top-right link "바로가기"
- a large donut, 152px, ring thickness 9px, track #1E2536, six segments:
  승인 완료 0 (teal) · 보험품→계획품 149 (#5B8CFF) · 계획품→보험품 90 (coral) ·
  현행유지 31 (amber) · 판정일치 340 (#414C6B) · 배제 133 (#333C55).
  Center: "743" and under it "품목".
- right of the donut, two stacked figures: "239" with tiny label "속성 변경 제안",
  "31" with tiny label "사람 판단 보류", then a hint line "마우스를 올리면 6갈래".
- on hover the two figures fade out and a six-row legend fades in, in the same space,
  each row = colored dot, name, right-aligned number. The card must not change height.

CARD D "✦ AI 적정재고 분석", top-right link "바로가기"
- two figures side by side: "120품목 / 발주 필요" (amber number), "29.7억원 / 감축 가능" (teal number)
- below, a comparison of two horizontal bars, 30px tall, radius 9, track #1E2536.
  Label sits ABOVE each bar, left name and right value on one line.
  Bar 1: "지금 보유" / "49.74억원", filled 100% with #5B8CFF.
  Bar 2: "목표 안" / "20.04억원", filled 40.3% with #27408F; the remaining 59.7% is an
  amber diagonal-hatch block with a dashed amber border, labelled "감축 29.71억원" inside.
- at the bottom of the card, a teal block on 16% teal with a small round teal coin icon "₩":
  "연 3,604만원" bold, and under it "금융비용 절감 · 감축 + 공용화 회수 기준".

CARD E "정비 예정 · 발주 마감", sub "56건 중 급한 4건", header right outline button "열기"
- four rows. Each row: a hand-drawn round face icon (28px, outline only, coral frowning),
  then two lines of text with a tiny grey prefix label:
    "설비  QOC Servo"  /  "자재  Hydraulic Cylinder(Critical) · Q4439266"
  and on the right, right-aligned: "초과 332일" in coral and under it "2025-10-06".
  Other rows: FM Main Motor / Hydraulic & Pneumatics · Q2154362 / 초과 236일 / 2026-01-10.
  Stand Main TR / Cast Steel (S) · Q2210205 / 초과 225일 / 2026-01-21.
  Stand Main TR / Cast Steel (S) · Q2233578 / 초과 225일 / 2026-01-21.
- one small line under the list: "56건 모두 마감 초과 · 지금 신청은 6건" with a "?"

ROW 3 and 4, two collapsed accordion bars, full width, closed by default.
Each is a card-height row with a title on the left, a count on the right, then a chevron:
title "구매신청 · 자재반납 진행" with "구매신청 6건 · 자재반납 10건" on the right
title "설비별 자재 현황" with "발주 필요 120품목" and an outline button "적정재고" on the right

FOOTER one dim line, 11px:
"정답 라벨이 0건이라 정확도를 말하지 않습니다 · 담당자 승인이 첫 라벨입니다"
```

---

## 2 · 속성값 판단 (`attr.html`) · 시연의 핵심 화면

```
Screen: 속성값 판단. Same sidebar and top bar, breadcrumb ends with "분석".
Two columns: left a long list, right a sticky evidence panel. The right panel is the point
of this screen, give it about 40% width.

TOP of the content: four filter chips, one selected:
"전체 743" · "보험품→계획품 149" · "계획품→보험품 90" · "현행유지 31"
and a small segmented control "재고금액 순 / 점수차 순".

LEFT LIST, one row per material, 743 rows, virtualised look. Each row:
- a small square swatch coloured by its bucket (blue / coral / amber)
- name and code on two lines: "Hydraulic Cylinder(Critical)" / "Q4439266 · S등급"
- a badge pair: "보험품" on 16% coral, "핵심예비품" on 16% amber
- right side: the score gap as a tiny 2-line figure "0.04" / "점수차"
- the selected row has a #5B8CFF left border 2px and a slightly lighter background

RIGHT EVIDENCE PANEL for the selected material
- title "Hydraulic Cylinder(Critical)" and under it "Q4439266 · FM기계파트"
- a horizontal score axis, full width, 6px tall, radius 999, a gradient from 16% blue on the
  left to #1E2536 in the middle to 16% coral on the right, a thin tick at 50%,
  and two 16px dots on it: a coral dot labelled "보험품 0.62" and a blue dot labelled
  "계획품 0.58". Under the axis two end labels: "계획품 0" and "보험품 100".
- then a table of the values that made the score, key on the left, value right-aligned:
  "리드타임 평균" "227.7일" · "리드타임 표준편차" "60.6일" · "공급사" "1곳" ·
  "연 사용 횟수" "6회" · "단가" "14.2백만원" · "핵심예비품" "예" · "조달" "국내"
- a formula block on a darker inset background, 11px monospace-ish:
  "보험품 점수 = 0.35×리드타임 + 0.25×공급사 + 0.20×핵심여부 + 0.20×사용빈도"
- a verdict block: a big word "회색지대" in amber, and one line
  "점수 차이가 0.04 로 작아 판단을 보류했습니다"
- THE ACTION at the bottom, sticky: two filled buttons side by side
  "보험품으로 확정" and "계획품으로 확정", plus a text button "현행유지".
  Above them a single line "담당자 승인이 이 자재의 첫 라벨이 됩니다".

Show a small toast at the top right: "승인 1건 · 검토 31 → 30품목" in teal on 16% teal.
```

---

## 3 · 적정재고 분석 (`stock.html`)

```
Screen: 적정재고 분석. Same shell. The body is five collapsible sections stacked
full-width; the first one is open, the rest are closed bars showing a count on the right.

Header strip, four figures in one row, no cards, separated by hairlines:
"743품목 / 대상" · "120품목 / 발주 필요" (amber) · "481품목 / 감축 가능" (teal) ·
"29.71억원 / 감축 금액" (teal)

SECTION 1 "1 · 속성별로 다른 공식" (open)
two side-by-side blocks on #1E2536, radius 14:
left "보험품 382품목" with the formula "목표 = 리드타임 수요 + 안전재고" and
  "Z 등급별 · S 2.33 · A 1.88 · B 1.65 · C 1.28"
right "계획품 361품목" with "목표 = 0 (상시 무재고 원칙)" and one line
  "무재고 99.2% 는 오류가 아닙니다".

SECTION 2 "2 · 목표재고 계산" (closed, right side "743품목")
SECTION 3 "3 · 조치 판정" (closed, right side "발주 120 · 유지 142 · 감축 481")
SECTION 4 "4 · 공용화 후보" (closed, right side "262품목 · 회수 9.47억원")
SECTION 5 "5 · 금융비용 절감" (closed, right side "연 3,604만원")

When section 3 is open it shows a table: 자재 / 속성 / 보유 → 목표 / 조치.
Rows like: "General Pump (Ready) · Q4604630" / "보험품 S등급" / "0 → 1" / badge "발주 1".
The "보유" number is a button; clicking it opens a popover with 창고, BIN 미확인,
부서 보유, 전사 보유, 타부서 보유, 목표재고, 조치.
```

---

## 4 · 정비계획 소요 발주 (`plan.html`)

```
Screen: 정비계획 소요 발주. Same shell.
Top: three figures "156건 / 정비계획" · "55건 / 마감 초과" (coral) · "6건 / 지금 신청" (coral)
and a segmented control "마감 급한 순 / 휴지일 순".

Body: a timeline list of work orders. Each work order is a card row:
- left a round outline face icon, coral for overdue
- "M260906FM12" small mono code, then "FM Main Motor" bold, then "대수리 · S등급"
- a horizontal mini timeline bar: today marker, an amber marker for 발주 마감일,
  a blue marker for 휴지 시작일, with tiny date labels under each
- right side "초과 287일" in coral and "마감 2025-11-20"
- expanding the row lists the required materials as a small table with 필요 / 보유 / 부족
  and a filled button "구매신청 초안 만들기"

One line under the header: "마감일 = 휴지 시작일 - 내림(리드타임 평균 + 선행일수 + 0.5 × 표준편차)"
with a "?" next to it.
```

---

## 5 · 구매신청 PR (`purchase.html`)

```
Screen: 구매신청 (PR). Same shell.
A four-step dot pipeline across the top, each step a 32px circle with a count under it:
"대상 확인 6건" (done, teal filled) · "자재 정보 보완 1건" (doing, blue outline) ·
"초안 작성 0건" (doing) · "PR 발행 0건" (waiting, dashed outline, grey).
Under the pipeline one line: "발행은 사내 시스템 연동 예정 구간입니다".

Left: the list of 6 candidates. Each row: 자재명 · 코드 · 필요 수량 · 금액 · a badge
"구매 가능" on 16% teal or "정보 보완 필요" on 16% amber.
Right: the draft form. Fields are pre-filled and marked as AI-filled with a blue 1px border
and 16% blue background: 자재코드, 품명, 수량, 요청일, 납기희망일, 계정, 사용 설비, 사유.
Each AI-filled field has a "?" that shows where the value came from.
Bottom: a filled button "구매신청 초안 저장" and an outline button "초기화".
```

---

## 6 · 자재반납 QR (`return.html`)

```
Screen: 자재반납 (QR). Same shell. Two columns.
Left: a hand-drawn QR code, about 200px, black modules on white inside a rounded white
block (the only white surface in the app), and under it "휴대폰으로 찍으면 반납 화면이 열립니다".
Right: the returns list, 10 rows. Each row: 자재명 · 코드 · 불출 잔여 수량 ·
물품 상태 badge (양호 teal / 사용 amber / 불용 coral) · a filled button "반납".
Above the list, seven small outline chips showing the seven return types:
"미사용 반납" "부분 사용" "불용 처리" "타부서 이관" "공용 전환" "위탁 반품" "폐기".
A small line: "반납을 실행하면 재고가 바로 다시 계산되고 적정재고 조치도 같이 바뀝니다".
```

---

## 7 · 모바일 반납 (`mobile-return.html`)

```
Screen: mobile only, 375x812, same dark theme. This is what the QR opens.
Top: a small header "자재반납" and the material name "Cast Steel (S) · Q2210205".
Middle: one big number "3" with the label "불출 잔여" under it, and a large stepper
(minus / number / plus) with 56px round buttons.
Then three big radio cards stacked, each 64px tall, showing 물품 상태:
"양호 · 그대로 입고" / "사용 · 검사 후 입고" / "불용 · 폐기 대상".
Bottom: a full-width filled button 52px tall "반납 처리".
After success: a teal check icon, "반납 완료", and two lines
"재고 1 → 4", "조치 발주 → 유지". Everything must be reachable with one thumb.
```

---

## 8 · 데이터 근거 (`evidence.html`) · 심사에서 가장 중요한 화면

```
Screen: 데이터 근거. Same shell. This screen explains why the AI cannot claim accuracy.
Hero: four big "0" figures in one row, each 40px, coral, with a label under it:
"0건 / 재고 기준 기록" · "0종 / 보험품 확정 라벨" · "0.3% / 작업주문 교집합" · "0건 / 창고 BIN"
Under them one line: "정답이 없으니 정확도를 말할 수 없습니다. 그래서 규칙으로 제안하고
담당자 승인을 첫 라벨로 쌓습니다."

Then four evidence blocks stacked. Each block:
- a title, e.g. "재고를 얼마나 둘지 정한 기록이 0건입니다"
- the count and the population: "0건 / 743품목"
- a code block on a darker inset background showing the query that produced it,
  keywords in #A9C4FF, strings in teal, functions in amber
- a one-line consequence: "그래서 지도학습을 할 수 없습니다"
- a small outline button "이 값 다시 세기"

At the bottom a small table "원천 CSV 11개" listing file name, rows, and what it lacks.
Nothing on this screen is decorative. No illustration.
```

---

## 9 · 주간 리포트 (`report.html`)

```
Screen: 주간 리포트. Same shell.
Left: an A4-proportioned preview page, dark card, showing the report:
title "주간 자재 리포트 · 2026-09-03", then three figures in a row
(발주 필요 120품목 / 감축 가능 29.71억원 / 승인 대기 31품목),
a small donut, a two-bar comparison, and a five-row table.
Right: the send panel. Recipient chips with roles: "한상우 과장 · 정비 리더",
"오세진 차장 · 정비 리더", plus "윤도현 대리 · 구매 담당자" as an option.
A weekday and time selector, a checkbox "지난주와 달라진 값만 강조",
and a filled button "메일 발송". Under it one line "발송은 사내 메일 연동 예정 구간입니다".
```

---

## 10 · 자재 검색 (`search.html`)

```
Screen: 자재 검색. Same shell.
A single large search field at the top, 52px tall, on #1E2536, placeholder
"자재코드 · 품명 · 설비명으로 찾습니다". Under it recent chips and a hint
"Q 로 시작하는 7자리 코드를 붙여 넣어도 됩니다".
Results as a table: 자재 / 속성 / 등급 / 보유 → 목표 / 조치 / 창고.
Left of the table a filter rail (not a modal): 속성, 등급, 조치, 조달, 설비 연결 여부,
each a list of checkboxes with counts on the right.
Empty state: "찾는 자재가 없습니다" and under it what to do:
"코드 앞 두 자리만 넣어 보거나, 설비명으로 찾으세요".
```

---

## 11 · RAG 챗봇 (overlay, 모든 화면 공통)

```
Component: a chat overlay for the whole app. A 52px round blue floating button at the
bottom right. Opening it slides a 380px panel from the right, full height,
background #141A27 with a hairline on the left edge.
Header "자재 도우미" and a line "부서 자재 743품목의 데이터로만 답합니다".
Messages: the user's on the right on 16% blue, the assistant's on the left on #1E2536.
An assistant answer must show three parts stacked:
(1) one sentence answer, (2) a small chart or a 3-row table generated for that question,
(3) a source line "근거 · 04_정비계획 156건 · 07_재고 743행" with a "?".
Suggested question chips at the bottom above the input:
"이번 주 발주해야 할 자재" · "감축 금액이 큰 자재 10개" · "QOC Servo 에 필요한 자재"
Input row: a text field and a round blue send button.
```

---

## 12 · 고칠 때 쓰는 문장

Stitch 가 자주 어기는 것들이다. 그대로 붙이면 된다.

```
Make the chart the largest element in that card and cut the surrounding text to a label.
Remove the axis labels, the grid and the fill from the line chart. Two lines only.
That is a fifth colour. Use the blue scale for it instead.
Use "·" as the separator, not a dash.
Move that explanation into a popover behind a small circular "?" button.
Badges must be 16% alpha background with the colour as text, never white on colour.
The card must not change height on hover.
Numbers use weight 600, not 700 or 800.
Keep the Korean strings exactly as written. Do not translate or rephrase them.
That number is invented. Use the value I gave you.
Make the empty state say what to do next instead of "없음".
```

---

## 13 · 받고 나서 확인할 것

Stitch 결과는 **디자인 참고**다. 그대로 코드에 넣지 않는다.
우리 화면은 DB API · 3층 구조 · 근거 팝오버 규칙 위에 서 있어서, 그림만 가져오고
동작은 지금 코드를 유지한다. 아래를 차례로 본다.

| 확인 | 왜 |
|---|---|
| 숫자가 우리 값과 같은가 | Stitch 는 숫자를 지어낸다. 743 · 49.74억 · 120 · 31 · 6 이 맞는지 본다 |
| 색이 여섯 개를 넘지 않는가 | 하나 늘어날 때마다 뜻이 흐려진다 |
| 모든 AI 값에 `?` 가 붙어 있는가 | 근거를 못 보여 주면 이 서비스의 핵심이 사라진다 |
| 「없음」 으로 끝나는 빈 화면이 있는가 | 할 일을 적어야 한다 |
| 칩 · 배지 · 탭이 두 줄로 쪼개지는가 | 한글은 한 글자씩 줄바꿈된다. nowrap 이 빠지면 「변 / 경」 이 된다 |
| 1180 · 960 · 760 · 640 네 단계가 있는가 | 우리 셸의 반응형 단계와 맞춰야 그림을 옮길 수 있다 |
| 승인 한 건이 화면을 움직이는 흐름이 남아 있는가 | 도넛 · 오늘 할 일 · 사이드바 배지가 같이 줄어야 한다 |
| 차트를 손으로 그릴 수 있는가 | 사내망에서 외부 차트 라이브러리 주소가 막힌다 |

---

## 14 · 넘기지 말 것

Stitch 는 외부 서비스다. 넣은 내용은 우리 손을 떠난다.
디자인에 필요 없는 것은 빼고 넘긴다.

- 사내 Oracle 테이블 · 컬럼명 (`POSMAXIMO.INVENTORY` 같은 것)
- 대표 전화번호
- 실제 사원 이름 · 메일 주소 → 이미 시연용 이름과 `@demo.local` 을 쓰고 있으니 그대로 둔다
- 원천 CSV 파일 자체

부서코드 `SEO26FF` 와 자재코드 `Q4439266` 은 **화면에 뜨는 값**이라 프롬프트에 넣었다.
공개 저장소에 이미 올라가 있는 값과 같은 범위다.
