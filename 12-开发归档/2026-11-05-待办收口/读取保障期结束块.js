
const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"../..");
const {ethers}=require(path.join(root,"04-脚本/node_modules/ethers"));
const d=require(path.join(root,"deployment.json"));
(async()=>{
 const req=new ethers.FetchRequest(d.rpc);req.timeout=9000;
 const p=new ethers.JsonRpcProvider(req,d.chainId,{staticNetwork:true});
 try {
  const c=new ethers.Contract(d.contract,require(path.join(root,"03-合约/RainDeliveryInsuranceV6.abi.json")),p);
  const latest=await p.getBlock("latest");
  async function lastBlockAt(timestamp) {
   let low=d.deploymentBlock,high=latest.number+1;
   while(high-low>1) {
    const mid=Math.floor((low+high)/2);
    const b=await p.getBlock(mid);
    if(b.timestamp<=timestamp)low=mid;else high=mid;
   }
   return p.getBlock(low);
  }
  const results=[];
  for(const id of [0,1]){
   const policy=await c.policies(id,{blockTag:latest.number});
   const b=await lastBlockAt(Number(policy.endTime));
   const [reading,lastFeedAt]=await Promise.all([c.rainfall(policy.regionId,{blockTag:b.number}),c.lastFeedAt(policy.regionId,{blockTag:b.number})]);
   results.push({id,end:Number(policy.endTime),block:b.number,blockTimestamp:b.timestamp,baselineMm:Number(policy.rainfallAtEffective),
    closingChainReadingMm:Number(reading),closingIncrementMm:Number(reading-policy.rainfallAtEffective),thresholdMm:Number(policy.thresholdMm),
    lastFeedAt:Number(lastFeedAt),readingAgeSeconds:b.timestamp-Number(lastFeedAt)});
  }
  fs.writeFileSync(path.join(__dirname,"保障期结束读数.json"),JSON.stringify({contract:d.contract,rows:results},null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify(results));
 }finally{p.destroy();}
})().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});

