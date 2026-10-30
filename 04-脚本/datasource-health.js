/**
 * datasource-health.js —— 数据源健康档案（交接文档 P1 待办第 6 条 G7）
 * ============================================================================
 * 喂价链路有两个数据源，出问题的方式完全不同，但过去都没有量化记录：
 *
 *   ① Open-Meteo（外部）：会超时、会限流、会返回缺小时的报文。表现是「拉取失败」
 *      —— 脚本静默跳过该区划，链上喂价慢慢变陈旧，直到超 MAX_FEED_AGE 买不了单。
 *   ② 三模型共识（内部）：ecmwf_ifs025 / gfs_seamless / icon_seamless 三者分歧过大
 *      时脚本拒收（不写链）。表现是「三模型分歧」—— 这是**正确行为**，但拒收率高了
 *      等于没喂价。
 *
 * 本工具只读本地留痕（`09-AI判定留痕/v5-feed-trace-*.json` + `raw/v5feed-*.json`），
 * 不联网、不发交易。输出可用率、外部接口延迟、模型离散度、拒收率四组数。
 *
 * 用法：
 *   node 04-脚本/datasource-health.js             # 最近 50 轮，控制台表格
 *   node 04-脚本/datasource-health.js --rounds=200
 *   node 04-脚本/datasource-health.js --json      # 机器可读
 *   node 04-脚本/datasource-health.js --save      # 另存 08-截图存证/数据源健康/<日期>.json
 */
"use strict";
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const ACTIVE = require("./active-deployment").applyDeployment();
const VERSION = ACTIVE.version === "V6" ? "v6" : "v5";
const TRACE_DIR = path.join(ROOT, "09-AI判定留痕");
const RAW_DIR = path.join(TRACE_DIR, "raw");

const argv = process.argv.slice(2);
const AS_JSON = argv.includes("--json");
const SAVE = argv.includes("--save");
const maxRounds = Number((argv.find((a) => a.startsWith("--rounds=")) || "").split("=")[1] ?? 50);
if (!Number.isSafeInteger(maxRounds) || maxRounds <= 0) throw new Error("--rounds requires a positive integer");

const pct = (a, b) => b ? +(100 * a / b).toFixed(2) : null;
const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))].toFixed(1);
};

function loadTraces() {
  if (!fs.existsSync(TRACE_DIR)) return [];
  return fs.readdirSync(TRACE_DIR)
    .filter((f) => new RegExp("^"+VERSION+"-feed-trace-.*\\.json$").test(f))
    .map((f) => {
      const p = path.join(TRACE_DIR, f);
      let j = null;
      try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
      if (!j || !Array.isArray(j.regions)) return null;
      return { file: f, at: j.generatedAt || "", regions: j.regions, batch: j.batch || null };
    })
    .filter(Boolean)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-maxRounds);
}

function rawStats() {
  if (!fs.existsSync(RAW_DIR)) return { items: [] };
  const items = [];
  for (const f of fs.readdirSync(RAW_DIR)) {
    if (!new RegExp("^"+VERSION+"feed-.*\\.json$").test(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), "utf8"));
      // raw/ 的报文是 {schema,code,name,url,savedAt,raw}，接口延迟在 raw.generationtime_ms
      const inner = (j && typeof j.raw === "object" && j.raw) || null;
      items.push({
        code: String(j.code ?? "").padStart(6, "0"),
        savedAt: j.savedAt || null,
        genMs: inner && typeof inner.generationtime_ms === "number" ? inner.generationtime_ms : null,
      });
    } catch { /* 截断的报文不参与统计 */ }
  }
  return { items };
}

const traces = loadTraces();
if (!traces.length) {
  console.error("❌ 09-AI判定留痕 下没有 v5-feed-trace-*.json，先跑一次 push-rainfall-v5.js");
  process.exit(1);
}

const rawAll = rawStats();
const rawItems = rawAll.items;      // 必须在下面按轮统计之前就绪（TDZ 坑，见交接文档 §11.8）

let cellTotal = 0, cellOk = 0, cellReject = 0, cellBatch = 0;
const disagreement = [];      // 每区划每轮的三模型极差（mm）
const rejectByRegion = new Map();
const rounds = [];

