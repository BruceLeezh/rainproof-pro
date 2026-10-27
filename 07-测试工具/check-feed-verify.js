/**
 * `04-脚本/feed-verify.js` 的断言（默认不打网络）
 * ============================================================================
 * 用法：node 07-测试工具/check-feed-verify.js          只跑判定规则的离线用例
 *       node 07-测试工具/check-feed-verify.js --live   额外真拉一次三个模型（需代理）
 *
 * 2026-10-07 晚已接进 `npm test`（**第六道**）。此前它不在门禁里 —— 而它守的正是
 * 喂价闸门与承保复核这两块判定规则，改坏了没人知道。断言总数不在这里写死（会随脚本改动而过期），
 * 以实际输出为准（B 报的 P0-8，裁定见 `02-作战与答辩/决策记录.md`）。
 * 纯离线、0 秒：只读 JSON 与纯函数，不打网络（要真拉模型加 --live）。
 */
const path = require("path");
const { gradeModels, fetchModelSeries, compareOnCommonDates, MODELS } =
  require(path.join(__dirname, "..", "04-脚本", "feed-verify.js"));
const { reviewPolicy } = require(path.join(__dirname, "..", "04-脚本", "hook-watch.js"));

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (extra ? "  " + extra : "")); }
}

/** 造一个模型序列：给 [[id, 累计mm], ...]，拆成两天，_map 供公共日期比对用 */
function mk(pairs) {
  return pairs.map(([id, mm]) => {
    const half = Math.round((mm / 2) * 10) / 10;
    const dates = ["2026-10-01", "2026-10-02"];
    return {
      id, label: id, org: "fixture", dates, dailyMm: [half, mm - half],
      _map: new Map([["2026-10-01", half], ["2026-10-02", mm - half]]), sum: mm,
    };
  });
}

console.log("\nfeed-verify 判定规则（离线用例）");

// 0. 模型清单必须与 ai-collect.js:45-48 一致 —— 喂价闸门与判定层读同一套模型
t("模型 id 顺序 = ecmwf_ifs025 / gfs_seamless / icon_seamless",
  JSON.stringify(MODELS.map((m) => m.id)) ===
  JSON.stringify(["ecmwf_ifs025", "gfs_seamless", "icon_seamless"]));

// 1. 三个都在容差内 → agree，置信 92，sources 3，mm = 中位数
{
  const v = gradeModels(mk([["a", 40], ["b", 42], ["c", 44]]));
  t("三个一致 → agree / 92 / 源 3 / mm=42",
    v.status === "agree" && v.agree === true && v.confidence === 92 &&
    v.sources === 3 && v.mm === 42, JSON.stringify({ s: v.status, c: v.confidence, m: v.mm }));
}

// 2. 一个离群、两个一致 → majority，置信 84，sources 2，列出离群模型
{
  const v = gradeModels(mk([["a", 10], ["b", 10], ["c", 90]]));
  t("一个离群 → majority / 84 / 源 2 / mm=10",
    v.status === "majority" && v.confidence === 84 && v.sources === 2 && v.mm === 10,
    JSON.stringify({ s: v.status, c: v.confidence, m: v.mm }));
  t("离群模型被点名", JSON.stringify(v.outlierModels) === JSON.stringify(["c"]));
}

// 3. 三个各说各话 → diverge，拒收（mm=null / 置信 40）
{
  const v = gradeModels(mk([["a", 0], ["b", 50], ["c", 100]]));
  t("三个都离群 → diverge / 拒收 / mm=null / 置信 40",
    v.status === "diverge" && v.agree === false && v.mm === null && v.confidence === 40,
    JSON.stringify({ s: v.status, m: v.mm, c: v.confidence }));
}

