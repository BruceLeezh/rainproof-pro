// 生成 05-演示站点/frozen-node.js —— 一份「链上快照」，让两个页面在完全不联网时也能显示主网 677 的真实读数。
//
// 为什么需要它：国内直连 rpc.botchain.ai / scan.botchain.ai 连 TCP 都不通（2026-10-11 实测），
// Vercel 中转的域名 vercel.app 在国内被 DNS 污染、第三方网关要么不认这条链（thirdweb）要么要付费/key
// （Ankr: 匿名调用 403）。而按现行规划，**评委默认在外网**用官方节点（第一层），所以这份快照只做最低兜底：
// 连不上任何节点时才用，界面上如实标「链上快照」，绝不假装是实时数据。
//
// 两种跑法：
//   ① node make-frozen-node.js --from-rpc            # 能连主网时（或走代理）：真抓一份，最完整
//   ② node make-frozen-node.js --rebuild             # 连不上时：用下面 VALUES 里已核实的读数重建一份
// 两者写出的文件结构完全相同；meta.source 会如实写明是哪一种。
//
// 事件抓取范围（只对 --from-rpc 有意义，2026-10-12 改）：
//   --from-block=N   从哪块开始抓（默认 = 部署块 25,921,072，见 DEPLOY_BLOCK）
//   --page=M         每页多少块（默认 10,000）—— getLogs 一块一块地要，不再 fromBlock:0 全历史拉一次
//   --range=R        最多往前抓多少块（默认 200,000 ≈ 主网当前 4 个月）；超了直接报错，不偷偷截断
//
// 文件里有两套视图，一份数据喂两个页面：
//   · calls / logs / blocks / code —— 给 05-演示站点/index.html（走 ethers 的 FrozenProvider）
//   · rpc                        —— 给 05-演示站点/verifier.html（它直接用 fetch 发 raw JSON-RPC）
// verifier 只覆盖**读操作**（地址/代码/余额/区块/事件）；交易详情与回执不在快照范围里，
// 那一页在快照模式下会明说「交易级核验需要能连主网的网络」，而不是编一个 nonce 出来。
const fs = require("fs");
const path = require("path");
const CWD = path.resolve(__dirname, "..");           // 仓库根（07-测试工具/..）
const ABI_PATH = path.join(CWD, "03-合约", "RainDeliveryInsuranceV3.abi.json");
const BYTECODE_PATH = path.join(CWD, "03-合约", "RainDeliveryInsuranceV3.bytecode.txt");
const OUT = path.join(CWD, "05-演示站点", "frozen-node.js");

const { ethers } = require("ethers");

// ---------------------------------------------------------------- 已核实的读数
// 全部来自 2026-10-08 的链上复核（见 08-截图存证/链上留痕-主网677-v3部署.md），不是估的。
const ADDR = "0x89e7C942535930B61cB61631051E8b0bD670596a";
const MULTISIG = "0x676b791da72Ef072718c9f078377bF21be1b160f";
const DEPLOYER = "0xb466B1D1fA19026e08C3311C555d220AE2E1Ba3a";
const E = (n) => ethers.parseEther(String(n));
const VALUES = {
  // 快照的「取景高度」：必须**晚于**所有烘进来的读数，否则快照自己前后矛盾。
  // 现存最晚的一条是 10-08 13:2x 的两笔测试投保 + 退保（区块 25,950,527 / 25,950,537）⇒ nextPolicyId=2、敞口归零。
  blockNumber: 25950600,
  regions: ["wuhan", "shanghai", "beijing", "guangzhou", "chengdu"],
  rainfall: [67, 128, 39, 162, 0],  // 成都被三模型闸门拒收 ⇒ 链上仍是 0
  // 喂价时刻（2026-10-08 +0800，来自 state677 只读探针的链上输出）
  lastFeedAt: ["2026-10-08T10:12:31+08:00", "2026-10-08T10:12:49+08:00", "2026-10-08T10:15:24+08:00", "2026-10-08T10:18:38+08:00", null]
    .map((s) => (s ? Math.floor(Date.parse(s) / 1000) : 0)),
  grid: { 1: [0.00076, 0.00105], 2: [0.00059, 0.00070], 3: [0.00053, 0.00068], 4: [0.00077, 0.00097], 5: [0.00075, 0.00099] },
  thresholds: { 12: [30, 60], 24: [50, 100] },
  pool: 0.05,
  nextPolicyId: 2,
  openExposure: 0,
  codeLength: 15823,
  gasPrice: "0x4a817c800",        // 20 Gwei——2026-10-08 部署回执的 effectiveGasPrice
  contractNonce: "0x1",           // 核验台在 677 上读到「发过多少笔交易 = 1」（那 1 笔就是部署）
};

