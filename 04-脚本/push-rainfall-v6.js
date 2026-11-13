#!/usr/bin/env node
/**
 * push-rainfall-v6.js —— v6 全国区域喂价轮询器（2026-10-26）
 *
 * 周期：--watch=N（分钟，与计划任务 RainProof-Feed 的 PT30M 对齐，演示用 30）常驻；不带 --watch 单次干跑后退出。
 * 每轮：对注册表 v5-regions.json 里每个城市（V6 沿用既有区划表）
 *   ① 拉三机构逐小时预报（Open-Meteo，与验真层同源）；
 *   ② 算「上次链上喂价 → 现在」的窗口增量中位数（增量窗口闸门：绝对 ±2.5mm 兜底，长窗 5% 相对）；
 *   ③ 增量 ≥ 阈值 → 进批量；无增量但喂价超 20h → 进保鲜批（同值重喂续 MAX_FEED_AGE）；
 *   ④ 批量非空 → updateRainfallBatch 走多签两票（--send：B1 提交 + B2 确认自动执行）。
 * 分歧城市不喂，打印 rejectFeed 两票命令（拒收是运营决策，不自动上链）。
 * 新城市开通：往 v5-regions.json 加 {code,name,lat,lon}（链上 registerRegion 两票先行）。
 *
 * 用法：node push-rainfall-v6.js [--send] [--watch=30] [--city=330782]
 */
"use strict";
const path = require("path");
const fs = require("fs");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));
const { withRetry, provider: readProvider } = require("./rpc-read");

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
  throw new Error("缺少 v5-regions.json；请恢复已核实注册表，不能自动缩减为五城");
}
const REGIONS = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));

// 取数重试（2026-11-13）：单次 fetch 在这台机器上会偶发 `fetch failed`（TUN 代理抖动），
// 一城失败就等于该城 24 小时内不再更新——演示当天若正好砸在汉南/黄陂，台上就得解释灰块。
// 只对「网络层失败」和 429/5xx 重试；4xx 是请求本身写错（纬度/参数/额度策略），重试没意义，原样抛回去。
// 实测（11-13 15:40）这台机器对 api.open-meteo.com 会整段 10~12 秒连不上、随后又恢复 1 秒内 200，
// 所以退避要够长：4 次尝试、单次 12 秒上限，最坏约 27 秒才放弃，足以跨过一次抖动。
/* 网络层兜底（2026-11-13）：api.open-meteo.com 公布的 IPv4 51.81.167.44 会间歇性
   TCP 443 被掐——ICMP 通、DNS 正常、同一后端在 Hetzner 边缘（5.9.98.12 / IPv6
   2a01:4f8:162:30a1::2）可达且返回同一份 JSON。所以：主路走系统 DNS，失败时固定
   边缘 IP + SNI 直连，Host/路径/参数一个字不改——纯网络层修复，不动取数口径。 */
const EDGE_HOST = "api.open-meteo.com";
const EDGE_IPS = ["5.9.98.12", "2a01:4f8:162:30a1::2"];
let PREFER_EDGE = process.env.FEED_FORCE_EDGE === "1", edgeStreak = 0, edgeNoted = false;   // FEED_FORCE_EDGE=1 强制走边缘 IP（主路被封时的手动开关）

function fetchViaEdge(url, ms) {
  const https = require("https");
  if (process.env.FEED_FORCE_EDGE === "1" && !edgeNoted) {
    console.log("ℹ️ FEED_FORCE_EDGE=1：本轮直接走边缘 IP（同一后端、同一路径，取数口径不变）");
    edgeNoted = true;
  }
  const u = new URL(url);
  const one = ip => new Promise((resolve, reject) => {
    const req = https.request({
      host: ip, port: 443, servername: EDGE_HOST, method: "GET",
      path: u.pathname + u.search, rejectUnauthorized: true,
      family: ip.includes(":") ? 6 : 4,
      headers: { Host: EDGE_HOST, "User-Agent": "rainproof-v6-feeder/1.0" },
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode || 0;
        resolve({ ok: status >= 200 && status < 300, status, text: async () => body });
      });
    });
    req.setTimeout(ms, () => req.destroy(new Error("edge timeout")));
    req.on("error", reject);
    req.end();
  });
  return (async () => {
    for (const ip of EDGE_IPS) {
      try { return await one(ip); } catch { /* 换下一个边缘 */ }
    }
    throw new Error("weather edge unreachable");
  })();
}

