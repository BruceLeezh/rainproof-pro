#!/usr/bin/env node
/**
 * pricing_engine.js —— 雨证 v3 五维差异化定价引擎
 * ============================================================================
 *
 * 【这个脚本解决什么】
 *   v2 的保费只有一个维度：`premiumGrid[regionId][hours]`（区域 × 时长 = 15 格）。
 *   但在真实的产品里，「同一场雨、同一天」对不同人应该收不同的钱 —— 因为
 *   投保的**时点**不同，风险就不同：
 *
 *     · 平台整批给在册骑手投保   → 投保时点与天气无关，期望赔付 = 无条件 p
 *     · 骑手在雨季想起来买        → 期望赔付 = 「雨季的 p」，比无条件 p 高一截
 *     · 骑手在预警发布后追加      → 期望赔付 = 「明知道要下」的 p，最高
 *     · 平台一次买 1000 份        → 一次判定覆盖整批，每份固定成本摊薄 1000 倍
 *
 *   所以差异化定价不是"搞点折扣"，而是**把投保时点的选择性算进去**。
 *
 * 【五个维度】
 *   1. 地区 region        气候风险（广州 vs 北京差 5 倍以上）
 *   2. 时长 hours         暴露时长（12/24 —— 国标 GB/T 28592-2012 唯二的两个时段）
 *   3. 用户类型 riderTier  众包自助 / 认证骑手 / 平台团体
 *   4. 使用场景 channel    自助投保 / 平台代付 / 预警增保
 *   5. 购买量 batch N      一次判定覆盖多少份
 *
 *   ⚠️ 3 与 4 不是两个独立的价格乘数，而是一张 3×3 的**合法性表**；每格映射到
 *   一条承保机制 + 一个参数。做成两个独立乘数会把同一份逆向选择算两遍。
 *
 * 【为什么只有一条承保机制：择时加权】
 *   月投保概率 w_m = (1-κ)/nM + κ·rate_m/Σrate，κ ∈ [0,1]。
 *   κ=1 是**用气候学（"买雨季"）能拿到的上限**——不需要任何预报能力。
 *   κ>1 需要跨月择时，而 ≥3 天冷静期 + 无预报能力做不到，所以不设。
 *
 *   ⚠️ 早期草稿里还有第二条机制 "临灾加保"（投保发生在预警窗口内，期望赔付改用
 *   P(触发 | 投保前 24h 已累计 ≥25mm)）。**v3 明确删掉了它**，三条理由：
 *     ① 合约 effectiveFrom = startTime + coolingPeriod
 *        （RainDeliveryInsuranceV2.sol:228），冷静期只要 ≥ 最长保障期 24h，
 *        投保当天买的保单整个保障窗都还没开始 —— "看到橙色预警再买"在结构上
 *        盖不住这场雨，**不是靠加价挡的**。
 *     ② "我是在预警期内买的"是买方自述，合约无法核验；能自述的参数一定会被
 *        选成最便宜的那个 → 给不可核验的维度定价等于没定价。
 *     ③ 实测加载倍数（国标 12h/24h 口径）：临灾 5.5~17.2×，季节 4.1~12.5×，两者同量级。
 *        而在旧的 72h 口径下是"季节 37.5× 碾压临灾 5.4~12.3×"—— 谁更强的结论会随时段
 *        口径翻转，这恰恰说明"按哪种择时更强去挑加价对象"不可靠。这张倍数表只用来
 *        证明择时能力真实存在（κ 分档不是摆设），不作为加价依据。
 *   临灾条件率仍逐格算出，但**只作为诊断量**出现在报告 §7 与 JSON 里，不参与定价。
 *
 * 【核心公式】
 *      P_net(N) = ceil₄( (E97.5 + C(N,q)) / R* )        费率闸（R* = 60%）
 *      F(N)     = ceil₄( C(N,q) · (1 + M) )             成本地板（M = 25%）
 *      P(N)     = max(P_net, F)                         取大
 *      sellable = P(1) ≤ PREMIUM_CAP                    超过尊严上限就不卖，不是加价
 *
 *   P_net 与 F 取 max 是全文最重要的一行：**微保险里固定成本常常大于风险保费**，
 *   只按风险定价会卖一份亏一份，只按成本定价会在大灾城市赔穿。见报告 §6。
 *
 * 【复算】
 *   node pricing_engine.js                打印报告
 *   node pricing_engine.js --self-check   只跑断言（改参数后必跑）
 *   node pricing_engine.js --json         打印完整 JSON
 *   落盘：pricing-engine.json
 *
 * 【数据】cache/<key>-2015-10-01_2026-09-30.json（ERA5 逐小时，五城各 96,432 小时）
 *   cache/ 被 gitignore；新克隆跑 `node actuary.js --refresh` 补。
 *
 * ⚠️ 与同目录其他脚本的分工（别混用口径）：
 *   actuary.js         v1 口径（恒定 50mm、全额赔付）—— 已在 Sepolia 上执行
 *   audit_numbers.js   点估计 + 零浮点权威值
 *   tier_design_b2b.js v2 口径对比（方案 A 现行档线 vs 方案 B 建议档线）
 *   pricing_engine.js  **v3 口径**：DDF 档线 + 五维 + 成本地板，本文件是唯一权威
 */
const fs = require('fs');
const path = require('path');
const A = require('./audit_numbers.js');
const { REGIONS } = require('../04-脚本/regions.js');

// ══════════════════════════════════════════════════════════════════════════════
// 1. 定价维度
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 保障时长：**只卖 12h 和 24h** —— 这两个是 GB/T 28592-2012《降水量等级》
 * §3「降雨量按 12 h，24 h 两个时间段进行划分」里**唯二存在**的时段。
 *
 * 为什么删掉 48h / 72h（本轮改造的核心）：
 *   ① 国标没有 48h / 72h 档。v2 的 `thresholdOf(h) = 50 × h / 24` 是**线性外推**，
 *      把 72h 的暴雨线推到 150mm、特大暴雨线推到 750mm —— 后者在五城 11 年
 *      逐小时历史里**一次都没触发过**（写在合约里、永远赔不到的条款）。
 *   ② 线性外推被国标**自己的两列**证伪：24h/12h 的比值是
 *      暴雨 50/30 = 1.667、大暴雨 100/70 = 1.429、特大暴雨 250/140 = 1.786，
 *      **都不是 2**。所以哪怕只在 12h↔24h 之间插值，线性也是错的。
 *   ③ 实测（`_audit_stat/gbt_probe.js`）：72h 档 0 的触发率 **低于** 24h
 *      （武汉 0.762% → 0.212%，广州 1.420% → 0.563%）。也就是说 v2 的
 *      "72h" 是**更贵、更难赔**的一档（武汉保费 4 倍、概率 1/3.6），
 *      对骑手单向不利 —— 删掉它同时修掉了"期限套利"的伪命题：
 *      买更久**并不**更容易赔。
 */
const HOURS = [12, 24];                        // = 合约 hoursAllowed()

const RIDER_TIERS = [
  { id: 0, key: 'open',     name: '众包自助' },
  { id: 1, key: 'attested', name: '认证骑手' },
  { id: 2, key: 'group',    name: '平台团体' },
];

const CHANNELS = [
  { id: 0, key: 'self',     name: '自助投保' },
  { id: 1, key: 'platform', name: '平台代付' },
  { id: 2, key: 'alert',    name: '预警增保' },
];

/**
 * 承保渠道表：(riderTier, channel) → { selectivity, sellable, why }
 * 按期望赔付从低到高排列，id 即顺序，也是风险档位顺序。
 *
 * **为什么没有"临灾加保"这一档**（v3 相对早期草稿的主要删减，理由见 §7）：
 *   ① 合约 `effectiveFrom = startTime + coolingPeriod`（RainDeliveryInsuranceV2.sol:228），
 *      合约**默认** coolingPeriod = 3 days（`RainDeliveryInsuranceV2.sol:68`，operator 可改），
 *      冷静期只要 ≥ 最长保障期(24h)，投保当天买的保单整个保障窗都还没开始 ——
 *      "看到橙色预警再买"在生产口径下结构上盖不住这场雨，不是靠加价挡的。
 *      ⚠️ **968 演示链上 `coolingPeriod` 被设成了 0**（`04-脚本/rehearse-v2.js:228`），
 *      所以这一条是"生产默认值"的性质，不是那条演示链的性质 —— 真正让这一档不值得做的
 *      是 ② 和 ③，别只靠 ① 说话。
 *   ② "我是在预警期内买的"是买方自述，合约无法核验；能自述的参数一定会被
 *      选成最便宜的那个 —— 给一个不可核验的维度定价等于没定价。
 *   ③ 实测（本脚本 §7）：按临灾条件定价的加载倍数只有 5.4~12.3×，
 *      而"只买雨季"这个**零预报能力**的策略能到 37.5×。真正的对手是季节择时。
 */
