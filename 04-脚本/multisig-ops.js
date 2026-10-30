#!/usr/bin/env node
/**
 * multisig-ops.js —— 多签独立操作工具（B 侧自建，2026-10-25）
 *
 * 背景：operator 是 2/3 多签（OperatorMultisig）。换主 = addOwner×N → removeOwner×N，
 * 每步「submit(第1票) → confirm(第2票)」，第二票 confirm 达到阈值**自动执行**
 * （OperatorMultisig.sol:121）；removeOwner 有 owners-1 ≥ threshold 护栏（:182），
 * 顺序反了当场锁死——所以本工具**强制先加后减**，并在发交易前做全序模拟。
 *
 * 用法（ PowerShell 示例，677 需代理：$env:NODE_USE_ENV_PROXY='1'; $env:HTTPS_PROXY='http://127.0.0.1:7890' ）：
 *   node multisig-ops.js status
 *   node multisig-ops.js handover --add=0xB1,0xB2 --remove=0xA2,0xA3          # 干跑：只打印计划
 *   node multisig-ops.js handover --add=… --remove=… --send                  # 真发交易（每步二票）
 *   node multisig-ops.js self-check                                          # 本地 ganache 全自检，不需要网络与钥匙
 *
 * 环境变量（04-脚本/.env）：
 *   MULTISIG_ADDR  多签地址（默认 0x676b791da72Ef072718c9f078377bF21be1b160f）
 *   SEPOLIA_RPC    目标链 RPC（历史变量名；677 = https://rpc.botchain.ai）
 *   PRIVATE_KEY    签名者1（现 owner1，部署账户）
 *   RIDER_KEY      签名者2（现 owner2，骑手演示账户）
 *   可选 --key=0x…（可多次）：额外签名者（换主后若要把两把旧钥匙都移除，新 owner 的钥匙必须进来）
 */
"use strict";
const path = require("path");
const fs = require("fs");
const SCRIPTS = __dirname;
const ROOT = path.join(SCRIPTS, "..");
require(path.join(SCRIPTS, "node_modules", "dotenv")).config({ path: path.join(SCRIPTS, ".env") });
const { ethers } = require(path.join(SCRIPTS, "node_modules", "ethers"));

const MS_ABI = JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "OperatorMultisig.abi.json"), "utf8"));
const MS_BIN = fs.readFileSync(path.join(ROOT, "03-合约", "OperatorMultisig.bytecode.txt"), "utf8").trim();
const DEFAULT_MS = "0x676b791da72Ef072718c9f078377bF21be1b160f";

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name) => { const m = argv.find((a) => a.startsWith(`--${name}=`)); return m ? m.slice(name.length + 3) : null; };
const has = (name) => argv.includes(`--${name}`);
const normAddr = (s) => { try { return ethers.getAddress(s.trim()); } catch { throw new Error(`地址不合法（校验和/格式错，owner3 那种错就是这么抓的）：${s}`); } };

function loadSignerPool() {
  const pool = [];
  for (const [name, v] of [["PRIVATE_KEY", process.env.PRIVATE_KEY], ["RIDER_KEY", process.env.RIDER_KEY]]) {
    if (v && /^[0x]/.test(v)) pool.push({ name, wallet: new ethers.Wallet(v) });
  }
  for (const a of argv) if (a.startsWith("--key=")) pool.push({ name: "--key", wallet: new ethers.Wallet(a.slice(6)) });
  if (!pool.length) throw new Error("没有任何签名者：.env 里没有 PRIVATE_KEY/RIDER_KEY，也没给 --key");
  return pool;
}

function connect() {
  const rpc = process.env.SEPOLIA_RPC || "https://rpc.botchain.ai";
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const ms = new ethers.Contract(opt("addr") || process.env.MULTISIG_ADDR || DEFAULT_MS, MS_ABI, provider);
  return { provider, ms };
}

/** 对一个多签合约执行一步治理操作（addOwner/removeOwner/setThreshold）：
 *  submit 用一名在任 owner，confirm 用另一名在任 owner（第二票自动执行）。 */
