"use strict";
const path=require("path"),fs=require("fs");
require("dotenv").config({path:path.join(__dirname,".env")});
const {ethers}=require("ethers");
(async()=>{
  const provider=new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC,undefined,{cacheTimeout:0});
  try{
    if((await provider.getNetwork()).chainId!==968n)throw new Error("Testnet 968 only");
    const donor=new ethers.NonceManager(new ethers.Wallet(process.env.PRIVATE_KEY,provider));
    const ms=new ethers.Contract(process.env.MULTISIG_ADDR,require("../03-合约/OperatorMultisig.abi.json"),provider);
    // 0.5 而不是 0.2：一次 20 区划的批量投票，两票各约 0.064 BOT（20 gwei），
    // 0.2 只够 3 批。2026-10-30 实测 75 区划（4 批）就在第 4 批把钱包烧干、喂价中断 13 小时。
    const target=ethers.parseEther("0.5"), keep=ethers.parseEther("1.0");
    const rows=[];
    for(const address of await ms.getOwners()){
      const balance=await provider.getBalance(address);if(balance>=target)continue;
      const value=target-balance;
      if(await provider.getBalance(await donor.getAddress())<keep+value)throw new Error("Deployer gas reserve insufficient");
      if(!process.argv.includes("--send")){console.log(address+" needs "+ethers.formatEther(value)+" test BOT");continue;}
      const tx=await donor.sendTransaction({to:address,value});await tx.wait();rows.push({address,amountBOT:ethers.formatEther(value),tx:tx.hash});
      console.log("Topped up test gas: "+address+" "+tx.hash);
    }
    const output=process.argv.find(a=>a.startsWith("--out="))?.slice(6);if(output)fs.writeFileSync(output,JSON.stringify(rows,null,2));
  }finally{provider.destroy();}
})().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
