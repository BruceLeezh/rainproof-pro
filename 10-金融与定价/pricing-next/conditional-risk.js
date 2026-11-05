
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const {prepare,loadRegion} = require("./build-model");
const cities = new Map([[420100,"wuhan"],[310100,"shanghai"],[110100,"beijing"],[440100,"guangzhou"],[510100,"chengdu"]]);
const registry = require("../../04-脚本/v5-regions.json");
const DAY = 24;
const HOUR_MS = 3600000;
const SCALE = 1000;

function study(data, duration, threshold) {
  const keys = ["unconditional","ante10","ante30","legacyAll","legacyAnte10"];
  const counts = Object.fromEntries(keys.map(k=>[k,{trials:0,hits:0}]));
  const add = (key, hit) => { counts[key].trials++; counts[key].hits += Number(hit); };
  // Open-Meteo precipitation at t covers the preceding hour. Use (from, to].
  const sum = (from,to) => data.sum[to+1] - data.sum[from+1];
  for (let t=DAY; t+DAY+duration < data.times.length; t++) {
    const start=t-DAY, end=t+DAY+duration;
    if (data.ts[end]-data.ts[start] !== (2*DAY+duration)*HOUR_MS || data.bad[end+1]-data.bad[start+1]) continue;
    const before = sum(start,t);
    const legacy = sum(t,t+duration) >= threshold*SCALE;
    const delayed = sum(t+DAY,end) >= threshold*SCALE;
    add("unconditional",delayed);
    add("legacyAll",legacy);
    if (before>=10*SCALE) { add("ante10",delayed); add("legacyAnte10",legacy); }
    if (before>=30*SCALE) add("ante30",delayed);
  }
  const prob = k => counts[k].trials ? counts[k].hits/counts[k].trials : null;
  const num = (n,digits) => n===null ? null : Number(n.toFixed(digits));
  const pct = k => prob(k)===null ? null : num(prob(k)*100,3);
  const ratio = (a,b) => prob(a)!==null && prob(b)>0 ? num(prob(a)/prob(b),2) : null;
  return {
    product: duration+"h", thresholdMm:threshold,
    unconditionalPct:pct("unconditional"), rainBuyPct:pct("ante10"),
    rainBuyMultiplierVsUncond:ratio("ante10","unconditional"), heavyRainBuyPct:pct("ante30"),
    heavyRainBuyMultiplierVsUncond:ratio("ante30","unconditional"),
    legacyNoT1_unconditionalPct:pct("legacyAll"), legacyNoT1_rainBuyPct:pct("legacyAnte10"),
    legacyNoT1_multiplierVsUncond:ratio("legacyAnte10","legacyAll"),
    t1RemovalPct:prob("legacyAnte10")>0 && prob("ante10")!==null ? num((1-prob("ante10")/prob("legacyAnte10"))*100,1) : null,
    counts,
  };
}

if (require.main===module) {
  const results = {
    schema:"rainproof/conditional-risk@2", generatedAt:new Date().toISOString(),
    note:"前24小时雨量≥10/30 mm 的条件触发频率。T+0、T+24h 各用同口径无条件频率。Open-Meteo Archive 固定缓存；源模型未锁定；窗口采用前一小时总量、排除缺测。",
    cities:[...cities].map(([code,key])=>{
      const region=registry.find(r=>r.code===code);
      const {raw,source}=loadRegion(region);
      const data=prepare(raw);
      return {code:key,name:region.name,hours:data.times.length,source,products:[study(data,12,30),study(data,24,50)]};
    })
  };
  fs.writeFileSync(path.join(__dirname,"conditional-risk.json"),JSON.stringify(results,null,2)+"\n");
  for (const {name,products} of results.cities) for (const p of products)
    console.log(name,p.product,p.legacyNoT1_multiplierVsUncond,p.rainBuyMultiplierVsUncond,p.t1RemovalPct);
}
module.exports={study};