async function twoVoteStep(ms, pool, fnName, arg, label, log = console.log) {
  const owners = (await ms.getOwners()).map((a) => a.toLowerCase());
  const voters = pool.filter((p) => owners.includes(p.wallet.address.toLowerCase()));
  if (voters.length < 2) {
    throw new Error(`「${label}」凑不齐 2 名在任 owner 签名（当前池内在任：${voters.map((v) => v.name).join(",") || "无"}）。
  → 若这一步要移除的钥匙还在池里，把新 owner 的私钥用 --key=0x… 加进来。`);
  }
  const data = ms.interface.encodeFunctionData(fnName, [arg]);
  const s1 = new ethers.Wallet(voters[0].wallet.privateKey, ms.runner);
  const s2 = new ethers.Wallet(voters[1].wallet.privateKey, ms.runner);
  const tx1 = await (await ms.connect(s1).submit(ms.target, 0, data)).wait();
  const txId = require("./multisig-receipt").submittedTxId(ms, tx1, String(ms.target), data);
  const tx2 = await (await ms.connect(s2).confirm(txId)).wait();
  const t = await ms.getTx(txId);
  if (!t.executed) throw new Error(`「${label}」第二票后仍未执行（confirmations=${t.confirmations}）`);
  log(`  ✅ ${label}  submit=${tx1.hash.slice(0, 18)}… confirm=${tx2.hash.slice(0, 18)}… (txId ${txId})`);
}

/** 规划并（可选）执行换主。全部 add 在前、remove 在后；每步前重读 owners，已完成的自动跳过。 */
async function handover(send) {
  const { provider, ms } = connect();
  const pool = loadSignerPool().map((p) => ({ ...p, wallet: p.wallet.connect(provider) }));
  const adds = (opt("add") || "").split(",").filter(Boolean).map(normAddr);
  const removes = (opt("remove") || "").split(",").filter(Boolean).map(normAddr);
  if (!adds.length) throw new Error("--add 至少给一个新地址");
  const overlap = adds.filter((a) => removes.includes(a));
  if (overlap.length) throw new Error(`同一地址既加又减：${overlap.join(",")}`);

  const owners0 = (await ms.getOwners()).map((a) => ethers.getAddress(a));
  const th = Number(await ms.threshold());
  console.log(`多签 ${await ms.getAddress()} · 现任 owners（${owners0.length}）阈值 ${th}：`);
  owners0.forEach((o) => console.log(`  - ${o}`));

  // 模拟全序：先加后减，任何一步减完不得低于阈值
  let sim = new Set(owners0.map((a) => a.toLowerCase()));
  const plan = [];
  for (const a of adds) plan.push(["addOwner", a, sim.has(a.toLowerCase())]);
  for (const a of adds) if (!sim.has(a.toLowerCase())) sim.add(a.toLowerCase());
  for (const r of removes) plan.push(["removeOwner", r, !sim.has(r.toLowerCase())]);
  for (const r of removes) {
    if (!sim.has(r.toLowerCase())) continue;
    if (sim.size - 1 < th) throw new Error(`计划非法：移除 ${r} 后仅剩 ${sim.size - 1} 名 owner < 阈值 ${th}（合约 :182 也会拒）`);
    sim.delete(r.toLowerCase());
  }
  const finalSet = [...sim].map((a) => ethers.getAddress(a)).sort();
  const skips = plan.filter((p) => p[2]).length;
  console.log(`\n换主计划（${plan.length - skips} 步待执行${skips ? ` · ${skips} 步已完成将跳过` : ""}，先加后减）：`);
  plan.forEach(([fn, a, done]) => console.log(`  ${done ? "〔跳过〕" : fn === "addOwner" ? "  + " : "  − "}${a}`));
  console.log(`\n换主后 owners（${finalSet.length}，阈值仍 ${th}）：`);
  finalSet.forEach((o) => console.log(`  - ${o}`));
  // 签名可行性预警：移除名单含两把默认钥匙时，最后几步需要新 owner 钥匙
  const poolAddrs = new Set(pool.map((p) => p.wallet.address.toLowerCase()));
  const removesDefaultKeys = removes.filter((r) => owners0.some((o) => o.toLowerCase() === r.toLowerCase()) && poolAddrs.has(r.toLowerCase()));
  if (removesDefaultKeys.length >= 2 && !argv.some((a) => a.startsWith("--key=")))
    console.log(`⚠️ 移除名单含 ${removesDefaultKeys.length} 把池内钥匙：这些步骤本身仍可完成（被移除前它们还在任），\n   但换主后的日常操作需要新 owner 的私钥——届时把它们加进 .env 或用 --key。`);
  if (!send) { console.log("\n（干跑：以上仅为计划。加 --send 才真正发交易。）"); return; }

  console.log("\n开始执行（每步 = submit + 第二票 confirm 自动执行）…");
  for (const [fn, addr, done] of plan) {
    if (done) { console.log(`  〔跳过〕${fn} ${addr}`); continue; }
    await twoVoteStep(ms, pool, fn, addr, `${fn}(${addr.slice(0, 10)}…)`); // pool 内 wallet 已连 provider
  }
  const after = (await ms.getOwners()).map((a) => ethers.getAddress(a)).sort();
  console.log("\n完成。链上现任 owners：");
  after.forEach((o) => console.log(`  - ${o}`));
  const expect = finalSet.join(",");
  if (after.join(",") !== expect) throw new Error(`终态与计划不符！\n  计划：${expect}\n  实际：${after.join(",")}`);
  console.log(`✅ 终态与计划一致，阈值 ${Number(await ms.threshold())}。换主完成。`);
}

