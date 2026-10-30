#!/usr/bin/env node
/**
 * warning-watch.js —— 暴雨预警联动停售哨兵（2026-10-25）
 *
 * 干什么：拉三个气象机构的未来降水预报（Open-Meteo：ECMWF/GFS/ICON，与喂价闸门同源），
 *         按城市聚合「明日自然日累计降水」的中位数；≥50mm（国标 24h 暴雨线）视为
 *         高逆选择风险 —— 建议该城停售（RISK_SUSPENDED）；此前停售的城市若预报回落，
 *         建议恢复（RISK_NORMAL）。**本脚本只读预报 + 打印建议与现成命令，不动链**：
 *         停售是 onlyOperator 动作，执行必须走多签二票（命令已按 mscall 格式生成）。
 *
 * 为什么：实测「最优开保时点触发率 = 月均 5.7–10.4 倍」——预警发布后放行新单，
 *         等于让投保人拿我们的钱赌一场已经宣布的雨。价格补偿（众包加价）之外，
 *         这是硬闸门。（对应《产品完善路线图》B2）
 *
 * 用法：node warning-watch.js [--watch 分钟]     # 单次；--watch 30 每 30 分钟一轮（全仓统一口径）
 */
"use strict";
const path = require("path");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const ACTIVE = require("./active-deployment").applyDeployment();
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const REGIONS = require("./v5-regions.json").map(r => ({ id: r.code, key: r.name, name: r.name, lat: r.lat, lon: r.lon }));   // v5：区划码
const MODELS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"];
const SUSPEND_MM = 50;          // 停售建议线 = 国标 24h 暴雨下限
const RESUME_MM = 30;           // 恢复线留滞后带，避免边界抖动

async function forecast24h(region) {
  // 与 feed-verify 同款接口：models= 三机构 + daily=precipitation_sum（这里取未来两天）
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${region.lat}&longitude=${region.lon}` +
    `&daily=precipitation_sum&timezone=Asia%2FShanghai&forecast_days=2&models=${MODELS.join(",")}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "rainproof-warning-watch/1.0" } });
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  const j = await r.json();
  const days = j?.daily?.time || [];
  if (!days.length) throw new Error("接口没有返回日期序列");
  // 明天（days[1]）的三模型日降水量 → 中位，作为「明日自然日」的预报口径（日粒度，与链上喂价同粒度）
  const sums = MODELS.map(m => {
    const raw = j.daily[`precipitation_sum_${m}`];
    const v = raw ? raw[1] : null;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  });
  const valid = sums.filter(v => v !== null).sort((a, b) => a - b);
  if (valid.length < 2) throw new Error("至少需要两个有效模型的明日预报");
  return { median: valid.length === 2 ? (valid[0] + valid[1]) / 2 : valid[1], models: sums };
}

function mscall(fnName, argsHexReady) {
  // 生成可直接粘贴的两票命令（07-测试工具/mscall.js 的用法形态）
  return `node 07-测试工具/multisig-call.js ${fnName} ${argsHexReady} --send`;
}

async function once() {
  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const abi = require(path.join(__dirname, "..", "03-合约", (ACTIVE.version === "V6" ? "RainDeliveryInsuranceV6.abi.json" : "RainDeliveryInsuranceV5.abi.json")));
  const v4 = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, p);
  console.log(`\n===== 暴雨预警哨兵 · ${new Date().toLocaleString("zh-CN")} =====`);
  for (const r of REGIONS) {
    let f = null;
    try { f = await forecast24h(r); } catch (e) { process.exitCode=2; console.log(`${r.name} 预报拉取失败：${(e.message || e).toString().slice(0, 60)}`); continue; }
    const median = f.median;
    const premium = await v4.premiumOf(r.id, 24);
    const cur = Number(await v4.riskLevel(r.id));            // 0=NORMAL 1=LOADED 2=SUSPENDED
    const shouldSuspend = median >= SUSPEND_MM, shouldResume = cur === 2 && median < RESUME_MM;
    const tag = shouldSuspend ? "🔴 建议停售" : shouldResume ? "🟢 建议恢复" : "⚪ 无动作";
    console.log(`${tag}  ${r.name}：明日降水中位 ${median.toFixed(1)}mm（ECMWF/GFS/ICON = ${f.models.map(v => v === null ? "缺" : v.toFixed(1)).join("/")}）· 链上 ${["正常", "加价", "停售"][cur]}`);
    if (shouldSuspend) {
      console.log(`   执行（两票）：${mscall("setUnderwriting", `${r.id} 2 ${premium} ${ethers.id("warning-watch suspend " + r.key + " " + new Date().toISOString().slice(0, 10))}`)}`);
      console.log(`   说明：level=2（RISK_SUSPENDED）期间该城 buyPolicy 直接 revert；在保保单不受影响。`);
    } else if (shouldResume) {
      console.log(`   执行（两票）：${mscall("setUnderwriting", `${r.id} 0 ${premium} ${ethers.id("warning-watch resume " + r.key + " " + new Date().toISOString().slice(0, 10))}`)}（保留现有有效保费，网格价优先）`);
    }
  }
  console.log(`（本脚本只读不动链；以上命令由两位 owner 各签一票后生效。挂 --watch 30（30 分钟一轮）可常巡。）`);
}

/* --watch 的分钟数：NaN / 0 / 负数会让 sleep(NaN) 立刻返回 ⇒ 零延迟死循环。
   与 push-rainfall-v5.js / keeper.js 同一套校验。 */
const watchMin = (() => {
  /* 两种写法都收：`--watch=30` 与 `--watch 30`。原本只认等号，而用法注释里写的是空格形式 ——
     照文档敲 `--watch 30` 会被静默当成「跑一轮就退」，常驻根本没挂上。
     写了 `--watch` 却漏值同样不许静默降级（那是「常驻看起来没生效」的经典现场事故）。 */
  const flagIdx = process.argv.indexOf("--watch");
  const eq = process.argv.find(a => a.startsWith("--watch="));
  if (eq === undefined && flagIdx < 0) return 0;            // 完全没写 --watch ⇒ 跑一轮就退
  const raw = eq !== undefined ? eq.slice(8) : (process.argv[flagIdx + 1] || "");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--watch= 需要一个正数分钟，收到：${JSON.stringify(raw)}`);
  return n;
})();
(async () => {
  do { await once(); if (watchMin) await new Promise(r => setTimeout(r, watchMin * 60000)); } while (watchMin);
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