// 4. 只有两个模型可用、且一致 → agree，置信 88，sources 2
{
  const v = gradeModels(mk([["a", 20], ["b", 20.5]]));
  t("两个可用且一致 → agree / 88 / 源 2",
    v.status === "agree" && v.confidence === 88 && v.sources === 2 && v.mm === 20.3,
    JSON.stringify({ s: v.status, c: v.confidence, m: v.mm }));
}

// 5. 可用模型不足两个 → insufficient，拒收
{
  const v = gradeModels(mk([["a", 20]]));
  t("只剩一个模型 → insufficient / 拒收",
    v.status === "insufficient" && v.mm === null && v.confidence === 40);
}

// 6. 模型之间没有公共日期 → no-overlap，拒收
{
  const a = mk([["a", 20]])[0];
  const b = mk([["b", 20]])[0];
  b.dates = ["2026-11-01"];
  b._map = new Map([["2026-11-01", 20]]);
  const v = gradeModels([a, b]);
  t("没有公共日期 → no-overlap / 拒收",
    v.status === "no-overlap" && v.mm === null, JSON.stringify({ s: v.status }));
}

// 7. ★ 回归：36/42/47 这种「极差超容差、但三个都离中位数很近」必须判 agree，
//    不能报 majority 更不能打印空离群列表（这就是当初写错的地方）
{
  const v = gradeModels(mk([["a", 36], ["b", 42], ["c", 47]]));
  t("极差超容差但都在中位数附近 → agree（不是 majority）",
    v.status === "agree" && v.agree === true, JSON.stringify({ s: v.status, sp: v.spreadMm, tol: v.toleranceMm }));
  t("离群列表为空、说明里不出现「离群」",
    v.outlierModels.length === 0 && v.note.indexOf("离群") === -1, v.note);
}

// 8. 容差 1mm 地板：0.2 / 0.4 这种小雨不能被当成分歧
{
  const v = gradeModels(mk([["a", 0.2], ["b", 0.4]]));
  t("小雨 0.2/0.4 → agree（容差地板 1mm）",
    v.status === "agree" && v.agree === true && v.toleranceMm === 1, JSON.stringify({ s: v.status, tol: v.toleranceMm }));
}

// 9. 公共日期求和：只在两个模型都有值的日期上比
{
  const a = mk([["a", 20]])[0];
  const b = mk([["b", 20]])[0];
  a.dates = ["2026-10-01", "2026-10-02"];
  a._map = new Map([["2026-10-01", 5], ["2026-10-02", 5]]);
  b.dates = ["2026-10-01", "2026-10-02", "2026-10-03"];
  b._map = new Map([["2026-10-01", 5], ["2026-10-02", 5], ["2026-10-03", 99]]);
  const cmp = compareOnCommonDates([a, b]);
  t("只比公共日期（不把 10-03 的 99mm 算进来）",
    cmp.dates.length === 2 && cmp.perModel[1].mm === 10, JSON.stringify(cmp.perModel));
}

/* -------------------------------------------- 10-. 承保复核判定（hook-watch.js） */
/* 这份纯函数就是 `PolicyBought` 事件钩子的判定核心：链上参数 + 喂价新鲜度 + 三模型 */

console.log("\n承保复核判定（hook-watch.js 的 reviewPolicy，纯函数）");

const modelsOk = { status: "agree", medianMm: 20, agree: true };

// 10. 全部通过
{
  const r = reviewPolicy({ windowHours: 72, rainfallAtBuyMm: 10, onchainMm: 30, feedAgeSec: 3600, models: modelsOk });
  t("窗口/基线/喂价/三模型都过 → REVIEW_OK",
    r.verdict === "REVIEW_OK" && r.flagged.length === 0 && r.checks.baselineWithinModels === true,
    JSON.stringify(r.checks));
}

// 11. 喂价超过 24 小时 → 标红
{
  const r = reviewPolicy({ windowHours: 72, rainfallAtBuyMm: 10, onchainMm: 30, feedAgeSec: 25 * 3600, models: modelsOk });
  t("喂价 25 小时前 → stale-feed 标红",
    r.verdict === "REVIEW_FLAG" && r.flagged.includes("stale-feed"), JSON.stringify(r.flagged));
}

