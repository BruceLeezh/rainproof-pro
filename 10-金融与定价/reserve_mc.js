#!/usr/bin/env node
/**
 * 准备金下限的量化：块自助法（block bootstrap）
 * ============================================================================
 *
 * 【这份脚本补的是哪一块】
 *   `精算口径.md` §6.3 给出了准备金的**规则**：
 *       reserve ≥ Σ_区域 ( 该区域在保保单数 × PAYOUT )   ← 总和口径
 *   （早期版本把这里写成 `max over regions`，与 §6.3 的操作步骤 `setReserve(N × 0.01)`
 *     以及 v2 已落地的 `openExposure`（`03-合约/RainDeliveryInsuranceV2.sol:118/238/451-452`）
 *     不一致，已于 2026-10-07 统一为总和口径。）
 *   那条规则是「覆盖最大同时敞口」的**最坏情形上界**，
 *   没有回答「一个月到底会亏多少、亏的概率多大」。
 *
 *   本脚本用同一份 11 年逐小时缓存，把准备金的**分布**算出来：
 *       P(当月亏损)、VaR95、VaR99 —— 从而给出可辩护的 reserve 数字，
 *       而不是拍一个「几倍敞口」的系数。
 *
 * 【方法：为什么用块自助法而不是独立抽样】
 *   降雨有很强的时间聚集性 —— 暴雨集中在几天内连着来，不是独立事件。
 *   如果按日独立抽样，会人为打散这种聚集，**系统性低估尾部风险**。
 *   所以每次随机取一个连续的 30 天块，在块内放 N 份保单：
 *   块内保留了真实的天气连续性，块与块之间才是独立重抽。
 *
 * 【口径】
 *   - 窗口：与 `精算口径.md` 一致，用滑动窗口（任意起点开保）
 *   - 保费/赔付：PREMIUM 0.001 ETH / PAYOUT 0.01 ETH（现链上演示值）
 *   - 逐小时缓存来自 `actuary.js`，本脚本不联网
 *
 * 【已知低估方向，必须主动讲】
 *   5 个城市各自独立抽块，等于假设城市间降雨不相关。
 *   真实情形是同一套天气系统可以同时打武汉和上海（长江中下游梅雨）。
 *   城市间正相关会让尾部更肥 → **本脚本的 VaR 是真实所需准备金的偏低估计**。
 *   方向明确，不改变结论（24h 有巨大余量、广州 72h 不可承保），
 *   但答辩被追问「准备金够不够」时应答「这是下界」。
 *
 * 【可复现性】
 *   随机数用固定种子的 mulberry32（默认 seed 42），因此
 *   **同数据 + 同脚本 + 同参数 → 逐位一致的 `reserve-mc-output.json`**。
 *   这和我们要求别人做到的事一致（`check-ai.js` 在验「同一输入 → 同一 outputHash」），
 *   自己的蒙特卡洛也必须可复现，否则对外只能讲区间、不能讲点值。
 *
 * 用法：
 *   node reserve_mc.js              # 用 cache/ 里的缓存（首次需先跑 actuary.js），种子 42
 *   node reserve_mc.js --sim 10000  # 增加模拟次数
 *   node reserve_mc.js --seed 7     # 换种子（默认 42；换种子可当"抽样不确定性"的敏感性检验）
 */

const fs = require("fs");
const path = require("path");
const { REGIONS } = require("../04-脚本/regions.js");

const PREMIUM = 0.001; // ETH，与合约 PREMIUM 一致
const PAYOUT = 0.01; // ETH，与合约 PAYOUT 一致
const THRESHOLD = 50; // mm
const BLOCK_DAYS = 30;
const CACHE_DIR = path.join(__dirname, "cache");

// 保单时长档位。24h 是「一天的损失暴露」（见 参数推导.md §4.1），72h 是合约上限。
const DURATIONS = [24, 72];
const POLICY_COUNTS = [50, 100, 200, 400];

const argv = process.argv.slice(2);
const SIMS = Number((argv[argv.indexOf("--sim") + 1] || "").trim()) || 3000;

// 固定种子的 PRNG（mulberry32）。未固定种子之前，同数据两次运行的「最坏月」
// 能差 0.1–0.2 ETH，第三方无法复核 —— 与我们主打的「可复算」自相矛盾。
const SEED = Number((argv[argv.indexOf("--seed") + 1] || "").trim()) || 42;
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);

