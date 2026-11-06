
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const read = p => require(path.join(root,p));
const {ethers} = read("04-脚本/node_modules/ethers");
const deployment = read("deployment.json");
const registry = read("04-脚本/v5-regions.json");
const grid = read("10-金融与定价/hubei-pricing.json");
const old = read("10-金融与定价/pricing-engine.json");
const published = read("10-金融与定价/pricing-next/model.json");
const builder = read("10-金融与定价/pricing-next/build-model.js");
const core = read("10-金融与定价/pricing-next/core.js");
const summarize = read("10-金融与定价/pricing-next/summarize.js");
const hours = [12,24];
const selected = [420100,310100,110100,440100,510100];
const ceil10 = x => Math.ceil((x-1e-6)/10)*10;
const basicPrice = ratePct => Math.max(100,ceil10((ratePct*100+30)/0.6));
const snapshot = {};
function close(a,b) { assert(Math.abs(a-b) < 1e-6 + Math.abs(b)*1e-12, `${a} != ${b}`); }
async function verifyChain() {
  const request = new ethers.FetchRequest(deployment.rpc);
  request.timeout = 12000;
  const provider = new ethers.JsonRpcProvider(request,968,{staticNetwork:true,batchMaxCount:16});
  const c = new ethers.Contract(deployment.contract,read("03-合约/RainDeliveryInsuranceV6.abi.json"),provider);
  const token = new ethers.Contract(deployment.token,["function decimals() view returns(uint8)"],provider);
  try {
    const b = await provider.getBlock("latest");
    const tag = {blockTag:b.number};
    const invoke = async (name,...args) => c[name](...args,tag);
    const num = async(name,...args) => Number(await invoke(name,...args));
    const [runtime,pricingModule,cooling,grace,count,pool,reserve,openExposure,regionCount,paused,eligibleRequired,tokenDecimals,riderCap,riderExposure] =
      await Promise.all([provider.getCode(deployment.contract,b.number),invoke("pricingModule"),num("coolingPeriod"),num("CLAIM_GRACE"),num("nextPolicyId"),
        num("poolBalance"),num("reserveOf"),num("openExposure"),num("regionCount"),invoke("paused"),invoke("eligibleRequired"),token.decimals(tag),
        num("MAX_POLICIES_PER_RIDER"),num("MAX_OPEN_EXPOSURE_PER_RIDER")]);
    assert.equal(ethers.keccak256(runtime),deployment.runtimeHash);
    assert.equal(pricingModule,ethers.ZeroAddress);
    assert.equal(Number(tokenDecimals),2);
    assert.equal(registry.length,regionCount);
    assert.equal(cooling,86400);
    assert.equal(grace,604800);
    for(const [h,a,z] of [[12,30,70],[24,50,100]]) {
      assert.equal(await num("thresholdOf",h,0),a);
      assert.equal(await num("thresholdOf",h,1),z);
    }
    assert.equal(await num("tierBps",0),5000);
    assert.equal(await num("tierBps",1),7500);
    const rates = [];
    const differences = [];
    for(let i=0;i<registry.length;i+=6) {
      rates.push(...await Promise.all(registry.slice(i,i+6).map(async r => {
        const county = grid.regions.find(x=>x.code===r.code);
        const p = await Promise.all(hours.map(async h=>{
          const city = old.cells.find(x=>x.regionName===r.name && x.hours===h && x.segKey==="t0c0");
          const stats = county?.[h===12?"hours12":"hours24"] ?? city;
          assert(stats,`missing source ${r.code} ${h}`);
          const price = await num("premiumOf(uint32,uint256)",r.code,h);
          const stored = await num("premiumGrid",r.code,h);
          assert.equal(price,stored);
          const rebuilt = basicPrice(stats.upperRatePct);
          if (price!==rebuilt || (county && county.grid[h]!==price))
            differences.push({code:r.code,name:r.name,h,price,rebuilt,storedTable:county?.grid[h]});
          return {h,price,rebuilt,upper:stats.upperRatePct,point:stats.pointRatePct};
        }));
        return {code:r.code,name:r.name,p};
      })));
    }
    const policies = [];
    for(let id=0;id<count;id++) {
      const [p,status,j,during] = await Promise.all([invoke("policies",id),invoke("policyStatus",id),invoke("judgements",id),num("rainfallDuring",id)]);
      policies.push({id,region:Number(p.regionId),h:Number(p.windowHours),premium:Number(p.premium),start:Number(p.startTime),effective:Number(p.effectiveFrom),end:Number(p.endTime),buy:Number(p.rainfallAtBuy),anchor:Number(p.rainfallAtEffective),anchored:p.anchored,paid:p.paid,settled:p.settled,payout:Number(p.payout),status,judged:j.exists,during});
    }
    snapshot.chain = {block:b.number,time:b.timestamp,address:deployment.contract,cooling,grace,pool,reserve,openExposure,regionCount,paused,eligibleRequired,riderCap,riderExposure,pricingModule,rates,differences,policies};
    console.log("Chain read",b.number,"rates",rates.length*2,"differences",differences);
  } finally { provider.destroy(); }
}
function verifyResearch() {
  const current = JSON.parse(JSON.stringify(published));
  current.config.assumptions.coolingHours = 24;
  const originalA = {...published.config.assumptions,coolingHours:0};
  const adjustedA = current.config.assumptions;
  let cells=0, changed=0, sourceChecked=0;
  const sample=[];
  for(const totals of Object.values(current.totals))for(const key of Object.keys(totals))totals[key]=0;
  const conditional=[];
  for(const r of current.regions) {
    const ref=published.regions.find(row=>row.code===r.code);
    const {raw,source}=builder.loadRegion(r);
    assert.equal(source.sha256,ref.source.sha256);
    sourceChecked++;
    const data=builder.prepare(raw);
    for(const h of hours) {
      const stats=builder.collect(data,h);
      for(const c of r.cells[h]) {
        const slot=current.config.startHours.indexOf(c.startHour);
        const fresh=builder.estimate(stats.month[c.month-1],stats.local[c.month-1][slot],`${r.code}/${h}/${c.month}/${slot}`);
        for(const field of ["q","upper","n","trainingYears","credibility"])assert.deepEqual(fresh[field],c[field],`${r.code}/${h}/${c.month}/${slot}: ${field}`);
        const before=core.quote(originalA,h,c), after=core.quote(adjustedA,h,c);
        assert(after.quoteable && after.stressProfitRatio >= adjustedA.targetProfitRatio - 1e-12);
        changed += Number(after.premiumFen!==before.premiumFen);
        cells++;
        if(selected.includes(r.code)&&[1,7].includes(c.month)&&c.startHour===12) {
          const count=(map)=>[...map.values()].reduce((a,row)=>({n:a.n+row.n,k1:a.k1+row.k1,k2:a.k2+row.k2}),{n:0,k1:0,k2:0});
          sample.push({code:r.code,name:r.name,h,month:c.month,slotCounts:count(stats.local[c.month-1][slot]),monthCounts:count(stats.month[c.month-1]),credibility:c.credibility,before:before.premiumFen,after});
        }
      }
      for(const [part,rows] of Object.entries(stats.held)) {
        const groups=new Map();
        for(const {m,slot,yr,k} of rows) {
          const key=`${m}/${slot}/${yr}`;
          if(!groups.has(key))groups.set(key,{month:m+1,startHour:current.config.startHours[slot],yr,n:0,k1:0,k2:0});
          const g=groups.get(key);g.n++;g.k1+=k>=1;g.k2+=k===2;
        }
        const counts=[...groups.values()];
        assert.deepEqual(counts,ref.backtest[h][part].counts);
        const after=core.backtest(adjustedA,h,r.cells[h],counts);
        for(const key of Object.keys(current.totals[part])){
          close(after[key],ref.backtest[h][part][key]);current.totals[part][key]+=after[key];
        }
        r.backtest[h][part]=after;
      }
      if(selected.includes(r.code)) {
        const counts={n:0,wet:0,heavy:0,oldAll:0,newAll:0,oldWet:0,newWet:0,newHeavy:0};
        const threshold=current.config.thresholdsMm[h][0]*1000;
        const range=(a,b)=>data.sum[b+1]-data.sum[a+1];
        for(let i=24;i+24+h<data.times.length;i++){
          if(data.ts[i+24+h]-data.ts[i-24] !== (48+h)*3600000 || data.bad[i+24+h+1]-data.bad[i-24+1]) continue;
          const antecedent=range(i-24,i);
          const hit0=range(i,i+h)>=threshold;
          const hit1=range(i+24,i+24+h)>=threshold;
          counts.n++; counts.oldAll+=hit0; counts.newAll+=hit1;
          if(antecedent>=10000) {counts.wet++;counts.oldWet+=hit0;counts.newWet+=hit1;}
          if(antecedent>=30000) {counts.heavy++;counts.newHeavy+=hit1;}
        }
        conditional.push({code:r.code,name:r.name,h,...counts});
      }
    }
  }
  snapshot.research={cells,changed,sourceChecked,publishedId:published.modelId,
    after:summarize(current),sample,conditional,
    assumptions:adjustedA,estimation:current.config.estimation,
    inputQuality:current.regions.reduce((a,r)=>({missing:a.missing+r.quality.missing,gaps:a.gaps+r.quality.gaps,unpinned:a.unpinned+Number(r.source.model==="archive-default-not-pinned")}),{missing:0,gaps:0,unpinned:0})};
  console.log("Research rebuilt:",cells,"cells;",changed,"quotes changed with T+1 occupancy");
}
(async()=>{
  await verifyChain();
  verifyResearch();
  fs.writeFileSync(path.join(__dirname,"复算结果.json"),JSON.stringify(snapshot,null,2)+"\n");
})().catch(error=>{console.error(error);process.exitCode=1;});

