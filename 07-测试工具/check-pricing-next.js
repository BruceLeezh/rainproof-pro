"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),assert=require("node:assert/strict");
const core=require("../10-金融与定价/pricing-next/core"),model=require("../10-金融与定价/pricing-next/build-model");
const root=path.resolve(__dirname,".."),config=JSON.parse(fs.readFileSync(path.join(root,"10-金融与定价/pricing-next/config.json"),"utf8"));
const a=structuredClone(config.assumptions),cell={q:[0.1,0.02],upper:[0.15,0.04],trainingYears:8};
let n=0;function ok(label,fn){fn();n++;console.log("OK "+label);}
ok("主方案两时长同为 50/75 元，但按各自风险报价",()=>{assert.deepEqual(core.benefits(a,12).tiers,[5000,7500]);assert.deepEqual(core.benefits(a,24).tiers,[5000,7500]);});
ok("嵌套概率不重复赔大暴雨：5000×0.1+2500×0.02=550 分",()=>assert.equal(core.expectedLoss([5000,7500],[0.1,0.02]),550));
ok("备选收入挂钩方案 12h=30/45、24h=50/75 元",()=>{const b={...a,benefitMode:"income-linked"};assert.deepEqual(core.benefits(b,12).tiers,[3000,4500]);assert.deepEqual(core.benefits(b,24).tiers,[5000,7500]);});
ok("压力期望利润达到目标比例，保费向上取整",()=>{const q=core.quote(a,24,cell);assert(q.stressProfitFen+1e-8>=q.premiumFen*a.targetProfitRatio);assert(q.premiumFen>=q.requiredFen-1e-8);assert.equal(q.premiumFen%10,0);});
ok("V6 资本成本按 100 元敞口基数计，非 75 元给付",()=>assert.equal(core.quote(a,24,cell).reserveFen,10000));
ok("同给付下风险更高或费用更高不能更便宜",()=>{const low=core.quote(a,12,{...cell,q:[0.01,0.001],upper:[0.02,0.002]});const high=core.quote(a,12,cell);assert(high.premiumFen>low.premiumFen);assert(core.quote({...a,perPolicyCostFen:a.perPolicyCostFen+100},12,cell).premiumFen>=high.premiumFen);});
ok("超报价上限停止报价，不截断保费伪造利润",()=>{const q=core.quote({...a,maxPremiumFen:100},24,cell);assert(!q.quoteable);assert(q.premiumFen>100);});
ok("即时择时投保不使用未经校准的历史均价",()=>assert(!core.quote(a,12,cell,{channel:"instant-retail"}).quoteable));
ok("样本不足、缺地区、非法概率拒绝",()=>{assert(!core.quote(a,12,{...cell,trainingYears:7}).quoteable);assert.throws(()=>core.quote(a,12,null));assert.throws(()=>core.quote(a,12,{...cell,q:[0.1,0.2]}));});
ok("零销量、负成本、费用利润率之和达 100% 拒绝",()=>{for(const b of [{plannedAnnualPolicies:0},{perPolicyCostFen:-1},{targetProfitRatio:0.92}])assert.throws(()=>core.quote({...a,...b},12,cell));});
ok("训练、验证、测试切分和估计参数必须有效",()=>{model.validateEstimation(config.estimation);assert.throws(()=>model.validateEstimation({...config.estimation,bootstrapReps:0}));assert.throws(()=>model.validateEstimation({...config.estimation,validationEndExclusive:config.estimation.trainEndExclusive}));});
function fixture(count=72){return {utc_offset_seconds:28800,hourly_units:{precipitation:"mm"},hourly:{time:Array.from({length:count},(_,i)=>new Date(Date.UTC(2023,8,29)+i*3600000).toISOString().slice(0,16)),precipitation:Array(count).fill(0)}};}
ok("只计起保后的小时，零雨有效，null 不是零",()=>{const raw=fixture();raw.hourly.precipitation[0]=100;assert.equal(model.outcome(model.prepare(raw),0,12,[30,70]),0);raw.hourly.precipitation[1]=30;assert.equal(model.outcome(model.prepare(raw),0,12,[30,70]),1);raw.hourly.precipitation[2]=null;assert.equal(model.outcome(model.prepare(raw),0,12,[30,70]),null);});
ok("重复时间与错误单位拒收，缺小时窗口不纳入",()=>{const raw=fixture();raw.hourly.time[1]=raw.hourly.time[0];assert.throws(()=>model.prepare(raw));const gap=fixture();gap.hourly.time.splice(5,1);gap.hourly.precipitation.splice(5,1);assert.equal(model.outcome(model.prepare(gap),0,12,[30,70]),null);const bad=fixture();bad.hourly_units.precipitation="inch";assert.throws(()=>model.prepare(bad));});
ok("改变留出期降雨不会改变训练统计，边界窗口不穿越",()=>{const raw=fixture(96),one=model.collect(model.prepare(raw),12);for(let i=0;i<raw.hourly.time.length;i++)if(raw.hourly.time[i]>="2023-10-01T00:00")raw.hourly.precipitation[i]=100;const two=model.collect(model.prepare(raw),12);assert.deepEqual(one.month.map(m=>[...m]),two.month.map(m=>[...m]));assert.deepEqual(one.local.map(m=>m.map(s=>[...s])),two.local.map(m=>m.map(s=>[...s])));});
ok("未出现暴雨的样本仍保留正压力概率，自举种子可复现",()=>{const map=new Map(Array.from({length:8},(_,i)=>[2016+i,{n:240,k1:0,k2:0}]));const local=new Map(Array.from(map,([y])=>[y,{n:10,k1:0,k2:0}]));const x=model.estimate(map,local,"fixture");assert(x.upper[0]>0&&x.upper[1]>0);assert.deepEqual(x,model.estimate(map,local,"fixture"));});
ok("回测使用实际互斥给付及当前成本，不复用旧收益数字",()=>{const c={month:1,startHour:0,...cell};const counts=[{month:1,startHour:0,yr:2025,n:10,k1:2,k2:1}];const x=core.backtest(a,12,[c],counts),y=core.backtest({...a,perPolicyCostFen:a.perPolicyCostFen+50},12,[c],counts);assert.equal(x.claimsFen,12500);assert.notEqual(x.costFen,y.costFen);});
const dataFile=path.join(root,"05-演示站点/pricing-next-data.js");
if(fs.existsSync(dataFile)){
  const ctx={window:{}};vm.runInNewContext(fs.readFileSync(dataFile,"utf8"),ctx);const d=ctx.window.RAINPROOF_PRICING_NEXT;
  ok("公开模型覆盖全部现行区划，新增地区不替代原区划",()=>{const base=JSON.parse(fs.readFileSync(path.join(root,"04-脚本/v5-regions.json"),"utf8"));assert(d.regions.length>=base.length);assert(base.every(r=>d.regions.some(x=>x.code===r.code)));assert.equal(d.errors.length,0);assert.equal(new Set(d.regions.map(r=>r.code)).size,d.regions.length);});
  let quoted=0;
  for(const r of d.regions)for(const h of [12,24])for(const c of r.cells[h]){const q=core.quote(d.config.assumptions,h,c);if(q.quoteable){quoted++;assert(q.stressProfitFen+1e-7>=q.premiumFen*d.config.assumptions.targetProfitRatio);}assert.equal(q.productionReady,false);}
  ok("所有可报价单元满足模型利润门槛，均不冒充已上链",()=>assert(quoted>0));
  ok("浏览器计算核心与模型源文件一致",()=>assert.equal(fs.readFileSync(path.join(root,"05-演示站点/pricing-next-core.js"),"utf8"),fs.readFileSync(path.join(root,"10-金融与定价/pricing-next/core.js"),"utf8")));
  ok("线上统计配置与模型版本对应当前源码，防止使用过期结果",()=>{
    assert.equal(JSON.stringify(d.config),JSON.stringify(config));
    const crypto=require("crypto"),hash=s=>crypto.createHash("sha256").update(s).digest("hex");
    const codeHash=p=>hash(fs.readFileSync(path.join(root,p),"utf8").replace(/\r\n/g,"\n"));
    const expected=hash(JSON.stringify({config,code:codeHash("10-金融与定价/pricing-next/build-model.js")+codeHash("10-金融与定价/pricing-next/core.js"),sources:d.regions.map(r=>[r.code,r.source.sha256])}));
    assert.equal(d.modelId,expected);
  });
}
console.log(`差异化定价回归：${n} 项通过`);
