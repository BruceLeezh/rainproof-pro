/**
 * 定价网格的「值 ↔ 维度标签」回归测试
 * ============================================================================
 * 这个文件存在的原因（来源：2026-10-07 全仓只读审计 §二「表达层」/ §四 A5）：
 *
 *   仓里最有杀伤力的那类错不是算错，而是**同一个数被挂到不同的维度标签上** ——
 *   比如把「跨渠道价差」记成「地区风险极差」（放大 2.4 倍）、把 `cells[0]` 的单格值
 *   当成全表性质（198×）、把 72h 的触发率与 12h 的触发率并列。这些数字评委都能逐格
 *   复算出来，且仓里原有的门禁只校验「数值在合法范围内」，**不校验「值属于哪个维度」**。
 *
 *   所以这里读 `10-金融与定价/pricing-engine.json`（B 侧产物，A 只读不写），把
 *   「维度定义 → 值」的绑定钉死；任何一格与它的 hours / channel / riderTier / 档线
 *   不一致就红。**期望值全部写成本文件里的常量**，不引用 B 的任何脚本输出。
 *
 * 用法：node check-pricing-grid.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const R = path.join(__dirname, "..");
const ENGINE = path.join(R, "10-金融与定价", "pricing-engine.json");
const V3_SOL = path.join(R, "03-合约", "RainDeliveryInsuranceV3.sol");
const V3_ABI = path.join(R, "03-合约", "RainDeliveryInsuranceV3.abi.json");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  ✅ " + name); pass++; }
  catch (e) { console.log("  ❌ " + name + "\n       " + (e.message || e)); fail++; }
};

const E = JSON.parse(fs.readFileSync(ENGINE, "utf8"));
const cells = E.cells;
const num = (x) => Number(x);

// 国标 GB/T 28592—2012 表 1 的暴雨 / 大暴雨下限（mm）—— 写死在这里，不从产物读
const GB = { 12: [30, 70], 24: [50, 100] };
// v3 合约口径（与 03-合约/RainDeliveryInsuranceV3.sol 的常量一一对应）
const V3 = { minPremiumEth: 0.00002, premiumCapEth: 0.002, tierBps: [5000, 7500], hours: [12, 24] };

console.log("\n定价网格维度绑定 · pricing-engine.json ↔ 03-合约/RainDeliveryInsuranceV3.sol\n" + "=".repeat(72));

/* ---- 1. 结构：40 格 = 5 城 × 2 时长 × 4 段；批量带 6 档 ---- */
t("网格形状 = 40 格（5 城 × 2 时长 × 4 段）；批量档只在平台代付渠道展开", () => {
  assert.strictEqual(cells.length, 40, `格数应为 40，实际 ${cells.length}`);
  assert.strictEqual(new Set(cells.map((c) => c.regionId)).size, 5);
  assert.strictEqual(new Set(cells.map((c) => c.hours)).size, 2);
  assert.strictEqual(new Set(cells.map((c) => c.segId)).size, 4);
  for (const c of cells) {
    const ns = c.batch.map((b) => b.N);
    // 摊薄（逐格成本随批量下降）只对平台代付渠道成立：零售渠道一格只有 N=1
    assert.deepStrictEqual(ns, c.channel === 1 ? [1, 10, 50, 100, 500, 1000] : [1],
      `seg#${c.segId} channel=${c.channel} 批量档 = ${ns.join(",")}`);
  }
});

/* ---- 2. 档线：写在元数据上的表必须就是国标表，且每格与自己的 hours 对齐 ---- */
t("meta.thresholdsMm = 国标两档（12→30/70、24→50/100）", () => {
  assert.deepStrictEqual(E.meta.thresholdsMm["12"], GB[12]);
  assert.deepStrictEqual(E.meta.thresholdsMm["24"], GB[24]);
});

t("每一格的 thresholdsMm 等于它自己 hours 那一行（维度绑定，防串档）", () => {
  for (const c of cells) {
    assert.deepStrictEqual(c.thresholdsMm, GB[c.hours], `seg#${c.segId} hours=${c.hours} 的档线与 hours 不符`);
  }
});

/* ---- 3. 维度取值域：hours / channel / riderTier / segId ↔ (riderTier, channel) ---- */
t("hours 只有 12 / 24（v3 的 hoursAllowed；48/72 已退役）", () => {
  for (const c of cells) assert.ok(V3.hours.includes(c.hours), `hours=${c.hours} 不在 {12,24}`);
});

t("segId ↔ (riderTier, channel) 与 meta.segments 的定义逐格一致", () => {
  const def = new Map(E.meta.segments.map((s) => [s.id, s]));
  for (const c of cells) {
    const s = def.get(c.segId);
    assert.ok(s, `segId=${c.segId} 未在 meta.segments 里定义`);
    assert.strictEqual(c.riderTier, s.riderTier, `seg#${c.segId} riderTier`);
    assert.strictEqual(c.channel, s.channel, `seg#${c.segId} channel`);
    assert.strictEqual(c.segKey, s.key, `seg#${c.segId} segKey`);
  }
});

