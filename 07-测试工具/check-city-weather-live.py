"""Read-only connectivity check; records real responses separately from fixture tests."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent.parent
out=root/'08-截图存证/2026-10-29-城市三模式与排版'
out.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce')
 page.goto('http://127.0.0.1:8096/index-v6.html?rain=live#dashboard',wait_until='domcontentloaded')
 result=page.evaluate('''async () => {
   const tasks=[{city:{code:420202,name:'黄石港区'},mode:'live'},{city:{code:330782,name:'义乌市'},mode:'live'},{city:{code:330782,name:'义乌市'},mode:'real'}];
   return Promise.all(tasks.map(async ({city,mode})=>{
     try {const data=await RainproofCityWeather.read(city,{mode,hours:12,epoch:REAL_RAIN.epoch,until:REAL_RAIN.until});return {city,mode,ok:true,...data};}
     catch(error){return {city,mode,ok:false,error:error.message};}
   }));
 }''')
 (out/'live-connectivity.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(result,ensure_ascii=False))
 browser.close()
