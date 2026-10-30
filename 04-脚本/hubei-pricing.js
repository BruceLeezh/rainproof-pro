#!/usr/bin/env node
/**
 * hubei-pricing.js —— 湖北 118 个区划的 12h/24h 保费（人民币分）
 *
 * 口径与 10-金融与定价/pricing_engine.js 完全一致，只把「11 年 ERA5 逐小时 →
 * 档线触发 → 月聚类自举 97.5% 上界 → 60% 赔付率闸 → 0.1 元网格」这条链
 * 从五城搬到湖北 118 个区划：
 *
 *   rate[m]  = 该月每个 h 窗口的加权赔付比例（越 30/70 赔 50%/75%，越 50/100 同）
 *   w[m]     = rate[m] / Σrate            （κ=1，众包·自助，最贵也是最保守的渠道）
 *   upper    = 4000 次月聚类自举的 97.5% 分位
 *   P        = max( ceil10((upper×10000分 + 30分)/0.6), ceil10(30×1.25), 100分 )
 *
 * 自检：用五城缓存复算武汉 12h/24h，必须与 pricing-engine.json / 链上 590/880 一致。
 *
 * 数据：Open-Meteo Archive（ERA5）2015-10-01 → 2026-09-30，逐小时，时区 Asia/Shanghai
 * 缓存：10-金融与定价/cache-hubei/<code>.json.gz（原始报文，含 sha256）
 * 产物：10-金融与定价/hubei-pricing.json
 *
 * 用法：node hubei-pricing.js [--recompute] [--only=420100] [--limit=5]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const ROOT = path.join(__dirname, "..");
const REG_FILE = path.join(__dirname, "hubei-regions.json");
const OUT = path.join(ROOT, "10-金融与定价", "hubei-pricing.json");
const CACHE = path.join(ROOT, "10-金融与定价", "cache-hubei");
const ENGINE = path.join(ROOT, "10-金融与定价", "pricing-engine.json");
const DATA_START = "2015-10-01", DATA_END = "2026-09-30";
const REPS = 4000, SEED = 20261007, LUT_N = 4096;
const HOURS = [12, 24];
const THRESHOLDS = { 12: [30, 70], 24: [50, 100] }; // GB/T 28592-2012
const TIER_BPS = [5000, 7500];
const PAYOUT_FEN = 10000;   // 100.00 元
const COST_FEN = 30;        // 单份固定成本 0.30 元（法币口径）
const R_TARGET = 0.6, MIN_PREMIUM_FEN = 100, TICK_FEN = 10;
const MAX_FEN = 10000;      // 合约 PAYOUT_MAX：premium 必须 < 10000

const argv = process.argv.slice(2);
const FLAGS = Object.fromEntries(argv.filter((a) => a.includes("=")).map((a) => [a.split("=")[0].replace(/^--/, ""), a.split("=")[1]]));
const RECOMPUTE = argv.includes("--recompute");

const ceil10 = (fen) => Math.ceil((fen - 1e-6) / TICK_FEN) * TICK_FEN;
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const quantile = (sorted, a) => sorted[Math.min(sorted.length - 1, Math.floor(a * sorted.length))];

function windowSums(mm10, h) {
  const out = new Int32Array(Math.max(0, mm10.length - h + 1));
  let rolling = 0;
  for (let i = 0; i < mm10.length; i++) {
    rolling += mm10[i];
    if (i >= h) rolling -= mm10[i - h];
    if (i >= h - 1) out[i - h + 1] = rolling;
  }
  return out;
}
function monthIndex(times) {
  const idx = new Int32Array(times.length);
  const map = new Map(), keys = [];
  for (let i = 0; i < times.length; i++) {
    const k = times[i].slice(0, 7);
    let v = map.get(k);
    if (v === undefined) { v = keys.length; keys.push(k); map.set(k, v); }
    idx[i] = v;
  }
  return { idx, keys };
}

/** 单个区划 × 单个时长的触发率与 97.5% 上界（K=1 众包自助口径） */
function cellStats(mm10, times, h) {
  const { idx, keys } = monthIndex(times);
  const nM = keys.length;
  const sums = windowSums(mm10, h);
  const bounds = THRESHOLDS[h].map((t) => Math.round(t * 10));
  const paySum = new Float64Array(nM), win = new Int32Array(nM);
  const nHitByTier = new Array(TIER_BPS.length).fill(0);
  let nHit = 0;
  for (let j = 0; j < sums.length; j++) {
    const v = sums[j];
    let f = 0;
    for (let k = 0; k < bounds.length; k++) if (v >= bounds[k]) { f = TIER_BPS[k] / 10000; nHitByTier[k]++; }
    if (f > 0) nHit++;
    const m = idx[j + h - 1];
    paySum[m] += f; win[m] += 1;
  }
  const rate = new Float64Array(nM);
  for (let m = 0; m < nM; m++) rate[m] = win[m] > 0 ? paySum[m] / win[m] : 0;

  // w_m ∝ rate_m（selectivity=1）；全零时退化为均匀
  let sumR = 0; for (let m = 0; m < nM; m++) sumR += rate[m];
  const w = new Float64Array(nM); let sw = 0;
  for (let m = 0; m < nM; m++) { w[m] = sumR > 0 ? rate[m] / sumR : 1 / nM; sw += w[m]; }
  if (sw > 0) for (let m = 0; m < nM; m++) w[m] /= sw;

  let point = 0; for (let m = 0; m < nM; m++) point += w[m] * rate[m];

  // CDF → LUT，与 pricing_engine.js 3.4 节逐行同构
  const cdf = new Float64Array(nM); let acc = 0;
  for (let m = 0; m < nM; m++) { acc += w[m]; cdf[m] = acc; }
  cdf[nM - 1] = 1;
  const lut = new Int32Array(LUT_N);
  let mi = 0;
  for (let b = 0; b < LUT_N; b++) {
    const u = (b + 0.5) / LUT_N;
    while (mi < nM - 1 && u > cdf[mi]) mi++;
    lut[b] = mi;
  }
  const rnd = mulberry32(SEED);
  const buckets = new Int32Array(REPS * nM);
  for (let i = 0; i < buckets.length; i++) buckets[i] = Math.min(LUT_N - 1, (rnd() * LUT_N) | 0);
  const scratch = new Float64Array(REPS);
  for (let rep = 0; rep < REPS; rep++) {
    const off = rep * nM; let s = 0;
    for (let i = 0; i < nM; i++) s += rate[lut[buckets[off + i]]];
    scratch[rep] = s / nM;
  }
  const sorted = Float64Array.from(scratch).sort();
  const upper = quantile(sorted, 0.975);

  const pNet = ceil10((upper * PAYOUT_FEN + COST_FEN) / R_TARGET);
  const floor = ceil10(COST_FEN * 1.25);
  const price = Math.max(pNet, floor, MIN_PREMIUM_FEN);
  if (price >= MAX_FEN) throw new Error(`price ${price} >= PAYOUT_MAX`);

  return {
    hours: h, thresholdsMm: THRESHOLDS[h], nWin: sums.length, nHit, nHitByTier,
    pointRatePct: round(point * 100, 6), upperRatePct: round(upper * 100, 6),
    priceFen: price, priceYuan: round(price / 100, 2), boundBy: pNet >= floor ? "risk" : "cost",
    loadFactor: point > 0 ? round(upper / point, 3) : null,
  };
}

