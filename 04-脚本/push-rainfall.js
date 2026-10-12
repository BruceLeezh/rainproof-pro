/**
 * 喂价脚本（预言机）—— 把链下的降雨数据写进 RainDeliveryInsurance 合约
 * ============================================================================
 *
 * 【为什么需要它】
 *   合约不能主动访问互联网。链是确定性的：全世界每个节点跑同样的代码必须得到
 *   同样的结果；如果合约能随时去调一个 API，结果就不可能一致。
 *   所以外部数据必须由链下的某个东西「写进去」—— 这个东西就叫预言机（oracle）。
 *   本脚本就是那个预言机。
 *
 * 【数据源】
 *   Open-Meteo（https://open-meteo.com）—— 免费、免 API key、国内可直连（已实测）。
 *   ⚠️ Chainlink 的 Data Feeds 里【没有】降雨量数据，所以「接一个现成的降雨喂价」
 *   这条路走不通，必须自己跑。
 *
 * 【口径：为什么推「累计」而不是「今天的量」】
 *   合约里的判定是【保单期间增量】= 当前累计 − 投保时快照 ≥ 50mm。
 *   所以脚本推的必须是【单调递增的累计降雨量】。这里取「自 RAIN_EPOCH 起逐日累加」，
 *   跨天也不会回退。（如果推「今日降雨」，每天 0 点归零，增量口径立刻失真。）
 *
 * 【用法】
 *   npm run push                    # 真实数据，推全部 5 个区域
 *   npm run push -- 1               # 只推区域 1（武汉）
 *   npm run push -- --status        # 只读，看链上现状（不花 gas）
 *   npm run push -- --demo          # ★ 演示模式：注入一场模拟暴雨，立刻可触发赔付
 *   npm run push -- --refresh       # 同值重喂：累计值不变，只把喂价时刻（lastFeedAt）推到现在
 *   npm run push -- --watch 10      # 每 10 分钟自动推一次（真实数据）
 *   npm run push -- --demo --watch 5
 *
 * 【⚠️ 演示诚实性】
 *   真实天气不会配合你的演示时间。10 月初的武汉，实测过去一周只累计 37.2mm，
 *   够不到 50mm 阈值 —— 也就是说【用真实数据演示时，赔付根本触发不了】。
 *   所以演示请用 --demo 模式（脚本会明确打印「模拟数据」），并在答辩材料里写清：
 *   「产品在真实气象数据上运行；演示时为可控起见使用脚本注入的模拟强降雨」。
 *   主动说明 = 加分；被评委问出来 = 减分。
 */

// dotenv 是可选依赖：装了就从 .env 读，没装也能直接用环境变量跑
try { require("dotenv").config(); } catch (_) { /* 忽略 */ }
const { JsonRpcProvider, Wallet, Contract, Interface, formatEther, parseEther } = require("ethers");
const fs = require("fs");
const path = require("path");
// AI 喂价验收的第二层：三个独立数值预报模型的交叉核验（实现见同目录 feed-verify.js）
const { MODELS, fetchModelSeries, gradeModels } = require("./feed-verify");

/* ------------------------------------------------------------------ 配置 */

const ABI = [
  // ★ 赛期变更：updateRainfall 多了 evidenceHash / confidence / sources —— AI 喂价验收的落点
  "function updateRainfall(uint8 regionId, uint256 cumulativeMm, bytes32 evidenceHash, uint8 confidence, uint8 sources) external",
  "function rejectFeed(uint8 regionId, uint8 confidence, uint8 sources, bytes32 inputHash, string modelVersion) external",
  "function rainfall(uint8 regionId) external view returns (uint256)",
  "function operator() external view returns (address)",
  "function paused() external view returns (bool)",
  "function poolBalance() external view returns (uint256)",
  "function PAYOUT() external view returns (uint256)",
  "function THRESHOLD() external view returns (uint256)",
  // ★ v2 把上面两个拆成了「上限」与「每 24h 阈值」，premiumOf 也多了时长参数。
  //   同名不同参，所以下面统一用「签名」而不是「属性名」去取（见 readEither）。
  "function PAYOUT_MAX() external view returns (uint256)",
  "function THRESHOLD_PER_24H() external view returns (uint256)",
  "function thresholdOf(uint256 windowHours) external view returns (uint256)",
  // ★ v3（国标两档）把阈值拆成「入口线 × 赔付档」：thresholdOf(hours, tier) 变 2 参，
  //   原来的「每 24h 阈值」语义落在入口线 entryThresholdOf(hours) = thresholdOf(hours, 0) 上。
  "function entryThresholdOf(uint256 windowHours) external view returns (uint256)",
  "function premiumOf(uint8 regionId, uint256 windowHours) external view returns (uint256)",
  "function reserveOf() external view returns (uint256)",
  "function MAX_FEED_AGE() external view returns (uint64)",
  "function lastFeedAt(uint8 regionId) external view returns (uint64)",
  "function MIN_CONFIDENCE() external view returns (uint8)",
  "function reserve() external view returns (uint256)",
  "function aiPremium(uint8 regionId) external view returns (uint256)",
  // ⚠️ 这里原来挂着 "judgements(uint256)" 与 "policiesOf(address)" —— 已删，理由见下方统一说明。
  "function rainfallDuring(uint256 policyId) external view returns (uint256)",
  "function premiumOf(uint8 regionId) external view returns (uint256)",
  "function riskLevel(uint8 regionId) external view returns (uint8)",
  "function regionName(uint8 regionId) external pure returns (string)",
  "function REGION_COUNT() external view returns (uint8)",
  // ⚠️ 手抄的「读结构体」签名一律不留 —— 本文件已删五条，统一说明：
  //      "policies(uint256)"     v1 的 7 字段老结构体；v2 是 15 个返回值、v3 是 16 个
  //      "judgements(uint256)"   9 个返回值；v3 是 10 个（多了 rainfallAtJudgement，
  //                              见 03-合约/RainDeliveryInsuranceV3.sol:113-124）
  //      "feedJudgements(uint8)" v1/v2 也是 9 个返回值，v3 是 10 个（同样多 rainfallAtJudgement）。
  //                              这条**两版同名、返回值个数不同**，没法在探针表上共存 ⇒
  //                              交给下面的 JUDGEMENT_ABIS / feedJudgementsOf() 拿真 ABI 依次试。
  //      "policiesOf(address)" / "policyStatus(uint256)"   本文件不读保单状态
  //    理由：`readEither` 是按签名名去探的（探针表 = 本数组）。表上摆一版字段错位的元组，
  //    谁照着它写一句 `c.policies(id)` 就静默解错，而且不会在这里报错，要等现场投保才炸。
  //    要读保单/判定请用 03-合约/RainDeliveryInsuranceV2.abi.json / V3.abi.json，别手抄。
  "function nextPolicyId() external view returns (uint256)",
  "event RainfallUpdated(uint8 indexed regionId, uint256 cumulativeMm, bytes32 evidenceHash, uint8 confidence, address indexed reporter)",
];

