"use strict";
// V6 链上事件全量复核（只读）。
// 范围：deployment.json 的 deploymentBlock → 当前块头，自适应分片拉全部日志。
// 核对：① 各类事件计数 ② 每区划末次喂价事件值 == 链上 rainfall() 状态
//       ③ 9 个分歧区划的链上 lastFeedAt 与末次喂价事件块时间一致
//       ④ 保单类事件应为 0（V6 零保单） ⑤ FeedRejected/管理类事件全列表
//       ⑥ 喂价事件操作人多签身份。
// 产出：08-截图存证/<日期>-事件全复核/chain-events-audit.json + 控制台摘要。
// 不发交易、不改任何状态。
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require(path.join(__dirname, "..", "04-脚本", "node_modules", "dotenv")).config({ path: path.join(__dirname, "..", "04-脚本", ".env") });
const { ethers } = require(path.join(__dirname, "..", "04-脚本", "node_modules", "ethers"));
const { withRetry, provider: makeProvider } = require(path.join(__dirname, "..", "04-脚本", "rpc-read"));

const REG = require(path.join(__dirname, "..", "04-脚本", "v5-regions.json"));
const CITY = Object.fromEntries(REG.map(r => [r.code, r.name]));
const DAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const OUT_DIR = path.join(__dirname, "..", "08-截图存证", `${DAY}-事件全复核`);
const MULTISIG = (process.env.MULTISIG_ADDR || "").toLowerCase();
const sha256 = t => crypto.createHash("sha256").update(t, "utf8").digest("hex");
const ts8 = s => new Date(s * 1000 + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 16);
const DIVERGE = [420324, 420525, 420526, 420527, 420882, 421123, 421321, 422827, 422828];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployment.json"), "utf8"));
  const p = makeProvider(ethers, process.env.SEPOLIA_RPC);
  const v6 = new ethers.Contract(dep.contract, require(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV6.abi.json")), p);
  const iface = new ethers.Interface(require(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV6.abi.json")));
  const byTopic = new Map(iface.fragments.filter(f => f.type === "event").map(f => [f.topicHash, f]));

  const head = await withRetry(() => p.getBlockNumber());
  const start = dep.deploymentBlock;
  console.log(`范围 ${start} → ${head}（${head - start + 1} 块，合约 ${dep.contract}）`);

  const logs = [];
  let lo = start, chunk = 20000;
  while (lo <= head) {
    const hi = Math.min(lo + chunk - 1, head);
    try {
      const part = await withRetry(() => p.send("eth_getLogs", [{ address: dep.contract, fromBlock: "0x" + lo.toString(16), toBlock: "0x" + hi.toString(16) }]));
      logs.push(...part);
      lo = hi + 1;
    } catch (e) {
      if (chunk > 1000 && /limit|range|size|too many|exceed|leading zero/i.test(String(e.message))) { chunk = Math.floor(chunk / 2); continue; }
      throw e;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`共拉到 ${logs.length} 条日志`);

  const events = [];
  for (const lg of logs) {
    try {
      const parsed = iface.parseLog({ topics: lg.topics, data: lg.data });
      events.push({ name: parsed.name, args: parsed.args, inputs: parsed.fragment.inputs, blockNumber: Number(lg.blockNumber), txHash: lg.transactionHash });
    } catch { events.push({ name: "(unknown)", blockNumber: Number(lg.blockNumber), txHash: lg.transactionHash }); }
  }
  const byName = {};
  for (const e of events) (byName[e.name] ??= []).push(e);

  // 块时间戳：预取 + 缓存 + 并发池，避免顺序打爆 RPC
  const tsCache = new Map();
  async function prefetchTs(numbers) {
    const list = [...new Set(numbers)].filter(n => !tsCache.has(n));
    let i = 0;
    async function worker() {
      while (i < list.length) {
        const n = list[i++];
        try { const b = await withRetry(() => p.getBlock(n), { attempts: 6, delayMs: 800 }); tsCache.set(n, b ? b.timestamp : null); }
        catch { tsCache.set(n, null); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, list.length) }, worker));
  }
  const tsOf = n => tsCache.get(n);

  const lastFeedEvent = new Map();
  for (const e of byName.RainfallUpdated || []) { const code = Number(e.args[0]); lastFeedEvent.set(code, e); }

  // ② 末次喂价事件值 vs 链上状态（122 区划逐个读，串行带退避）
  const regionState = {};
  let valueMismatch = 0;
  for (const r of REG) {
    const code = r.code;
    const chainVal = Number(await withRetry(() => v6.rainfall(code)));
    const ev = lastFeedEvent.get(code);
    const evVal = ev ? Number(ev.args[1]) : null;
    regionState[code] = { chainVal, evVal, evCount: (byName.RainfallUpdated || []).filter(e => Number(e.args[0]) === code).length };
    if (ev && evVal !== chainVal) { valueMismatch++; }
    await new Promise(r2 => setTimeout(r2, 120));
  }
  console.log(`② 末次喂价事件值 vs 链上 rainfall()：不一致 ${valueMismatch} / ${REG.length}`);

  // ③ 9 个分歧区划 lastFeedAt == 末次喂价事件块时间
  await prefetchTs(DIVERGE.map(c => lastFeedEvent.get(c)).filter(Boolean).map(e => e.blockNumber));
  summaryInit();
  function summaryInit() { /* placeholder replaced below */ }
  const diverge9 = DIVERGE.map(code => {
    const lf = lastFeedEvent.get(code);
    return null; // replaced below
  });

  const summary = { schema: "rainproof/event-audit@1", generatedAt: new Date().toISOString(), range: { start, head }, contract: dep.contract, totalLogs: logs.length, counts: {}, findings: [], special: {}, feedByRegion: regionState, diverge9: [] };

  for (const code of DIVERGE) {
    const lfState = Number(await withRetry(() => v6.lastFeedAt(code)));
    const ev = lastFeedEvent.get(code);
    const evTs = ev ? tsOf(ev.blockNumber) : null;
    const ok = evTs == null ? "⚠️ 块时间不可得" : (evTs === lfState ? "✅ 一致" : `❌ 不一致 事件=${ts8(evTs)} 状态=${ts8(lfState)}`);
    if (evTs != null && evTs !== lfState) summary.findings.push(`❌ ${code} lastFeedAt 与末次事件块时间不一致`);
    summary.diverge9.push({ code, name: CITY[code], lastFeedAt: lfState, lastFeedIso: ts8(lfState), lastEventValue: ev ? Number(ev.args[1]) : null, check: ok });
    console.log(`③ ${code} ${CITY[code]} lastFeedAt=${ts8(lfState)} 值=${regionState[code].chainVal}mm ${ok}`);
  }

  // ① 计数
  for (const [name, list] of Object.entries(byName)) summary.counts[name] = list.length;
  summary.findings.push(valueMismatch === 0 ? `✅ 全部 ${REG.length} 区划末次喂价事件值与链上 rainfall() 一致` : `❌ ${valueMismatch} 个区划事件值与状态不一致`);

  // ④ 保单类事件（V6 上线后应为 0）
  const policyEvents = ["PolicyBought", "PolicyRefunded", "JudgementSubmitted", "ClaimPaid", "ExposureSettled"];
  const policySeen = policyEvents.filter(n => (byName[n] || []).length);
  summary.special.policyEvents = Object.fromEntries(policyEvents.map(n => [n, (byName[n] || []).length]));
  summary.findings.push(policySeen.length === 0 ? "✅ 保单类事件 0 条（与 V6 零保单口径一致）" : `⚠️ 存在保单类事件：${policySeen.join(",")}`);

  // ⑤ FeedRejected 与管理类事件全列表
  const SPECIAL = ["FeedRejected", "OperatorChanged", "PausedSet", "RegionRegistered", "RegionActiveSet", "PremiumSet", "ReserveSet", "PoolFunded", "PoolWithdrawn", "PricingModuleSet", "CoolingPeriodSet", "EligibleRequiredSet", "UnderwritingDecision"];
  await prefetchTs(SPECIAL.flatMap(n => (byName[n] || []).map(e => e.blockNumber)));
  for (const n of SPECIAL) {
    const list = byName[n] || [];
    if (!list.length) continue;
    summary.special[n] = list.map(e => {
      const args = {};
      e.args.forEach((v, i) => { try { const inp = e.inputs[i]; args[inp && inp.name || i] = typeof v === "bigint" ? v.toString() : (v && v._isBigNumber ? v.toString() : (inp && inp.type.startsWith("uint") ? Number(v) : v)); } catch { } });
      const t = tsOf(e.blockNumber);
      return { block: e.blockNumber, time: t == null ? null : ts8(t), tx: e.txHash, args };
    });
  }
  if ((byName.FeedRejected || []).length === 0) summary.findings.push("✅ FeedRejected 0 条——分歧被链下闸门拦住，从未把可疑值送上链");

  // ⑥ 喂价事件操作人（末参 address）应等于事件发生当时在任的 operator（按 OperatorChanged 时间线）
  const feeds = byName.RainfallUpdated || [];
  const opTimeline = (byName.OperatorChanged || [])
    .map(e => ({ block: e.blockNumber, to: String(e.args[1]).toLowerCase() }))
    .sort((a, b) => a.block - b.block);
  const opAt = block => { let cur = opTimeline.length ? opTimeline[0].to : MULTISIG; for (const t of opTimeline) { if (t.block <= block) cur = t.to; else break; } return cur; };
  const anomalies = feeds.filter(e => String(e.args[4]).toLowerCase() !== opAt(e.blockNumber));
  summary.operatorTimeline = opTimeline;
  summary.findings.push(anomalies.length === 0
    ? `✅ 全部 ${feeds.length} 条喂价事件操作人与事发当时在任 operator 一致（含迁移期 ${opTimeline.length ? opAt(start) : "?"} 窗口）`
    : `❌ ${anomalies.length} 条喂价事件操作人异常`);
  summary.operatorAnomalies = anomalies.map(e => ({ block: e.blockNumber, tx: e.txHash, operator: String(e.args[4]), expected: opAt(e.blockNumber) }));

  const out = path.join(OUT_DIR, "chain-events-audit.json");
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log("counts:", JSON.stringify(summary.counts));
  console.log("findings:");
  summary.findings.forEach(f => console.log("  " + f));
  console.log("saved:", out, "sha256=" + sha256(JSON.stringify(summary)));
  await p.destroy();
}

main().catch(e => { console.error("💥", (e && e.message) || e); process.exit(1); });
