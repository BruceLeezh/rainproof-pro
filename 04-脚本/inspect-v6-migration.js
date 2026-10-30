"use strict";
const fs = require("fs"), path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { ethers } = require("ethers");
(async () => {
  const request = new ethers.FetchRequest(process.env.SEPOLIA_RPC || "https://rpc.bohr.life"); request.timeout = 15000;
  const provider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 15 });
  try {
    if ((await provider.getNetwork()).chainId !== 968n) throw new Error("Expected testnet 968");
    const old = process.env.CONTRACT_ADDRESS_V5 || process.env.CONTRACT_ADDRESS;
    const v5 = new ethers.Contract(old, require("../03-合约/RainDeliveryInsuranceV5.abi.json"), provider);
    const token = new ethers.Contract(process.env.TOKEN_ADDR, require("../03-合约/RainToken.abi.json"), provider);
    const ms = new ethers.Contract(process.env.MULTISIG_ADDR, require("../03-合约/OperatorMultisig.abi.json"), provider);
    const keys = process.env.OWNER_KEY_FILE || path.join(__dirname,"../../密钥-本地/owner-keys-2026-10-24.json");
    const available = fs.existsSync(keys) ? JSON.parse(fs.readFileSync(keys,"utf8")).accounts.map(a => new ethers.Wallet(a.privateKey).address) : [];
    const [pool, exposure, policyCount, operator, tokenOwner, owners, threshold, block, fee] = await Promise.all([
      v5.poolBalance(),v5.openExposure(),v5.nextPolicyId(),v5.operator(),token.owner(),ms.getOwners(),ms.threshold(),provider.getBlock("latest"),provider.getFeeData()
    ]);
    const addresses = [...new Set([...(process.env.PRIVATE_KEY ? [new ethers.Wallet(process.env.PRIVATE_KEY).address] : []),...available])];
    const wallets = await Promise.all(addresses.map(async address => ({address,balanceBOT:ethers.formatEther(await provider.getBalance(address))})));
    const policies = [];
    for(let id=0;id<Number(policyCount);id++) {const p=await v5.policies(id);policies.push({id,status:await v5.policyStatus(id),rider:p.rider,paid:p.paid,settled:p.settled,endTime:String(p.endTime)});}
    const result = {chainId:968,source:old,token:await token.getAddress(),multisig:await ms.getAddress(),operator,tokenOwner,
      owners:Array.from(owners),availableOwnerAddresses:available,threshold:Number(threshold),wallets,poolCents:String(pool),exposureCents:String(exposure),
      policies,block:block.number,blockGasLimit:String(block.gasLimit),gasPriceWei:String(fee.gasPrice),configuredRegions:require("./v5-regions.json").length};
    const output = process.argv.find(a=>a.startsWith("--out="))?.slice(6);
    if(output)fs.writeFileSync(output,JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally {provider.destroy();}
})().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