async function fetchTO(url, ms = 12000) {
  let lastErr;
  const primary = async n => {
    let err;
    for (let i = 1; i <= n; i++) {
      try {
        const resp = await fetch(url, { headers: { "User-Agent": "rainproof-v6-feeder/1.0" }, signal: AbortSignal.timeout(ms) });
        if (resp.ok || (resp.status !== 429 && resp.status < 500)) return resp;
        err = new Error(`weather HTTP ${resp.status}`);
        try { await resp.text(); } catch { /* 丢弃响应体，腾出连接 */ }
      } catch (e) {
        err = e;
      }
      if (i < n) await new Promise(r => setTimeout(r, 800 * i));
    }
    throw err;
  };
  if (!PREFER_EDGE) {
    try {
      const resp = await primary(4);
      edgeStreak = 0;
      return resp;
    } catch (e) { lastErr = e; }
  }
  try {
    const resp = await fetchViaEdge(url, ms);
    if (++edgeStreak >= 3 && !PREFER_EDGE) {
      PREFER_EDGE = true;
      if (!edgeNoted) {
        console.log("ℹ️ 主路 api.open-meteo.com 连不上，本轮起改走边缘 IP（同一后端、同一路径，取数口径不变）");
        edgeNoted = true;
      }
    }
    return resp;
  } catch (e2) {
    if (PREFER_EDGE) {
      edgeStreak = 0;
      try { return await primary(2); } catch { /* 边缘与主路都挂 */ }
    }
    throw lastErr || e2;
  }
}

/* ---- G5 原始报文留痕（2026-10-26）：三模型原始响应全文落盘 + SHA-256 锚定 ----
   链不动（红线）：锚定做在文件层——留痕 JSON 记录每城原始报文的 sha256 与文件名，
   任何人拿同一份 raw 文件都能复算出同一哈希；与喂价 evidenceHash 并列互证。
   体量护栏（2026-11-08 修订）：证据按「年月」子目录归档，单月目录超 200MB 才停存并告警。
   旧版是顶层 50MB 一刀切停存——顶层只进不出，11-08 攒到 63MB 后全城 evidence-unavailable、
   承保整停一天。子目录化后顶层历史文件原地保留（含 11-07 裁决引用的 11-06 报文），
   单月 200MB 对 100GB+ 磁盘约等于永不触顶；真触顶仍然宁停不删。 */
