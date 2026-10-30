"""Read-only inventory and syntax audit; excludes secrets, dependencies and historical construction tools."""
from pathlib import Path
import ast
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parent.parent
entries = []
issues = []
excluded = {".git", "node_modules", "_归档", "_history", "__pycache__", "site-dist", ".agents", ".codex"}
for base in [ROOT]:
    for p in sorted(base.rglob("*")):
        if not p.is_file() or excluded.intersection(p.relative_to(base).parts):
            continue
        if p.name in {".env", "_local_chain.json", "source-inventory.json"} or p.suffix.startswith(".bak") or ".bak-" in p.name:
            continue
        rel = str(p.relative_to(ROOT.parent)).replace("\\", "/")
        row = {"path": rel, "bytes": p.stat().st_size, "coverage": "asset-or-cache-inventory"}
        if p.suffix in {".js", ".py", ".sol", ".html", ".md", ".yml", ".json", ".ps1"} and not p.name.endswith(".min.js") and not any(part.startswith("cache-") for part in p.parts):
            raw = p.read_bytes()
            row["sha256"] = hashlib.sha256(raw).hexdigest()
            text = raw.decode("utf-8-sig")
            row["lines"] = len(text.splitlines())
            row["coverage"] = "text-inventory-and-static-audit"
            try:
                if p.suffix == ".py":
                    ast.parse(text, filename=rel)
                elif p.suffix == ".json":
                    json.loads(text)
                elif p.suffix == ".js" and not p.name.startswith(("_patch-", "_fix-", "_gen-")):
                    result = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True, encoding="utf-8")
                    if result.returncode:
                        raise ValueError(result.stderr[:1200])
            except Exception as error:
                issues.append({"path": rel, "error": str(error)[:1200]})
        entries.append(row)
output = ROOT / "08-截图存证/2026-10-28-保险赛全面审查/source-inventory.json"
output.parent.mkdir(parents=True, exist_ok=True)
summary = {"scope": "Current project, insurance competition materials, local event documents. Inventory is not a claim of per-line semantic verification of every historical asset.", "files": len(entries), "text_files": sum(e["coverage"] == "text-inventory-and-static-audit" for e in entries), "syntax_issues": issues, "entries": entries}
output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k: v for k, v in summary.items() if k != "entries"}, ensure_ascii=False, indent=2))
raise SystemExit(bool(issues))
