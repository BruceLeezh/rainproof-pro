"use strict";
const fs = require("fs"), path = require("path");
function loadDeployment() {
  const file = path.join(__dirname,"../deployment.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,"utf8"));
  return {version:process.env.ACTIVE_CONTRACT_VERSION||"V5",chainId:968,rpc:process.env.SEPOLIA_RPC||"https://rpc.bohr.life",
    contract:process.env.CONTRACT_ADDRESS_V6||process.env.CONTRACT_ADDRESS,token:process.env.TOKEN_ADDR,multisig:process.env.MULTISIG_ADDR};
}
function applyDeployment() {
  const current=loadDeployment();
  if(current.version==="V6") {
    process.env.SEPOLIA_RPC ||= current.rpc;
    process.env.ACTIVE_CONTRACT_VERSION="V6";process.env.CONTRACT_ADDRESS=current.contract;
    process.env.CONTRACT_ADDRESS_V6=current.contract;process.env.TOKEN_ADDR=current.token;process.env.MULTISIG_ADDR=current.multisig;
    process.env.AI_OUT_DIR ||= path.join(__dirname,"../09-AI判定留痕/v6",current.contract.toLowerCase());
  }
  return current;
}
module.exports={loadDeployment,applyDeployment};