/* 判定记录（feedJudgements）的返回值 v1/v2 是 9 个、v3 是 10 个（多一个 rainfallAtJudgement），
   同一条签名解不出两版 —— 而且**不能靠「试解，谁不报错就用谁」**。实测拿两版真 ABI 互相解：
   v3 的返回值用 9 输出签名解，一半用例不报错（outputHash=0 的 rejectFeed 记录正好是这一半），
   解出来的 exists / inputHash / modelVersion 全错位 —— 正是 F15 那个「链上明明有拒收留痕，
   状态页却打印『还没有喂过价』」；反过来 10 输出签名解 v2 的返回值 100% 静默成功。
   ⇒ 只能先认版本：v3 独有 entryThresholdOf(uint256)（v2 的阈值是 THRESHOLD_PER_24H()，
     v1 两个都没有），而 v1/v2 的 feedJudgements 结构相同（都是 9 个）
     ⇒ 认到 v3 用 V3.abi.json，否则用 V2.abi.json。两版都从 03-合约/*.abi.json 读（不手抄）。 */
const ABI_DIR = path.join(__dirname, "..", "03-合约");
const JUDGEMENT_ABIS = ["V3", "V2"].map((v) => ({
  v,
  abi: JSON.parse(fs.readFileSync(path.join(ABI_DIR, `RainDeliveryInsurance${v}.abi.json`), "utf8")),
}));

// 区域表：regionId 与坐标，两边必须和合约里的 regionName 对得上（脚本会自检）
const REGIONS = [
  { id: 1, key: "wuhan",     name: "武汉", lat: 30.5928, lon: 114.3055 },
  { id: 2, key: "shanghai",  name: "上海", lat: 31.2304, lon: 121.4737 },
  { id: 3, key: "beijing",   name: "北京", lat: 39.9042, lon: 116.4074 },
  { id: 4, key: "guangzhou", name: "广州", lat: 23.1291, lon: 113.2644 },
  { id: 5, key: "chengdu",   name: "成都", lat: 30.5728, lon: 104.0668 },
];

// 累计起点：累计降雨从这个日期开始算。2026-10-01 = 赛事周的第一天。
// C11：与 04-脚本/regions.js:30 共用同一个常量 —— 原来本文件也各写了一份
// `process.env.RAIN_EPOCH || "2026-10-01"`，改 epoch 时漏掉一处就口径分裂。
const { RAIN_EPOCH } = require("./regions");

// 写进链上判定记录的模型/口径版本号。口径一改就改这个字符串 ——
// 否则链上的历史判定没法区分「哪一版算出来的」。
const MODEL_VERSION = process.env.MODEL_VERSION || "rain-oracle-v1";

/* ------------------------------------------------------- 命令行参数解析 */

const ARGV = process.argv.slice(2);
const has = (f) => ARGV.includes(f);

function flagValue(f, def) {
  const i = ARGV.indexOf(f);
  if (i === -1) return def;
  const v = ARGV[i + 1];
  return v === undefined || v.startsWith("--") ? def : v;
}

const DEMO = has("--demo");
const REFRESH = has("--refresh");
const STATUS_ONLY = has("--status");
const WATCH_MIN = flagValue("--watch", null);   // 原始串；校验与转数在 watchMinutes()（main 里）
// --until=YYYY-MM-DD：把"今天"钉到指定日期。默认真是今天；历史回放必须用它，
// 否则跑一场两年前的暴雨会取回"自 epoch 到真正今天"的累计值，回放就不是回放。
const UNTIL = (ARGV.find((a) => a.startsWith("--until=")) || "").split("=")[1] || null;
// 纯数字参数 = 指定单个区域
const ONLY_REGION = (() => {
  const n = ARGV.find((a) => /^\d+$/.test(a));
  return n ? Number(n) : null;
})();

/* E22：--demo 的「+60~130mm」原来是裸 Math.random() —— 同一句命令两次跑，写进链上的累计值
   与证据哈希都不一样，演示材料里的「模拟暴雨」没法复现。现在每次运行都有一个种子：
   不带 --seed=（或没有 --seed=N）就取一个并**打出来**，把 seed 抄回去就能一模一样再跑一遍。
   用 --seed=N（等号形式）而不是 `--seed N`，避免和「纯数字参数 = 区域号」的解析打架。 */
const SEED = (() => {
  const raw = (ARGV.find((a) => a.startsWith("--seed=")) || "").split("=")[1];
  if (raw === undefined) return Date.now() % 2147483647;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 2147483646) {
    throw new Error(`--seed= 需要一个 0~2147483646 的整数，收到：${JSON.stringify(raw)}`);
  }
  return n;
})();
// mulberry32（32 位种子 → [0,1)）：几行就够，不为一个演示随机数引依赖。
const rng = ((a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
})(SEED);

/* ------------------------------------------------------------- 天气数据源 */

/* ★ 日期口径统一走 ./shardate（东八区，A11）。原来这里是**主机本地时区**切法
   （`d.getFullYear()/getMonth()/getDate()`）—— 本机在 +8 看着没问题，但 CI/Docker 默认 UTC，
   同一份喂价脚本在不同机器上会取到不同的日期区间（前一天/后一天），而链上值与哈希都看不出来。 */
const { shDate: ymd } = require("./shardate");

/**
 * 采集一个区域「自 RAIN_EPOCH 到今天的累计降雨」，并做**多源交叉核验**。
 *
 * 这里有两条**独立**的数据路径：
 *   archive  —— 历史实测（再分析，滞后约 5 天）
 *   forecast —— 预报模式回溯（past_days=14，用来覆盖 archive 的滞后区间）
 * 两者数据同化路径不同，可以互为旁证。这就是 AI 喂价验收落点要的「多源交叉核验」：
 *   两源在【重合日期】上一致 → 高置信度 88，sources=2
 *   只有一个数据源可用       → 中等置信度 72，sources=1（仍 ≥ MIN_CONFIDENCE=60，可喂）
 *   两源分歧超过容差         → **拒收**：mm=null，confidence=40，交给上层调 rejectFeed 留证
 *
 * ⚠️ 诚实标注（2026-10-07 更新）：上面这两条接口都来自 Open-Meteo，**不是三个不同厂商的模型**。
 *    所以脚本在同厂商两路径比完之后，还会再调 feed-verify.js 做**第二层：三模型交叉核验** ——
 *    ECMWF IFS025 / GFS(NOAA) / ICON(DWD) 各拉一份逐日序列，只在公共日期上比累计值，
 *    三个（或多数）落在中位数 ± 容差内才写链，否则整批拒收、走 rejectFeed 留证。
 *    两层核验都过才喂价，链上 `sources` 写的是第二层实际采信的模型数。
 */
