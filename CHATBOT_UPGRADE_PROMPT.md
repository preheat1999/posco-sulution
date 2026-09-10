# 챗봇 업그레이드 프롬프트 (붙여넣어 쓰는 것)

아래 코드블록 전체를 복사해 나에게 다시 주면 그때 개발한다.
`[ ]` 로 표시된 곳은 답을 정해서 채우거나, 「네가 정해」 라고 적으면 된다.

---

```
AI 자재 질의 서랍(assets/chat.js)을 업그레이드해줘. 지금은 사내 문서(RAG)만 답한다.
여기에 **이 서비스 자체에 대한 질문**을 자연어로 물어볼 수 있게 만들어줘.

## 지금 있는 것 (확인하고 시작해)

- RAG 서버 · http://10.1.14.205:8000 · serve.py 가 /rag 로 넘긴다 (CORS 없음, 토큰은 .env)
  · route: "rag" | "sql" | "hybrid" · citations[] · no_answer · rewritten_question
  · **주의** · 이 서버의 sql 라우트는 자기 쪽 샘플 DB(master.csv 743종)만 본다.
    「적정재고는 어떻게 산정하나요」 를 물으면 "적정재고 산출 결과가 원천에 없어
    답할 수 없다" 고 답한다. 그 결과는 **우리 화면이 갖고 있다** · 그게 이 작업의 이유다.
- 우리 데이터층 (브라우저 안, 서버 호출 없음)
  · DB · list(filter) item(q,dept) summary() meta() changes() commitInfo() find()
        dept() equipment() maintenance() approveAttr revertAttr commitAttr clearAttr
        txn draft pool qrReturn qrReturns reset
  · 행 필드 70여 개 · q dept name group wh price ltMean ltStd csp ceq proc recvDate eq
        cycles baseType stockAll suppliers verdict path why si sp conf grade target need
        amount targetIns reasonIns targetPln reasonPln action reason signal status dueDate
        dDays expect trend poolGrade poolAge staleValue type typeSrc judged pending
        committed stock stockDelta pooled stockType stale recalc targetNow reasonNow
        signalNow needNow actionNow
  · summary() · items verdict action grade signal type bucket holdOpen staleN recalcN
        judgedN waitingN insItems plnItems nowAmt tgtAmt cutAmt zeroTarget poolItems
        poolAmt poolHoldItems financeRate financeInterest finance
  · meta().spec · formula z sl insFormula plnFormula gradeRule factors signalIns
        signalPln stale pool finance (명세 상수 · 화면이 산식을 만들지 않는다)
  · SCREEN · attrCounts attrList attrDetail attrBucket gap stockCounts stockList
        stockHeat stockSteps stockBreak planCounts planList planMats planAxis planLead
        poolCounts poolList poolSpec prList prRow prSteps prDraft retList retTabs
        retEffect stage/stockStage/commit 관련
  · ANALYSIS · summary donut trend money todo dueList needRows pipelines transferable
  · 3층(사람이 한 일) · attribute_overrides stock_transactions pooling_overrides
        pr_drafts qr_returns
- 화면 · main(대시보드) attr(속성값 판단) stock(적정재고 분석) plan(적정구매시점)
  pool(공용 전환) purchase(구매신청) return/mobile-return/material-view(자재반납·QR)
  login index

## 하고 싶은 것

같은 서랍에서 아래 세 갈래 질문이 다 통해야 한다.

1. 사내 문서 질문 (지금 되는 것) · 「자재 반납 절차 알려줘」 → RAG 그대로
2. **우리 데이터 질문** · 예 ·
   - 「지금 발주 필요 몇 품목이야」 「감축 가능 금액 얼마야」
   - 「Q1000108 목표재고가 왜 2야」 「이 자재 리드타임 얼마야」
   - 「회색지대가 왜 31품목이야」 「확정 대기 몇 건 남았어」
   - 「이번 주 마감 넘긴 WO 몇 건」 「공용 전환하면 얼마 회수돼」
   - 「감축 금액이 큰 자재 5개 보여줘」
3. **이 서비스(UI·항목·용어) 질문** · 예 ·
   - 「적정재고 분석 탭에서 히트맵 상자 크기가 뭘 뜻해」
   - 「제외대상 473이 무슨 숫자야」 「stale 이 무슨 뜻이야」
   - 「확정을 누르면 어디가 바뀌어」 「targetNow 랑 target 차이가 뭐야」
   - 「이 수치는 어느 파일에서 왔어」

「rag 문서로 답할 수 없는 항목이면 백엔드·프론트엔드 API 등을 순회하며 찾는」 동작이
2·3번이다. 순회 대상은 **우리 저장소 안**이다 (DB/SCREEN/ANALYSIS 함수 · 행 필드 ·
명세 상수 · 화면과 그 화면이 보여 주는 항목 · 3층 표).

## 반드시 지킬 것

- **지어내지 않는다.** 세 갈래 어디에서도 못 찾으면 「이 질문은 사내 문서에도, 이
  서비스 데이터에도 없습니다」 라고 적고 무엇을 물으면 답할 수 있는지 알려 준다.
  숫자를 추정하거나 그럴싸한 설명을 만들면 안 된다.
- **모든 답에 근거를 붙인다.** 문서 답은 지금처럼 citations · 데이터 답은
  「어느 함수 · 어느 필드 · 어느 산식 · 기준일」 을 적고, 그 값을 보여 주는 화면으로
  가는 링크를 준다 (예 stock.html#cut · attr.html#gray).
- **우리 데이터를 외부로 보내지 않는다.** 데이터 답은 브라우저 안에서 만든다.
  질문 문장을 RAG 서버로 보내는 것은 괜찮지만, 자재 행·금액·부서 값을 실어 보내지 않는다.
  (지금까지 지킨 규칙 · Oracle 표·컬럼명 · 대표 전화번호 · 실명은 외부로 보내지 않는다)
- 데이터 답은 **즉시** 나와야 한다 (100ms 안). 문서 답의 6~11초와 섞이면 안 된다.
- 답이 어느 갈래에서 왔는지 화면에 드러낸다 (문서 · 이 서비스 데이터 · 서비스 설명).
- 계산은 어댑터가 한다. 서랍이 산식을 새로 만들지 않는다 (기존 규칙 그대로).
- 값이 바뀌면 답도 바뀌어야 한다 · 확정 전/후, 반납 전/후에 같은 질문을 다시 물으면
  그때 값으로 답한다 (하드코딩 금지).

## 네가 정하고 나에게 알려줄 것 (개발 전에 짧게)

1. 질문을 어떻게 알아듣나 · 브라우저에 LLM 이 없다. 규칙 기반 질문 등록부
   (패턴 → 어댑터 호출)로 갈지, RAG 서버의 라우팅을 먼저 쓰고 안 되면 등록부로 갈지,
   둘을 어떤 순서로 시도할지. 규칙 기반이면 「모르는 질문」 비율을 어떻게 줄일지.
2. 서비스 설명(3번)의 지식은 어디에 두나 · 화면·필드·용어 카탈로그를 새 파일로 만들지,
   기존 주석·명세에서 뽑을지. 카탈로그가 코드와 어긋나지 않게 지킬 방법.
3. 답 모양 · 한 문장 + 표 + 근거 줄 + 화면 링크. 어떤 질문에 표를 주고 어떤 질문에
   한 줄만 줄지.
4. 검증 방법 · 데이터 답이 화면 숫자와 어긋나지 않는지 자동으로 확인할 검사기.
   (기존 test_flow.js 가 화면 간 숫자 일치를 보는 것과 같은 방식)

## 진행 방식

계획을 짧게 설명하고 내 확인을 받은 뒤 개발해. 개발 뒤에는 실제로 질문을 던져
확인하고, 검사기와 함께 커밋해.

## 내가 채울 값

- 예상 질문 목록 (시연에서 실제로 던질 것) · [ ]
- 규칙 기반으로 못 알아들었을 때의 태도 · [ 되묻기 / 비슷한 질문 추천 / 그냥 모른다고 하기 ]
- 데이터 답에도 출처 카드를 접어 두는 방식으로 통일할까 · [ ]
```

---

## 이 프롬프트를 이렇게 만든 이유 (참고)

- RAG 서버의 `sql` 라우트는 자기 샘플 DB만 본다. 실제로 「적정재고는 어떻게
  산정하나요」 가 「원천에 없어 답할 수 없다」 로 왔다 · 그 결과는 우리 화면에 있다.
- 그래서 「문서 → 우리 데이터 → 서비스 설명」 세 갈래로 나누고, 못 찾으면 못 찾았다고
  적는 것이 이 서비스의 규칙(근거 없는 답을 만들지 않는다)과 맞는다.
- 브라우저에 LLM 이 없다는 제약이 설계의 핵심이라 그 결정을 네가 답할 항목으로 뺐다.
