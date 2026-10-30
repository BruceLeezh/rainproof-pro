#!/usr/bin/env node
/**
 * push-rainfall-v6.js —— v6 全国区域喂价轮询器（2026-10-26）
 *
 * 周期：--watch=N（分钟，与计划任务 RainProof-Feed 的 PT30M 对齐，演示用 30）常驻；不带 --watch 单次干跑后退出。
 * 每轮：对注册表 v6-regions.json 里每个城市
 *   ① 拉三机构逐小时预报（Open-Meteo，与验真层同源）；
 *   ② 算「上次链上喂价 → 现在」的窗口增量中位数（增量窗口闸门：绝对 ±2.5mm 兜底，长窗 5% 相对）；
 *   ③ 增量 ≥ 阈值 → 进批量；无增量但喂价超 20h → 进保鲜批（同值重喂续 MAX_FEED_AGE）；
 *   ④ 批量非空 → updateRainfallBatch 走多签两票（--send：B1 提交 + B2 确认自动执行）。
 * 分歧城市不喂，打印 rejectFeed 两票命令（拒收是运营决策，不自动上链）。
 * 新城市开通：往 v6-regions.json 加 {code,name,lat,lon}（链上 registerRegion 两票先行）。
 *
 * 用法：node push-rainfall-v6.js [--send] [--watch=30] [--city=330782]
 */
"use strict";
const path = require("path");
const fs = require("fs");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const REG_FILE = path.join(__dirname, "v5-regions.json");
const { increment, MODELS } = require("./feed-window");
const TOL_ABS = 2.5, REFRESH_HOURS = 20;

/** 长空窗（停机/断网后补历史）的窗口闸门告警阈值：超过它就提示「人工核过再喂」 */
const LONG_GAP_HOURS = 6;

const argv = Object.fromEntries(process.argv.slice(2).filter(a => a.includes("=")).map(a => [a.split("=")[0].replace(/^-+/, ""), a.split("=")[1]]));
const ACTIVE = require("./active-deployment").applyDeployment();
const send = process.argv.includes("--send");
/* --watch 的分钟数：NaN / 0 / 负数会让 sleep(NaN) 立刻返回 ⇒ 零延迟死循环、
   每轮真发一笔交易（--watch=abc 就是这条路径）。同类输入的处理风格见 keeper.js 的 --interval=。
   两种写法都收（`--watch=30` / `--watch 30`）：argv 只从含 `=` 的参数里取，空格形式会漏，
   而 `--watch --send` 这种漏值写法必须报错而不是静默退化成「跑一轮」。 */
