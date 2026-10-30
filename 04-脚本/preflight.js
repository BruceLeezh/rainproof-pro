#!/usr/bin/env node
/**
 * preflight.js —— 上场前自检（2026-10-28）
 *
 * 一条命令回答「现在能不能演示」：文件齐不齐、链读得通不通、喂价还新鲜吗、
 * 钱包够不够两票 gas、页面依赖的内联数据在不在。
 *
 * 用法：node preflight.js [--json]
 * 退出码：0 全绿 / 1 有 ❌（会挡住演示，如喂价超 MAX_FEED_AGE、余额不够两票）
 *         有 ⚠ 不影响退出码（如剩 3 小时新鲜度、某城无网格价）
 *
 * 只读：不发交易、不改任何文件。
 */
"use strict";
const path = require("path");
const fs = require("fs");
require(path.join(__dirname, "node_modules", "dotenv")).config({ path: path.join(__dirname, ".env") });
const ACTIVE = require("./active-deployment").applyDeployment();
const { ethers } = require(path.join(__dirname, "node_modules", "ethers"));

const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "05-演示站点");
const MAIN_PAGE = ACTIVE.version === "V6" ? "index-v6.html" : "index-v5.html";
const VERIFY_PAGE = ACTIVE.version === "V6" ? "verify-v6.html" : "verify-v5.html";
const REG_FILE = path.join(__dirname, "v5-regions.json");
/** 演示城市：黄石港区（湖北 118 里价格与雨量都最出镜的一个） */
const DEMO_REGION = 420202;
/** 两票 gas 的保底：20 gwei × 3.2M ≈ 0.064 BOT/批，按两批留 0.15 */
const MIN_WALLET_BOT = 0.15;

const out = [];
const rows = [];
let POLICY_COUNT = null;
function rec(level, area, msg) { rows.push({ level, area, msg }); }
const ok = (a, m) => rec("ok", a, m);
const warn = (a, m) => rec("warn", a, m);
const bad = (a, m) => rec("bad", a, m);

// ── 1. 静态资源 ────────────────────────────────────────────────
function checkFiles() {
  const need = [
    [path.join(SITE, MAIN_PAGE), MAIN_PAGE],
    [path.join(SITE, VERIFY_PAGE), VERIFY_PAGE],
    [path.join(SITE, "console.html"), "console.html"],
    [path.join(SITE, "rider.html"), "rider.html"],
    [path.join(SITE, "terms.html"), "terms.html"],
    [path.join(SITE, "cn-cities.js"), "cn-cities.js"],
    [path.join(SITE, "ethers.umd.min.js"), "ethers.umd.min.js"],
    [path.join(SITE, "solvency-mc-inline.js"), "solvency-mc-inline.js"],
    [path.join(SITE, "evidence", "wuhan-evidence-inline.js"), "evidence/wuhan-evidence-inline.js"],
    [REG_FILE, "v5-regions.json"],
  ];
  for (const [p, label] of need) {
    if (!fs.existsSync(p)) { bad("文件", `缺 ${label}`); continue; }
    const sz = fs.statSync(p).size;
    if (sz === 0) { bad("文件", `${label} 是空文件`); continue; }
    ok("文件", `${label} ${(sz / 1024).toFixed(0)} KB`);
  }
  // index-v5 必须挂着 cn-cities.js，否则区划名会退化成「区域 #420202」
  const idx = fs.existsSync(path.join(SITE, MAIN_PAGE)) ? fs.readFileSync(path.join(SITE, MAIN_PAGE), "utf8") : "";
  if (idx && !idx.includes('src="cn-cities.js"')) bad("文件", 'index-v5.html 缺 <script src="cn-cities.js">（区划名会变「区域 #xxxx」）');
  else if (idx) ok("文件", "index-v5.html 已挂 cn-cities.js");
  // 内联数据：file:// 双击时 fetch 会被 CORS 拦，必须有内联兜底
  for (const [file, marker, why] of [
    [VERIFY_PAGE, ACTIVE.version === "V6" ? "v6-migration-inline.js" : "WUHAN_EVIDENCE_TEXT", "核验台第 6 条要算证据哈希"],
    ["console.html", "SOLVENCY_MC", "运维台偿付能力面板"],
  ]) {
    const src = fs.existsSync(path.join(SITE, file)) ? fs.readFileSync(path.join(SITE, file), "utf8") : "";
    if (src && src.includes(marker)) ok("文件", `${file} 内联兜底 ${marker} 在`);
    else bad("文件", `${file} 缺内联兜底 ${marker} —— ${why}会失败`);
  }
}

