#!/usr/bin/env node
/** G5 补丁 v2：原始报文留痕（SHA-256 锚定，文件层）。两处插入均在 try 作用域内。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "push-rainfall-v5.js");
let s = fs.readFileSync(F, "utf8");
const EOL = s.includes("\r\n") ? "\r\n" : "\n";
const nl = t => t.replace(/\n/g, EOL);
const anchors = [
  "async function round(p, v5) {",
  "      const j = await (await fetchTO(url)).json();",
  "      if (!inc.ok) {",
  "  if (!batch.ids.length) { console.log(\"  本轮无城市需要上链。\"); return; }",
];
for (const a of anchors) {
  const c = s.split(a).length - 1;
  if (c !== 1) { console.error("预检失败：" + c + " 次 → " + a.slice(0, 44)); process.exit(1); }
}
console.log("锚点预检：4/4");
let n = 0;
function rep(o, t, label) {
  o = nl(o); t = nl(t);
  const c = s.split(o).length - 1;
  if (c !== 1) throw new Error(label + " 命中 " + c);
  s = s.split(o).join(t); n++;
}

// ① 留痕设施 + TRACE 声明（round 顶部）
rep("async function round(p, v5) {", nl(
`/* ---- G5 原始报文留痕（2026-10-26）：三模型原始响应全文落盘 + SHA-256 锚定 ----
   链不动（红线）：锚定做在文件层——留痕 JSON 记录每城原始报文的 sha256 与文件名，
   任何人拿同一份 raw 文件都能复算出同一哈希；与喂价 evidenceHash 并列互证。
   体量护栏：只对「分歧 / 进入批量」的城市存原始报文；raw 目录超 50MB 停存并告警。 */
const RAW_DIR = path.join(__dirname, "..", "09-AI判定留痕", "raw");
const TRACE_DIR = path.join(__dirname, "..", "09-AI判定留痕");
const sha256 = t => require("crypto").createHash("sha256").update(t, "utf8").digest("hex");
function saveRaw(code, name, url, rawText) {
  try {
    let total = 0;
    if (fs.existsSync(RAW_DIR)) for (const f of fs.readdirSync(RAW_DIR)) total += fs.statSync(path.join(RAW_DIR, f)).size;
    if (total > 50 * 1024 * 1024) return { file: null, sha256: sha256(rawText), skipped: "dir-cap-50MB" };
    fs.mkdirSync(RAW_DIR, { recursive: true });
    const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const file = \`v5feed-\${code}-\${stamp}.json\`;
    fs.writeFileSync(path.join(RAW_DIR, file), JSON.stringify({ schema: "rainproof/raw-feed@1", code, name, url, savedAt: new Date().toISOString(), raw: JSON.parse(rawText) }, null, 1), "utf8");
    return { file, sha256: sha256(rawText), bytes: rawText.length };
  } catch (e) { return { file: null, sha256: sha256(rawText), error: String(e.message || e).slice(0, 60) }; }
}
function saveTrace(tr, nowIso) {
  try {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    const file = path.join(TRACE_DIR, \`v5-feed-trace-\${nowIso.replace(/[-:T]/g, "").slice(0, 12)}.json\`);
    fs.writeFileSync(file, JSON.stringify(Object.assign({ schema: "rainproof/v5-feed-trace@1", generatedAt: new Date().toISOString() }, tr), null, 1), "utf8");
    return path.basename(file);
  } catch (e) { return null; }
}
async function round(p, v5) {
  const TRACE = [];   // G5：本轮逐城留痕（轮末落盘）`), "留痕设施");

// ② 抓取处保留原始文本
rep("      const j = await (await fetchTO(url)).json();",
`      const resp = await fetchTO(url);
      const rawText = await resp.text();          // G5：先留原始报文再解析
      const j = JSON.parse(rawText);`, "原始文本");

// ③a 分歧城市：留痕（含原始报文）后 continue
rep("      if (!inc.ok) {",
`      if (!inc.ok) {
        TRACE.push({ code: r.code, name: r.name, windowFrom: fromIso, windowTo: nowIso,
          perModel: inc.perModel, median: inc.median, ok: false, raw: saveRaw(r.code, r.name, url, rawText) });`, "分歧留痕");

// ③b 正常城市：在 else（无增量）之后、try 结束前留痕（进入批量的才存 raw）
const elseTail = nl("        notes.push(`${r.name} ⚪ 无增量（${chain}mm，喂价 ${ageH.toFixed(0)}h 前）`);\n      }");
if (s.split(elseTail).length - 1 !== 1) { console.error("预检失败：else 尾锚点"); process.exit(1); }
s = s.split(elseTail).join(elseTail + nl(
`      TRACE.push({ code: r.code, name: r.name, chainBefore: chain, target, windowFrom: fromIso, windowTo: nowIso,
        perModel: inc.perModel, median: inc.median, tol: inc.tol, ok: true, enterBatch: target !== chain,
        raw: target !== chain ? saveRaw(r.code, r.name, url, rawText) : undefined });`));
n++;

// ④ 轮末落盘 trace
rep('  if (!batch.ids.length) { console.log("  本轮无城市需要上链。"); return; }',
`  { const f = saveTrace({ roundNote: batch.ids.length ? "has-batch" : "no-op", regions: TRACE,
      batch: batch.ids.map((c, i) => ({ code: c, to: batch.mms[i].toString(), conf: batch.conf[i] })) }, nowIso);
    if (f) console.log("  留痕：09-AI判定留痕/" + f + "（各城原始报文 sha256 见 regions[].raw）"); }
  if (!batch.ids.length) { console.log("  本轮无城市需要上链。"); return; }`, "轮末落盘");

fs.writeFileSync(F, s, "utf8");
console.log("OK G5 写盘：" + n + " 处替换");
