from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1+1]
out=Path(__file__).resolve().parent
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root/'05-演示站点')))
Thread(target=server.serve_forever,daemon=True).start()
results=[]
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/rider.html',wait_until='domcontentloaded')
        page.wait_for_function("document.querySelectorAll('#policies .pol').length===2",timeout=60000)
        assert '#0' in page.locator('#policies').inner_text()
        assert '#1' in page.locator('#policies').inner_text()
        assert '生效基线 126mm' in page.locator('#policies').inner_text()
        page.locator('.policy-ops summary').first.click()
        assert page.locator('.policy-ops button').count()==6
        assert page.locator('.policy-ops button:enabled').count()==0
        results.append({'case':'保单操作含退款/锚定/领取；未连接时均禁用','passed':True})
        page.locator('#wallet').click()
        assert '未检测到钱包' in page.locator('#toast').inner_text()
        results.append({'case':'真实链上两张演示单及武汉生效基线；无钱包点击给出指引','passed':True})
        page.get_by_text('如何连接钱包并投保？',exact=True).click()
        assert '导入只让余额可见' in page.locator('body').inner_text()
        page.wait_for_timeout(2800)
        for width in [1440,768,390,320]:
            page.set_viewport_size({'width':width,'height':1000})
            page.wait_for_timeout(250)
            overflow=page.evaluate('document.documentElement.scrollWidth>innerWidth')
            assert not overflow, f'horizontal overflow at {width}'
            page.screenshot(path=str(out/f'骑手页-{width}.png'),full_page=True)
            results.append({'case':f'{width}px 指引展开无横向溢出','passed':True})
        assert not errors, errors
        results.append({'case':'无未捕获脚本异常','passed':True})
        browser.close()
finally:
    server.shutdown()
    (out/'浏览器验收.json').write_text(json.dumps({'results':results},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False))
