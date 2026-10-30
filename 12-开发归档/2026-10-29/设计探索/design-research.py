from pathlib import Path
from playwright.sync_api import sync_playwright
import json

out = Path(__file__).resolve().parent / 'design-preview' / 'research'
out.mkdir(parents=True, exist_ok=True)
targets = {
    'raincoat': 'https://www.raincoat.com/',
    'arbol': 'https://www.arbol.io/',
    'descartes': 'https://descartesunderwriting.com/',
    'lemonade': 'https://www.lemonade.com/',
    'current': 'http://127.0.0.1:8096/',
}
report = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, url in targets.items():
        page = browser.new_page(viewport={'width': 1440, 'height': 1050}, device_scale_factor=1)
        try:
            page.goto(url, wait_until='domcontentloaded', timeout=30000)
            page.wait_for_timeout(1600)
            page.screenshot(path=str(out / (name + '.png')))
            report.append({'name': name, 'url': url, 'title': page.title(), 'screenshot': str(out / (name + '.png'))})
        except Exception as error:
            report.append({'name': name, 'url': url, 'error': str(error)[:180]})
        finally:
            page.close()
    browser.close()
(out / 'research.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
