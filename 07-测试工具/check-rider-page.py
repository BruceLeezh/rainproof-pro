# -*- coding: utf-8 -*-
"""彩排用：真浏览器打开 rider.html，核对页面能否读链、报价是否与 stage-card 一致。

用法（仓库根目录，先起静态服务）：
    python -m http.server 8090 --directory 05-演示站点
    python 07-测试工具/check-rider-page.py [--url http://127.0.0.1:8090/rider.html]

判定：控制台无 error、网络徽标不是「连接中」、三个区划报价非「—」即通过。
截图落到 12-开发归档/2026-11-13-彩排/。
"""
import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

CITIES = [("420113", "汉南区"), ("420116", "黄陂区"), ("440100", "广州市")]
SHOT_DIR = Path(__file__).resolve().parents[1] / "12-开发归档" / "2026-11-13-彩排"


def read_state(page):
    def txt(sel):
        try:
            return page.eval_on_selector(sel, "el => el.innerText.trim()")
        except Exception:
            return None

    buy = page.query_selector("#buy")
    return {
        "net": txt("#netv"),
        "pool": txt("#poolv"),
        "rain": txt("#rainv"),
        "threshold": txt("#thv"),
        "quote": txt("#quote"),
        "feedtag": txt("#feedtag"),
        "note": txt("#offerNote"),
        "buy": txt("#buy"),
        "buyDisabled": buy.is_disabled() if buy else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8090/rider.html")
    args = ap.parse_args()
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    errors, logs = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: (logs.append(f"{m.type}: {m.text}"),
                                      errors.append(m.text) if m.type == "error" else None))
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(args.url, wait_until="load", timeout=60000)
        page.wait_for_timeout(6000)

        results = {}
        results["default"] = read_state(page)
        page.screenshot(path=str(SHOT_DIR / "rider-默认.png"), full_page=False)

        for code, name in CITIES:
            try:
                page.select_option("#city", code)
            except Exception as e:  # 选项没渲染出来也要记下来
                results[name] = {"error": f"select_option failed: {e}"}
                continue
            page.wait_for_timeout(2500)
            st = read_state(page)
            results[name] = st
            page.screenshot(path=str(SHOT_DIR / f"rider-{name}.png"), full_page=False)

        browser.close()

    print(json.dumps({"results": results, "errors": errors[:20]}, ensure_ascii=False, indent=2))

    ok = True
    for name, st in results.items():
        if st.get("error"):
            print(f"[FAIL] {name}: {st['error']}")
            ok = False
            continue
        quote = (st.get("quote") or "").replace("\n", " ")
        if name != "default" and (not quote or quote.startswith("—")):
            print(f"[FAIL] {name}: 报价未读到 -> {quote!r}")
            ok = False
        else:
            print(f"[ ok ] {name}: {quote} | {st.get('feedtag')} | buy_disabled={st.get('buyDisabled')}")
    if errors:
        print(f"[FAIL] 控制台/页面报错 {len(errors)} 条，见上")
        ok = False
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
