/**
 * 事件 topic0 一致性核验（A10）
 * ============================================================================
 * 这个文件存在的原因（来源：2026-10-07 全仓只读审计 A10）：
 *
 *   两个核验台各自揣着一份**手写的事件清单**，两份都不是从合约 ABI 生成的：
 *     · `06-核验台单文件/雨证-链上核验台.html:386-403` 手写 `EVENT_SIG`（topic0 → 事件名，16 条）
 *     · `05-演示站点/verifier.html:722` 内嵌 `EVENT_ABI`（11 个事件的 ABI 副本）
 *   赛期里 `RainfallUpdated` 的 topic0 就已经因为加参数而变过一次 —— 当时是**人肉**发现的。
 *   合约再改一次事件，这两个文件不会报错，只会安静地把交易解码成「未知事件」，
 *   而演示现场恰好要靠它们给评委看「这笔赔付到底赔给了谁」。
 *
 *   所以这里把 ABI 当唯一事实来源，反算出每个事件的 topic0，与两份手写清单逐条对。
 *   任何一条对不上就红，并指出「应在哪个文件改哪一行」。
 *
 * 已挂进 `npm test`（2026-10-12 注册，A40①）：纯离线（只读本仓 ABI 与两份手写清单），不碰网络。
 * 用法：
 *   node check-event-topics.js            # 核验
 *   node check-event-topics.js --self-check   # 连「核验器本身会红吗」一起验（负样本）
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const R = path.join(__dirname, "..");
const VERIFIER = path.join(R, "05-演示站点", "verifier.html");
const EXPLORER = path.join(R, "06-核验台单文件", "雨证-链上核验台.html");
const ABI_FILES = {
  v1: path.join(R, "03-合约", "RainDeliveryInsurance.abi.json"),
  v2: path.join(R, "03-合约", "RainDeliveryInsuranceV2.abi.json"),
  v3: path.join(R, "03-合约", "RainDeliveryInsuranceV3.abi.json"),
  multisig: path.join(R, "03-合约", "OperatorMultisig.abi.json"),
};

/** 事件签名（`Name(uint256,address,…)`）—— 与手写清单的注释口径一致 */
const sigOf = (frag) => `${frag.name}(${frag.inputs.map((i) => i.type).join(",")})`;

/** ABI json → Map(事件名 → {sig, topic0}) */
function eventsOfAbi(abiPath) {
  const abi = JSON.parse(fs.readFileSync(abiPath, "utf8"));
  const iface = new ethers.Interface(abi);
  const out = new Map();
  for (const frag of iface.fragments) {
    if (frag.type !== "event") continue;
    const sig = sigOf(frag);
    out.set(frag.name, { sig, topic0: frag.topicHash });
  }
  return out;
}

/** 核验台手写表 → [{topic0, name, sig}] */
function parseExplorerTable() {
  const src = fs.readFileSync(EXPLORER, "utf8");
  const m = src.match(/const EVENT_SIG = \{([\s\S]*?)\n\};/);
  assert.ok(m, "核验台里找不到 EVENT_SIG 表（结构变了？）");
  const rows = [];
  const re = /"(0x[0-9a-fA-F]{64})":\s*"([A-Za-z0-9_]+)"\s*,?\s*\/\/\s*([A-Za-z0-9_]+\([^)]*\))/g;
  let x;
  while ((x = re.exec(m[1]))) rows.push({ topic0: x[1].toLowerCase(), name: x[2], sig: x[3].replace(/\s+/g, "") });
  return rows;
}

/** verifier.html 内嵌 EVENT_ABI → Map(事件名 → {sig, topic0}) */
function parseVerifierAbi() {
  const src = fs.readFileSync(VERIFIER, "utf8");
  const m = src.match(/const EVENT_ABI = (\[[\s\S]*?\]);/);
  assert.ok(m, "verifier.html 里找不到内嵌 EVENT_ABI（结构变了？）");
  const iface = new ethers.Interface(JSON.parse(m[1]));
  const out = new Map();
  for (const frag of iface.fragments) {
    if (frag.type !== "event") continue;
    out.set(frag.name, { sig: sigOf(frag), topic0: frag.topicHash });
  }
  return out;
}