const RAW_DIR = path.join(__dirname, "..", "09-AI判定留痕", "raw");
const RAW_MONTH_CAP = 200 * 1024 * 1024;
const TRACE_DIR = path.join(__dirname, "..", "09-AI判定留痕");
const sha256 = t => require("crypto").createHash("sha256").update(t, "utf8").digest("hex");
function saveRaw(code, name, url, rawText) {
  try {
    const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const monthDir = path.join(RAW_DIR, stamp.slice(0, 6));
    let total = 0;
    if (fs.existsSync(monthDir)) for (const f of fs.readdirSync(monthDir)) total += fs.statSync(path.join(monthDir, f)).size;
    if (total > RAW_MONTH_CAP) return { file: null, sha256: sha256(rawText), skipped: "month-cap-200MB" };
    fs.mkdirSync(monthDir, { recursive: true });
    const file = `v6feed-${code}-${stamp}-${require("crypto").randomUUID()}.json`;
    fs.writeFileSync(path.join(monthDir, file), JSON.stringify({ schema: "rainproof/raw-feed@1", code, name, url, savedAt: new Date().toISOString(), rawText, raw: JSON.parse(rawText) }, null, 1), { encoding: "utf8", flag: "wx" });
    return { file: `${stamp.slice(0, 6)}/${file}`, sha256: sha256(rawText), bytes: rawText.length };
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
          `人工核：保留三模型原始报文，核对同一窗口；Archive 仅作历史再分析对照。` +
          `须满足合约至少 2 个来源、置信阈值与证据要求，再审批多签；不得直接同值续期。`);
        skipped.push({ code: r.code, name: r.name, reason: "diverge", windowH: inc.windowH, spread: inc.spread, tol: inc.tol });
        continue;
      }
      const target = Math.max(chain, chain + Math.round(inc.median || 0));
      const stale = ageH > REFRESH_HOURS;
      // 长空窗提示：窗口 > LONG_GAP_HOURS 时，这轮喂的是「一段历史」而不是「一小时增量」。
      // 处理：仍走 3 取 2 收敛闸门（≥2 个模型落在中位 ±max(2.5, 5%) 内），收敛即进批量并
      // 在 trace.longGap 全量留痕供复核；不收敛本来就进 divergence 拒收。
      // 11-08 断网恢复实测：122 城长空窗一轮全部按此路径自愈（含 hold 中的汉阳/武昌——
      // 118h 窗口 2/3 模型 27.7/30.2 距中位 ≤2.5mm，合法收敛；当日无在保保单，零赔付影响）。
      if (inc.windowH > LONG_GAP_HOURS && target > chain) {
        notes.push(`${r.name} ⏳ 长空窗补历史（窗口 ${inc.windowH.toFixed(0)}h，增量中位 ${inc.median.toFixed(1)}mm，` +
          `三模型 ${inc.perModel.map(v => v.toFixed(1)).join("/")}）→ 3取2收敛，已入批量并留痕`);
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
  const w0 = new ethers.Wallet(owners[0].privateKey, p);
  const w1 = new ethers.Wallet(owners[1].privateKey, p);

  // 演示点位优先：余额只够发一批时，先保台上要念的六个区划，再轮到其余（保持原顺序，稳定排序）。
  const PRIORITY = new Set([420113, 420116, 440100, 110100, 310100, 510100]);
  {
    const idx = batch.ids.map((c, i) => i).sort((a, b) => {
      const pa = PRIORITY.has(batch.ids[a]) ? 0 : 1, pb = PRIORITY.has(batch.ids[b]) ? 0 : 1;
      return pa - pb || a - b;
    });
    for (const k of Object.keys(batch)) batch[k] = idx.map(i => batch[k][i]);
  }

  // 实测（2026-11-13，20 gwei）：submit 的 gas ≈ 400k + 114k×城数，1 城 0.0100 BOT、20 城 0.0534 BOT。
  // 钱不够时整批抛账会一刀不喂，比少喂更糟：这里按余额算这一轮能发几城，剩下的留到下一轮。
  const fee = await p.getFeeData();
  const gasPrice = fee.gasPrice || 20000000000n;
  const bal0 = await p.getBalance(w0.address);
  const BASE_GAS = 400000n, PER_CITY_GAS = 114000n;
  const usable = bal0 - bal0 / 10n;   // 留 10% 余量，别炸在最后一步
  const afford = usable > BASE_GAS * gasPrice
    ? Number((usable - BASE_GAS * gasPrice) / (PER_CITY_GAS * gasPrice)) : 0;
  const sendCount = Math.min(batch.ids.length, Math.max(0, afford));
  if (sendCount === 0) {
    console.log(`  ⛔ owner0 余额 ${ethers.formatEther(bal0)} BOT，连 1 城都不够（约 ${ethers.formatEther(BASE_GAS * gasPrice)} BOT）——本轮不发送，先补 gas`);
    process.exitCode = 1;
    return;
  }
  if (sendCount < batch.ids.length) {
    console.log(`  ⚠️ 余额 ${ethers.formatEther(bal0)} BOT 只够 ${sendCount} 城（本轮共 ${batch.ids.length} 城待喂），先发这批，其余下一轮补`);
  }
  const sendBatch = {};
  for (const k of Object.keys(batch)) sendBatch[k] = batch[k].slice(0, sendCount);

  for (let off = 0; off < sendBatch.ids.length; off += CHUNK) {
    const part = (arr) => arr.slice(off, off + CHUNK);
    const data = v6.interface.encodeFunctionData("updateRainfallBatch",
      [part(sendBatch.ids), part(sendBatch.mms), part(sendBatch.evs), part(sendBatch.conf), part(sendBatch.src)]);
    const s = await (await MS.connect(w0).submit((process.env.CONTRACT_ADDRESS_V6 || process.env.CONTRACT_ADDRESS), 0, data)).wait();
    const submitted = s.logs.map(l => { try { return MS.interface.parseLog(l); } catch { return null; } })
      .find(l => l && l.name === "Submitted");
    if (!submitted) throw new Error("multisig submit receipt missing Submitted event");
    const idBefore = submitted.args.txId;
    const pending = await MS.getTx(idBefore);
    if (pending.target.toLowerCase() !== (process.env.CONTRACT_ADDRESS_V6 || process.env.CONTRACT_ADDRESS).toLowerCase() || pending.data !== data || pending.value !== 0n) throw new Error("multisig payload mismatch");
    const c = await (await MS.connect(w1).confirm(idBefore)).wait();
    const t = await MS.getTx(idBefore);
    console.log(`  ✅ 两票上链 [${off + 1}-${Math.min(off + CHUNK, sendBatch.ids.length)}/${sendBatch.ids.length}]：submit ${s.hash.slice(0, 18)}… confirm ${c.hash.slice(0, 18)}… (txId ${idBefore}) executed=${t[4]}`);
    if (!t[4]) throw new Error(`批次 ${idBefore} 未执行`);
    saveTrace({execution: {txId:String(idBefore), submit:s.hash, confirm:c.hash, executed:true, regions:part(sendBatch.ids)}},nowIso);
  }
}

async function once() {
  const p = readProvider(ethers, process.env.SEPOLIA_RPC || "https://rpc.bohr.life");
  try {
  const v6 = new ethers.Contract((process.env.CONTRACT_ADDRESS_V6 || process.env.CONTRACT_ADDRESS), require(path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV6.abi.json")), p);
  if (Number((await withRetry(() => p.getNetwork())).chainId) !== 968) throw new Error("v6 feeder requires chain 968");
  await withRetry(() => v6.regionCount());   // 连通性探针
  await round(p, v6);
  } finally { p.destroy(); }
}
(async () => {
  do {
    process.exitCode = 0;
    try { await once(); }
    catch (error) {
      if (!watchMin) throw error;
      process.exitCode = 1;
      console.error("本轮失败，等待下一轮：" + (error.shortMessage || error.message));
    }
    if (watchMin) await new Promise(r => setTimeout(r, watchMin * 60000));
  } while (watchMin);
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
