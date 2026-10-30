from pathlib import Path
from playwright.sync_api import sync_playwright
import shutil, json, hashlib

root = Path(r'C:\Users\lenovo\Desktop\汉客松\雨证·Rainproof')
src = root / '05-演示站点/design-preview'
dist = root / 'site-dist/design-preview'
out = Path(__file__).resolve().parent / 'design-preview'
out.mkdir(exist_ok=True)
shutil.copytree(src, dist, dirs_exist_ok=True)
base = 'http://127.0.0.1:8096/design-preview/'
report = {'pages':[], 'source_homepage_sha256':hashlib.sha256((root / '05-演示站点/insurance.html').read_bytes()).hexdigest()}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for key in 'abc':
        for width,height,label in [(1440,1120,'desktop'),(768,1100,'tablet'),(390,1400,'mobile')]:
            page = browser.new_page(viewport={'width':width,'height':height}, device_scale_factor=1)
            errors, failures = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: failures.append({'url':r.url,'status':r.status}) if r.status >= 400 else None)
            response = page.goto(base + key + '.html', wait_until='networkidle')
            page.evaluate('document.fonts.ready')
            assert response.status == 200
            assert page.locator('h1').count() == 1
            overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            assert not overflow, (key, width, 'overflow')
            page.locator('[data-hours="24"]').click()
            assert page.locator('[data-first]').first.inner_text() == '50'
            assert page.locator('[data-second]').first.inner_text() == '100'
            page.locator('[data-hours="12"]').click()
            assert page.locator('[data-first]').first.inner_text() == '30'
            assert page.locator('[data-second]').first.inner_text() == '70'
            page.locator('details summary').first.click()
            assert page.locator('details').first.get_attribute('open') is not None
            page.locator('details summary').first.click()
            if width < 761:
                page.locator('.menu-toggle').click()
                assert page.locator('.menu-toggle').get_attribute('aria-expanded') == 'true'
                assert page.locator('.nav-links').is_visible()
                page.keyboard.press('Escape')
                assert page.locator('.menu-toggle').get_attribute('aria-expanded') == 'false'
            page.evaluate('document.activeElement.blur(); scrollTo(0,0)')
            page.wait_for_timeout(250)
            if label != 'tablet':
                image = src / 'assets' / f'preview-{key}-{label}.png'
                page.screenshot(path=str(image))
                shutil.copy2(image, dist / 'assets' / image.name)
                shutil.copy2(image, out / image.name)
            if label == 'desktop':
                page.screenshot(path=str(out / f'concept-{key}-full.png'), full_page=True)
            fonts = page.evaluate('Array.from(document.fonts).map(f=>({family:f.family,status:f.status}))')
            assert not errors, errors
            assert not failures, failures
            report['pages'].append({'key':key,'width':width,'height':height,'no_overflow':not overflow,'rules_switch':True,'faq':True,'errors':errors,'failed_assets':failures,'fonts':fonts})
            page.close()
    for width in [390,1440]:
        page = browser.new_page(viewport={'width':width,'height':1150},device_scale_factor=1)
        page.goto(base,wait_until='networkidle')
        page.evaluate('document.fonts.ready')
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
        for image in page.locator('img').all():
            assert image.evaluate('(img)=>img.complete && img.naturalWidth>0')
        page.locator('[data-size="mobile"]').click()
        page.wait_for_function('Array.from(document.images).every(i=>i.complete && i.naturalWidth>0)')
        page.locator('[data-size="desktop"]').click()
        page.wait_for_function('Array.from(document.images).every(i=>i.complete && i.naturalWidth>0)')
        page.screenshot(path=str(out / f'gallery-{width}.png'),full_page=width==390)
        page.close()
    browser.close()
(out / 'browser-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'cases':len(report['pages']),'gallery_sizes':2,'status':'passed','preview':base},ensure_ascii=False))