/* ------------------------------------------------------------------ 核验 */

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  ✅ " + name); pass++; }
  catch (e) { console.log("  ❌ " + name + "\n       " + (e.message || e)); fail++; }
};

const abis = Object.fromEntries(Object.entries(ABI_FILES).map(([k, p]) => [k, eventsOfAbi(p)]));
const explorer = parseExplorerTable();
const verifier = parseVerifierAbi();

/** 事件名 → 所有 ABI 里出现过的定义（同一名字在 v1/v2/v3 可能是不同签名） */
const byName = new Map();
for (const [kind, m] of Object.entries(abis)) {
  for (const [name, e] of m) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ kind, ...e });
  }
}

console.log(`\n事件 topic0 核验  ·  核验台手写 ${explorer.length} 条 / verifier 内嵌 ${verifier.size} 条\n`);

t(`核验台 ${explorer.length} 条：每条 topic0 = keccak256(注释里的签名)`, () => {
  const bad = explorer.filter((r) => ethers.id(r.sig).toLowerCase() !== r.topic0);
  assert.deepStrictEqual(bad.map((r) => `${r.name} ${r.topic0}`), [],
    "手写的哈希与它自己的签名对不上 → 改 " + path.relative(R, EXPLORER) + ":386-403");
});

t("核验台每条：注释签名与合约 ABI 里的同名事件一致", () => {
  const bad = [];
  for (const r of explorer) {
    const defs = byName.get(r.name);
    if (!defs) { bad.push(`${r.name} 在任何 ABI 里都不存在`); continue; }
    if (!defs.some((d) => d.sig === r.sig)) {
      bad.push(`${r.name}：核验台写 ${r.sig}，ABI 是 ${defs.map((d) => d.kind + ":" + d.sig).join(" / ")}`);
    }
  }
  assert.deepStrictEqual(bad, [], "改 " + path.relative(R, EXPLORER) + ":386-403");
});

t("核验台每条：topic0 与 ABI 实算值逐字节相同", () => {
  const bad = [];
  for (const r of explorer) {
    const defs = byName.get(r.name) || [];
    const hit = defs.find((d) => d.sig === r.sig);
    if (hit && hit.topic0.toLowerCase() !== r.topic0) bad.push(`${r.name}：表里 ${r.topic0}，实算 ${hit.topic0}`);
  }
  assert.deepStrictEqual(bad, [], "改 " + path.relative(R, EXPLORER) + ":386-403");
});

t("核验台没有漏掉 ABI 里的 v1/v2 事件（现在是全量超集）", () => {
  const have = new Set(explorer.map((r) => r.name));
  const missing = [];
  for (const kind of ["v1", "v2"]) for (const name of abis[kind].keys()) if (!have.has(name)) missing.push(`${kind}:${name}`);
  assert.deepStrictEqual(missing, [],
    "核验台缺事件 → 现场会把它解码成「未知事件」。补进 " + path.relative(R, EXPLORER) + ":386-403");
});

t(`verifier.html 内嵌 ${verifier.size} 条 ABI：每条与合约 ABI 的同名事件签名一致`, () => {
  const bad = [];
  for (const [name, e] of verifier) {
    const defs = byName.get(name);
    if (!defs) { bad.push(`${name} 在任何 ABI 里都不存在`); continue; }
    if (!defs.some((d) => d.sig === e.sig)) {
      bad.push(`${name}：verifier 写 ${e.sig}，ABI 是 ${defs.map((d) => d.kind + ":" + d.sig).join(" / ")}`);
    }
  }
  assert.deepStrictEqual(bad, [], "改 " + path.relative(R, VERIFIER) + ":722 的 EVENT_ABI");
});

