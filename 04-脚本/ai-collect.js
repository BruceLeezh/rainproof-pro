/**
 * AI 判定 · 第 1 步 —— 采集证据快照（snapshot）
 * ============================================================================
 *
 * 【这一层在做什么】
 *   合约不能自己上网（链是确定性的），所以「外面到底下了多少雨」必须由链下写进去。
 *   喂价脚本（push-rainfall.js）干的是「写进去」；本脚本干的是【独立复核】：
 *   它绕开那个写数的人，自己去问三个气象模型，然后和链上的数字对一遍。
 *
 *   这就是把「你信不信我」变成「你自己验」在链下的那一半：
 *   预言机是单一运营方，AI 是第二个、独立的意见 —— 而两者的证据都留痕、可复算。
 *
 * 【三模型是三个真的不同模型，不是同一个源换个名字】
 *   ECMWF IFS025 / GFS / ICON 是欧洲、美国、德国三家的数值预报，
 *   实测同一坐标同一天可以差很多（如武汉 10-03：13.7 / 6.3 / 5.0 mm）。
 *   模型之间的分歧量本身就是风险度量，所以快照里既存各模型的逐日序列，也存离散度。
 *
 * 【产物】
 *   09-AI判定留痕/snapshot-policy<N>.json
 *   文件结构 = { snapshot: {...}, collectedAt: "...", inputHash: "0x..." }
 *   inputHash = keccak256(canonicalize(snapshot)) —— 任何人拿到这个文件都能自己
 *   重算一遍并核对（口径见 04-脚本/canonical.js）。上链时只写这个 32 字节哈希，
 *   完整快照留在仓库里，评委可逐字节复现。
 *   ⚠️ collectedAt 故意放在 snapshot【外面】：采集时间每次都不一样，塞进被哈希的
 *   对象会让「同一份数据重跑必得同一个哈希」这句话当场失效。
 *
 * 【用法】
 *   node ai-collect.js 0                 # 真实三模型，复核链上数据
 *   node ai-collect.js 0 --demo          # 演示模式：模型序列由链上值合成，并在快照里
 *                                        # 明确标记 simulated=true（不撒谎）
 */

try { require("dotenv").config(); } catch (_) { /* dotenv 可选 */ }
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Contract } = require("ethers");
const { REGION_BY_ID, RAIN_EPOCH, assertRegionsMatchContract, regionOf } = require("./regions");
const { evidenceHashOf } = require("./canonical");

const RPC = process.env.SEPOLIA_RPC || process.env.RPC_URL || "http://127.0.0.1:8545";
const ADDR = process.env.CONTRACT_ADDRESS || "";
const OUT_DIR = process.env.AI_OUT_DIR || path.join(__dirname, "..", "09-AI判定留痕");

// 三个模型 + 给人看的名字。顺序固定，写进快照，判定脚本按同一顺序读。
const MODELS = [
  { id: "ecmwf_ifs025", label: "ECMWF IFS025", org: "欧洲中期天气预报中心" },
  { id: "gfs_seamless", label: "GFS",          org: "美国 NOAA/NCEP" },
  { id: "icon_seamless", label: "ICON",        org: "德国气象局 DWD" },
];

const COLLECT_VERSION = "ai-collect-v1";

// ABI 一律从 03-合约/*.abi.json 读，不手抄。手抄的那份是 v1 的 Policy 结构体，
// 而 v2 的结构体在 rider 后面多了 productId / premium 两个字段 —— 拿 v1 的元组去解 v2 的
// policies()，字段整体错位：p.startTime 解成 regionId(=4)、p.endTime 解成 premium
// (=0.0003 ether = 3e14 秒)，shDate() 里 toISOString() 直接抛 "Invalid time value"。
const ABI_DIR = path.join(__dirname, "..", "03-合约");
const ABI_V1 = JSON.parse(fs.readFileSync(path.join(ABI_DIR, "RainDeliveryInsurance.abi.json"), "utf8"));
const ABI_V2 = JSON.parse(fs.readFileSync(path.join(ABI_DIR, "RainDeliveryInsuranceV2.abi.json"), "utf8"));
const ABI_V3 = JSON.parse(fs.readFileSync(path.join(ABI_DIR, "RainDeliveryInsuranceV3.abi.json"), "utf8"));
const ABI_V5 = JSON.parse(fs.readFileSync(path.join(ABI_DIR, "RainDeliveryInsuranceV5.abi.json"), "utf8"));

