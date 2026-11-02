"""Browser verification for research pricing. No RPC or wallet required."""
from pathlib import Path
import functools
import http.server
import threading
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'08-截图存证/2026-11-02-差异化定价'
OUT.mkdir(parents=True,exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'site-dist')))
threading.Thread(target=server.serve_forever,daemon=True).start()
results=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        for width in [1440,768,390,320]:
            page=browser.new_page(viewport={'width':width,'height':1000},reduced_motion='reduce')
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/pricing-lab.html',wait_until='load')
            assert '测算完成' in page.locator('#pricing-status').inner_text()
            assert page.locator('#pricing-compare tr').count()==2
            assert '50.00' in page.locator('#pricing-compare').inner_text()
            a=page.locator('#pricing-premium').inner_text()
            page.select_option('#pricing-hours','24')
            b=page.locator('#pricing-premium').inner_text()
            assert a!=b
            page.select_option('#pricing-month','1')
            assert page.locator('#pricing-premium').inner_text()!=b
            page.select_option('#pricing-mode','income-linked')
            assert '30.00' in page.locator('#pricing-compare').inner_text()
            assert '45.00' in page.locator('#pricing-compare').inner_text()
            page.select_option('#pricing-channel','instant-retail')
            assert page.locator('#pricing-premium').inner_text()=='不报价'
            page.select_option('#pricing-channel','calendar-batch-precommitted')
            page.locator('#pricing-volume').fill('0')
            assert '无法测算' in page.locator('#pricing-status').inner_text()
            assert page.locator('#pricing-download').is_disabled()
            page.locator('#pricing-volume').fill('200000')
            page.select_option('#pricing-mode','fixed-v6')
            page.select_option('#pricing-month','7')
            page.select_option('#pricing-hours','12')
            with page.expect_download() as download:
                page.locator('#pricing-download').click()
            export=OUT/f'quote-{width}.json';download.value.save_as(str(export))
            record=json.loads(export.read_text(encoding='utf-8'))
            assert record['productionReady'] is False
            assert record['result']['tiers']==[5000,7500]
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
            assert not errors,errors
            page.evaluate('window.scrollTo(0,0)')
            page.screenshot(path=str(OUT/f'pricing-{width}.png'),full_page=True)
            results.append({'width':width,'passed':True,'scriptErrors':errors})
            print(width,'passed',flush=True)
            page.close()
        browser.close()
finally:
    server.shutdown()
    (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