// ── 2. 注册表 ──────────────────────────────────────────────────
let REGIONS = [];
function checkRegistry() {
  if (!fs.existsSync(REG_FILE)) { bad("注册表", "v5-regions.json 不存在"); return; }
  REGIONS = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
  ok("注册表", `${REGIONS.length} 个区划待喂价`);
  const dead = REGIONS.filter(r => r.code === 330782);
  if (dead.length) warn("注册表", "义乌 330782 仍在注册表里（用户已要求下线）");
  const dup = REGIONS.map(r => r.code).filter((c, i, a) => a.indexOf(c) !== i);
  if (dup.length) bad("注册表", `重复区划码 ${[...new Set(dup)].join(",")}`);
}

// ── 3. 链上状态 ────────────────────────────────────────────────
async function checkChain() {
  const rpc = process.env.SEPOLIA_RPC || "https://rpc.bohr.life";
  const addr = ACTIVE.contract;
  if (!addr) { bad("链", ".env 没有 CONTRACT_ADDRESS(_V5)"); return; }
  const p = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const abi = require(path.join(ROOT, "03-合约", (ACTIVE.version === "V6" ? "RainDeliveryInsuranceV6.abi.json" : "RainDeliveryInsuranceV5.abi.json")));
  const c = new ethers.Contract(addr, abi, p);

  const t0 = Date.now();
  let net;
  try { net = await p.getNetwork(); }
  catch (e) { bad("链", `RPC 连不上（${rpc}）：${e.shortMessage || e.message}`); return; }
  if(net.chainId !== 968n) throw new Error("Expected chain 968");
  ok("链", `RPC ${net.chainId} 可达，${Date.now() - t0} ms`);

  const [rc, pool, nextId, maxAge, exposure] = await Promise.all([
    c.regionCount(), c.poolBalance(), c.nextPolicyId(), c.MAX_FEED_AGE(), c.openExposure(),
  ]);
  ok("链", `regionCount=${rc} · 池子 ${ethers.formatUnits(pool, 2)} 元 · 保单 ${nextId} 张 · 在保敞口 ${ethers.formatUnits(exposure, 2)} 元`);
  POLICY_COUNT = Number(nextId);
  if (pool === 0n) bad("链", "池子为 0 —— 任何保单都过不了储备校验");

  if(ACTIVE.version === "V6") {
    const grace = await c.CLAIM_GRACE();
    if(grace !== 604800n) bad("V6", "领取宽限不是7天");
    else ok("V6", "合约7天领取宽限已验证");
  }
  // 缓存上限
  const keyCfg = path.join(SITE, "..", "..", "密钥-本地", "owner-keys-2026-10-24.json");
  void keyCfg;

  // 网格价：演示城市两档都必须有价
  for (const h of [12, 24]) {
    try {
      const v = await c.premiumOf(DEMO_REGION, h);
      if (v === 0n) bad("定价", `${DEMO_REGION} ${h}h 无网格价（会走兜底价）`);
      else ok("定价", `${DEMO_REGION} ${h}h = ${ethers.formatUnits(v, 2)} 元`);
    } catch (e) { bad("定价", `${DEMO_REGION} ${h}h 读价失败：${e.shortMessage || e.message}`); }
  }

  // ── 4. 喂价新鲜度 ──
  const now = Math.floor(Date.now() / 1000);
  const maxAgeS = Number(maxAge);
  const stale = [];
  let oldest = { code: null, h: -1 };
  for (const r of REGIONS) {
    let lf = 0n;
    try { lf = await c.lastFeedAt(r.code); } catch { continue; }
    if (!lf) { stale.push({ code: r.code, name: r.name, h: Infinity }); continue; }
    const h = (now - Number(lf)) / 3600;
    if (h > oldest.h) oldest = { code: r.code, name: r.name, h };
    if (now - Number(lf) > maxAgeS) stale.push({ code: r.code, name: r.name, h });
  }
  if (oldest.code === null) bad("喂价", "所有区划都没喂过价");
  else if (stale.length) {
    bad("喂价", `${stale.length}/${REGIONS.length} 个区划已超 MAX_FEED_AGE(${maxAgeS / 3600}h)，最老 ${oldest.name} ${oldest.h.toFixed(1)}h —— 这些区划的新保单会被拒`);
  } else {
    const left = maxAgeS / 3600 - oldest.h;
    const m = `最老 ${oldest.name}(${oldest.code}) ${oldest.h.toFixed(1)}h，还剩 ${left.toFixed(1)}h`;
    if (left < 4) warn("喂价", `${m} —— 快过期，上场前先跑一次 push-rainfall-v6.js --send`);
    // 2026-10-30 踩过：confirm 钱包烧干，30 分钟一轮的计划任务连挂 13 小时没人知道，
    // 71/122 区划一夜变陈旧。正常最老不会超 20.5h（REFRESH_HOURS=20 才刷新），
    // 所以 21h 才是「喂价器病了」的判据，不是 8h。
    else if (oldest.h > 21) warn("喂价", `${m} —— 计划任务本该每 30 分钟轮一次，最老却已 ${oldest.h.toFixed(1)}h，先查 RainProof-Feed 的退出码与日志`);
    else ok("喂价", m);
  }

  // ── 5. 钱包余额 ──
  const KEY_FILE = process.env.OWNER_KEY_FILE || path.join(__dirname, "..", "..", "密钥-本地", "owner-keys-2026-10-24.json");
  if (!fs.existsSync(KEY_FILE)) warn("钱包", `密钥文件不存在：${KEY_FILE}（换机需设 OWNER_KEY_FILE）`);
  else {
    const owners = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).accounts || [];
    for (let i = 0; i < owners.length; i++) {
      const a = new ethers.Wallet(owners[i].privateKey).address;
      const b = await p.getBalance(a);
      const bot = Number(ethers.formatEther(b));
      if (bot < MIN_WALLET_BOT) bad("钱包", `owner${i} ${a.slice(0, 8)}… 只有 ${bot.toFixed(3)} BOT（两票需要 ≥${MIN_WALLET_BOT}）`);
      // 一次 20 区划批量投票两票各 ~0.064 BOT。0.3 以下只够两批，提前喊；
      // 正常余额应在 0.5 上下（RainProof-Feed 每轮先跑 fund-v6-ops-gas.js 自动补到这个数）。
      else if (bot < 0.3) warn("钱包", `owner${i} ${a.slice(0, 8)}… ${bot.toFixed(3)} BOT —— 只够一两批，下一轮 RainProof-Feed 会自动补到 0.5；想立刻补跑 node fund-v6-ops-gas.js --send`);
      else ok("钱包", `owner${i} ${a.slice(0, 8)}… ${bot.toFixed(3)} BOT`);
    }
  }
  if (process.env.PRIVATE_KEY) {
    const d = new ethers.Wallet(process.env.PRIVATE_KEY).address;
    const b = Number(ethers.formatEther(await p.getBalance(d)));
    if (b < MIN_WALLET_BOT) bad("钱包", `deployer ${d.slice(0, 8)}… 只有 ${b.toFixed(3)} BOT（补 gas 用）`);
    else ok("钱包", `deployer ${d.slice(0, 8)}… ${b.toFixed(3)} BOT`);
  }
}

