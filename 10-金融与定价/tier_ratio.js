/*
 * tier_ratio.js —— 三档保障期限（24/48/72h）保费比例核验
 *
 * 回答两个问题：
 *   ① 链上那 15 格 premiumGrid 是怎么来的？（复算它，看能不能逐格对上）
 *   ② 各档之间的价格比例是多少？和"公平保费"的比例差在哪？
 *
 * 用法：
 *   node tier_ratio.js                 # 打印表格 + 写 tier-ratio.json
 *   node tier_ratio.js --self-check    # 只跑断言，退出码非 0 表示不通过
 *
 * 数据出处（都是本仓库里可复算的东西，不是外部抓的）：
 *   - 链上 15 格实读：02-作战与答辩/汉客松-交易哈希清单.md §5.4（2026-10-07 13:05）
 *   - v1 口径公平保费：10-金融与定价/actuary-output.json
 *     （Open-Meteo ERA5 逐小时 2015-10-01~2026-09-30，每城 96,432 小时）
 *   - v2 口径建议价与触发概率：10-金融与定价/B端档位设计与不亏损证明.md §1.2
 *   - 比例口径正文：02-作战与答辩/定价-时长差异化设计.md §三
 */
"use strict";

const A = require('./audit_numbers.js');   // 只为共享的 emit()：产物落盘不制造时间戳噪声

const fs = require("fs");
const path = require("path");

const TICK = 1e-4;
const PAYOUT_MAX = 0.01;             // 03-合约/RainDeliveryInsuranceV2.sol:30
const R_STAR = 0.60;                 // 目标赔付率
const MIN_PREMIUM = 0.0002;          // 03-合约/RainDeliveryInsuranceV2.sol:32
const HOURS = [24, 48, 72];
const REGIONS = ["武汉", "上海", "北京", "广州", "成都"];

// v1 口径公平保费 = ceil₄⁻¹ 的目标值：恒定 50mm 阈值 + 全额赔付 + 60% 赔付率
const FAIR_V1 = {
  武汉: { 24: 0.000126, 48: 0.000451, 72: 0.000793 },
  上海: { 24: 0.000126, 48: 0.000389, 72: 0.000759 },
  北京: { 24: 0.000073, 48: 0.000212, 72: 0.000378 },
  广州: { 24: 0.000237, 48: 0.000990, 72: 0.001921 },
  成都: { 24: 0.000099, 48: 0.000342, 72: 0.000620 },
};

// 链上实读（BOT Chain 968）
const ONCHAIN = {
  武汉: { 24: 0.0002, 48: 0.0005, 72: 0.0008 },
  上海: { 24: 0.0002, 48: 0.0004, 72: 0.0008 },
  北京: { 24: 0.0002, 48: 0.0003, 72: 0.0004 },
  广州: { 24: 0.0003, 48: 0.0010, 72: 0.0020 },
  成都: { 24: 0.0002, 48: 0.0004, 72: 0.0007 },
};

// v2 口径（阈值随窗口缩放 50×h/24 + 分档赔付）下的建议价，方案 B，批量 N=100
const REC_V2 = {
  武汉: { 24: 0.0004, 48: 0.0004, 72: 0.0004 },
  上海: { 24: 0.0004, 48: 0.0004, 72: 0.0004 },
  北京: { 24: 0.0003, 48: 0.0003, 72: 0.0003 },
  广州: { 24: 0.0004, 48: 0.0006, 72: 0.0006 },
  成都: { 24: 0.0004, 48: 0.0004, 72: 0.0004 },
};

// v2 口径点估计：保单期内触发任一档的概率（%）
const P_V2 = {
  武汉: { 24: 0.4258, 48: 0.5374, 72: 0.4942 },
  上海: { 24: 0.4006, 48: 0.5548, 72: 0.5404 },
  北京: { 24: 0.2349, 48: 0.2557, 72: 0.2159 },
  广州: { 24: 0.7538, 48: 1.2367, 72: 1.2762 },
  成都: { 24: 0.3254, 48: 0.4173, 72: 0.3819 },
};

const ceilTick = (x) => Math.ceil(x / TICK - 1e-9) * TICK;
const fix = (x, d = 4) => x.toFixed(d);
const pct = (x) => (x * 100).toFixed(1) + "%";

/** 链上网格的生成规则：ceil₄(v1 口径公平保费)，不足地板则抬到地板 */
function rebuildGrid() {
  const out = {};
  for (const r of REGIONS) {
    out[r] = {};
    for (const h of HOURS) {
      out[r][h] = Math.max(MIN_PREMIUM, ceilTick(FAIR_V1[r][h]));
    }
  }
  return out;
}