const IMMINENT_MM = 25;      // 投保前 24h 累计降水达到这个量级 → 蓝/黄预警大概率已发布
const SEGMENT_SPEC = [
  { riderTier: 2, channel: 1, selectivity: 0.00,
    why: '平台整批为在册骑手投保，投保时点与天气无关 —— 择时归零，唯一"干净"的渠道' },
  { riderTier: 1, channel: 1, selectivity: 0.15,
    why: '认证骑手 + 平台代付结算，个人择时只剩微弱残差' },
  { riderTier: 1, channel: 0, selectivity: 0.55,
    why: '平台 attestation 绑定身份 + 生产默认 ≥3 天冷静期，削掉短期择时但削不掉"雨季才想起来买"' },
  { riderTier: 0, channel: 0, selectivity: 1.00,
    why: '无身份绑定、随时可买 —— 纯靠气候学"只买雨季"就能拿到的上限，不需要任何预报能力' },
];

const SEGMENTS = SEGMENT_SPEC.map((spec, i) => ({
  id: i, key: `t${spec.riderTier}c${spec.channel}`,
  riderTier: spec.riderTier, channel: spec.channel,
  selectivity: spec.selectivity,
  sellable: true, sellableByPolicy: true,
  why: spec.why,
  riderName: RIDER_TIERS[spec.riderTier].name, channelName: CHANNELS[spec.channel].name,
  name: `${RIDER_TIERS[spec.riderTier].name}·${CHANNELS[spec.channel].name}`,
}));