// 12. 三模型互相不认 → 标红
{
  const r = reviewPolicy({ windowHours: 24, rainfallAtBuyMm: 0, onchainMm: 5, feedAgeSec: 600,
    models: { status: "diverge", medianMm: null, agree: false } });
  t("三模型 diverge → models-not-agreeing 标红",
    r.verdict === "REVIEW_FLAG" && r.flagged.includes("models-not-agreeing"), JSON.stringify(r.flagged));
}

// 13. 链上基线背离三模型中位数（成都那单的实测形状：120mm vs 6.5mm）
{
  const r = reviewPolicy({ windowHours: 72, rainfallAtBuyMm: 6, onchainMm: 120, feedAgeSec: 600,
    models: { status: "majority", medianMm: 6.5, agree: true } });
  t("链上 120mm vs 中位数 6.5mm → 背离 1746.15% 且标红",
    Math.abs(r.deviationPct - 1746.15) < 0.01 && r.flagged.includes("baseline-deviates-from-models"),
    String(r.deviationPct));
}

// 14. 「不知道」不等于「不合格」：喂价未知 + 三模型没取数 → 部分复核
{
  const r = reviewPolicy({ windowHours: 72, rainfallAtBuyMm: 0, onchainMm: 5, feedAgeSec: null, models: null });
  t("喂价未知 + 三模型未取数 → REVIEW_PARTIAL（既不误报通过、也不误报存疑）",
    r.verdict === "REVIEW_PARTIAL" && r.checks.feedFresh === null && r.checks.modelsAgree === null && r.flagged.length === 0,
    JSON.stringify(r));
}

// 15. 投保时的基线不可能高于链上现值（累计只增不减）
{
  const r = reviewPolicy({ windowHours: 72, rainfallAtBuyMm: 50, onchainMm: 30, feedAgeSec: 600, models: modelsOk });
  t("投保时 50mm > 链上现值 30mm → baseline-above-onchain 标红",
    r.flagged.includes("baseline-above-onchain"), JSON.stringify(r.flagged));
}

// 16. 窗口时长越界（合约只允许 24/48/72）→ 标红
{
  const r = reviewPolicy({ windowHours: 12, rainfallAtBuyMm: 0, onchainMm: 5, feedAgeSec: 600, models: modelsOk });
  t("窗口 12h → window-out-of-range 标红", r.flagged.includes("window-out-of-range"), JSON.stringify(r.flagged));
}

console.log(`\n${fail ? "❌" : "✅"} feed-verify 判定 + 承保复核判定：${pass} 项通过 / ${fail} 项失败`);

/* ------------------------------------------------------------ 可选：真拉一次 */
if (process.argv.includes("--live")) {
  (async () => {
    const { REGIONS } = require(path.join(__dirname, "..", "04-脚本", "regions.js"));
    console.log("\n真拉三个模型（需要网络/代理）");
    const r = REGIONS[0];
    const series = await fetchModelSeries(r, null);
    const v = gradeModels(series);
    const okShape = ["agree", "majority", "diverge", "insufficient", "no-overlap"].includes(v.status) &&
      (v.agree === true ? typeof v.mm === "number" : v.mm === null);
    console.log(`  ${okShape ? "✅" : "❌"} ${r.name} 判定 = ${v.status}  ${v.agree ? v.mm + "mm" : "拒收"}`);
    console.log("     " + v.note);
    process.exit(okShape ? 0 : 1);
  })().catch((e) => {
    // 网络/代理错误走失败路径：原来的裸 IIFE 会让 rejection 变成 unhandled（Node 只警告，退出码可能还是 0）
    console.error("\n❌ --live 拉取失败：" + (e && e.message ? e.message : e));
    process.exit(1);
  });
} else {
  process.exit(fail ? 1 : 0);
}