async function collectRegion(region) {
  const today = new Date();
  const end = UNTIL || ymd(today);
  const start = RAIN_EPOCH;

  const base =
    `latitude=${region.lat}&longitude=${region.lon}` +
    `&daily=precipitation_sum&timezone=Asia%2FShanghai`;

  const urlArchive =
    `https://archive-api.open-meteo.com/v1/archive?${base}` +
    `&start_date=${start}&end_date=${end}`;

  // 第二条路径。默认用 forecast 的 past_days（相对现在回看 14 天，覆盖 archive 的滞后）；
  // 历史回放时 past_days 只会回看"现在"，跟 2024 年的窗口毫无交集，
  // 所以改用历史预报归档接口，显式指定同一段起止日期。
  const urlForecast = UNTIL
    ? `https://historical-forecast-api.open-meteo.com/v1/forecast?${base}` +
      `&start_date=${start}&end_date=${end}`
    : `https://api.open-meteo.com/v1/forecast?${base}` +
      `&past_days=14&forecast_days=0`;

  const tryFetch = async (url) => {
    const r = await fetch(url, { headers: { "User-Agent": "rain-insurance-oracle/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();

    // ★ 缺测 ≠ 0mm、以及「必须裁到 RAIN_EPOCH 之后」两件事都在 dailyRows 里做，
    //   见该函数的注释（archive 接口由 start_date 天然限定；但 forecast 用的是
    //   past_days=14，会返回【从 14 天前开始】的序列，其中 8 天在 RAIN_EPOCH 之前 ——
    //   不裁掉就等于把「赛事周之前下的雨」也算进累计值：判定口径从「自 epoch 起累计」
    //   悄悄变成「最近 14 天累计」，凭空多出一周的雨，会直接造成不该赔的保单被判定为达标）。
    //   缺测被剔出序列后，`days` 的含义从「序列长度」变成「真有数据的天数」——
    //   下面挑 archive / forecast「谁覆盖更完整」时不再把缺测算成覆盖。
    const { dates, dailyMm, missingDays } =
      dailyRows(j?.daily?.time || [], j?.daily?.precipitation_sum || [], RAIN_EPOCH);

    return {
      sum: Math.round(dailyMm.reduce((x, y) => x + y, 0) * 10) / 10,
      days: dates.length, dates, dailyMm, missingDays,
      first: dates[0], last: dates[dates.length - 1],
    };
  };

  let a = null, b = null, errA = null;
  try { a = await tryFetch(urlArchive); } catch (e) { errA = e.message; }
  try { b = await tryFetch(urlForecast); } catch (e) { /* 两条都失败才报错 */ }
  if (!a && !b) throw new Error(`两条数据路径都失败（archive: ${errA}）`);

  // 交付值取「覆盖区间更完整」的那条 —— archive 有滞后时 forecast 反而更长
  const longer = (a && b) ? (b.days > a.days ? b : a) : (a || b);
  const longerName = longer === a ? "archive" : "forecast(past_days=14)";
  // 缺测天数：缺的那天按 0mm 计入，和数因此只会偏低。一路带到调用方去喊出来。
  const missingDays = longer.missingDays || 0;
  const snapBase = {
    schema: "rainproof/feed-snapshot@1",
    regionId: region.id, regionKey: region.key, epoch: RAIN_EPOCH,
    source: "open-meteo",
    endpoints: [a ? "archive" : null, b ? "forecast" : null].filter(Boolean),
    dates: longer.dates,
    dailyMm: longer.dailyMm,
    cumulativeMm: Math.max(0, Math.round(longer.sum)),
  };

  if (a && b) {
    // ★ 交叉核验只在【重合日期】上做。
    //   两条路径覆盖的区间长度不同，直接比总和对不上账 ——
    //   拿 5 天的和去比 20 天的和，差多少都说明不了问题。
    const aMap = new Map(a.dates.map((d, i) => [d, a.dailyMm[i]]));
    const bMap = new Map(b.dates.map((d, i) => [d, b.dailyMm[i]]));
    const common = a.dates.filter((d) => bMap.has(d));
    let sa = 0, sb = 0;
    for (const d of common) { sa += aMap.get(d); sb += bMap.get(d); }
    sa = Math.round(sa * 10) / 10;
    sb = Math.round(sb * 10) / 10;
    const diff = Math.abs(sa - sb);
    const tol = Math.max(1, Math.round(Math.max(sa, sb) * 0.2 * 10) / 10);
    const snapshot = Object.assign({}, snapBase, {
      overlapDays: common.length,
      overlapArchiveMm: sa,
      overlapForecastMm: sb,
      toleranceMm: tol,
    });

    if (!common.length) {
      // ★ 两条路径的日期完全不重合时，"交叉核验"是空的 —— 不能算作两个源的旁证。
      //   （历史回放窗口下必然发生：forecast 的 past_days 只会回看"现在"的 14 天。）
      //   宁可降级成单一来源的 72，也不虚报 88。
      return {
        mm: snapBase.cumulativeMm, confidence: 72, sources: 1, agree: true, missingDays,
        snapshot: Object.assign({}, snapBase, { overlapDays: 0, overlapEmpty: true }),
        note: "两条数据路径没有重合日期，交叉核验为空 —— 按单一来源计，置信度 72",
      };
    }

    if (diff > tol) {
      return {
        mm: null, confidence: 40, sources: 2, agree: false, snapshot, missingDays,
        note: `重合 ${common.length} 天：archive ${sa}mm vs forecast ${sb}mm，` +
              `差 ${diff.toFixed(1)}mm > 容差 ${tol.toFixed(1)}mm —— 拒收，不喂价`,
      };
    }
    return {
      mm: snapshot.cumulativeMm, confidence: 88, sources: 2, agree: true, snapshot, missingDays,
      note: `重合 ${common.length} 天：archive ${sa}mm vs forecast ${sb}mm（差 ${diff.toFixed(1)}mm ≤ 容差 ${tol.toFixed(1)}mm）；` +
            `交付取更完整区间 ${longerName} = ${snapshot.cumulativeMm}mm`,
    };
  }

  return {
    mm: snapBase.cumulativeMm, confidence: 72, sources: 1, agree: true, snapshot: snapBase, missingDays,
    note: `只有一个数据源可用（${longerName}），置信度按中等计 72`,
  };
}

/* --------------------------------------------------------------- 工具函数 */

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
};

// ★ 规范化序列化与证据哈希 —— 全项目唯一口径，与 AI 判定模块共用同一个文件。
//   单独放在 canonical.js 里，就是为了防止两边各写一份、悄悄算出不同的哈希。
const { canonicalize, evidenceHashOf } = require("./canonical");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 把 Open-Meteo 的 daily 序列压成「自 epoch 起、真有数据」的那一份。纯函数，可自检。
 * **缺测 ≠ 0mm**：null / undefined / "" / 非数值串记为缺测 —— 不计入 `dates`/`dailyMm`，
 * 只计入 `missingDays`。原写法 `Number(v) || 0` 把缺测一律变成 0：累计值里看不出
 * 「少了一天雨」，operator 也不知道自己喂的是一张残表（缺测那天在哈希覆盖的 snapshot 里
 * 冒充成「晴朗无雨」）。和数不变（缺测本来就贡献 0），变的是「能不能看出来」。
 * 同一条纪律见 04-脚本/feed-verify.js:71-73。
 * @param {string[]} allDates  ISO 日期串（可直接比大小）
 * @param {Array} rawPrecip    同长度的降水量数组（允许 null）
 * @param {string} epoch       只保留 >= epoch 的日子（RAIN_EPOCH）
 */
function dailyRows(allDates, rawPrecip, epoch) {
  const num = (v) =>
    (v === null || v === undefined || String(v).trim() === "" || !Number.isFinite(Number(v))
      ? null : Number(v));
  const sinceEpoch = allDates.map((d, i) => [d, num(rawPrecip[i])]).filter(([d]) => d >= epoch);
  const keep = sinceEpoch.filter(([, v]) => v !== null);
  return {
    dates: keep.map(([d]) => d),
    dailyMm: keep.map(([, v]) => v),
    missingDays: sinceEpoch.length - keep.length,
  };
}

/**
 * 画进度条。**阈值读不到时不画满格，而是明说「阈值未知」。**
 * 原来写的是 `Math.min(1, cur / Math.max(1, threshold))`：readEither 一路全挂返回 null，
 * `Number(null) === 0` → `Math.max(1, 0) === 1` → 任何 `cur >= 1` 的读数都画成满格 ██████。
 * 满格是这块仪表盘上最容易被误读的一格（看起来像「水漫金山」），而阈值缺失恰恰说明
 * 「读链那一层出问题了」，这种时候最不该给出一张看起来很确定的图。
 * 同理 cur 也不是有限数时按 0 处理（显示为全空），不参与除法。
 */
function bar(cur, threshold, width = 30) {
  if (!Number.isFinite(Number(threshold)) || Number(threshold) <= 0) return C.dim("阈值未知".padEnd(width));
  const c0 = Number.isFinite(Number(cur)) ? Number(cur) : 0;
  const ratio = Math.min(1, Math.max(0, c0 / Number(threshold)));
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/* --------------------------------------------------------------- 主流程 */

// 已知真链：chainId → 显示名。RPC 由 .env 的 SEPOLIA_RPC 指定（变量名沿用，指哪条链由它自己答）。
const KNOWN_CHAINS = { 11155111: "Sepolia", 677: "BOT Chain Mainnet", 968: "BOT Chain Testnet" };

/* v1 与 v2 的常量名不一样：v2 把 PAYOUT / THRESHOLD 拆成「上限」与「每 24h 阈值」，
   premiumOf 也多了时长参数（同名不同参）。同一份脚本要同时伺候两条链，
   所以按「函数签名」依次试，取第一个读得到的；一个都读不到就返回 null（调用方自己兜底）。
   ★ 但「一个都读不到」不能换来回一个静默的 null —— 到底是没有这个函数、还是 RPC 挂了，
     外在表现一模一样。所以失败原因记进 readFailures，由 whyNotRead() 在显示层说出来。 */
const THRESHOLD_SIGS = [["THRESHOLD()"], ["THRESHOLD_PER_24H()"], ["entryThresholdOf(uint256)", [24]]];
const MAX_FEED_AGE_SIGS = [["MAX_FEED_AGE()"]];
const readFailures = [];   // 只用于「为什么读不到」，不参与任何判断
async function readEither(c, sigs) {
  const reasons = [];
  for (const [sig, args] of sigs) {
    try { return await c.getFunction(sig)(...(args || [])); }
    catch (e) {
      reasons.push(`${sig} → ${String(e.shortMessage || e.message || e).split("\n")[0].slice(0, 100)}`);
    }
  }
  readFailures.push({ key: sigs.map((s) => s[0]).join(" | "), reasons });
  return null;
}

/** 把某个探针组「为什么全挂」的原因拼成一行（读不到时才用） */
function whyNotRead(sigs) {
  const key = sigs.map((s) => s[0]).join(" | ");
  const hit = [...readFailures].reverse().find((f) => f.key === key);
  if (!hit) return "";
  const uniq = [...new Set(hit.reasons.map((r) => r.replace(/^.*? → /, "")))];
  return C.dim(` 原因：${uniq.join("；")}`);
}

/* 判定记录：先认版本再选 ABI（为什么不能试解，见上面 JUDGEMENT_ABIS 那段）。版本认一次就够。
   读不出来时返回 null 并记进 readFailures —— 显示层会说出原因，不许静默少一列。 */
const FEED_JUDGE_SIGS = [["feedJudgements(uint8)"]];
let judgementAbi = null;
async function feedJudgementsOf(readC, id) {
  if (judgementAbi === null) {
    const isV3 = (await readEither(readC, [["entryThresholdOf(uint256)", [24]]])) !== null;
    judgementAbi = JUDGEMENT_ABIS.find((a) => a.v === (isV3 ? "V3" : "V2"));
  }
  try {
    return await new Contract(readC.target, judgementAbi.abi, readC.runner).feedJudgements(id);
  } catch (e) {
    readFailures.push({ key: FEED_JUDGE_SIGS[0][0], reasons:
      [`${judgementAbi.v} → ${String(e.shortMessage || e.message || e).split("\n")[0].slice(0, 100)}`] });
    return null;
  }
}

/* `--watch` 的分钟数：NaN / 0 / 负数会让 sleep(NaN) 立刻返回 ⇒ 零延迟递归、
   每轮真发一笔交易（--watch 10min / abc 就是这条路径）。所以在发第一笔之前先挡掉。
   同类输入的处理风格见 keeper.js 的 --interval=。 */
function watchMinutes(raw) {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--watch 需要一个正数分钟，收到：${JSON.stringify(raw)}`);
  }
  return n;
}

async function main() {
  // --watch 先验参数再碰网络：NaN / 0 会让 sleep(NaN) 立刻返回 ⇒ 零延迟递归 + 每轮真发交易
  const watchMin = watchMinutes(WATCH_MIN);
  const rpc = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
  const address = (process.env.CONTRACT_ADDRESS || "").trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(
      "请先在 .env 里填好 CONTRACT_ADDRESS（42 位的 0x… 地址）\n" +
      "  当前值：" + (address || "（空）")
    );
  }

  const provider = new JsonRpcProvider(rpc);
  const readC = new Contract(address, ABI, provider);

  /* ---- 链身份：只读模式也要先认链，否则会把 BOT Chain 的代币显示成 SepETH ---- */
  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);
  const chainName = KNOWN_CHAINS[chainId];
  if (!chainName) {
    throw new Error(`⚠️ 当前 RPC 不是已知的真链（chainId=${chainId}）。已知：` +
      Object.entries(KNOWN_CHAINS).map(([k, v]) => `${v}(${k})`).join(" / "));
  }
  // chainId 能被本地假链伪装（07-测试工具/prep_local_chain.js 就设成 11155111），块高不能。
  const blockNumber = await provider.getBlockNumber();
  const isRealChain = blockNumber >= 1000000;
  const sym = chainId === 677 || chainId === 968 ? "BOT" : "SepETH";   // BOT Chain（主网 677 / 测试网 968）的原生代币叫 BOT，不是 SepETH
  const chainInfo = { isRealChain, chainName, chainId, blockNumber, sym };

  /* ---- 只读模式：只看不写 ---- */
  if (STATUS_ONLY) {
    await printStatus(readC, chainInfo);
    return;
  }

  if (!process.env.PRIVATE_KEY || !process.env.PRIVATE_KEY.startsWith("0x")) {
    throw new Error("请先在 .env 里填好 PRIVATE_KEY（0x 开头）");
  }

  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new Contract(address, ABI, wallet);

  /* ---- 前置检查：权限 / 池子 ---- */

  const [onchainOperator, paused, pool, payout, threshold, regionCount, minConfidence, balance] = await Promise.all([
    readC.operator(), readC.paused(), readC.poolBalance(),
    readEither(readC, [["PAYOUT()"], ["PAYOUT_MAX()"]]),
    readEither(readC, THRESHOLD_SIGS),
    readC.REGION_COUNT(), readC.MIN_CONFIDENCE(),
    provider.getBalance(wallet.address),
  ]);

  console.log(C.dim("─".repeat(74)));
  console.log(`${C.b("喂价者")}  ${wallet.address}`);
  console.log(`合约      ${address}   ${C.dim((isRealChain ? chainName : "⚠️ 本地假链") + " · chainId " + chainId + " · 块高 " + blockNumber)}`);
  console.log(`账户余额  ${formatEther(balance)} ${sym}`);
  console.log(`资金池    ${formatEther(pool)} ${sym}   ${payout ? C.dim(`（单笔上限赔付 ${formatEther(payout)} ${sym}，最多还能赔 ${Number(pool / payout)} 笔）`) : ""}`);
  console.log(`触发阈值  ${threshold} mm   ${C.dim("（保单期间增量口径）")}`);
  console.log(`验收门槛  置信度 ≥ ${minConfidence}   ${C.dim("（低于这个值合约会 revert：feed confidence too low）")}`);
  console.log(C.dim("─".repeat(74)));

  if (onchainOperator.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(
      `❌ 这个钱包不是合约的 operator，updateRainfall 会被 revert。\n` +
      `   合约里的 operator ：${onchainOperator}\n` +
      `   你 .env 里的钱包  ：${wallet.address}\n` +
      `   解决：用 operator 的那个钱包来喂价，或在链上 transferOperator 转给当前钱包。`
    );
  }
  if (paused) {
    console.log(C.y("⚠️ 合约处于暂停状态（paused=true），updateRainfall 仍可调用，但 claim 会被拒。"));
  }
  if (Number(balance) === 0) {
    throw new Error("❌ 账户余额为 0，付不起 gas。先去水龙头领测试币。");
  }

  /* ---- 自检：区域名与合约是否对得上 ---- */
  for (const r of REGIONS.filter((r) => r.id <= Number(regionCount))) {
    const onchain = String(await readC.regionName(r.id)).toLowerCase();
    if (onchain !== r.key) {
      throw new Error(
        `❌ 区域映射对不上：合约 regionId=${r.id} 叫「${onchain}」，\n` +
        `   脚本里写的是「${r.key}」。请同步两边，否则会把 A 城的雨算到 B 城头上。`
      );
    }
  }

  /* ---- 决定这次推哪些区域 ---- */
  let targets = REGIONS.filter((r) => r.id <= Number(regionCount));
  if (ONLY_REGION !== null) {
    targets = targets.filter((r) => r.id === ONLY_REGION);
    if (!targets.length) throw new Error(`区域 ${ONLY_REGION} 不存在（合约里只有 1~${regionCount}）`);
  }

  /* ---- 逐区域推送 ---- */
  console.log(`\n${
    DEMO ? C.y("【演示模式】注入模拟强降雨")
    : REFRESH ? C.y("【同值刷新】累计值不变，只推进喂价时刻")
    : "【真实数据】Open-Meteo"
  }  ·  起点 ${RAIN_EPOCH}  ·  ${targets.length} 个区域\n`);

  const results = [];
  for (const r of targets) {
    const current = Number(await readC.rainfall(r.id));

    let mm, srcNote, conf, sources, snapshot;
    if (DEMO) {
      // 模拟暴雨：在链上现值基础上加 60~130mm，保证稳稳越过阈值
      // （种子化：见上面的 SEED/rng —— 只有 DEMO 用随机数，且 seed 会打出来）
      const add = 60 + Math.floor(rng() * 71);
      mm = current + add;
      conf = 90;
      sources = 3;
      snapshot = {
        schema: "rainproof/feed-snapshot@1",
        regionId: r.id, regionKey: r.key, epoch: RAIN_EPOCH,
        source: "simulated",
        simulated: true,          // ★ 写进证据哈希：模拟数据在链上留下永久、可复算的标记
        cumulativeMm: mm,
        deltaMm: add,
      };
      srcNote = `模拟 +${add}mm`;
    } else if (REFRESH) {
      /* 同值重喂：只刷新 lastFeedAt，累计值一动不动。
         合约守卫是 `require(cumulativeMm >= rainfall[regionId])`（V2.sol:250），
         填【同一个值】合法 —— 所以展示前想把 24h 新鲜度往后推几次都行，
         链上数字稳定停在现值，截图 / PPT / 哈希清单里的 101/287/109/303/227 不用重做。
         （同值重喂不是新花样：07-测试工具/e2e_v2.js:179 就是这么解 24h 过期的。）
         现值本身就是 --demo 写上去的模拟值，快照仍必须带 simulated: true。 */
      const lastAt = Number(await readC.lastFeedAt(r.id));
      const ageH = lastAt ? (Math.floor(Date.now() / 1000) - lastAt) / 3600 : null;
      mm = current;
      conf = 90;
      sources = 3;
      snapshot = {
        schema: "rainproof/feed-snapshot@1",
        regionId: r.id, regionKey: r.key, epoch: RAIN_EPOCH,
        source: "simulated",
        simulated: true,          // ★ 现值是模拟暴雨，这条标记不能少
        refresh: true,            // 声明这是「同值刷新」，不是一次新的观测
        cumulativeMm: mm,
        deltaMm: 0,               // 增量 0 —— 没有新降雨，只是把观测时刻推到现在
      };
      srcNote = `同值刷新：累计值保持 ${mm}mm，只把喂价时刻推到现在` +
                (ageH === null ? "" : `（原喂价 ${ageH.toFixed(1)}h 前）`);
    } else {
      const got = await collectRegion(r);
      mm = got.mm;
      conf = got.confidence;
      sources = got.sources;
      snapshot = got.snapshot;
      srcNote = got.note;
      // 缺测要喊出来：缺的那天按 0mm 计入 ⇒ 累计值只会偏低，别让 operator 当成「这几天没下雨」
      if (got.missingDays) {
        srcNote += `\n     ⚠️ Open-Meteo 有 ${got.missingDays} 天缺测（按 0mm 计入累计，值只会偏低）` +
                   `—— 不是「没下雨」，是「没数据」`;
      }

      /* ---- 第二层：三个独立模型的交叉核验（不认时把 mm 置空，下面走 rejectFeed 留证） ---- */
      if (mm !== null) {
        const mv = await verifyFeedWithModels(r, got);
        mm = mv.mm;
        conf = mv.confidence;
        sources = mv.sources;
        snapshot = mv.snapshot;
        srcNote = `${srcNote}\n     ${mv.verdict.agree ? "✅" : "⛔"} 三模型核验 ` +
                  `${mv.verdict.status}：${mv.verdict.note}`;
      }

      /* ---- 多源验收不通过：不喂价，但把这次异常留在链上 ---- */
      if (mm === null) {
        process.stdout.write(`#${r.id} ${r.name.padEnd(4)} ${C.y("⛔ 验收未过")} `);
        try {
          const tx = await contract.rejectFeed(
            r.id, conf, sources, evidenceHashOf(snapshot), MODEL_VERSION);
          const rc = await tx.wait();
          console.log(C.y("已 rejectFeed 留证") + C.dim(`  区块 ${rc.blockNumber} · ${tx.hash.slice(0, 18)}…`));
          console.log(`     ${C.dim(srcNote)}`);
          results.push({ r, ok: false, reason: "喂价验收未过（多源或多模型分歧），已留证", rejected: true });
        } catch (e) {
          console.log(C.r("rejectFeed 也失败") + "  " + (e.shortMessage || e.message));
          results.push({ r, ok: false, reason: e.shortMessage || e.message });
        }
        await sleep(400);
        continue;
      }
    }

    /* ★ 单调性守卫：累计值只能往上走 */
    if (mm < current && !has("--force")) {
      console.log(
        `${C.y("跳过")} #${r.id} ${r.name.padEnd(4)} 链上现值 ${current}mm > 新值 ${mm}mm` +
        `\n      ${C.dim("累计值回退会让已投保的保单「增量」失真，已拒绝写入（要强制写加 --force）。")}`
      );
      // skipped: 这是**设计好的守卫**（链上值更高时拒绝写回退值），不是喂价失败。
      // 少了这个标记，「一天喂两次」这种正常操作会被下面的失败汇总当成硬错误、常年亮红灯。
      results.push({ r, ok: false, reason: "非单调（链上现值更高，按守卫跳过）", skipped: true });
      continue;
    }

    process.stdout.write(`#${r.id} ${r.name.padEnd(4)} ${String(current).padStart(4)}mm → ${String(mm).padStart(4)}mm  ${bar(mm, Number(threshold))} ${C.dim(`置信 ${conf}/源 ${sources}`)} `);

    try {
      const tx = await contract.updateRainfall(r.id, mm, evidenceHashOf(snapshot), conf, sources);
      const rc = await tx.wait();
      const over = mm - current >= Number(threshold);
      console.log(
        (over ? C.r("⛈ 越过阈值") : C.g("✅ 已上链")) +
        C.dim(`  区块 ${rc.blockNumber} · gas ${rc.gasUsed} · ${tx.hash.slice(0, 18)}…`)
      );
      results.push({ r, ok: true, from: current, to: mm, hash: tx.hash, block: rc.blockNumber, over, conf, sources, note: srcNote });
      // 把「这次凭什么信这份数据」打在日志里 —— 答辩时能指着它说，也方便赛后复算
      if (!DEMO && srcNote) console.log(`     ${C.dim(srcNote)}`);
    } catch (e) {
      console.log(C.r("❌ 失败") + "  " + (e.shortMessage || e.message));
      results.push({ r, ok: false, reason: e.shortMessage || e.message });
    }
    await sleep(400);   // 给 RPC 一点喘息，避免公共节点限流
  }

  /* ---- 汇总 ---- */
  const ok = results.filter((x) => x.ok);
  const over = ok.filter((x) => x.over);

  console.log("\n" + C.dim("─".repeat(74)));
  console.log(`推送完成：${ok.length}/${results.length} 成功`);
  if (DEMO || REFRESH) {
    console.log(C.y(
      REFRESH
        ? "⚠️ 本次是【同值刷新】：链上累计值没变（仍是模拟暴雨写上去的模拟值），只把喂价时刻推进到现在。答辩材料里请如实说明。"
        : "⚠️ 本次推送的是【模拟降雨数据】，仅用于演示。答辩材料里请如实说明。"
    ));
  }
  // E22：把这次用的随机种子写进日志。要一模一样复现这组模拟增量，照抄这一行即可。
  if (DEMO) console.log(C.dim(`   随机种子 seed=${SEED} —— 复现同一次：node push-rainfall.js --demo --seed=${SEED}`));

  if (over.length) {
    console.log("\n" + C.b("🎯 现在可以去前端点「申请赔付」了："));
    for (const x of over) {
      console.log(`   #${x.r.id} ${x.r.name}  保单期间增量 ${x.to - x.from}mm ≥ ${threshold}mm`);
    }
  }

  if (ok.length) {
    console.log("\n" + C.b("链上核验（不依赖任何在线浏览器）："));
    console.log("   双击桌面  汉客松-链上核验台.html");
    for (const x of ok) console.log(`   ${x.r.name}：${x.hash}`);
    console.log(C.dim("   （不要用 sepolia.otterscan.io —— 它的后端节点 10/4 起挂了，页面永远转圈）"));
  }

  /* ---- 失败区域汇总 + 退出码（A21）
     为什么必须有：原来哪怕 5 个区域全军覆没，脚本也 exit 0 —— 挂在定时任务里、
     或答辩当场手动跑，外面只看得到「跑完了」，看不见「其实一个都没喂上去」。
     口径：被拒收（FeedRejected）/ updateRainfall 抛错 / 多源分歧未过闸 = 硬失败；
     非单调跳过 = 允许的软跳过（见上面 skipped 标记），不计入。 */
  const failed = results.filter((x) => !x.ok && !x.skipped);
  const skipped = results.filter((x) => x.skipped);
  if (skipped.length) {
    console.log("\n" + C.dim(`按单调性守卫跳过 ${skipped.length} 个区域：${skipped.map((x) => x.r.name).join("、")}（链上现值更高，非失败）`));
  }
  if (failed.length) {
    console.log("\n" + C.r(`❌ 有 ${failed.length}/${results.length} 个区域喂价失败，进程将以非零码退出：`));
    for (const x of failed) {
      console.log(`   #${x.r.id} ${x.r.name.padEnd(4)} ${x.reason}${x.rejected ? "（异常数据已 rejectFeed 上链留证）" : ""}`);
    }
    // 用 exitCode 而不是 process.exit()：watch 模式下这次 main() 还在递归外层，
    // 立刻 exit 会把「汇总打印」截断；等栈退干净由 Node 自然带码退出。
    process.exitCode = 1;
  }

  /* ---- watch 模式 ---- */
  if (watchMin !== null) {
    console.log(`\n${C.c(`⏱  watch 模式：${watchMin} 分钟后自动再推一次。Ctrl+C 停止。`)}`);
    await sleep(watchMin * 60 * 1000);
    return main();
  }
}