const ARGV = process.argv.slice(2);
const POLICY_ID = Number(ARGV.find((a) => /^\d+$/.test(a)));
const DEMO = ARGV.includes("--demo");
// --until=YYYY-MM-DD：把证据窗口的结束日钉住（默认取保单 endTime 那天）。
// 历史回放用它，是为了让"链上官方增量覆盖的日子"与"三模型求和的日子"严格一致 ——
// 差一天就可能把 R2（背离 > 60%）误触发。
const UNTIL = (ARGV.find((a) => a.startsWith("--until=")) || "").split("=")[1] || null;

/** unix 秒 → 亚洲/上海时区的 YYYY-MM-DD（判定窗口按自然日切，必须钉在同一个时区）
 *  ★ 口径只有 ./shardate 一处实现（A11）：本文件原来自己写了一份 +8 的切法，
 *    而 push-rainfall 按主机本地时区切、hook-watch 按 UTC 切 —— 同一天在三个脚本里
 *    可能落在三个不同的日期上，而每边的哈希各自自洽，谁也报不出错。 */
const { shDate } = require("./shardate");

/** 逐日累加，返回 6 位小数 —— 和 canonical 的口径对齐，避免 0.30000000000000004 这种哈希漂移 */
const sum6 = (arr) => Math.round(arr.reduce((x, y) => x + y, 0) * 1e6) / 1e6;

/**
 * 把接口返回的逐日序列裁成判定要用的那一段（纯函数 —— `07-测试工具/check-ai.js` 直接断言它）。
 * 三条纪律，缺一条就会算错雨量：
 *   ① **缺测不许当 0**：`Number(null) === 0`，一句 `Number(v) || 0` 就把「这天没数」
 *      写成「这天下 0mm」，而这个 0 还会被 canonical.js 哈希进去。与喂价层
 *      `feed-verify.js:71-73` 同一条纪律：缺测那天不进序列，另记 missingDays 留痕。
 *   ② **下界 = RAIN_EPOCH**：`past_days=14` 会带出赛事周之前的日子，不裁就凭空多一周的雨。
 *   ③ **上界 = min(窗口结束日, 今天)**：`forecast_days=3` 会把**未来两天预报**也算进窗口，
 *      而链上的官方增量只到「今天」—— 未来那两天会抬高模型侧中位数，把 R2（背离 > 60%）误触发。
 */
function sliceModelSeries(m, allDates, raw, { startDate, windowEnd, epoch = RAIN_EPOCH }) {
  const rows = allDates.map((d, i) => {
    const n = raw[i] == null ? NaN : Number(raw[i]);
    return [d, Number.isFinite(n) ? n : null];
  });
  const sinceEpoch = rows.filter(([d, v]) => d >= epoch && v !== null);
  const inWindow = sinceEpoch.filter(([d]) => d >= startDate && d <= windowEnd);
  return {
    id: m.id, label: m.label, org: m.org,
    sinceEpochMm: sum6(sinceEpoch.map(([, mm]) => mm)),
    inWindowMm: sum6(inWindow.map(([, mm]) => mm)),
    days: sinceEpoch.map(([date, mm]) => ({ date, mm })),
    missingDays: rows.filter(([d, v]) => d >= epoch && v === null).length,
  };
}

/**
 * 拉一个区域的三个模型，裁剪到 [RAIN_EPOCH, min(窗口结束日, 今天)]，
 * 返回 `{ models: [{id,label,org,sinceEpochMm,inWindowMm,days,missingDays}], windowEnd }`
 * —— windowEnd 一起返回，是为了让快照里写的 `weather.windowTo` 与实际求和的日子**同源**。
 */
