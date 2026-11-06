#!/usr/bin/env node
/**
 * V6-T1 demonstration purchase. Default is read-only; --send signs testnet transactions.
 * Re-runs skip EVERY previously purchased region/duration pair (including settled policies).
 * --send holds a local exclusive lock. Other clients are outside that lock's scope.
 * Existing public demo account is the default; --address=0x... selects another prepared account.
 * Private wallet/owner files are opened only if a new purchase is needed and --send is present.
 */
"use strict";
const fs=require("fs"),path=require("path");
const {ethers}=require("ethers");
const {withRetry,provider:readProvider}=require("./rpc-read");
const {planBuys,withDemoLock}=require("./demo-policy-plan");
const {submittedTxId}=require("./multisig-receipt");
const {feedStatus}=require("../05-演示站点/runtime");
const ROOT=path.resolve(__dirname,"..");
const BUYS=[{code:420100,hours:24,label:"武汉 24h"},{code:440100,hours:12,label:"广州 12h"}];
const DEFAULT_DEMO="0x5D13941203e46Cde6d3f2DfC6e7947f6a7b0283C";
async function main(){
  require("dotenv").config({path:path.join(__dirname,".env")});
  const active=require("./active-deployment").applyDeployment();
  const send=process.argv.includes("--send");
  const address=ethers.getAddress(process.argv.find(a=>a.startsWith("--address="))?.slice(10)||process.env.DEMO_ADDRESS||DEFAULT_DEMO);
  const provider=readProvider(ethers,active.rpc);
  try{
    if((await withRetry(()=>provider.getNetwork())).chainId!==968n)throw new Error("演示投保仅允许测试网 968");
    const abi=name=>JSON.parse(fs.readFileSync(path.join(ROOT,"03-合约",name+".abi.json"),"utf8"));
    const v6=new ethers.Contract(active.contract,abi("RainDeliveryInsuranceV6"),provider);
    const token=new ethers.Contract(active.token,abi("RainToken"),provider);
    const ms=new ethers.Contract(active.multisig,abi("OperatorMultisig"),provider);
    const report=async()=>{
      const plan=await planBuys(v6,address,BUYS,withRetry);
      for(const row of plan.skipped)console.log(`跳过 ${row.label}：已存在保单 #${row.policyIds.join(" / #")}`);
      return plan;
    };
    console.log(`演示账户 ${address} · ${send?"发送模式":"只读干跑"} · ${active.contract}`);
    const initial=await report();
    if(!initial.missing.length){console.log("全部演示组合已购买；不充值、不 mint、不授权、不购买，也不读取私钥文件。");return;}
    // Quote and validate data before creating signers or spending gas.
    async function quotesFor(plan){
      const rows=[];
      for(const buy of plan.missing){
        const state=await feedStatus(v6,buy.code);
        if(!state.available)throw new Error(buy.label+"："+state.label);
        rows.push({...buy,price:await withRetry(()=>v6.premiumOf(buy.code,buy.hours))});
      }
      return rows;
    }
    const preview=await quotesFor(initial);
    if(!send){
      for(const buy of preview)console.log(`[dry] ${buy.label} 保费 ${ethers.formatUnits(buy.price,2)} RDROP，需先备 gas 和代币，再授权投保`);
      console.log("只读计划结束；没有打开演示钱包或 owner 私钥文件。");return;
    }
    const lock=path.join(ROOT,"12-开发归档/运行状态",`demo-buy-${active.contract.toLowerCase()}.lock`);
    await withDemoLock(lock,async()=>{
      // Another completed process may have purchased between the first read and lock acquisition.
      const plan=await report();if(!plan.missing.length)return;
      const quotes=await quotesFor(plan);
      const walletFile=process.env.DEMO_WALLET_FILE||path.join(ROOT,"../雨证密钥/demo-wallet-2026-11-03.json");
      const demo=new ethers.Wallet(JSON.parse(fs.readFileSync(walletFile,"utf8")).privateKey,provider);
      if(demo.address.toLowerCase()!==address.toLowerCase())throw new Error("演示钱包与 --address/DEMO_ADDRESS 不一致，未发交易");
      const balance=await withRetry(()=>token.balanceOf(address));
      const total=quotes.reduce((sum,b)=>sum+b.price,0n),target=total>3000n?total:3000n;
      const mintAmount=balance<total?target-balance:0n;
      let signers=[];
      if(mintAmount>0n){
        const ownerFile=process.env.OWNER_KEY_FILE||path.join(ROOT,"../密钥-本地/owner-keys-2026-10-24.json");
        const accounts=JSON.parse(fs.readFileSync(ownerFile,"utf8")).accounts;
        const [owners,threshold,tokenOwner]=await Promise.all([ms.getOwners(),ms.threshold(),token.owner()]);
        if(tokenOwner.toLowerCase()!==active.multisig.toLowerCase())throw new Error("代币 owner 不是当前多签，未发交易");
        const ownerSet=new Set(owners.map(a=>a.toLowerCase()));
        const unique=new Map(accounts.map(k=>{const s=new ethers.Wallet(k.privateKey,provider);return [s.address.toLowerCase(),s];}));
        signers=[...unique.entries()].filter(([a])=>ownerSet.has(a)).slice(0,Number(threshold)).map(([,s])=>s);
        if(signers.length!==Number(threshold))throw new Error("有效且互不重复的 owner 密钥不足，未发交易");
      }
      const gas=await withRetry(()=>provider.getBalance(address));
      if(gas<ethers.parseEther("0.02")){
        const deployer=new ethers.Wallet(process.env.PRIVATE_KEY,provider);
        await (await deployer.sendTransaction({to:address,value:ethers.parseEther("0.05")})).wait();
        console.log("演示 gas 充值已确认");
      }
      if(mintAmount>0n){
        const data=token.interface.encodeFunctionData("mint",[address,mintAmount]);
        const submit=await ms.connect(signers[0]).submit(active.token,0,data);
        const txId=await submittedTxId(ms,await submit.wait(),active.token,data);
        for(const signer of signers.slice(1))await (await ms.connect(signer).confirm(txId)).wait();
        if(!(await ms.getTx(txId))[4])throw new Error("RDROP mint 多签未执行，停止后续投保");
        console.log(`mint 已确认：${ethers.formatUnits(mintAmount,2)} RDROP`);
      }
      for(const buy of quotes){
        // Recheck before approval, and again before buying. Never retry a write on an ambiguous RPC failure.
        if(!(await planBuys(v6,address,[buy],withRetry)).missing.length){console.log(`跳过 ${buy.label}：签名前已存在相同组合`);continue;}
        const state=await feedStatus(v6,buy.code);if(!state.available)throw new Error(state.label);
        const price=await withRetry(()=>v6.premiumOf(buy.code,buy.hours));
        if(await token.balanceOf(address)<price)throw new Error("演示 RDROP 余额不足");
        if(await token.allowance(address,active.contract)<price)await (await token.connect(demo).approve(active.contract,price)).wait();
        if(!(await planBuys(v6,address,[buy],withRetry)).missing.length){console.log(`跳过 ${buy.label}：授权期间已存在相同组合`);continue;}
        const finalState=await feedStatus(v6,buy.code);if(!finalState.available)throw new Error(finalState.label);
        const transaction=await v6.connect(demo).buyPolicy(buy.code,buy.hours);
        const receipt=await transaction.wait();
        if(Number(receipt.status)!==1)throw new Error("投保未确认成功，停止后续投保");
        console.log(`${buy.label} 已确认 ${transaction.hash}`);
      }
      const final=await report();
      if(final.missing.length)throw new Error("仍有演示组合没有读回，停止并核对交易");
      console.log("演示组合全部读回；等待期 24h，正式判定仍需在保障期内完成。");
    });
  }finally{provider.destroy();}
}
module.exports={main};
if(require.main===module)main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