// 运行时字节码：直接从仓库编译产物里取尾部 codeLength 字节。
// 部署脚本读的就是同一份产物（04-脚本/deploy.js 只从 03-合约/ 取），链上实测长度 15,823 字节与之一致；
// 取它而不是填零，是为了让「快照里的代码」与「链上的代码」至少在同一份产物上对得上（见 verify-deployed-source.js）。
function runtimeFromArtifact() {
  const raw = fs.readFileSync(BYTECODE_PATH, "utf8").trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(raw)) throw new Error("bytecode.txt 不是纯十六进制：" + BYTECODE_PATH);
  if (raw.length < VALUES.codeLength * 2) throw new Error("bytecode.txt 太短，取不出 " + VALUES.codeLength + " 字节运行时");
  return "0x" + raw.slice(raw.length - VALUES.codeLength * 2);
}

function buildCalls(iface) {
  const calls = {};   // "to:data" -> 结果 hex 或 {revert:true}
  const put = (sig, args, value, kind) => {
    const data = iface.encodeFunctionData(sig, args).toLowerCase();
    const key = ADDR.toLowerCase() + ":" + data;
    calls[key] = kind === "revert" ? { revert: true } : iface.encodeFunctionResult(sig, value);
  };
  const V = VALUES;
  put("REGION_COUNT", [], [V.regions.length]);
  V.regions.forEach((name, i) => put("regionName", [i + 1], [name]));
  put("MIN_PREMIUM", [], [20000000000000n]);
  put("PREMIUM_DEFAULT", [], [E(0.001)]);
  put("PAYOUT_MAX", [], [E(0.01)]);
  put("MIN_HOURS", [], [12]);
  put("MAX_HOURS", [], [24]);
  put("TIER_COUNT", [], [2]);
  put("coolingPeriod", [], [259200]);
  put("paused", [], [false]);
  put("operator", [], [MULTISIG]);
  put("poolBalance", [], [E(V.pool)]);
  put("nextPolicyId", [], [V.nextPolicyId]);
  put("openExposure", [], [E(0)]);
  V.rainfall.forEach((mm, i) => put("rainfall", [i + 1], [mm]));
  V.lastFeedAt.forEach((t, i) => put("lastFeedAt", [i + 1], [t]));
  Object.keys(V.thresholds).forEach((h) => {
    put("entryThresholdOf", [Number(h)], [V.thresholds[h][0]]);
    // ★ 只烘 **677 上的 v3** 形状（03-合约/RainDeliveryInsuranceV3.abi.json）。
    //   v2（968 上的历史留痕）没有 entryThresholdOf，thresholdOf 也不同参：v2 是 thresholdOf(uint256)，
    //   v3 是 thresholdOf(uint256,uint8) —— 想烘 v2 得把 ABI_PATH 换成 V2 的并改掉这里的调用清单。
    //   本快照的 meta.chainId 就写死 677，所以这里**故意**不做版本参数化（YAGNI）：一个快照只服务一条链。
    put("thresholdOf", [Number(h), 0], [V.thresholds[h][0]]);
    put("thresholdOf", [Number(h), 1], [V.thresholds[h][1]]);
  });
  put("hoursAllowed", [12], [true]);
  put("hoursAllowed", [24], [true]);
  put("hoursAllowed", [48], null, "revert");   // v3 只卖 12/24：链上真的 revert，快照也必须 revert
  put("hoursAllowed", [72], null, "revert");
  Object.keys(V.grid).forEach((r) => {
    [12, 24].forEach((h, k) => {
      put("premiumOf(uint8,uint256,uint8,uint8,uint256)", [Number(r), h, 0, 0, 1], [E(V.grid[r][k])]);
    });
  });
  return calls;
}

