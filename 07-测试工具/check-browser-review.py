"""Local browser smoke: no wallet injection and no external RPC; saves reproducible evidence."""
import functools
import http.server
import json
import pathlib
import threading
import re
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "08-截图存证" / "2026-10-29-城市三模式与排版" / "全站回归"
OUT.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "site-dist")))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"
results = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, timeout=15000)
        for width in [390, 1440]:
            page = browser.new_page(viewport={"width": width, "height": 844 if width == 390 else 1000})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            def routing(route):
                if urlsplit(route.request.url).path == "/unavailable":
                    route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": '<img id="rpc-injection" src=x onerror="alert(1)">'}))
                elif route.request.url.startswith(base):
                    route.continue_()
                else:
                    route.abort()
            page.route("**/*", routing)
            for name in ["index.html", "terms.html", "rider.html", "console.html", "verify-v6.html", "index-v6.html"]:
                errors.clear()
                page.goto(base + "/" + name + "?rpc=" + base + "/unavailable", wait_until="domcontentloaded")
                page.wait_for_timeout(1500)
                if name == "rider.html":
                    page.locator("#buy").click()
                    assert "钱包" in page.locator("#buyerr").inner_text()
                if name == "console.html":
                    page.locator("#csv").fill("invalid-address")
                    page.locator("#gen").click()
                    assert "地址" in page.locator("#genout").inner_text()
                overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
                assert page.locator("#rpc-injection").count() == 0
                shot = OUT / f"{name.removesuffix('.html')}-{width}.png"
                page.screenshot(path=str(shot), full_page=True)
                results.append({"page": name, "width": width, "overflow": overflow, "errors": list(errors), "screenshot": shot.name})
                print(name, width, "overflow=", overflow, "errors=", len(errors), flush=True)
            page.close()
        browser.close()
finally:
    server.shutdown()
    (OUT / "browser-review.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
if any(row["overflow"] or row["errors"] for row in results):
    raise SystemExit(1)
