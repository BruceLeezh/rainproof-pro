// 只读探针：BOT Chain 主网 677 上 v3 的投保/退保留痕 + 承保参数现状（不写链、不碰仓库）
// 用法（走本机代理）：$env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://127.0.0.1:7890'; node probe677.js
const REPO = "C:/Users/lenovo/Desktop/汉客松/rainproof";
const { ethers } = require(REPO + "/04-脚本/node_modules/ethers");
const abi = require(REPO + "/03-合约/RainDeliveryInsuranceV3.abi.json");
const ADDR = "0x89e7C942535930B61cB61631051E8b0bD670596a";
const RPC = "https://rpc.botchain.ai";
const J = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x));

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const c = new ethers.Contract(ADDR, abi, p);
  const net = await p.getNetwork();
  const latest = await p.getBlockNumber();
  console.log(`链 chainId=${net.chainId} 最新区块=${latest} 合约=${ADDR}`);
  console.log(`合约余额 = ${ethers.formatEther(await p.getBalance(ADDR))} BOT`);

  const g = async (n, ...a) => {
    try { const v = await c[n](...a); return typeof v === "bigint" ? v.toString() : v; }
    catch (e) { return "ERR:" + String(e.shortMessage || e.message).slice(0, 70); }
  };

  const scalars = ["nextPolicyId", "poolBalance", "reserve", "reserveOf", "openExposure", "operator", "paused",
    "MIN_HOURS", "MAX_HOURS", "MIN_PREMIUM", "PAYOUT_MAX", "PREMIUM_DEFAULT", "MAX_FEED_AGE", "coolingPeriod",
    "MAX_OPEN_EXPOSURE_PER_RIDER", "MAX_POLICIES_PER_RIDER", "MIN_CONFIDENCE"];
  for (const n of scalars) console.log(`  ${n} = ${await g(n)}`);
  console.log(`  hoursAllowed(12/24/48/72) = ${await g("hoursAllowed", 12)}/${await g("hoursAllowed", 24)}/${await g("hoursAllowed", 48)}/${await g("hoursAllowed", 72)}`);
  for (let r = 1; r <= 5; r++) {
    console.log(`  区域#${r} lastFeedAt=${await g("lastFeedAt", r)} premiumOf(12)=${await g("premiumOf", r, 12, 0, 0, 1)} premiumOf(24)=${await g("premiumOf", r, 24, 0, 0, 1)} 阈值(12)=${await g("thresholdOf", 12, 0)}/${await g("thresholdOf", 12, 1)} 阈值(24)=${await g("thresholdOf", 24, 0)}/${await g("thresholdOf", 24, 1)} riskLevel=${await g("riskLevel", r)}`);
  }

  const n = Number(await c.nextPolicyId());
  for (let i = 0; i < n; i++) {
    console.log(`  保单 #${i}: status=${await g("policyStatus", i)} payout=${ethers.formatEther(await c.payoutOf(i))} BOT`);
    try { console.log(`     policies(${i}) = ${J(await c.policies(i))}`); } catch (e) { console.log("     policies() 读取失败 " + e.message.slice(0, 60)); }
  }

  const CHUNK = 50000;
  const from = 25918000;
  for (const [label, filter] of [["PolicyBought", c.filters.PolicyBought()], ["PolicyRefunded", c.filters.PolicyRefunded()]]) {
    const hits = [];
    for (let s = from; s <= latest; s += CHUNK) {
      const e = Math.min(s + CHUNK - 1, latest);
      try { (await c.queryFilter(filter, s, e)).forEach((x) => hits.push(x)); } catch (err) { console.log(`  [${label}] ${s}-${e} 区间查询失败：${String(err.shortMessage || err.message).slice(0, 80)}`); }
    }
    console.log(`\n== ${label}（${hits.length} 笔，扫描 ${from}–${latest}）==`);
    for (const h of hits) console.log(`  #${h.args.policyId} tx=${h.transactionHash} 区块=${h.blockNumber} args=${J(h.args)}`);
  }
})().catch((e) => { console.error("💥", e.shortMessage || e.message); process.exit(1); });
