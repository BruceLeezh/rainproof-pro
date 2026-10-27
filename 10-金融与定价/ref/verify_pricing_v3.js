#!/usr/bin/env node
/**
 * 端到端核验：把 pricing-engine.json 的 payload 灌进参考合约，再逐格读回来比对。
 *
 * 本批口径（2 时长 / 2 赔付档 / 40 格）：
 *   · HOURS = [12, 24]（GB/T 28592-2012 §3 只定义这两档；48h/72h 随
 *     `thresholdOf(h) = 50 * h / 24` 线性外推一起作废）
 *   · 零售格 = 5 城 × 2 时长 × 4 seg = 40，**全部可售：不可售格数 = 0**
 *   · 批量行 = 5 城 × 2 时长 × 2 seg（channel=1）× 6 band = 120
 *   · meta.tierBps = [5000, 7500]（第三档特大暴雨 ≥140mm/≥250mm 本批不卖）
 *
 * 为什么要有这个文件：规格文件里的 Solidity 片段如果没人编译过，它就只是散文。
 * 本脚本做五件事 ——
 *   ① 校验 payload 的维度数（40 / 120 / 0 不可售）
 *   ② 真编译 `ref/PricingV3.sol`（solc，来自 07-测试工具/node_modules），
 *      在内存 ganache 上部署，用 40 次 setPremiumRow 写入全部零售价 + 批量带
 *   ③ 逐格读回 premiumOf() / retailOf() / bandOfCell()，与 payload 逐个比对
 *   ④ 反证：没写过的格必须 revert、非法 (riderTier,channel) 必须 revert、
 *      48h/72h 必须被 hoursAllowed 挡住、band 单调性写反必须 revert
 *   ⑤ 维度数：零售 40 / 批量 120 / 不可售 0（与合约常量对账）
 *
 * 用法：cd 10-金融与定价 && node ref/verify_pricing_v3.js
 *      （或从仓库根目录 node 10-金融与定价/ref/verify_pricing_v3.js —— 路径都按 __dirname 解析）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', '..', '07-测试工具', 'node_modules');
const solc = require(path.join(TOOLS, 'solc'));
const ethers = require(path.join(TOOLS, 'ethers'));
const ganache = require(path.join(TOOLS, 'ganache'));

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(__dirname, 'PricingV3.sol');
const PAYLOAD = JSON.parse(fs.readFileSync(path.join(ROOT, '10-金融与定价', 'pricing-engine.json'), 'utf8'));

let total = 0;
const fails = [];
const ok = (name, cond, detail) => { total++; if (!cond) fails.push(`${name}${detail ? ' — ' + detail : ''}`); };

const META = PAYLOAD.meta;
const BATCH_N = META.dimensions.batch;                                  // [1,10,50,100,500,1000]
const HOURS = META.dimensions.hours;                                    // [12,24]
const RETAIL = PAYLOAD.payload.retail;                                  // 40 行
const BANDS = PAYLOAD.payload.bands;                                    // 120 行
const BATCH_BANDS = PAYLOAD.payload.batchBands || PAYLOAD.batchBands;   // 6 行
const SEG_KEYS = ['t2c1', 't1c1', 't1c0', 't0c0'];
const CH = { t2c1: [2, 1], t1c1: [1, 1], t1c0: [1, 0], t0c0: [0, 0] };
const W = (x) => BigInt(x);
const bandOfJs = (n) => (n >= 1000 ? 5 : n >= 500 ? 4 : n >= 100 ? 3 : n >= 50 ? 2 : n >= 10 ? 1 : 0);

function compile() {
  const input = {
    language: 'Solidity',
    sources: { 'PricingV3.sol': { content: fs.readFileSync(SRC, 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error('solc: ' + errs.map((e) => e.formattedMessage).join('\n'));
  const c = out.contracts['PricingV3.sol'].PricingV3;
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}

/** 把 payload 折算成 40 行 setPremiumRow 的入参 */
function buildRows() {
  const rows = [];
  for (const r of RETAIL) {
    const bands = new Array(BATCH_N.length).fill(0n);
    if (r.sellable) {
      const mine = BANDS.filter((b) => b.regionId === r.regionId && b.hours === r.hours && b.segId === r.segId);
      for (let i = 0; i < BATCH_N.length; i++) {
        const hit = mine.find((b) => b.bandIndex === i);
        // 自助投保渠道（seg 2/3）没有批量行 → 6 档全等于零售价（单调性成立且等价于"无折扣"）
        bands[i] = hit ? W(hit.premiumWei) : W(r.premiumWei);
      }
      bands[0] = W(r.premiumWei); // band0 必须等于零售
    } else {
      // 不卖的格：合约只认 retail==0 作哨兵，band 值填地板即可（读价时先 revert）
      // 本批 0 行走这里 —— 分支留着，因为 payload.note 明确说"若出现不可售格"仍要这么写。
      bands.fill(20000000000000n); // 0.00002 ether
    }
    rows.push({ ...r, bands });
  }
  return rows;
}