/** (riderTier, channel) → segmentId，非法组合返回 -1。合约侧 segmentOf() 必须逐字一致 */
function segmentOf(riderTier, channel) {
  return SEGMENTS.findIndex((s) => s.riderTier === riderTier && s.channel === channel);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. 经济参数
// ══════════════════════════════════════════════════════════════════════════════

const PAYOUT_MAX      = 0.01;      // RainDeliveryInsuranceV2.sol:30
const R_TARGET        = 0.60;      // 目标赔付率（口径见 指标推导-变量表.md §2.1）
const MIN_COST_MARKUP = 0.25;      // 成本地板加成：盖住运营 / 获客 / 资本成本
const MIN_PREMIUM_ABS = 0.00002;   // 合约硬地板（sanity bound，不是经济地板）
const PREMIUM_CAP     = 0.002;     // 尊严上限 = 赔付上限的 20%。超过就不卖，不加价
// gas 定义在 `audit_numbers.js`（全仓唯一来源：用量 × 单价，并附"这不是 968 的价"的告警）
const { JUDGE_GAS, PAYOUT_GAS, GAS_UNITS, GAS_GWEI } = A;
const CEIL_TICK       = 1e5;       // 上整到 0.00001 ETH，定价只许往上。
                                   // 为什么不是仓里既有的 0.0001：平台批量价会落到
                                   // 0.00002~0.0001 区间，0.0001 的格子在那里是 50% 粒度，
                                   // 折扣会被量化噪声吞掉（实测 0.0003→0.0001 一步 67%）。
const MAX_BATCH_DISCOUNT_BPS = 8000;

const BATCH_N = [1, 10, 50, 100, 500, 1000];
const REPS = 4000;
const SEED = 20261007;
const LUT_N = 4096;

// v3 档线：DDF 次线性。v2 的 50×h/24 是线性缩放（隐含 depth ∝ duration^1），
// 真实降雨深度对历时是次线性的（k ≈ 0.5~0.7）→ v2 的档2 在 15 格里 11 年零触发。
/**
 * 档线 = GB/T 28592-2012 表 1「不同时段的降雨量等级划分表」**原件**（单位 mm）。
 * 只取前两档：暴雨 / 大暴雨。
 *
 *   等级        12h 降雨量      24h 降雨量
 *   暴雨        30.0~69.9      50.0~99.9
 *   大暴雨      70.0~139.9     100.0~249.9
 *   （特大暴雨  ≥140.0         ≥250.0）← 我们不卖，理由见下
 *
 * **为什么"特大暴雨"这一档没有落进产品**（这是本轮唯一一处主动少做的地方）：
 *   实测五城 11 年逐小时滚动窗口（`_audit_stat/gbt_probe.js`）——
 *     · 24h ≥250mm：武汉 0 / 上海 0 / 北京 0 / 广州 0 / 成都 0 次  ← **零命中**
 *     · 12h ≥140mm：武汉 4 / 北京 2 / 广州 2 / 成都 7 / 上海 0 次  ← 0.002~0.007%
 *   我们刚刚用「档 2 在 11 年里零触发 = 写在合约里却永远赔不到的条款」批评了 v2 的
 *   750mm；国标的 24h 特大暴雨线在同一个样本上**同样零命中**。保留它就是把刚骂过的
 *   毛病换个出处再犯一次，而且那部分风险保费在 97.5% 上界里几乎为 0 —— 赔付比例
 *   写成 100% 只是话术。所以产品只承诺**两档**：
 *     档 0 = 暴雨   → 赔 50%
 *     档 1 = 大暴雨 → 赔 75%
 *   两档在五城、两个时长上都真实命中过（见 selfCheck 4.5 的五城可达性断言）。
 *   ⚠️ 若要保留 100% 那一档的演示冲击力，见 `v3-合约规格.md` §「三档变体」——
 *      代价是把一条 11 年零命中的条款写进对外承诺。
 */
const THRESHOLDS = { 12: [30, 70], 24: [50, 100] };   // GB/T 28592-2012 表 1 原件
const TIER_BPS   = [5000, 7500];                      // 50% / 75%

const ceilTick = (v) => Math.ceil(v / (1 / CEIL_TICK) - 1e-9) / CEIL_TICK;
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const quantile = (sorted, a) => sorted[Math.min(sorted.length - 1, Math.floor(a * sorted.length))];

/** 投保前 24h 累计降水是否达到 IMMINENT_MM（单位：0.1mm 整数） */
function imminentFlags(mm10, windowHours) {
  // 窗口结束于 index i（含），则"前 24h"是 [i-windowHours-23, i-windowHours]
  const n = mm10.length - windowHours + 1;
  const flags = new Uint8Array(n);
  const need = IMMINENT_MM * 10;
  // 窗口 j 覆盖 [j, j+windowHours)；"投保前 24h" 是 [j-24, j)
  const pre = new Float64Array(mm10.length + 1);
  for (let i = 0; i < mm10.length; i++) pre[i + 1] = pre[i] + mm10[i];
  for (let j = 0; j < n; j++) {
    const a = j - 24, b = j; // [a, b) 即前 24 小时
    if (a < 0) continue;
    if (pre[b] - pre[a] >= need) flags[j] = 1;
  }
  return flags;
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. 主流程
// ══════════════════════════════════════════════════════════════════════════════

function main({ write = true } = {}) {
  // ── 3.1 读缓存，建月份索引 ────────────────────────────────────────────────
  const monthSet = new Set();
  const cities = [];
  for (const r of REGIONS) {
    const { times, mm10 } = A.loadCity(r);
    const { idx, keys } = A.monthIndex(times);
    keys.forEach((k) => monthSet.add(k));
    cities.push({ ...r, idx, mm10, nHours: times.length });
  }
  const monthKeys = [...monthSet].sort();
  const nM = monthKeys.length;

  // ── 3.2 逐格按月聚合（15 格：5 区域 × 3 时长）───────────────────────────
  const cells = [];
  for (const c of cities) {
    for (const h of HOURS) {
      const sums = A.windowSums(c.mm10, h);
      const bounds = THRESHOLDS[h].map((t) => Math.round(t * 10)); // 整数十分位
      const immin = imminentFlags(c.mm10, h);
      const paySum = new Float64Array(nM), win = new Int32Array(nM);          // 全样本
      const paySumI = new Float64Array(nM), winI = new Int32Array(nM);        // 仅临灾样本
      const nHitByTier = new Array(TIER_BPS.length).fill(0);
      let nHit = 0, nImm = 0;
      for (let j = 0; j < sums.length; j++) {
        const v = sums[j];
        let f = 0;
        // 档线递增 → 逐个比较即可；同时累计各档的"达到"次数（cumulative，含更高档）
        for (let k = 0; k < bounds.length; k++) {
          if (v >= bounds[k]) { f = TIER_BPS[k] / 10000; nHitByTier[k]++; }
        }
        if (f > 0) nHit++;
        const m = c.idx[j + h - 1];
        paySum[m] += f; win[m] += 1;
        if (immin[j]) { paySumI[m] += f; winI[m] += 1; nImm++; }
      }
      const rate = new Float64Array(nM), rateI = new Float64Array(nM);
      for (let m = 0; m < nM; m++) {
        rate[m] = win[m] > 0 ? paySum[m] / win[m] : 0;
        rateI[m] = winI[m] > 0 ? paySumI[m] / winI[m] : 0;
      }
      let s = 0; for (let m = 0; m < nM; m++) s += paySum[m];
      let si = 0; for (let m = 0; m < nM; m++) si += paySumI[m];
      cells.push({
        regionKey: c.key, regionName: c.name, regionId: c.id,
        hours: h, thresholdsMm: THRESHOLDS[h],
        rate, rateI, win, winI, nWin: sums.length, nHit, nHitByTier, nImm,
        pointRate: s / sums.length,
        imminentRate: nImm > 0 ? si / nImm : 0,
      });
    }
  }

  // ── 3.3 共享抽样桶（同一批均匀数喂给所有格 → 保留城市间气候相关性）─────────
  const rnd = mulberry32(SEED);
  const buckets = new Int32Array(REPS * nM);
  for (let i = 0; i < buckets.length; i++) buckets[i] = Math.min(LUT_N - 1, (rnd() * LUT_N) | 0);

  // ── 3.4 逐 segment 逐格：择时加权的 97.5% 分位 ────────────────────────────
  const scratch = new Float64Array(REPS);
  for (const cell of cells) {
    cell.bySeg = [];
    let sumR = 0;
    for (let m = 0; m < nM; m++) sumR += cell.rate[m];
    for (const seg of SEGMENTS) {
      const base = cell.rate;
      const w = new Float64Array(nM);
      let sw = 0;
      // 择时混合：w_m = (1-κ)/nM + κ·rate_m/Σrate
      // 不能用 rate_m^κ —— 干月 rate_m=0 时 0^κ=0，等于把所有干月权重清零，
      // 于是 κ 只有 0.15 也会给出 18 倍加载（幂律在零点处不连续）。
      // 混合式在 κ=0 时退化为均匀、κ=1 时完全按该月触发率分配，
      // 且上界 Σrate²/Σrate ≤ max_m rate_m，加载倍数天然有界。
      const kap = seg.selectivity;
      for (let m = 0; m < nM; m++) {
        w[m] = (1 - kap) / nM + (sumR > 0 ? kap * cell.rate[m] / sumR : 0);
        sw += w[m];
      }
      if (sw > 0) { for (let m = 0; m < nM; m++) w[m] /= sw; }
      else { w.fill(1 / nM); }

      let point = 0;
      for (let m = 0; m < nM; m++) point += w[m] * base[m];

      // CDF → LUT（u 单调，O(LUT_N + nM) 建表）
      const cdf = new Float64Array(nM);
      let acc = 0;
      for (let m = 0; m < nM; m++) { acc += w[m]; cdf[m] = acc; }
      cdf[nM - 1] = 1;
      const lut = new Int32Array(LUT_N);
      let mi = 0;
      for (let b = 0; b < LUT_N; b++) {
        const u = (b + 0.5) / LUT_N;
        while (mi < nM - 1 && u > cdf[mi]) mi++;
        lut[b] = mi;
      }

      // 自举：按 w_m 抽 nM 个月，取该月率的平均
      for (let rep = 0; rep < REPS; rep++) {
        const off = rep * nM;
        let sum = 0;
        for (let i = 0; i < nM; i++) sum += base[lut[buckets[off + i]]];
        scratch[rep] = sum / nM;
      }
      const sorted = Float64Array.from(scratch).sort();
      cell.bySeg.push({
        segId: seg.id, selectivity: seg.selectivity,
        pointRate: point,
        upperRate: quantile(sorted, 0.975),
        var99Rate: quantile(sorted, 0.99),
        loRate: quantile(sorted, 0.025),
        loadFactor: point > 0 ? round(quantile(sorted, 0.975) / point, 3) : null,
        vsUncond: cell.pointRate > 0 ? round(point / cell.pointRate, 4) : null,
      });
    }
  }

  // ── 3.5 定价 ──────────────────────────────────────────────────────────────
  const price = (cell, si, N) => {
    const s = cell.bySeg[si];
    const q = s.pointRate;
    const cost = JUDGE_GAS / N + PAYOUT_GAS * q;
    const pNet = ceilTick((s.upperRate * PAYOUT_MAX + cost) / R_TARGET);
    const floor = ceilTick(cost * (1 + MIN_COST_MARKUP));
    const raw = Math.max(pNet, floor);
    const charged = Math.max(MIN_PREMIUM_ABS, raw);   // 合约硬地板在这里真正起作用
    const sellable = SEGMENTS[si].sellable && raw <= PREMIUM_CAP;
    return {
      N, costPerPolicyEth: round(cost, 8), pNetEth: round(pNet, 8),
      costFloorEth: round(floor, 8),
      premiumEth: sellable ? charged : null,
      fairPriceIfSoldEth: round(raw, 8),
      sellable,
      unsellableReason: !SEGMENTS[si].sellable ? 'policy: 匿名渠道不允许预警期增保'
        : (raw > PREMIUM_CAP ? `fair price ${round(raw, 8)} > 尊严上限 ${PREMIUM_CAP}` : null),
      boundBy: pNet >= floor ? 'risk' : 'cost',
      expectedPayoutEth: round(q * PAYOUT_MAX, 8),
      upperPayoutEth: round(s.upperRate * PAYOUT_MAX, 8),
      lossRatioAtUpper: round((s.upperRate * PAYOUT_MAX) / raw, 6),
      marginPerPolicyEth: round(raw - s.upperRate * PAYOUT_MAX - cost, 8),
      premiumWei: sellable ? String(Math.round(charged * 1e18)) : null,
    };
  };

  const rows = [];
  for (const cell of cells) {
    for (let si = 0; si < SEGMENTS.length; si++) {
      const seg = SEGMENTS[si];
      const retail = price(cell, si, 1);
      // 批量折扣只在"平台代付"渠道成立：一次判定覆盖整批，每份判定成本才是真的摊薄了。
      // 自助投保的骑手各买各的、各触发一次判定，没有可摊薄的固定成本 —— 给他们挂批量价
      // 等于凭空让利，还会造出"凑单"这个新的逆向选择口子。
      const batch = seg.channel === 1 ? BATCH_N.map((N) => price(cell, si, N)) : [retail];
      rows.push({
        regionId: cell.regionId, regionKey: cell.regionKey, regionName: cell.regionName,
        hours: cell.hours, thresholdsMm: cell.thresholdsMm,
        segId: seg.id, segKey: seg.key, riderTier: seg.riderTier, channel: seg.channel,
        riderName: seg.riderName, channelName: seg.channelName, segName: seg.name,
        selectivity: seg.selectivity, why: seg.why,
        // ⚠️ 三个名字不是一个东西，别混（命名三分）：
        //   p₁            = 二元第一档触发率 = nHit / nWin（"有没有到第 1 档线"）
        //   E[f]          = 档位加权期望赔付比例 = Σ(命中档位 × 该档赔付比例) / nWin
        //   E[f]|timing   = 上面的 E[f] 再按 κ 做月度择时加权（= pointRatePct，定价用的就是它）
        // 对外材料里"24h 无条件触发概率 0.4377%~1.4200%"用的是 p₁；`B端档位设计与不亏损证明.md`
        // §1.2 同一行并列的"命中/窗口"是 p₁、"点估计 p"是 E[f] —— 相差约 1.9 倍，是口径差不是算错。
        nWin: cell.nWin, nHit: cell.nHit, nHitByTier: cell.nHitByTier, nImm: cell.nImm,
        uncondPointRatePct: round(cell.pointRate * 100, 6),      // E[f]（无条件）
        imminentRatePct: round(cell.imminentRate * 100, 6),      // 诊断量，不参与定价
        pointRatePct: round(cell.bySeg[si].pointRate * 100, 6),  // E[f]|timing
        upperRatePct: round(cell.bySeg[si].upperRate * 100, 6),
        var99RatePct: round(cell.bySeg[si].var99Rate * 100, 6),
        vsUncond: cell.bySeg[si].vsUncond,
        loadFactor: cell.bySeg[si].loadFactor,
        premiumRetailEth: retail.premiumEth,
        fairRetailEth: retail.fairPriceIfSoldEth,
        sellable: retail.sellable, unsellableReason: retail.unsellableReason,
        costPerPolicyEth: retail.costPerPolicyEth,
        costFloorEth: retail.costFloorEth, pNetEth: retail.pNetEth,
        boundBy: retail.boundBy, upperPayoutEth: retail.upperPayoutEth,
        expectedPayoutEth: retail.expectedPayoutEth,
        marginPerPolicyEth: retail.marginPerPolicyEth,
        batch: batch.map((b) => ({
          N: b.N, premiumEth: b.premiumEth, costPerPolicyEth: b.costPerPolicyEth,
          boundBy: b.boundBy, sellable: b.sellable,
          discountBpsVsRetail: (retail.premiumEth && b.premiumEth)
            ? Math.round((1 - b.premiumEth / retail.premiumEth) * 10000) : null,
          unitWei: b.premiumWei,
        })),
      });
    }
  }

  // ── 3.6 批量折扣带（合约用一张与格无关的表，取全格最保守折扣）────────────
  const bands = BATCH_N.map((N) => {
    const ds = rows.map((r) => (r.batch.find((b) => b.N === N) || {}).discountBpsVsRetail)
      .filter((d) => d !== null && d !== undefined);
    const disc = ds.length ? Math.min(...ds) : 0;
    return { bandIndex: BATCH_N.indexOf(N), NMax: N, discountBps: Math.max(0, Math.min(MAX_BATCH_DISCOUNT_BPS, disc)) };
  });
  for (let i = 1; i < bands.length; i++) if (bands[i].discountBps < bands[i - 1].discountBps) {
    bands[i].discountBps = bands[i - 1].discountBps;
  }

  // ── 3.7 准备金闸（按最差 segment 的 VaR99）───────────────────────────────
  let var99Max = 0, worstCell = null;
  for (const cell of cells) for (const s of cell.bySeg) {
    if (s.var99Rate > var99Max) { var99Max = s.var99Rate; worstCell = `${cell.regionName} ${cell.hours}h seg#${s.segId}`; }
  }
  const reserve = {
    var99PerPolicyEth: round(var99Max * PAYOUT_MAX, 8),
    worstCell,
    rule: 'reserve ≥ 在保总份数 × var99PerPolicyEth',
    note: '取全格最差 segment 的 VaR99 → 无论实际渠道组合如何都不会低估',
  };

  // ── 3.8 比例关系表 ────────────────────────────────────────────────────────
  const sell = rows.filter((r) => r.sellable);
  const ratios = {};
  ratios.region = [];
  for (const h of HOURS) for (const seg of SEGMENTS) {
    const rs = sell.filter((r) => r.hours === h && r.segId === seg.id);
    if (!rs.length) continue;
    const base = Math.min(...rs.map((r) => r.premiumRetailEth));
    ratios.region.push({
      hours: h, segKey: seg.key, segName: seg.name,
      cells: rs.map((r) => ({ region: r.regionName, premiumEth: r.premiumRetailEth, ratio: round(r.premiumRetailEth / base, 3) })),
    });
  }
  ratios.hours = [];
  for (const r of rows) {
    if (r.hours !== 12 || !r.sellable) continue;
    const rs = rows.filter((x) => x.regionId === r.regionId && x.segId === r.segId);
    if (rs.some((x) => !x.sellable)) continue;
    const get = (hh) => rs.find((x) => x.hours === hh).premiumRetailEth;
    // 时长比以 12h 为 1（12h = 一个班次，24h = 一整天）
    ratios.hours.push({ region: r.regionName, segKey: r.segKey, segName: r.segName,
      r12: 1, r24: round(get(24) / get(12), 3) });
  }
  ratios.segment = sell.filter((r) => r.hours === 24).map((r) => ({
    region: r.regionName, segKey: r.segKey, segName: r.segName,
    selectivity: r.selectivity,
    premiumEth: r.premiumRetailEth, vsUncond: r.vsUncond,
    upperRatePct: r.upperRatePct, boundBy: r.boundBy,
  }));
  ratios.batch = BATCH_N.map((N) => {
    const ds = sell.filter((r) => r.channel === 1)
      .map((r) => ((r.batch.find((b) => b.N === N) || {}).premiumEth) / r.premiumRetailEth)
      .filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return { N, discountBpsRange: ds.length
      ? [Math.round((1 - ds[ds.length - 1]) * 10000), Math.round((1 - ds[0]) * 10000)] : [0, 0],
      medianRatio: ds.length ? round(ds[Math.floor(ds.length / 2)], 3) : null };
  });

  // ── 3.9 上链入参（B 给值 → A 执行）────────────────────────────────────────
  // 两张表就是 setPremiumGrid / setPremiumBands 的入参。本批（12h/24h）**0 格不可售**；
  // 若将来出现不可售格，那一格写 0，合约见到 0 必须 revert（"这一格我们不卖"），
  // 而不是回退到别的价 —— 回退会把"不卖"变成"悄悄卖了个别价"。
  const payload = {
    note: 'B 定值、A 执行。单位 wei。本批 40 格全部可售；若出现不可售格，premiumWei="0" 且合约必须 revert 而不是回退。',
    contract: 'RainDeliveryInsuranceV3.sol',
    segmentOrder: SEGMENTS.map((s) => `${s.id}=${s.key} ${s.name}`),
    bandN: BATCH_N,
    retail: rows.map((r) => ({
      regionId: r.regionId, regionKey: r.regionKey, hours: r.hours, segId: r.segId, segKey: r.segKey,
      sellable: r.sellable, premiumEth: r.premiumRetailEth,
      premiumWei: r.premiumRetailEth === null ? '0' : String(Math.round(r.premiumRetailEth * 1e18)),
    })),
    bands: rows.filter((r) => r.channel === 1).flatMap((r) => r.batch.map((b) => ({
      regionId: r.regionId, regionKey: r.regionKey, hours: r.hours, segId: r.segId, segKey: r.segKey,
      bandIndex: BATCH_N.indexOf(b.N), nMax: b.N, premiumEth: b.premiumEth,
      premiumWei: b.unitWei === null || b.unitWei === undefined ? '0' : b.unitWei,
    }))),
  };

  const report = {
    meta: {
      generatedBy: '10-金融与定价/pricing_engine.js',
      generatedAt: new Date().toISOString(), version: 'v3',
      sourceMtime: A.sourceMtime(),
      source: 'Open-Meteo Archive (ERA5) 逐小时，五城各 96,432 小时',
      dataStart: A.DATA_START, dataEnd: A.DATA_END,
      bootstrap: { unit: 'calendar month', reps: REPS, seed: SEED, quantile: 0.975 },
      contract: '03-合约/RainDeliveryInsuranceV3.sol（待 A 落地；参照 v2 的 premiumGrid 扩展）',
      imminentMm: IMMINENT_MM,
      dimensions: {
        region: REGIONS.map((r) => `${r.id}=${r.key}`), hours: HOURS,
        riderTier: RIDER_TIERS.map((t) => `${t.id}=${t.key}`),
        channel: CHANNELS.map((c) => `${c.id}=${c.key}`), batch: BATCH_N,
      },
      segments: SEGMENTS,
      economics: {
        payoutMaxEth: PAYOUT_MAX, targetLossRatio: R_TARGET,
        minCostMarkup: MIN_COST_MARKUP, minPremiumAbsEth: MIN_PREMIUM_ABS,
        premiumCapEth: PREMIUM_CAP, judgeGasEth: JUDGE_GAS, payoutGasEth: PAYOUT_GAS,
        // 「用量 × 单价」的原始口径也落进产物：只写 0.00013/0.00012 判不出它属于哪条链，
        // 而"哪条链"正是这两个数最容易被误读的地方
        gasUnits: GAS_UNITS, gasGwei: GAS_GWEI,
        gasCaliber: 'gas 用量取真链实测（与网络无关）；单价取 Sepolia 2026-10-06（判定 1.080 / 赔付 2.500 gwei）。'
          + '同两笔在 BOT Chain 968（20 gwei）≈ 0.0024369 / 0.00098594 BOT —— 换链必须用 node margin_check.js 重算',
        ceilTickEth: 1 / CEIL_TICK, maxBatchDiscountBps: MAX_BATCH_DISCOUNT_BPS,
      },
      thresholdsMm: THRESHOLDS, tierBps: TIER_BPS,
      caveat: [
        'κ 与临灾条件率都是**历史频率**，不含预报技能；真实投保时点能拿到的信息比这更多，是最保守的一侧。',
        '月聚类块自举的块长固定为 1 个日历月；真实风险记忆尺度与月长不同，本表只做参数不确定性的一阶修正。',
        '批量折扣只覆盖 AI 判定 gas 的摊薄；赔付 gas 仍按期望出险次数计费。',
        'sellable=false 的格不是"价格算错了"，而是**产品政策**：无身份绑定 + 雨季城市 + 最长时长，报出来的价已经高于尊严上限，宁愿不卖。⚠️ **本批（12h/24h）0 格触发** —— 原来那 3 格全是 72h 众包自助，随 72h 一起消失。',
        '临灾条件率（imminentRatePct / t2c1 行）是**诊断量**，不进入任何报价；见文件头"为什么删掉临灾档"。',
        '本表未含冷静期(coolingPeriod)造成的生效延迟 —— 合约**默认** 3 天 ≥ 最长保障期 24h，意味着任何"临时追保"都盖不住当次天气，方向上是本表的进一步保守。⚠️ 但 **968 演示链上该值被设成 0**（演示动线需要），别把"生产默认"说成"链上现状"。',
      ],
    },
    cells: rows, batchBands: bands, reserve, ratios, payload,
  };

  if (write) A.emit(path.join(__dirname, 'pricing-engine.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. 自检
// ══════════════════════════════════════════════════════════════════════════════

function selfCheck(rep) {
  const fails = [];
  let total = 0;
  const ok = (n, c, d) => { total++; if (!c) fails.push(`${n}${d ? ' ' + d : ''}`); };
  const sell = rep.cells.filter((r) => r.sellable);

  // ── 4.1 维度与映射 ──
  ok('segment 数 = 4（临灾档已删除，见文件头）', SEGMENTS.length === 4, `${SEGMENTS.length}`);
  ok('(2,0) 团体·自助 非法', segmentOf(2, 0) === -1);
  ok('(0,1) 众包·平台代付 非法', segmentOf(0, 1) === -1);
  ok('(2,2) 团体·预警增保 非法', segmentOf(2, 2) === -1);
  ok('(1,2)/(0,2) 预警增保渠道已下线（不再有合法 segment）',
    segmentOf(1, 2) === -1 && segmentOf(0, 2) === -1);
  ok('(2,1) 团体·平台代付 合法', segmentOf(2, 1) >= 0);
  ok('segmentOf 是单射', new Set(SEGMENTS.map((s) => `${s.riderTier},${s.channel}`)).size === 4);
  ok('segment 顺序 = 风险升序（κ 单调不减）',
    SEGMENTS.every((s, i) => i === 0 || s.selectivity >= SEGMENTS[i - 1].selectivity),
    SEGMENTS.map((s) => s.selectivity).join(','));
  ok('格数 = 5 区域 × 2 时长(12/24h) × 4 segment = 40',
    rep.cells.length === 40, `${rep.cells.length}`);
  ok('每个 (region,hours) 恰好 4 个 segment',
    REGIONS.every((r) => HOURS.every((h) => rep.cells.filter((c) => c.regionId === r.id && c.hours === h).length === 4)));

  // ── 4.2 每格的经济学 ──
  for (const r of rep.cells) {
    const tag = `[${r.regionName} ${r.hours}h ${r.segKey}]`;
    ok(`${tag} 上界 ≥ 点估计`, r.upperRatePct >= r.pointRatePct - 1e-9);
    ok(`${tag} VaR99 ≥ 上界`, r.var99RatePct >= r.upperRatePct - 1e-9, `${r.var99RatePct}/${r.upperRatePct}`);
    ok(`${tag} 档线严格递增（国标表1 原件）`,
      r.thresholdsMm.every((t, i) => i === 0 || t > r.thresholdsMm[i - 1]));
    ok(`${tag} 档位命中数单调不增`,
      r.nHitByTier.every((n, i) => i === 0 || n <= r.nHitByTier[i - 1]), JSON.stringify(r.nHitByTier));
    ok(`${tag} 批量价单调不增`,
      r.batch.filter((b) => b.premiumEth !== null)
        .every((b, i, a) => i === 0 || b.premiumEth <= a[i - 1].premiumEth + 1e-12));
    ok(`${tag} 批量折扣 ≤ 上限`,
      r.batch.every((b) => b.discountBpsVsRetail === null || b.discountBpsVsRetail <= MAX_BATCH_DISCOUNT_BPS + 1e-9));
    if (r.sellable) {
      ok(`${tag} 保费在 [硬地板, 尊严上限]`,
        r.premiumRetailEth >= MIN_PREMIUM_ABS - 1e-12 && r.premiumRetailEth <= PREMIUM_CAP + 1e-12,
        `${r.premiumRetailEth}`);
      ok(`${tag} 保费 ≥ 成本地板`, r.premiumRetailEth >= r.costFloorEth - 1e-12, `${r.premiumRetailEth}<${r.costFloorEth}`);
      ok(`${tag} 97.5% 上界口径每份不亏`, r.marginPerPolicyEth >= -1e-12, `${r.marginPerPolicyEth}`);
    } else {
      ok(`${tag} 不可售格必须给出理由`, !!r.unsellableReason);
      ok(`${tag} 不可售格不得报价`, r.premiumRetailEth === null);
    }
  }

  // ── 4.3 诊断量断言：临灾条件率（**不参与定价**，见文件头"为什么删掉临灾档"）──
  // (a) 临灾条件率必须 ≥ 无条件率（同一区域同一时长）——否则"预警"这个诊断量没意义。
  //     取 t2c1 行的临灾量（临灾率与 segment 无关，每格只算一次）。
  const immCells = rep.cells.filter((c) => c.segKey === 't2c1');
  for (const c of immCells) {
    ok(`[${c.regionName} ${c.hours}h] 临灾条件率 ≥ 无条件率`,
      c.imminentRatePct >= c.uncondPointRatePct - 1e-9, `${c.imminentRatePct} vs ${c.uncondPointRatePct}`);
  }
  // (a2) 两条择时策略谁加载更高？—— 结论在 12h/24h 口径下**与 72h 口径反了过来**：
  //      72h 时代季节择时（成都 72h 37.5x）碾压临灾择时（5.4~12.3x）；
  //      换到国标的 12h/24h 后，两者同量级，临灾反而更高（成都 24h 临灾 17.2x vs 季节 12.5x）。
  //      这个反转本身就是"不给**时点**定价"的最强论据 —— 没有一个时点维度稳定占优，
  //      按"哪种择时更强"去挑加价对象就是不可靠的。真正稳定的是两条：
  //        ① 冷静期 ≥ 保障期（删掉 72h 后这个要求从 ≥72h 降到 ≥24h，好落地多了）；
  //        ② 时点不可自证 —— 能自述的参数一定被选成最便宜那个。
  //      而 κ 之所以仍然可以定价，是因为它挂在**可观测的销售渠道**上（平台整批 vs 自助），
  //      不是买方自述的时点。这张表是"择时能力真实存在"的定量证据，不是加价依据。
  {
    const load = [];
    for (const c of immCells) {
      const un = c.uncondPointRatePct;
      const last = rep.cells.find((x) => x.regionId === c.regionId && x.hours === c.hours && x.segKey === 't0c0');
      load.push({ tag: `${c.regionName} ${c.hours}h`, s: last.pointRatePct / un, i: c.imminentRatePct / un });
    }
    const maxSeas = Math.max(...load.map((l) => l.s));
    const minSeas = Math.min(...load.map((l) => l.s));
    const maxImm = Math.max(...load.map((l) => l.i));
    const minImm = Math.min(...load.map((l) => l.i));
    ok('临灾择时的加载倍数落在 4~20× 区间（与文档 §7 一致）',
      minImm >= 4 && maxImm <= 20, `${minImm.toFixed(2)}~${maxImm.toFixed(2)}x`);
    ok('季节择时的加载倍数落在 4~20× 区间',
      minSeas >= 4 && maxSeas <= 20, `${minSeas.toFixed(2)}~${maxSeas.toFixed(2)}x`);
    ok('两种择时同量级（没有一个碾压另一个，差距 ≤2×）—— 故不按"谁更强"挑加价对象',
      Math.max(maxSeas, maxImm) / Math.min(maxSeas, maxImm) <= 2.0,
      `季节 ${maxSeas.toFixed(2)}x vs 临灾 ${maxImm.toFixed(2)}x`);
    ok('最弱的非干净渠道加载 ≥4×（κ 分档确有经济意义，不是摆设）',
      minSeas >= 4, `最小季节加载 ${minSeas.toFixed(2)}x`);
  }
  // (b) 风险随 κ 单调不减；不可售只能出现在 κ 更大的后缀上
  for (const reg of REGIONS) for (const h of HOURS) {
    const rs = rep.cells.filter((r) => r.regionId === reg.id && r.hours === h)
      .sort((a, b) => a.selectivity - b.selectivity);
    ok(`[${reg.name} ${h}h] 点估计随 κ 单调不减`,
      rs.every((r, i) => i === 0 || r.pointRatePct >= rs[i - 1].pointRatePct - 1e-9),
      rs.map((r) => r.pointRatePct).join(' '));
    ok(`[${reg.name} ${h}h] 上界随 κ 单调不减`,
      rs.every((r, i) => i === 0 || r.upperRatePct >= rs[i - 1].upperRatePct - 1e-9),
      rs.map((r) => r.upperRatePct).join(' '));
    // 用"若开卖"的价格比，绕开 null（不可售格没有报价，不能用它做单调性比较）
    const fair = rs.map((r) => r.fairRetailEth);
    ok(`[${reg.name} ${h}h] "若开卖"价随 κ 单调不减`,
      fair.every((v, i) => i === 0 || v >= fair[i - 1] - 1e-12), fair.join(' '));
    const flags = rs.map((r) => r.sellable);
    ok(`[${reg.name} ${h}h] 不可售是 κ 的后缀`,
      flags.every((v, i) => i === 0 || !(v && !flags[i - 1])), flags.map((v) => (v ? 1 : 0)).join(''));
  }

  // ── 4.4 结构断言 ──
  for (const reg of REGIONS) for (const h of HOURS) {
    const rs = sell.filter((r) => r.regionId === reg.id && r.hours === h);
    const g = rs.find((r) => r.segKey === 't2c1');
    if (g) ok(`[${reg.name} ${h}h] 平台团体是可售格里的最低价`,
      rs.every((r) => g.premiumRetailEth <= r.premiumRetailEth + 1e-12));
  }
  for (const reg of REGIONS) for (const seg of SEGMENTS) {
    const rs = rows3(rep, reg.id, seg.id);
    if (!rs || rs.some((r) => !r.sellable)) continue;
    ok(`[${reg.name} ${seg.key}] 24h ≥ 12h`,
      rs.find((r) => r.hours === 24).premiumRetailEth >= rs.find((r) => r.hours === 12).premiumRetailEth - 1e-12);
  }
  ok('若有不可售格，只允许出现在 κ=1.00 的众包自助渠道（"没有身份就报不出价"）',
    rep.cells.filter((r) => !r.sellable).every((r) => r.segKey === 't0c0'),
    [...new Set(rep.cells.filter((r) => !r.sellable).map((r) => `${r.regionName}${r.hours}h ${r.segKey}`))].join(' '));
  // 删掉 72h 的副作用之一：原来那 3 个不可售格（武汉/广州/成都 72h t0c0）全部消失 ——
  // 12h/24h 的最贵格（成都 24h t0c0 0.00099）离尊严上限 0.002 还有一倍余量。
  // 这削弱了"没有身份就报不出价"的极端故事，但换来的是**每一格都卖得出去**。
  ok('本设计没有不可售格（原 3 格全是 72h t0c0，随 72h 一起消失）',
    rep.cells.filter((r) => !r.sellable).length === 0,
    `不可售 ${rep.cells.filter((r) => !r.sellable).length} 格`);
  ok('全部 40 格都落在 [合约硬地板, 尊严上限] 内',
    rep.cells.every((r) => r.premiumRetailEth !== null
      && r.premiumRetailEth >= MIN_PREMIUM_ABS - 1e-12 && r.premiumRetailEth <= PREMIUM_CAP + 1e-12));
  ok('最贵的格与尊严上限至少留 1.5 倍余量（证明上面那条不是刚好擦线）',
    PREMIUM_CAP / Math.max(...rep.cells.map((r) => r.premiumRetailEth)) >= 1.5,
    `${PREMIUM_CAP} / ${Math.max(...rep.cells.map((r) => r.premiumRetailEth))} = ${(PREMIUM_CAP / Math.max(...rep.cells.map((r) => r.premiumRetailEth))).toFixed(2)}x`);
  ok('批量折扣带单调不减',
    rep.batchBands.every((b, i) => i === 0 || b.discountBps >= rep.batchBands[i - 1].discountBps),
    rep.batchBands.map((b) => b.discountBps).join(','));

  // ── 4.5 档档必须可达（v3 对 v2 的核心修正；国标表 1 原件自带这个性质） ──
  for (const h of HOURS) for (let k = 0; k < TIER_BPS.length; k++) {
    const n = rep.cells.filter((r) => r.hours === h && r.segId === 0).filter((r) => r.nHitByTier[k] > 0).length;
    ok(`[${h}h 档${k}] 五城全可达`, n === 5, `${n}/5 城可达`);
  }
  // 对照必须仍成立才算对照有效：v2 的线性外推在 72h 档2 全不可达；
  // 而国标**第三档**（24h ≥250mm）在同一批数据上也零命中 —— 这正是我们不卖它的实测依据。
  {
    const lin72c = Math.round((150 * 5) * 10);   // v2 的 72h 档2 = 750mm
    let reach72 = 0, reach24c = 0, reach12c = 0;
    for (const r of REGIONS) {
      const { mm10 } = A.loadCity(r);
      if (A.windowSums(mm10, 72).some((v) => v >= lin72c)) reach72++;
      if (A.windowSums(mm10, 24).some((v) => v >= 2500)) reach24c++;   // 国标 24h 特大暴雨 ≥250mm
      if (A.windowSums(mm10, 12).some((v) => v >= 1400)) reach12c++;   // 国标 12h 特大暴雨 ≥140mm
    }
    ok('对照：v2 线性外推的 72h 档2(750mm) 五城全不可达', reach72 === 0, `${reach72}/5 城`);
    ok('证据：国标 24h 特大暴雨(≥250mm) 五城全零命中 —— 因此产品不卖这一档', reach24c === 0, `${reach24c}/5 城`);
    ok('对照：国标 12h 特大暴雨(≥140mm) 有命中（零命中是 24h 那一列的性质，不是样本里没有极值）',
      reach12c > 0, `${reach12c}/5 城`);
  }

  // ── 4.6 固定成本论断（"成本主导"的前提）──
  // N→∞ 时"赔付 gas × 出险率"这一项不摊薄，所以摊薄倍数有上界、且**逐格不同**：
  // 实测逐格 84×~326×（最低 广州 24h 认证+平台、最高 北京 12h/24h 平台团体），
  // 不存在一个"通用"的 198× —— 那是武汉 12h 平台团体这一格的值。
  // 旧写法只查 cells[0]，把单格样本当成了全局性质，这里改成对全部 channel=1 的格取下界。
  const batchCells = rep.cells.filter((r) => r.channel === 1);
  const batchRatios = batchCells.map((r) => {
    const a = r.batch.find((b) => b.N === 1).costPerPolicyEth;
    const z = r.batch.find((b) => b.N === 1000).costPerPolicyEth;
    return { key: `${r.regionName} ${r.hours}h ${r.segKey}`, ratio: a / z };
  });
  const minRatio = Math.min(...batchRatios.map((x) => x.ratio));
  const maxRatio = Math.max(...batchRatios.map((x) => x.ratio));
  const worstRatio = batchRatios.find((x) => x.ratio === minRatio);
  const anyCell = rep.cells[0];
  const c1 = anyCell.batch[0].costPerPolicyEth;
  ok('批量把每份固定成本摊薄 ≥80 倍（逐格下界，不是单格样本）', minRatio >= 80,
    `min=${minRatio.toFixed(1)}x（${worstRatio.key}）max=${maxRatio.toFixed(1)}x`);
  const g = rep.cells.filter((r) => r.segKey === 't2c1');
  const upSorted = g.map((r) => r.upperPayoutEth).sort((a, b) => a - b);
  const upMed = upSorted[(upSorted.length - 1) >> 1];
  ok('N=1 固定成本 > 平台团体渠道风险保费的中位数（零售口径成本主导）',
    c1 > upMed, `cost=${c1} median=${upMed} max=${upSorted[upSorted.length - 1]}`);

  // ── 4.7 批量折扣只挂在平台代付渠道 ──
  for (const r of rep.cells) {
    if (r.channel === 1) {
      ok(`[${r.regionName} ${r.hours}h ${r.segKey}] 平台代付应有 6 档批量价`,
        r.batch.length === BATCH_N.length && r.batch[0].N === 1, `${r.batch.length}`);
    } else {
      ok(`[${r.regionName} ${r.hours}h ${r.segKey}] 非平台代付不得有批量价`,
        r.batch.length === 1 && r.batch[0].N === 1, `${r.batch.length}`);
    }
  }
  ok('批量折扣带上界 ≤ 8000 bps 且首档为 0',
    rep.batchBands[0].discountBps === 0 && rep.batchBands.every((b) => b.discountBps <= 8000),
    rep.batchBands.map((b) => `${b.NMax}:${b.discountBps}`).join(' '));

  fails.total = total;
  return fails;
}

/** 取某区域某 segment 的各时长行（12h / 24h） */
function rows3(rep, regionId, segId) {
  const rs = HOURS.map((h) => rep.cells.find(
    (r) => r.regionId === regionId && r.segId === segId && r.hours === h));
  return rs.every(Boolean) ? rs : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. 打印
// ══════════════════════════════════════════════════════════════════════════════

function printReport(rep) {
  const pad = (v, n) => String(v === null ? '—' : v).padStart(n);
  const e = rep.meta.economics;

  console.log('\n' + '═'.repeat(112));
  console.log('雨证 v3 五维差异化定价引擎');
  console.log('═'.repeat(112));
  console.log(`数据 ${rep.meta.dataStart} ~ ${rep.meta.dataEnd} · 自举 ${rep.meta.bootstrap.reps} 次 · 种子 ${rep.meta.bootstrap.seed}`);
  console.log(`赔付上限 ${e.payoutMaxEth} · 目标赔付率 ${e.targetLossRatio} · 成本加成 ${e.minCostMarkup} · 网格 ${e.ceilTickEth} ETH · 尊严上限 ${e.premiumCapEth}`);
  console.log(`判定 gas ${e.judgeGasEth} · 赔付 gas ${e.payoutGasEth} · 合约硬地板 ${e.minPremiumAbsEth} · 批量折扣上限 ${e.maxBatchDiscountBps} bps`);

  console.log('\n── §1 承保渠道（用户类型 × 使用场景 → 择时强度 κ）' + '─'.repeat(62));
  console.log('seg  用户类型    使用场景    κ         说明');
  for (const s of rep.meta.segments) {
    console.log(` ${s.id}   ${s.riderName.padEnd(11)}${s.channelName.padEnd(12)}κ=${s.selectivity.toFixed(2)}   ${s.why}${s.sellable ? '' : '  【拒保】'}`);
  }

  console.log('\n── §2 价格表（N=1 零售价；「—」= 不可售；批量列仅平台代付渠道有）' + '─'.repeat(42));
  console.log('区域   时长  seg   κ     E[f]|timing 97.5%上界  vs无条件  N=1价   批量最优价  约束  每份毛利');
  for (const r of rep.cells) {
    const best = r.batch.length > 1 ? r.batch[r.batch.length - 1] : null;
    console.log(
      `${r.regionName.padEnd(6)}${pad(r.hours + 'h', 5)} ${r.segKey.padEnd(5)} ${pad(r.selectivity.toFixed(2), 4)} ` +
      `${pad(r.pointRatePct, 9)}% ${pad(r.upperRatePct, 9)}% ${pad(r.vsUncond, 8)}x ` +
      `${pad(r.premiumRetailEth, 8)} ${pad(best ? best.premiumEth : '—', 10)}  ${r.boundBy.padEnd(5)} ${pad(r.marginPerPolicyEth, 10)}`
    );
  }

  console.log('\n── §3 批量折扣带（合约 batchDiscountBps，取全格最保守值）' + '─'.repeat(56));
  console.log('批量 N≤    折扣bps   中位价/N=1');
  rep.batchBands.forEach((b, i) => console.log(`${pad(b.NMax, 8)}  ${pad(b.discountBps, 8)}  ${pad(rep.ratios.batch[i].medianRatio, 10)}`));

  console.log('\n── §4 时长比（12h = 1）' + '─'.repeat(84));
  console.log('区域    seg     12h   24h');
  for (const x of rep.ratios.hours) console.log(`${x.region.padEnd(6)}  ${x.segKey.padEnd(6)}  ${pad(x.r12, 5)} ${pad(x.r24, 5)}`);

  console.log('\n── §5 不可售清单（这是结论，不是缺陷）' + '─'.repeat(70));
  const bad = rep.cells.filter((r) => !r.sellable);
  console.log(`共 ${bad.length}/${rep.cells.length} 格不可售`);
  if (!bad.length) {
    const mx = Math.max(...rep.cells.map((r) => r.premiumRetailEth));
    console.log(`  （本批 0 格 —— 删掉 72h 后每一格都在尊严上限 ${PREMIUM_CAP} 内，最贵 ${mx} 还有 ${(PREMIUM_CAP / mx).toFixed(2)} 倍余量）`);
  }
  for (const r of bad) console.log(`  ${r.regionName} ${r.hours}h ${r.segKey.padEnd(5)} ${r.segName.padEnd(20)} 公平价 ${pad(r.fairRetailEth, 9)}  ${r.unsellableReason}`);

  console.log('\n── §6 成本 vs 风险（为什么"购买量"是第一类定价维度）' + '─'.repeat(50));
  const c1 = rep.cells[0].batch[0].costPerPolicyEth;
  const c1000 = rep.cells[0].batch.find((b) => b.N === 1000).costPerPolicyEth;
  const g = rep.cells.filter((r) => r.segKey === 't2c1').map((r) => r.upperPayoutEth);
  console.log(`N=1   每份固定成本 ${c1} ETH`);
  console.log(`N=1000 每份固定成本 ${c1000} ETH  （摊薄 ${(c1 / c1000).toFixed(0)} 倍）`);
  console.log(`平台团体渠道 15 格 97.5% 风险保费 ${Math.min(...g).toFixed(8)} ~ ${Math.max(...g).toFixed(8)} ETH`);
  console.log(`→ 零售口径下固定成本是干净渠道风险保费的 ${(c1 / Math.max(...g)).toFixed(1)}~${(c1 / Math.min(...g)).toFixed(1)} 倍`);
  console.log(`\n准备金 ${rep.reserve.var99PerPolicyEth} ETH/份（最差格 ${rep.reserve.worstCell}）· ${rep.reserve.rule}`);

  // §7 —— 这是"为什么删掉临灾档"的证据表，也是本引擎最反直觉的一个结论。
  console.log('\n── §7 诊断：临灾择时 vs 季节择时（临灾率**不参与定价**，仅存档）' + '─'.repeat(36));
  console.log('区域   时长  无条件p   临灾条件p  临灾加载  季节κ=1.0p  季节加载  谁更强');
  for (const r of rep.cells.filter((r) => r.segKey === 't2c1')) {
    const last = rep.cells.find((x) => x.regionId === r.regionId && x.hours === r.hours && x.segKey === 't0c0');
    const un = r.uncondPointRatePct;
    const iL = r.imminentRatePct / un;
    const sL = last.pointRatePct / un;
    console.log(
      `${r.regionName.padEnd(6)}${pad(r.hours + 'h', 5)}  ${pad(un, 8)}% ${pad(r.imminentRatePct, 10)}% ` +
      `${pad(iL.toFixed(2), 8)}x ${pad(last.pointRatePct, 11)}% ${pad(sL.toFixed(2), 8)}x  ${sL >= iL ? '季节' : '临灾'}`
    );
  }
  const allS = [], allI = [];
  for (const r of rep.cells.filter((r) => r.segKey === 't2c1')) {
    const last = rep.cells.find((x) => x.regionId === r.regionId && x.hours === r.hours && x.segKey === 't0c0');
    allI.push(r.imminentRatePct / r.uncondPointRatePct);
    allS.push(last.pointRatePct / r.uncondPointRatePct);
  }
  console.log(`→ 临灾加载 ${Math.min(...allI).toFixed(2)}~${Math.max(...allI).toFixed(2)}x，季节加载 ${Math.min(...allS).toFixed(2)}~${Math.max(...allS).toFixed(2)}x`);
  console.log('→ 两者同量级，"谁更强"随时段口径翻转（72h 口径下是季节碾压，12/24h 口径下是临灾略高）；');
  console.log('  所以真正的锁不是给某一种择时加价，而是 ① 冷静期 ≥ 保障期（买在预警期也覆盖不到这场雨）');
  console.log('  ② 只给可观测的销售渠道定价（κ），不给买方自述的时点定价。');
}

// ── 数表导出（--md）：把 JSON 里的 40 格零售 + 120 格批量带打成 Markdown ──────────
// 存在的理由：数表不许手抄。文档 `定价体系-v3.md` 引用本文件产物，
// 任何一次重跑都会让数字与代码同步，避免"文档与代码冲突"（AGENTS.md §5）。
function emitMarkdown(rep, outPath) {
  const L = [];
  const eth = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(5));
  const bps = (v) => (v === null ? '—' : String(v));

  L.push('# 雨证 v3 定价数表（自动生成，请勿手改）', '');
  L.push(`> 由 \`10-金融与定价/pricing_engine.js\` 的 \`--md\` 生成于 ${rep.meta.generatedAt}`,
    `> 数据 ${rep.meta.dataStart} ~ ${rep.meta.dataEnd}，自举 ${rep.meta.bootstrap.reps} 次，种子 ${rep.meta.bootstrap.seed}`,
    `> 复算：\`cd 10-金融与定价 && node pricing_engine.js --md && node pricing_engine.js --self-check\``, '');

  L.push('## 一、零售价（wei 单位见 `pricing-engine.json` 的 `payload.retail`）', '');
  L.push('> **概率有三个名字，别混**：`p₁` = 二元第一档触发率（= `nHit / nWin`）；'
    + '`E[f]` = 档位加权期望赔付比例；`E[f]|timing` = 再按 κ 做月度择时加权。'
    + '下表用的是 `E[f]|timing`；对外材料里"24h 无条件触发概率 0.4377%~1.4200%"用的是 `p₁`。', '');
  L.push('| 区域 | 时长 | seg | 渠道 | κ | `E[f]`\\|timing | 97.5% 上界 | vs 无条件 | N=1 价(ETH) | 约束 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rep.cells) {
    L.push(`| ${r.regionName} | ${r.hours}h | \`${r.segKey}\` | ${r.segName} | ${r.selectivity.toFixed(2)} | `
      + `${r.pointRatePct}% | ${r.upperRatePct}% | ${r.vsUncond}x | ${eth(r.premiumRetailEth)} | ${r.boundBy} |`);
  }
  L.push('');

  L.push('## 二、平台代付批量价（仅 `channel=1`，共 20 格 × 6 档 = 120 行）', '');
  L.push('| 区域 | 时长 | seg | 用户类型 | ' + rep.meta.dimensions.batch.map((n) => `N≤${n}`).join(' | ') + ' |');
  L.push('|---|---|---|' + '---|'.repeat(1 + rep.meta.dimensions.batch.length));
  for (const r of rep.cells.filter((c) => c.channel === 1)) {
    const cells = rep.meta.dimensions.batch.map((n) => {
      const b = r.batch.find((x) => x.N === n);
      return b ? `${eth(b.premiumEth)}${b.discountBpsVsRetail ? ` (-${b.discountBpsVsRetail}bp)` : ''}` : '—';
    });
    L.push(`| ${r.regionName} | ${r.hours}h | \`${r.segKey}\` | ${r.riderName} | ${cells.join(' | ')} |`);
  }
  L.push('');

  L.push('## 三、批量折扣带（合约 `batchDiscountBps`，取全格最保守值）', '');
  L.push('| N≤ | 折扣 bps | 相邻档位价 / N=1 价（中位） |');
  L.push('|---|---|---|');
  rep.batchBands.forEach((b, i) => L.push(`| ${b.NMax} | ${b.discountBps} | ${rep.ratios.batch[i].medianRatio} |`));
  L.push('');

  L.push('## 四、不可售清单', '');
  const bad = rep.cells.filter((r) => !r.sellable);
  L.push(`共 ${bad.length}/${rep.cells.length} 格。`, '');
  if (!bad.length) {
    const mx = Math.max(...rep.cells.map((r) => r.premiumRetailEth));
    L.push(`**本批 0 格** —— 删掉 72h/48h 之后每一格都在尊严上限 \`PREMIUM_CAP=${PREMIUM_CAP}\` 内，`
      + `最贵的格为 \`${mx}\`（${(PREMIUM_CAP / mx).toFixed(2)} 倍余量）。`
      + '原来那 3 格不可售（武汉/广州/成都 72h 众包自助）随 72h 一起消失。', '');
  } else {
    L.push('| 区域 | 时长 | seg | 若开卖的公平价 | 理由 |', '|---|---|---|---|---|');
    for (const r of bad) L.push(`| ${r.regionName} | ${r.hours}h | \`${r.segKey}\` | ${eth(r.fairRetailEth)} | ${r.unsellableReason} |`);
    L.push('');
  }

  L.push('## 五、诊断：临灾择时 vs 季节择时（临灾率不参与定价）', '');
  L.push('> 「更强」列随时段口径翻转：72h 口径下季节碾压（37.5× vs 5.4~12.3×），'
    + '本表（国标 12h/24h）下两者同量级、临灾略高。**没有哪个时点维度稳定占优**，'
    + '所以不按"谁更强"挑加价对象 —— 见文件头「为什么删掉临灾档」。', '');
  L.push('| 区域 | 时长 | `E[f]` 无条件 | 临灾条件 p | 临灾加载 | 季节 κ=1.0 p | 季节加载 | 本口径更强 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of rep.cells.filter((r) => r.segKey === 't2c1')) {
    const last = rep.cells.find((x) => x.regionId === r.regionId && x.hours === r.hours && x.segKey === 't0c0');
    const iL = r.imminentRatePct / r.uncondPointRatePct, sL = last.pointRatePct / r.uncondPointRatePct;
    L.push(`| ${r.regionName} | ${r.hours}h | ${r.uncondPointRatePct}% | ${r.imminentRatePct}% | ${iL.toFixed(2)}x | `
      + `${last.pointRatePct}% | ${sL.toFixed(2)}x | ${sL >= iL ? '季节' : '临灾'} |`);
  }
  L.push('');
  L.push('## 六、上链入参摘要', '');
  L.push(`- 合约：\`${rep.payload.contract}\``);
  L.push(`- route：\`payload.retail\` ${rep.payload.retail.length} 行、\`payload.bands\` ${rep.payload.bands.length} 行（单位 wei，不可售格写 "0"）`);
  L.push(`- seg 顺序：${rep.payload.segmentOrder.join(' · ')}`);
  L.push(`- 准备金：${rep.reserve.var99PerPolicyEth} ETH/份（最差格 ${rep.reserve.worstCell}）`);
  L.push(`- 批量折扣带（bps）：${rep.batchBands.map((b) => `${b.NMax}→${b.discountBps}`).join('，')}`);
  L.push('');

  const txt = L.join('\n');
  if (outPath) { fs.writeFileSync(outPath, txt); return outPath; }
  return txt;
}

if (require.main === module) {
  const rep = main({ write: !process.argv.includes('--self-check') });
  if (process.argv.slice(2).includes('--self-check')) {
    const fails = selfCheck(rep);
    console.log(`\n自检结果：${fails.total} 项断言，${fails.length === 0 ? '全部通过' : fails.length + ' 项失败'}`);
    fails.forEach((f) => console.log('  FAIL  ' + f));
    process.exit(fails.length === 0 ? 0 : 1);
  } else if (process.argv.slice(2).includes('--json')) {
    console.log(JSON.stringify(rep, null, 2));
  } else if (process.argv.slice(2).includes('--md')) {
    const p = emitMarkdown(rep, path.join(__dirname, '定价体系-v3-数表.md'));
    console.log(`已写出 ${p}（${rep.cells.length} 格零售 + ${rep.payload.bands.length} 格批量带）`);
  } else {
    printReport(rep);
  }
}

module.exports = {
  main, selfCheck, emitMarkdown, segmentOf, SEGMENTS, RIDER_TIERS, CHANNELS, SEGMENT_SPEC,
  HOURS, BATCH_N, THRESHOLDS, TIER_BPS, IMMINENT_MM,
  PAYOUT_MAX, R_TARGET, MIN_COST_MARKUP, MIN_PREMIUM_ABS, PREMIUM_CAP,
  JUDGE_GAS, PAYOUT_GAS, MAX_BATCH_DISCOUNT_BPS, ceilTick,
};
