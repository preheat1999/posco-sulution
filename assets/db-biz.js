/* db-biz.js
 *
 * 업무 거래 상태 · 불출일 · 물품상태 · 잔여 · 계정 · 위치 · 구매 가능 여부
 * 품명 · 단가 · 리드타임 · 등급을 여기 두지 않는다. 자재의 정체는 정본에만 있다
 *
 * build_master_db.py 가 만든다. 손으로 고치지 않는다.
 */
window.DB_BIZ = {"meta":{"asof":"2026-09-03","note":"여기에는 자재의 정체가 없다. 품명 · 단가 · 리드타임 · 등급은 정본에만 있다. 코드로 정본을 조인해서 쓴다"},"returns":[{"q":"Q4039953","cond":"신품","off":-2,"left":2,"wo":"K10665396","asm":"Boom Conveyor","code":"1KBA110-CV01","issueWh":"PFC","acc":"INV-51120 정비자재비","locator":"A-12-03","eq":null},{"q":"Q4017998","cond":"중고","off":-5,"left":1,"wo":"K10665396","asm":"Boom Conveyor","code":"1KBA110-CV01","issueWh":"중앙","acc":"INV-51120 정비자재비","locator":"B-04-11","eq":null},{"q":"Q4173290","cond":"신품","off":-32,"left":2,"wo":"K10665396","asm":"Boom Conveyor","code":"1KBA110-CV01","issueWh":"PFC","acc":"INV-51120 정비자재비","locator":"A-08-02","eq":null},{"q":"Q4704375","cond":"신품","off":-58,"left":4,"wo":"K10665431","asm":"Roll Alignment","code":"1KUX12-RM01","issueWh":"현장","acc":"INV-51120 정비자재비","locator":"C-02-08","eq":null},{"q":"Q4104776","cond":"불용","off":-41,"left":1,"wo":"K10665418","asm":"Chute","code":"1KBA170-CH01","issueWh":"중앙","acc":"INV-51120 정비자재비","locator":"D-01-06","eq":null},{"q":"Q4551507","cond":"철강재","off":-19,"left":1,"wo":"K10665455","asm":"Chute","code":"1KBA410-CH02","issueWh":"중앙","acc":"INV-51120 정비자재비","locator":"Y-00-00","eq":null},{"q":"Q4441695","cond":"투자","off":-12,"left":1,"wo":"K10665477","asm":"Blower","code":"1KBA370-BL01","issueWh":"중앙","acc":"CIP-70210 투자자재비","locator":"E-03-09","eq":null},{"q":"Q1072928","cond":"Consignment","off":-2,"left":2,"wo":"K10665488","asm":"Coupling","code":"1KBA330-CP01","issueWh":"PFC","acc":"INV-51120 정비자재비","locator":"F-05-01","eq":null},{"q":"Q4080226","cond":"Consignment","off":-9,"left":1,"wo":"K10665491","asm":"Boom","code":"1KBA400-BM01","issueWh":"PFC","acc":"INV-51120 정비자재비","locator":"F-05-04","eq":null},{"q":"Q2176849","cond":"중고","off":-24,"left":1,"wo":"K10665502","asm":"Gear Box","code":"1KBA210-GB01","issueWh":"중앙","acc":"INV-51120 정비자재비","locator":"B-09-07","eq":null}],"purchase":[{"q":"Q4604630","active":true,"qty":1,"warn":2,"wo":"K10665396","kind":"일반자재","eq":"CSU 3호 · Boom Conveyor · 1KBA110-CV01","planDate":"2026-12-20"},{"q":"Q4257701","active":true,"qty":1,"warn":3,"wo":"K10665402","kind":"일반자재","eq":"CSU 4·5호 · Dozer · 1KBA120-DZ02","planDate":"2026-09-28"},{"q":"Q4697155","active":false,"qty":4,"warn":4,"wo":"K10665418","kind":"일반자재","eq":"CSU 7호 · Chain · 1KBA170-CH01","planDate":"2026-10-30"},{"q":"Q4625646","active":true,"qty":6,"warn":2,"wo":"K10665431","kind":"일반자재","eq":"리클레이머 1호 · Bucket · 1KBA210-BK01","planDate":"2026-09-05"},{"q":"Q1019683","active":true,"qty":5,"warn":1,"wo":"K10665455","kind":"일반자재","eq":"스태커 2호 · Chute · 1KBA410-CH02","planDate":"2026-10-02"},{"q":"Q4521625","active":true,"qty":1,"warn":3,"wo":"K10665477","kind":"일반자재","eq":"BC 7호 · Belt · 1KBA370-BL01","planDate":"2026-11-20"}],"tags":[{"q":"Q4039953","unit":"EA"},{"q":"Q4704375","unit":"set"}],"sets":{"Q4039953":[{"q":"Q4017998","rate":80,"why":"동일 W/O K10665396에서 함께 불출 · 최근 5회 중 4회 동시 불출"},{"q":"Q4173290","rate":60,"why":"구동부 정비 시 세트로 불출 · 최근 5회 중 3회 동시 불출"}],"Q4704375":[{"q":"Q4203928","rate":45,"why":"Roll Alignment 정비 시 함께 불출 · 최근 9회 중 4회 동시 불출"}]},"setRows":[{"q":"Q4039953","rel":"Q4017998","rate":80,"why":"동일 W/O K10665396에서 함께 불출 · 최근 5회 중 4회 동시 불출"},{"q":"Q4039953","rel":"Q4173290","rate":60,"why":"구동부 정비 시 세트로 불출 · 최근 5회 중 3회 동시 불출"},{"q":"Q4704375","rel":"Q4203928","rate":45,"why":"Roll Alignment 정비 시 함께 불출 · 최근 9회 중 4회 동시 불출"}]};

/* 업무 화면에 등장하는 자재코드 전부. 정본과의 교집합을 확인할 때 쓴다 */
window.DB_BIZ.codes = function () {
  var out = {}, b = window.DB_BIZ, i, k;
  for (i = 0; i < b.returns.length; i++) { out[b.returns[i].q] = 1; }
  for (i = 0; i < b.purchase.length; i++) { out[b.purchase[i].q] = 1; }
  for (i = 0; i < b.tags.length; i++) { out[b.tags[i].q] = 1; }
  for (k in b.sets) {
    if (!Object.prototype.hasOwnProperty.call(b.sets, k)) { continue; }
    out[k] = 1;
    for (i = 0; i < b.sets[k].length; i++) { out[b.sets[k][i].q] = 1; }
  }
  return Object.keys(out).sort();
};

/* 이 자재와 함께 나가는 자재. 없으면 빈 배열이다 */
window.DB_BIZ.related = function (q) {
  return (window.DB_BIZ.sets && window.DB_BIZ.sets[q]) || [];
};