// 事件纸带：state677 只读探针抓到的 8 条（自部署起，区块 25,921,072 – 25,922,010，最高那条 = 25,922,010）。
// 类型只有 OperatorChanged ×1 / RainfallUpdated ×5 / FeedRejected ×1 / PoolFunded ×1 ——
// **没有** PolicyBought / ClaimPaid / PolicyRefunded（这个地址上至今没有投保/理赔的链上事件，别往纸带里加）。
// （旧注释写「在区块 25,922,351 上抓到」：那个数字是探针当时的链尖，文件里一条事件都不在那个高度上，已按实际高度改准。）
// 交易哈希、区块号、**以及 evidenceHash** 都是链上原样（原来这里用假哈希占位，2026-10-11 换成探针读到的真值）。
// 成都那条是 FeedRejected（三模型闸门拒收的留痕）。
// 下游依赖：07-测试工具/check-frozen-node.js:78-79 断言 logs ≥8 且含 FeedRejected —— 改这里要连它一起想。
function buildLogs(iface) {
  const ev = (name, args, txHash, blockNumber) => {
    const { topics, data } = iface.encodeEventLog(name, args);
    return { address: ADDR, topics, data, blockNumber: "0x" + blockNumber.toString(16), transactionHash: txHash, logIndex: "0x0", removed: false, blockHash: null };
  };
  return [
    ev("OperatorChanged", ["0x0000000000000000000000000000000000000000", DEPLOYER], "0x54fc1e694748338d63a2e9f6f46cf2c8623eaa141b71a10904a7b56dc3b9f436", 25921072),
    ev("RainfallUpdated", [1, 67, "0x226621c35d3809f38415102ac90d46164b519dd55db7cf1a1ed3003ee3989b0b", 84, DEPLOYER], "0x1d5384ce45c70042f3bb7744120ede46e6f6a936d358eb4c89f822fb5678d8af", 25921521),
    ev("RainfallUpdated", [2, 128, "0x4db5cfc362c5a679b4006566e9db4d58f388f6f1538bd0f3fffca5ab98b60129", 88, DEPLOYER], "0x377fc38670443cfaabb753d04cbdb5845af51897ce796ed9a6dd86951b6bfe84", 25921545),
    ev("RainfallUpdated", [3, 39, "0xe82e48f71ec9af75c42bb64c852ce6640520b24e24867c671be12c5b37aa819a", 84, DEPLOYER], "0x7ca72ceb8d279828e866425885a9725bc6c9cc28e44109bba46f46eb5a1b4d8e", 25921751),
    ev("FeedRejected", [5, 40, 3, "0x801d0fd236a7fcd9c3330cbcb67bc760dda38d158627a9cc2434273ec3216ca4", "rain-oracle-v1"], "0x25383509ce33c3a84526889bf4e7ed0fb968af2dfe3ad13d100f73500ae3f956", 25921810),
    ev("PoolFunded", [DEPLOYER, E(0.05), E(0.05)], "0xe36da83a8a107d8fe4e90c998a9d012a2a69ee46ee6831ea2cebd8e208dff9aa", 25921887),
    ev("RainfallUpdated", [4, 162, "0x94b8d347e67adec99a2d056a68462b46b46bce18418c07a4045c6e0262e2ac9e", 84, DEPLOYER], "0x57c9daecbf02ffa70ecc16bcd13bdf67bd1ebeda6886a388b2e363f7b24238e1", 25921931),
    ev("RainfallUpdated", [4, 162, "0x94b8d347e67adec99a2d056a68462b46b46bce18418c07a4045c6e0262e2ac9e", 84, DEPLOYER], "0x46c4313b32961b5adc81d2bb4dcededef5a745c2ba91af253fe05018a2041f7e", 25922010),
  ];
}

