# -*- coding: utf-8 -*-
"""彩排用：把演示要开的几个页面在 1440x900 下逐个打开、截图、收控制台错误。

用法（仓库根目录）：
    python -m http.server 8090 --directory 05-演示站点
    python 07-测试工具/check-demo-pages.py [--base http://127.0.0.1:8090]

输出：每页一行 状态｜控制台 error 数｜截图文件名；有 error 时把前三条打出来。
"""
import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

PAGES = [
    ("insurance.html", "首页-保险"),
    ("index-v6.html", "技术看板"),
    ("rider.html", "骑手保障"),
    ("console.html", "平台控制台"),
    ("verify-v6.html", "证据核验"),
]
SHOT_DIR = Path(__file__).resolve().parents[1] / "12-开发归档" / "2026-11-13-彩排"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8090")
    args = ap.parse_args()
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    rows, failed = [], 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for path, label in PAGES:
            errors, warns = [], []
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.on("console", lambda m, e=errors, w=warns: (
                e.append(m.text) if m.type == "error" else (w.append(m.text) if m.type == "warning" else None)))
            page.on("pageerror", lambda ex, e=errors: e.append(f"pageerror: {ex}"))
            try:
                page.goto(f"{args.base}/{path}", wait_until="load", timeout=60000)
                page.wait_for_timeout(5000)
                shot = SHOT_DIR / f"页-{label}.png"
                page.screenshot(path=str(shot), full_page=False)
                rows.append({"page": path, "label": label, "errors": errors[:3],
                             "warns": len(warns), "shot": shot.name})
                if errors:
                    failed += 1
            except Exception as e:
                rows.append({"page": path, "label": label, "fatal": str(e)[:300]})
                failed += 1
            finally:
                page.close()
        browser.close()

    print(json.dumps(rows, ensure_ascii=False, indent=2))
    for r in rows:
        if r.get("fatal"):
            print(f"[FAIL] {r['label']}: {r['fatal']}")
        elif r["errors"]:
            print(f"[FAIL] {r['label']}: {len(r['errors'])}+ error，首条 {r['errors'][0][:120]}")
        else:
            print(f"[ ok ] {r['label']}: 0 error（warn {r['warns']}）→ {r['shot']}")
    print("RESULT:", "PASS" if failed == 0 else f"FAIL {failed} 页")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
