# DB ERD

`db/posco_mtrl.sqlite` 와 `assets/db-*.js` 가 같은 구조다.
**PK 는 `q` + `dept` 두 칸이고, 743개 조합이 전체 모집단이다.**

```mermaid
erDiagram
  depts ||--o{ materials : "code = dept"
  depts ||--o{ equipment : "code = dept"
  depts ||--o{ maintenance : "code = dept"

  equipment ||--o{ maintenance : "name = eq"
  equipment }o--o{ materials : "items (q 세미콜론 목록)"

  materials ||--|| attr : "q+dept · 743"
  materials ||--|| stock : "q+dept · 743"
  materials ||--o| pool : "q+dept · 262"

  materials ||--o| returns_tx : "q · 10"
  materials ||--o| purchase_tx : "q · 6"
  materials ||--o| qr_tags : "q · 2"
  materials ||--o{ related : "q · rel"

  materials ||--o{ attribute_overrides : "q+dept"
  materials ||--o{ stock_transactions : "q+dept"
  materials ||--o{ pooling_overrides : "q+dept"
  materials ||--o{ pr_drafts : "q+dept"

  depts {
    string code PK "SEO26FF"
    string path "부문 · 파트 · 섹션"
    string part
    string section
    string eqGroup
    string tel
  }

  materials {
    string q PK "자재코드"
    string dept PK "재고부서"
    string name "품명"
    string group "조달그룹"
    string type "원본 속성 · 판정 전"
    bool csp "핵심예비품"
    bool ceq "핵심설비"
    string wh "창고"
    num stockDept "재고 시드 · 스냅샷"
    num stockAll "전사 재고"
    num suppliers
    num price "단가"
    num ltMean "리드타임 평균"
    num ltStd "리드타임 편차"
    num cycles "24개월 소요 횟수"
    string proc "국내 · 해외"
    date recvDate "최종 입고일"
    string eq "연결 설비"
    num holdStd "설치 수 기준"
  }

  equipment {
    string name PK
    string dept FK
    list items "자재코드 목록"
  }

  maintenance {
    string eq FK "설비"
    string kind "휴지구분 6종"
    date stopStart "정지시작일"
    date reStart
    num hours
    num crew
    string factory
    string line
    string dept FK
  }

  attr {
    string q PK
    string dept PK
    string verdict "보험품·계획품·회색지대·배제2종"
    string path "판정 경로 4종"
    string why "사람이 읽는 근거"
    num si "보험품 점수"
    num sp "계획품 점수"
    string conf "HIGH·MEDIUM·LOW"
    num cspScore
    string stockSrc
  }

  stock {
    string q PK
    string dept PK
    string type "확정 속성"
    string typeSrc "출처"
    string grade "S·A·B·C"
    num target "목표재고"
    num need "max(0, target - stockDept)"
    num amount
    string action "발주·유지·감축"
    string reason "산식 문장 · 화면이 그대로 보여 준다"
    string signal "red·yellow·green·gray"
    string status "즉시발주·발주임박·여유·충분·재고불요"
    string sigEq
    string sigKind
    date stopDate
    date dueDate "발주 마감일"
    num dDays
    num expect
    num issues
    list trend "24개월 소요 추이 · 24개"
  }

  pool {
    string q PK
    string dept PK
    num ageDays "최종입고 후 경과일"
    num staleValue "정체 금액"
    string poolGrade "strong·review·medium"
    string action
  }

  returns_tx {
    string q PK
    string cond "물품상태 6종"
    num off "불출 경과일 · 음수"
    num left "불출 잔여"
    string wo
    string asm
    string code
    string issueWh
    string acc "계정 · 최초 불출과 같아야 한다"
    string locator
    string eq
  }

  purchase_tx {
    string q PK
    bool active "구매 가능"
    num qty
    num warn
    string wo
    string kind
    string eq
    date planDate
  }

  qr_tags {
    string q PK
    string unit
  }

  related {
    string q PK
    string rel PK "함께 불출된 자재"
    num rate "동시 불출 비율"
    string why
  }

  attribute_overrides {
    int seq PK "저장소가 붙인다"
    string q FK
    string dept FK
    string newType "보험품 또는 계획품만"
    string approvedBy
    string approvedAt
    string priorVerdict
    string reason
  }

  stock_transactions {
    int seq PK
    string q FK
    string dept FK
    string txnType "반납·불출·입고·공용전환"
    num qty "언제나 양수 · 부호는 종류가 정한다"
    string txnAt
    string processedBy
    string note
  }

  pooling_overrides {
    int seq PK
    string q FK
    string dept FK
    string action
    string by
    string at
    string note
  }

  pr_drafts {
    int seq PK
    string q FK
    string dept FK
    string data "초안 JSON"
    string by
    string at
  }

  meta {
    string k PK "asof·pk·spec·summary·plan"
    string v "JSON 문자열"
  }
```

---

## 3층 구조

| 층 | 표 | 쓰기 | 수명 |
| --- | --- | --- | --- |
| **1층 정본** | `depts` `materials` `equipment` `maintenance` | 생성기만 | 대회 내내 고정 |
| **2층 파생** | `attr` `stock` `pool` | 생성기만 | 대회 내내 고정 |
| **업무 상태** | `returns_tx` `purchase_tx` `qr_tags` `related` | 생성기만 | 고정 |
| **3층 오버라이드** | `attribute_overrides` `stock_transactions` `pooling_overrides` `pr_drafts` | 화면 | 브라우저에 누적 |
| 부속 | `meta` (기준일 · 명세상수 · 요약값 · 정비계획) | 생성기만 | 고정 |

**원본을 절대 덮지 않는다.** 승인도 반납도 3층에 이력으로만 쌓고,
읽는 쪽이 매번 `1층 + 2층 + 3층` 을 겹쳐 본다.

```
속성 결정   오버라이드 > 알고리즘 확정(보험품·계획품) > 정본 Type
현재고      stockDept(스냅샷) + Σ stock_transactions
부호        반납 +1 · 입고 +1 · 불출 -1 · 공용전환 -1
```

`materials.stockDept` 는 **재고 시드**다. 현재고 컬럼이 아니다.
수량 필드를 고쳐 쓰면 두 번 반납했을 때 무엇이 맞는지 알 수 없게 된다.

---

## 읽을 때 조심할 것 세 개

1. **`maintenance` 의 선언 PK 가 유일하지 않다.**
   `(eq, kind, stopStart)` 가 12건 중복이다 (전부 2026-11-27 합리화).
   `GROUP BY` 없이 조인하면 행이 두 배로 불어나고 **오류는 안 난다.**
   SQLite 에서는 이 표만 대리키 `rid` 로 받았다.

2. **`equipment.items` 는 세미콜론 목록이다.** 정규화되어 있지 않다.
   설비 · 자재는 실제로 다대다다 (자재 하나가 여러 설비에 걸린다).

3. **업무 표(`returns_tx` `purchase_tx` `qr_tags` `related`)에는 자재의 정체가 없다.**
   품명 · 단가 · 리드타임 · 등급을 여기 두면 정본과 갈린다.
   코드로 `materials` 를 조인해서 쓴다.

---

## 건수

```
depts 1 · materials 743 · equipment 14 · maintenance 156
attr 743 · stock 743 · pool 262
returns_tx 10 · purchase_tx 6 · qr_tags 2 · related 3
```