// 事件纸带要按区块读时间戳。只给**确凿知道的**那几条（见 state677 输出的四次喂价链上时刻）——
// 注意纸带里有 5 条 RainfallUpdated，最后一条（区块 25,922,010，广州那次重试）**没有**确凿时间，所以下表只有 4 条。
// 其余区块（部署 25,921,072、成都拒收 25,921,810、注池 25,921,887、广州重试 25,922,010）都没有确凿时间，
// 宁可不给：页面会显示「—」，不编一个看起来像真的时间。
// 下游依赖：check-frozen-node.js:80 断言 blocks ≥4、:81 断言时间戳落在 1760000000–1800000000。
function buildBlocks() {
  const KNOWN = {
    25921521: "2026-10-08T10:12:31+08:00",   // 武汉 RainfallUpdated
    25921545: "2026-10-08T10:12:49+08:00",   // 上海
    25921751: "2026-10-08T10:15:24+08:00",   // 北京
    25921931: "2026-10-08T10:18:38+08:00",   // 广州
  };
  const out = {};
  for (const k of Object.keys(KNOWN)) out[k] = Math.floor(Date.parse(KNOWN[k]) / 1000);
  return out;
}

// verifier.html 用的 raw JSON-RPC 视图（只覆盖读操作）。
function buildRpc({ blockNumber, code, blocks, balance, transactionCount, address }) {
  const asHex = (n) => "0x" + BigInt(n).toString(16);
  const out = {
    chainId: "0x2a5",                 // 677
    blockNumber: asHex(blockNumber),
    gasPrice: VALUES.gasPrice,
    accounts: { [String(address).toLowerCase()]: { balance, transactionCount } },
    blocks: {},
  };
  for (const k of Object.keys(blocks || {})) {
    out.blocks[asHex(Number(k))] = { number: asHex(Number(k)), timestamp: asHex(blocks[k]) };
  }
  out.code = code;
  return out;
}

// 纸带里到底有哪几类事件（topic0 反查 ABI，不手抄）—— meta.note 用它，免得写着「含 X」而实际没有
function eventTypes(logs, iface) {
  const name = (t0) => {
    for (const f of iface.fragments) if (f.type === "event" && f.topicHash.toLowerCase() === String(t0).toLowerCase()) return f.name;
    return "未知事件(" + t0 + ")";
  };
  const counts = {};
  for (const l of logs) { const n = name(l.topics[0]); counts[n] = (counts[n] || 0) + 1; }
  return Object.entries(counts).map(([n, c]) => n + " ×" + c).join("、");
}

