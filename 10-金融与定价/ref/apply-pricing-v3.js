#!/usr/bin/env node
/**
 * apply-pricing-v3.js —— 把 pricing-engine.json 里的 v3 定价表写进链上，再读回来逐格验。
 *
 * ⚠️ 这是 B 侧交给 A 的**执行器**，不是 B 自己跑的东西。
 *    AGENTS.md §3：任何链上写操作 = A 独占。B 不执行 --apply。
 *
 * 用法（在 10-金融与定价/ 下）：
 *   node ref/apply-pricing-v3.js --addr=0x...              # 干跑：打印 40 笔调用 + gas 估算，不发交易
 *   node ref/apply-pricing-v3.js --addr=0x... --apply      # 真发 40 笔 setPremiumRow（A 执行）
 *   node ref/apply-pricing-v3.js --addr=0x... --verify     # 只读：把 40 零售 + 120 band 读回来比对
 *
 * 为什么不自己写 ABI：ABI 从 PricingV3.sol 现编译出来，不手抄 —— 手抄的 ABI 与
 * 合约不同步，是最经典的一种"看起来在验、其实在验自己"。
 */
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', '..', '07-测试工具', 'node_modules');
const solc = require(path.join(TOOLS, 'solc'));
const { ethers } = require(path.join(TOOLS, 'ethers'));

const JSON_PATH = path.join(__dirname, '..', 'pricing-engine.json');
const SOL_PATH = path.join(__dirname, 'PricingV3.sol');
const MIN_PREMIUM = 20000000000000n; // 0.00002 ether，与 PricingV3.sol 一致

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

function compileAbi() {
  const input = {
    language: 'Solidity',
    sources: { 'PricingV3.sol': { content: fs.readFileSync(SOL_PATH, 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  return out.contracts['PricingV3.sol'].PricingV3.abi;
}

/** 把 payload 整理成 40 条 {regionId, hours, segId, retailWei, bandWei[6]} */
function buildRows(p) {
  const bandsOf = new Map();
  for (const b of p.payload.bands) {
    const k = `${b.regionId}|${b.hours}|${b.segId}`;
    if (!bandsOf.has(k)) bandsOf.set(k, new Array(6).fill(null));
    bandsOf.get(k)[b.bandIndex] = BigInt(b.premiumWei);
  }
  return p.payload.retail.map((r) => {
    const k = `${r.regionId}|${r.hours}|${r.segId}`;
    const retailWei = BigInt(r.premiumWei);
    // 不卖的格：retailWei=0，band 全填 MIN_PREMIUM（合约要求 band ∈ [MIN, PAYOUT_MAX)）。
    // premiumOf() 在读到 retail==0 时就 revert("not offered")，band 值不会被用到。
    const bandWei =
      retailWei === 0n
        ? new Array(6).fill(MIN_PREMIUM)
        : bandsOf.get(k) || new Array(6).fill(retailWei);
    return {
      regionId: r.regionId,
      hours: r.hours,
      segId: r.segId,
      key: `${r.regionKey} ${r.hours}h ${r.segKey}`,
      sellable: r.sellable,
      retailWei,
      bandWei,
    };
  });
}

async function main() {
  const p = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const rows = buildRows(p);
  const abi = compileAbi();

  // 本地先自证：40 行、每行 6 band、band0==retail、单调不增
  let bad = 0;
  for (const r of rows) {
    if (r.bandWei.length !== 6) { console.error('band 数不是 6:', r.key); bad++; continue; }
    if (r.retailWei !== 0n && r.bandWei[0] !== r.retailWei) { console.error('band0≠零售:', r.key); bad++; }
    for (let i = 1; i < 6; i++) if (r.bandWei[i] > r.bandWei[i - 1]) { console.error('band 非单调:', r.key, i); bad++; }
    for (const w of r.bandWei) if (w < MIN_PREMIUM) { console.error('band < MIN_PREMIUM:', r.key); bad++; }
  }
  console.log(`payload：${rows.length} 行（${rows.filter((r) => r.sellable).length} 可售 / ${rows.filter((r) => !r.sellable).length} 不卖），本地校验${bad ? `发现 ${bad} 处问题` : '通过'}`);
  if (bad) process.exit(1);

  const addr = arg('addr', process.env.PRICING_V3_ADDR);
  if (!addr) {
    console.log('\n未给 --addr，只做离线自证。40 条调用清单（前 8 条）：');
    for (const r of rows.slice(0, 8)) console.log(`  setPremiumRow(${r.regionId}, ${r.hours}, ${r.segId}, ${r.retailWei}, [${r.bandWei.join(', ')}])  // ${r.key}`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');
  const signer = await provider.getSigner(Number(arg('signer', '0')));
  const c = new ethers.Contract(addr, abi, signer);
  // reasonHash：与 04-脚本/set-premium.js 同一套纪律 —— 依据串可复算
  const reasonHash = ethers.id(
    `rainproof/premium-v3|source=10-金融与定价/pricing-engine.json|segments=4|bands=6|minPremium=0.00002|tick=0.00001`
  );

  if (has('verify')) {
    let n = 0, bad2 = 0;
    for (const r of rows) {
      const [price, sellable] = await c.quoteOrZero(r.regionId, r.hours, [2, 1, 1, 0][r.segId], [1, 1, 0, 0][r.segId], 1);
      n++;
      if (sellable !== r.sellable) { console.error(`可售标记不符 ${r.key}`); bad2++; }
      else if (sellable && price !== r.retailWei) { console.error(`零售价不符 ${r.key}: 链上 ${price} vs 表 ${r.retailWei}`); bad2++; }
      for (let b = 0; b < 6; b++) {
        const on = await c.bandOfCell(r.regionId, r.hours, r.segId, b);
        if (on !== r.bandWei[b]) { console.error(`band 不符 ${r.key} band${b}: 链上 ${on} vs 表 ${r.bandWei[b]}`); bad2++; }
        n++;
      }
    }
    console.log(`\n读回比对：${n} 项，${bad2 ? `${bad2} 项不符` : '全部相符'}`);
    process.exit(bad2 ? 1 : 0);
  }

  if (!has('apply')) {
    // 干跑：估 gas，不发
    let gas = 0n;
    for (const r of rows) {
      const g = await c.setPremiumRow.estimateGas(r.regionId, r.hours, r.segId, r.retailWei, r.bandWei, reasonHash);
      gas += g;
    }
    console.log(`\n干跑：40 笔 setPremiumRow，估算总 gas ${gas}（加 3 成余量 ${(gas * 13n) / 10n}）。`);
    console.log('确认无误后由 A 加 --apply 执行。');
    return;
  }

  console.log('\n--apply：开始发 40 笔 setPremiumRow');
  let done = 0;
  for (const r of rows) {
    const tx = await c.setPremiumRow(r.regionId, r.hours, r.segId, r.retailWei, r.bandWei, reasonHash, {
      gasLimit: 400000n, // 别让 ethers 拿 estimateGas 的裸值当上限（本仓有过双峰估 gas 的前科）
    });
    await tx.wait();
    done++;
    if (done % 10 === 0) console.log(`  ${done}/40`);
  }
  console.log('40 格写完。请再跑一次 --verify 读回比对。');
}

main().catch((e) => { console.error(e); process.exit(1); });
