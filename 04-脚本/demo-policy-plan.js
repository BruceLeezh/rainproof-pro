"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
async function planBuys(contract,address,buys,read=fn=>fn()){
  const ids=await read(()=>contract.policiesOf(address)),existing=new Map();
  for(const id of ids){
    const p=await read(()=>contract.policies(id));
    if(!p.exists||String(p.rider).toLowerCase()!==String(address).toLowerCase())throw new Error("保单索引与演示账户不一致，停止投保");
    const key=Number(p.regionId)+":"+Number(p.windowHours);
    existing.set(key,[...(existing.get(key)||[]),String(id)]);
  }
  const seen=new Set(),missing=[],skipped=[];
  for(const buy of buys){
    if(!Number.isSafeInteger(buy.code)||buy.code<=0||![12,24].includes(buy.hours))throw new Error("演示投保计划参数无效");
    const key=buy.code+":"+buy.hours;
    if(seen.has(key))throw new Error("演示计划包含重复区划和时长");seen.add(key);
    if(existing.has(key))skipped.push({...buy,policyIds:existing.get(key)});else missing.push(buy);
  }
  // All historical policies count, including expired, refunded and paid policies.
  return {missing,skipped};
}
async function withDemoLock(file,action){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  let fd;
  try{fd=fs.openSync(file,"wx");}
  catch(e){if(e.code==="EEXIST")throw new Error("演示投保已有运行锁；确认旧进程已退出后再人工处理残留锁，禁止并发重试");throw e;}
  const token=crypto.randomUUID();
  try{
    fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token,createdAt:new Date().toISOString()}));
    return await action();
  }finally{
    fs.closeSync(fd);
    // Never remove a lock that has been externally replaced.
    if(JSON.parse(fs.readFileSync(file,"utf8")).token===token)fs.unlinkSync(file);
  }
}
module.exports={planBuys,withDemoLock};
