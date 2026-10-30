#!/usr/bin/env node
/**
 * notify.js —— 运营巡检 + 事件通知（2026-10-25）
 *
 * 一条命令做三件事：
 *   ① 巡检：池子/准备金覆盖率、五城喂价新鲜度、在保敞口 —— 任一异常非零退出（可挂计划任务当告警）
 *   ② 事件：扫最近的 投保/喂价/拒收/赔付 事件，输出摘要
 *   ③ 通知：设了 WECOM_WEBHOOK（企业微信机器人地址）则把摘要推过去；没设只打印
 *
 * 用法：node notify.js [--blocks N]   （默认扫最近 2000 块）
 */
"use strict";
const path = require("path");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const ACTIVE = require("./active-deployment").applyDeployment();
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const args = process.argv.slice(2);
const blockArg = args.find(a => a.startsWith("--blocks="))?.split("=")[1]
  ?? (args.includes("--blocks") ? args[args.indexOf("--blocks") + 1] : 60000);
const N_BLOCKS = Number(blockArg);
if (!Number.isSafeInteger(N_BLOCKS) || N_BLOCKS <= 0) throw new Error("--blocks requires a positive integer");
const REG = require("./v5-regions.json");   // v5：区划码
const CITY = Object.fromEntries(REG.map(r => [r.code, r.name]));
// 2026-10-26 修：v5 的 regionId 是 uint32，写成 uint8 的 topic0 永远匹配不到任何日志
// （合并前 notify 的「最近事件」一直显示「无」，不是链上没事件，是哈希算错了）。
const TOPICS = {
  bought: ethers.id("PolicyBought(uint256,address,uint32,uint256,uint256)"),
  fed: ethers.id("RainfallUpdated(uint32,uint256,bytes32,uint8,address)"),
  paid: ethers.id("ClaimPaid(uint256,address,uint256,uint8)"),
  rej: ethers.id("FeedRejected(uint32,uint8,uint8,bytes32,string)"),
  judged: ethers.id("JudgementSubmitted(uint256,uint8,uint8,uint8,uint8,uint256,bytes32,bytes32,string)"),
};
const NAME = { bought: "投保", fed: "喂价", paid: "赔付", rej: "拒收", judged: "判定" };

(async () => {
  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const abi = require(path.join(__dirname, "..", "03-合约", (ACTIVE.version === "V6" ? "RainDeliveryInsuranceV6.abi.json" : "RainDeliveryInsuranceV5.abi.json")));
  const v4 = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, p);
  const lines = []; const alarms = [];
  const Y = f => (Number(f) / 100).toFixed(2);

  const pool = await v4.poolBalance(), res = await v4.reserveOf(), expo = await v4.openExposure();
  const cov = Number(res) === 0 ? Infinity : Number(pool) / Number(res);
  lines.push(`💰 池子 ${Y(pool)} 元 · 准备金要求 ${Y(res)} 元 · 覆盖率 ${cov === Infinity ? "∞" : (cov * 100).toFixed(0) + "%"}`);
  if (cov < 1) alarms.push(`准备金覆盖率 ${(cov * 100).toFixed(0)}% < 100%：需注资 ${Y(res - pool)} 元`);

  let feedLine = [];
  for (const r of REG) {
    const i = r.code;
    const lf = Number(await v4.lastFeedAt(i));
    const ageH = lf === 0 ? Infinity : Math.floor((Date.now() / 1000 - lf) / 3600);
    feedLine.push(`${CITY[i]} ${lf === 0 ? "从未喂" : ageH + "h"}`);
    if (ageH > 20) alarms.push(`${CITY[i]} 喂价 ${lf === 0 ? "从未喂" : ageH + " 小时前"}：临近/超过 MAX_FEED_AGE(24h)，投保将 revert —— 该续喂了`);
  }
  lines.push(`🌧️ 喂价新鲜度：${feedLine.join(" · ")}`);
  lines.push(`🛡️ 在保敞口 ${Y(expo)} 元`);

  const blk = await p.getBlockNumber();
  const evs = []; const scanFailed = [];
  for (const [k, t] of Object.entries(TOPICS)) {
    try {
      const ls = await p.getLogs({ address: await v4.getAddress(), topics: [t], fromBlock: Math.max(0, blk - N_BLOCKS), toBlock: "latest" });
      for (const l of ls) evs.push({ blk: l.blockNumber, k, l });
    } catch (e) { scanFailed.push(NAME[k] + "：" + (e.shortMessage || e.message)); }
  }
  if (scanFailed.length) alarms.push("事件扫描失败 " + scanFailed.length + " 类（" + scanFailed.join("；") + "）——别把「没扫到」当成「没发生」");
  evs.sort((a, b) => b.blk - a.blk);
  const recent = evs.slice(0, 12).map(e => {
    if (e.k === "paid" || e.k === "bought" || e.k === "judged") {
      const id = Number(e.l.topics[1]);
      return `#${id} ${NAME[e.k]}`;
    }
    const region = Number(e.l.topics[1]);
    return `${CITY[region] || ("区划码 " + region)} ${NAME[e.k]}`;
  });
  lines.push(`📜 最近事件（${evs.length} 条，窗口 ${N_BLOCKS} 块）：${recent.join("；") || "无"}`);

  const report = ["【雨证巡检 " + new Date().toLocaleString("zh-CN") + "】", ...lines,
    ...(alarms.length ? ["⚠️ 告警：", ...alarms.map(a => "· " + a)] : ["✅ 巡检无异常"])].join("\n");
  console.log(report);

  if (process.env.WECOM_WEBHOOK) {
    const body = JSON.stringify({ msgtype: "markdown", markdown: { content: report.replace(/[_*]/g, "").slice(0, 4000) } });
    const response = await fetch(process.env.WECOM_WEBHOOK, {
      method: "POST", headers: {"Content-Type":"application/json"}, body,
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
    const result = await response.json();
    if (result.errcode !== 0) throw new Error(`Webhook rejected: ${result.errcode}`);
    console.log("（已推送企业微信）");
  }
  process.exit(alarms.length ? 2 : 0);
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
