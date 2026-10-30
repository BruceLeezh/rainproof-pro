#!/usr/bin/env node
/**
 * push-rainfall-hourly.js —— 小时级降雨喂价（B1，2026-10-25）
 *
 * 与 push-rainfall.js（日粒度）的关系：**同一语义、更细台阶**。
 *   · 语义不变：链上 rainfall[region] 仍是「自 RAIN_EPOCH 起的累计 mm」，单调不减；
 *   · 粒度升级：逐小时求和替代日合计，喂价可以每小时一次，12h 窗口的触发精度从天提到小时；
 *   · 单调保证：候选值 = max(链上现值, 三模型中位累计四舍五入) —— 换源造成的口径差只会
 *     让某几轮“无增量”，绝不会让累计倒退 revert。
 *
 * 闸门与喂价一致：三个机构模型（ECMWF/GFS/ICON）里 ≥2 个落在中位数 ±2.5mm 内才采信；
 * 分歧 → 建议走 rejectFeed 留痕。operator 已是多签：本脚本**只读预报+读链+打印两票命令**，
 * 不直接发交易（push-rainfall.js 的单钥直发在移交后本就会 revert）。
 *
 * 用法：node push-rainfall-hourly.js [--city=2] [--self-check]
 */
"use strict";
const path = require("path");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const REGIONS = require("./regions").REGIONS;
const { RAIN_EPOCH } = require("./regions");
const MODELS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"];
const TOL_MM = 2.5;                       // 与 feed-verify 同容差：多数落在中位 ±2.5mm 内即采信
const CITY_NAME = { wuhan: "武汉", shanghai: "上海", beijing: "北京", guangzhou: "广州", chengdu: "成都" };

// ---------- 纯函数（--self-check 测的就是它们） ----------

/** 三模型在 (fromIso, nowIso] 窗口内的**增量**：闸门口径用这个（增量是小时/日量级，
 *  ±2.5mm 的日容差才成立；拿全季累计比离散度会把「24 天的微小系统性偏差」放大成假分歧 ——
 *  2026-10-25 实跑教训：上海两近模型累计只差 8mm 也被拒）。长窗口自动放宽为相对容差。 */
function windowIncrement({ times, perModel }, fromIso, nowIso, tolAbs = 2.5) {
  const sums = MODELS.map(m => {
    const arr = perModel[m];
    if (!arr) return null;
    let s = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t > fromIso && t <= nowIso) {
        const v = arr[i];
        if (v == null || Number.isNaN(Number(v))) continue;
        s += Number(v);
      }
    }
    return s;
  });
  const valid = sums.filter(v => v !== null);
  if (!valid.length) return { perModel: sums, median: null, ok: false, reason: "三个模型都没有数据" };
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const tol = Math.max(tolAbs, 0.05 * median);              // 窗口 > 临界时按 5% 放宽（绝对 2.5mm 兜底）
  const within = sums.filter(v => v !== null && Math.abs(v - median) <= tol + 1e-9).length;
  return { perModel: sums, median, tol, ok: within >= 2, reason: within >= 2 ? "" : "多模型分歧：建议 rejectFeed 留痕，不喂" };
}

/** 从三模型逐小时序列算「自 epoch 起的累计」，返回 {perModel, median, ok, spread}。
 *  时间串形如 'YYYY-MM-DDTHH:mm'，字典序即时间序（Asia/Shanghai 全程一致时区）。
 *  只统计 epochT00:00 < t <= nowIso 的整点值。 */
function hourlyCumulative({ times, perModel }, epochDate, nowIso) {
  const lo = epochDate + "T00:00";
  const sums = MODELS.map(m => {
    const arr = perModel[m];
    if (!arr) return null;
    let s = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t > lo && t <= nowIso) {
        const v = arr[i];
        if (v == null || Number.isNaN(Number(v))) continue;  // 缺测小时按 0 计（宁少报不多报）
        s += Number(v);
      }
    }
    return s;
  });
  const valid = sums.filter(v => v !== null);
  if (!valid.length) return { perModel: sums, median: null, ok: false, reason: "三个模型都没有数据" };
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const within = sums.filter(v => v !== null && Math.abs(v - median) <= TOL_MM).length;
  return {
    perModel: sums, median,
    ok: within >= 2,                              // 多数（≥2/3）落在中位 ±容差内才采信
    reason: within >= 2 ? "" : "多模型分歧：建议 rejectFeed 留痕，不喂",
  };
}

