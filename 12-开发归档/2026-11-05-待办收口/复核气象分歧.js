
"use strict";
const fs=require("node:fs"), path=require("node:path"), crypto=require("node:crypto");
const root=path.resolve(__dirname,"../..");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8"));
const trace=read(path.join(root,"09-AI判定留痕/v6-feed-trace-202611051000-6.json"));
const registry=read(path.join(root,"04-脚本/v5-regions.json"));
const models=["gem_seamless","jma_seamless","meteofrance_seamless"];
const out=path.join(__dirname,"气象证据");
fs.mkdirSync(out,{recursive:true});
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
async function examine(r) {
  const geo=registry.find(x=>x.code===r.code);
  const url=new URL("https://api.open-meteo.com/v1/forecast");
  url.search=new URLSearchParams({latitude:geo.lat,longitude:geo.lon,hourly:"precipitation",timezone:"Asia/Shanghai",
    start_date:r.windowFrom.slice(0,10),end_date:r.windowTo.slice(0,10),models:models.join(",")});
  const result={code:r.code,name:r.name,from:r.windowFrom,to:r.windowTo,base:r.perModel,median:r.median,tolerance:r.tol,spread:r.spread,gateHash:r.raw.sha256,url:url.href};
  try {
    const gate=read(path.join(root,"09-AI判定留痕/raw",r.raw.file));
    result.gateHashVerified=sha(gate.rawText)===r.raw.sha256;
    const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
    const raw=await response.text();
    fs.writeFileSync(path.join(out,r.code+".json"),raw);
    result.extraSha256=sha(raw); result.httpStatus=response.status;
    if (!response.ok) throw new Error("HTTP "+response.status);
    const data=JSON.parse(raw);
    const index=new Map(data.hourly.time.map((t,i)=>[Date.parse(t+"+08:00"),i]));
    const times=[];
    for(let t=Date.parse(r.windowFrom+"+08:00")+3600000;t<=Date.parse(r.windowTo+"+08:00");t+=3600000)times.push(t);
    result.extra=models.map(m=>{
      const values=times.map(t=>data.hourly["precipitation_"+m]?.[index.get(t)]);
      return values.every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0) ? Number(values.reduce((a,b)=>a+b,0).toFixed(2)) : null;
    });
    result.supportingExtraModels=result.extra.filter(v=>v!==null&&Math.abs(v-r.median)<=r.tol).length;
    result.extraSpread=result.extra.every(v=>v!==null)?Number((Math.max(...result.extra)-Math.min(...result.extra)).toFixed(2)):null;
  } catch(e) {result.error=e.message;}
  return result;
}
(async()=>{
  const candidates=trace.regions.filter(x=>x.ok===false&&x.windowH>=24&&x.raw?.file&&x.spread>x.tol);
  const rows=[];
  for(let i=0;i<candidates.length;i+=3) rows.push(...await Promise.all(candidates.slice(i,i+3).map(examine)));
  fs.writeFileSync(path.join(out,"summary.json"),JSON.stringify({time:new Date().toISOString(),round:trace.generatedAt,models,rows},null,2)+"\n");
  console.log(rows.map(r=>[r.name,r.base.map(x=>x?.toFixed(1)),r.extra,r.supportingExtraModels,r.error]));
})().catch(e=>{console.error(e);process.exitCode=1;});