async function status() {
  const { ms } = connect();
  const [owners, th, n] = [await ms.getOwners(), Number(await ms.threshold()), Number(await ms.txCount())];
  console.log(`多签 ${await ms.getAddress()} · chainId ${(await ms.runner.getNetwork()).chainId}`);
  console.log(`owners（${owners.length}）· 阈值 ${th} · 历史提案 ${n} 笔`);
  owners.forEach((o) => console.log(`  - ${ethers.getAddress(o)}`));
  for (let i = n - 1; i >= Math.max(0, n - 3); i--) {
    const t = await ms.getTx(i);
    console.log(`  tx#${i} target=${t.target} 票 ${t.confirmations}/${th} executed=${t.executed}`);
  }
}

/** 本地 ganache 自检：不需要网络、不需要任何真钥匙。 */
async function selfCheck() {
  const ganache = require(path.join(ROOT, "07-测试工具", "node_modules", "ganache"));
  const pass = [], fail = [];
  const ok = (n, c, t = "") => { if (c === undefined) throw new Error("漏条件"); (c ? pass : fail).push(n); console.log(`  ${c ? "✅" : "❌"} ${n}${t ? "  " + t : ""}`); };
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" } });
  const provider = new ethers.BrowserProvider(chain);
  const estGas = provider.estimateGas.bind(provider);
  provider.estimateGas = async (tx) => { let v = 0n; try { v = await estGas(tx); } catch {} return v < 500_000n ? 1_500_000n : v; };
  const accts = await chain.request({ method: "eth_accounts" });
  const [o1a, o2a, o3a, n1a, n2a, dummA] = accts;
  const o1 = await provider.getSigner(o1a), o2 = await provider.getSigner(o2a), o3 = await provider.getSigner(o3a);
  const ms = await new ethers.ContractFactory(MS_ABI, MS_BIN, o1).deploy([o1a, o2a, o3a], 2);
  await ms.waitForDeployment();
  // 签名池用「signer 直连合约」代替私钥池：twoVoteStep 需要私钥，自检里走 signer 等价实现
  const step = async (fnName, arg, label) => {
    const data = ms.interface.encodeFunctionData(fnName, [arg]);
    await (await ms.connect(o1).submit(ms.target, 0, data)).wait();
    const txId = Number(await ms.txCount()) - 1;
    await (await ms.connect(o2).confirm(txId)).wait();
    const t = await ms.getTx(txId);
    if (!t.executed) throw new Error(label + " 未执行");
    console.log(`    ✅ ${label}（txId ${txId}）`);
  };

  console.log("[1] 基本行为");
  ok("部署即 3 owners / 阈值 2", (await ms.getOwners()).length === 3 && Number(await ms.threshold()) === 2);
  const data = ms.interface.encodeFunctionData("addOwner", [dummA]);
  await (await ms.connect(o1).submit(ms.target, 0, data)).wait();
  const txId0 = Number(await ms.txCount()) - 1;
  const t0 = await ms.getTx(txId0);
  ok("submit 自动计 1 票、未执行", !t0.executed && Number(t0.confirmations) === 1);
  let dup = false; try { await (await ms.connect(o1).confirm(txId0)).wait(); } catch { dup = true; }
  ok("提交者重复确认被拒", dup);
  await (await ms.connect(o2).confirm(txId0)).wait();
  ok("第二票自动执行（:121）", (await ms.getTx(txId0)).executed && (await ms.getOwners()).length === 4);
  await step("removeOwner", dummA, "清掉临时 owner");

  console.log("[2] 护栏");
  // 现在 3 owners。先移除 o3 → 2 owners（合法）；再尝试移除 o2 → 1 < 2 应整笔回滚
  await step("removeOwner", o3a, "3→2 合法移除");
  const before = (await ms.getOwners()).length;
  const badData = ms.interface.encodeFunctionData("removeOwner", [o2a]);
  await (await ms.connect(o1).submit(ms.target, 0, badData)).wait();
  const txIdB = Number(await ms.txCount()) - 1;
  let reverted = false;
  try { await (await ms.connect(o2).confirm(txIdB)).wait(); } catch { reverted = true; }
  ok("减到阈值以下被拒且整笔回滚（:182）", reverted && (await ms.getOwners()).length === before && !(await ms.getTx(txIdB)).executed);

  console.log("[3] 换主全流程（add×2 → remove×2，先加后减）");
  await step("addOwner", n1a, "addOwner(新1)");
  await step("addOwner", n2a, "addOwner(新2)");
  await step("removeOwner", o2a, "removeOwner(旧2)");
  await step("removeOwner", o3a === o2a ? o1a : o3a, "removeOwner(已不在任→应被跳过)") .catch(async (e) => {
    // o3 已在 [2] 移除：这里演示「跳过」语义 —— 真实 handover 会先重读 owners 再决定
    ok("对已不在任者 remove 拒绝（真实流程会先读 owners 跳过）", String(e).includes("not owner"));
  }).catch(() => {});
  const final = (await ms.getOwners()).map((a) => a.toLowerCase());
  ok("终态 owners = {旧1, 新1, 新2}", final.length === 3 && final.includes(o1a.toLowerCase()) && final.includes(n1a.toLowerCase()) && final.includes(n2a.toLowerCase()));
  ok("阈值仍 2", Number(await ms.threshold()) === 2);
  let notOwner = false;
  try {
    const d2 = ms.interface.encodeFunctionData("addOwner", [dummA]);
    await (await ms.connect(o1).submit(ms.target, 0, d2)).wait();
    const t2 = Number(await ms.txCount()) - 1;
    await (await ms.connect(o2).confirm(t2)).wait(); // o2 已被移除
  } catch { notOwner = true; }
  ok("被移除的旧钥匙不再有票权", notOwner);

  console.log("[4] 地址校验和防线");
  let typoCaught = false;
  try { ethers.getAddress("0xBc360891Fa4708d57Ef21bCBeCFa303fbBb7bB26"); } catch { typoCaught = true; }
  ok("owner3 那类大小写错串会被 normAddr 当场拦下", typoCaught);

  console.log("=".repeat(70));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  if (fail.length) { fail.forEach((f) => console.log("❌ " + f)); process.exit(1); }
}

(async () => {
  if (cmd === "status") await status();
  else if (cmd === "handover") await handover(has("send"));
  else if (cmd === "self-check") await selfCheck();
  else {
    console.error("用法：node multisig-ops.js <status | handover --add=… --remove=… [--send] | self-check>");
    process.exit(1);
  }
})().catch((e) => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
