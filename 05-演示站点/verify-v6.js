"use strict";
(function () {
  const D = window.RAINPROOF_DEPLOYMENT, ABI = window.RAINPROOF_ABI_V6;
  const $ = id => document.getElementById(id), esc = RainproofRuntime.esc;
  const provider = RainproofRuntime.provider(ethers, new URLSearchParams(location.search).get("rpc") || D.rpc);
  const c = new ethers.Contract(D.contract, ABI, provider), iface = new ethers.Interface(ABI);
  const ms = new ethers.Contract(D.multisig,["function threshold() view returns (uint256)","function getOwners() view returns(address[])"],provider);
  function paint(title, details, ok) {
    const row = document.createElement("div"); row.className = "row " + (ok ? "ok" : "bad");
    row.innerHTML = '<div class="st">'+(ok?"✓":"✕")+'</div><div><div class="t">'+esc(title)+'</div><div class="why">'+esc(details)+'</div></div>';
    $("rows").appendChild(row);
  }
  const codes = [420100,310100,110100,440100,510100];
  async function run() {
    if($("run").disabled)return;
    $("run").disabled=true;$("rows").replaceChildren();$("pass").textContent="0";
    $("addrFull").textContent=D.contract;$("addrShort").textContent=D.contract.slice(0,8)+"…"+D.contract.slice(-4);
    let passed=0;
    const checks = [
      ["1. 节点属于测试网 968",async()=>{
        const network=await provider.getNetwork(),ok=network.chainId===968n;
        $("chainName").textContent="BOT 测试网 "+network.chainId;$("chainDot").className="dot "+(ok?"on":"err");
        if(!ok)throw new Error("节点链 ID 与部署记录不一致");return "实际读取 chainId=968";
      }],
      ["2. 链上代码与 V6 部署指纹一致",async()=>{
        const code=await provider.getCode(D.contract);
        if(code==="0x"||ethers.keccak256(code)!==D.runtimeHash)throw new Error("运行时代码哈希不一致");
        return "运行时 "+((code.length-2)/2)+" 字节；部署交易 "+D.deploymentTransaction;
      }],
      ["3. V6 写入权交给 2/3 多签，销售未暂停",async()=>{
        const [op,paused,threshold,owners]=await Promise.all([c.operator(),c.paused(),ms.threshold(),ms.getOwners()]);
        if(op.toLowerCase()!==D.multisig.toLowerCase()||paused||threshold!==2n||owners.length!==3)throw new Error("治理或销售状态不符合配置");
        return "operator="+op+"；演示钥匙同机，2/3门槛不等于独立机构托管。";
      }],
      ["4. 领取宽限期为 7 天，冷静期为 0",async()=>{
        const [grace,cooling]=await Promise.all([c.CLAIM_GRACE(),c.coolingPeriod()]);
        if(grace!==604800n||cooling!==0n)throw new Error("领取/生效参数不符");
        return "及时提交的判定可在保障结束后7天内领取；宽限期不补救窗口内从未获得判定。";
      }],
      ["5. 122 个区划及五城价目可读取",async()=>{
        const n=await c.regionCount();if(n!==BigInt(D.regions))throw new Error("区划总数与迁移记录不同");
        await Promise.all(codes.map(async code=>{const [region,p12,p24]=await Promise.all([c.regions(code),c.premiumGrid(code,12),c.premiumGrid(code,24)]);if(!region.active||p12<100n||p24<100n)throw new Error("区划或网格不可用："+code);}));
        return "实时注册 "+n+" 个；全量244格对照另由迁移报告核验。";
      }],
      ["6. 迁移原文哈希与链上锚点一致",async()=>{
        const text=window.V6_MIGRATION_TEXT || await (await fetch(D.migrationEvidenceFile)).text();
        const hash=ethers.sha256(ethers.toUtf8Bytes(text));if(hash!==D.migrationEvidenceHash)throw new Error("本地迁移文件哈希不符");
        const latest=await c.feedJudgements(420100);
        if(latest.inputHash.toLowerCase()!==hash.toLowerCase()){
          const logs=await provider.getLogs({address:D.contract,fromBlock:D.deploymentBlock,toBlock:"latest",topics:[iface.getEvent("RainfallUpdated").topicHash,ethers.zeroPadValue(ethers.toBeHex(420100),32)]});
          if(!logs.some(log=>iface.parseLog(log).args.evidenceHash.toLowerCase()===hash.toLowerCase()))throw new Error("链上未找到迁移哈希");
        }
        return "来源 V5 "+D.sourceContract+"；这是累计基线迁移记录，不是新一次气象观测。";
      }],
      ["7. 喂价未过期且资金覆盖在保敞口",async()=>{
        const [last,pool,res,maxAge,block]=await Promise.all([c.lastFeedAt(420100),c.poolBalance(),c.reserveOf(),c.MAX_FEED_AGE(),provider.getBlock("latest")]);
        if(BigInt(block.timestamp)-last>maxAge||pool<res)throw new Error("喂价超期或资金不足");
        return "模拟池子 "+ethers.formatUnits(pool,2)+" 元；准备金要求 "+ethers.formatUnits(res,2)+" 元。";
      }],
      ["8. V6 资金台账逐分一致",async()=>{
        const logs=await provider.getLogs({address:D.contract,fromBlock:D.deploymentBlock,toBlock:"latest"});let amount=0n;
        for(const log of logs){let event;try{event=iface.parseLog(log);}catch{continue;}if(!event)continue;
          if(event.name==="PoolFunded")amount+=event.args.amount;
          if(["ClaimPaid","PolicyRefunded","PoolWithdrawn"].includes(event.name))amount-=event.args.amount;
          if(event.name==="PolicyBought")amount+=(await c.policies(event.args.policyId)).premium;
        }
        const pool=await c.poolBalance();if(amount!==pool)throw new Error("台账与池子余额不同（需核查直接转币等额外资金流）");
        return "注资+保费−赔付−退款−提款="+ethers.formatUnits(pool,2)+" 模拟元；V5 保单与余额留在原合约。";
      }]
    ];
    try {for(const [title,check] of checks){try{paint(title,await check(),true);passed++;}catch(e){paint(title,e.shortMessage||e.message,false);}$("pass").textContent=passed;}}
    finally{$("run").disabled=false;}
  }
  $("run").onclick=run;run();
})();
