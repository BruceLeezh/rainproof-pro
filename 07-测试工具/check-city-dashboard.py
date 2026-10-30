from pathlib import Path
from datetime import datetime, timedelta
import json
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'08-截图存证/2026-10-29-城市三模式与排版'
OUT.mkdir(exist_ok=True)
BASE='http://127.0.0.1:8096/'
report=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for width in [1440,768,390,320]:
  page=browser.new_page(viewport={'width':width,'height':1000},reduced_motion='reduce')
  errors=[]; page.on('pageerror',lambda error:errors.append(str(error)))
  page.add_init_script("Date.now=()=>1793249100000; localStorage.setItem('hanxong_user_city_v6',JSON.stringify({code:330782,name:'义乌市'}));")
  failure={'on':False}
  def route_handler(route):
   url=route.request.url
   if url.startswith(BASE): return route.continue_()
   if 'geo.datav.aliyun.com' in url:
    code=int(urlsplit(url).path.split('/')[-1].split('.')[0]);return route.fulfill(json={'features':[{'properties':{'adcode':code,'center':[120.08,29.31]}}]})
   if 'open-meteo.com/v1/' in url:
    if failure['on'] and 'latitude=29.31' in url:return route.fulfill(status=503,json={'error':True})
    q=parse_qs(urlsplit(url).query)
    if 'start_date' in q:start=datetime.fromisoformat(q['start_date'][0]);end=datetime.fromisoformat(q['end_date'][0])+timedelta(hours=23)
    else:
     # Match the page's injected Date.now; include both midnight crossings and future values.
     current=datetime.utcfromtimestamp(1793249100000/1000)+timedelta(hours=8)
     start=current.replace(hour=0,minute=0,second=0,microsecond=0)-timedelta(days=2);end=start+timedelta(days=4)
    count=int((end-start).total_seconds()/3600)+1
    return route.fulfill(json={'hourly_units':{'precipitation':'mm'},'hourly':{'time':[(start+timedelta(hours=i)).isoformat(timespec='minutes') for i in range(count)],'precipitation':[1.25]*count}})
   route.abort()
  page.route('**/*',route_handler)
  page.goto(BASE+'index-v6.html?rain=real#dashboard',wait_until='domcontentloaded')
  page.wait_for_function("WEATHER_VIEW.real && !WEATHER_VIEW.real.loading")
  assert page.locator('#realBoard .foot5 [data-region="330782"]').count()==1
  assert page.locator('#regionSel').input_value()=='330782'
  assert '历史气象累计' in page.locator('#cityTable').inner_text()
  # A historical gate failure is visible without deleting or hollowing the rain bar.
  chengdu=page.locator('#realBoard .colwrap[data-region="510100"]')
  assert chengdu.locator('.pbar.is-rejected').count()==1
  assert chengdu.locator('.above').count()==0
  assert '173' in chengdu.inner_text()
  assert '历史核验分歧' in page.locator('#cityTable [data-region="510100"]').inner_text()
  page.evaluate('selectRegion(510100)')
  page.wait_for_function('WEATHER_VIEW.real && !WEATHER_VIEW.real.loading')
  assert '最近 14 天' in page.locator('#realBoard .weather-gate-note').inner_text()
  if width in [1440,390]:
   page.locator('#realBoard .weather-gate-note').scroll_into_view_if_needed()
   page.screenshot(path=str(OUT/f'成都历史核验说明-{width}.png'))
  page.evaluate('selectRegion(330782)')
  page.locator('[data-mode="live"]').click()
  page.wait_for_function("WEATHER_VIEW.live && !WEATHER_VIEW.live.loading")
  assert page.locator('#liveBoard .foot5 [data-region="330782"]').count()==1
  assert page.evaluate('WEATHER_VIEW.live.rows.find(r=>r.code===330782).mm')==30
  page.evaluate("document.getElementById('hoursInput').value='12';renderLive()")
  page.wait_for_function("!WEATHER_VIEW.live.loading")
  assert page.evaluate('WEATHER_VIEW.live.rows.find(r=>r.code===330782).mm')==15
  assert '最近 12h' in page.locator('#cityTable').inner_text()
  failure['on']=True
  page.evaluate("renderWeather('live',true)")
  page.wait_for_function("!WEATHER_VIEW.live.loading")
  assert page.locator('#liveBoard .is-error').count()==1
  assert page.locator('#liveBoard .foot5 .c').count()==5
  assert '查询失败' in page.locator('#ucNow').inner_text()
  failure['on']=False
  page.locator('#liveBoard [data-weather-retry]').click()
  page.wait_for_function("!WEATHER_VIEW.live.loading")
  assert page.locator('#liveBoard .foot5 .c').count()==6
  # Change custom city without reloading or losing the active mode.
  page.evaluate("ucPick(320100,'南京市')")
  page.wait_for_function("!WEATHER_VIEW.live.loading && WEATHER_VIEW.live.rows.some(r=>r.code===320100)")
  assert page.locator('[data-mode="live"]').get_attribute('aria-pressed')=='true'
  assert page.locator('#liveBoard .foot5 [data-region="320100"]').count()==1
  page.evaluate("S.meta={threshold:30,payout:10000n}; S.readC={regions:async()=>['nanjing',true],rainfall:async()=>42};")
  page.locator('[data-mode="chain"]').click()
  page.wait_for_function("document.querySelector('#rainBoard [data-region=\"320100\"]')")
  assert page.locator('#rainBoard .foot5 .c').count()==6
  for mode in ['real','live','chain']:
   page.locator('[data-mode="'+mode+'"]').click()
   if mode!='chain':page.wait_for_function('!WEATHER_VIEW.'+mode+'.loading')
   page.locator('#rainMode').scroll_into_view_if_needed()
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'),(width,mode)
   if width in [1440,390]:page.screenshot(path=str(OUT/f'{mode}-{width}.png'))
  assert not errors,errors
  report.append({'width':width,'modes':3,'custom_city':True,'partial_failure_retry':True,'switch_12_24':True,'preserve_mode':True,'no_overflow':True,'errors':errors})
  page.close()
 browser.close()
(OUT/'browser-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
