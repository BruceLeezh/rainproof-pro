"use strict";
const fs=require("fs"),path=require("path"),C=require("./core");
function summarize(d){
  let contribution=0,weight=0,premium=0,quoted=0,total=0,min=Infinity,max=0;
  const negative=[];
  for(const r of d.regions)for(const h of d.config.hours){
    for(const c of r.cells[h]){total++;const q=C.quote(d.config.assumptions,h,c);if(!q.quoteable)continue;quoted++;contribution+=q.contributionFen*c.n;premium+=q.premiumFen*c.n;weight+=c.n;min=Math.min(min,q.premiumFen);max=Math.max(max,q.premiumFen);}
    for(const [year,s]of Object.entries(r.backtest[h].test.years))if(s.profitFen<0)negative.push({region:r.name,h,year,profitYuan:s.profitFen/100});
  }
  if(!weight)throw new Error("没有可报价的训练组合，不能计算盈利预期");
  const examples=[];
  for(const code of [420100,310100,110100,440100,510100]){
    const r=d.regions.find(r=>r.code===code);if(!r)continue;
    for(const month of [1,7])for(const h of [12,24]){
      const cell=r.cells[h].find(c=>c.month===month&&c.startHour===12),q=C.quote(d.config.assumptions,h,cell);
      examples.push({code,name:r.name,month,startHour:12,h,q:cell.q,upper:cell.upper,premiumYuan:q.premiumFen/100,expectedLossYuan:q.lossFen/100,expectedProfitYuan:q.profitFen/100,stressProfitYuan:q.stressProfitFen/100,payoutYuan:q.tiers.map(x=>x/100),quoted:q.quoteable});
    }
  }
  const meanContribution=contribution/weight/100,F=d.config.assumptions.annualFixedCostYuan;
  return {modelId:d.modelId,coveredRegions:d.regions.length,totalCells:total,quotedCells:quoted,minPremiumYuan:min/100,maxPremiumYuan:max/100,examples,
    negativeTestRegionYears:negative,annualIllustration:{mix:"training exposure-weighted calendar quote cells; assumed mix, not a sales forecast",
      meanPremiumYuan:premium/weight/100,meanContributionBeforeAnnualFixedCostYuan:meanContribution,
      minimumPoliciesForStrictlyPositiveProfit:Math.floor(F/meanContribution)+1,
      scenarios:[0,20000,100000,200000].map(N=>({policies:N,expectedProfitYuan:N*meanContribution-F}))},
    test:{...d.totals.test,averageProfitYuan:d.totals.test.profitFen/d.totals.test.policies/100}};
}
if(require.main===module){const d=JSON.parse(fs.readFileSync(path.join(__dirname,"model.json"),"utf8"));const out=summarize(d);fs.writeFileSync(path.join(__dirname,"summary.json"),JSON.stringify(out,null,2));console.log(JSON.stringify({cells:out.quotedCells,annual:out.annualIllustration},null,2));}
module.exports=summarize;
