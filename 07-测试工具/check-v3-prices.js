#!/usr/bin/env node
/**
 * check-v3-prices.js —— v3 五维定价模块的**链上读回校验**（`10-金融与定价/v3-合约规格.md` §4 第 3 步）。
 *
 * 为什么必须真读链：v2 的「链上现行价」表曾经与实测不一致（表写错 / 链上没写上去 /
 * 写上去之后又被改回来），这三种情况里只有「真读链」能发现 —— AGENTS.md §4⑥ 就是为它写的。
 * 所以本脚本默认行为是**连 968 把 60 格的零售价 + 6 个 band 单价读回来逐格比**，
 * 而不是比两份文件。ABI 现编译自 `10-金融与定价/ref/PricingV3.sol`，不手抄（手抄的 ABI 是"看起来在验、
 * 其实在验自己"）。
 *
 * ⚠️ 比的是**冻结在链上那份规格**，不是 `10-金融与定价/pricing-engine.json`：
 * 那份 JSON 现在是 **v3 设计层**（2026-10-07 晚 B 按 GB/T 28592 重建为 12h/24h、40 格 / 120 行，
 * 见 `10-金融与定价/GB28592-12h24h重建-B给A-2026-10-07.md`），**没有部署** —— 968 上那份模块
 * 的 12h 行读回全是 0（2026-10-07 20:1x 只读实测），24h 行也比新表低 3~8%。所以本脚本的对照表
 * 固定在 `07-测试工具/fixtures/pricing-engine-deployed-968.json`（= 部署当时那份 JSON，
 * 取自提交 `7e05c6c^`，60 行 / 180 带 / 时长 24·48·72）。要给新表做自证，跑
 * `cd 10-金融与定价 && node ref/verify_pricing_v3.js`（真编译 + 内存链，687 项）。
 *
 * 用法：
 *   node check-v3-prices.js                  # 真读 968 上的定价模块：480 项比对
 *   node check-v3-prices.js --offline        # 不联网：只校验 fixture 自身的 60 行不变量
 *   node check-v3-prices.js --addr=0x...     # 换合约（默认就是 968 上部署的那一个）
 *   node check-v3-prices.js --spec=<路径>    # 换对照表；指向 v3 设计层那份 JSON 时**对不上是预期的**
 *                                            # （链上冻结的是旧规格），这种方式只用于看差异
 *
 * 968 需要代理（FlClash）：$env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://127.0.0.1:7890'
 *
 * 为什么不挂进 `npm test`：那一串离线门禁必须**拔网线也全绿**，而这个脚本的价值就在于真读链。
 * **需要 968 可达才跑**（代理设置见上面），所以只给了单独的 script：`npm run check:v3-prices`。
 * 塞进 `npm test` 等于让 CI 红给网络抖动看 —— 别这么做（A40②）。
 *
 * 补充（A40② 之后）：上面说的是**在线读链那条**。`--offline` 分支只读 fixture、不碰网络，
 * 已经挂进 `npm test`（script: `npm run check-v3-prices:offline`），在线那条仍然只在单跑。
 */
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, 'node_modules');
const solc = require(path.join(TOOLS, 'solc'));
const { ethers } = require(path.join(TOOLS, 'ethers'));

const ROOT = path.join(__dirname, '..');
// 对照表在 main() 里解析：默认 = 冻结在链上那份规格的 fixture（见文件头），--spec / V3_SPEC_JSON 可覆盖。
const SOL_PATH = path.join(ROOT, '10-金融与定价', 'ref', 'PricingV3.sol');
const MIN_PREMIUM = 20000000000000n; // 0.00002 ether

// 2026-10-07 部署到 BOT Chain 测试网 968 的 v3 定价模块（部署 tx 见
// 02-作战与答辩/汉客松-交易哈希清单.md §6）。--addr 或 PRICING_V3_ADDR 可覆盖。
const DEFAULT_ADDR = '0xB339EdA9d9491584716e9900c7bf2987cf4bfB5A';
const DEFAULT_RPC = 'https://rpc.bohr.life';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