/**
 * 喂价闸门第二层：三个独立数值预报模型的交叉核验（实现在 feed-verify.js）
 * ---------------------------------------------------------------------------
 * 第一层（collectRegion）比的是「同一家厂商的两条数据路径」，它能发现取数出错，
 * 但发现不了「这场雨本身三个模型就有分歧」。第二层补上这个：三个模型各自算一遍
 * 自 RAIN_EPOCH 起的累计值，只在**公共日期**上比，只有一致（或多数一致）才认这份数据。
 *
 * 返回 { ok, mm, confidence, sources, snapshot, verdict }
 *   · ok=false 时 mm=null —— 调用方**必须**拿这份快照去 rejectFeed 留证。
 *     拒收也是一种上链动作：链上留下「某天某个区域数据分歧、没有喂价」的记录。
 *   · ★ 喂进链上的累计值仍取第一层的 archive/forecast 口径值（链上口径不变），
 *     第二层只决定「这份数据够不够可信到可以写链」，以及 `sources` / `confidence` 取值。
 *     链上数字本身有没有被模型支撑，由判定层的 R2（背离 > 60% 即 DENY）再查一次 ——
 *     两层分工不同，不要混着讲：喂价闸门管「天气形势有没有共识」，判定层管「数字对不对」。
 */
