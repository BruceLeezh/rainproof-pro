"use strict";
// Execute the page's real rendering functions with deliberately different buy/effective readings.
// Wallet calls are mocked; no RPC, keys or transactions are used.
const assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path"), vm=require("node:vm");
const runtime=require("../05-演示站点/runtime");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"05-演示站点/rider.html"),"utf8");
let count=0;
function check(label,fn){fn();count++;console.log("OK "+label);}
async function main(){
  const p={rider:"0x1111111111111111111111111111111111111111",payer:"0x1111111111111111111111111111111111111111",
    regionId:420100n,windowHours:24n,effectiveFrom:1793800000n,endTime:1793886400n,
    rainfallAtBuy:100n,rainfallAtEffective:125n,anchored:true,thresholdMm:50n,premium:880n,paid:false,payout:0n};
  const ctx={THR2:{12:[30,70],24:[50,100]},STAG:{active:["保障中"],pending:["冷静期"]},
    cityName:()=>"武汉",shortA:a=>a.slice(0,8),fmtT:String,yuan:n=>(Number(n)/100).toFixed(2),
    V6_ADDR:"insurance",MS_ADDR:"multisig",$:()=>({value:"请复核"}),Date,Number,String,Boolean};
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf("function policyBaseline"),source.indexOf("const {ethers:E}")),ctx);
  vm.runInContext(source.slice(source.indexOf("function denyReason"),source.indexOf("async function loadClaims")),ctx);
  ctx.fixture=p;
  check("锚定后基线取生效雨量而非买入雨量",()=>assert.equal(ctx.policyBaseline(p),125n));
  check("凭证 HTML 与复制文本显示相同生效基线",()=>{
    assert(ctx.certHTML(0,p,"active").includes("累计 125mm"));
    assert(ctx.certText(0,p,"active").includes("生效基线：累计 125mm"));
    assert(!ctx.certText(0,p,"active").includes("累计 100mm"));
  });
  check("冷静期明确尚未锚定，不冒充生效基线",()=>{
    const pending={...p,anchored:false,rainfallAtEffective:0n};
    assert.equal(ctx.policyBaseline(pending),100n);
    assert(ctx.certHTML(2,pending,"pending").includes("买入读数（待锚定）"));
    assert(ctx.certText(2,pending,"pending").includes("生效后须完成锚定"));
  });
  const judgement={rainfallAtJudgement:160n,decision:0n,confidence:80n,sources:3n,judgedAt:1793850000n};
  check("拒赔原因按生效增量 35mm 解释，不错误采用买入增量 60mm",()=>assert(ctx.denyReason(p,judgement).includes("35mm < 50mm")));
  ctx.judgementFixture=judgement;
  vm.runInContext("APPEAL={id:0,p:fixture,j:judgementFixture}",ctx);
  check("复核 JSON 保留买入读数并独立提供生效基线",()=>{
    const data=ctx.appealData();
    assert.equal(data.judgement.rainfallAtBuy,100);
    assert.equal(data.judgement.rainfallAtEffective,125);
    assert.equal(data.judgement.baselineMm,125);
    assert.equal(data.judgement.baselineKind,"effective");
    assert(ctx.appealText().includes("基线 125mm（生效锚定）"));
  });
  // Execute the real list/claim renderers as well, covering every visible use of the baseline.
  const els={who:{dataset:{addr:p.rider}},policies:{},claims:{},claimsWho:{}};
  Object.assign(ctx,{$:id=>els[id],DEMO_RIDER:p.rider,ethers:{id:String},provider:{getLogs:async()=>[]},
    esc:runtime.esc,v6:{policiesOf:async()=>[0n],policies:async()=>p,policyStatus:async()=>"active",judgements:async()=>({...judgement,exists:true})}});
  vm.runInContext("let POLICY_CACHE={};",ctx);
  vm.runInContext(source.slice(source.indexOf("async function refreshPolicies"),source.indexOf("let POLICY_CACHE")),ctx);
  vm.runInContext(source.slice(source.indexOf("const TOPIC_CLAIM"),source.indexOf("function denyReason")),ctx);
  vm.runInContext(source.slice(source.indexOf("async function loadClaims"),source.indexOf("async function connectWallet")),ctx);
  await ctx.refreshPolicies();await ctx.loadClaims();
  check("保单卡片与判定记录均显示生效基线",()=>{
    assert(els.policies.innerHTML.includes("生效基线 125mm"));
    assert(els.claims.innerHTML.includes("生效基线 125mm"));
  });
  check("默认演示地址对应已购保单钱包",()=>assert(source.includes('const DEMO_RIDER="0x5D13941203e46Cde6d3f2DfC6e7947f6a7b0283C"')));

  let chain="0x1", added=false, signed=0;const calls=[];
  const ethereum={request:async request=>{
    calls.push(request.method);
    if(request.method==="eth_chainId")return chain;
    if(request.method==="wallet_switchEthereumChain"){
      if(!added)throw Object.assign(new Error("Unknown chain"),{code:4902});
      chain=request.params[0].chainId;
    }
    if(request.method==="wallet_addEthereumChain"){
      assert.equal(request.params[0].chainId,"0x3c8");
      assert.equal(request.params[0].nativeCurrency.symbol,"BOT");added=true;
    }
    return [p.rider];
  }};
  const E={BrowserProvider:function(){this.getSigner=()=>{signed++;return p.rider;};}};
  await runtime.wallet(E,ethereum,"https://rpc.bohr.life");
  check("未知网络先添加再切换 968，确认后才交付签名账户",()=>{
    assert.deepEqual(calls,["eth_requestAccounts","eth_chainId","wallet_switchEthereumChain","wallet_addEthereumChain","wallet_switchEthereumChain","eth_chainId"]);
    assert.equal(signed,1);
  });
  calls.length=0;await runtime.wallet(E,ethereum,"https://rpc.bohr.life");
  check("已在 968 时不重复要求添加和切网",()=>assert.deepEqual(calls,["eth_requestAccounts","eth_chainId","eth_chainId"]));
  await assert.rejects(runtime.wallet(E,{request:async r=>r.method==="eth_chainId"?"0x1":[]},"rpc"),/968/);
  check("钱包未真正切网时拒绝继续",()=>assert.equal(signed,2));

  const preflight=fs.readFileSync(path.join(root,"04-脚本/preflight.js"),"utf8");
  let state={isFile:()=>true,size:100}, rows=[];
  const pc={process:{env:{OWNER_KEY_FILE:"fixture/owners.json"}},path,__dirname:path.join(root,"04-脚本"),
    fs:{statSync:file=>{assert.equal(file,"fixture/owners.json");if(state instanceof Error)throw state;return state;}},
    ok:(_area,msg)=>rows.push(["ok",msg]),bad:(_area,msg)=>rows.push(["bad",msg])};
  vm.createContext(pc);vm.runInContext(preflight.slice(preflight.indexOf("function checkOwnerKeyFile"),preflight.indexOf("// ── 1.")),pc);
  pc.checkOwnerKeyFile();
  check("本机预检采用 OWNER_KEY_FILE 覆盖路径，且只读文件元信息",()=>assert.equal(rows.at(-1)[0],"ok"));
  for(const badState of [new Error("ENOENT"),{isFile:()=>false,size:100},{isFile:()=>true,size:0}]){
    state=badState;pc.checkOwnerKeyFile();assert.equal(rows.at(-1)[0],"bad");
  }
  check("缺失、目录及空文件配置均报阻断项",()=>assert.equal(rows.length,4));
  console.log(`V6-T1 骑手与配置隔离回归：${count} 项通过（无网络、无密钥读取、无链上交易）`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
