"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {planBuys,withDemoLock}=require("../04-脚本/demo-policy-plan");
const root=path.resolve(__dirname,".."),demo="0x5D13941203e46Cde6d3f2DfC6e7947f6a7b0283C";
const buys=[{code:420100,hours:24,label:"武汉 24h"},{code:440100,hours:12,label:"广州 12h"},{code:420113,hours:24,label:"汉南 24h（路演保障中）"}];
let count=0;function ok(label,fn){fn();count++;console.log("OK "+label);}
const row=buy=>({exists:true,rider:demo,regionId:BigInt(buy.code),windowHours:BigInt(buy.hours),settled:true});
function contractFor(rows){return {policiesOf:async()=>rows.map((_,i)=>BigInt(i)),policies:async id=>rows[Number(id)]};}

// Run the actual CLI entry with injected in-memory filesystem/provider/signer objects.
// No .env, key file, RPC or testnet transaction is touched.
function cli({send=false,complete=false,raceAtLock=false,duplicateAtApproval=false,badQuote=false}={}){
  const rows=(complete?buys:[buys[0]]).map(row),events={privateFiles:0,signers:0,approvals:0,buys:0,gas:0,mint:0,locks:0,destroyed:0};
  const insurance={...contractFor(rows),premiumOf:async()=>{if(badQuote)throw new Error("quote unavailable");return 590n;},
    connect(){return this;},buyPolicy:async(code,hours)=>{events.buys++;rows.push(row({code,hours}));return {hash:"0xbuy",wait:async()=>({status:1})};}};
  const token={balanceOf:async()=>9999n,allowance:async()=>0n,connect(){return this;},approve:async()=>{
    events.approvals++;return {wait:async()=>{if(duplicateAtApproval)rows.push(...buys.slice(1).map(row));return {status:1};}};
  }};
  const provider={getNetwork:async()=>({chainId:968n}),getBalance:async()=>100n,destroy:()=>events.destroyed++};
  const fakeEthers={getAddress:a=>a,parseEther:x=>BigInt(Math.round(Number(x)*1000)),formatUnits:(n)=>String(Number(n)/100),
    Contract:function(address){return address==="insurance"?insurance:address==="token"?token:{};},
    Wallet:function(){events.signers++;this.address=demo;this.sendTransaction=async()=>{events.gas++;throw new Error("unexpected gas transfer");};}};
  const module={exports:{}},logs=[];
  const fakeFs={readFileSync:file=>{
    if(file.endsWith(".abi.json"))return "[]";
    events.privateFiles++;
    if(!send)throw new Error("dry-run attempted key read");
    return JSON.stringify({address:demo,privateKey:"fixture-only"});
  }};
  const dependencies={fs:fakeFs,path,ethers:{ethers:fakeEthers},"./rpc-read":{withRetry:fn=>fn(),provider:()=>provider},
    "./demo-policy-plan":{planBuys,withDemoLock:async(_file,fn)=>{events.locks++;if(raceAtLock)rows.push(...buys.slice(1).map(row));return fn();}},
    "./multisig-receipt":{},"../05-演示站点/runtime":{feedStatus:async()=>({available:true})},dotenv:{config:()=>{}},
    "./active-deployment":{applyDeployment:()=>({version:"V6",rpc:"fixture",contract:"insurance",token:"token",multisig:"multisig"})}};
  const requireFake=name=>{if(!(name in dependencies))throw new Error("Unexpected dependency "+name);return dependencies[name];};
  const context={require:requireFake,module,__dirname:path.join(root,"04-脚本"),process:{argv:["node","fixture",...(send?["--send"]:[])],env:{}},console:{log:text=>logs.push(text)}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,"04-脚本/demo-buy-policy.js"),"utf8"),context);
  return {run:()=>module.exports.main(),events,logs};
}
async function main(){
  const all=await planBuys(contractFor(buys.map(row)),demo,buys);
  ok("已到期或结清的历史组合仍然算买过",()=>{assert.equal(all.missing.length,0);assert.equal(all.skipped.length,buys.length);});
  await assert.rejects(planBuys({policiesOf:async()=>{throw new Error("offline");}},demo,buys),/offline/);
  ok("查重 RPC 失败不能被当成没有买过",()=>assert(true));
  await assert.rejects(planBuys(contractFor([{...row(buys[0]),rider:"different"}]),demo,buys),/不一致/);
  ok("错误保单索引拒绝继续",()=>assert(true));
  await assert.rejects(planBuys(contractFor([]),demo,[buys[0],buys[0]]),/重复/);
  ok("重复计划本身拒绝执行",()=>assert(true));

  const lockFile=path.join(root,"12-开发归档/运行状态","isolated-test-"+process.pid+".lock");
  let unlock;const held=withDemoLock(lockFile,()=>new Promise(resolve=>unlock=resolve));
  await assert.rejects(withDemoLock(lockFile,async()=>{}),/运行锁/);
  ok("同一脚本并发运行时第二个进程被拦截",()=>assert(fs.existsSync(lockFile)));
  unlock();await held;
  ok("运行完成后释放锁",()=>assert(!fs.existsSync(lockFile)));
  await assert.rejects(withDemoLock(lockFile,async()=>{throw new Error("fixture failure");}),/fixture failure/);
  ok("异常退出路径也释放锁",()=>assert(!fs.existsSync(lockFile)));

  const complete=cli({send:true,complete:true});await complete.run();
  ok("--send 重跑已完成组合：不读私钥、不补 gas、不 mint、不授权、不购买",()=>{
    for(const key of ["privateFiles","signers","approvals","buys","gas","mint","locks"])assert.equal(complete.events[key],0);
    assert.equal(complete.events.destroyed,1);
  });
  const dry=cli();await dry.run();
  ok("干跑有待购组合也不读私钥、不创建签名者、不发交易",()=>{
    assert.equal(dry.events.privateFiles,0);assert.equal(dry.events.signers,0);assert.equal(dry.events.buys,0);assert.equal(dry.events.locks,0);
  });
  const race=cli({send:true,raceAtLock:true});await race.run();
  ok("取得锁后再次查重，其他轮次已买时直接停止",()=>{assert.equal(race.events.privateFiles,0);assert.equal(race.events.buys,0);});
  const approvalRace=cli({send:true,duplicateAtApproval:true});await approvalRace.run();
  ok("授权等待时出现相同组合，投保前再次查重并跳过",()=>{assert.equal(approvalRace.events.approvals,1);assert.equal(approvalRace.events.buys,0);});
  const fresh=cli({send:true});await fresh.run();await fresh.run();
  ok("首次仅补缺失组合，第二次运行零新增交易",()=>{assert.equal(fresh.events.approvals,buys.length-1);assert.equal(fresh.events.buys,buys.length-1);assert.equal(fresh.events.privateFiles,1);});
  const failure=cli({send:true,badQuote:true});await assert.rejects(failure.run(),/quote unavailable/);
  ok("读取保费失败会退出，不吞错也不读私钥",()=>{assert.equal(failure.events.privateFiles,0);assert.equal(failure.events.buys,0);assert.equal(failure.events.destroyed,1);});
  console.log(`演示脚本幂等隔离回归：${count} 项通过`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