t("verifier.html 每条：topic0 与 ABI 实算值相同（页面解码靠它）", () => {
  const bad = [];
  for (const [name, e] of verifier) {
    const defs = byName.get(name) || [];
    const hit = defs.find((d) => d.sig === e.sig);
    if (hit && hit.topic0.toLowerCase() !== e.topic0.toLowerCase()) bad.push(name);
  }
  assert.deepStrictEqual(bad, []);
});

/* 若某天两份清单**故意**挂不同版本的同名事件（现在的例子：v3 的 JudgementSubmitted 加了
   rainfallAtJudgement，topic0 与 v2 不同），把事件名登记到这里，否则「两份不一致」就是红。 */
const CROSS_VERSION_OK = [];

t("两份手写清单：同一事件的 topic0 逐字节相同（解码出来必须是同一个名字）", () => {
  const map = new Map(explorer.map((r) => [r.name, r.topic0]));
  const bad = [];
  for (const [name, e] of verifier) {
    const other = map.get(name);
    if (!other) { bad.push(`${name} 只在内嵌 ABI 里，核验台没有`); continue; }
    if (other.toLowerCase() !== e.topic0.toLowerCase() && !CROSS_VERSION_OK.includes(name)) {
      bad.push(`${name}：核验台 ${other} vs verifier ${e.topic0}`);
    }
  }
  assert.deepStrictEqual(bad, [], "两份清单会解出不同的事件名 → 改其中一份，或登记进 CROSS_VERSION_OK");
});

/* --------------------------------------------------- 负样本（证明核验器会红） */

if (process.argv.includes("--self-check")) {
  t("负样本：改掉手写表里的一个哈希 → 必须报错", () => {
    const mutated = explorer.map((r, i) => (i === 0 ? { ...r, topic0: "0x" + "0".repeat(64) } : r));
    const bad = mutated.filter((r) => ethers.id(r.sig).toLowerCase() !== r.topic0);
    assert.ok(bad.length === 1, "核验器没抓住被改掉的哈希（那它对真改动也无效）");
  });
  t("负样本：把某条签名多写一个参数 → 必须报错", () => {
    const bad = explorer.filter((r, i) => i !== 0 && ethers.id(r.sig + ",bool").toLowerCase() !== r.topic0);
    assert.ok(bad.length === explorer.length - 1, "核验器没抓住签名漂移");
  });
  t("负样本：往 ABI 副本里塞一个不存在的同名事件 → 必须报错", () => {
    const fake = new Map(verifier);
    fake.set("RainfallUpdated", { sig: "RainfallUpdated(uint8)", topic0: ethers.id("RainfallUpdated(uint8)") });
    const bad = [...fake].filter(([name, e]) => !(byName.get(name) || []).some((d) => d.sig === e.sig));
    assert.deepStrictEqual(bad.map(([n]) => n), ["RainfallUpdated"], "核验器放过了签名不一致的副本");
  });
  t("负样本：两份清单挂上不同版本的同一事件 → 必须报错", () => {
    const fake = new Map(verifier);
    const e = fake.get("RainfallUpdated");
    fake.set("RainfallUpdated", { ...e, topic0: ethers.id("RainfallUpdated(uint8,uint256)") });
    const map = new Map(explorer.map((r) => [r.name, r.topic0]));
    const bad = [...fake].filter(([n, x]) => map.has(n) && map.get(n).toLowerCase() !== x.topic0.toLowerCase());
    assert.deepStrictEqual(bad.map(([n]) => n), ["RainfallUpdated"], "核验器没抓住两份清单的分歧");
  });
}

console.log(`\n${fail ? "❌" : "✅"} 事件 topic0 核验：${pass} 项通过 / ${fail} 项失败`);
process.exit(fail ? 1 : 0);