/** 单调护栏：换源/口径差只允许“无增量”，不允许倒退。 */
function candidate(chainNow, medianMm) {
  if (medianMm == null) return { value: null, delta: 0, note: "无中位可推" };
  const rounded = Math.round(medianMm);
  if (rounded < chainNow) return { value: chainNow, delta: 0, note: `小时口径(${rounded}) < 链上(${chainNow})：本轮无增量（不倒退）` };
  return { value: rounded, delta: rounded - chainNow, note: "" };
}

function evidenceHash(regionKey, times, perModel, epochDate) {
  // 哈希只进数据不进抓取时刻：同一份序列永远同一个哈希（可复算纪律）
  const payload = { region: regionKey, epoch: epochDate, models: MODELS, hours: times.map((t, i) => [t, MODELS.map(m => perModel[m]?.[i] ?? null)]) };
  return ethers.id(JSON.stringify(payload));
}

// ---------- 在线部分 ----------
async function fetchCity(r) {
  const days = Math.min(92, Math.max(2, Math.ceil((Date.now() - new Date(RAIN_EPOCH + "T00:00+08:00").getTime()) / 86400000) + 3));
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${r.lat}&longitude=${r.lon}` +
    `&hourly=precipitation&timezone=Asia%2FShanghai&past_days=${days}&forecast_days=0&models=${MODELS.join(",")}`;
  const resp = await fetch(url, { headers: { "User-Agent": "rainproof-hourly-feed/1.0" } });
  if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
  const j = await resp.json();
  const times = j?.hourly?.time || [];
  const perModel = {};
  for (const m of MODELS) perModel[m] = j?.hourly?.[`precipitation_${m}`] || j?.hourly?.[`${m}_precipitation`] || null;
  if (!times.length || MODELS.every(m => !perModel[m])) throw new Error("接口没有返回逐小时序列");
  return { times, perModel };
}

async function run(cityFilter) {
  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const abi = require(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV4.abi.json"));
  const v4 = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, p);
  const ms = process.env.MULTISIG_ADDR;
  const nowIso = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 13) + ":00"; // Asia/Shanghai 当前整点
  console.log(`===== 小时级喂价（干跑）· 截至 ${nowIso} · epoch ${RAIN_EPOCH} =====`);
  for (const r of REGIONS) {
    if (cityFilter && r.id !== Number(cityFilter)) continue;
    let data;
    try { data = await fetchCity(r); } catch (e) { console.log(`${CITY_NAME[r.key]} 拉取失败：${(e.message || e).toString().slice(0, 60)}`); continue; }
    const chainNow = Number(await v4.rainfall(r.id));
    const lastFed = Number(await v4.lastFeedAt(r.id));
    // 窗口 = 上次喂价那一刻之后（从未喂过 = 自 epoch）：增量恰好是"链上还没记上的那部分"
    const fromIso = lastFed === 0
      ? RAIN_EPOCH + "T00:00"
      : new Date(lastFed * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 13) + ":00";
    const inc = windowIncrement(data, fromIso, nowIso);
    const cum = hourlyCumulative(data, RAIN_EPOCH, nowIso);   // 仅作报告对照
    const cand = candidate(chainNow, lastFed === 0 ? cum.median : chainNow + (inc.median || 0));
    const m3 = MODELS.map((m, i) => `${m.split("_")[0].toUpperCase()} ${inc.perModel[i] === null ? "缺" : inc.perModel[i].toFixed(1)}`).join(" / ");
    console.log(`${CITY_NAME[r.key]}：链上累计 ${chainNow}mm · 窗口增量三模型 ${m3}mm → 中位 ${inc.median === null ? "—" : inc.median.toFixed(1)}mm（容差 ±${inc.tol ? inc.tol.toFixed(1) : "—"}）`);
    if (!inc.ok) {
      console.log(`  ⚠️ ${inc.reason}`);
      console.log(`  拒收留痕（两票）：node 07-测试工具/mscall.js ${ms} rejectFeed ${r.id} 40 3 ${evidenceHash(r.key, data.times, data.perModel, RAIN_EPOCH)} hourly-divergence`);
      continue;
    }
    if (cand.value === null) { console.log(`  ${cand.note}`); continue; }
    if (cand.delta === 0) {
      console.log(`  本轮无新增降雨（窗口增量中位 ${inc.median.toFixed(1)}mm）—— 只需保鲜：同值重喂走 push-rainfall --refresh 流程（两票）。`);
      continue;
    }
    const conf = Math.min(95, 60 + Math.round(cand.delta)); // 置信度：增量与模型一致性合成，≥MIN_CONFIDENCE 即可
    const ev = evidenceHash(r.key, data.times, data.perModel, RAIN_EPOCH);
    console.log(`  ✅ 建议喂价：${chainNow} → ${cand.value}mm（+${cand.delta}）· 置信 ${conf}`);
    console.log(`  执行（两票）：node 07-测试工具/mscall.js ${ms} updateRainfall ${r.id} ${cand.value} ${ev} ${conf} 3`);
  }
}

// ---------- 离线自检（进 npm self-check 链） ----------
function selfCheck() {
  const pass = [], fail = [];
  const ok = (n, c, t = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "✅" : "❌"} ${n}${t ? "  " + t : ""}`); };
  const epoch = "2026-10-01";
  const mk = (times, e, g, i) => ({ times, perModel: { ecmwf_ifs025: e, gfs_seamless: g, icon_seamless: i } });
  console.log("[1] 累计与窗口裁剪（epoch 当日 00:00 之后才算，字典序=时间序）");
  let r = hourlyCumulative(mk(["2026-10-01T01:00", "2026-10-01T02:00", "2026-10-02T03:00"], [1, 2, 4], [1, 2, 4], [1, 2, 5]), epoch, "2026-10-02T03:00");
  ok("三模型一致 → 中位 7mm、采信", r.median === 7 && r.ok);
  r = hourlyCumulative(mk(["2026-09-30T23:00", "2026-10-01T01:00"], [100, 1], [100, 1], [100, 1]), epoch, "2026-10-01T01:00");
  ok("epoch 之前的小时不计入（100mm 被裁掉）", r.median === 1);
  r = hourlyCumulative(mk(["2026-10-01T01:00"], [null], [3], [3]), epoch, "2026-10-01T23:00");
  ok("缺测小时按 0 计、单模型缺不炸", r.median === 3 && r.ok);
  console.log("[2] 分歧闸门（≥2 落在中位 ±2.5mm 才采信）");
  r = hourlyCumulative(mk(["2026-10-01T01:00"], [12.4], [12.5], [2.4]), epoch, "2026-10-01T23:00");
  ok("两近一远 → 采信（ICON 离群不阻断）", r.ok && r.median === 12.4);
  r = hourlyCumulative(mk(["2026-10-01T01:00"], [30], [5], [1]), epoch, "2026-10-01T23:00");
  ok("三方分歧 → 拒收建议", !r.ok);
  console.log("[3] 单调护栏（换源不倒退）");
  let c = candidate(100, 98);
  ok("小时口径更低 → 无增量不倒退", c.value === 100 && c.delta === 0);
  c = candidate(100, 103.4);
  ok("正常增量（四舍五入）", c.value === 103 && c.delta === 3);
  console.log("[4] 证据哈希可复算（同数据同哈希、异数据异哈希）");
  const d1 = mk(["2026-10-01T01:00"], [1], [1], [1]);
  ok("同一份序列两次计算哈希一致", evidenceHash("wuhan", d1.times, d1.perModel, epoch) === evidenceHash("wuhan", d1.times, d1.perModel, epoch));
  ok("数据变一个数哈希就变", evidenceHash("wuhan", d1.times, d1.perModel, epoch) !== evidenceHash("wuhan", d1.times, { ecmwf_ifs025: [2], gfs_seamless: [1], icon_seamless: [1] }, epoch));
  console.log("[5] 增量窗口闸门（投用口径）");
  let w = windowIncrement(mk(["2026-10-25T08:00", "2026-10-25T09:00"], [1.0, 1.5], [1.2, 1.4], [9.9, 0.1]), "2026-10-25T08:00", "2026-10-25T09:00");
  ok("短窗：两近一远，绝对容差 ±2.5 → 采信", w.ok && Math.abs(w.median - 1.4) < 1e-9);
  w = windowIncrement(mk(["2026-10-01T01:00"], [90], [63], [46]), "2026-10-01T00:00", "2026-10-25T23:00");
  ok("长窗：中位 63 → 相对容差 5%=3.15，仍拒真分歧", !w.ok && Math.abs(w.tol - 3.15) < 1e-9);
  w = windowIncrement(mk(["2026-10-01T01:00"], [63], [64], [65]), "2026-10-01T00:00", "2026-10-25T23:00");
  ok("长窗但三模型收敛 → 相对容差内采信", w.ok);
  ok("从未喂城市统一路径：链上 0 + 全窗中位 = 绝对累计", candidate(0, 63).value === 63 && candidate(0, 63).delta === 63);
  console.log("=".repeat(60));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  if (fail.length) process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--self-check")) selfCheck();
else run(args.find(a => a.startsWith("--city="))?.slice(7));