async function verifyFeedWithModels(region, got) {
  const end = UNTIL || ymd(new Date());
  let series;
  try {
    series = await fetchModelSeries(region, end, RAIN_EPOCH);
  } catch (e) {
    // 取数失败本身也要留痕：不能因为「拉不到模型」就默认「模型同意」
    series = MODELS.map((m) => ({
      id: m.id, label: m.label, org: m.org, error: `取数失败：${e.message}`,
    }));
  }

  const v = gradeModels(series);
  const snapshot = Object.assign({}, got.snapshot, {
    schema: "rainproof/feed-snapshot@2",
    models: {
      requested: v.requestedModels,
      usable: v.usableModels,
      missing: v.missingModels,
      perModelMm: v.perModelMm || null,
      window: v.window || null,
      overlapDays: v.overlapDays || 0,
      medianMm: v.medianMm == null ? null : v.medianMm,
      spreadMm: v.spreadMm == null ? null : v.spreadMm,
      toleranceMm: v.toleranceMm == null ? null : v.toleranceMm,
      within: v.withinModels || [],
      outliers: v.outlierModels || [],
      status: v.status,
    },
  });

  return {
    ok: v.agree,
    mm: v.agree ? got.mm : null,
    confidence: Math.min(got.confidence, v.confidence),
    sources: v.sources,
    snapshot,
    verdict: v,
  };
}