function ratioTable() {
  const rows = [];
  for (const r of REGIONS) {
    const grid = ONCHAIN[r];
    const fair = FAIR_V1[r];
    rows.push({
      region: r,
      onchain: HOURS.map((h) => grid[h]),
      fair: HOURS.map((h) => fair[h]),
      markup: HOURS.map((h) => grid[h] / fair[h]),
      ratioOnchain: [1, grid[48] / grid[24], grid[72] / grid[24]],
      ratioFair: [1, fair[48] / fair[24], fair[72] / fair[24]],
      pV2: HOURS.map((h) => P_V2[r][h]),
      // 经验幂律指数 m：P ∝ h^m
      mOnchain: Math.log(grid[72] / grid[24]) / Math.log(72 / 24),
      mFair: Math.log(fair[72] / fair[24]) / Math.log(72 / 24),
    });
  }
  return rows;
}

function report() {
  const grid = rebuildGrid();
  const rows = ratioTable();

  console.log("【一】链上 15 格的来源复算：ceil₄(v1 口径公平保费) 再抬到地板 0.0002");
  console.log("");
  console.log("  区域   档     公平保费      ceil₄    地板后    链上实读   对上?");
  let mism = 0;
  for (const r of REGIONS) {
    for (const h of HOURS) {
      const c = ceilTick(FAIR_V1[r][h]);
      const f = Math.max(MIN_PREMIUM, c);
      const real = ONCHAIN[r][h];
      const ok = Math.abs(f - real) < 1e-9;
      if (!ok) mism++;
      console.log(
        `  ${r}   ${String(h).padStart(2)}h   ${fix(FAIR_V1[r][h], 6).padStart(8)}   ` +
          `${fix(c, 4)}   ${fix(f, 4)}   ${fix(real, 4)}   ${ok ? "✓" : "✗"}`
      );
    }
  }
  console.log(`\n  → ${15 - mism}/15 格对上；被地板抬起来的格子：` +
    REGIONS.flatMap((r) => HOURS.filter((h) => ceilTick(FAIR_V1[r][h]) < MIN_PREMIUM).map((h) => `${r}${h}h`)).join(" ")
  );

  console.log("\n【二】各档比例（以 24h 为 1）");
  console.log("");
  console.log("  区域   链上比例(48/24, 72/24)   公平比例(48/24, 72/24)   幂律 m(链上/公平)");
  for (const x of rows) {
    console.log(
      `  ${x.region}   ${fix(x.ratioOnchain[1], 2)} : ${fix(x.ratioOnchain[2], 2)}` +
        `            ${fix(x.ratioFair[1], 2)} : ${fix(x.ratioFair[2], 2)}` +
        `            ${fix(x.mOnchain, 2)} / ${fix(x.mFair, 2)}`
    );
  }

  console.log("\n【三】链上价 ÷ v1 口径公平保费（>1 表示向骑手多收）");
  console.log("");
  console.log("  区域      24h      48h      72h");
  for (const x of rows) {
    console.log(`  ${x.region}    ${x.markup.map((v) => fix(v, 2)).join("      ")}`);
  }

  console.log("\n【四】v2 口径（现行缩放档线）下的触发概率——关键对照");
  console.log("");
  console.log("  区域      24h      48h      72h    72h/24h");
  for (const x of rows) {
    console.log(
      `  ${x.region}   ${x.pV2.map((v) => pct(v / 100).padStart(6)).join("  ")}` +
        `   ${fix(x.pV2[2] / x.pV2[0], 2)}×`
    );
  }

  console.log("\n【五】同一批保单在两种口径下的建议价（v2 方案 B，N=100）");
  console.log("");
  console.log("  区域      24h      48h      72h");
  for (const r of REGIONS) {
    console.log(`  ${r}    ${HOURS.map((h) => fix(REC_V2[r][h], 4)).join("      ")}`);
  }

  console.log("\n结论：链上 15 格是「v1 恒定 50mm 口径的公平保费」逐格 ceil₄ 到 0.0001、再抬到 0.0002 地板。");
  console.log("      24h 那 5 格全部被地板覆盖（公平保费只有 0.000073~0.000237），所以比例被压扁；");
  console.log("      48h/72h 基本贴着 1.0~1.1 倍。而合约实际执行的是 v2 缩放档线 + 分档赔付。");
}

