"use strict";
const path=require("path"),fs=require("fs");
require("dotenv").config({path:path.join(__dirname,".env")});
const {ethers}=require("ethers");
const {withRetry,provider:readProvider}=require("./rpc-read");
(async()=>{
  const provider=readProvider(ethers,process.env.SEPOLIA_RPC || "https://rpc.bohr.life");
  try{
    if((await withRetry(()=>provider.getNetwork())).chainId!==968n)throw new Error("Testnet 968 only");
    const donor=new ethers.NonceManager(new ethers.Wallet(process.env.PRIVATE_KEY,provider));
    const ms=new ethers.Contract(process.env.MULTISIG_ADDR,require("../03-合约/OperatorMultisig.abi.json"),provider);
    // 2026-11-13 重新标定：submit 的 calldata 要写存储，成本按城数线性涨——实测
    // 13 城一批两票合计约 0.037 BOT（20 gwei），20 城约 0.053 BOT。原 target=0.5 /
    // keep=1.0 的前提是 deployer 有 9 BOT，现在 deployer 不到 1 BOT，原参数会让
    // 「补 gas」永远因 reserv insufficient 拒绝执行（11-13 13:45 就这么哑了一整天）。
    // 改为 target=0.30（约 8 批）、keep=0.25（够锚定新单基线 + 临时操作），
    // 并改成「谁不够补谁、单个失败不中断」——储备见底时至少把手上这点钱用在该用的地方。
    const target=ethers.parseEther("0.30"), keep=ethers.parseEther("0.25");
    const rows=[];
    for(const address of await withRetry(()=>ms.getOwners())){
      const balance=await withRetry(()=>provider.getBalance(address));if(balance>=target)continue;
      const value=target-balance;
      if(await withRetry(()=>provider.getBalance(donor.getAddress()))<keep+value){
        console.log("⛔ 跳过 "+address+"：deployer 余额不够保留 "+ethers.formatEther(keep)+" BOT 底仓（需再补 "+ethers.formatEther(value)+"）");
        continue;
      }
      if(!process.argv.includes("--send")){console.log(address+" needs "+ethers.formatEther(value)+" test BOT");continue;}
      const tx=await donor.sendTransaction({to:address,value});await tx.wait();rows.push({address,amountBOT:ethers.formatEther(value),tx:tx.hash});
      console.log("Topped up test gas: "+address+" "+tx.hash);
    }
    const output=process.argv.find(a=>a.startsWith("--out="))?.slice(6);if(output)fs.writeFileSync(output,JSON.stringify(rows,null,2));
  }finally{provider.destroy();}
})().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
