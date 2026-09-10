# A · 백엔드 02 · 3층 저장소와 조회 · 쓰기 API

**소요 예상 30~40분.** 이게 이 시스템의 심장이다.
심사에서 「화면끼리 연결이 되나요?」 를 물으면 이걸 보여 준다.

---

> ## 할 일
>
> 사람이 화면에서 바꾼 것을 담는 3층과, 세 층을 겹쳐 주는 API 를 만든다.
> `본선_반출/DB_계약서.md` 의 1 · 4 · 6절이 규격이다.
>
> ---
>
> ## 1) `assets/db-changes.js` · 3층 오버라이드
>
> **원본을 절대 덮지 않는다.** 화면에서 한 일을 변경 이력으로만 쌓고,
> 읽는 쪽이 「오버라이드가 있으면 그걸 우선, 없으면 원본」 으로 겹쳐 본다.
> 그래야 원래 값과 누가 언제 왜 바꿨는지를 역추적할 수 있고,
> 알고리즘 계산 코드를 손댈 필요가 없다.
>
> ```
> 저장소   localStorage · 키 'mtrl.db.v1'
> 이벤트   바뀌면 'mtrl:db-change' 를 던진다
>          다른 탭의 변경은 window 의 'storage' 이벤트로 받는다
>
> 테이블 4개
>   attribute_overrides  q dept newType approvedBy approvedAt priorVerdict reason
>   stock_transactions   q dept txnType qty txnAt processedBy note
>   pooling_overrides    q dept action by at note
>   pr_drafts            q dept data by at
>
> API
>   KEY, all(), rows(t), add(t,row), remove(t,seq), clear(t), reset(), on(fn), off(fn)
> ```
>
> * `seq` 는 화면이 만들지 않는다. 저장소가 붙인다
> * **선언한 컬럼만 통과시켜라.** 화면이 실수로 넣은 필드가 섞이면
>   나중에 무엇이 진짜 스키마인지 모르게 된다
> * 저장해 둔 뒤에 테이블이 늘어났을 수 있다. 없는 테이블은 빈 배열로 채운다
>
> ---
>
> ## 2) `assets/db.js` · 조회 · 쓰기 API
>
> **화면이 쓰는 입구는 이것 하나뿐이다.** 화면이 `DB_MASTER` 나 `DB_DERIVED` 를
> 직접 읽으면 안 된다.
>
> ### 세 층을 겹치는 규칙
>
> **속성 결정 순서** (알고리즘 담당 규격)
> ```
> 1 오버라이드가 있으면        그 값       typeSrc = 'override'
> 2 알고리즘 판정이 확정이면    그 판정     typeSrc = 'algorithm'
> 3 그 외                      정본 Type  typeSrc = 'master'
> ```
> **확정은 보험품과 계획품 둘뿐이다.** 회색지대와 배제는 판단을 못 내린
> 것이므로 정본 Type 을 유지한다. 회색지대를 「일치」 로 세면 알고리즘이
> 실제보다 잘한 것처럼 보인다.
>
> **현재고**
> ```
> stock = stockDept(스냅샷) + Σ stock_transactions
> 부호  = { 반납: +1, 입고: +1, 불출: -1, 공용전환: -1 }
> ```
> `qty` 는 **언제나 양수**로 받고 부호는 종류가 정한다.
> 재고 숫자를 고쳐 쓰면 두 번 반납했을 때 무엇이 맞는지 알 수 없게 된다.
>
> ### 돌려줄 행의 모양
>
> 층이 섞이되 **어느 층에서 왔는지 알 수 있게** 둔다.
> ```
> 키    q dept key deptPath
> 1층   name group wh price ltMean ltStd csp ceq proc recvDate eq
>       baseType stockSeed stockAll suppliers holdStd
> 2층   verdict path why si sp conf grade target need amount action reason
>       signal status sigKind stopDate dueDate dDays expect poolGrade poolAge
> 3층   type typeSrc override stock stockDelta txns pooled poolAction
> 계산   needNow    = max(0, target - stock)       오버라이드 반영 후
>       actionNow  = stock<target ? 발주 : (stock==target ? 유지 : 감축)
> ```
>
> `need` 와 `needNow` 를 **둘 다** 둔다. `need` 는 알고리즘이 낸 값이라
> 근거 화면에서 그대로 보여 줘야 하고, `needNow` 는 반납 후의 지금 상태다.
> 반납하면 `needNow` 만 줄고 알고리즘 산출값은 남는다.
>
> ### 공개 API
>
> ```
> 조회
>   DB.item(q, dept?)      한 건. dept 생략 시 세션 부서
>   DB.list(filter?)       743건. filter 는 { 컬럼: 값 | 배열 | 함수 }
>   DB.find(text, limit?)  코드 · 품명 부분 일치
>   DB.dept(code)          DB.equipment(name?)   DB.maintenance(f?)
>   DB.summary()           오버라이드가 반영된 재계산 요약
>   DB.meta()              기준일 · 출처 · 건수 · 명세 상수
> 쓰기 (전부 3층에 이력으로 쌓인다)
>   DB.approveAttr({ q, dept?, newType, reason?, by?, at? })
>   DB.revertAttr(q, dept?)
>   DB.txn({ q, dept?, type, qty, note?, by?, at? })
>   DB.pool({ q, dept?, action?, note? })
>   DB.draft(kind, { q, dept?, data })
> 이력 · 구독
>   DB.changes()  DB.undo(table, seq)  DB.reset()
>   DB.on(fn)  DB.off(fn)
>   DB.TXN_SIGN  DB.CONFIRMED_TYPES
> ```
>
> ### 입력 검증 (반드시)
>
> ```
> 정본에 없는 자재코드          -> throw '정본에 없는 자재 · <코드>'
> 보험품·계획품이 아닌 승인값    -> throw '승인할 수 있는 속성은 보험품 또는 계획품이다'
> 넷이 아닌 트랜잭션 종류        -> throw '반납 · 불출 · 입고 · 공용전환 중 하나여야 한다'
> 0 이하의 수량                -> throw '수량은 양수여야 한다. 부호는 종류가 정한다'
> ```
>
> ### `DB.item()` 은 주소와 문장에서도 코드를 뽑는다
>
> QR 이 `material-view.html?code=Q4039953` 로 들어오고,
> 챗봇이 「Q4039953 재고 있어?」 같은 문장을 준다.
> 정규식 하나로 코드를 뽑아라 (`Q` + 영문 0~1 + 숫자 6~7).
>
> ---
>
> ## 3) `assets/db-biz.js` · 업무 거래 상태
>
> `데이터/08_반납_거래상태.csv` `09_구매신청_거래상태.csv`
> `10_QR태그.csv` `11_연관자재.csv` 를 담는다.
>
> ```
> window.DB_BIZ = { returns, purchase, tags, sets, codes() };
> ```
>
> **여기에 품명 · 단가 · 리드타임 · 등급을 두지 마라.**
> 자재의 정체는 정본 하나에만 있어야 한다. 지난 리허설에서 반납 화면과
> 구매 화면이 각자 품명을 들고 있다가 **같은 코드가 서로 다른 자재**가 됐다.
> 이 파일은 거래 상태만 든다 · 불출일 · 물품상태 · 잔여 · 계정 · 위치 ·
> 구매 가능 여부 · 신청 수량 · 작업주문.
>
> ---
>
> ## 다 만들면 · 스스로 시험해라
>
> Node 로 돌려 볼 수 있는 작은 시험 스크립트를 만들어 결과를 출력한다.
> (`localStorage` 가 없으므로 메모리로 흉내 내는 가짜를 하나 만든다)
>
> ```
> 1  DB.item('Q4039953') 이 품명 · 단가 · 목표재고를 준다
> 2  DB.item('.../material-view.html?code=Q4039953') 도 같은 것을 준다
> 3  DB.list({type:'보험품'}).length 가 요약의 보험품 수와 같다
> 4  DB.summary() 의 조치가 발주 120 · 유지 142 · 감축 481 이다
> 5  회색지대 한 건을 approveAttr 로 계획품 승인 -> summary 가 움직인다
> 6  재고 3인 자재를 txn({type:'불출', qty:3}) -> stock 0 · actionNow 발주
> 7  undo 하면 되돌아온다
> 8  잘못된 입력 4가지가 전부 예외를 던진다
> 9  DB.reset() 하면 처음 값으로 돌아온다
> ```
>
> 결과를 표로 출력하고, 하나라도 실패하면 고친 뒤 다시 돌려라.
>
> ## 인계 문구
>
> ```
> [백엔드 -> 프론트] 2차 인계
>   window.DB 준비 완료
>   조회 item list find dept equipment maintenance summary meta
>   쓰기 approveAttr revertAttr txn pool draft
>   구독 on/off · 이벤트 mtrl:db-change
>   스크립트 순서 · db-master -> db-derived -> db-changes -> db -> db-biz -> 어댑터
>   자체 시험 9가지 전부 통과
> ```