// ---------------------------------------------------------------- 事件抓取的范围控制（2026-10-12）
// 以前是 `getLogs({ address, fromBlock: 0, toBlock: "latest" })` —— 一次把这条链**全历史**的事件都要回来，
// 公共 RPC 不是超时就是限流（真要跑，也该让人显式选范围）。现在：从部署块开始，按页抓，超上限直接报错。
//   部署块 = 25,921,072，就是纸带里最早那条 OperatorChanged 的区块（见 buildLogs），不是猜的。
const DEPLOY_BLOCK = 25921072;
const LOG_PAGE = 10000;      // 每页块数：多数公共 RPC 允许 1e4 级别的 eth_getLogs，再大就容易被拒
const LOG_RANGE = 200000;    // 最多往前抓多少块（≈ 主网当前 4 个月，够覆盖部署至今）；超了报错，不静默截断
const argNum = (name, dflt) => {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
async function getLogsPaged(p, address, fromBlock, toBlock, page) {
  const out = [];
  for (let a = fromBlock; a <= toBlock; a += page) {
    const b = Math.min(a + page - 1, toBlock);
    out.push(...(await p.getLogs({ address, fromBlock: a, toBlock: b })));
  }
  return out;
}

async function fromRpc(url) {
  const iface = new ethers.Interface(JSON.parse(fs.readFileSync(ABI_PATH, "utf8")));
  const p = new ethers.JsonRpcProvider(url);
  const calls = {};
  const address = process.env.CONTRACT_ADDRESS || ADDR;
  const tryCall = async (sig, args) => {
    const data = iface.encodeFunctionData(sig, args);
    const key = address.toLowerCase() + ":" + data.toLowerCase();
    try { calls[key] = await p.call({ to: address, data }); } catch (e) { calls[key] = { revert: true }; }
  };
  await tryCall("REGION_COUNT", []);
  const n = Number(iface.decodeFunctionResult("REGION_COUNT", calls[address.toLowerCase() + ":" + iface.encodeFunctionData("REGION_COUNT", []).toLowerCase()])[0]);
  for (let r = 1; r <= n; r++) await tryCall("regionName", [r]);
  for (const sig of ["MIN_PREMIUM", "PREMIUM_DEFAULT", "PAYOUT_MAX", "MIN_HOURS", "MAX_HOURS", "TIER_COUNT", "coolingPeriod", "paused", "operator", "poolBalance", "nextPolicyId", "openExposure"]) await tryCall(sig, []);
  for (let r = 1; r <= n; r++) { await tryCall("rainfall", [r]); await tryCall("lastFeedAt", [r]); }
  for (const h of [12, 24]) { await tryCall("entryThresholdOf", [h]); await tryCall("thresholdOf", [h, 0]); await tryCall("thresholdOf", [h, 1]); }
  for (const h of [12, 24, 48, 72]) await tryCall("hoursAllowed", [h]);
  for (let r = 1; r <= n; r++) for (const h of [12, 24]) await tryCall("premiumOf(uint8,uint256,uint8,uint8,uint256)", [r, h, 0, 0, 1]);
  const bn = await p.getBlockNumber();
  const fromBlock = argNum("--from-block", DEPLOY_BLOCK);
  const page = argNum("--page", LOG_PAGE);
  const range = argNum("--range", LOG_RANGE);
  if (bn - fromBlock > range) {
    throw new Error("要抓的事件区间 " + (bn - fromBlock).toLocaleString("en-US") + " 块超过上限 " + range.toLocaleString("en-US") +
      "（抬高 --range= 或指定更近的 --from-block= ；拒绝静默截断，否则快照会少事件却看不出来）");
  }
  const logs = await getLogsPaged(p, address, fromBlock, bn, page);
  const blocks = {};
  for (const l of logs) { const b = await p.getBlock(l.blockNumber); blocks[l.blockNumber] = b.timestamp; }
  const code = await p.getCode(address);
  const balance = await p.getBalance(address);
  const txCount = await p.getTransactionCount(address);
  const fee = await p.getFeeData();
  const rpc = buildRpc({
    blockNumber: bn, code, blocks, address,
    balance: "0x" + balance.toString(16),
    transactionCount: "0x" + txCount.toString(16),
  });
  if (fee && fee.gasPrice) rpc.gasPrice = "0x" + fee.gasPrice.toString(16);
  return {
    meta: {
      chainId: 677, chainName: "BOT Chain Mainnet", address,
      blockNumber: bn,                       // 兼容字段（05-演示站点/index.html:1513 读它），语义 = readingsBlockNumber
      readingsBlockNumber: bn,
      eventsObservedAtBlock: logs.length ? Math.max(...logs.map((l) => Number(l.blockNumber))) : null,
      capturedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      source: "eth-rpc:" + url,
      note: "真抓的一份（--from-rpc）：读数与事件都读自 " + url + "（读数高度 " + bn.toLocaleString("en-US") + "，" +
            "事件 " + logs.length + " 条，最高 " + (logs.length ? Math.max(...logs.map((l) => Number(l.blockNumber))).toLocaleString("en-US") : "—") + "）。" +
            "事件只从区块 " + fromBlock.toLocaleString("en-US") + " 起抓（部署块默认值，可用 --from-block= 改），不是全历史。",
      codeLength: (code.length - 2) / 2,
    },
    calls,
    logs: logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: l.blockNumber, transactionHash: l.transactionHash, logIndex: l.index, removed: false, blockHash: l.blockHash })),
    blocks,
    code,
    rpc,
  };
}

