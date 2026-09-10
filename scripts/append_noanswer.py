"""no_answer 5문항만 실행해 기존 eval_result.json 에 붙인다 (전체 재실행 불필요)."""
import json, os, sys
from pathlib import Path
import httpx
from dotenv import load_dotenv
load_dotenv()
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_eval import parse, BASE, H, OUT, refused

items = [i for i in parse() if i["type"] == "no_answer"]
print(f"no_answer {len(items)}문항")
res = json.loads(OUT.read_text(encoding="utf-8"))
res = [r for r in res if r.get("type") != "no_answer"]
for it in items:
    d = httpx.post(f"{BASE}/api/chat", json={"question": it["question"], "history": []},
                   headers=H, timeout=180).json()
    cited = [c["file_name"] for c in d["citations"]]
    res.append({**it, "route": d["route"], "no_answer": d["no_answer"],
                "total_ms": d["metrics"]["total_ms"],
                "embed_ms": d["metrics"].get("embed_ms"),
                "retrieve_ms": d["metrics"].get("retrieve_ms"),
                "rerank_ms": d["metrics"].get("rerank_ms"),
                "generate_ms": d["metrics"].get("generate_ms"),
                "route_source": (d.get("route_reason") or {}).get("source"),
                "citation_coverage": d["metrics"].get("citation_coverage"),
                "n_citations": len(cited), "cited_files": cited, "hit": None,
                "refused": refused(d.get("answer", ""), d["no_answer"])})
    print(f"  {it['id']} route={d['route']} no_answer={d['no_answer']} :: {it['question'][:34]}")
res = [{k: v for k, v in r.items() if k not in ("question", "expected")} for r in res]
OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
ok = sum(1 for r in res if r["type"] == "no_answer" and r.get("refused"))
print(f"\n총 {len(res)}문항 · 올바른 거절 {ok}/{len(items)}")