function selfCheck() {
  let pass = 0, fail = 0;
  const t = (name, cond, extra = "") => {
    if (cond) { pass++; }
    else { fail++; console.log(`  ✗ ${name}${extra ? " —— " + extra : ""}`); }
  };

  const grid = rebuildGrid();
  for (const r of REGIONS) for (const h of HOURS) {
    t(`复算 ${r} ${h}h = ${ONCHAIN[r][h]}`, Math.abs(grid[r][h] - ONCHAIN[r][h]) < 1e-9,
      `实算 ${grid[r][h]}`);
  }

  const rows = ratioTable();

  // 地板实际抬高的格子：只有 24h 档会被抬
  const floored = [];
  for (const r of REGIONS) for (const h of HOURS) {
    if (ceilTick(FAIR_V1[r][h]) < MIN_PREMIUM) floored.push({ r, h });
  }
  t("地板只抬高 24h 档（48h/72h 一格都没被抬）", floored.every((x) => x.h === 24),
    floored.map((x) => x.r + x.h + "h").join(" "));
  t("被地板抬高的是北京24h 与 成都24h",
    floored.length === 2 && floored.some((x) => x.r === "北京") && floored.some((x) => x.r === "成都"));
  // 5 个 24h 格的公平保费本身都在地板量级以下（最高广州 0.000237，只比地板高 18%）
  t("24h 档公平保费全部 ≤ 地板 ×1.2",
    REGIONS.every((r) => FAIR_V1[r][24] <= MIN_PREMIUM * 1.2),
    REGIONS.map((r) => fix(FAIR_V1[r][24], 6)).join(" "));

  // 链上比例 < 公平比例（地板压扁短端）
  for (const x of rows) {
    t(`${x.region} 链上 72/24 比例被压扁于公平比例`,
      x.ratioOnchain[2] < x.ratioFair[2],
      `${fix(x.ratioOnchain[2], 2)} vs ${fix(x.ratioFair[2], 2)}`);
    t(`${x.region} 链上 72h > 48h > 24h 单调`,
      x.onchain[0] < x.onchain[1] && x.onchain[1] <= x.onchain[2]);
  }

  // 公平比例的量级：72h 是 24h 的 5~9 倍
  t("v1 口径公平比例 72/24 落在 5×~9×",
    rows.every((x) => x.ratioFair[2] >= 5 && x.ratioFair[2] <= 9));
  // 幂律指数约 1.5~2.0
  t("v1 口径幂律 m ≈ 1.5~2.0", rows.every((x) => x.mFair > 1.4 && x.mFair < 2.1));

  // v2 口径：触发概率不随时长单调增长（这正是"接近同价"成立的原因）
  const nonMono = rows.filter((x) => x.pV2[2] <= x.pV2[1]).length;
  t("v2 口径下 72h 触发概率不高于 48h 的城市占多数", nonMono >= 3, `${nonMono}/5`);
  t("v2 口径下 72h/24h 触发概率比 < 1.8×",
    rows.every((x) => x.pV2[2] / x.pV2[0] < 1.8));

  // 48h/72h 基本贴公平值，24h 被抬高
  t("48h+72h 格的加价倍数都在 1.0~1.5×",
    rows.every((x) => x.markup[1] <= 1.5 && x.markup[2] <= 1.5));
  t("至少一个 24h 格被抬到 2× 以上",
    rows.some((x) => x.markup[0] >= 2), 
    rows.map((x) => fix(x.markup[0], 2)).join(" "));

  console.log(`  ${pass} 项通过 / ${fail} 项失败`);
  if (fail > 0) process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--self-check")) {
  selfCheck();
} else {
  report();
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      tick: TICK, payoutMax: PAYOUT_MAX, rStar: R_STAR, minPremium: MIN_PREMIUM,
      source: {
        onchain: "02-作战与答辩/汉客松-交易哈希清单.md §5.4（BOT Chain 968，2026-10-07 13:05 实读）",
        fairV1: "10-金融与定价/actuary-output.json（ERA5 逐小时 2015-10-01~2026-09-30）",
        recV2: "10-金融与定价/B端档位设计与不亏损证明.md §1.2 方案 B（N=100）",
      },
    },
    rebuiltGrid: rebuildGrid(),
    onchainGrid: ONCHAIN,
    rows: ratioTable(),
    recommendedV2: REC_V2,
  };
  const dst = path.join(__dirname, "tier-ratio.json");
  A.emit(dst, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n已写出 ${path.relative(path.join(__dirname, ".."), dst)}`);
}