async function main() {
  const useRpc = process.argv.includes("--from-rpc");
  const iface = new ethers.Interface(fs.readFileSync(ABI_PATH, "utf8"));
  let snap;
  if (useRpc) {
    snap = await fromRpc(process.env.SEPOLIA_RPC || "https://rpc.botchain.ai");
  } else {
    const code = runtimeFromArtifact();
    const logs = buildLogs(iface);
    const blocks = buildBlocks();
    snap = {
      meta: {
        chainId: 677, chainName: "BOT Chain Mainnet", address: ADDR,
        blockNumber: VALUES.blockNumber,        // 兼容字段（05-演示站点/index.html:1513 读它），语义 = readingsBlockNumber
        readingsBlockNumber: VALUES.blockNumber,
        eventsObservedAtBlock: Math.max(...logs.map((l) => Number(l.blockNumber))),
        capturedAt: "2026-10-08（读数复核日期；不是文件生成时间，见 generatedAt）",
        generatedAt: new Date().toISOString(),
        source: "rebuild-from-verified-readings",
        note: "连不上主网时，用 2026-10-08 已核实的读数与事件重建（见 08-截图存证/链上留痕-主网677-v3部署.md）。" +
              "读数与事件不是同一块高：readingsBlockNumber=" + VALUES.blockNumber.toLocaleString("en-US") +
              " 是读数的取景高度（五城累计 " + VALUES.rainfall.join("/") + "mm、阈值、10 格保费、池子 " + VALUES.pool +
              " BOT（快照值；2026-10-11 主网直读为 0.05105 BOT））；" +
              "事件纸带只有 " + logs.length + " 条，落在 " +
              Math.min(...logs.map((l) => Number(l.blockNumber))).toLocaleString("en-US") + " 到 " +
              Math.max(...logs.map((l) => Number(l.blockNumber))).toLocaleString("en-US") +
              " 之间，eventsObservedAtBlock=其中最高的那条。" +
              "blockNumber 是给旧页面读的兼容字段（05-演示站点/index.html:1513 用它当快照高度），语义等于 readingsBlockNumber，不是文件生成时刻的链尖。" +
              "事件类型只有 " + eventTypes(logs, iface) + " —— 没有 PolicyBought、没有 ClaimPaid、没有 PolicyRefunded" +
              "（这个地址上至今没有投保/理赔的链上事件，快照里也就不写）。" +
              "运行时字节码取自仓库编译产物（与部署用的是同一份），长度与链上实测一致（" + VALUES.codeLength.toLocaleString("en-US") + " 字节）。" +
              "verifier.html 用的 rpc 视图只覆盖读操作；交易详情/回执不在快照里。",
        codeLength: VALUES.codeLength,
      },
      calls: buildCalls(iface),
      logs,
      blocks,
      code,
      rpc: buildRpc({ blockNumber: VALUES.blockNumber, code, blocks, address: ADDR, balance: "0x0", transactionCount: VALUES.contractNonce }),
    };
  }
  const out = `/* 自动生成，别手改：node 07-测试工具/make-frozen-node.js --from-rpc|--rebuild
 * 链上快照（raw JSON-RPC 回答）。两个页面在连不上任何节点时用它兜底，并在界面上如实标注「快照」。
 * source = ${snap.meta.source}
 * 2026-10-12：只有 meta 被手工对齐过（生成器 make-frozen-node.js 的 meta 也同步改了，--rebuild 重跑会写出同样的字段）。
 * calls / logs / blocks / code / rpc 一个字节都没动 —— 离线性与可复算性不变。
 */
window.FROZEN_NODE = ${JSON.stringify(snap)};
`;
  fs.writeFileSync(OUT, out, "utf8");
  console.log("✅ 写出 " + OUT);
  console.log("   source      : " + snap.meta.source);
  console.log("   读数高度    : " + snap.meta.readingsBlockNumber + "（兼容字段 blockNumber 同值 " + snap.meta.blockNumber + "）");
  console.log("   事件最高区块: " + snap.meta.eventsObservedAtBlock);
  console.log("   eth_call 条数: " + Object.keys(snap.calls).length + "（其中 revert " + Object.values(snap.calls).filter((v) => v && v.revert).length + " 条）");
  console.log("   事件条数    : " + snap.logs.length + " · rpc 视图区块 " + Object.keys(snap.rpc.blocks).length + " 条");
  console.log("   运行时哈希  : " + ethers.keccak256(snap.code) + "  （可以在能连主网时拿去和 eth_getCode 比）");
  console.log("   文件大小    : " + (fs.statSync(OUT).size / 1024).toFixed(1) + " KB");
}

main().catch((e) => { console.error("💥 " + e.message); process.exit(1); });
