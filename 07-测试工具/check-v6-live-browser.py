"""Read-only acceptance of the deployed V6 verifier and product pages."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
out = root / "08-截图存证/2026-10-29-v6迁移"
out.mkdir(parents=True, exist_ok=True)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(root / "site-dist")))
Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"
report = {}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, timeout=15000)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base + "/verify-v6.html", wait_until="domcontentloaded")
        page.wait_for_function("document.querySelectorAll('#rows .row').length === 8 && !document.getElementById('run').disabled", timeout=150000)
        report["verifier_pass"] = page.locator("#pass").inner_text()
        report["verifier_rows"] = page.locator("#rows").inner_text()
        page.screenshot(path=str(out / "V6-链上核验8项.png"), full_page=True)
        assert report["verifier_pass"] == "8", report["verifier_rows"]
        for name in ["rider.html", "console.html", "index-v6.html"]:
            page.goto(base + "/" + name, wait_until="domcontentloaded")
            if name == "rider.html":
                page.wait_for_function("/\\d+\\.\\d+/.test(document.getElementById('quote').innerText)", timeout=60000)
                assert "连接失败" not in page.locator("#netv").inner_text()
                report["rider_quote"] = page.locator("#quote").inner_text()
                code = page.evaluate("CITY_CODE[+document.getElementById('city').value]")
                hours = page.locator("#hours").input_value()
                baseline = json.loads((root / "05-演示站点/evidence/v6-migration-baseline.json").read_text(encoding="utf-8"))
                row = next(r for r in baseline["regions"] if r["code"] == code)
                assert f"{int(row['price' + hours]) / 100:.2f}" in report["rider_quote"]
            elif name == "console.html":
                page.wait_for_function("document.getElementById('pool').innerText.includes('元')", timeout=60000)
                report["platform_pool"] = page.locator("#pool").inner_text()
            else:
                page.wait_for_timeout(8000)
                report["dashboard_has_v6_address"] = "cDe1" in page.locator("body").inner_text()
            page.screenshot(path=str(out / ("V6-实时-" + name.replace(".html", "") + ".png")), full_page=True)
        report["unhandled_errors"] = errors
        assert not errors, errors
        browser.close()
finally:
    server.shutdown()
    (out / "live-browser.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
