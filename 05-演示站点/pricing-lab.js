(function(){
  "use strict";
  const data=window.RAINPROOF_PRICING_NEXT,core=window.RainproofPricingNext,$=id=>document.getElementById(id),status=$("pricing-status");
  if(!data||!core){status.textContent="模型数据不可用，请先生成数据并重建站点；不会使用默认地区代替。";return;}
  const money=fen=>"¥ "+(fen/100).toFixed(2),percent=n=>(n*100).toFixed(3)+"%";
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const options=data.regions.map(r=>`<option value="${r.code}">${esc(r.name)} · ${r.code}</option>`).join("");
  $("pricing-region").innerHTML=options;$("pricing-region").value="420100";
  if(!$("pricing-region").value)$("pricing-region").selectedIndex=0;
  $("pricing-month").innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1} 月</option>`).join("");$("pricing-month").value="7";
  const val=id=>{const field=$(id);if(field.value.trim()==="")throw new Error("请填写所有费用与经营参数");return Number(field.value);};
  let current=null;
  function assumptions(){return {...data.config.assumptions,
    benefitMode:$("pricing-mode").value,insuredWorkHours:{12:val("pricing-work12"),24:val("pricing-work24")},
    incomeYuanPerHour:val("pricing-income"),incomeReplacement:val("pricing-replacement")/100,
    perPolicyCostFen:val("pricing-fixed")*100,annualFixedCostYuan:val("pricing-overhead"),plannedAnnualPolicies:val("pricing-volume"),
    variableExpenseRatio:val("pricing-expense")/100,targetProfitRatio:val("pricing-margin")/100,maxPremiumFen:val("pricing-cap")*100,
    perBatchCostFen:val("pricing-batch-cost")*100,batchSize:val("pricing-batch"),claimHandlingFen:val("pricing-claim-cost")*100,
    annualCapitalCostRatio:val("pricing-capital")/100};}
  const list=rows=>rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("");
  function render(){
    current=null;
    try{
      const a=assumptions(),region=data.regions.find(r=>r.code===val("pricing-region")),month=val("pricing-month"),startHour=val("pricing-start"),hours=val("pricing-hours"),channel=$("pricing-channel").value;
      if(!region)throw new Error("所选地区缺少原始数据，不能报价");
      const cell=h=>region.cells[h].find(c=>c.month===month&&c.startHour===startHour);
      const q=core.quote(a,hours,cell(hours),{channel});
      status.textContent=q.quoteable?"测算完成 · 在列明假设下满足利润门槛；尚未上链。":"当前不报价："+q.reasons.join("；");
      status.style.color=q.quoteable?"var(--measure)":"var(--money)";
      $("pricing-premium").textContent=q.quoteable?money(q.premiumFen):"不报价";
      $("pricing-offer").textContent=q.quoteable?"以 0.1 元向上取整，非现行链上报价":"请检查购买机制、价格上限或样本";
      $("pricing-el").textContent=money(q.lossFen);
      $("pricing-profit").textContent=q.quoteable?money(q.stressProfitFen):"—";
      $("pricing-profit-rate").textContent=q.quoteable?"占保费 "+percent(q.stressProfitRatio)+"；目标 "+percent(a.targetProfitRatio):"当前条件不满足报价门槛";
      $("pricing-location").textContent=`${region.name} · ${month} 月 · ${String(startHour).padStart(2,"0")}:00 起保`;
      $("pricing-compare").innerHTML=[12,24].map(h=>{const v=core.quote(a,h,cell(h),{channel});return `<tr><td>${h}h</td><td>${money(v.tiers[0])} / ${money(v.tiers[1])}</td><td>${percent(v.q[0])} / ${percent(v.q[1])}</td><td>${money(v.lossFen)}</td><td>${v.quoteable?money(v.premiumFen):"不报价"}</td></tr>`;}).join("");
      $("pricing-breakdown").innerHTML=list([
        ["点估计期望赔付 EL",money(q.lossFen)],["压力期望赔付 ELᵁ",money(q.riskLossFen)],
        ["基础费用 + 每批费用分摊",money(q.fixedFen)],["年度固定运营费 ÷ 计划年度份数",money(q.overheadFen)],
        ["每份资金占用基数",money(q.reserveFen)],["占用期资本成本",money(q.capitalFen)],
        ["压力情景的理赔处理费用",money(a.claimHandlingFen*q.upper[0])],
        ["费用率 / 目标利润率",percent(a.variableExpenseRatio)+" / "+percent(a.targetProfitRatio)],
        ["未取整所需保费",money(q.requiredFen)],["模型点估计单份利润",q.quoteable?money(q.profitFen):"停止报价"]]);
      $("pricing-stress").innerHTML=[["点估计",q.q],["压力概率",q.upper],["压力概率 × 2",q.upper.map(p=>Math.min(1,p*2))]].map(([label,actual])=>{
        const profit=q.premiumFen*(1-a.variableExpenseRatio)-core.expectedLoss(q.tiers,actual)-q.commonCostFen-a.claimHandlingFen*actual[0];
        return `<tr><td>${label}</td><td>${q.quoteable?money(profit):"不适用"}</td></tr>`;}).join("");
      $("pricing-breakeven").innerHTML=list([
        ["模型点估计触发概率 q₁",percent(q.q[0])],["单份盈亏平衡触发概率",q.quoteable?percent(q.breakEvenProbability):"不适用"],
        ["若全年销售同类组合，收支平衡份数",q.quoteable&&q.breakEvenAnnualPolicies!==null?q.breakEvenAnnualPolicies.toLocaleString("zh-CN")+" 份":"不适用"],
        ["若全年零销售，固定费用结果","− ¥ "+a.annualFixedCostYuan.toFixed(2)]]);
      const negative=[];
      $("pricing-backtest").innerHTML=["validation","test"].map(part=>{
        const r=core.backtest(a,hours,region.cells[hours],region.backtest[hours][part].counts,{startHour});
        for(const [year,s]of Object.entries(r.years))if(s.profitFen<0)negative.push(year+" 水文年");
        const avg=f=>r.policies?money(r[f]/r.policies):"无报价窗口";
        return `<tr><td>${part==="validation"?"验证 2023-10～2024-09":"独立测试 2024-10～2026-09"}</td><td>${r.policies} / ${r.excluded}</td><td>${avg("premiumFen")}</td><td>${avg("claimsFen")}</td><td>${channel==="calendar-batch-precommitted"?avg("profitFen"):"即时投保不适用"}</td></tr>`;
      }).join("");
      $("pricing-negative-years").textContent=negative.length?"当前参数下出现历史亏损年份："+[...new Set(negative)].join("、")+"。历史波动不能用期望利润抹去。":"该回放范围内未出现年度汇总亏损；这不保证未来或单份保单盈利。";
      const c=cell(hours);
      $("pricing-evidence").textContent=`训练 ${c.trainingYears} 个水文年，所选月份/时点 ${c.n} 个完整窗口；时间可信度权重 ${c.credibility.toFixed(4)}。原始缓存模型：${region.source.model}；缺测 ${region.quality.missing} 小时、时间间断 ${region.quality.gaps} 处。原始报文 SHA-256：${region.source.sha256}。模型版本：${data.modelId}。`;
      current={schema:"rainproof/research-quote@1",modelId:data.modelId,region:{code:region.code,name:region.name},month,startHour,hours,channel,assumptions:a,statistics:c,result:q,source:region.source,productionReady:false};
      $("pricing-download").disabled=false;
    }catch(error){status.textContent="无法测算："+error.message;status.style.color="var(--money)";
      for(const id of ["pricing-premium","pricing-el","pricing-profit"])$(id).textContent="—";
      for(const id of ["pricing-compare","pricing-breakdown","pricing-stress","pricing-breakeven","pricing-backtest"])$(id).replaceChildren();
      $("pricing-offer").textContent="请修正输入，不使用旧报价";$("pricing-profit-rate").textContent="无有效结果";$("pricing-evidence").textContent="";$("pricing-negative-years").textContent="";$("pricing-download").disabled=true;}
  }
  $("pricing-form").addEventListener("submit",e=>e.preventDefault());
  $("pricing-form").addEventListener("input",render);$("pricing-form").addEventListener("change",render);
  $("pricing-download").addEventListener("click",()=>{if(!current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download=`pricing-${current.region.code}-${current.hours}h.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  render();
})();
