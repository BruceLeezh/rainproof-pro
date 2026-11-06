"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const actions=require("../05-演示站点/policy-actions");
const root=path.resolve(__dirname,"..");let count=0;
function ok(label,test){test();count++;console.log("OK "+label);}
const payer="0x1111111111111111111111111111111111111111",rider="0x2222222222222222222222222222222222222222";
const base={policy:{exists:true,paid:false,settled:false,anchored:false,payer,rider,effectiveFrom:1000n,endTime:2000n,regionId:420100n},
  status:"pending",now:900,account:payer,paused:false,lastFeedAt:850n,maxFeedAge:86400n,claimGrace:604800n};
async function main(){
  ok("生效前仅付款人可退款",()=>{
    assert(actions.availability(base).refund.enabled);
    assert(!actions.availability({...base,account:rider}).refund.enabled);
    assert(!actions.availability({...base,now:1000}).refund.enabled);
  });
  ok("未连接、已赔及已结清不能再次操作",()=>{
    for(const state of [{...base,account:null},{...base,policy:{...base.policy,paid:true}},{...base,policy:{...base.policy,settled:true}}]){
      assert(Object.values(actions.availability(state)).every(x=>!x.enabled));
    }
  });
  ok("锚定须在保障期内且有生效后喂价",()=>{
    const active={...base,now:1100,lastFeedAt:1050n};
    assert(actions.availability(active).anchor.enabled);
    assert(!actions.availability({...active,lastFeedAt:999n}).anchor.enabled);
    assert(!actions.availability({...active,lastFeedAt:1101n}).anchor.enabled);
    assert(!actions.availability({...active,now:2001}).anchor.enabled);
    assert(!actions.availability({...active,policy:{...base.policy,anchored:true}}).anchor.enabled);
  });
  ok("领取只允许可赔状态和宽限范围，精确截止仍有效",()=>{
    const state={...base,status:"claimable",now:2000+604800};
    assert(actions.availability(state).claim.enabled);
    assert(!actions.availability({...state,now:state.now+1}).claim.enabled);
    assert(!actions.availability({...state,status:"expired"}).claim.enabled);
    assert(!actions.availability({...state,paused:true}).claim.enabled);
  });
  let now=900,paused=false,writes=0,staticCalls=0,resolveReceipt;const tags=[];
  const track=async(value,tag)=>{tags.push(tag.blockTag);return value;};
  const method=async()=>{writes++;return {hash:"0xtest",wait:()=>new Promise(resolve=>resolveReceipt=resolve)};};
  method.staticCall=async()=>{staticCalls++;};
  const contract={runner:{getBlock:async()=>({number:42,timestamp:now})},
    policies:async(_id,tag)=>track(base.policy,tag),policyStatus:async(_id,tag)=>track("pending",tag),
    paused:async tag=>track(paused,tag),MAX_FEED_AGE:async tag=>track(86400n,tag),CLAIM_GRACE:async tag=>track(604800n,tag),
    lastFeedAt:async(_id,tag)=>track(850n,tag),refundPolicy:method};
  let done=false;const run=actions.perform({contract,id:0,kind:"refund",account:payer}).then(()=>done=true);
  await new Promise(setImmediate);
  ok("操作读取同一区块并先静态预演；回执前不报成功",()=>{
    assert(tags.every(tag=>tag===42));assert.equal(staticCalls,1);assert.equal(writes,1);assert(!done);
  });
  resolveReceipt({status:1,hash:"0xreceipt"});await run;
  ok("确认成功后才返回成功结果",()=>assert(done));
  now=1000;await assert.rejects(actions.perform({contract,id:0,kind:"refund",account:payer}),/窗口已关闭/);
  ok("页面渲染后若已生效，签名前再次阻止退款",()=>assert.equal(writes,1));
  now=900;method.staticCall=async()=>{throw new Error("pool/permission changed");};
  await assert.rejects(actions.perform({contract,id:0,kind:"refund",account:payer}),/changed/);
  ok("静态预演失败时不发送交易",()=>assert.equal(writes,1));
  await assert.rejects(actions.perform({contract,id:0,kind:"withdrawPool",account:payer}),/未知/);
  ok("操作限定三种方法，不接受任意合约调用",()=>assert.equal(writes,1));

  // Execute the actual UI handler: double clicks and wallet changes must not reach perform().
  const html=fs.readFileSync(path.join(root,"05-演示站点/rider.html"),"utf8"),elements={who:{dataset:{addr:payer}},"op-result-0":{}};
  let actionCalls=0,finish,refreshes=0;const notifications=[];
  const context={$:id=>elements[id],buying:false,syncBuyButton:()=>{},document:{querySelectorAll:()=>[]},
    RainproofRuntime:{wallet:async()=>({getAddress:async()=>payer})},E:{Contract:function(){return {}; }},window:{ethereum:{}},RPC:"local",V6:"fixture",V6ABI:[],
    RainproofPolicyActions:{perform:async()=>{actionCalls++;return new Promise(resolve=>finish=resolve);}},
    refreshPolicies:async()=>{refreshes++;},loadClaims:async()=>{},refreshNet:async()=>{},refreshAllowance:async()=>{},toast:(m)=>notifications.push(m)};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf("async function runPolicyAction"),html.indexOf('$("policies").addEventListener(\'toggle\'')),context);
  const pending=context.runPolicyAction("refund","0");await new Promise(setImmediate);await context.runPolicyAction("refund","0");
  ok("操作中再次点击不重复签名，尚未确认时没有成功提示",()=>{assert.equal(actionCalls,1);assert.equal(refreshes,0);assert(!notifications.some(m=>m.includes("已确认")));});
  finish({hash:"0xconfirmed"});await pending;
  ok("确认后刷新状态、解除按钮锁并展示回执",()=>{assert.equal(refreshes,1);assert.equal(context.buying,false);assert(elements["op-result-0"].textContent.includes("0xconfirmed"));});
  context.RainproofRuntime.wallet=async()=>({getAddress:async()=>rider});await context.runPolicyAction("refund","0");
  ok("钱包临时换账户时拒绝操作旧账户的保单",()=>{assert.equal(actionCalls,1);assert(elements["op-result-0"].textContent.includes("账户已变化"));});
  console.log(`个人保单操作隔离回归：${count} 项通过`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