/* ---- 4. 价格带：零售价必须落在 [成本地板, 尊严上限] 内 ---- */
t("每格 costFloorEth ≤ premiumRetailEth ≤ premiumCapEth（0.002）", () => {
  for (const c of cells) {
    assert.ok(num(c.costFloorEth) <= num(c.premiumRetailEth) + 1e-12,
      `seg#${c.segId} ${c.regionKey} ${c.hours}h：${c.premiumRetailEth} < 地板 ${c.costFloorEth}`);
    assert.ok(num(c.premiumRetailEth) <= num(E.meta.economics.premiumCapEth) + 1e-12,
      `seg#${c.segId} ${c.regionKey} ${c.hours}h：${c.premiumRetailEth} > 上限 ${E.meta.economics.premiumCapEth}`);
  }
});

/* ---- 5. 逐格摊薄区间：审计里那个「198×」是单格值，不是全表性质 ---- */
t("平台代付渠道逐格摊薄倍数 ≥ 80（审计实测区间 83.7×～325.7×）", () => {
  const r = cells.filter((c) => c.channel === 1).map((c) => {
    const a = num(c.batch.find((b) => b.N === 1).costPerPolicyEth);
    const d = num(c.batch.find((b) => b.N === 1000).costPerPolicyEth);
    return a / d;
  });
  assert.strictEqual(r.length, 20, `平台代付格应为 20，实际 ${r.length}`);
  const lo = Math.min(...r), hi = Math.max(...r);
  console.log(`       → 逐格区间 ${lo.toFixed(1)}× ～ ${hi.toFixed(1)}×（均值 ${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(1)}×）`);
  assert.ok(lo >= 80, `最小摊薄倍数 ${lo.toFixed(1)}× 低于 80×：单格值不能再当全表性质`);
});

/* ---- 6. v3 合约常量必须与定价引擎同一口径（值 ↔ 合约 绑定）---- */
t("V3 合约常量与定价引擎口径一致（MIN_PREMIUM / 两档 / 时长）", () => {
  const sol = fs.readFileSync(V3_SOL, "utf8");
  const grab = (re) => { const m = sol.match(re); assert.ok(m, `合约里找不到 ${re}`); return m[1].replace(/[\s_]/g, ""); };
  const mp = grab(/MIN_PREMIUM\s*=\s*([0-9.]+)\s*ether/);
  // 先把「本文件常量 V3.minPremiumEth」与定价引擎产物绑死：否则下面那句报错会引用
  // 引擎字段，实际比对的却是本文件常量（文案与判据不是一回事，2026-10-12 第三轮 §1 F12）。
  assert.strictEqual(V3.minPremiumEth, Number(E.meta.economics.minPremiumAbsEth),
    `本文件常量 ${V3.minPremiumEth} ≠ 定价引擎 meta.economics.minPremiumAbsEth=${E.meta.economics.minPremiumAbsEth}`);
  assert.strictEqual(Number(mp), V3.minPremiumEth, `MIN_PREMIUM=${mp} 与定价引擎 ${E.meta.economics.minPremiumAbsEth} 不一致`);
  assert.strictEqual(Number(grab(/MIN_HOURS\s*=\s*(\d+)/)), 12);
  assert.strictEqual(Number(grab(/MAX_HOURS\s*=\s*(\d+)/)), 24);
  assert.strictEqual(Number(grab(/TIER_COUNT\s*=\s*(\d+)/)), 2);
  assert.deepStrictEqual(E.meta.tierBps, V3.tierBps, "引擎 tierBps 与 v3 的两档不一致");
  assert.strictEqual(Number(E.meta.economics.premiumCapEth), V3.premiumCapEth);
});

t("V3 ABI 里 v3 新增入口都在（buyFor / refundPolicy / pricingModule / openPoliciesOf）", () => {
  const abi = JSON.parse(fs.readFileSync(V3_ABI, "utf8"));
  const names = new Set(abi.filter((x) => x.type === "function").map((x) => x.name));
  for (const f of ["buyFor", "refundPolicy", "setPricingModule", "pricingModule", "openPoliciesOf", "quoteOf", "entryThresholdOf"]) {
    assert.ok(names.has(f), `ABI 里缺 ${f}`);
  }
});

/* ---- 7. 只报不判：审计点名的两个「单格当全局」锚点 ---- */
console.log("  ℹ️  锚点（只报不判，供对外材料引用时连维度一起写）：");
{
  const mins = cells.reduce((a, c) => (num(c.premiumRetailEth) < num(a.premiumRetailEth) ? c : a));
  const maxs = cells.reduce((a, c) => (num(c.premiumRetailEth) > num(a.premiumRetailEth) ? c : a));
  console.log(`       零售价 min ${mins.premiumRetailEth}（${mins.regionKey} ${mins.hours}h ${mins.segKey}）`);
  console.log(`       零售价 max ${maxs.premiumRetailEth}（${maxs.regionKey} ${maxs.hours}h ${maxs.segKey}）  = 上限的 1/${(num(E.meta.economics.premiumCapEth) / num(maxs.premiumRetailEth)).toFixed(3)}`);
  const c0 = cells[0];
  const r0 = num(c0.batch.find((b) => b.N === 1).costPerPolicyEth) / num(c0.batch.find((b) => b.N === 1000).costPerPolicyEth);
  console.log(`       cells[0]（${c0.regionKey} ${c0.hours}h ${c0.segKey}）摊薄 ${r0.toFixed(1)}× —— 「198×」是这一格，不是全表`);
}

console.log("=".repeat(72));
console.log(`结果：${pass} 项通过 / ${fail} 项失败\n`);
process.exit(fail ? 1 : 0);
