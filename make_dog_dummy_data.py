import csv
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(r"C:\Users\서동민\Desktop\hackerthon")
MASTER_PATH = ROOT / "appropriate_quantity" / "master.csv"
OUT_DIR = ROOT / "DOG Type" / "Dummy Data"
ROWS = 3000
SEED = 20260907
START = date(2016, 9, 1)
END = date(2026, 8, 31)
EXTRA_DEPT_CODES = ["YEE22RR", "DME33WW", "PUZ13DQ", "ASF00AA", "KPO44TT"]

OUTBOUND_HEADERS = ["Outbound Date", "Qcode", "수량", "Dept Code", "Item Type", "부서명", "섹션명", "Leaf Class", "Category"]
INBOUND_HEADERS = ["INbound Date", "Qcode", "수량", "Dept Code", "Item Type", "부서명", "섹션명", "Leaf Class", "Category"]
STOCK_HEADERS = ["Qcode", "수량", "Dept Code", "Item Type", "부서명", "섹션명", "Leaf Class", "Category"]


def clean(value):
    return (value or "").strip()


def random_date(rng):
    return START + timedelta(days=rng.randint(0, (END - START).days))


def item_profile(row, index):
    sourcing = clean(row.get("SourcingGroup"))
    category = sourcing.removeprefix("Q_") or "machine common"
    category = category.replace("_", " ")
    master_type = clean(row.get("Type"))
    if index % 17 == 0:
        item_type = "일일공급품"
    elif index % 19 == 0:
        item_type = "Consignment"
    elif index % 23 == 0:
        item_type = "자가재"
    elif index % 29 == 0:
        item_type = "VMI"
    elif master_type == "계획품":
        item_type = "Spare Part"
    else:
        item_type = "Spare Parts"
    leaf = category
    if "Roll" in sourcing or "roller" in sourcing.lower():
        leaf = "Roll Bearing"
    elif "Pump" in sourcing or "Pneumatic" in sourcing:
        leaf = "Hydraulic Pump"
    elif "Valve" in sourcing:
        leaf = "Control Valve"
    elif "Machining" in sourcing:
        leaf = "Machining Part"
    return {
        "Qcode": clean(row.get("Item")),
        "Dept Code": clean(row.get("DeptCode")) or "SEO26FF",
        "Item Type": item_type,
        "부서명": "(광양)압연설비1부",
        "섹션명": "열연정비2섹션" if index % 2 else "열연정비1섹션",
        "Leaf Class": leaf,
        "Category": category,
        "master_type": master_type,
        "index": index,
    }


def read_master():
    with MASTER_PATH.open(encoding="utf-8-sig", newline="") as stream:
        return [item_profile(row, index) for index, row in enumerate(csv.DictReader(stream))]


def quantity(profile, rng, kind):
    planned = profile["master_type"] == "계획품"
    item_type = profile["Item Type"]
    if kind == "outbound":
        if item_type in {"일일공급품", "Consignment", "자가재"}:
            return rng.randint(5, 40)
        if planned:
            return rng.randint(1, 8) if rng.random() < 0.8 else rng.randint(15, 80)
        return rng.randint(1, 3) if rng.random() < 0.72 else rng.randint(8, 30)
    if kind == "inbound":
        return rng.randint(10, 100) if planned else rng.randint(1, 15)
    if item_type in {"일일공급품", "Consignment", "자가재"}:
        return rng.randint(0, 25)
    return rng.randint(0, 12) if planned else rng.randint(0, 6)


def event_rows(profiles, kind, rng):
    rows = [dict(profile) for profile in profiles]
    while len(rows) < ROWS:
        profile = profiles[rng.randrange(len(profiles))]
        row = dict(profile)
        row["Dept Code"] = EXTRA_DEPT_CODES[rng.randrange(len(EXTRA_DEPT_CODES))]
        row["event_date"] = random_date(rng)
        row["quantity"] = quantity(profile, rng, kind)
        rows.append(row)
    rng.shuffle(rows)
    return rows


def write_tsv(path, headers, rows, kind, rng):
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=headers, delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            if kind == "stock":
                writer.writerow({
                    "Qcode": row["Qcode"],
                    "수량": row.get("quantity", quantity(row, rng, kind)),
                    "Dept Code": row["Dept Code"], "Item Type": row["Item Type"],
                    "부서명": row["부서명"], "섹션명": row["섹션명"],
                    "Leaf Class": row["Leaf Class"], "Category": row["Category"],
                })
            else:
                date_header = "Outbound Date" if kind == "outbound" else "INbound Date"
                writer.writerow({
                    date_header: row.get("event_date", random_date(rng)),
                    "Qcode": row["Qcode"], "수량": row.get("quantity", quantity(row, rng, kind)),
                    "Dept Code": row["Dept Code"], "Item Type": row["Item Type"],
                    "부서명": row["부서명"], "섹션명": row["섹션명"],
                    "Leaf Class": row["Leaf Class"], "Category": row["Category"],
                })


def main():
    rng = random.Random(SEED)
    profiles = read_master()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_tsv(OUT_DIR / "Outbound_Dummy.tsv", OUTBOUND_HEADERS, event_rows(profiles, "outbound", rng), "outbound", rng)
    write_tsv(OUT_DIR / "Inbound_Dummy.tsv", INBOUND_HEADERS, event_rows(profiles, "inbound", rng), "inbound", rng)
    write_tsv(OUT_DIR / "Stock_Dummy.tsv", STOCK_HEADERS, event_rows(profiles, "stock", rng), "stock", rng)
    print(f"created={OUT_DIR}")
    print(f"master_profiles={len(profiles)} rows_each={ROWS}")


if __name__ == "__main__":
    main()
