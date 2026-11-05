/* Shared pure pricing arithmetic. Research proposal; does not change any on-chain policy. */
(function(root) {
  "use strict";
  function number(value, label, min=0, max=Infinity) {
    if (typeof value!=="number" || !Number.isFinite(value) || value<min || value>max) throw new Error(label+"参数无效");
    return value;
  }
  function validate(a) {
    if(!["fixed-v6","income-linked"].includes(a.benefitMode))throw new Error("请选择固定给付或收入挂钩方案");
    if(!Array.isArray(a.fixedTiersFen)||a.fixedTiersFen.length!==2||!a.fixedTiersFen.every(v=>Number.isSafeInteger(v)&&v>0)||a.fixedTiersFen[1]<=a.fixedTiersFen[0])throw new Error("固定给付须为递增的两个正整数分值");
    for(const key of ["incomeYuanPerHour","batchSize","plannedAnnualPolicies","premiumTickFen","minPremiumFen","maxPremiumFen"])
      number(a[key],key,Number.MIN_VALUE);
    for(const key of ["perPolicyCostFen","perBatchCostFen","claimHandlingFen","annualFixedCostYuan","annualCapitalCostRatio","coolingHours","capitalHoldExtraHours"])
      number(a[key],key);
    for(const key of ["incomeReplacement","variableExpenseRatio","targetProfitRatio"]) number(a[key],key,0,1);
    if(a.incomeReplacement===0 || a.targetProfitRatio===0 || a.variableExpenseRatio+a.targetProfitRatio>=1) throw new Error("保障比例和目标利润须为正，费用率与目标利润率之和须小于 100%");
    if(!Array.isArray(a.tierFractions)||a.tierFractions.length!==2) throw new Error("需要两档给付比例");
    a.tierFractions.forEach(v=>number(v,"档位比例",Number.MIN_VALUE,1));
    if(a.tierFractions[0]>=a.tierFractions[1])throw new Error("第二档给付须高于第一档");
    for(const h of [12,24])number(a.insuredWorkHours?.[h],"约定工作时数",Number.MIN_VALUE,h);
    if(a.minPremiumFen>a.maxPremiumFen)throw new Error("最低保费不能高于报价上限");
    return a;
  }
  function benefits(a,hours) {
    validate(a);
    if(![12,24].includes(Number(hours)))throw new Error("仅支持 12h 和 24h");
    if(a.benefitMode==="fixed-v6")return {incomeBasisFen:10000,tiers:a.fixedTiersFen.slice()};
    const incomeBasisFen=a.incomeYuanPerHour*100*a.insuredWorkHours[hours]*a.incomeReplacement;
    const tiers=a.tierFractions.map(f=>Math.floor(incomeBasisFen*f+1e-9));
    if(tiers[0]<=0 || tiers[1]<=tiers[0])throw new Error("给付额度过小，无法形成两个不同档位");
    return {incomeBasisFen,tiers};
  }
  function probabilities(q) {
    if(!Array.isArray(q)||q.length!==2)throw new Error("需要两项累计超越概率");
    q.forEach(v=>number(v,"触发概率",0,1));
    if(q[1]>q[0])throw new Error("大暴雨概率不能高于暴雨概率");
    return q;
  }
  function expectedLoss(tiers,q) {
    probabilities(q);
    if(!Array.isArray(tiers)||tiers.length!==2 || tiers[0]<=0 || tiers[1]<tiers[0])throw new Error("给付档位无效");
    // q1 and q2 are nested exceedances. Heavy events receive the upper tier once.
    return tiers[0]*q[0]+(tiers[1]-tiers[0])*q[1];
  }
  function quote(a, hours, cell, {channel="calendar-batch-precommitted"}={}) {
    validate(a);
    if(!cell || !Array.isArray(cell.q) || !Array.isArray(cell.upper))throw new Error("无历史模型，禁止使用邻区或默认城市替代");
    const {incomeBasisFen,tiers}=benefits(a,hours);
    const q=probabilities(cell.q),upper=probabilities(cell.upper);
    if(upper.some((v,i)=>v<q[i]))throw new Error("压力概率不能低于点估计");
    const lossFen=expectedLoss(tiers,q),riskLossFen=expectedLoss(tiers,upper);
    const fixedFen=a.perPolicyCostFen+a.perBatchCostFen/a.batchSize;
    const overheadFen=a.annualFixedCostYuan*100/a.plannedAnnualPolicies;
    // V6 reserves the full 100-yuan exposure basis even though its top payout is 75.
    const reserveFen=a.benefitMode==="fixed-v6"?10000:tiers[1];
    const capitalFen=reserveFen*a.annualCapitalCostRatio*(a.coolingHours+Number(hours)+a.capitalHoldExtraHours)/8760;
    const commonCostFen=fixedFen+overheadFen+capitalFen;
    const upperCostFen=commonCostFen+a.claimHandlingFen*upper[0];
    const requiredFen=(riskLossFen+upperCostFen)/(1-a.variableExpenseRatio-a.targetProfitRatio);
    let premiumFen=Math.max(a.minPremiumFen,Math.ceil(requiredFen/a.premiumTickFen-1e-12)*a.premiumTickFen);
    while(premiumFen*(1-a.variableExpenseRatio-a.targetProfitRatio)+1e-8<riskLossFen+upperCostFen) premiumFen+=a.premiumTickFen;
    const contributionFen=premiumFen*(1-a.variableExpenseRatio)-lossFen-fixedFen-capitalFen-a.claimHandlingFen*q[0];
    const profitFen=contributionFen-overheadFen;
    const stressProfitFen=premiumFen*(1-a.variableExpenseRatio)-riskLossFen-upperCostFen;
    const conditionalHeavy=q[0]>0?q[1]/q[0]:0;
    const eventCostFen=tiers[0]+(tiers[1]-tiers[0])*conditionalHeavy+a.claimHandlingFen;
    const breakEvenProbability=Math.min(1,Math.max(0,(premiumFen*(1-a.variableExpenseRatio)-commonCostFen)/eventCostFen));
    const reasons=[];
    if(channel!=="calendar-batch-precommitted")reasons.push("即时择时投保没有经验证的条件概率模型，不能套用历史均价");
    const requiredYears=Math.max(8,cell.minimumTrainingYears||8);
    if(!Number.isInteger(cell.trainingYears)||cell.trainingYears<requiredYears)reasons.push(`训练水文年少于 ${requiredYears} 年，样本不足`);
    if(premiumFen>a.maxPremiumFen)reasons.push("所需保费超过报价上限；须调整产品或停止报价，不能截断保费");
    if(premiumFen>=tiers[1])reasons.push("保费不应达到最高给付额");
    return {hours:Number(hours),incomeBasisFen,tiers,reserveFen,q,upper,lossFen,riskLossFen,fixedFen,overheadFen,capitalFen,
      commonCostFen,upperCostFen,requiredFen,premiumFen,profitFen,stressProfitFen,contributionFen,
      profitRatio:profitFen/premiumFen,stressProfitRatio:stressProfitFen/premiumFen,breakEvenProbability,
      breakEvenAnnualPolicies:contributionFen>0?Math.ceil(a.annualFixedCostYuan*100/contributionFen):null,
      quoteable:reasons.length===0,reasons,productionReady:false};
  }
  function backtest(a,hours,cells,counts,{startHour}={}) {
    const result={policies:0,excluded:0,premiumFen:0,claimsFen:0,costFen:0,profitFen:0,years:{}};
    const lookup=new Map(cells.map(c=>[c.month+"/"+c.startHour,c]));
    for(const row of counts){
      if(startHour!==undefined&&row.startHour!==startHour)continue;
      const q=quote(a,hours,lookup.get(row.month+"/"+row.startHour));
      if(!q.quoteable){result.excluded+=row.n;continue;}
      const premium=q.premiumFen*row.n,claims=q.tiers[0]*row.k1+(q.tiers[1]-q.tiers[0])*row.k2;
      const cost=q.commonCostFen*row.n+premium*a.variableExpenseRatio+row.k1*a.claimHandlingFen;
      const s=result.years[row.yr]||={policies:0,premiumFen:0,claimsFen:0,costFen:0,profitFen:0};
      for(const target of [s,result]){target.policies+=row.n;target.premiumFen+=premium;target.claimsFen+=claims;target.costFen+=cost;target.profitFen+=premium-claims-cost;}
    }
    return result;
  }
  const api={validate,benefits,expectedLoss,quote,backtest};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  else root.RainproofPricingNext=api;
})(typeof globalThis!=="undefined"?globalThis:this);
