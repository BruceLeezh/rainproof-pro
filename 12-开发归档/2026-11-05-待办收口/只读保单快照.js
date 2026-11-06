
"use strict";
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"../..");
const {ethers}=require(path.join(root,"04-脚本/node_modules/ethers"));
const d=require(path.join(root,"deployment.json"));
(async()=>{
  const req=new ethers.FetchRequest(d.rpc);req.timeout=9000;
  const provider=new ethers.JsonRpcProvider(req,d.chainId,{staticNetwork:true,batchMaxCount:20});
  try {
    const block=await provider.getBlock("latest");
    const tag={blockTag:block.number};
    const c=new ethers.Contract(d.contract,require(path.join(root,"03-合约/RainDeliveryInsuranceV6.abi.json")),provider);
    const asTime=t=>new Date(Number(t)*1000).toISOString();
    const count=Number(await c.nextPolicyId(tag));
    const [pool,exposure,reserve,maxAge]=await Promise.all([c.poolBalance(tag),c.openExposure(tag),c.reserveOf(tag),c.MAX_FEED_AGE(tag)]);
    const policies=await Promise.all(Array.from({length:Math.min(count,10)},async(_,id)=>{
      const [row,status,j]=await Promise.all([c.policies(id,tag),c.policyStatus(id,tag),c.judgements(id,tag)]);
      return {id,region:Number(row.regionId),hours:Number(row.windowHours),premiumFen:Number(row.premium),anchorMm:row.anchored?Number(row.rainfallAtEffective):null,
        effective:asTime(row.effectiveFrom),end:asTime(row.endTime),status,judgement:j.exists?{decision:Number(j.decision),confidence:Number(j.confidence),hash:j.outputHash}:null,
        payoutFen:Number(row.payout),settled:row.settled};
    }));
    const regions=await Promise.all(require(path.join(root,"04-脚本/v5-regions.json")).map(async({code,name})=>{
      const lastFeedAt=Number(await c.lastFeedAt(code,tag));
      return {code,name,lastFeedAt,ageHours:(block.timestamp-lastFeedAt)/3600,stale:block.timestamp-lastFeedAt>Number(maxAge)};
    }));
    const result={chainId:d.chainId,address:d.contract,block:block.number,timestamp:asTime(block.timestamp),count,policies,
      poolFen:Number(pool),exposureFen:Number(exposure),reserveFen:Number(reserve),regions};
    const stamp=result.timestamp.replace(/[-:.]/g,"");
    fs.writeFileSync(path.join(__dirname,"链上只读-"+stamp+".json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
    console.log(JSON.stringify({block:result.block,time:result.timestamp,policies,stale:regions.filter(x=>x.stale).length}));
  } finally {provider.destroy();}
})().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});

