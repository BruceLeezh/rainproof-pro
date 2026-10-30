"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { increment, MODELS } = require("../04-脚本/feed-window");
const runtime = require("../05-演示站点/runtime");
const { ethers } = require("ethers");
const root = path.resolve(__dirname, "..");
let count = 0;
function check(name, fn) { fn(); count++; console.log("OK " + name); }
const times = ["2026-10-28T00:00", "2026-10-28T01:00", "2026-10-28T02:00"];
const readings = values => Object.fromEntries(MODELS.map(m => ["precipitation_" + m, values]));
const inc = data => increment(times, data, times[0], times[2]);

async function main() {
  check("完整零降雨可采信", () => assert.equal(inc(readings([0, 0, 0])).ok, true));
  check("null 缺测不能变为零降雨", () => assert.equal(inc(readings([0, null, null])).ok, false));
  check("字符串与负数不能充当有效降雨", () => {
    assert.equal(inc(readings([0, "3", "4"])).ok, false);
    assert.equal(inc(readings([0, -1, 2])).ok, false);
  });
  check("空窗口不虚构三源共识", () => assert.equal(increment(times, readings([0, 0, 0]), times[2], times[2]).ok, false));
  check("缺失整点拒收", () => assert.equal(increment([times[0], times[2]], readings([0, 5]), times[0], times[2]).ok, false));
  check("两源中位数取平均且来源数如实记录", () => {
    const out = inc({ [MODELS[0]]: [0, 1, 1], [MODELS[1]]: [0, 2, 2] });
    assert.equal(out.median, 3); assert.equal(out.sources, 2); assert.equal(out.ok, true);
  });
  check("重复时刻不能重复累计", () => assert.equal(increment([times[1], times[1]], readings([1, 1]), times[0], times[2]).ok, false));
  const a = "0x1111111111111111111111111111111111111111";
  check("批量名单拒绝重复、零地址和混入的坏行", () => {
    for (const text of [a + "\n" + a, ethers.ZeroAddress, a + "\ninvalid"]) assert.throws(() => runtime.addresses(text, ethers));
  });
  check("RPC 异常 HTML 作为纯文本转义", () => assert.equal(runtime.esc('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  const calls = [];
  await assert.rejects(runtime.wallet({}, { request: async ({ method }) => {
    calls.push(method); if (method === "eth_chainId") return "0x1";
    if (method === "wallet_switchEthereumChain") throw Object.assign(new Error("rejected"), { code: 4001 });
    return [a];
  } }, "https://rpc.bohr.life"));
  check("用户拒绝切网时不继续添加网络", () => assert.equal(calls.includes("wallet_addEthereumChain"), false));

  // Execute the actual rider buy() handler with controllable transaction receipts.
  const source = fs.readFileSync(path.join(root, "05-演示站点/rider.html"), "utf8");
  const body = source.slice(source.indexOf("async function buy(){"), source.indexOf('$("claims").addEventListener', source.indexOf("async function buy(){")));
  const els = { buy: { disabled: false }, buyerr: {}, city: { value: "1" }, hours: { value: "12" }, bigApprove: { checked: false }, who: { dataset: {} } };
  const events = []; let mineApprove, mineBuy;
  const token = { allowance: async () => 0n, approve: async () => {
    events.push("approve-sent"); return { wait: () => new Promise(resolve => { mineApprove = () => { events.push("approve-mined"); resolve(); }; }) };
  } };
  const contract = { premiumOf: async () => 500n, buyPolicy: async () => {
    events.push("buy-sent"); return { wait: () => new Promise(resolve => { mineBuy = () => { events.push("buy-mined"); resolve(); }; }) };
  } };
  const ctx = { $: id => els[id], window: { ethereum: {} }, CITY_CODE: { 1: 420100 }, TOK: "token", V5: "insurance", V6: "insurance", TOKABI: [], V5ABI: [], V6ABI: [], RPC: "local",
    E: { Contract: function (address) { return address === "token" ? token : contract; } },
    RainproofRuntime: { wallet: async () => ({ getAddress: async () => a }) },
    toast: text => { if (text === "投保成功") events.push("success"); }, refreshPolicies: async () => {}, refreshAllowance: () => {}, loadClaims: () => {}, v5: { policiesOf: async () => [] }, v6: { policiesOf: async () => [] }, document: { getElementById: () => null } };
  vm.createContext(ctx); vm.runInContext(body, ctx);
  const running = ctx.buy();
  await new Promise(setImmediate);
  check("授权确认前不发送投保", () => assert.deepEqual(events, ["approve-sent"]));
  await ctx.buy();
  check("双击不重复提交", () => assert.deepEqual(events, ["approve-sent"]));
  mineApprove(); await new Promise(setImmediate);
  check("投保确认前不显示成功", () => assert.deepEqual(events, ["approve-sent", "approve-mined", "buy-sent"]));
  mineBuy(); await running;
  check("交易确认后成功且按钮恢复", () => { assert.equal(events.at(-1), "success"); assert.equal(els.buy.disabled, false); });
  contract.premiumOf = async () => { throw new Error("RPC unavailable"); };
  await ctx.buy();
  check("失败后可重试且保留错误", () => { assert.equal(els.buy.disabled, false); assert.equal(els.buyerr.textContent, "RPC unavailable"); });

  const { submittedTxId } = require("../04-脚本/multisig-receipt");
  const iface = new ethers.Interface(require("../03-合约/OperatorMultisig.abi.json"));
  const payload = "0x1234", msAddress = "0x2222222222222222222222222222222222222222";
  const emitted = iface.encodeEventLog(iface.getEvent("Submitted"), [7n, a, a, 0n, payload]);
  const mockMs = { target: msAddress, interface: iface };
  const receipt = { logs: [{ ...emitted, address: msAddress }] };
  check("多签使用回执中的 proposal ID，避免 txCount 竞态", () => assert.equal(submittedTxId(mockMs, receipt, a, payload), 7n));
  check("多签回执的目标与 calldata 必须一致", () => assert.throws(() => submittedTxId(mockMs, receipt, a, "0xabcd")));
  check("外部合约伪造 Submitted 日志不可采信", () => assert.throws(() => submittedTxId(mockMs, { logs: [{ ...emitted, address: a }] }, a, payload)));
  const keeper = fs.readFileSync(path.join(root, "04-脚本/keeper.js"), "utf8");
  const scanText = keeper.slice(keeper.indexOf("async function scan("), keeper.indexOf("\n(async () =>", keeper.indexOf("async function scan(")));
  const scanLogs = [];
  const scanCtx = { VARIANT: "V6", ts: () => "test", fmt: String, console: { log: text => scanLogs.push(text) }, process: {} };
  vm.createContext(scanCtx); vm.runInContext(scanText, scanCtx);
  const fakePolicy = { nextPolicyId: async () => 1n, paused: async () => false, policyStatus: async () => "expired", CLAIM_GRACE: async () => 604800n,
    policies: async () => ({ endTime: 1000n }), payoutOf: async () => 5000n, judgements: async () => ({ exists: true, decision: 1, confidence: 90 }) };
  await scanCtx.scan(fakePolicy, { getBlock: async () => ({ timestamp: 2000 }) }, true, true);
  check("V6 keeper 宽限期内不将过期单列为可结算", () => assert(!scanLogs.some(line => line.includes("[dry-run] 到期未赔"))));
  scanLogs.length = 0;
  await scanCtx.scan(fakePolicy, { getBlock: async () => ({ timestamp: 606000 }) }, true, true);
  check("V6 keeper 宽限结束后才结算敞口", () => assert(scanLogs.some(line => line.includes("[dry-run] 到期未赔 1 张可结算"))));
  const centsExpr = keeper.match(/const CENTS = (.*);/)[1];
  for (const version of ["V2", "V3", "V4", "V5", "V6"]) {
    check(`keeper ${version} 采用正确金额单位`, () => assert.equal(vm.runInNewContext(`(${centsExpr})()`, { VARIANT: version }), ["V4", "V5", "V6"].includes(version)));
  }
  const warning = fs.readFileSync(path.join(root, "04-脚本/warning-watch.js"), "utf8");
  const forecastBody = warning.slice(warning.indexOf("async function forecast24h"), warning.indexOf("function mscall"));
  let dailyValues = [0, 10];
  const forecastCtx = { MODELS, AbortSignal, fetch: async () => ({ ok: true, json: async () => ({ daily: { time: ["today", "tomorrow"], ...Object.fromEntries(MODELS.map(m => ["precipitation_sum_" + m, dailyValues])) } }) }) };
  vm.createContext(forecastCtx); vm.runInContext(forecastBody, forecastCtx);
  assert.equal((await forecastCtx.forecast24h({ lat: 30, lon: 114 })).median, 10);
  dailyValues = [0, null]; await assert.rejects(forecastCtx.forecast24h({ lat: 30, lon: 114 }));
  check("停售哨兵不能用缺测生成恢复建议", () => assert(warning.includes("至少需要两个有效模型")));
  check("停售指令使用现有工具及合法保费", () => {
    assert(warning.includes("multisig-call.js ${fnName}"));
    assert(warning.includes("${r.id} 2 ${premium}")); assert(warning.includes("${r.id} 0 ${premium}"));
  });

  const handler = require("../11-节点代理-vercel/api/rpc");
  let upstream = 0; const original = global.fetch;
  global.fetch = async (_url, options) => { upstream++; assert(options.signal); return { status: 200, text: async () => '{"jsonrpc":"2.0","id":1,"result":"0x2a5"}' }; };
  async function request(body, ip = "audit") {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
    await handler({ method: "POST", body, headers: { "x-forwarded-for": ip } }, res); return res;
  }
  try {
    const call = { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] };
    for (const body of [[], Array(21).fill(call), { method: "eth_chainId" }]) assert.equal((await request(body)).code, 400);
    assert.equal((await request({ ...call, method: "eth_sendRawTransaction" })).code, 403);
    check("非法或超量批次、写请求未到达上游", () => assert.equal(upstream, 0));
    assert.equal((await request("x".repeat(65537))).code, 413);
    for (let i = 0; i < 3; i++) assert.equal((await request(Array(20).fill(call))).code, 200);
    check("批次按实际 RPC 条数限流", () => assert.equal(upstream, 3));
    assert.equal((await request(call)).code, 429);
    global.fetch = async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); };
    assert.equal((await request(call, "timeout-audit")).code, 504);
    check("上游超时返回 504", () => assert.equal(upstream, 3));
  } finally { global.fetch = original; }
  console.log(`审查回归：${count} 项通过`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