async function main() {
  // ── ⓪ payload 维度：2 时长 / 2 赔付档 / 40 格 / 120 批量行 / 0 不可售 ─────
  ok('meta.dimensions.hours = [12,24]（国标只有这两档）',
    JSON.stringify(HOURS) === '[12,24]', JSON.stringify(HOURS));
  ok('meta.tierBps = [5000,7500]（2 档；第三档特大暴雨不卖）',
    JSON.stringify(META.tierBps) === '[5000,7500]', JSON.stringify(META.tierBps));
  ok('meta.thresholdsMm 12h=[30,70] / 24h=[50,100]（GB/T 28592-2012 表 1）',
    JSON.stringify(META.thresholdsMm) === '{"12":[30,70],"24":[50,100]}', JSON.stringify(META.thresholdsMm));
  ok('零售格数 = 40（5 城 × 2 时长 × 4 seg）', RETAIL.length === 40, `${RETAIL.length}`);
  ok('零售格 (regionId,hours,segId) 去重后 = 40',
    new Set(RETAIL.map((r) => `${r.regionId}|${r.hours}|${r.segId}`)).size === 40);
  const unsellable = RETAIL.filter((r) => !r.sellable);
  ok('不可售格数 = 0', unsellable.length === 0,
    unsellable.map((r) => `${r.regionKey}/${r.hours}/${r.segKey}`).join(' '));
  ok('retail 的 hours 集合 = {12,24}',
    JSON.stringify([...new Set(RETAIL.map((r) => r.hours))]) === '[12,24]');
  ok('retail 的 regionId 集合 = {1,2,3,4,5}',
    JSON.stringify([...new Set(RETAIL.map((r) => r.regionId))]) === '[1,2,3,4,5]');
  ok('segId → segKey 与引擎顺序逐字一致（0=t2c1 1=t1c1 2=t1c0 3=t0c0）',
    RETAIL.every((r) => SEG_KEYS[r.segId] === r.segKey));
  ok('批量价行数 = 120', BANDS.length === 120, `${BANDS.length}`);
  ok('批量行只出现在 channel=1（segId ∈ {0,1}）', BANDS.every((b) => b.segId === 0 || b.segId === 1));
  const groups = new Map();
  for (const b of BANDS) {
    const k = `${b.regionId}|${b.hours}|${b.segId}`;
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  ok('批量带分组数 = 20（5 城 × 2 时长 × 2 seg），每组 6 档',
    groups.size === 20 && [...groups.values()].every((n) => n === 6), `${groups.size} 组`);
  ok('batchBands = 6 档，NMax/bandIndex 与 BATCH_N 一致',
    BATCH_BANDS.length === 6 && BATCH_BANDS.every((b, i) => b.NMax === BATCH_N[i] && b.bandIndex === i));
  ok('payload 的 bandIndex 与合约 bandOf 口径逐行一致',
    BANDS.every((b) => bandOfJs(b.nMax) === b.bandIndex));

  // ── ① 编译 + 部署 ────────────────────────────────────────────────────────
  const { abi, bytecode } = compile();
  ok('solc 编译通过且产出了 bytecode', bytecode.length > 100);

  const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' } }));
  const signer = await provider.getSigner(0);
  const c = await new ethers.ContractFactory(abi, bytecode, signer).deploy();
  await c.waitForDeployment();
  ok('合约部署成功', !!(await c.getAddress()));

  ok('合约常量对账：HOURS_COUNT=2 / SEGMENT_COUNT=4 / BAND_COUNT=6 / RETAIL_CELL_COUNT=40 / BAND_CELL_COUNT=120',
    (await c.HOURS_COUNT()) === 2n && (await c.SEGMENT_COUNT()) === 4n && (await c.BAND_COUNT()) === 6n
    && (await c.RETAIL_CELL_COUNT()) === 40n && (await c.BAND_CELL_COUNT()) === 120n);
  ok('hoursAllowed：12/24 放行，36/48/72 拦住（旧 48h/72h 档必须写不进去）',
    (await c.hoursAllowed(12)) === true && (await c.hoursAllowed(24)) === true
    && (await c.hoursAllowed(36)) === false && (await c.hoursAllowed(48)) === false
    && (await c.hoursAllowed(72)) === false);

  // ── ② 写 40 行 ───────────────────────────────────────────────────────────
  const rows = buildRows();
  ok('待写入行数 = 40', rows.length === 40, `${rows.length}`);
  const REASON = ethers.id('rainproof/pricing-v3@1');
  for (const r of rows) {
    await (await c.setPremiumRow(r.regionId, r.hours, r.segId, r.sellable ? W(r.premiumWei) : 0n, r.bands, REASON)).wait();
  }
  ok('40 行全部写入成功', true);

  // ── ③ 逐格读回零售价（premiumOf 入口）────────────────────────────────────
  const CH_ = CH;
  for (const r of rows) {
    const [rt, ch] = CH_[r.segKey];
    const tag = `[${r.regionKey} ${r.hours}h ${r.segKey}]`;
    if (r.sellable) {
      const got = await c.premiumOf(r.regionId, r.hours, rt, ch, 1);
      ok(`${tag} 零售价读回 = payload`, got === W(r.premiumWei), `${got} vs ${r.premiumWei}`);
    } else {
      let reverted = false;
      try { await c.premiumOf(r.regionId, r.hours, rt, ch, 1); } catch { reverted = true; }
      ok(`${tag} 不可售格必须 revert（不许回退报价）`, reverted);
    }
  }

  // ── ④ 逐格读回 120 个批量价（premiumOf 入口）─────────────────────────────
  let bandChecked = 0;
  for (const r of rows) {
    if (!r.sellable) continue;
    const [rt, ch] = CH_[r.segKey];
    const mine = BANDS.filter((b) => b.regionId === r.regionId && b.hours === r.hours && b.segId === r.segId);
    for (const b of mine) {
      const got = await c.premiumOf(r.regionId, r.hours, rt, ch, W(b.nMax));
      ok(`[${r.regionKey} ${r.hours}h ${r.segKey}] N=${b.nMax} 批量价读回`,
        got === W(b.premiumWei), `${got} vs ${b.premiumWei}`);
      bandChecked++;
    }
  }
  ok('批量价核验行数 = 120', bandChecked === 120, `${bandChecked}`);
  ok('payload 里批量行数 = 120', BANDS.length === 120, `${BANDS.length}`);

  // ── ⑤ 直接 getter：retailOf / bandOfCell（band=5 正是当年 Panic 的那一档）
  for (const r of rows) {
    const got = await c.retailOf(r.regionId, r.hours, r.segId);
    ok(`[${r.regionKey} ${r.hours}h ${r.segKey}] retailOf() 读回`,
      got === (r.sellable ? W(r.premiumWei) : 0n), `${got}`);
    for (let b = 0; b < 6; b++) {
      const gb = await c.bandOfCell(r.regionId, r.hours, r.segId, b);
      ok(`[${r.regionKey} ${r.hours}h ${r.segKey}] bandOfCell(${b}) 读回`,
        gb === r.bands[b], `${gb} vs ${r.bands[b]}`);
    }
  }

  // band 单调：份数越多单价不增
  for (const r of rows) {
    if (!r.sellable) continue;
    const [rt, ch] = CH_[r.segKey];
    let prev = null;
    for (const n of BATCH_N) {
      const p = await c.premiumOf(r.regionId, r.hours, rt, ch, W(n));
      if (prev !== null) ok(`[${r.regionKey} ${r.hours}h ${r.segKey}] N=${n} 单价不高于上一档`, p <= prev, `${p} > ${prev}`);
      prev = p;
    }
  }

  // ── ⑥ 反证 ───────────────────────────────────────────────────────────────
  const reverts = async (fn) => { try { await fn(); return false; } catch { return true; } };
  ok('(2,0) 团体·自助 非法', await reverts(() => c.segmentId(2, 0)));
  ok('(0,1) 众包·平台代付 非法', await reverts(() => c.segmentId(0, 1)));
  ok('(2,2) 非法', await reverts(() => c.segmentId(2, 2)));
  ok('(1,2) 非法（channel=2 预警增保已下线）', await reverts(() => c.segmentId(1, 2)));
  ok('(0,2) 非法（channel=2 预警增保已下线）', await reverts(() => c.segmentId(0, 2)));
  ok('segmentId(2,1)=0', (await c.segmentId(2, 1)) === 0n);
  ok('segmentId(1,1)=1', (await c.segmentId(1, 1)) === 1n);
  ok('segmentId(1,0)=2', (await c.segmentId(1, 0)) === 2n);
  ok('segmentId(0,0)=3', (await c.segmentId(0, 0)) === 3n);
  ok('bandOf(1)=0 / (10)=1 / (50)=2 / (100)=3 / (500)=4 / (1000)=5',
    (await c.bandOf(1)) === 0n && (await c.bandOf(10)) === 1n && (await c.bandOf(50)) === 2n
    && (await c.bandOf(100)) === 3n && (await c.bandOf(500)) === 4n && (await c.bandOf(1000)) === 5n);
  ok('bandOf 边界：9→0, 49→1, 99→2, 499→3, 999→4',
    (await c.bandOf(9)) === 0n && (await c.bandOf(49)) === 1n && (await c.bandOf(99)) === 2n
    && (await c.bandOf(499)) === 3n && (await c.bandOf(999)) === 4n);

  // MIN_PREMIUM 必须是 0.00002：拿本批最低批量价写入，若还是 v2 的 0.0002
  // 这里就会 revert —— 这正是本次改造的核心原因之一。
  const lowest = rows.filter((r) => r.sellable).map((r) => r.bands[5]).reduce((a, b) => (a < b ? a : b));
  ok('最低批量价 < v2 的 MIN_PREMIUM(0.0002) —— 故 v2 必然拒绝', lowest < 200000000000000n, `${lowest} wei`);

  // 单调性反证：band 必须"份数越多单价不增"。数值必须落在 [MIN_PREMIUM, PAYOUT_MAX)，
  // 否则会先被范围检查 revert，测不到单调性这一条。
  const DEC = 1000000000000n, R0 = 340000000000000n;
  const good = new Array(6).fill(0n).map((_, i) => R0 - BigInt(i) * DEC);       // 递减 → 合法
  ok('合法递减 band 可写入', !(await reverts(() => c.setPremiumRow.staticCall(1, 24, 0, R0, good, REASON))));
  const badInc = new Array(6).fill(0n).map((_, i) => R0 + BigInt(i) * DEC);     // 递增 → 非法
  ok('递增（违反"份数越多单价不增"）必须 revert', await reverts(() => c.setPremiumRow.staticCall(1, 24, 0, R0, badInc, REASON)));
  const belowMin = new Array(6).fill(1000n);                                     // 低于 MIN_PREMIUM → 非法
  ok('低于 MIN_PREMIUM 的 band 必须 revert', await reverts(() => c.setPremiumRow.staticCall(1, 24, 0, 1000n, belowMin, REASON)));
  const aboveMax = new Array(6).fill(20000000000000000n);                        // ≥ PAYOUT_MAX → 非法
  ok('≥ PAYOUT_MAX 的零售价必须 revert', await reverts(() => c.setPremiumRow.staticCall(1, 24, 0, 20000000000000000n, aboveMax, REASON)));
  const band0Mismatch = [R0 + DEC, R0, R0, R0, R0, R0];                           // band0 ≠ 零售 → 非法
  ok('band[0] ≠ 零售价必须 revert', await reverts(() => c.setPremiumRow.staticCall(1, 24, 0, R0, band0Mismatch, REASON)));
  ok('bad region（regionId=0 / 6）必须 revert',
    (await reverts(() => c.setPremiumRow.staticCall(0, 24, 0, R0, good, REASON)))
    && (await reverts(() => c.setPremiumRow.staticCall(6, 24, 0, R0, good, REASON))));
  ok('bad seg（segId=4）必须 revert', await reverts(() => c.setPremiumRow.staticCall(1, 24, 4, R0, good, REASON)));
  // 本改写新增：48h/72h 这两档已经不存在，写价必须被挡在 hoursAllowed
  ok('写价 48h 必须 revert（48h 档已作废）', await reverts(() => c.setPremiumRow.staticCall(1, 48, 0, R0, good, REASON)));
  ok('写价 72h 必须 revert（72h 档已作废）', await reverts(() => c.setPremiumRow.staticCall(1, 72, 0, R0, good, REASON)));

  // ── ⑦ 保留的"不卖格"revert 路径（本批 0 格触发，但性质必须成立）────────
  // 用没写过的 (region, hours, seg) = (2, 48, t2c1)：48h 本批不合法 → 该格永不被写，
  // 于是 _retail 恒为 0 —— 正是 payload.note 说的 "premiumWei=0 必须 revert" 那条路径。
  ok('没写过的格 premiumOf 必须 revert（不许回退报价）', await reverts(() => c.premiumOf(2, 48, 2, 1, 1)));
  const q0 = await c.quoteOrZero(2, 48, 2, 1, 1);
  ok('没写过的格 quoteOrZero → (0,false)', q0[0] === 0n && q0[1] === false);
  ok('非法 (riderTier,channel) 时 quoteOrZero → (0,false)',
    (await c.quoteOrZero(1, 24, 2, 0, 1))[1] === false);
  const q2 = await c.quoteOrZero(2, 24, 2, 1, 1);
  ok('上海 24h 平台团体 quoteOrZero → sellable=true 且价 = payload',
    q2[1] === true && q2[0] === W(rows.find((r) => r.regionKey === 'shanghai' && r.hours === 24 && r.segKey === 't2c1').premiumWei));

  console.log(`\n自检结果：${total} 项断言，${fails.length === 0 ? '全部通过' : fails.length + ' 项失败'}`);
  console.log(`维度：零售 ${RETAIL.length} 格（可售 ${RETAIL.filter((r) => r.sellable).length} / 不可售 ${unsellable.length}）、批量 ${BANDS.length} 行、赔付 ${META.tierBps.length} 档、时长 [${HOURS}]`);
  fails.forEach((f) => console.log('  FAIL  ' + f));
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
