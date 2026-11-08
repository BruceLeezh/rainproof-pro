"use strict";
// 9 个分歧区划的只读复核证据生成器。
// 做什么：对分歧拒收的区划，读取链上 lastFeedAt 得到窗口，用 Open-Meteo Archive（固定 ERA5）
// 取同窗口参考累计，与当轮喂价原始报文里的三模型增量并排，产出带 SHA-256 的证据文件。
// 不做什么：不发交易、不改口径、不裁决是否采信——只生产决策材料。
// 用法：node 07-测试工具/diverge-archive-evidence.js [--codes=420525,421321]
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require(path.join(__dirname, "..", "04-脚本", "node_modules", "dotenv")).config({ path: path.join(__dirname, "..", "04-脚本", ".env") });
const { ethers } = require(path.join(__dirname, "..", "04-脚本", "node_modules", "ethers"));
const { withRetry, provider: makeProvider } = require(path.join(__dirname, "..", "04-脚本", "rpc-read"));
const { increment } = require(path.join(__dirname, "..", "04-脚本", "feed-window"));

const REG_FILE = path.join(__dirname, "..", "04-脚本", "v5-regions.json");
const RAW_DIR = path.join(__dirname, "..", "09-AI判定留痕", "raw");
const OUT_DIR = path.join(__dirname, "..", "09-AI判定留痕", "diverge-archive-2026-11-02");
const CODES = [420324, 420525, 420526, 420527, 420882, 421123, 421321, 422827, 422828];
const sha256 = t => crypto.createHash("sha256").update(t, "utf8").digest("hex");
const parse = iso => Date.parse(iso + (iso.endsWith("Z") ? "" : "+08:00"));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const regions = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
  const p = makeProvider(ethers, process.env.SEPOLIA_RPC);
  const v6 = new ethers.Contract(process.env.CONTRACT_ADDRESS_V6 || process.env.CONTRACT_ADDRESS,
    require(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV6.abi.json")), p);
  const argCodes = (process.argv.find(a => a.startsWith("--codes=")) || "").slice(8).split(",").filter(Boolean).map(Number);
  const codes = argCodes.length ? argCodes : CODES;
  const sPath = path.join(OUT_DIR, "summary.json");
  const prevRows = (() => { try { return JSON.parse(fs.readFileSync(sPath, "utf8")).rows || [] } catch { return [] } })();
  const rows = [];
  for (const code of codes) {
    const r = regions.find(x => x.code === code);
    if (!r) { rows.push({ code, error: "region not found in v5-regions.json" }); continue; }
    const lastFed = Number(await withRetry(() => v6.lastFeedAt(code)));
    const fromIso = lastFed === 0 ? "2026-10-01T00:00"
      : new Date(lastFed * 1000 + 8 * 3600e3).toISOString().slice(0, 13) + ":00";
    // 口径对齐：模型端沿用当轮 raw 证据的取证时刻（forecast 数据不越过该时刻），
    // archive 端用同一 (from, to] 槽位集，保证两边可逐数对照。
    // 2026-11-08 起 raw 按年月子目录归档（raw/2026-11/…），递归找该城最新一份 v6feed 报文；
    // 顶层旧文件（含 11-07 裁决引用的 11-06 报文）原地保留，相对路径 raw/… 两种都兼容。
    const listRaw = (dir, rel = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? listRaw(path.join(dir, e.name), `${rel}${e.name}/`)
        : (e.name.startsWith(`v6feed-${code}-`) ? [`${rel}${e.name}`] : []));
    const rawDir = fs.existsSync(RAW_DIR) ? listRaw(RAW_DIR).sort() : [];
    if (!rawDir.length) { rows.push({ code, error: "no raw evidence" }); continue; }
    const rawFile = rawDir[rawDir.length - 1];
    const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, rawFile), "utf8"));
    const toIso = new Date(Date.parse(raw.savedAt) + 8 * 3600e3).toISOString().slice(0, 13) + ":00";
    const parsed = JSON.parse(raw.rawText);
    const inc = increment(parsed.hourly.time, parsed.hourly, fromIso, toIso);
    const row = {
      code, name: r.name, lat: r.lat, lon: r.lon, fromIso, toIso,
      lastFedAt: lastFed, rawEvidence: `raw/${rawFile}`, rawSha256: raw.rawText ? sha256(raw.rawText) : undefined,
      modelGate: { perModel: inc.perModel, median: inc.median, spread: inc.spread, tol: inc.tol, windowH: inc.windowH, sources: inc.sources },
      archive: null,
    };
    const aurl = `https://archive-api.open-meteo.com/v1/archive?latitude=${r.lat}&longitude=${r.lon}` +
      `&start_date=${fromIso.slice(0, 10)}&end_date=${toIso.slice(0, 10)}` +
      `&hourly=precipitation&timezone=Asia%2FShanghai&models=era5`;
    try {
      let ares = null, atext = "";
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(aurl, { signal: AbortSignal.timeout(25000) });
        const text = await res.text();
        if (res.ok || attempt >= 4 || ![429, 500, 502, 503, 504].includes(res.status)) { ares = res; atext = text; break; }
        console.log(`  ${code} archive HTTP ${res.status}，第 ${attempt} 次退避重试`);
        await new Promise(r2 => setTimeout(r2, 3000 * attempt));
      }
      fs.writeFileSync(path.join(OUT_DIR, `archive-raw-${code}.json`), atext);
      row.archive = { url: aurl, httpStatus: ares.status, sha256: sha256(atext), model: "era5" };
      if (!ares.ok) row.archive.error = `HTTP ${ares.status}`;
      if (ares.ok) {
        const aj = JSON.parse(atext);
        const at = (aj.hourly && aj.hourly.time) || [];
        const av = (aj.hourly && aj.hourly.precipitation) || [];
        const from = parse(fromIso), to = parse(toIso);
        const slots = at.map(parse);
        const expected = [];
        for (let t = from + 3600000; t <= to; t += 3600000) expected.push(t);
        const idx = expected.map(t => slots.indexOf(t));
        const missing = idx.filter(i => i < 0 || typeof av[i] !== "number" || !Number.isFinite(av[i]) || av[i] < 0).length;
        const sum = idx.reduce((s, i) => (i >= 0 && Number.isFinite(av[i]) && av[i] >= 0 ? s + av[i] : s), 0);
        const total = Number(sum.toFixed(2));
        row.archive.expectedHours = expected.length;
        row.archive.missingHours = missing;
        row.archive.total = missing === 0 ? total : null;
        row.archive.partialTotal = total;
        row.archive.gridLat = aj.latitude;
        row.archive.gridLon = aj.longitude;
        if (missing === 0 && inc.perModel.length >= 2) {
          const lo = Math.min(...inc.perModel), hi = Math.max(...inc.perModel);
          row.archive.withinModelRange = total >= lo - 1e-9 && total <= hi + 1e-9;
          row.archive.modelRange = [Number(lo.toFixed(2)), Number(hi.toFixed(2))];
        }
      }
    } catch (e) {
      row.archive = { error: String((e && e.message) || e) };
    }
    rows.push(row);
    const a = row.archive || {};
    console.log(`${code} ${r.name} 窗口${fromIso}→${toIso} | 三模型[${(inc.perModel || []).map(v => v == null ? "?" : v.toFixed(1)).join(", ")}] 中位=${inc.median == null ? "?" : inc.median.toFixed(1)} spread=${inc.spread == null ? "?" : inc.spread.toFixed(1)} tol=${inc.tol} | ERA5=${a.total != null ? a.total : (a.partialTotal != null ? `部分${a.partialTotal}(缺${a.missingHours}h)` : (a.error || "?"))}`);
    await new Promise(res => setTimeout(res, 3000));
  }
  await p.destroy();
  // --codes 增量模式：把本次未请求的区划从上一次 summary 原样携带，避免重跑丢失已成功证据
  if (argCodes.length) {
    const have = new Set(rows.map(r => r.code));
    for (const pr of prevRows) if (!have.has(pr.code)) rows.push(pr);
    rows.sort((a, b) => CODES.indexOf(a.code) - CODES.indexOf(b.code));
  }
  const summary = {
    schema: "rainproof/diverge-archive@1",
    generatedAt: new Date().toISOString(),
    note: "只读复核：固定 ERA5 archive 对照三模型窗口增量。archive 延迟数日，missingHours>0 即证据不完整，total=null 只给 partialTotal 参考。本文件不构成裁决，采信与否及上链操作另行走治理流程。",
    rows,
  };
  fs.writeFileSync(sPath, JSON.stringify(summary, null, 2));
  console.log("saved:", sPath);
  const incomplete = rows.filter(r => r.archive && (r.archive.missingHours > 0 || r.archive.error));
  console.log(`complete=${rows.length - incomplete.length}/${rows.length}（其余为 archive 延迟或读取失败，证据不完整，不可作为喂价依据）`);
}

main().catch(e => { console.error("💥", (e && e.message) || e); process.exit(1); });