/** 读取 actuary.js 落下的逐小时缓存。返回 {time:[], precip:[]} */
function loadHourly(region) {
  if (!fs.existsSync(CACHE_DIR)) {
    throw new Error(
      `找不到缓存目录 ${CACHE_DIR}\n` +
        `请先在 10-金融与定价/ 下跑一次：node actuary.js`,
    );
  }
  const files = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith(region.key + "-") && f.endsWith(".json"));
  if (!files.length) {
    throw new Error(`缓存里没有 ${region.key} 的数据，请先跑 node actuary.js`);
  }
  const raw = JSON.parse(
    fs.readFileSync(path.join(CACHE_DIR, files[0]), "utf8"),
  );
  return { time: raw.hourly.time, precip: raw.hourly.precipitation };
}

/**
 * 逐小时滑动的 H 小时累计。返回与 time 等长的数组：
 * out[i] = 以第 i 小时为起点、未来 H 小时的累计（不足 H 小时或含缺测则为 null）
 */
function rollingSum(precip, hours) {
  const n = precip.length;
  const out = new Array(n).fill(null);
  let win = 0;
  let bad = 0;
  for (let i = 0; i < hours; i++) {
    const v = precip[i];
    if (v === null || v === undefined) bad++;
    else win += v;
  }
  for (let i = 0; i + hours <= n; i++) {
    if (i > 0) {
      const out_ = precip[i - 1];
      const in_ = precip[i + hours - 1];
      if (out_ === null || out_ === undefined || in_ === null || in_ === undefined) {
        bad++;
      } else {
        win += in_ - out_;
      }
    }
    out[i] = bad === 0 ? win : null;
  }
  return out;
}

/**
 * 单城市：N 份保单在一个 30 天块内的赔付分布。
 * 保单起点在块内均匀分布（小时粒度），判定用该起点的 H 小时滑动累计。
 */
function simulate(sim, hoursPerDay) {
  const { rolling, totalHours } = sim;
  const blocksPerDay = 24;
  const blockHours = BLOCK_DAYS * blocksPerDay;
  // 可用的块起点（小时粒度），保证块内任何起点都有完整的 H 小时窗口
  const maxStart = totalHours - hoursPerDay - blockHours;
  if (maxStart <= 0) return null;

  const losses = [];
  let triggerTotal = 0;

  for (let s = 0; s < SIMS; s++) {
    const base = Math.floor(rnd() * maxStart);
    let hits = 0;
    for (let p = 0; p < sim.nPolicies; p++) {
      const idx = base + Math.floor(rnd() * blockHours);
      const v = rolling[idx];
      if (v !== null && v >= THRESHOLD) hits++;
    }
    triggerTotal += hits;
    losses.push(hits * PAYOUT - sim.nPolicies * PREMIUM);
  }

  losses.sort((a, b) => a - b);
  const q = (a) => losses[Math.min(losses.length - 1, Math.floor(a * losses.length))];
  const mean = losses.reduce((x, y) => x + y, 0) / losses.length;

  return {
    E_trigger_pct: (100 * triggerTotal) / SIMS / sim.nPolicies,
    E_loss_eth: mean,
    P_loss_gt0: losses.filter((x) => x > 1e-12).length / losses.length,
    VaR95_eth: q(0.95),
    VaR99_eth: q(0.99),
    max_eth: losses[losses.length - 1],
  };
}

function fmt(x, d = 4) {
  return x.toFixed(d);
}

