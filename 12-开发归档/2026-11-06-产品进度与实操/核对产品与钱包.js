"use strict";
const fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"../..");
const {ethers}=require(path.join(root,"04-脚本/node_modules/ethers"));
const d=require(path.join(root,"deployment.json"));
(async()=>{
  const req=new ethers.FetchRequest(d.rpc);req.timeout=10000;
  const p=new ethers.JsonRpcProvider(req,968,{staticNetwork:true,batchMaxCount:20});
  try{
    const block=await p.getBlock("latest"),tag={blockTag:block.number};
    const c=new ethers.Contract(d.contract,require(path.join(root,"03-合约/RainDeliveryInsuranceV6.abi.json")),p);
    const token=new ethers.Contract(d.token,["function symbol() view returns(string)","function decimals() view returns(uint8)","function owner() view returns(address)","function balanceOf(address) view returns(uint256)"],p);
    const names=["paused","coolingPeriod","eligibleRequired","MAX_FEED_AGE","CLAIM_GRACE","MAX_POLICIES_PER_RIDER","MAX_EXPOSURE_PER_RIDER"];
    const config={};
    for(const name of names){
      if(!c.interface.hasFunction(name))continue;
      config[name]=String(await c[name](tag));
    }
    const count=Number(await c.nextPolicyId(tag)), policies=[];
    for(let id=0;id<Math.min(count,10);id++){
      const policy=await c.policies(id,tag);
      policies.push({id,rider:policy.rider,payer:policy.payer,regionId:Number(policy.regionId),hours:Number(policy.windowHours),
        premiumFen:Number(policy.premium),buyMm:Number(policy.rainfallAtBuy),anchored:policy.anchored,effectiveMm:Number(policy.rainfallAtEffective),status:await c.policyStatus(id,tag)});
    }
    const result={block:block.number,timestamp:new Date(block.timestamp*1000).toISOString(),chainId:968,contract:d.contract,token:d.token,
      tokenMetadata:{symbol:await token.symbol(tag),decimals:Number(await token.decimals(tag)),owner:await token.owner(tag)},config,policies,
      quotes:{wuhan12:Number(await c.premiumOf(420100,12,tag)),wuhan24:Number(await c.premiumOf(420100,24,tag)),guangzhou12:Number(await c.premiumOf(440100,12,tag)),guangzhou24:Number(await c.premiumOf(440100,24,tag))}};
    const out=path.join(__dirname,"产品与钱包只读核对-"+result.timestamp.replace(/[-:.]/g,"")+".json");
    fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n",{flag:"wx"});
    console.log(JSON.stringify(result,null,2));
  }finally{p.destroy();}
})().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