for (const t of traces) {
  let ok = 0, rej = 0, bat = 0;
  for (const r of t.regions) {
    cellTotal++;
    const pm = Array.isArray(r.perModel) ? r.perModel.map(Number) : [];
    if (pm.length >= 2) disagreement.push(Math.max(...pm) - Math.min(...pm));
    if (r.ok) { ok++; cellOk++; } else {
      rej++; cellReject++;
      const k = `${r.code} ${r.name}`;
      rejectByRegion.set(k, (rejectByRegion.get(k) || 0) + 1);
    }
    if (r.enterBatch) { bat++; cellBatch++; }
  }
  rounds.push({ at: t.at, file: t.file, regions: t.regions.length, ok, reject: rej, batch: bat,
    rejectRatePct: pct(rej, t.regions.length) });
}

const gen = rawItems.map((x) => x.genMs).filter((x) => typeof x === "number");
const report = {
  schema: "rainproof/datasource-health@1",
  generatedAt: new Date().toISOString(),
  window: { rounds: traces.length, from: traces[0].at, to: traces[traces.length - 1].at },
  openMeteo: {
    rawFiles: rawItems.length,
    latencyMs: { p50: quantile(gen, 0.5), p95: quantile(gen, 0.95), max: gen.length ? +Math.max(...gen).toFixed(1) : null },
    // 注意：generationtime_ms 是 Open-Meteo **服务端**的报文生成耗时，不含网络往返。
    // raw/ 有 50 MB 上限，旧轮次报文会被清掉，所以这里只报「本机还留着多少」，不报可用率。
  },
  consensus: {
    cells: cellTotal,
    accepted: cellOk,
    rejected: cellReject,
    acceptRatePct: pct(cellOk, cellTotal),
    rejectRatePct: pct(cellReject, cellTotal),
    disagreementMm: { p50: quantile(disagreement, 0.5), p95: quantile(disagreement, 0.95), max: disagreement.length ? +Math.max(...disagreement).toFixed(1) : null },
    topRejected: [...rejectByRegion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  },
  feeding: { cellsEnteredBatch: cellBatch, batchRatePct: pct(cellBatch, cellTotal) },
  rounds,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1));
} else {
  const o = report.openMeteo, c = report.consensus, f = report.feeding;
  console.log(`== 数据源健康档案 ==  窗口 ${report.window.rounds} 轮  ${report.window.from} → ${report.window.to}`);
  console.log(`\n  ① Open-Meteo（外部）`);
  console.log(`     请求格数 ${cellTotal} · 本机留档报文 ${o.rawFiles} 份（raw/ 有 50 MB 上限，旧轮会被清）`);
  console.log(`     服务端生成耗时 p50 ${o.latencyMs.p50 ?? "—"} ms · p95 ${o.latencyMs.p95 ?? "—"} ms · max ${o.latencyMs.max ?? "—"} ms（不含网络往返）`);
  console.log(`\n  ② 三模型共识（内部闸门）`);
  console.log(`     受理 ${c.accepted} · 拒收 ${c.rejected} · 受理率 ${c.acceptRatePct ?? "—"}% · 拒收率 ${c.rejectRatePct ?? "—"}%`);
  console.log(`     模型离散度 p50 ${c.disagreementMm.p50 ?? "—"} mm · p95 ${c.disagreementMm.p95 ?? "—"} mm · max ${c.disagreementMm.max ?? "—"} mm（TOL_ABS=2.5）`);
  if (c.topRejected.length) {
    console.log(`     拒收最多的区划：`);
    for (const [k, n] of c.topRejected) console.log(`       ${k}  ${n} 次`);
  }
  console.log(`\n  ③ 上链`);
  console.log(`     进批 ${f.cellsEnteredBatch} 格（${f.batchRatePct ?? "—"}%）—— 其余是无增量或未过保鲜线，属正常`);
  if (SAVE) {
    const dir = path.join(ROOT, "08-截图存证", "数据源健康");
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${report.generatedAt.slice(0, 10)}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 1), "utf8");
    console.log(`\n  💾 ${out}`);
  }
}

// 健康判据：拒收率 >10% 视为异常（退出码 2，便于接监控）。
// 不看留档覆盖率 —— 它受 raw/ 50 MB 上限影响，不是数据源质量指标。
const bad = (report.consensus.rejectRatePct ?? 0) > 10;
if (!AS_JSON && bad) console.log(`\n  ⚠️ 拒收率 >10%，需要看具体区划与模型离散度`);
process.exit(bad ? 2 : 0);