const watchMin = (() => {
  const flagIdx = process.argv.indexOf("--watch");
  if (argv.watch === undefined && flagIdx < 0) return 0;     // 完全没写 --watch = 跑一轮就退
  const raw = argv.watch !== undefined ? argv.watch : (process.argv[flagIdx + 1] || "");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--watch= 需要一个正数分钟，收到：${JSON.stringify(raw)}`);
  return n;
})();

if (!fs.existsSync(REG_FILE)) {
  fs.writeFileSync(REG_FILE, JSON.stringify([
    { code: 420100, name: "武汉", lat: 30.615, lon: 114.251 },
    { code: 310100, name: "上海", lat: 31.23, lon: 121.474 },
    { code: 110100, name: "北京", lat: 39.9, lon: 116.407 },
    { code: 440100, name: "广州", lat: 23.13, lon: 113.264 },
    { code: 510100, name: "成都", lat: 30.66, lon: 104.066 },
  ], null, 2));
  console.log("已生成默认注册表 v6-regions.json（5 城；义乌 330782 已按运营要求下线）");
}
const REGIONS = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));

/** 节点会间歇性断连（限流）：链上读一律走重试包装 */
async function withRetry(fn, times = 5) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}
async function fetchTO(url, ms = 20000) {
  return fetch(url, { headers: { "User-Agent": "rainproof-v6-feeder/1.0" }, signal: AbortSignal.timeout(ms) });
}

/* ---- G5 原始报文留痕（2026-10-26）：三模型原始响应全文落盘 + SHA-256 锚定 ----
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
    const file = `v6feed-${code}-${stamp}-${require("crypto").randomUUID()}.json`;
    fs.writeFileSync(path.join(RAW_DIR, file), JSON.stringify({ schema: "rainproof/raw-feed@1", code, name, url, savedAt: new Date().toISOString(), rawText, raw: JSON.parse(rawText) }, null, 1), { encoding: "utf8", flag: "wx" });
    return { file, sha256: sha256(rawText), bytes: rawText.length };
  } catch (e) { return { file: null, sha256: sha256(rawText), error: String(e.message || e).slice(0, 60) }; }
}
function saveTrace(tr, nowIso) {
  try {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    // ★ 文件名只精确到小时 ⇒ 同一小时跑两次（比如先 --send 再干跑复核）会把上一份「真发过交易」的
    //   留痕覆盖掉，等于把证据删了。已存在的就顺延 -2、-3，绝不覆盖历史。
    const base = path.join(TRACE_DIR, `v6-feed-trace-${nowIso.replace(/[-:T]/g, "").slice(0, 12)}`);
    let file = `${base}.json`;
    for (let i = 2; fs.existsSync(file); i++) file = `${base}-${i}.json`;
    fs.writeFileSync(file, JSON.stringify(Object.assign({ schema: "rainproof/v6-feed-trace@1", generatedAt: new Date().toISOString() }, tr), null, 1), "utf8");
    // 证据只追加，不自动删除；归档由运营方另行处理。
    return path.basename(file);
  } catch (e) { return null; }
}
/* 留痕只追加；部署时监控磁盘余量并做独立归档，不能用轮转删除证据。 */
async function round(p, v6) {
  const TRACE = [];   // G5：本轮逐城留痕（轮末落盘）
  const nowIso = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 13) + ":00";
  const batch = { ids: [], mms: [], evs: [], conf: [], src: [] };
  const notes = [];
  const skipped = [];   // 跳过的城市与原因：静默跳过 = 可用性事故，必须打出来
  const longGap = [];   // 长空窗补历史的城市（窗口 > 6h），提示人工核对
  for (const r of REGIONS) {
    if (argv.city && Number(argv.city) !== r.code) continue;
    try {
      const lastFed = Number(await withRetry(() => v6.lastFeedAt(r.code)));
      const fromIso = lastFed === 0 ? "2026-10-01T00:00" : new Date(lastFed * 1000 + 8 * 3600e3).toISOString().slice(0, 13) + ":00";
      if (fromIso >= nowIso) { notes.push(`${r.name} 尚无新的完整小时，等待下轮`); continue; }
      // past_days 只取「距上次喂价的时长 + 1 天」。写死 30 天会让每个请求被 Open-Meteo 按
      // 「超过 2 周」计成多次调用（其计费文档：15 变量 × 4 周 = 3.0 次），半小时一轮会把日额度打穿。
      const pastDays = lastFed === 0
        ? 30
        : Math.min(30, Math.max(1, Math.ceil((Date.now() - lastFed * 1000) / 86400e3) + 1));
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${r.lat}&longitude=${r.lon}` +
        `&hourly=precipitation&timezone=Asia%2FShanghai&past_days=${pastDays}&forecast_days=1&models=${MODELS.join(",")}`;
      const resp = await fetchTO(url);
      const rawText = await resp.text();          // G5：先留原始报文再解析
      if (!resp.ok) throw new Error(`weather HTTP ${resp.status}`);
      const j = JSON.parse(rawText);
      if (!j.hourly || !Array.isArray(j.hourly.time)) throw new Error("weather hourly data missing");
      const dataEnd = j.hourly.time[j.hourly.time.length - 1] || nowIso;
      const effNow = nowIso < dataEnd ? nowIso : dataEnd;   // API 滞后时窗口右端封顶到数据末端
      if(effNow < nowIso) throw new Error("weather data is behind the completed hour");
      const inc = increment(j.hourly.time, j.hourly, fromIso, effNow);
      const chain = Number(await withRetry(() => v6.rainfall(r.code)));
      const ageH = lastFed === 0 ? Infinity : (Date.now() / 1000 - lastFed) / 3600;
      if (!inc.ok) {
        TRACE.push({ code: r.code, name: r.name, windowFrom: fromIso, windowTo: effNow, windowH: inc.windowH,
          perModel: inc.perModel, median: inc.median, tol: inc.tol, spread: inc.spread, ok: false,
          raw: saveRaw(r.code, r.name, url, rawText) });
        notes.push(`${r.name} ⚠️ 三模型分歧（窗口 ${inc.windowH.toFixed(0)}h 增量 ${inc.perModel.map(v => v.toFixed(1)).join("/")}，` +
          `离散 ${inc.spread.toFixed(1)}mm > 容差 ${inc.tol.toFixed(1)}mm）→ 不自动喂。` +
          `人工核：用 archive-api.open-meteo.com 查该窗口实测累计，确认后手动 ` +
          `node 07-测试工具/multisig-call.js updateRainfall ${r.code} <累计mm> <证据哈希> 90 1 --send`);
        skipped.push({ code: r.code, name: r.name, reason: "diverge", windowH: inc.windowH, spread: inc.spread, tol: inc.tol });
        continue;
      }
      const target = Math.max(chain, chain + Math.round(inc.median || 0));
      const stale = ageH > REFRESH_HOURS;
      // 长空窗告警：窗口 > LONG_GAP_HOURS 时，这轮喂的是「一段历史」而不是「一小时增量」。
      // 三模型对长窗口的分歧会成倍放大，靠 5% 相对容差兜不住 ⇒ 宁可拦住让人核，也不要静默跳过。
      if (inc.windowH > LONG_GAP_HOURS && target > chain) {
        notes.push(`${r.name} ⏳ 长空窗补历史（窗口 ${inc.windowH.toFixed(0)}h，增量中位 ${inc.median.toFixed(1)}mm，` +
          `三模型 ${inc.perModel.map(v => v.toFixed(1)).join("/")}）→ 建议先人工核对再 --send`);
        longGap.push({ code: r.code, name: r.name, windowH: inc.windowH, median: inc.median, perModel: inc.perModel });
      }
      const rawRecord = target > chain || stale ? saveRaw(r.code, r.name, url, rawText) : undefined;
      if ((target > chain || stale) && !rawRecord?.file) {
        skipped.push({code:r.code, name:r.name, reason:"evidence-unavailable"});
        notes.push(`${r.name} 原始证据未能保存（磁盘或容量上限），本轮不签发喂价`);
        continue;
      }
      if (target > chain || (stale && target === chain)) {
        batch.ids.push(r.code); batch.mms.push(BigInt(target));
        batch.evs.push(ethers.id(`v6-feed ${r.code} ${target}mm window(${fromIso}→${effNow}) raw-sha256=${sha256(rawText)} models=${MODELS.join("+")}`));
        batch.conf.push(Math.min(95, 60 + Math.max(0, target - chain))); batch.src.push(inc.sources);
        notes.push(`${r.name} ✅ ${chain}→${target}mm（窗口增量 ${inc.median.toFixed(1)}）${target === chain ? "【保鲜】" : ""}`);
      } else {
        notes.push(`${r.name} ⚪ 无增量（${chain}mm，喂价 ${ageH.toFixed(0)}h 前）`);
      }      TRACE.push({ code: r.code, name: r.name, chainBefore: chain, target, windowFrom: fromIso, windowTo: effNow,
        perModel: inc.perModel, median: inc.median, tol: inc.tol, ok: true, enterBatch: target !== chain || stale,
        raw: rawRecord });
    } catch (e) {
      notes.push(`${r.name} 拉取失败：${(e.message || e).toString().slice(0, 50)}`);
      skipped.push({ code: r.code, name: r.name, reason: "fetch-failed", detail: String(e.message || e).slice(0, 80) });
    }
  }
  console.log(`\n===== 轮询 ${nowIso} =====`);
  notes.forEach(x => console.log("  " + x));
  if (skipped.length) {
    process.exitCode = 2;
    console.log(`  ⚠️ 本轮 ${skipped.length}/${REGIONS.length} 城未进批量：` +
      skipped.map(s => `${s.name}(${s.reason})`).join(" · "));
  }
  { const f = saveTrace({ roundNote: batch.ids.length ? "has-batch" : "no-op", regions: TRACE, skipped, longGap,
      batch: batch.ids.map((c, i) => ({ code: c, to: batch.mms[i].toString(), conf: batch.conf[i] })) }, nowIso);
    if (f) console.log("  留痕：09-AI判定留痕/" + f + "（各城原始报文 sha256 见 regions[].raw）");
    else if (send && batch.ids.length) throw new Error("本轮留痕保存失败，拒绝签发喂价"); }
  if (!batch.ids.length) { console.log("  本轮无城市需要上链。"); return; }
  console.log(`  批量：${batch.ids.length} 城 → ${batch.mms.map((m, i) => batch.ids[i] + "=" + m).join(" · ")}`);
  if (!send) { console.log("  （干跑：加 --send 走两票上链）"); return; }
  const fs2 = require("fs");
  // 密钥目录可用 OWNER_KEY_FILE 覆盖：换机 / 上 Linux 服务器时不必改代码
  const KEY_FILE = process.env.OWNER_KEY_FILE
    || path.join(__dirname, "..", "..", "密钥-本地", "owner-keys-2026-10-24.json");
  const owners = JSON.parse(fs2.readFileSync(KEY_FILE, "utf8")).accounts;
  const MS = new ethers.Contract(process.env.MULTISIG_ADDR, require(path.join(__dirname, "..", "03-合约", "OperatorMultisig.abi.json")), p);
  // 湖北 118 区划开通后单批已超块上限：20 城/笔（首喂 ~8 个存储槽/城，20 城≈3.2M gas，留足余量）
  const CHUNK = 20;
  for (let off = 0; off < batch.ids.length; off += CHUNK) {
    const part = (arr) => arr.slice(off, off + CHUNK);
    const data = v6.interface.encodeFunctionData("updateRainfallBatch",
      [part(batch.ids), part(batch.mms), part(batch.evs), part(batch.conf), part(batch.src)]);
    const s = await (await MS.connect(new ethers.Wallet(owners[0].privateKey, p)).submit((process.env.CONTRACT_ADDRESS_V6 || process.env.CONTRACT_ADDRESS), 0, data)).wait();
    const submitted = s.logs.map(l => { try { return MS.interface.parseLog(l); } catch { return null; } })
      .find(l => l && l.name === "Submitted");
    if (!submitted) throw new Error("multisig submit receipt missing Submitted event");
    const idBefore = submitted.args.txId;
    const pending = await MS.getTx(idBefore);
    if (pending.target.toLowerCase() !== (process.env.CONTRACT_ADDRESS_V6 || process.env.CONTRACT_ADDRESS).toLowerCase() || pending.data !== data || pending.value !== 0n) throw new Error("multisig payload mismatch");
    const c = await (await MS.connect(new ethers.Wallet(owners[1].privateKey, p)).confirm(idBefore)).wait();
    const t = await MS.getTx(idBefore);
    console.log(`  ✅ 两票上链 [${off + 1}-${Math.min(off + CHUNK, batch.ids.length)}/${batch.ids.length}]：submit ${s.hash.slice(0, 18)}… confirm ${c.hash.slice(0, 18)}… (txId ${idBefore}) executed=${t[4]}`);
    if (!t[4]) throw new Error(`批次 ${idBefore} 未执行`);
    saveTrace({execution: {txId:String(idBefore), submit:s.hash, confirm:c.hash, executed:true, regions:part(batch.ids)}},nowIso);
  }
}

async function once() {
  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.bohr.life", undefined, { staticNetwork: true });
  const v6 = new ethers.Contract((process.env.CONTRACT_ADDRESS_V6 || process.env.CONTRACT_ADDRESS), require(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV6.abi.json")), p);
  if (Number((await p.getNetwork()).chainId) !== 968) throw new Error("v6 feeder requires chain 968");
  await withRetry(() => v6.regionCount());   // 连通性探针
  await round(p, v6);
}
(async () => {
  do { await once(); if (watchMin) await new Promise(r => setTimeout(r, watchMin * 60000)); } while (watchMin);
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
