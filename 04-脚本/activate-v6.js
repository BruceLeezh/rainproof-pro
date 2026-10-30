"use strict";
const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,".."), dir=process.argv.find(a=>a.startsWith("--dir="))?.slice(6);
if(!dir)throw new Error("--dir=<completed migration directory> required");
const deployment=JSON.parse(fs.readFileSync(path.join(dir,"deployment.json"),"utf8"));
const state=JSON.parse(fs.readFileSync(path.join(dir,"migration-state.json"),"utf8"));
if(!state.complete||deployment.version!=="V6"||deployment.chainId!==968||state.address!==deployment.contract)throw new Error("Migration is incomplete");
const abi=JSON.parse(fs.readFileSync(path.join(root,"03-合约/RainDeliveryInsuranceV6.abi.json"),"utf8"));
const baseline=fs.readFileSync(path.join(dir,"migration-baseline.json"),"utf8");
const site=path.join(root,"05-演示站点"), archive=path.join(root,"08-截图存证/2026-10-29-v6迁移");
fs.mkdirSync(archive,{recursive:true});fs.mkdirSync(path.join(site,"evidence"),{recursive:true});
fs.writeFileSync(path.join(root,"deployment.json"),JSON.stringify(deployment,null,2)+"\n");
fs.writeFileSync(path.join(site,"deployment.js"),"window.RAINPROOF_DEPLOYMENT = "+JSON.stringify(deployment)+";\n");
fs.writeFileSync(path.join(site,"contract-v6.js"),"window.RAINPROOF_ABI_V6 = "+JSON.stringify(abi)+";\n");
fs.writeFileSync(path.join(site,"evidence/v6-migration-baseline.json"),baseline);
fs.writeFileSync(path.join(site,"evidence/v6-migration-inline.js"),"window.V6_MIGRATION_TEXT = "+JSON.stringify(baseline)+";\n");
for(const file of ["deployment.json","migration-baseline.json","migration-state.json","migration-preflight.json"]){
  const from=path.join(dir,file);if(fs.existsSync(from))fs.copyFileSync(from,path.join(archive,file));
}
const old="0xFE3D9f897CE3038B75b876923D843F9F6752e136", short=deployment.contract.slice(0,6)+"…"+deployment.contract.slice(-4);
for(const file of ["index-v6.html","rider.html","console.html","verify-v6.html"]){
  const target=path.join(site,file);let html=fs.readFileSync(target,"utf8").replaceAll(old,deployment.contract).replaceAll("0xFE3D…e136",short);
  fs.writeFileSync(target,html);
}
// Existing V5 policy links retain their original version and contract.
for(const file of ["index-v5.html","rider-v5.html","console-v5.html","terms-v5.html","verify-v5.html"]){
  const target=path.join(site,file);let html=fs.readFileSync(target,"utf8");
  for(const page of ["rider","console","terms"])html=html.replaceAll('href="'+page+'.html"','href="'+page+'-v5.html"');
  fs.writeFileSync(target,html);
}
const envFile=path.join(__dirname,".env");let env=fs.readFileSync(envFile,"utf8");
function set(name,value){const re=new RegExp("^"+name+"=.*$","m");env=re.test(env)?env.replace(re,name+"="+value):env+"\n"+name+"="+value+"\n";}
set("CONTRACT_ADDRESS_V5",deployment.sourceContract);set("CONTRACT_ADDRESS_V6",deployment.contract);set("CONTRACT_ADDRESS",deployment.contract);set("ACTIVE_CONTRACT_VERSION","V6");
fs.writeFileSync(envFile,env);
console.log("Activated V6 "+deployment.contract+"; V5 address and history preserved");
