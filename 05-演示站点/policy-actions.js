/* V6-T1 self-service actions. Reads a single block; validates again before signing. */
(function(root){
  "use strict";
  const METHODS={refund:"refundPolicy",anchor:"anchorEffective",claim:"claim"};
  function availability({policy:p,status,now,account,paused,lastFeedAt,maxFeedAge,claimGrace}){
    const no=reason=>({enabled:false,reason});
    const all=reason=>({refund:no(reason),anchor:no(reason),claim:no(reason)});
    if(!account)return all("请先连接自己的钱包");
    if(!p.exists)return all("保单不存在");
    if(p.paid)return all("赔付已到账");
    if(p.settled)return all("保单已结清，不能重复操作");
    const t=Number(now),effective=Number(p.effectiveFrom),end=Number(p.endTime);
    if(![t,effective,end].every(Number.isSafeInteger))return all("链上时间未确认");
    const payer=String(account).toLowerCase()===String(p.payer).toLowerCase();
    const refund=paused?no("合约暂停，暂不能退款"):!payer?no("只有付款人可退保；款项退回付款人"):
      t>=effective?no("已生效，生效前退款窗口已关闭"):{enabled:true,reason:"生效前全额退还保费给付款人"};
    const last=Number(lastFeedAt),age=Number(maxFeedAge);
    const feedOK=Number.isSafeInteger(last)&&Number.isSafeInteger(age)&&age>0&&last>=effective&&last<=t&&t-last<=age;
    const anchor=p.anchored?no("生效基线已固定，无需再次锚定"):t<effective?no("等待期尚未结束"):
      t>end?no("保障已结束，不再提供补锚定"):
      !feedOK?no("等待保障期内的新喂价，避免采用生效前读数"):
      {enabled:true,reason:"固定当前链上雨量；延后锚定可能少计保障增量"};
    const grace=Number(claimGrace);
    const claim=paused?no("合约暂停，暂不能领取"):!Number.isSafeInteger(grace)||grace<0?no("领取期限未确认"):
      t>end+grace?no("七天领取宽限已结束"):status!=="claimable"?no("尚无满足领取条件的及时可赔判定"):
      {enabled:true,reason:"赔付转给被保险人；不会转给代领账户"};
    return {refund,anchor,claim};
  }
  async function snapshot(contract,id,account){
    const reader=contract.runner.provider||contract.runner;
    const block=await reader.getBlock("latest");
    if(!block)throw new Error("无法确认链上时间，请稍后重试");
    const tag={blockTag:block.number};
    const [policy,status,paused,maxFeedAge,claimGrace]=await Promise.all([
      contract.policies(id,tag),contract.policyStatus(id,tag),contract.paused(tag),contract.MAX_FEED_AGE(tag),contract.CLAIM_GRACE(tag)
    ]);
    const lastFeedAt=await contract.lastFeedAt(policy.regionId,tag);
    const value={policy,status,paused,maxFeedAge,claimGrace,lastFeedAt,now:block.timestamp,account,block:block.number};
    return {...value,actions:availability(value)};
  }
  async function perform({contract,id,kind,account,onSent=()=>{}}){
    if(!Object.prototype.hasOwnProperty.call(METHODS,kind))throw new Error("未知保单操作");
    if(!/^\d+$/.test(String(id)))throw new Error("保单号无效");
    const fresh=await snapshot(contract,id,account),state=fresh.actions[kind];
    if(!state.enabled)throw new Error(state.reason);
    const method=contract[METHODS[kind]];
    // This checks payer, pool balance and all contract conditions at the latest state.
    await method.staticCall(id);
    const transaction=await method(id);
    onSent(transaction.hash);
    const receipt=await transaction.wait();
    if(!receipt||Number(receipt.status)!==1)throw new Error("交易未成功确认，请刷新链上状态");
    return {hash:receipt.hash||transaction.hash,receipt};
  }
  const api={availability,snapshot,perform};
  root.RainproofPolicyActions=api;
  if(typeof module!=="undefined")module.exports=api;
})(typeof window==="undefined"?globalThis:window);