function main() {
  console.log("=".repeat(78));
  console.log(
    `准备金量化 · 块自助法（${BLOCK_DAYS} 天块 × ${SIMS} 次）  ` +
      `赔 ${PAYOUT} / 保 ${PREMIUM} ETH · 阈值 ${THRESHOLD}mm`,
  );
  console.log("=".repeat(78));

  const data = {};
  for (const r of REGIONS) {
    const h = loadHourly(r);
    data[r.key] = h;
    console.log(
      `[${r.name}] ${h.time.length} 小时  ${h.time[0]} .. ${h.time[h.time.length - 1]}`,
    );
  }

  const out = {};
  for (const H of DURATIONS) {
    const hoursPerDay = H; // H 小时窗口，本身就以小时计
    console.log(`\n──── 保单时长 ${H} 小时 ────`);
    console.log(
      `  ${"城市".padEnd(6)}${"N".padEnd(6)}${"E[触发率]".padEnd(12)}` +
        `${"E[赔付]".padEnd(12)}${"P(当月亏损)".padEnd(14)}` +
        `${"VaR95".padEnd(10)}${"VaR99".padEnd(10)}${"最坏"}`,
    );

    const rollingByRegion = {};
    for (const r of REGIONS) {
      rollingByRegion[r.key] = {
        rolling: rollingSum(data[r.key].precip, hoursPerDay),
        totalHours: data[r.key].precip.length,
      };
    }

    // 逐城市
    for (const r of REGIONS) {
      const sim0 = rollingByRegion[r.key];
      for (const N of POLICY_COUNTS) {
        const res = simulate({ ...sim0, nPolicies: N }, hoursPerDay);
        if (!res) continue;
        out[`${r.key}_H${H}_N${N}`] = res;
        if (N === 200) {
          const mark = res.P_loss_gt0 > 0.05 ? "  <<< 常亏" : "";
          console.log(
            `  ${r.name.padEnd(6)}${String(N).padEnd(6)}` +
              `${(res.E_trigger_pct.toFixed(3) + "%").padEnd(12)}` +
              `${fmt(res.E_loss_eth).padEnd(12)}` +
              `${(100 * res.P_loss_gt0).toFixed(2).padStart(6)}%`.padEnd(14) +
              `${fmt(res.VaR95_eth).padEnd(10)}${fmt(res.VaR99_eth).padEnd(10)}` +
              `${fmt(res.max_eth)}${mark}`,
          );
        }
      }
    }

    // 5 城等权混合组合（每城 N/5 份）
    for (const N of POLICY_COUNTS) {
      const sub = Math.floor(N / REGIONS.length);
      const losses = [];
      let triggerTotal = 0;
      const perRegion = {};
      for (const r of REGIONS) {
        perRegion[r.key] = rollingByRegion[r.key];
      }
      const maxStarts = {};
      for (const r of REGIONS) {
        const t = perRegion[r.key].totalHours;
        maxStarts[r.key] = t - hoursPerDay - BLOCK_DAYS * 24;
      }
      for (let s = 0; s < SIMS; s++) {
        let hits = 0;
        for (const r of REGIONS) {
          const { rolling } = perRegion[r.key];
          const base = Math.floor(rnd() * maxStarts[r.key]);
          for (let p = 0; p < sub; p++) {
            const idx = base + Math.floor(rnd() * BLOCK_DAYS * 24);
            const v = rolling[idx];
            if (v !== null && v >= THRESHOLD) hits++;
          }
        }
        triggerTotal += hits;
        losses.push(hits * PAYOUT - N * PREMIUM);
      }
      losses.sort((a, b) => a - b);
      const q = (a) =>
        losses[Math.min(losses.length - 1, Math.floor(a * losses.length))];
      const res = {
        E_trigger_pct: (100 * triggerTotal) / SIMS / N,
        E_loss_eth: losses.reduce((x, y) => x + y, 0) / losses.length,
        P_loss_gt0: losses.filter((x) => x > 1e-12).length / losses.length,
        VaR95_eth: q(0.95),
        VaR99_eth: q(0.99),
        max_eth: losses[losses.length - 1],
      };
      out[`_mix_H${H}_N${N}`] = res;
      console.log(
        `  ${"5城混合".padEnd(6)}${String(N).padEnd(6)}` +
          `${(res.E_trigger_pct.toFixed(3) + "%").padEnd(12)}` +
          `${fmt(res.E_loss_eth).padEnd(12)}` +
          `${(100 * res.P_loss_gt0).toFixed(2).padStart(6)}%`.padEnd(14) +
          `${fmt(res.VaR95_eth).padEnd(10)}${fmt(res.VaR99_eth).padEnd(10)}` +
          `${fmt(res.max_eth)}`,
      );
    }
  }

  // 结论：把 VaR99 翻译成「每份保单要预留多少」
  console.log("\n" + "=".repeat(78));
  console.log("结论：折算成「每份在保保单要预留多少准备金」（VaR99 口径）");
  console.log("=".repeat(78));
  console.log(
    `  ${"组合".padEnd(12)}${"N".padEnd(6)}${"VaR99(ETH)".padEnd(14)}` +
      `${"每份预留".padEnd(14)}${"÷保费"}`,
  );
  for (const H of DURATIONS) {
    for (const N of POLICY_COUNTS) {
      const r = out[`_mix_H${H}_N${N}`];
      if (!r) continue;
      const perPolicy = r.VaR99_eth / N;
      console.log(
        `  ${("混合 " + H + "h").padEnd(12)}${String(N).padEnd(6)}` +
          `${fmt(r.VaR99_eth).padEnd(14)}` +
          `${perPolicy.toFixed(6).padEnd(14)}` +
          `${(perPolicy / PREMIUM).toFixed(2)}×`,
      );
    }
  }

  const outPath = path.join(__dirname, "reserve-mc-output.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`\n-> ${outPath}`);
}

if (require.main === module) main();
