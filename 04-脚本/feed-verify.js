/**
 * 喂价验收：三个独立数值预报模型的交叉核验（AI 判定层的落点一）
 * ============================================================================
 *
 * 【为什么单独一个文件】
 *   `push-rainfall.js` 是入口脚本（require 它就会直接跑 main），所以把
 *   「三模型取数 + 一致性判定」放在这里：入口脚本调它，检查脚本也能用同一份实现，
 *   「离群就拒收」这件事才有断言可写。
 *
 * 【口径纪律】（与 `ai-collect.js:77-120` 完全一致，两边必须对得上）
 *   · 一天一个数：`&daily=precipitation_sum` —— 链上推的是累计值，不是瞬时值。
 *   · 窗口整个在过去 → 用 `historical-forecast-api` 显式指定起止日期；
 *     窗口跨到今天   → 用 `forecast` 接口的 `past_days=14`（相对「现在」回看）。
 *   · 逐日序列一律裁到 `RAIN_EPOCH` 当日及以后：不裁就会把赛事周之前的雨算进来，
 *     累计值凭空多一周，直接导致不该赔的保单被判定达标。
 *   · 三个模型的 id 与顺序必须与 `ai-collect.js:45-48` 一致 —— 喂价闸门和判定层
 *     读同一套模型，否则「喂价验收」与「判定复核」就是两套标准。
 *
 * 【判定规则】（写进快照、可复算）
 *   三模型都可用且离散度 ≤ 容差        → 采信，置信度 92，sources = 3
 *   多数模型可用且落在中位数 ± 容差内  → 采信，置信度 84，sources = 落在容差内的模型数
 *   可用模型 < 2 个 / 无公共日期 / 多数不成立 → **拒收**（mm=null, confidence 40）
 *   容差 = max(1, |中位数| × 20%) —— 1mm 地板防止「0.2mm vs 0.4mm」被当成离群
 *
 * 拒收 != 什么都不做：调用方要拿这份快照去 `rejectFeed(...)`，让异常在链上留痕。
 */

const { RAIN_EPOCH } = require("./regions");

// 与 ai-collect.js:45-48 同序同名（那边受判定快照哈希约束，不要动）
const MODELS = [
  { id: "ecmwf_ifs025", label: "ECMWF IFS025", org: "欧洲中期天气预报中心" },
  { id: "gfs_seamless", label: "GFS",          org: "美国 NOAA/NCEP" },
  { id: "icon_seamless", label: "ICON",        org: "德国气象局 DWD" },
];

const ROUND1 = (x) => Math.round(x * 10) / 10;
const sum1 = (arr) => ROUND1(arr.reduce((a, b) => a + b, 0));

/** unix 秒 → 亚洲/上海时区的 YYYY-MM-DD（窗口按自然日切，必须钉在同一个时区）
 *  ★ 口径只有 ./shardate 一处实现（A11）：本文件与 ai-collect 原来各写了一份同样的 +8 切法，
 *    而 push-rainfall 按主机本地时区切、hook-watch 按 UTC 切 —— 同一天在三个脚本里可能落在
 *    三个不同的日期上，且每边的哈希各自自洽，谁也报不出错。 */
const { shDate } = require("./shardate");

/**
 * 拉一个区域的三个模型，返回 [{id,label,org,dates,dailyMm,_map,sum}]。
 * 某个模型没有序列（例如历史归档里那个模型全是 null）就返回带 error 的项，
 * 而不是抛异常 —— 「某个模型不可用」本身是要被记录、被判定的事实。
 */