async function fetchModels(region, startDate, endDate) {
  const today = shDate(Date.now() / 1000);
  const historical = !!endDate && endDate < today;
  const windowEnd = historical ? endDate : today;   // 见 sliceModelSeries ③
  let url;
  if (historical) {
    // ★ 历史回放：保单窗口整个在过去。
    //   forecast 接口的 past_days 是相对「现在」的 —— 拿它去核对一场两年前的暴雨，
    //   只会取回最近 14 天的雨，跟那场暴雨毫无关系。改用历史预报归档接口，显式指定起止日期。
    const from = new Date(Date.parse(startDate + "T00:00:00Z") - 14 * 86400000).toISOString().slice(0, 10);
    url = "https://historical-forecast-api.open-meteo.com/v1/forecast"
      + `?latitude=${region.lat}&longitude=${region.lon}`
      + "&daily=precipitation_sum&timezone=Asia%2FShanghai"
      + `&start_date=${from}&end_date=${endDate}`
      + `&models=${MODELS.map((m) => m.id).join(",")}`;
  } else {
    url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${region.lat}&longitude=${region.lon}`
      + "&daily=precipitation_sum&timezone=Asia%2FShanghai&past_days=14&forecast_days=3"
      + `&models=${MODELS.map((m) => m.id).join(",")}`;
  }
  const r = await fetch(url, { headers: { "User-Agent": "rainproof-ai-collector/1.0" } });
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  const j = await r.json();
  if (!j.daily || !j.daily.time) throw new Error("Open-Meteo 返回里没有 daily.time");

  const allDates = j.daily.time;
  const models = MODELS.map((m) => {
    const raw = j.daily[`precipitation_sum_${m.id}`];
    if (!raw) throw new Error(`Open-Meteo 没有返回模型 ${m.id} 的序列`);
    return sliceModelSeries(m, allDates, raw, { startDate, windowEnd });
  });
  return { models, windowEnd };
}

/**
 * 演示模式用的合成序列。
 * ⚠️ 关键在诚实：真实三模型对不上「脚本注入的模拟暴雨」（链上 80mm，真实模型 24mm），
 * 硬拿真实数据去核对会得到 DENY，演示就演不下去。所以演示模式明确【合成】一份
 * 与链上值一致的模型序列，并在快照里打上 simulated=true —— 让记录自己说明它是模拟的，
 * 而不是让 AI 假装核对通过。
 */
function synthModels(region, startDate, targetMm, onchainValue) {
  // 固定偏移，保证同样输入永远得到同样的快照（可复算）
  const offsets = [0, -0.06, 0.04];
  const days = [];
  // 把 targetMm 摊在窗口内的每一天：第一天占 60%，其余均分 —— 形状不重要，
  // 重要的是「模拟」这两个字被写进证据里。
  const span = Math.max(1, (new Date(shDate(Date.now() / 1000)) - new Date(startDate)) / 86400000 + 1);
  for (let i = 0; i < span; i++) {
    const d = new Date(new Date(startDate).getTime() + i * 86400000).toISOString().slice(0, 10);
    days.push({ date: d, mm: 0 });
  }
  if (days.length) days[0].mm = Math.round(targetMm * 0.6 * 1e6) / 1e6;
  const rest = Math.round((targetMm - days[0].mm) * 1e6) / 1e6;
  for (let i = 1; i < days.length; i++) days[i].mm = Math.round((rest / (days.length - 1)) * 1e6) / 1e6;

  return MODELS.map((m, i) => {
    const mm = Math.round(targetMm * (1 + offsets[i]) * 1e6) / 1e6;
    return {
      id: m.id, label: m.label, org: m.org,
      sinceEpochMm: onchainValue,
      inWindowMm: mm,
      days: days.map((d) => ({ ...d, mm: Math.round(d.mm * (1 + offsets[i]) * 1e6) / 1e6 })),
      // 合成序列没有缺测；带上这个字段是为了与真实路径的快照形状一致，
      // 免得「有 missingDays 才是真数据」这种形状差异被当成区分真假的暗号。
      missingDays: 0,
    };
  });
}

/* --------------------------------------------- 自检（--self-check，不联网不写盘）
 * sliceModelSeries 的三条纪律逐条钉住 —— 这三条错了，判定结果就会错，
 * 而且错得「看起来很正常」（少算雨量、多算未来预报）。
 *   node ai-collect.js --self-check
 * 放在主流程【之前】：主流程是 IIFE，进来就发请求，不能让自检和它赛跑。
 */
if (require.main === module && process.argv.includes("--self-check")) {
  let pass = 0, fail = 0;
  const ok = (n, c, extra = "") => { c ? pass++ : fail++; console.log(`${c ? "✅" : "❌"} ${n}${extra ? "  " + extra : ""}`); };
  const M = { id: "test-model", label: "T", org: "Test" };
  const S = (dates, raw, o) => sliceModelSeries(M, dates, raw, o);
  const O = (startDate, windowEnd) => ({ startDate, windowEnd, epoch: "2026-10-01" });

  // ① 缺测不许当 0
  let r = S(["2026-10-01", "2026-10-02", "2026-10-03"], [1, null, 2], O("2026-10-01", "2026-10-03"));
  ok("缺测那天不进序列（天数 2/3、missingDays 1）", r.days.length === 2 && r.missingDays === 1, `days=${r.days.length} missing=${r.missingDays}`);
  r = S(["2026-10-01", "2026-10-02"], [null, null], O("2026-10-01", "2026-10-02"));
  ok("整段缺测 → 0mm 但 days 为空、missingDays=2（不是「晴朗无雨」）", r.inWindowMm === 0 && r.days.length === 0 && r.missingDays === 2, `missing=${r.missingDays}`);
  r = S(["2026-10-01", "2026-10-02"], [1, NaN], O("2026-10-01", "2026-10-02"));
  ok("NaN 视同缺测", r.missingDays === 1 && r.inWindowMm === 1);
  r = S(["2026-10-01", "2026-10-02"], [1, "abc"], O("2026-10-01", "2026-10-02"));
  ok("非数值字符串视同缺测（不是 0）", r.missingDays === 1 && r.inWindowMm === 1);

  // ② 下界 = epoch：赛事周之前的日子不进累计
  r = S(["2026-09-30", "2026-10-01", "2026-10-02"], [9, 1, 1], O("2026-10-01", "2026-10-02"));
  ok("epoch 之前的日子不计入（sinceEpoch = 1+1）", r.sinceEpochMm === 2 && r.days.length === 2, `sinceEpoch=${r.sinceEpochMm}`);

  // ③ 上界 = min(窗口结束日, 今天)：未来预报不进窗口
  r = S(["2026-10-01", "2026-10-02", "2026-10-03"], [1, 50, 50], O("2026-10-01", "2026-10-01"));
  ok("未来两天预报不进窗口（inWindow = 1，不把 100mm 的预报算进来）", r.inWindowMm === 1 && r.sinceEpochMm === 101);
  r = S(["2026-10-01", "2026-10-02"], [3, 4], O("2026-10-01", "2026-10-02"));
  ok("窗口内正常求和", r.inWindowMm === 7);

  console.log(`\n${fail ? "❌" : "✅"} ai-collect 自检：${pass} 项通过 / ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
}

// 只有「直接运行」才走主流程。被 require 时必须保持静默 ——
/* 指纹探测失败的两种原因必须分开（只动错误处理，不动取数字段与哈希口径）：
   CALL_EXCEPTION / BAD_DATA = 这把 ABI 的函数在合约上真不存在 → 可以退回旧版；
   其它（超时 / ECONNREFUSED / 限流 / 节点 5xx）= 我们不知道链上是什么版本
   → 必须抛出重试。原来一律 catch 成「不是 v3/v2」，等于把网络故障当成版本信号，
     接着拿 v1 ABI 去解 v2/v3 的 policies()，元组整体错位、静默算错哈希。 */
function isMissingFunction(e) {
  const code = (e && e.code) || (e && e.info && e.info.error && e.info.error.code);
  return code === "CALL_EXCEPTION" || code === "BAD_DATA";
}
function throwIfNetErr(kind, e) {
  if (isMissingFunction(e)) return;
  const err = new Error(
    `合约版本指纹探测失败（试 ${kind} 的只读函数时出错）：${(e && (e.shortMessage || e.message)) || e}\n` +
    `  这不是「链上没有这个函数」，是 RPC / 网络层面的问题 —— 不敢猜版本，请确认 RPC 可达后重跑。`
  );
  err.cause = e;
  throw err;
}

// 07-测试工具/check-ai.js 要断言 sliceModelSeries（窗口上界/缺测口径），
// 一 require 就发网络请求的话，门禁会变成一条依赖外网的测试。
if (require.main === module) (async () => {
  if (!Number.isInteger(POLICY_ID)) {
    console.error("用法：node ai-collect.js <policyId> [--demo]");
    process.exit(2);
  }
  if (!ADDR) { console.error("缺少 CONTRACT_ADDRESS 环境变量"); process.exit(2); }

  const provider = new JsonRpcProvider(RPC);
  // 按链上有没有 v2 的 thresholdOf() 选 ABI：968 / 677 走 v2，
  // Sepolia 的 v1 与 2024 武汉暴雨回放链走 v1（两边的 Policy 结构体不同，不能混用）。
  // 按链上有的「版本指纹」选 ABI：v5 regionCount()｜v3 entryThresholdOf(uint256)｜v2 thresholdOf(uint256)｜v1 THRESHOLD()。
  // 探测顺序必须从新到旧：拿旧 ABI 去问新合约，ethers 只会报「这不是合约函数」，分不清版本。
  // 注意 ABI 与合约必须成套：v5 的 policies() 字段顺序与 v3 不同（v5 第 3 位是 productId，
  // 且多出 effectiveFrom/thresholdMm/tier/payout/settled），拿 v3 ABI 解 v5 会整体错位。
  let c = new Contract(ADDR, ABI_V5, provider);
  let kind = "v5";
  try { await c.regionCount(); }
  catch (e) {
    throwIfNetErr("v5", e);
    kind = "v3";
    c = new Contract(ADDR, ABI_V3, provider);
    try { await c.entryThresholdOf(24); }
    catch (e2) {
      throwIfNetErr("v3", e2);
      kind = "v2";
      c = new Contract(ADDR, ABI_V2, provider);
      try { await c.thresholdOf(24); }
      catch (e3) { throwIfNetErr("v2", e3); kind = "v1"; c = new Contract(ADDR, ABI_V1, provider); }
    }
  }
  await assertRegionsMatchContract(c);   // v5 走 regions(uint32)：名字 + active 双校   // 区域表对不上就别往下走

  const p = await c.policies(POLICY_ID);
  if (!p.exists) { console.error(`保单 #${POLICY_ID} 不存在`); process.exit(2); }
  const region = regionOf(p.regionId);   // v5 传区划码、老版本传 1..5，regionOf 两套都认
  if (!region) { console.error(`区域 #${p.regionId} 不在区域表里`); process.exit(2); }

  const startDate = shDate(p.startTime);
  const endDate = UNTIL || shDate(p.endTime);
  const onchainCum = Number(await c.rainfall(p.regionId));
  const incrementMm = Number(await c.rainfallDuring(POLICY_ID));
  // 阈值必须从「正在判定的那份合约」读，不能从定价表读 —— 2026-10-07 全仓审计 D1:
  //   链上 v2: thresholdOf(h) = 50 × h / 24（24/48/72h → 50/100/150mm，可线性外推）
  //   定价 v3: 国标 GB/T 28592 两档表 {12:[30,70], 24:[50,100]}mm（04-脚本 与 10-金融与定价/pricing-engine.json 口径）
  // 两套档线服务于不同的东西（v2 是「按窗口缩放的保护线」，v3 是「国标暴雨等级」），
  // 所以 AI 层下游的 thresholdMm 一定要跟着被判定合约走。曾经把 v3 的 12h 线（30mm）
  // 写成 50×12/24 = 25mm 并列进对外材料里，同一个「12h 暴雨险」出现两个数 —— 对外引用
  // 档线时必须连合约名、窗口一起写。v2 上 hours 只允许 24/48/72（hoursAllowed），
  // 所以 12h 那行在 v2 上永远走不到。
  // v3 上 hours 只允许 12/24（hoursAllowed），阈值走国标两档表的入口线 = thresholdOf(hours, 0)。
  const thresholdMm = Number(
    kind === "v5" ? await c.entryThresholdOf(p.windowHours)   // v5 与 v3 同名同义：国标入口线
      : kind === "v3" ? await c.entryThresholdOf(p.windowHours)
        : kind === "v2" ? await c.thresholdOf(p.windowHours)
          : await c.THRESHOLD());
  const minConfidence = Number(await c.MIN_CONFIDENCE());

  // 证据窗口的上界：窗口结束日与今天取小（见 sliceModelSeries ③）。
  // 演示模式的合成序列本来就只铺到「今天」，两条路保证同一个上界。
  let windowEnd = shDate(Date.now() / 1000);
  let models;
  if (DEMO) {
    models = synthModels(region, startDate, incrementMm, onchainCum);
  } else {
    ({ models, windowEnd } = await fetchModels(region, startDate, endDate));
  }

  const snapshot = {
    schema: "rainproof/judge-input@1",
    collectVersion: COLLECT_VERSION,
    policyId: POLICY_ID,
    simulated: DEMO,
    ...(DEMO ? { simulationNote: "模型序列由链上注入值合成，用于演示；真实模式下会向 ECMWF/GFS/ICON 实取。" } : {}),
    epoch: RAIN_EPOCH,
    region: { id: region.id, key: region.key, name: region.name, lat: region.lat, lon: region.lon },
    policy: {
      rider: p.rider,
      regionId: Number(p.regionId),
      startTime: Number(p.startTime),
      endTime: Number(p.endTime),
      startDate,
      rainfallAtBuy: Number(p.rainfallAtBuy),
      paid: p.paid,
    },
    oracle: {
      // 链上那本账（由喂价脚本写入）—— AI 的对照物
      cumulativeMm: onchainCum,
      officialIncrementMm: incrementMm,
      contract: ADDR,
      chainId: Number((await provider.getNetwork()).chainId),
    },
    weather: {
      source: DEMO ? "synthetic" : "open-meteo:ecmwf_ifs025+gfs_seamless+icon_seamless",
      api: DEMO ? "synthetic" : (endDate < shDate(Date.now() / 1000) ? "open-meteo:historical-forecast-api" : "open-meteo:forecast-api"),
      windowFrom: startDate,
      // 与 sliceModelSeries 实际求和的日子【同源】：窗口结束日与今天取小。
      // 写成 endDate 会撒谎 —— 未来两天的预报确实进了求和，但快照声称窗口还没结束。
      windowTo: windowEnd,
      models,
    },
    thresholds: { thresholdMm, minConfidence },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `snapshot-policy${POLICY_ID}.json`);
  const inputHash = evidenceHashOf(snapshot);
  // collectedAt 放在被哈希对象【之外】：它每次采集都不一样，一旦进了 snapshot，
  // 同一份数据重跑就会得到不同的 inputHash，「第三方独立复算」当场不成立。
  fs.writeFileSync(file, JSON.stringify({ snapshot, collectedAt: new Date().toISOString(), inputHash }, null, 2));

  const inc = models.map((m) => m.inWindowMm);
  console.log("=".repeat(74));
  console.log(`证据快照已生成（保单 #${POLICY_ID} · ${region.name}）${DEMO ? "  ⚠️ 模拟数据" : ""}`);
  console.log("=".repeat(74));
  console.log(`窗口        ${startDate} 起 · 阈值 ${thresholdMm}mm`);
  console.log(`链上官方增量 ${incrementMm}mm  （累计 ${onchainCum}mm，投保时快照 ${p.rainfallAtBuy}mm）`);
  console.log(`三模型窗口增量  ${inc.join(" / ")} mm   （${MODELS.map((m) => m.label).join(" · ")}）`);
  console.log(`inputHash   ${inputHash}`);
  console.log(`写入        ${file}`);
})().catch((e) => {
  console.error("💥 采集失败：" + (e.shortMessage || e.message || e));
  process.exit(1);
});

// 导出纯函数供门禁断言（07-测试工具/check-ai.js）。
module.exports = { sliceModelSeries, synthModels, MODELS, shDate };
