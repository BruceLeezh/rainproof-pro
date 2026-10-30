const fs = require('fs');
const root = 'C:/Users/lenovo/Desktop/汉客松/雨证·Rainproof/05-演示站点/';
const file = root + 'index-v6.html';
let s = fs.readFileSync(file, 'utf8');
function replace(a,b) { if (!s.includes(a)) throw new Error('Patch target missing: '+a.slice(0,90)); s=s.replace(a,b); }
replace('</head>', '<script src="weather-coordinates.js"></script>\n<script src="city-weather.js"></script>\n</head>');
replace('<div class="filters" id="rainMode" style="margin-bottom:var(--s3)">', '<div class="rain-toolbar"><div class="filters" id="rainMode" role="group" aria-label="降雨数据模式">');
replace('title="从全国 31 省 / 342 地级市 / 3056 县级单位中任选一个，加为看板第六柱" style="margin-left:var(--s3)"', 'title="选择城市或县区，在三种模式下查看对应数据"');
replace('真值 · 真实观测<span class="eni">Real rainfall</span>', '真值 · 历史气象<span class="eni">Historical rainfall</span>');
replace('实时 · 现网直连<span class="eni">Live (browser-direct)</span>', '实时 · 气象直连<span class="eni">Live rainfall</span>');
replace('      <div class="row" style="margin:0 0 var(--s3)"><span class="tag" id="ucNow"></span></div>', '      </div><div class="city-context"><span id="ucNow" role="status" aria-live="polite"></span><span class="city-context-hint">三种模式共用同一座城市；气象对照无需开通保单。</span></div>');
// Move the city action outside the mode group for a stable toolbar layout.
replace('        <button class="btn sm" id="ucBtn"', '      </div><button class="btn sm" id="ucBtn"');
replace('<span class="eni">add your city</span>', '<span class="eni">My city</span>');
const oldHint=s.match(/          <div class="hint">数据：民政部行政区划[\s\S]*?<\/div>/)[0];
replace(oldHint, '          <div class="hint uc-help"><b>选一次，三种模式通用。</b>演示模式查看链上累计值；真值模式对照固定历史区间；实时模式查看最近 12 / 24 小时的气象降水。<br>未开通承保的城市也可查看气象数据，但不能投保。气象数据仅供对照，不会写链或直接触发赔付。</div>');
replace('    if (tag) tag.textContent = UCstate', '    if (tag && rainModeNow() === "chain") tag.textContent = UCstate');
replace('    if (UC && UCstate === "active" && vals[UC.code] != null) {', '    if (UC && !REGIONS.some(r => r.id === UC.code) && UCstate === "active" && vals[UC.code] != null) {');
replace('const sig = thr + "|" + sel + "|"', 'const sig = (UC ? UC.code : "") + "|" + thr + "|" + sel + "|"');
replace('  const cur = meas.find(m => m.id === sel) || meas[0];', '  const cur = meas.find(m => m.id === sel) || meas[0];\n  if (!cur) return \'<div class="empty">暂无完整雨量数据，请查看上方状态并重试。</div>\';');
// Accurate comparison labels: rainfall alone never establishes settlement eligibility.
s=s.replaceAll('阈值线以下：现网实测，未进入结算','阈值线以下：气象对照值').replaceAll('阈值线以下：实测累计，未进入结算','阈值线以下：历史气象累计').replaceAll('越过阈值线的那一段：会被结算的部分','越过参考阈值的部分，不代表已满足赔付条件').replaceAll('真值累计（写链值）','历史区间累计（未上链）').replaceAll('现网累计（浏览器直连）','最近窗口累计（气象模型）');
s=s.replace('这是 Open-Meteo Archive 自 ${esc(opt.epoch || "")} → ${esc(opt.until || "")} 的实测快照；柱子画淡的那些被喂价闸门拒收，链上不会收下这个数','历史区间 ${esc(opt.epoch || "")} → ${esc(opt.until || "")}；固定五城保留原快照，自选城市按同区间查询 Archive。历史再分析不是地面逐站实测，也不是本合约的写链凭证');
const start=s.indexOf('const LIVE_COORDS =');
const end=s.indexOf('/* 三个按键：',start);
if(start<0||end<0)throw new Error('Weather block missing');
s=s.slice(0,start)+String.raw`
const WEATHER_VIEW = { real: null, live: null };
function rainModeNow() { return document.querySelector('#rainMode .f.on')?.dataset.mode || 'chain'; }
function comparisonRegions() {
  const list = REGIONS.map(r => ({code:r.id, name:r.label})), u = userCity();
  if (u && !list.some(r => r.code === u.code)) list.push(u);
  return list;
}
function weatherMetric(row, thr) {
  const v=row.mm;
  return {id:row.code,label:ucShort(row.name),v,pct:Math.min(100,Math.round(v/(thr*2)*100)),
    belowPct:Math.min(100,Math.round(thr/Math.min(Math.max(v,thr),thr*2)*100)),hit:v>=thr,capped:v>thr*2,
    bad:row.status==='diverge',tag:(userCity()?.code===row.code?'我的城市 · ':'')+(row.snapshot?'内嵌历史快照':'浏览器查询 · 未上链')};
}
function drawWeather(mode, state) {
  const box=$(mode==='real'?'realBoard':'liveBoard'), hours=Number($('hoursInput').value)||24;
  const thr=hours===12?30:50, sel=Number($('regionSel').value)||firstRegionId();
  const ready=state.rows.filter(r=>Number.isFinite(r.mm)), pending=state.rows.filter(r=>r.pending), errors=state.rows.filter(r=>r.error);
  const meas=ready.map(r=>weatherMetric(r,thr));
  const title=mode==='real'?'历史气象对照':'实时气象对照';
  const period=mode==='real'?REAL_RAIN.epoch+' → '+REAL_RAIN.until:'最近 '+hours+' 小时（截至当前整点）';
  const notices=state.rows.filter(r=>r.pending||r.error).map(r=>'<div class="weather-status'+(r.error?' is-error':'')+'"><b>'+esc(ucShort(r.name))+'</b><span>'+esc(r.error||'正在查询气象数据…')+'</span></div>').join('');
  box.innerHTML='<div class="weather-heading"><div><b>'+title+'</b><span>'+esc(period)+'</span></div><button type="button" class="btn sm" data-weather-retry="'+mode+'"'+(state.loading?' disabled':'')+'>'+(state.loading?'查询中…':errors.length?'重试缺失数据':'刷新数据')+'</button></div>'
    +'<p class="weather-disclaimer">参考阈值 '+thr+' mm / '+hours+'h。'+(mode==='real'?'历史区间累计与保障窗口时长不同，不能直接用历史总量认定赔付。':'Forecast API 提供气象模型数据，不是独立雨量站实测。')+' 所有气象数据仅供查看，不写链、不触发赔付。</p>'
    +notices+(meas.length?boardHTML(meas,sel,thr,hours,{real:mode==='real',live:mode==='live',epoch:REAL_RAIN.epoch,until:REAL_RAIN.until}):'<div class="empty">'+(pending.length?'正在加载所选城市…':'暂未取得完整雨量，请重试。')+'</div>')
    +(sel&&!ready.some(r=>r.code===sel)?'<p class="weather-disclaimer">所选城市尚无可用读数，下方主读数暂显示其他已加载城市。</p>':'')
    +'<p class="weather-disclaimer">'+(mode==='real'?'固定五城快照抓取于 '+esc(REAL_RAIN.generatedAt)+'；自选城市为同一历史区间的独立查询，不代表已通过三模型喂价闸门。':'最近窗口逐小时数据必须完整；缺测、空值和网络失败均不会当作 0 mm。')+'</p>'
    +ready.filter(r=>!r.snapshot).map(r=>'<p class="weather-query-meta">'+esc(ucShort(r.name))+' · 格点参考坐标 '+r.lat.toFixed(4)+', '+r.lon.toFixed(4)+' · 查询于 '+esc(new Date(r.at).toLocaleString('zh-CN',{hour12:false}))+'</p>').join('');
  bindBoardClicks(box);
  box.querySelector('[data-weather-retry]').onclick=()=>renderWeather(mode,true);
  if(rainModeNow()===mode){
    const u=userCity(), row=u&&state.rows.find(r=>r.code===u.code);
    $('ucNow').textContent=u?'我的城市：'+ucShort(u.name)+' · #'+u.code+' · '+(row?.pending?'正在查询':row?.error?'查询失败，可重试':row&&Number.isFinite(row.mm)?row.mm+' mm · '+title:'等待数据'):'选择“我的城市”，在三种模式下查看同一区划。';
    renderCityTable();
  }
}
async function renderWeather(mode, force=false) {
  const cities=comparisonRegions(), hours=Number($('hoursInput').value)||24;
  const signature=cities.map(r=>r.code).join(',')+'|'+hours;
  const previous=WEATHER_VIEW[mode];
  if(previous?.loading&&previous.signature===signature){drawWeather(mode,previous);return;}
  const state={signature,loading:true,rows:cities.map(city=>{
    const snapshot=mode==='real'&&REAL_RAIN.regions.find(r=>realRegionId(r)===city.code);
    return snapshot?{...city,...snapshot,code:city.code,snapshot:true}:{...city,pending:true};
  })};
  WEATHER_VIEW[mode]=state;drawWeather(mode,state);
  await Promise.all(state.rows.map(async (row,i)=>{
    if(row.snapshot)return;
    try {const data=await RainproofCityWeather.read(row,{mode,hours,epoch:REAL_RAIN.epoch,until:REAL_RAIN.until,force});state.rows[i]={code:row.code,name:row.name,...data};}
    catch(error){state.rows[i]={code:row.code,name:row.name,error:error.message||String(error)};}
  }));
  if(WEATHER_VIEW[mode]!==state)return; // A slow response for the former city/window cannot replace the new selection.
  state.loading=false;drawWeather(mode,state);
}
function renderLive(){return renderWeather('live');}
function renderReal(){return renderWeather('real');}

`+s.slice(end);
replace('    if (mode === "live") renderLive();', '    if (mode === "live") renderLive();\n    if (mode === "chain") { loadRegions(); const u=userCity(); $("ucNow").textContent=u?"我的城市："+ucShort(u.name)+" · 正在读取链上状态":"选择我的城市，可在三种模式下查看。"; }\n    renderCityTable();\n    try { const url=new URL(location.href); url.searchParams.set("rain",mode); history.replaceState(null,"",url); } catch(e) {}');
// Mode-neutral right-side table: never reuse chain values in the weather modes.
const tableStart=s.indexOf('function renderCityTable() {'),tableEnd=s.indexOf('/* 右栏②',tableStart);
s=s.slice(0,tableStart)+String.raw`function renderCityTable() {
  const box=$('cityTable');if(!box)return;
  const mode=rainModeNow(), hours=Number($('hoursInput').value)||24, thr=mode==='chain'?Number(S.meta?.threshold):(hours===12?30:50);
  const sel=Number($('regionSel').value), list=comparisonRegions();
  box.innerHTML='<p class="weather-table-label">'+(mode==='chain'?'链上累计':mode==='real'?'历史气象累计':'最近 '+hours+'h 气象累计')+'</p>'+list.map(city=>{
    const row=WEATHER_VIEW[mode]?.rows.find(r=>r.code===city.code);
    const v=mode==='chain'?S.rainVals?.[city.code]:row?.mm;
    const missing=typeof v!=='number'||!Number.isFinite(v);
    const tail=missing?(row?.pending?'查询中':row?.error?'查询失败':'暂无读数'):(v>=thr?'越线 +'+Math.round((v-thr)*100)/100:'距线 '+Math.round((thr-v)*100)/100)+' mm';
    return '<button class="crow'+(city.code===sel?' on':'')+'" data-region="'+city.code+'"><b>'+esc(ucShort(city.name))+(userCity()?.code===city.code?'<small>我的城市</small>':'')+'</b><span class="v">'+(missing?'—':v)+'<u>mm</u></span><span class="d">'+esc(tail)+'</span></button>';
  }).join('');
  box.querySelectorAll('[data-region]').forEach(el=>el.onclick=()=>selectRegion(Number(el.dataset.region)));
}

`+s.slice(tableEnd);
replace('$("regionSel").onchange = () => { refreshPremium().then(() => loadRegions()); };', '$("regionSel").onchange = () => { const mode=rainModeNow(); if(mode!=="chain") renderWeather(mode); refreshPremium().then(() => loadRegions()).catch(() => { markSelRegion(); renderCityTable(); }); };');
replace('  localStorage.setItem(UC_KEY, JSON.stringify({ code: n, name: String(name || ("区域 #" + n)) }));', '  try { localStorage.setItem(UC_KEY, JSON.stringify({ code: n, name: String(name || ("区域 #" + n)) })); } catch(e) { toast("无法保存城市，请允许浏览器使用本地存储后重试", "err"); return; }');
replace('  location.reload();   // 重载后第六柱、下拉与顶部片都按新城市渲染', `  const u=userCity();
  $('regionSel').innerHTML=REGIONS.map(r=>'<option value="'+r.id+'">'+r.label+'</option>').join('')+userOptionHTML();
  $('regionChips').innerHTML=REGIONS.map(r=>'<button class="chip" data-region="'+r.id+'">'+r.label+'</button>').join('')+(!REGIONS.some(r=>r.id===u.code)?'<button class="chip" data-region="'+u.code+'">'+esc(ucShort(u.name))+'</button>':'');
  $('regionSel').value=String(u.code); S.rainSig=null;
  const mode=rainModeNow(); if(mode!=='chain') renderWeather(mode); else if(S.readC) loadRegions();
  markSelRegion(); renderCityTable(); $('ucBtn').focus();`);
replace('    (userCity() ? `<button class="chip" data-region="${userCity().code}">${ucShort(userCity().name)}</button>` : "");', '    (userCity() && !REGIONS.some(r=>r.id===userCity().code) ? `<button class="chip" data-region="${userCity().code}">${esc(ucShort(userCity().name))}</button>` : "");');
replace('  markHoursChips();\n  $("hoursChips").onclick', '  { const u=userCity(); if(u) $("regionSel").value=String(u.code); }\n  markHoursChips();\n  $("hoursChips").onclick');
// Observe the selected window immediately, independent of the RPC's quotation request.
replace('    $("hoursInput").dispatchEvent(new Event("change"));', '    $("hoursInput").dispatchEvent(new Event("change"));\n    if(rainModeNow()!=="chain") renderWeather(rainModeNow());');
// Short, readable section names; details remain next to their data.
s=s.replace('五城一览','城市一览').replace('同一把尺子：满量程 = 2 × 阈值 · 超出者顶格','满量程为参考阈值的 2 倍').replace('事件名与参数都是合约发出的原始内容，本页只做翻译','展示合约事件与原始参数');
fs.writeFileSync(file,s);
console.log('Updated V6 city dashboard and mode-aware comparison views');