async function fetchModelSeries(region, endDate, epoch = RAIN_EPOCH) {
  const today = shDate(Date.now() / 1000);
  const historical = !!endDate && endDate < today;
  const base =
    `latitude=${region.lat}&longitude=${region.lon}` +
    `&daily=precipitation_sum&timezone=Asia%2FShanghai`;
  const models = MODELS.map((m) => m.id).join(",");
  const url = historical
    ? `https://historical-forecast-api.open-meteo.com/v1/forecast?${base}` +
      `&start_date=${epoch}&end_date=${endDate}&models=${models}`
    : `https://api.open-meteo.com/v1/forecast?${base}` +
      `&past_days=14&forecast_days=0&models=${models}`;

  const r = await fetch(url, { headers: { "User-Agent": "rainproof-feed-verifier/1.0" } });
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  const j = await r.json();
  const allDates = j?.daily?.time || [];

  return MODELS.map((m) => {
    const raw = j?.daily?.[`precipitation_sum_${m.id}`];
    const head = { id: m.id, label: m.label, org: m.org, url };
    if (!raw) return Object.assign(head, { error: "接口没有返回这个模型的序列" });

    // F17：`raw[i] == null ? null : Number(raw[i])` 拦不住 NaN —— 接口返回空串/非数值串时
    // `Number("") === 0`（伪造出 0mm 的假观测）、`Number("abc") === NaN` 会一路混进
    // median/spread，整区被判 diverge 并写 FeedRejected 上链。口径对齐 push-rainfall.js 的
    // dailyRows()：null / 空串 / 非数值 / 非有限值一律算缺测，不进序列。
    const num = (v) =>
      (v === null || v === undefined || String(v).trim() === "" || !Number.isFinite(Number(v))
        ? null : Number(v));
    const keep = allDates
      .map((d, i) => [d, num(raw[i])])
      .filter(([d, v]) => d >= epoch && v !== null);
    if (!keep.length) return Object.assign(head, { error: `自 ${epoch} 起没有有效数据` });

    const dates = keep.map(([d]) => d);
    const dailyMm = keep.map(([, v]) => v);
    return Object.assign(head, {
      dates, dailyMm, sum: sum1(dailyMm),
      _map: new Map(keep),
      first: dates[0], last: dates[dates.length - 1],
    });
  });
}

/** 只在「可用模型都有值」的日期上求和 —— 拿 5 天比 20 天，差多少都说明不了问题 */
function compareOnCommonDates(usable) {
  const common = usable[0].dates.filter((d) => usable.every((s) => s._map.has(d)));
  return {
    dates: common,
    perModel: usable.map((s) => ({
      id: s.id, label: s.label, org: s.org,
      mm: sum1(common.map((d) => s._map.get(d))),
      days: common.length,
    })),
  };
}

/**
 * 纯函数：给一组模型序列，判定「能不能喂价」。
 * @param series fetchModelSeries 的返回值
 * @param opts.tolRatio 容差比例（默认 0.2）
 * @param opts.minModels 采信所需的最少模型数（默认 2）
 */
function gradeModels(series, opts = {}) {
  const tolRatio = opts.tolRatio == null ? 0.2 : opts.tolRatio;
  const minModels = opts.minModels == null ? 2 : opts.minModels;

  const list = series || [];
  const usable = list.filter((s) => s && !s.error && s.dates && s.dates.length);
  const base = {
    requestedModels: MODELS.map((m) => m.id),
    usableModels: usable.map((s) => s.id),
    missingModels: list.filter((s) => !s || s.error).map((s) => ({
      id: s ? s.id : "(null)", error: s ? s.error : "没有返回",
    })),
  };

  if (usable.length < minModels) {
    return Object.assign(base, {
      status: "insufficient", agree: false, mm: null, confidence: 40, sources: usable.length,
      note: `可用模型只有 ${usable.length} 个（需要 ≥ ${minModels}）—— 交叉核验不成立，拒收`,
    });
  }

  const cmp = compareOnCommonDates(usable);
  if (!cmp.dates.length) {
    return Object.assign(base, {
      status: "no-overlap", agree: false, mm: null, confidence: 40, sources: usable.length,
      note: "可用模型之间没有公共日期，无法比对 —— 拒收",
    });
  }

  const sums = cmp.perModel.map((p) => p.mm).slice().sort((a, b) => a - b);
  const median = sums.length % 2
    ? sums[(sums.length - 1) / 2]
    : ROUND1((sums[sums.length / 2 - 1] + sums[sums.length / 2]) / 2);
  const spread = ROUND1(sums[sums.length - 1] - sums[0]);
  const tolerance = Math.max(1, ROUND1(Math.abs(median) * tolRatio));
  const within = cmp.perModel.filter((p) => Math.abs(p.mm - median) <= tolerance);
  const outliers = cmp.perModel.filter((p) => !within.includes(p));

  const detail = {
    overlapDays: cmp.dates.length,
    window: `${cmp.dates[0]} ~ ${cmp.dates[cmp.dates.length - 1]}`,
    perModelMm: cmp.perModel,
    medianMm: median,
    spreadMm: spread,
    toleranceMm: tolerance,
    withinModels: within.map((p) => p.id),
    outlierModels: outliers.map((p) => p.id),
  };

  // ★ 判据是「每个模型是否落在中位数 ± 容差内」，不是「极差 ≤ 容差」：
  //   三个数 36/42/47 的极差 11mm 会超容差，但三个都离中位数很近 —— 那是「一致」，
  //   只是中位数被两端拉开。按极差判会把这种正常情况误报成离群，还会打印出空的离群列表。
  if (within.length === cmp.perModel.length) {
    return Object.assign(base, detail, {
      status: "agree", agree: true, mm: median, sources: usable.length,
      confidence: usable.length >= 3 ? 92 : 88,
      note: `${cmp.perModel.length} 个模型 ${cmp.dates.length} 天：` +
            `${cmp.perModel.map((p) => `${p.label} ${p.mm}mm`).join(" / ")}` +
            `（中位数 ${median}mm，离散度 ${spread}mm，都在 ± 容差 ${tolerance}mm 内）→ 采信`,
    });
  }
  if (within.length >= minModels) {
    return Object.assign(base, detail, {
      status: "majority", agree: true, mm: median, sources: within.length, confidence: 84,
      note: `多数一致：${within.map((p) => p.label).join("/")} 落在中位数 ${median}mm ± ${tolerance}mm 内，` +
            `${outliers.map((p) => `${p.label} ${p.mm}mm`).join("/")} 离群（离散度 ${spread}mm）→ 采信`,
    });
  }
  return Object.assign(base, detail, {
    status: "diverge", agree: false, mm: null, confidence: 40, sources: usable.length,
    note: `离散度 ${spread}mm > 容差 ${tolerance}mm 且多数不成立：` +
          `${cmp.perModel.map((p) => `${p.label} ${p.mm}mm`).join(" / ")} → 拒收，不喂价`,
  });
}

