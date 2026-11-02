"use strict";
// 9 个分歧区划的第三只眼：用 gate 三模型（ecmwf/gfs/icon）之外的三套独立全球模型
// （加拿大 GEM、日本 JMA、法国 Météo-France ARPEGE）取同窗口增量，与门禁证据并排。
// 只读、不发交易、不改口径——为人工裁决提供「额外独立意见」，不再是等 ERA5 的 2-5 天延迟。
// 口径对齐：窗口沿用 diverge-archive-2026-11-02/summary.json 已存档的 (from, to]。
// 用法：node 07-测试工具/diverge-extra-models-evidence.js
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const BASE = path.join(__dirname, "..");
const SUMMARY = path.join(BASE, "09-AI判定留痕", "diverge-archive-2026-11-02", "summary.json");
const RAW_DIR = path.join(BASE, "09-AI判定留痕", "raw");
const OUT = path.join(BASE, "09-AI判定留痕", "diverge-archive-2026-11-02", "extra-models.json");
const EXTRA = ["gem_seamless", "jma_seamless", "meteofrance_seamless"];
const sha256 = t => crypto.createHash("sha256").update(t, "utf8").digest("hex");
const parse = iso => Date.parse(iso + (iso.endsWith("Z") ? "" : "+08:00"));

async function main() {
  const prev = JSON.parse(fs.readFileSync(SUMMARY, "utf8"));
  const rows = prev.rows.filter(r => r.fromIso); // 只处理有窗口存档的区划
  const out = { schema: "rainproof/diverge-extra-models@1", generatedAt: new Date().toISOString(), windowSource: "diverge-archive-2026-11-02/summary.json（与门禁证据同窗口）", extraModels: EXTRA, note: "只读取证：gate 之外的三套独立模型对同窗口的增量。供人工裁决参考，不构成自动喂价依据。", rows: [] };
  for (const r of rows) {
    const { code, name, lat, lon, fromIso, toIso, modelGate } = r;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=precipitation&timezone=Asia%2FShanghai&past_days=4&forecast_days=1&models=${EXTRA.join(",")}`;
    const row = { code, name, fromIso, toIso, gate: modelGate, extra: null };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      const text = await res.text();
      fs.writeFileSync(path.join(OUT, "..", `extra-raw-${code}.json`), text);
      row.extra = { url, sha256: sha256(text), httpStatus: res.status };
      if (res.ok) {
        const j = JSON.parse(text);
        const times = (j.hourly && j.hourly.time) || [];
        const from = parse(fromIso), to = parse(toIso);
        const slots = times.map(parse);
        const expected = [];
        for (let t = from + 3600000; t <= to; t += 3600000) expected.push(t);
        const idx = expected.map(t => slots.indexOf(t));
        const missing = idx.filter(i => i < 0).length;
        const sums = EXTRA.map(m => {
          const v = (j.hourly || {})["precipitation_" + m];
          if (!Array.isArray(v) || idx.some(i => i < 0 || typeof v[i] !== "number" || !Number.isFinite(v[i]) || v[i] < 0)) return null;
          return Number(idx.reduce((s, i) => s + v[i], 0).toFixed(2));
        });
        const ok = sums.filter(v => v !== null).sort((a, b) => a - b);
        row.extra.expectedHours = expected.length;
        row.extra.missingHours = missing;
        row.extra.perModel = sums;
        row.extra.median = ok.length >= 2 ? (ok.length === 2 ? (ok[0] + ok[1]) / 2 : ok[1]) : null;
        row.extra.spread = ok.length >= 2 ? Number((ok[ok.length - 1] - ok[0]).toFixed(2)) : null;
        // 与门禁证据的关系：额外中位数是否落在 gate 三模型范围内；支持的独立意见数
        if (row.extra.median != null && modelGate && modelGate.perModel && modelGate.perModel.length) {
          const lo = Math.min(...modelGate.perModel), hi = Math.max(...modelGate.perModel);
          row.extra.withinGateRange = row.extra.median >= lo && row.extra.median <= hi;
          const tol = Math.max(2.5, 0.05 * modelGate.median);
          const nearGateMedian = [row.extra.median, ...ok].filter(v => Math.abs(v - modelGate.median) <= tol).length;
          row.extra.sourcesNearGateMedian = nearGateMedian;
          row.extra.gateTol = tol;
        }
      }
    } catch (e) { row.extra = { error: String((e && e.message) || e) }; }
    out.rows.push(row);
    const ex = row.extra || {};
    console.log(`${code} ${r.name} | gate[${(modelGate.perModel || []).map(v => v == null ? "?" : v.toFixed(1)).join(",")}] 中位=${modelGate.median == null ? "?" : modelGate.median.toFixed(1)} | 独立三模型[${(ex.perModel || []).map(v => v == null ? "?" : v.toFixed(1)).join(",")}] 中位=${ex.median == null ? "?" : ex.median.toFixed(1)} 在gate范围内=${ex.withinGateRange ?? "?"} 缺时=${ex.missingHours ?? ex.error ?? "?"}`);
    await new Promise(res => setTimeout(res, 1500));
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log("saved:", OUT, "sha256=" + sha256(JSON.stringify(out)));
}

main().catch(e => { console.error("💥", (e && e.message) || e); process.exit(1); });