function compileAbi() {
  const input = {
    language: 'Solidity',
    sources: { 'PricingV3.sol': { content: fs.readFileSync(SOL_PATH, 'utf8') } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi'] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  return out.contracts['PricingV3.sol'].PricingV3.abi;
}

/** `10-金融与定价/ref/apply-pricing-v3.js` 的同一套整理：60 条 {regionId, hours, segId, retailWei, bandWei[6]} */
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

/** 不联网的自证：60 行、每行 6 band、band0==零售、单调不增、≥MIN_PREMIUM */
function offlineCheck(rows) {
  let bad = 0;
  for (const r of rows) {
    if (r.bandWei.length !== 6 || r.bandWei.some((w) => w === null)) { console.error('band 不是 6 个:', r.key); bad++; continue; }
    if (r.retailWei !== 0n && r.bandWei[0] !== r.retailWei) { console.error('band0≠零售:', r.key); bad++; }
    for (let i = 1; i < 6; i++) if (r.bandWei[i] > r.bandWei[i - 1]) { console.error('band 非单调:', r.key, i); bad++; }
    for (const w of r.bandWei) if (w < MIN_PREMIUM) { console.error('band < MIN_PREMIUM:', r.key); bad++; }
  }
  return bad;
}

async function main() {
  const specPath = arg('spec', process.env.V3_SPEC_JSON || path.join(__dirname, 'fixtures', 'pricing-engine-deployed-968.json'));
  const rows = buildRows(JSON.parse(fs.readFileSync(specPath, 'utf8')));
  console.log(`对照表：${path.relative(ROOT, specPath).replace(/\\/g, '/')}`);
  console.log(`payload：${rows.length} 行（${rows.filter((r) => r.sellable).length} 可售 / ${rows.filter((r) => !r.sellable).length} 不卖）`);
  const offlineBad = offlineCheck(rows);
  console.log(`payload 自身不变量：${offlineBad ? `❌ ${offlineBad} 处不成立` : '✅ 通过'}`);
  if (offlineBad) process.exit(1);
  if (has('offline')) {
    console.log('\n--offline：只做上面的离线自证，不读链。');
    return;
  }

  const addr = arg('addr', process.env.PRICING_V3_ADDR || DEFAULT_ADDR);
  const rpc = arg('rpc', process.env.PRICING_V3_RPC || DEFAULT_RPC);
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  let net;
  try {
    net = await provider.getNetwork();
  } catch (e) {
    console.error(`\n❌ 连不上 ${rpc}：${e.shortMessage || e.message}`);
    console.error("   968 需要代理：$env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://127.0.0.1:7890'");
    process.exit(2);
  }
  const c = new ethers.Contract(addr, compileAbi(), provider);
  const code = await provider.getCode(addr);
  console.log(`\n链         : chainId ${Number(net.chainId)} · ${rpc}`);
  console.log(`合约       : ${addr}（运行时代码 ${(code.length - 2) / 2} 字节）`);
  if (code === '0x') { console.error('❌ 这个地址上没有合约（地址错了，或者部署没成功）'); process.exit(1); }

  const operator = await c.operator();
  console.log(`operator   : ${operator}${operator.toLowerCase() === '0xb466b1d1fa19026e08c3311c555d220ae2e1ba3a' ? '（= A 的部署账户）' : '⚠️ 不是预期账户'}`);

  let n = 0, bad = 0;
  for (const r of rows) {
    const onRetail = await c.retailOf(r.regionId, r.hours, r.segId);
    if (onRetail !== r.retailWei) { console.error(`零售价不符 ${r.key}: 链上 ${onRetail} vs 表 ${r.retailWei}`); bad++; }
    n++;
    const [price, sellable] = await c.quoteOrZero(r.regionId, r.hours, [2, 1, 1, 0][r.segId], [1, 1, 0, 0][r.segId], 1);
    if (sellable !== r.sellable) { console.error(`可售标记不符 ${r.key}: 链上 ${sellable} vs 表 ${r.sellable}`); bad++; }
    else if (sellable && price !== r.retailWei) { console.error(`premiumOf 不符 ${r.key}: 链上 ${price} vs 表 ${r.retailWei}`); bad++; }
    n++;
    for (let b = 0; b < 6; b++) {
      const on = await c.bandOfCell(r.regionId, r.hours, r.segId, b);
      if (on !== r.bandWei[b]) { console.error(`band 不符 ${r.key} band${b}: 链上 ${on} vs 表 ${r.bandWei[b]}`); bad++; }
      n++;
    }
  }
  console.log(`\n读回比对：${n} 项，${bad ? `❌ ${bad} 项不符` : '✅ 全部相符'}`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