/* ------------------------------------------------------------ 只读状态 */

const RISK_NAME = { 0: "正常", 1: "加价", 2: "拒保" };
const FEED_KIND = { 0: "喂价", 1: "损失判定" };

async function printStatus(readC, chainInfo) {
  const sym = chainInfo ? chainInfo.sym : "SepETH";
  const [threshold, payout, pool, paused, operator, regionCount, reserve, minConf] = await Promise.all([
    readEither(readC, THRESHOLD_SIGS),
    readEither(readC, [["PAYOUT()"], ["PAYOUT_MAX()"]]),
    readC.poolBalance(),
    readC.paused(), readC.operator(), readC.REGION_COUNT(),
    readEither(readC, [["reserveOf()"], ["reserve()"]]), readC.MIN_CONFIDENCE(),
  ]);
  console.log(C.dim("─".repeat(74)));
  console.log(`合约状态  ${paused ? C.y("已暂停") : C.g("运行中")}   operator ${operator}`);
  console.log(`资金池    ${formatEther(pool)} ${sym}   ${payout ? C.dim(`（单笔上限赔付 ${formatEther(payout)} ${sym}，最多还能赔 ${Number(pool / payout)} 笔）`) : ""}`);
  console.log(`准备金    ${formatEther(reserve)} ${sym}   ${C.dim("（提款后余额不得低于此线）")}`);
  if (chainInfo) {
    console.log(`所在链    ${chainInfo.isRealChain ? chainInfo.chainName : "⚠️ 本地假链"}` +
      ` · chainId ${chainInfo.chainId} · 块高 ${chainInfo.blockNumber}`);
  }
  console.log(C.dim("─".repeat(74)));
  // v2 的「喂价新鲜度」：lastFeedAt + MAX_FEED_AGE。超了 24h 就只能先喂价，否则 buyPolicy 会 revert。
  // 读不到 MAX_FEED_AGE()（v1 没有这道闸门、或读链整层挂了）时不再**静默**少一整列 ——
  // 少一列比多一行「这列为什么空」更容易被当成「一切正常」。
  const maxFeedAge = Number((await readEither(readC, MAX_FEED_AGE_SIGS)) || 0);
  if (!maxFeedAge) console.log(C.dim(`⚠️ 喂价新鲜度：本链读不到 MAX_FEED_AGE()（v1 没有这道闸门），下面每行不含「基线 剩 Xh」${whyNotRead(MAX_FEED_AGE_SIGS)}\n`));
  const nowSec = Math.floor(Date.now() / 1000);
  if (threshold === null) console.log(C.y(`⚠️ 读不到触发阈值（三种签名都试过，下面的条子会显示「阈值未知」）${whyNotRead(THRESHOLD_SIGS)}\n`));
  console.log(`区域状态（阈值 ${threshold === null ? "—" : threshold}mm · 验收门槛置信度 ${minConf} · 累计自 ${RAIN_EPOCH} 起算）\n`);
  for (let id = 1; id <= Number(regionCount); id++) {
    const r = REGIONS.find((x) => x.id === id);
    const [mmRaw, prem, risk, fj, feedAtRaw] = await Promise.all([
      readC.rainfall(id),
      readEither(readC, [["premiumOf(uint8,uint256)", [id, 24]], ["premiumOf(uint8)", [id]]]),
      readC.riskLevel(id), feedJudgementsOf(readC, id),
      maxFeedAge ? readEither(readC, [["lastFeedAt(uint8)", [id]]]) : Promise.resolve(null),
    ]);
    const mm = Number(mmRaw);   // ★ 链上返回 bigint，bar() 里要做除法，必须先转 Number
    const nm = r ? `${r.name}(${r.key})` : `region${id}`;
    const riskStr = (RISK_NAME[Number(risk)] || String(risk)) + (Number(risk) === 2 ? "⛔" : " ");
    const feedAt = Number(feedAtRaw || 0);
    const fresh = maxFeedAge
      ? C.dim(`  · 基线 ${feedAt ? (nowSec - feedAt > maxFeedAge
          ? "❌ 已过期（buyPolicy 会 revert：stale feed）"
          : `剩 ${((maxFeedAge - (nowSec - feedAt)) / 3600).toFixed(1)}h`) : "—（还没有喂过价）"}`)
      : "";
    const fjStr = fj === null
      ? C.dim(`—（判定记录读不出来）${whyNotRead(FEED_JUDGE_SIGS)}`)
      : fj.exists
      ? `${FEED_KIND[Number(fj.kind)] || fj.kind} 置信 ${fj.confidence}/源 ${fj.sources}` +
        C.dim(`  ${new Date(Number(fj.judgedAt) * 1000).toISOString().slice(0, 16).replace("T", " ")}`)
      : C.dim("—（还没有喂过价）");
    console.log(
      `  #${id} ${nm.padEnd(14)} ${String(mm).padStart(5)}mm  ${bar(mm, Number(threshold), 12)}  ` +
      `${(prem === null ? "—" : formatEther(prem) + " " + sym).padEnd(10)} ${riskStr.padEnd(6)} ${fjStr}${fresh}`
    );
  }
  console.log("");
}

