"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto"),zlib=require("zlib");
const Core=require("./core");
const ROOT=path.resolve(__dirname,"../.."),CONFIG_FILE=path.join(__dirname,"config.json");
const config=JSON.parse(fs.readFileSync(CONFIG_FILE,"utf8"));
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const tick=3600000;
function validateEstimation(est){
  if(!Number.isInteger(est.bootstrapReps)||est.bootstrapReps<100||est.bootstrapReps>100000)throw new Error("自举次数须为 100–100000 的整数");
  if(!Number.isInteger(est.minTrainingYears)||est.minTrainingYears<8)throw new Error("最少训练年数不得少于 8");
  if(!(est.bootstrapQuantile>=0.5&&est.bootstrapQuantile<1)||!(est.climateStressMultiplier>=1&&est.climateStressMultiplier<=10)||!(est.credibilityPriorDays>=0))throw new Error("估计参数无效");
  const floors=est.minimumStressEventProbabilities;
  if(!Array.isArray(floors)||floors.length!==2||!floors.every(p=>Number.isFinite(p)&&p>0&&p<=1)||floors[1]>floors[0])throw new Error("压力概率地板须为正且保持累计概率顺序");
  if(!(stamp(est.trainEndExclusive)<stamp(est.validationEndExclusive)&&stamp(est.validationEndExclusive)<stamp(est.testEndExclusive)))throw new Error("训练、验证、测试时间必须严格依次划分");
}
function rng(seed){return()=>{seed|=0;seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function seedOf(text){return parseInt(hash(text).slice(0,8),16);}
function stamp(s){if(typeof s!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(s))throw new Error("逐小时本地时间格式无效");const n=Date.parse(s+"+08:00");if(!Number.isFinite(n))throw new Error("时间无效");return n;}
function prepare(raw){
  if(raw.hourly_units?.precipitation!=="mm" || raw.utc_offset_seconds!==28800)throw new Error("需要 mm 单位、Asia/Shanghai 时区原始报文");
  const times=raw.hourly?.time, values=raw.hourly?.precipitation;
  if(!Array.isArray(times)||!Array.isArray(values)||times.length!==values.length||times.length<25)throw new Error("逐小时数据缺失或长度不一致");
  const n=times.length,ts=new Float64Array(n),sum=new Float64Array(n+1),bad=new Int32Array(n+1);let missing=0,gaps=0;
  for(let i=0;i<n;i++){
    ts[i]=stamp(times[i]);if(i&&ts[i]<=ts[i-1])throw new Error("重复或乱序时间");if(i&&ts[i]-ts[i-1]!==tick)gaps++;
    const v=values[i],valid=typeof v==="number"&&Number.isFinite(v)&&v>=0;
    if(!valid)missing++;
    const scaled=valid?Math.round(v*1000):0;
    if(!Number.isSafeInteger(scaled)||!Number.isSafeInteger(sum[i]+scaled))throw new Error("降水超出安全整数范围");
    sum[i+1]=sum[i]+scaled;bad[i+1]=bad[i]+(valid?0:1);
  }
  return {times,ts,sum,bad,quality:{missing,gaps,hours:n,first:times[0],last:times[n-1]}};
}
function outcome(data,i,h,bounds){
  if(i+h>=data.times.length||data.ts[i+h]-data.ts[i]!==h*tick||data.bad[i+h+1]-data.bad[i+1])return null;
  // Precipitation at t is the preceding hour: cover (start, start+h].
  const rain=data.sum[i+h+1]-data.sum[i+1];return rain>=bounds[1]*1000?2:rain>=bounds[0]*1000?1:0;
}
const empty=()=>({n:0,k1:0,k2:0});
function add(s,k){s.n++;if(k>=1)s.k1++;if(k===2)s.k2++;}
function collect(data,h,est=config.estimation){
  const trainCut=stamp(est.trainEndExclusive),validationCut=stamp(est.validationEndExclusive),testCut=stamp(est.testEndExclusive);
  const month=Array.from({length:12},()=>new Map()),local=Array.from({length:12},()=>config.startHours.map(()=>new Map()));
  const held={validation:[],test:[]};let excluded=0;
  for(let i=0;i+h<data.times.length;i++){
    const k=outcome(data,i,h,config.thresholdsMm[h]);if(k===null){excluded++;continue;}
    const text=data.times[i],m=Number(text.slice(5,7))-1,slot=config.startHours.indexOf(Number(text.slice(11,13)));
    const yr=Number(text.slice(0,4))+(m>=9?1:0),end=data.ts[i+h];
    if(end<trainCut){
      if(!month[m].has(yr))month[m].set(yr,empty());add(month[m].get(yr),k);
      if(slot>=0){if(!local[m][slot].has(yr))local[m][slot].set(yr,empty());add(local[m][slot].get(yr),k);}
    }else if(slot>=0){
      // Never mix a window across a training/validation/test cut.
      let part=null;
      if(data.ts[i]>=trainCut&&end<validationCut)part="validation";
      else if(data.ts[i]>=validationCut&&end<testCut)part="test";
      if(part)held[part].push({m,slot,yr,k});
    }
  }
  return {month,local,held,excluded};
}
function estimate(monthMap,localMap,key,est=config.estimation){
  const years=[...monthMap.keys()].filter(y=>localMap.has(y)).sort((a,b)=>a-b);
  if(!years.length)throw new Error("该月份/起保时点无训练样本");
  const merged=indices=>{
    const a=empty(),b=empty();for(const i of indices){const y=years[i],p=monthMap.get(y),l=localMap.get(y);for(const f of ["n","k1","k2"]){a[f]+=p[f];b[f]+=l[f];}}
    const z=b.n/(b.n+est.credibilityPriorDays);
    return {q:["k1","k2"].map(f=>z*b[f]/b.n+(1-z)*a[f]/a.n),n:b.n,z};
  };
  const point=merged(years.map((_,i)=>i)),random=rng(seedOf(key)),samples=[[],[]];
  for(let rep=0;rep<est.bootstrapReps;rep++){
    const q=merged(years.map(()=>Math.floor(random()*years.length))).q;
    samples.forEach((s,j)=>s.push(q[j]));
  }
  const upper=samples.map((s,j)=>{
    s.sort((a,b)=>a-b);const percentile=s[Math.min(s.length-1,Math.ceil(est.bootstrapQuantile*s.length)-1)];
    return Math.min(1,Math.max(point.q[j],percentile,est.minimumStressEventProbabilities[j])*est.climateStressMultiplier);
  });
  return {q:point.q,upper,n:point.n,trainingYears:years.length,minimumTrainingYears:est.minTrainingYears,credibility:point.z};
}
function loadRegion(r){
  const external=path.join(__dirname,"cache",`${r.code}.json.gz`),gz=path.join(ROOT,"10-金融与定价/cache-hubei",`${r.code}.json.gz`);
  const keys={110100:"beijing",310100:"shanghai",420100:"wuhan",440100:"guangzhou",510100:"chengdu"};
  let file=fs.existsSync(external)?external:fs.existsSync(gz)?gz:path.join(ROOT,"10-金融与定价/cache",`${keys[r.code]}-2015-10-01_2026-09-30.json`);
  if(!fs.existsSync(file))throw new Error("缺少该区划原始缓存；禁止用邻区替代");
  const bytes=fs.readFileSync(file),text=file.endsWith(".gz")?zlib.gunzipSync(bytes):bytes;
  const metaFile=path.join(__dirname,"cache",`${r.code}.meta.json`);
  const meta=fs.existsSync(metaFile)&&file===external?JSON.parse(fs.readFileSync(metaFile,"utf8")):null;
  if(meta&&meta.sha256!==hash(text))throw new Error("下载原始报文哈希与来源记录不符");
  return {raw:JSON.parse(text),source:{file:path.relative(ROOT,file).replaceAll("\\","/"),sha256:hash(text),
    model:meta?.model||"archive-default-not-pinned",url:meta?.url||null}};
}
function evaluate(collected,cells,h,a){
  const result={};
  for(const [part,rows] of Object.entries(collected.held)){
    const grouped=new Map();
    for(const row of rows){
      const key=row.m+"/"+row.slot+"/"+row.yr;
      if(!grouped.has(key))grouped.set(key,{month:row.m+1,startHour:config.startHours[row.slot],yr:row.yr,...empty()});
      add(grouped.get(key),row.k);
    }
    const counts=[...grouped.values()];result[part]={...Core.backtest(a,h,cells,counts),counts};
  }
  return result;
}
function main(){
  Core.validate(config.assumptions);
  validateEstimation(config.estimation);
  let regions=JSON.parse(fs.readFileSync(path.join(ROOT,"04-脚本/v5-regions.json"),"utf8"));
  const extra=path.join(__dirname,"extra-regions.json");if(fs.existsSync(extra))regions=regions.concat(JSON.parse(fs.readFileSync(extra,"utf8")));
  const seen=new Set();for(const r of regions){if(seen.has(r.code))throw new Error("重复区划码");seen.add(r.code);}
  const only=process.argv.find(s=>s.startsWith("--only="))?.slice(7);if(only)regions=regions.filter(r=>String(r.code)===only);
  const dataset={schema:"rainproof/pricing-model@1",generatedAt:new Date().toISOString(),config,regions:[],errors:[]};
  for(const r of regions){
    try{
      const {raw,source}=loadRegion(r),data=prepare(raw),out={code:r.code,name:r.name,source,quality:data.quality,cells:{},backtest:{}};
      for(const h of config.hours){const stats=collect(data,h),cells=[];
        for(let month=1;month<=12;month++)for(let slot=0;slot<config.startHours.length;slot++){
          const e=estimate(stats.month[month-1],stats.local[month-1][slot],`${r.code}/${h}/${month}/${slot}`);
          cells.push({month,startHour:config.startHours[slot],...e});
        }
        out.cells[h]=cells;out.backtest[h]=evaluate(stats,cells,h,config.assumptions);
      }
      dataset.regions.push(out);console.log(`OK ${r.code} ${r.name}`);
    }catch(error){dataset.errors.push({code:r.code,name:r.name,error:error.message});console.error(`FAIL ${r.code}: ${error.message}`);}
  }
  const codeHash=file=>hash(fs.readFileSync(file,"utf8").replace(/\r\n/g,"\n"));
  dataset.modelId=hash(JSON.stringify({config,code:codeHash(__filename)+codeHash(path.join(__dirname,"core.js")),sources:dataset.regions.map(r=>[r.code,r.source.sha256])}));
  const totals={validation:{policies:0,premiumFen:0,claimsFen:0,costFen:0,profitFen:0},test:{policies:0,premiumFen:0,claimsFen:0,costFen:0,profitFen:0}};
  for(const r of dataset.regions)for(const h of config.hours)for(const part of Object.keys(totals)){
    const b=r.backtest[h][part],t=totals[part];t.policies+=b.policies;for(const f of ["premiumFen","claimsFen","costFen","profitFen"])t[f]+=b[f];
  }
  dataset.totals=totals;
  const output=only?path.join(__dirname,`model-${only}.json`):path.join(__dirname,"model.json");
  fs.writeFileSync(output,JSON.stringify(dataset,null,2));
  if(!only){
    const browser={schema:dataset.schema,modelId:dataset.modelId,generatedAt:dataset.generatedAt,config,totals,errors:dataset.errors,
      regions:dataset.regions.map(({code,name,source,quality,cells,backtest})=>({code,name,source,quality,cells,backtest}))};
    fs.writeFileSync(path.join(ROOT,"05-演示站点/pricing-next-data.js"),"window.RAINPROOF_PRICING_NEXT="+JSON.stringify(browser)+";\n");
    fs.copyFileSync(path.join(__dirname,"core.js"),path.join(ROOT,"05-演示站点/pricing-next-core.js"));
  }
  console.log(JSON.stringify({regions:dataset.regions.length,errors:dataset.errors,modelId:dataset.modelId,totals},null,2));
  if(dataset.errors.length)process.exitCode=1;
}
module.exports={prepare,outcome,collect,estimate,loadRegion,validateEstimation};
if(require.main===module)main();
