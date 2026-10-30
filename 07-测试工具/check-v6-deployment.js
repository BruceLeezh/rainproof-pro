"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("node:assert/strict");
const solc = require("solc"), { ethers } = require("ethers");
const root=path.resolve(__dirname,".."), name="RainDeliveryInsuranceV6";
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
let checks=0;
function ok(label,fn){fn();checks++;console.log("OK "+label);}
(async()=>{
  const source=read(`03-合约/${name}.sol`);
  const input={language:"Solidity",sources:{[name+".sol"]:{content:source}},settings:{optimizer:{enabled:true,runs:200},evmVersion:"paris",viaIR:true,
    outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode.object","evm.deployedBytecode.immutableReferences"]}}}};
  const output=JSON.parse(solc.compile(JSON.stringify(input)));
  assert.equal((output.errors||[]).filter(e=>e.severity==="error").length,0);
  const artifact=output.contracts[name+".sol"][name], bin=artifact.evm.bytecode.object;
  ok("V6 ABI equals source",()=>assert.deepEqual(JSON.parse(read(`03-合约/${name}.abi.json`)),artifact.abi));
  ok("V6 deploy bytecode equals source",()=>assert.equal(read(`03-合约/${name}.bytecode.txt`).trim(),"0x"+bin));
  const runtime=artifact.evm.deployedBytecode.object;
  ok("V6 runtime size and EIP-170",()=>{assert.equal(Number(read(`03-合约/${name}.runtime-size.txt`)),runtime.length/2);assert(runtime.length/2<24576);});
  const deployment=JSON.parse(read("deployment.json"));
  ok("Active deployment is V6 testnet",()=>{assert.equal(deployment.version,"V6");assert.equal(deployment.chainId,968);assert.equal(deployment.claimGraceSeconds,604800);assert(ethers.isAddress(deployment.contract));});
  const ctx={window:{}};vm.runInNewContext(read("05-演示站点/deployment.js"),ctx);
  ok("Public page config equals active deployment",()=>assert.equal(JSON.stringify(ctx.window.RAINPROOF_DEPLOYMENT),JSON.stringify(deployment)));
  for(const [page,variable] of [["index-v6.html","ABI"],["rider.html","V6ABI"],["console.html","V6ABI"]]){
    const html=read("05-演示站点/"+page),match=html.match(new RegExp("const "+variable+"\\s*=\\s*(\\[.*?\\]);"));
    ok(page+" uses exact V6 ABI and deployment config",()=>{assert(match);assert.deepEqual(JSON.parse(match[1]),artifact.abi);assert(html.includes('src="deployment.js"'));});
  }
  const evidence=read("05-演示站点/"+deployment.migrationEvidenceFile);
  ok("Migration evidence SHA-256",()=>assert.equal(ethers.sha256(ethers.toUtf8Bytes(evidence)),deployment.migrationEvidenceHash));
  if(process.argv.includes("--onchain")){
    const request=new ethers.FetchRequest(deployment.rpc);request.timeout=20000;
    const provider=new ethers.JsonRpcProvider(request,undefined,{cacheTimeout:0});
    try{
      assert.equal((await provider.getNetwork()).chainId,968n);
      const code=(await provider.getCode(deployment.contract)).toLowerCase();
      let expected=runtime;
      const references=Object.values(artifact.evm.deployedBytecode.immutableReferences);
      assert.equal(references.length,1,"Only token is immutable");
      for(const slots of references)for(const slot of slots){const token=ethers.zeroPadValue(deployment.token,slot.length).slice(2).toLowerCase();expected=expected.slice(0,slot.start*2)+token+expected.slice((slot.start+slot.length)*2);}
      ok("Deployed V6 runtime byte-for-byte (token immutable applied)",()=>assert.equal(code,"0x"+expected));
      ok("Published runtime fingerprint",()=>assert.equal(ethers.keccak256(code),deployment.runtimeHash));
      const c=new ethers.Contract(deployment.contract,artifact.abi,provider);
      const [operator,paused,grace,n,pool]=await Promise.all([c.operator(),c.paused(),c.CLAIM_GRACE(),c.regionCount(),c.poolBalance()]);
      ok("Live V6 governance, grace, regions and pool",()=>{assert.equal(operator.toLowerCase(),deployment.multisig.toLowerCase());assert.equal(paused,false);assert.equal(grace,604800n);assert.equal(n,BigInt(deployment.regions));assert(pool>=10000n);});
    }finally{provider.destroy();}
  }
  console.log(`V6 deployment checks: ${checks} passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
