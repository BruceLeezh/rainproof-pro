"use strict";
// Fetch one explicitly pinned historical reference, preserving raw responses for independent checks.
const fs=require("fs"),path=require("path"),vm=require("vm"),crypto=require("crypto");
const root=path.resolve(__dirname,".."),site=path.join(root,"05-演示站点"),weather=require("../05-演示站点/city-weather");
const opts={mode:"real",epoch:"2026-09-01",until:"2026-10-08"};
const codes=[420100,310100,110100,440100,510100];
const registry=JSON.parse(fs.readFileSync(path.join(root,"04-脚本/v5-regions.json"),"utf8"));
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(site,"weather-coordinates.js"),"utf8"),ctx);
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
function csvFor(raw){
  const range=weather.windowFor(opts,Date.now());
  return 'hour_end_Asia_Shanghai,precipitation_mm\n'+raw.hourly.time.map((t,i)=>({t,v:raw.hourly.precipitation[i],wall:Date.parse(t+'Z')}))
    .filter(r=>r.wall>=range.start&&r.wall<=range.end).map(r=>r.t+'+08:00,'+r.v).join('\n')+'\n';
}
async function main(){
  const range=weather.windowFor(opts,Date.now()),stamp=new Date().toISOString().replace(/[-:.]/g,"");
  const folder="evidence/history-era5/"+stamp,dir=path.join(site,folder);
  const results=await Promise.all(codes.map(async code=>{
    const city=registry.find(r=>r.code===code),[lat,lon]=ctx.window.RAINPROOF_CITY_COORDS[code];
    const url=new URL("https://archive-api.open-meteo.com/v1/archive");
    for(const [k,v]of Object.entries({latitude:lat,longitude:lon,hourly:"precipitation",timezone:"Asia/Shanghai",models:"era5",start_date:opts.epoch,end_date:new Date(range.end).toISOString().slice(0,10)}))url.searchParams.set(k,String(v));
    let rawText,data,last;
    for(let attempt=0;attempt<3;attempt++){
      try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error("Archive HTTP "+r.status);rawText=await r.text();data=JSON.parse(rawText);break;}
      catch(error){last=error;if(attempt===2)throw last;await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));}
    }
    if(data.utc_offset_seconds!==28800)throw new Error(city.name+" timezone mismatch");
    const mm=weather.sumHourly(data,range.start,range.end);
    return {row:{code,id:code,name:city.name,mm,lat,lon,gridLat:data.latitude,gridLon:data.longitude,model:"ERA5",url:String(url),
      rawFile:folder+"/"+code+".json",sha256:hash(rawText),hours:(range.end-range.start)/3600000+1,at:Date.now()},rawText};
  }));
  fs.mkdirSync(dir,{recursive:true});
  for(const r of results){
    fs.writeFileSync(path.join(dir,r.row.code+".json"),r.rawText,{flag:"wx"});
    const csv=csvFor(JSON.parse(r.rawText));r.row.csvFile=folder+"/"+r.row.code+".csv";r.row.csvSha256=hash(csv);
    fs.writeFileSync(path.join(site,r.row.csvFile),csv,{flag:"wx"});
  }
  const manifest={schema:"rainproof/historical-comparison@2",epoch:opts.epoch,until:opts.until,generatedAt:new Date().toISOString(),
    model:"ERA5",timezone:"Asia/Shanghai",periodStart:opts.epoch+"T00:00:00+08:00",periodEndExclusive:new Date(range.end).toISOString().slice(0,10)+"T00:00:00+08:00",
    source:"Open-Meteo Archive · ERA5",note:"Reference grid-point reanalysis, not city-wide gauge observations. No feed gate metadata from other periods.",
    regions:results.map(r=>r.row)};
  fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify(manifest,null,2),{flag:"wx"});
  fs.writeFileSync(path.join(site,"historical-rainfall.js"),"window.RAINPROOF_HISTORICAL_RAINFALL="+JSON.stringify(manifest)+";\n");
  console.log(JSON.stringify(manifest,null,2));
}
module.exports={csvFor};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