// ── 6. 计划任务 ────────────────────────────────────────────────
// 2026-10-28 踩过：两个任务都是「只用电池就不启动」+「错过不补跑」，
// 笔记本拔电睡一晚，喂价静默停了 13 小时、还记了 25 次 Missed。
function checkTasks() {
  if (process.platform !== "win32") { warn("任务", "非 Windows，跳过计划任务检查"); return; }
  const { execFileSync } = require("child_process");
  const ps = `
    [Console]::OutputEncoding=[Text.Encoding]::UTF8;
    foreach ($n in @('RainProof-Feed','RainProof-OpsDaily','RainProof-Keeper-V6')) {
      $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
      if (-not $t) { "MISSING|$n"; continue }
      $s = $t.Settings; $i = $t | Get-ScheduledTaskInfo
      $a = $t.Actions[0].Arguments
      "$n|$($t.Triggers[0].Repetition.Interval)|$($s.DisallowStartIfOnBatteries)|$($s.StartWhenAvailable)|$($i.LastTaskResult)|$($i.NumberOfMissedRuns)|$($i.NextRunTime)|$a"
    }`;
  let raw;
  try {
    raw = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 30000 });
  } catch (e) { warn("任务", `查计划任务失败：${e.message}`); return; }
  for (const line of raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    const [name, interval, battery, when, last, missed, next, ...rest] = line.split("|");
    const actionArgs = rest.join("|");
    if (name === "MISSING") { bad("任务", `${interval} 未注册`); continue; }
    // 2026-10-30 踩过：用「无 BOM 的 .ps1」改任务动作，Windows PowerShell 5.1 按 GBK 解码，
    // 中文路径被写成乱码 → `cd /d` 失败 → 任务退出码 1 且**一个字都不输出**，静默停摆。
    // 判据：动作里必须出现本项目目录名。项目改名时这条要跟着改。
    const PROJECT_DIR = path.basename(path.join(__dirname, ".."));
    if (actionArgs && !actionArgs.includes(PROJECT_DIR)) {
      bad("任务", `${name} 的动作里找不到项目路径「${PROJECT_DIR}」——命令行多半被写成乱码了，任务会静默退出 1。重设动作时 .ps1 必须存成 UTF-8 BOM`);
      continue;
    }
    const bits = [`间隔 ${interval || "—（每日）"}`];
    if (battery === "True") bad("任务", `${name} 「只用电池时不启动」= True —— 拔电就不跑，改掉`);
    if (when === "False") bad("任务", `${name} 「错过不补跑」= False —— 睡过去就永久跳过，改掉`);
    if (Number(missed) > 0) bits.push(`已错过 ${missed} 次`);
    if (next) bits.push(`下次 ${next}`);
    if (last !== "0") {
      // 0xC000013A = STATUS_CONTROL_C_EXIT：控制台收到 Ctrl+C 或被关闭。查过 6 次记录，全部发生在
      // 批次已 ✅ executed=true 之后（见 02-作战与答辩/自动完善-定时日志.txt），属收尾噪声。
      // 当成异常报会让「红了」变成背景色，人就开始忽略真正的红。
      const code = Number(last) >>> 0;
      if (code === 0xC000013A) ok("任务", `${name} 收尾被 Ctrl+C 打断（工作已完成，非故障）· ${bits.join(" · ")}`);
      else warn("任务", `${name} 上次退出码 0x${code.toString(16).toUpperCase()}（非 0，查日志）· ${bits.join(" · ")}`);
    } else ok("任务", `${name} ${bits.join(" · ")}`);
  }
}