/* ------------------------------------------------- 自检（--self-check，不联网不写盘）
 * bar() 是这块仪表盘上唯一会被「读不到数」影响的显示逻辑，钉住它的退化行为：
 *   node push-rainfall.js --self-check
 */
if (process.argv.includes("--self-check")) (async () => {
  let pass = 0, fail = 0;
  const ok = (n, c, extra = "") => { c ? pass++ : fail++; console.log(`${c ? "✅" : "❌"} ${n}${extra ? "  " + extra : ""}`); };
  const plain = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");   // 去掉 C.dim 的着色码再断言
  ok("阈值 null → 不画满格，明说阈值未知", plain(bar(300, null, 12)).includes("阈值未知"));
  ok("阈值 0（readEither 全挂的返回值）→ 不画满格", plain(bar(300, Number(null), 12)).includes("阈值未知"));
  ok("阈值 NaN → 不画满格", plain(bar(300, NaN, 12)).includes("阈值未知"));
  ok("阈值正常 → 300/50 满格", plain(bar(300, 50, 10)) === "█".repeat(10));
  ok("阈值正常 → 25/50 半格", plain(bar(25, 50, 10)) === "█".repeat(5) + "░".repeat(5));
  ok("读数 NaN → 全空（不参与除法）", plain(bar(NaN, 50, 10)) === "░".repeat(10));
  ok("超阈值封顶不越界", plain(bar(999, 50, 10)) === "█".repeat(10));

  // 采集层：缺测不许冒充 0mm（A6）。这两个数直接上链（累计值）与进哈希（snapshot）。
  const d = (vals, dates) => dailyRows(dates || ["2026-10-01", "2026-10-02", "2026-10-03"], vals, "2026-10-01");
  const r1 = d([1, null, 3]);
  ok("缺测那天不进序列、单独的 missingDays 记账",
    JSON.stringify(r1.dailyMm) === "[1,3]" && r1.missingDays === 1, JSON.stringify(r1));
  ok("缺测 ≠ 0mm：和数只算有数据的天（不会多一条 0mm 的假观测）",
    r1.dailyMm.includes(0) === false && r1.dailyMm.reduce((a, b) => a + b, 0) === 4);
  ok("空串 / 非数值串 / NaN 都算缺测（原写法 Number(v) || 0 会变成 0）",
    d(["", "abc", "1.5"]).missingDays === 2 && JSON.stringify(d(["", "abc", "1.5"]).dailyMm) === "[1.5]");
  ok("epoch 之前的日子既不进序列、也不算缺测",
    d([null, 2, 3], ["2026-09-30", "2026-10-01", "2026-10-02"]).missingDays === 0);
  ok("整段缺测 → 序列为空但 missingDays 记满（不是「晴朗无雨」）",
    d([null, null, null]).dailyMm.length === 0 && d([null, null, null]).missingDays === 3);

  // 读不到数时口径要说得出「为什么」（A12）。原来 catch 是空的，RPC 挂掉与「这链没这个函数」
  // 在屏幕上长得一模一样 —— 都是安静地少一列/一条「阈值未知」。
  const throwC = { getFunction: (sig) => () => { throw new Error("boom: " + sig); } };
  readFailures.length = 0;
  const gotNull = await readEither(throwC, [["THRESHOLD()"], ["THRESHOLD_PER_24H()"]]);
  ok("全挂仍返回 null（调用点契约不变）", gotNull === null);
  const why = plain(whyNotRead([["THRESHOLD()"], ["THRESHOLD_PER_24H()"]]));
  ok("但原因被记下来：说得出试过哪个签名、错在哪", why.includes("THRESHOLD()") && why.includes("boom"), why.trim());
  ok("认不出的探针组不会张冠李戴（返回空串）", plain(whyNotRead([["NOPE()"]])).trim() === "");
  readFailures.length = 0;
  const okC = { getFunction: () => () => 42n };
  ok("读得到时不记失败", (await readEither(okC, [["THRESHOLD()"]])) === 42n && readFailures.length === 0);

  // F15：手抄的 feedJudgements 少了一个返回值 ⇒ v3 链上 exists 会被解成 rainfallAtJudgement，
  // 「有拒收留痕」显示成「还没有喂过价」。钉住真 ABI 的输出个数 + 选版本用的那个探针。
  const fjIface = (v) => new Interface(JUDGEMENT_ABIS.find((a) => a.v === v).abi);
  const fjOutputs = (v) => fjIface(v).getFunction("feedJudgements(uint8)").outputs.length;
  const hasFn = (v, n) => JUDGEMENT_ABIS.find((a) => a.v === v).abi.some((f) => f.type === "function" && f.name === n);
  ok("v3 的 feedJudgements 是 10 个返回值（不是手抄的 9 个）", fjOutputs("V3") === 10, `实测 ${fjOutputs("V3")}`);
  ok("v2 的 feedJudgements 是 9 个返回值（两版确实不同，不能共用一条签名）", fjOutputs("V2") === 9, `实测 ${fjOutputs("V2")}`);
  ok("选版本的探针成立：entryThresholdOf 只在 v3 有（v2 认不出来时会退到 9 输出那版）",
    hasFn("V3", "entryThresholdOf") && !hasFn("V2", "entryThresholdOf"));
  // 钉住「不能靠试探解码选 ABI」这条结论：v3 的返回值用 9 输出签名能**静默**解出一堆错位字段。
  const v3Payload = fjIface("V3").encodeFunctionResult("feedJudgements(uint8)",
    [1, 0, 80, 3, 1760000000n, 12345n, true, "0x" + "00".repeat(32), "0x" + "00".repeat(32), "rain-oracle-v1"]);
  let silent = false;
  try { fjIface("V2").decodeFunctionResult("feedJudgements", v3Payload); silent = true; } catch (_) { /* 报错才是好事 */ }
  ok("反证：v3 的返回值拿 9 输出签名解不报错（所以才必须先认版本，不能试解）", silent);

  // F16：--watch 的参数校验（NaN 会让 sleep(NaN) 立即返回 ⇒ 零延迟递归 + 每轮真发交易）
  ok("--watch 5 认作 5 分钟", watchMinutes("5") === 5);
  ok("--watch 10min / abc / 0 / -1 一律报错，不落进 NaN 死循环",
    ["10min", "abc", "0", "-1", "  "].every((x) => { try { watchMinutes(x); return false; } catch (_) { return true; } }));
  ok("不给 --watch 时是 null（照常单次推送）", watchMinutes(null) === null);

  console.log(`\n${fail ? "❌" : "✅"} push-rainfall 自检：${pass} 项通过 / ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
})();

/* ---------------------------------------------------------------- 入口 */

// 只有直接运行才发交易。**这一点是硬要求**：本文件 require 进来会走 main()，
// 而 main() 会往链上写喂价（要私钥、要花 gas）—— 被别的脚本 require 一次就发一笔交易，
// 这是最不该有的副作用。要复用里面的函数请 require 后取 module.exports。
if (require.main === module && !process.argv.includes("--self-check")) {
  main().catch((e) => {
    console.error("\n" + C.r("❌ 失败：") + (e.shortMessage || e.message || e));
    process.exit(1);
  });
}

module.exports = { bar, readEither, whyNotRead, dailyRows };
