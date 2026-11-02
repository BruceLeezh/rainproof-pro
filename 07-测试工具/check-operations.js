"use strict";
const assert = require("node:assert/strict"), fs = require("fs"), path = require("path"), vm = require("vm");
const runtime = require("../05-演示站点/runtime");
const { withRetry } = require("../04-脚本/rpc-read");
const root = path.resolve(__dirname, "..");
let count = 0;
function ok(label, fn) { fn(); count++; console.log("OK " + label); }
async function main() {
  const last = 100000, max = 86400;
  ok("24h 精确边界允许；超过 1 秒拒绝", () => {
    assert(runtime.feedState(last, max, last + max).available);
    assert(!runtime.feedState(last, max, last + max + 1).available);
  });
  ok("从未喂价、未来时间及缺失读数不能投保", () => {
    for (const value of [0, undefined, NaN, last + 2]) assert(!runtime.feedState(value, max, last + 1).available);
  });
  const contract = {
    lastFeedAt: async () => last, MAX_FEED_AGE: async () => max,
    runner: { provider: { getBlock: async () => ({ timestamp: last + 1 }) } },
    paused: async () => false, regions: async () => ({ active: true }), riskLevel: async () => 0
  };
  assert((await runtime.feedStatus(contract, 1)).available);
  ok("签名钱包通过 provider 读取区块时间", () => assert(true));
  for (const [field, value] of [["paused", true], ["regions", { active: false }], ["riskLevel", 2]]) {
    const state = await runtime.feedStatus({ ...contract, [field]: async () => value }, 1);
    ok(field + " 禁止投保时必须拦截", () => assert(!state.available));
  }
  let calls = 0, delays = [];
  assert.equal(await withRetry(async () => {
    if (++calls < 3) throw Object.assign(new Error("dns"), { code: "EAI_AGAIN" });
    return 968;
  }, { sleep: async ms => delays.push(ms) }), 968);
  ok("DNS 临时失败重试并退避后恢复", () => { assert.equal(calls, 3); assert.deepEqual(delays, [500, 1000]); });
  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error("bad call"), {code:"CALL_EXCEPTION"}); }, {sleep:async()=>{}}));
  ok("合约业务错误不重试", () => assert.equal(calls, 1));
  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error("offline"), {code:"ENOTFOUND"}); }, {sleep:async()=>{}}));
  ok("持续网络故障重试有上限", () => assert.equal(calls, 4));

  const source = fs.readFileSync(path.join(root, "05-演示站点/rider.html"), "utf8");
  const netBody = source.slice(source.indexOf("let netSequence="), source.indexOf("let offerSequence="));
  const netElements=Object.fromEntries(["city","hours","rainv","thv","netv","netdot","poolv"].map(id=>[id,{value:id==="city"?"1":"12"}]));
  const rainRequests=new Map();
  const netContext={ $:id=>netElements[id], provider:{getNetwork:async()=>({chainId:968n})},CHAIN:968,yuan:String,
    v6:{rainfall:code=>new Promise(resolve=>rainRequests.set(code,resolve)),poolBalance:async()=>100n},Promise };
  vm.createContext(netContext);vm.runInContext(netBody,netContext);
  const oldNet=netContext.refreshNet();netElements.city.value="2";const newNet=netContext.refreshNet();
  rainRequests.get(2)(22);await newNet;rainRequests.get(1)(11);await oldNet;
  ok("顶部降雨读数不被旧城市迟到响应覆盖",()=>assert.equal(netElements.rainv.textContent,"22 mm"));
  const quoteBody = source.slice(source.indexOf("let offerSequence="), source.indexOf("async function refreshPolicies"));
  const elements = Object.fromEntries(["buy", "city", "hours", "bigApprove", "quote", "feedtag", "offerNote"].map(id => [id, { value: id === "city" ? "1" : "12" }]));
  const pending = new Map();
  const ctx = { $: id => elements[id], v6: { premiumOf: code => new Promise(resolve => pending.set(code, resolve)) },
    RainproofRuntime: { feedStatus: async () => ({available:true,tone:"gold",label:"fresh"}) }, yuan: n => String(n), Promise };
  vm.createContext(ctx); vm.runInContext(quoteBody, ctx);
  const first = ctx.refreshQuote(); elements.city.value = "2"; const second = ctx.refreshQuote();
  pending.get(2)(200); await second; pending.get(1)(100); await first;
  ok("旧城市迟到的报价不覆盖新选择", () => assert(elements.quote.innerHTML.startsWith("200")));
  ctx.RainproofRuntime.feedStatus = async () => ({available:false,tone:"red",label:"stale"});
  const stale = ctx.refreshQuote(); pending.get(2)(200); await stale;
  ok("过期区划保留报价并禁用投保", () => { assert(elements.buy.disabled); assert.equal(elements.feedtag.textContent, "stale"); });
  ctx.RainproofRuntime.feedStatus = async () => { throw new Error("RPC unavailable"); };
  const offline = ctx.refreshQuote(); pending.get(2)(200); await offline;
  ok("RPC 失败清除旧报价并禁止投保", () => { assert(elements.buy.disabled); assert(!elements.quote.textContent.includes("200")); });

  const buyBody = source.slice(source.indexOf("async function buy(){"), source.indexOf('$("claims").addEventListener'));
  let approvals = 0;
  const transactionElements = { buy: { disabled: false }, buyerr: {}, city: {value:"1"}, hours:{value:"12"} };
  const transactionContext = {
    $: id => transactionElements[id],
    buying:false, offerReady:true, syncBuyButton:()=>{}, toast:()=>{}, window:{ethereum:{}}, RPC:"fixture", TOK:"token",V6:"insurance",TOKABI:[],V6ABI:[],
    E:{Contract:function(){return {approve:()=>{approvals++;},premiumOf:()=>{throw new Error("should not quote");}};}},
    RainproofRuntime:{wallet:async()=>({getAddress:async()=>"rider"}),feedStatus:async()=>({available:false,label:"stale"})}
  };
  vm.createContext(transactionContext);vm.runInContext(buyBody, transactionContext);await transactionContext.buy();
  ok("状态在签名期间过期时，授权前再次拦截",()=>{assert.equal(approvals,0);assert.equal(transactionContext.offerReady,false);});
  transactionContext.offerReady=true;
  transactionContext.RainproofRuntime.feedStatus=async()=>({available:true});
  transactionContext.E.Contract=function(){return {premiumOf:async()=>500n,balanceOf:async()=>0n,approve:()=>{approvals++;}};};
  await transactionContext.buy();
  ok("RDROP 不足时不发送授权交易",()=>{assert.equal(approvals,0);assert(transactionElements.buyerr.textContent.includes("余额不足"));});
  let statusReads=0, buys=0;
  transactionContext.RainproofRuntime.feedStatus=async()=>({available:++statusReads===1,label:"stale-after-approve"});
  transactionContext.E.Contract=function(address){return address==="token"?{
    balanceOf:async()=>5000n,allowance:async()=>500n
  }:{premiumOf:async()=>500n,buyPolicy:async()=>{buys++;}};};
  await transactionContext.buy();
  ok("等待授权期间过期时不再发送投保",()=>{assert.equal(buys,0);assert.equal(transactionContext.offerReady,false);});
  console.log(`运维与投保回归：${count} 项通过`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