// ── 7. keeper 活没活着 ────────────────────────────────────────
// 2026-10-29 踩过：一次 DNS 抖动让 RainProof-Keeper-V6 记了个 0x1。更坏的情形是任务被禁用或
// 卡死——喂价照样新鲜、页面照样能投保，理赔却静默停摆，「看起来全绿」最难发现。
// 判据用 keeper 自己写的轮询表头，比计划任务的 LastRunTime 可信（后者只看启动、不看跑通）。
function checkKeeperLog() {
  const log = path.join(__dirname, "..", "02-作战与答辩", "V6-keeper.log");
  if (!fs.existsSync(log)) { warn("keeper", "日志不存在 —— 从没跑过？"); return; }
  const text = fs.readFileSync(log, "utf8");
  const head = /^=====\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*轮询开始/mg;
  let last = null, m;
  while ((m = head.exec(text)) !== null) last = m[1];
  if (!last) { warn("keeper", "日志里找不到轮询表头，判不出最近一次运行"); return; }
  const ageMin = (Date.now() - new Date(last.replace(" ", "T")).getTime()) / 60000;
  if (ageMin > 90) {
    const why = POLICY_COUNT ? "理赔会静默停摆" : "当前 0 张保单，暂时不致命，但别让它继续";
    warn("keeper", `已 ${(ageMin / 60).toFixed(1)} 小时没跑（上次 ${last}）—— ${why}`);
  } else {
    ok("keeper", `上次 ${last}，${Math.round(ageMin)} 分钟前`);
  }
}

// ── 输出 ───────────────────────────────────────────────────────
(async () => {
  checkFiles();
  checkRegistry();
  try { await checkChain(); }
  catch (e) { bad("链", `检查中断：${e.shortMessage || e.message}`); }
  checkTasks();
  checkKeeperLog();

  const json = process.argv.includes("--json");
  const bads = rows.filter(r => r.level === "bad");
  const warns = rows.filter(r => r.level === "warn");

  if (json) {
    console.log(JSON.stringify({ ok: bads.length === 0, bad: bads.length, warn: warns.length, rows }, null, 2));
  } else {
    const tag = { ok: "✅", warn: "⚠️ ", bad: "❌" };
    for (const r of rows) console.log(`${tag[r.level]} [${r.area}] ${r.msg}`);
    console.log("");
    if (bads.length) console.log(`❌ 上场前必须解决 ${bads.length} 项`);
    else if (warns.length) console.log(`⚠️  可以上场，但有 ${warns.length} 项提醒`);
    else console.log("✅ 全绿，可以上场");
  }
  process.exit(bads.length ? 1 : 0);
})();