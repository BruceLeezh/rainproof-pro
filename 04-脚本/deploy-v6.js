"use strict";
// Resumable V5 -> V6 testnet deployment. Never moves or settles old policies/funds.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { ethers } = require("ethers");
const { submittedTxId } = require("./multisig-receipt");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2), send = args.includes("--send");
const dir = path.resolve(args.find(a => a.startsWith("--dir="))?.slice(6) || path.join(root, "08-截图存证/2026-10-29-v6迁移"));
const abi = require("../03-合约/RainDeliveryInsuranceV6.abi.json");
const msAbi = require("../03-合约/OperatorMultisig.abi.json");
const tokenAbi = require("../03-合约/RainToken.abi.json");
const sha = text => "0x" + crypto.createHash("sha256").update(text).digest("hex");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retryRead(fn) { let error; for(let i=0;i<4;i++){try{return await fn();}catch(e){error=e;await sleep(700*(i+1));}}throw error; }
async function main() {
  fs.mkdirSync(dir, {recursive:true});
  const stateFile = path.join(dir,"migration-state.json");
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile,"utf8")) : {schema:"rainproof/v6-migration@1",transactions:[],configured:[],startedAt:new Date().toISOString()};
  const save = () => fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
  const request = new ethers.FetchRequest(process.env.SEPOLIA_RPC || "https://rpc.bohr.life"); request.timeout=20000;
  const provider = new ethers.JsonRpcProvider(request,undefined,{batchMaxCount:15,cacheTimeout:0});
  try {
    if((await provider.getNetwork()).chainId!==968n)throw new Error("Migration is restricted to testnet 968");
    const source = state.source || process.env.CONTRACT_ADDRESS_V5 || process.env.CONTRACT_ADDRESS;
    const tokenAddress = process.env.TOKEN_ADDR, msAddress = process.env.MULTISIG_ADDR;
    const old = new ethers.Contract(source,require("../03-合约/RainDeliveryInsuranceV5.abi.json"),provider);
    const token = new ethers.Contract(tokenAddress,tokenAbi,provider), ms = new ethers.Contract(msAddress,msAbi,provider);
    const snapshotFile = path.join(dir,"migration-baseline.json");
    let snapshot;
    if(fs.existsSync(snapshotFile)) snapshot=JSON.parse(fs.readFileSync(snapshotFile,"utf8"));
    else {
      const block=await provider.getBlockNumber(), tag={blockTag:block};
      const registry=require("./v5-regions.json"), regions=[];
      for(let off=0;off<registry.length;off+=6){
        const part=await Promise.all(registry.slice(off,off+6).map(async r=>{
          const [reg,p12,p24,mm,feed,risk]=await Promise.all([
            old.regions(r.code,tag),old.premiumGrid(r.code,12,tag),old.premiumGrid(r.code,24,tag),old.rainfall(r.code,tag),old.feedJudgements(r.code,tag),old.riskLevel(r.code,tag)
          ]);
          if(!reg.active||p12<100n||p24<100n||feed.sources<2n)throw new Error(`Source region ${r.code} is not migration-ready`);
          return {...r,name:reg.name,price12:String(p12),price24:String(p24),rainfall:String(mm),confidence:Number(feed.confidence),sources:Number(feed.sources),risk:Number(risk),sourceEvidence:feed.inputHash};
        }));regions.push(...part);console.log(`Snapshot ${regions.length}/${registry.length}`);
      }
      snapshot={schema:"rainproof/v6-baseline@1",chainId:968,source,block,capturedAt:new Date().toISOString(),
        note:"Copied cumulative baseline and prices from V5. This is migration provenance, not a fresh weather observation. Old funds/policies stay on V5.",
        sourcePool:String(await old.poolBalance(tag)),sourceExposure:String(await old.openExposure(tag)),regions};
      fs.writeFileSync(snapshotFile,JSON.stringify(snapshot,null,2)+"\n",{flag:"wx"});
    }
    if(snapshot.source.toLowerCase()!==source.toLowerCase())throw new Error("Source snapshot mismatch");
    const evidenceHash=sha(fs.readFileSync(snapshotFile,"utf8"));
    state.source=source;state.evidenceHash=evidenceHash;save();
    console.log(`Plan: ${snapshot.regions.length} regions, 244 prices; preserve V5 funds/policies. ${send?"SEND":"DRY RUN"}`);
    if(!send)return;
    const keyFile=process.env.OWNER_KEY_FILE||path.join(root,"../密钥-本地/owner-keys-2026-10-24.json");
    const ownerKeys=JSON.parse(fs.readFileSync(keyFile,"utf8")).accounts;
    const ownerSet=new Set((await ms.getOwners()).map(a=>a.toLowerCase()));
    const voters=(await Promise.all(ownerKeys.map(async a=>{const wallet=new ethers.Wallet(a.privateKey,provider);return {wallet,balance:await provider.getBalance(wallet.address)};})))
      .filter(a=>ownerSet.has(a.wallet.address.toLowerCase())).sort((a,b)=>a.balance>b.balance?-1:1);
    const threshold=Number(await ms.threshold());
    if(voters.length<threshold||threshold<2)throw new Error("Expected available 2-of-3 governance");
    const deployWallet=new ethers.Wallet(process.env.PRIVATE_KEY,provider), signer=new ethers.NonceManager(deployWallet);
    const record=async(label,promise)=>{const tx=await promise;state.transactions.push({label,hash:tx.hash,status:"pending"});save();
      const receipt=await tx.wait(1,240000);if(!receipt||receipt.status!==1)throw new Error(`${label} reverted`);
      Object.assign(state.transactions.at(-1),{status:"confirmed",block:receipt.blockNumber,gasUsed:String(receipt.gasUsed)});save();console.log(`${label}: ${tx.hash}`);return receipt;};
    async function multisig(target,data,label){
      const receipt=await record(label+"/submit",ms.connect(voters[0].wallet).submit(target,0,data));
      const id=submittedTxId(ms,receipt,target,data);
      for(const voter of voters.slice(1,threshold)){
        if((await ms.getTx(id)).executed)break;
        await record(label+"/confirm",ms.connect(voter.wallet).confirm(id));
      }
      if(!(await ms.getTx(id)).executed)throw new Error(`${label} not executed`);
    }
    if(!state.address){
      if(state.deployHash){const receipt=await provider.waitForTransaction(state.deployHash,1,240000);if(!receipt?.contractAddress)throw new Error("Pending deployment unresolved");state.address=receipt.contractAddress;save();}
      else {
        const bin=fs.readFileSync(path.join(root,"03-合约/RainDeliveryInsuranceV6.bytecode.txt"),"utf8").trim();
        const contract=await new ethers.ContractFactory(abi,bin,signer).deploy(tokenAddress);
        state.deployHash=contract.deploymentTransaction().hash;save();await contract.waitForDeployment();state.address=await contract.getAddress();save();
        console.log(`V6 deployed: ${state.address} ${state.deployHash}`);
      }
    }
    const v6=new ethers.Contract(state.address,abi,signer);
    const owner=await v6.operator();
    const act=async(fn,params,label)=>{
      if((await v6.operator()).toLowerCase()===deployWallet.address.toLowerCase())return record(label,v6[fn](...params));
      return multisig(state.address,v6.interface.encodeFunctionData(fn,params),label);
    };
    if(!state.configurationDone){
      if(!(await v6.paused()))await act("setPaused",[true],"pause V6 setup");
      for(let off=0;off<snapshot.regions.length;off+=12){
        if(state.configured.includes(off))continue;
        const rows=snapshot.regions.slice(off,off+12);
        await act("configureRegions",[rows.map(r=>r.code),rows.map(r=>r.name),rows.map(r=>r.price12),rows.map(r=>r.price24),evidenceHash],`configure ${off+1}-${off+rows.length}`);
        state.configured.push(off);save();
      }
      for(let off=0;off<snapshot.regions.length;off+=15){
        const rows=snapshot.regions.slice(off,off+15);let more=true;
        while(more){
          const readings=await Promise.all(rows.map(r=>v6.rainfall(r.code)));const selected=[];
          rows.forEach((r,i)=>{const target=BigInt(r.rainfall);if(readings[i]>target)throw new Error("V6 reading exceeds migration baseline");
            if(readings[i]<target)selected.push({...r,target:readings[i]+500n<target?readings[i]+500n:target});
            else if(readings[i]===0n)selected.push({...r,target:0n});});
          if(!selected.length)break;
          await act("updateRainfallBatch",[selected.map(r=>r.code),selected.map(r=>r.target),selected.map(()=>evidenceHash),selected.map(r=>r.confidence),selected.map(r=>r.sources)],`baseline ${off+1}-${off+rows.length}`);
          more=selected.some(r=>r.target<BigInt(r.rainfall));
        }
      }
      for(const r of snapshot.regions.filter(r=>r.risk!==0))await act("setUnderwriting",[r.code,r.risk,r.price24,evidenceHash],`risk ${r.code}`);
      state.configurationDone=true;save();
    }
    const funding=BigInt(snapshot.sourcePool)>20000n?BigInt(snapshot.sourcePool):20000n;
    if(await v6.poolBalance()<funding){
      const needed=funding-await v6.poolBalance(), msBalance=await token.balanceOf(msAddress);
      if(msBalance<needed){
        if((await token.owner()).toLowerCase()!==msAddress.toLowerCase())throw new Error("Token mint governance mismatch");
        await multisig(tokenAddress,token.interface.encodeFunctionData("mint",[msAddress,needed-msBalance]),"mint new simulated migration liquidity");
      }
      if(await token.allowance(msAddress,state.address)<needed)await multisig(tokenAddress,token.interface.encodeFunctionData("approve",[state.address,needed]),"approve V6 funding");
      await multisig(state.address,v6.interface.encodeFunctionData("fundPool",[needed]),"fund V6 (new simulated funds)");
    }
    // Verify all migrated configuration before handing operator to multisig and opening sales.
    for(let off=0;off<snapshot.regions.length;off+=6){
      await Promise.all(snapshot.regions.slice(off,off+6).map(async r=>{
        const [region,p12,p24,mm]=await Promise.all([v6.regions(r.code),v6.premiumGrid(r.code,12),v6.premiumGrid(r.code,24),v6.rainfall(r.code)]);
        if(!region.active||region.name!==r.name||p12!==BigInt(r.price12)||p24!==BigInt(r.price24)||mm!==BigInt(r.rainfall))throw new Error(`Migration verification failed ${r.code}`);
      }));
    }
    if((await v6.operator()).toLowerCase()!==msAddress.toLowerCase())await act("transferOperator",[msAddress],"handoff V6 operator");
    if(await v6.paused())await act("setPaused",[false],"open V6 sales");
    if(await v6.CLAIM_GRACE()!==604800n||await v6.regionCount()!==BigInt(snapshot.regions.length)||await v6.poolBalance()<funding)throw new Error("Final deployment invariant failed");
    if(await old.poolBalance()!==BigInt(snapshot.sourcePool)||await old.openExposure()!==BigInt(snapshot.sourceExposure))throw new Error("V5 state changed concurrently; review before activation");
    const code=await provider.getCode(state.address), receipt=await provider.getTransactionReceipt(state.deployHash);
    const deployment={schema:"rainproof/deployment@1",version:"V6",chainId:968,rpc:process.env.SEPOLIA_RPC,contract:state.address,token:tokenAddress,multisig:msAddress,
      sourceContract:source,deploymentTransaction:state.deployHash,deploymentBlock:receipt.blockNumber,runtimeHash:ethers.keccak256(code),runtimeBytes:(code.length-2)/2,
      claimGraceSeconds:604800,regions:snapshot.regions.length,poolCents:String(await v6.poolBalance()),migrationEvidenceHash:evidenceHash,migrationEvidenceFile:"evidence/v6-migration-baseline.json",
      sourceSnapshotBlock:snapshot.block,initializedAt:new Date().toISOString(),note:"New simulated RDROP liquidity; V5 funds and policies remain untouched."};
    fs.writeFileSync(path.join(dir,"deployment.json"),JSON.stringify(deployment,null,2)+"\n");
    state.complete=true;save();console.log(JSON.stringify(deployment,null,2));
  }finally{provider.destroy();}
}
main().catch(error=>{console.error(error.shortMessage||error.message);process.exitCode=1;});