async function fetchArchive(code, lat, lon, retries = 4) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${DATA_START}&end_date=${DATA_END}&hourly=precipitation&timezone=Asia%2FShanghai`;
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(180000), headers: { "User-Agent": "rainproof-hubei-pricing/1.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const j = JSON.parse(text);
      if (!j.hourly || !Array.isArray(j.hourly.time) || j.hourly.time.length < 90000) throw new Error("hourly 数据不完整");
      return { url, text, json: j };
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 2000 * (i + 1))); }
  }
  throw new Error(`${code} 下载失败：${last && last.message}`);
}

function validateAgainstEngine() {
  // 用五城缓存复算武汉，必须命中引擎产物与链上值
  const A = require(path.join(ROOT, "10-金融与定价", "audit_numbers.js"));
  const wuhan = A.loadCity({ key: "wuhan", name: "武汉", id: 1 });
  const engine = JSON.parse(fs.readFileSync(ENGINE, "utf8"));
  const out = {};
  for (const h of HOURS) {
    const s = cellStats(wuhan.mm10, wuhan.times, h);
    const ref = Object.values(engine.cells).find((c) => c.regionName === "武汉" && c.hours === h && c.segKey === "t0c0");
    out[h] = {
      computedUpperPct: s.upperRatePct,
      engineUpperPct: round(ref.upperRatePct, 6),
      computedPriceFen: s.priceFen,
      enginePriceEth: ref.premiumRetailEth,
      ok: Math.abs(s.upperRatePct - ref.upperRatePct) < 1e-3,
    };
  }
  const ok = HOURS.every((h) => out[h].ok) && out[12].computedPriceFen === 590 && out[24].computedPriceFen === 880;
  return { ok, detail: out };
}

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const regs = JSON.parse(fs.readFileSync(REG_FILE, "utf8")).regions;
  const ONLY = FLAGS.only ? String(FLAGS.only).split(",").map((s) => s.trim()).filter(Boolean) : null;
  const todo = ONLY ? regs.filter((r) => ONLY.includes(String(r.code))) : regs;
  const limit = Number(FLAGS.limit || 0);
  const list = limit > 0 ? todo.slice(0, limit) : todo;

  console.log("== 自检：复算武汉 12h/24h ==");
  const check = validateAgainstEngine();
  console.log(JSON.stringify(check, null, 0));
  if (!check.ok) throw new Error("自检失败：湖北口径与五城引擎不一致，停止");

  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { regions: [] };
  const byCode = new Map((existing.regions || []).map((r) => [String(r.code), r]));
  const results = [];

  // 预取：网络延迟是瓶颈，4 路并发把 118 城 11 年报文先落盘，再单线程算。
  const missing = list.filter((r) => !fs.existsSync(path.join(CACHE, `${r.code}.json.gz`)));
  if (missing.length) {
    console.log(`预取 ${missing.length} 个区划的 ERA5 报文（并发 4）…`);
    let idx = 0, failed = [];
    const worker = async () => {
      while (idx < missing.length) {
        const r = missing[idx++];
        try {
          const got = await fetchArchive(r.code, r.lat, r.lon);
          fs.writeFileSync(path.join(CACHE, `${r.code}.json.gz`), zlib.gzipSync(got.text));
          console.log(`  ↓ ${r.code} ${r.name}（${Math.round(got.text.length / 1024)}KB）`);
        } catch (e) {
          failed.push(`${r.code} ${e.message}`);
          console.error(`  ✗ ${r.code} ${r.name} ${e.message}`);
        }
        await new Promise((res) => setTimeout(res, 400));
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (failed.length) console.warn(`\n${failed.length} 个区划预取失败，稍后单独重跑：\n  ${failed.join("\n  ")}`);
  }

  let done = 0;
  for (const r of list) {
    const cacheFile = path.join(CACHE, `${r.code}.json.gz`);
    if (!fs.existsSync(cacheFile)) { console.warn(`跳过 ${r.code}（无缓存）`); continue; }
    let j, text, url;
    if (fs.existsSync(cacheFile) && !RECOMPUTE) {
      text = zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8");
      j = JSON.parse(text);
      url = `cache:${path.basename(cacheFile)}`;
    } else {
      const got = await fetchArchive(r.code, r.lat, r.lon);
      j = got.json; text = got.text; url = got.url;
      fs.writeFileSync(cacheFile, zlib.gzipSync(text));
      await new Promise((res) => setTimeout(res, 250));
    }
    const mm10 = j.hourly.precipitation.map((v) => Math.round((v ?? 0) * 10));
    const times = j.hourly.time;
    const cells = {};
    for (const h of HOURS) cells[h] = cellStats(mm10, times, h);
    const basis = `rainproof-hubei grid 2026-10-27 · ${r.code} ${r.name} · crowd-self κ=1 · PAYOUT=${PAYOUT_FEN}fen · C=${COST_FEN}fen · R*=0.6 · ERA5 ${DATA_START}..${DATA_END}`;
    const rec = {
      code: r.code, name: r.name, kind: r.kind, parent: r.parent, lat: r.lat, lon: r.lon, geoSource: r.geoSource,
      hours12: cells[12], hours24: cells[24],
      grid: { 12: cells[12].priceFen, 24: cells[24].priceFen },
      digest: sha256(text), sourceUrl: url,
      basis, reasonHash: ethers.id(basis),
      cachedAt: new Date().toISOString(),
    };
    byCode.set(String(r.code), rec);
    results.push(rec);
    done++;
    console.log(`[${done}/${list.length}] ${r.code} ${r.name} 12h ${rec.grid[12]}分 ${rec.hours12.upperRatePct}% · 24h ${rec.grid[24]}分 ${rec.hours24.upperRatePct}%`);
  }

  const all = [...byCode.values()].sort((a, b) => a.code - b.code);
  const out = {
    schema: "rainproof/hubei-pricing@1",
    generatedAt: new Date().toISOString(),
    dataStart: DATA_START, dataEnd: DATA_END, timezone: "Asia/Shanghai",
    source: "Open-Meteo Archive (ERA5) hourly precipitation",
    method: {
      thresholds: THRESHOLDS, tierBps: TIER_BPS, selectivityKappa: 1,
      bootstrap: { unit: "calendar month", reps: REPS, seed: SEED, quantile: 0.975 },
      formula: "max(ceil10((upper*10000+30)/0.6), ceil10(30*1.25), 100)",
      costFen: COST_FEN, payoutFen: PAYOUT_FEN, rTarget: R_TARGET, tickFen: TICK_FEN,
      note: "县级费率用同一 ERA5 序列、同一档线与同一年化上界；五城既有网格不覆盖（保持链上 590/880 等）。",
    },
    selfCheck: check,
    counts: { total: all.length, priced: all.length },
    regions: all,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n已写 ${OUT}（${all.length} 个区划）`);
})().catch((e) => { console.error("💥 " + (e.message || e)); process.exit(1); });
