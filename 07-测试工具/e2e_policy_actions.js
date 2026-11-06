"use strict";
// Isolated Ganache chain only. Exercise the same module used by rider.html.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ganache=require("ganache"),{ethers}=require("ethers");
const actions=require("../05-演示站点/policy-actions");
let count=0;function ok(label,condition){assert(condition,label);count++;console.log("OK "+label);}
async function reject(label,operation,pattern){await assert.rejects(operation,pattern);count++;console.log("OK "+label);}
(async()=>{
  const chain=ganache.provider({logging:{quiet:true},chain:{chainId:968,hardfork:"shanghai"}});
  const p=new ethers.BrowserProvider(chain,968,{cacheTimeout:0});p.pollingInterval=10;
  try{
    const op=await p.getSigner(0),rider=await p.getSigner(1),stranger=await p.getSigner(2),address=await rider.getAddress(),other=await stranger.getAddress();
    async function deploy(name,args=[]){
      const base=path.join(__dirname,"../03-合约",name);
      const abi=JSON.parse(fs.readFileSync(base+".abi.json","utf8")),bytecode=fs.readFileSync(base+".bytecode.txt","utf8").trim();
      return (await new ethers.ContractFactory(abi,bytecode,op).deploy(...args)).waitForDeployment();
    }
    const token=await deploy("RainToken"),insurance=await deploy("RainDeliveryInsuranceV6",[await token.getAddress()]),target=await insurance.getAddress();
    const tx=async value=>(await value).wait(),H=ethers.id("self-service-isolated");
    const feed=mm=>tx(insurance.updateRainfall(420100,mm,H,90,3,{gasLimit:300000}));
    const advance=async seconds=>{await chain.request({method:"evm_increaseTime",params:[seconds]});await chain.request({method:"evm_mine",params:[]});};
    await tx(insurance.registerRegion(420100,"武汉"));await tx(insurance.setCoolingPeriod(100));await feed(0);
    await tx(token.mint(await op.getAddress(),100000));await tx(token.approve(target,100000));await tx(insurance.fundPool(100000));
    await tx(token.mint(address,20000));await tx(token.connect(rider).approve(target,20000));
    const r=insurance.connect(rider),s=insurance.connect(stranger);
    await tx(r.buyPolicy(420100,12));const original=await insurance.policies(0),before=await token.balanceOf(address);
    await reject("隔离链：非付款人不能退款",()=>actions.perform({contract:s,id:0,kind:"refund",account:other}),/只有付款人/);
    await tx(insurance.setPaused(true));
    await reject("隔离链：暂停时退款被拦截",()=>actions.perform({contract:r,id:0,kind:"refund",account:address}),/暂停/);
    await tx(insurance.setPaused(false));
    await actions.perform({contract:r,id:0,kind:"refund",account:address});
    ok("隔离链：退款退回完整保费且释放敞口",await token.balanceOf(address)-before===original.premium&&await insurance.openExposure()===0n);
    ok("隔离链：退款后链上状态统一为 settled",await insurance.policyStatus(0)==="settled");
    await reject("隔离链：退款不能重复执行",()=>actions.perform({contract:r,id:0,kind:"refund",account:address}),/已结清/);
    await tx(r.buyPolicy(420100,12));
    await reject("隔离链：等待期不能锚定",()=>actions.perform({contract:s,id:1,kind:"anchor",account:other}),/等待期/);
    await advance(101);
    await reject("隔离链：生效后但只有生效前喂价时不能锚定",()=>actions.perform({contract:s,id:1,kind:"anchor",account:other}),/新喂价/);
    await feed(10);await actions.perform({contract:s,id:1,kind:"anchor",account:other});
    ok("隔离链：任意账户可协助锚定当前链上读数",(await insurance.policies(1)).rainfallAtEffective===10n);
    await reject("隔离链：重复锚定被拦截",()=>actions.perform({contract:s,id:1,kind:"anchor",account:other}),/已固定/);
    await reject("隔离链：无正式可赔判定时不能领取",()=>actions.perform({contract:s,id:1,kind:"claim",account:other}),/及时可赔判定/);
    await feed(40);await tx(insurance.submitJudgement(1,1,90,3,40,H,H,"self-service-isolated"));
    await advance(12*3600+1);
    const riderBefore=await token.balanceOf(address),otherBefore=await token.balanceOf(other);
    await actions.perform({contract:s,id:1,kind:"claim",account:other});
    ok("隔离链：保障结束后的宽限期仍能领取及时 PAY",await insurance.policyStatus(1)==="paid");
    ok("隔离链：第三人代领仍把 50 RDROP 转给被保险人",await token.balanceOf(address)-riderBefore===5000n&&await token.balanceOf(other)===otherBefore);
    await reject("隔离链：不能重复领取",()=>actions.perform({contract:s,id:1,kind:"claim",account:other}),/已到账/);
    await feed(40);await tx(r.buyPolicy(420100,12));await advance(101);await feed(41);
    await actions.perform({contract:r,id:2,kind:"anchor",account:address});await advance(12*3600+7*86400+1);
    await reject("隔离链：宽限结束不能领取",()=>actions.perform({contract:r,id:2,kind:"claim",account:address}),/宽限已结束/);
    console.log(`个人操作隔离链 E2E：${count} 项通过（没有访问测试网或密钥文件）`);
  }finally{p.destroy();await chain.disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