module.exports = { MODELS, fetchModelSeries, gradeModels, compareOnCommonDates, RAIN_EPOCH };

/* ------------------------------------------------------------------ CLI */

if (require.main === module) {
  const { REGIONS } = require("./regions");
  const ARGV = process.argv.slice(2);
  const UNTIL = (ARGV.find((a) => a.startsWith("--until=")) || "").split("=")[1] || null;
  // 原来写 `Number(..) || null`：0 和 NaN 都是 falsy，于是 `--region=0`、`--region=abc`
  // 静默退化成「验全部区域」，输出的 ✓ 看着像这一区通过，其实是别区在报数。
  // regions.js 的 REGION id 从 1 起（1..5，没有 0），所以 0 是非法输入，不是「全部」。
  const regionArg = ARGV.find((a) => a.startsWith("--region="));
  const onlyArg = regionArg ? regionArg.split("=")[1] : null;
  if (onlyArg !== null && !REGIONS.some((r) => r.id === Number(onlyArg))) {
    console.error(`❌ --region=${onlyArg} 不是合法区域号。合法值：${REGIONS.map((r) => `${r.id}=${r.name}`).join("  ")}`);
    process.exit(2);
  }
  const ONLY = onlyArg === null ? null : Number(onlyArg);
  const epoch = RAIN_EPOCH;

  (async () => {
    const targets = ONLY ? REGIONS.filter((r) => r.id === ONLY) : REGIONS;
    console.log(`\n三模型交叉核验  ·  窗口 ${epoch} ~ ${UNTIL || shDate(Date.now() / 1000)}\n`);
    let passed = 0;
    for (const r of targets) {
      try {
        const series = await fetchModelSeries(r, UNTIL, epoch);
        const v = gradeModels(series);
        if (v.agree) passed++;
        const line = v.agree
          ? `✅ ${v.status.padEnd(9)} 采信 ${String(v.mm).padStart(6)}mm  置信 ${v.confidence}  源 ${v.sources}`
          : `⛔ ${v.status.padEnd(9)} 拒收               置信 ${v.confidence}  源 ${v.sources}`;
        console.log(`#${r.id} ${r.name.padEnd(4)} ${line}`);
        console.log(`      ${v.note}`);
      } catch (e) {
        console.log(`#${r.id} ${r.name.padEnd(4)} ❌ ${e.message}`);
      }
    }
    // 一个区都没通过（全拒收 / 全取数失败）时不能还退 0：调用方（CI、批处理）只看退出码。
    if (!passed) {
      console.log(`\n⛔ ${targets.length} 个区没有一个通过交叉核验 ⇒ 退出码置 1`);
      process.exitCode = 1;
    }
    console.log("");
  })();
}
