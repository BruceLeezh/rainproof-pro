"use strict";
// 重建「最近 30 天滚动」历史对照：ERA5 归档有滞后，自动回退到最近一个可用日界。
// 用法：node 07-测试工具/rebuild-historical-rolling.js [--days=30] [--lag=auto]
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,".."),site=path.join(root,"05-演示站点"),weather=require("../05-演示站点/city-weather");
const codes=[420100,310100,110100,440100,510100];
const DAYS=Number((process.argv.find(a=>a.startsWith("--days="))||"").slice(7))||30;
const registry=JSON.parse(fs.readFileSync(path.join(root,"04-脚本/v5-regions.json"),"utf8"));
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(site,"weather-coordinates.js"),"utf8"),ctx);
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const day=n=>new Date(n+8*3600e3).toISOString().slice(0,10);
const HOUR=3600e3;
async function get(url){
  let last;
  for(let i=0;i<3;i++){
    try{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error("Archive HTTP "+r.status);return await r.text();}
    catch(e){last=e;await new Promise(r=>setTimeout(r,700*(i+1)));}
  }
  throw last;
}
function windowOf(startDate,endDate){return weather.windowFor({mode:"real",epoch:startDate,until:endDate},Date.now());}
async function fetchCity(code,startDate,endDate){
  const city=registry.find(r=>r.code===code),[lat,lon]=ctx.window.RAINPROOF_CITY_COORDS[code];
  const url=new URL("https://archive-api.open-meteo.com/v1/archive");
  for(const [k,v] of Object.entries({latitude:lat,longitude:lon,hourly:"precipitation",timezone:"Asia/Shanghai",models:"era5",start_date:startDate,end_date:day(Date.parse(endDate+"T00:00:00Z")+24*HOUR)}))url.searchParams.set(k,String(v));
  const rawText=await get(url),data=JSON.parse(rawText);
  if(data.utc_offset_seconds!==28800)throw new Error(city.name+" timezone mismatch");
  const range=windowOf(startDate,endDate);
  const mm=weather.sumHourly(data,range.start,range.end);   // 缺测会抛错，用来判定「这一天还没归档」
  return {row:{code,id:code,name:city.name,mm,lat,lon,gridLat:data.latitude,gridLon:data.longitude,model:"ERA5",url:String(url),
    rawFile:null,sha256:hash(rawText),hours:(range.end-range.start)/HOUR+1,at:Date.now()},rawText};
}
async function main(){
  const today=day(Date.now());
  const force=process.argv.includes("--force");
  const outFile=path.join(site,"historical-rainfall.js");
  if(!force&&fs.existsSync(outFile)){
    try{
      const cur=JSON.parse(fs.readFileSync(outFile,"utf8").replace(/^window\.RAINPROOF_HISTORICAL_RAINFALL=/,"").replace(/;\s*$/,""));
      const since=(Date.parse(today+"T00:00:00Z")-Date.parse(cur.until+"T00:00:00Z"))/86400e3;
      if(cur.mode==="rolling"&&since<=Number(cur.lagDays||0)){
        console.log(`跳过：窗口已是最新（${cur.epoch} → ${cur.until}，滞后 ${cur.lagDays} 天，距今天 ${since} 天）`);
        return;
      }
    }catch(e){console.log("现有 manifest 读不懂，重建：",e.message.slice(0,60));}
  }
  let chosen=null;
  for(let d=4;d<=16;d++){
    const endDate=day(Date.parse(today+"T00:00:00Z")-d*24*HOUR);
    const startDate=day(Date.parse(endDate+"T00:00:00Z")-(DAYS-1)*24*HOUR);
    try{
      const probe=await fetchCity(420100,startDate,endDate);
      chosen={d,endDate,startDate,probe};
      console.log(`✅ ERA5 已归档到 ${endDate}（滞后 ${d} 天），窗口 ${startDate} → ${endDate}`);
      break;
    }catch(e){console.log(`… ${endDate} 尚未完整归档（${e.message.slice(0,40)}），回退一天`);}
  }
  if(!chosen)throw new Error("近 12 天内没有任何完整归档窗口");
  const {d:lagDays,endDate,startDate,probe}=chosen;
  const stamp=new Date().toISOString().replace(/[-:.]/g,"").slice(0,15);
  const folder="evidence/history-era5-rolling/"+stamp,dir=path.join(site,folder);
  fs.mkdirSync(dir,{recursive:true});
  const results=[probe];
  for(const code of codes.filter(c=>c!==420100)){
    results.push(await fetchCity(code,startDate,endDate));
  }
  results.sort((a,b)=>codes.indexOf(a.row.code)-codes.indexOf(b.row.code));
  const range=windowOf(startDate,endDate);
  for(const r of results){
    const f=r.row.code+".json";
    fs.writeFileSync(path.join(dir,f),r.rawText,{flag:"wx"});
    r.row.rawFile=folder+"/"+f;
    const range2=windowOf(startDate,endDate);
    const csv='hour_end_Asia_Shanghai,precipitation_mm\n'+JSON.parse(r.rawText).hourly.time.map((t,i)=>({t,v:JSON.parse(r.rawText).hourly.precipitation[i],wall:Date.parse(t+"Z")}))
      .filter(x=>x.wall>=range2.start&&x.wall<=range2.end).map(x=>x.t+"+08:00,"+x.v).join("\n")+"\n";
    const csvName=r.row.code+".csv";
    fs.writeFileSync(path.join(site,folder,csvName),csv,{flag:"wx"});
    r.row.csvFile=folder+"/"+csvName;r.row.csvSha256=hash(csv);
  }
  const manifest={schema:"rainproof/historical-comparison@2",mode:"rolling",windowDays:DAYS,lagDays,
    epoch:startDate,until:endDate,generatedAt:new Date().toISOString(),model:"ERA5",timezone:"Asia/Shanghai",
    periodStart:startDate+"T00:00:00+08:00",periodEndExclusive:day(Date.parse(endDate+"T00:00:00Z")+24*HOUR)+"T00:00:00+08:00",
    source:"Open-Meteo Archive · ERA5",
    note:"Rolling reference window: the most recent "+DAYS+" complete ERA5 archive days. Grid-point reanalysis, not city-wide gauge observations. Not comparable with the on-chain cumulative readings, which start at each region's own epoch.",
    regions:results.map(r=>r.row)};
  fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify(manifest,null,2),{flag:"wx"});
  fs.writeFileSync(path.join(site,"historical-rainfall.js"),"window.RAINPROOF_HISTORICAL_RAINFALL="+JSON.stringify(manifest)+";\n");
  console.log(JSON.stringify(manifest.regions.map(r=>({name:r.name,mm:r.mm,id:r.code})),null,1));
  console.log("hours",(range.end-range.start)/HOUR+1,"days",((range.end-range.start)/HOUR+1)/24,"lagDays",lagDays);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
