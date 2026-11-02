"""Capture the actual pinned five-city reference and check Chengdu against the live ERA5 API."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'08-截图存证/2026-11-02-历史口径统一'
OUT.mkdir(parents=True,exist_ok=True)
report=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for width in [1440,390]:
        page=browser.new_page(viewport={'width':width,'height':1100 if width==1440 else 1000},reduced_motion='reduce')
        page.goto('http://127.0.0.1:8096/index-v6.html?rain=real#dashboard',wait_until='domcontentloaded')
        page.wait_for_function('WEATHER_VIEW.real && !WEATHER_VIEW.real.loading')
        page.evaluate('selectRegion(510100)')
        page.wait_for_function('!WEATHER_VIEW.real.loading && document.querySelector("#realBoard .hero").textContent.includes("168.0")')
        assert page.locator('#realBoard .pbar').count()==5
        assert page.locator('#realBoard .is-rejected').count()==0
        assert page.locator('#realBoard .thr').count()==0
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
        page.locator('#realBoard').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT/f'成都-实际五城-{width}.png'))
        if width==1440:
            page.locator('#realBoard [data-weather-retry]').click()
            page.wait_for_function('!WEATHER_VIEW.real.loading',timeout=25000)
            row=page.evaluate('WEATHER_VIEW.real.rows.find(r=>r.code===510100)')
            assert row['mm']==168,row
            assert 'models=era5' in row['url']
            if row.get('error'):
                assert row.get('snapshot') is True
                assert '已留存原始数据' in row['error']
                report.append({'code':510100,'pinnedMm':168,'onlineVerified':False,'cachedFallbackVerified':True,'error':row['error']})
            else:
                assert not row.get('snapshot',False),row
                report.append({'code':510100,'pinnedMm':168,'browserFreshMm':row['mm'],'url':row['url'],'onlineVerified':True})
        page.close()
    browser.close()
(OUT/'live-era5-recheck.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
