# -*- coding: utf-8 -*-
"""
[패키지 준비 전용] 원본 파일 → 공유용 CSV 4종 생성.
상대방은 이 스크립트를 쓸 필요 없다(이미 변환된 data/ 를 받음). 재생성용.
원본 위치는 상위 폴더(appropitate_quantity).
"""
import os, csv
from datetime import datetime

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # appropitate_quantity
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DATA, exist_ok=True)

def pdate(s):
    for fmt in ('%Y-%m-%d','%Y/%m/%d','%Y-%m-%d %H:%M','%Y-%m-%d %H:%M:%S'):
        try: return datetime.strptime((s or '').strip(), fmt).strftime('%Y-%m-%d')
        except: pass
    return ''

# ---------- 1) master.csv (TSV 한글 → 영문 CSV) ----------
mtsv = os.path.join(SRC, 'dummy_master_KUX12HQ.tsv')
rows = list(csv.reader(open(mtsv, encoding='utf-8-sig'), delimiter='\t'))
H = {c: i for i, c in enumerate(rows[0])}
def g(r, name):
    i = H.get(name); return r[i].strip() if (i is not None and i < len(r)) else ''
master_out = []
for r in rows[1:]:
    if not any(r): continue
    master_out.append({
        'Item': g(r,'Item'), 'Type': g(r,'Type'),
        'CriticalSparePart': g(r,'Critical Spare Parts'),
        'CriticalEquipment': g(r,'Critical Equipment'),
        'Warehouse': g(r,'창고'),
        'SourcingGroup': g(r,'Category_Sourcing Group'),
        'StockDept': g(r,'부서재고량(KUX12HQ)'),
        'StockAll': g(r,'전체재고량'),
        'SupplierCount': g(r,'공급사수(Item실적)'),
        'UnitCost': g(r,'단가(원)'),
        'LeadTimeMean': g(r,'LT평균(일)'),
        'LeadTimeStd': g(r,'LT표준편차(일)'),
        'CompletedCycles': g(r,'완결사이클수'),
        'ProcurementType': g(r,'조달구분'),
        'ReceivingDate': pdate(g(r,'Receiving Date')),
        'LinkedEquipment': g(r,'연결설비명'),
        'SparePartHoldingStd': g(r,'핵심예비품보유기준'),
    })
mcols = ['Item','Type','CriticalSparePart','CriticalEquipment','Warehouse',
         'SourcingGroup','StockDept','StockAll','SupplierCount','UnitCost',
         'LeadTimeMean','LeadTimeStd','CompletedCycles','ProcurementType',
         'ReceivingDate','LinkedEquipment','SparePartHoldingStd']
with open(os.path.join(DATA,'master.csv'),'w',encoding='utf-8-sig',newline='') as f:
    w = csv.DictWriter(f, fieldnames=mcols); w.writeheader()
    for m in master_out: w.writerow({k: m.get(k,'') for k in mcols})
print('master.csv', len(master_out))

# ---------- 2) equipment_map.csv (마스터 연결설비명 + 보유기준) ----------
with open(os.path.join(DATA,'equipment_map.csv'),'w',encoding='utf-8-sig',newline='') as f:
    w = csv.writer(f); w.writerow(['Item','LinkedEquipment','SparePartHoldingStd'])
    for m in master_out:
        if m['LinkedEquipment'] or m['SparePartHoldingStd']:
            w.writerow([m['Item'], m['LinkedEquipment'], m['SparePartHoldingStd']])
print('equipment_map.csv done')

# ---------- 3) maintenance.csv (정비계획 배정본) ----------
ptsv = os.path.join(SRC, 'planned_maintenance_schedule_assigned.tsv')
prows = list(csv.reader(open(ptsv, encoding='utf-8-sig'), delimiter='\t'))
PH = {c:i for i,c in enumerate(prows[0])}
def pg(r,name):
    i=PH.get(name); return r[i].strip() if (i is not None and i<len(r)) else ''
with open(os.path.join(DATA,'maintenance.csv'),'w',encoding='utf-8-sig',newline='') as f:
    w = csv.writer(f)
    w.writerow(['Equipment','MaintKind','StopStart','ReStart','StopHours','Manpower','Factory','Line'])
    for r in prows[1:]:
        eq = pg(r,'정지대상설비(복수설비 수리가능)')
        if not eq: continue
        w.writerow([eq, pg(r,'휴지구분명'), pdate(pg(r,'정지시작일시')),
                    pdate(pg(r,'재가동일시')), pg(r,'계획정지시간_시간'),
                    pg(r,'계획인원'), pg(r,'공장명'), pg(r,'라인명')])
print('maintenance.csv done')

# ---------- 4) txn_history.csv (기존 txn_raw 복사, 컬럼 유지) ----------
txn_src = os.path.join(SRC, 'output', 'txn_raw.csv')
import shutil
shutil.copyfile(txn_src, os.path.join(DATA,'txn_history.csv'))
print('txn_history.csv copied')
