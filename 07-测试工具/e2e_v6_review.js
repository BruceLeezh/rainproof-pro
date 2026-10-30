"use strict";
// In-process chain only: no wallet files, external RPC or deployed state.
// 注意：这个文件在忙的 Windows 上会偶发两类环境抖动（不是产品缺陷）：① ganache 的 uws 原生模块
// 被上一次运行的残留进程占住，报 Cannot find module '../binaries/uws_win32_x64_137.node'；
// ② 瞬时 revert（2026-10-29 实测 7 次里 1 次）。所以 package.json 的 e2e:v6-review 写成
// 「失败再跑一次」——真有回归时两次都会红。
const fs = require("fs"), path = require("path"), solc = require("solc"), ganache = require("ganache");
const assert = require("node:assert/strict"), { ethers } = require("ethers");
const dir = path.join(__dirname, "../03-合约");
let count = 0;
const ok = (name, condition) => { assert(condition, name); count++; console.log("OK " + name); };
async function reject(name, fn, reason) { await assert.rejects(fn, error => String(error).includes(reason)); count++; console.log("OK " + name); }
(async () => {
  const sources = Object.fromEntries(["RainDeliveryInsuranceV6.sol", "RainToken.sol"].map(f => [f, { content: fs.readFileSync(path.join(dir, f), "utf8") }]));
  const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } })));
  assert.equal((output.errors || []).filter(e => e.severity === "error").length, 0, JSON.stringify(output.errors));
  const artifact = name => output.contracts[name + ".sol"][name];
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" } });
  const p = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: 0 }); p.pollingInterval = 10;
  try {
    const op = await p.getSigner(0), rider = await p.getSigner(1), stranger = await p.getSigner(2);
    async function deploy(name, args = []) { const a = artifact(name); return (await new ethers.ContractFactory(a.abi, a.evm.bytecode.object, op).deploy(...args)).waitForDeployment(); }
    const token = await deploy("RainToken"), insurance = await deploy("RainDeliveryInsuranceV6", [await token.getAddress()]);
    const target = await insurance.getAddress(), r = insurance.connect(rider), H = ethers.id("review-evidence");
    const tx = async value => (await value).wait();
    const feed = mm => insurance.updateRainfall(420100, mm, H, 90, 3);
    ok("V6 runtime under EIP-170", artifact("RainDeliveryInsuranceV6").evm.deployedBytecode.object.length / 2 <= 24576);
    await reject("unknown region cannot be activated", () => insurance.setRegionActive.staticCall(654321, true), "unknown region");
    await tx(insurance.registerRegion(420100, "武汉"));
    await tx(insurance.setRegionActive(420100, false)); await tx(insurance.setRegionActive(420100, true));
    ok("reactivation counts exactly once", await insurance.regionCount() === 1n);
    await tx(insurance.setRegionActive(420100, true)); ok("idempotent activation", await insurance.regionCount() === 1n);
    await reject("configuration requires paused sales", () => insurance.configureRegions.staticCall([310100], ["上海"], [420], [530], H), "pause before configuration");
    await tx(insurance.setPaused(true));
    await reject("configuration rejects misaligned arrays", () => insurance.configureRegions.staticCall([310100], [], [420], [530], H), "array length mismatch");
    await reject("configuration rejects invalid premiums", () => insurance.configureRegions.staticCall([310100], ["上海"], [0], [530], H), "premium out of range");
    await tx(insurance.configureRegions([310100], ["上海"], [420], [530], H));
    ok("configuration writes region and two prices", (await insurance.regions(310100)).active && await insurance.premiumOf(310100,12) === 420n && await insurance.premiumOf(310100,24) === 530n);
    await tx(insurance.setPaused(false));
    await reject("cooling baseline cannot include unprotected rain", () => insurance.setCoolingPeriod.staticCall(3600), "time-series baseline");
    await reject("missing quorum rejected", () => insurance.updateRainfall.staticCall(420100, 0, H, 90, 1), "insufficient sources");
    await reject("abnormal increment rejected", () => insurance.updateRainfall.staticCall(420100, 501, H, 90, 3), "increment exceeds guard");
    const receipt = await tx(feed(0));
    const logsOf = (receipt, name) => receipt.logs.filter(l => { try { return insurance.interface.parseLog(l).name === name; } catch { return false; } });
    ok("single feed emits one event", logsOf(receipt, "RainfallUpdated").length === 1);
    await tx(token.mint(await rider.getAddress(), 20000)); await tx(token.connect(rider).approve(target, 20000));
    await reject("new exposure cannot exceed funded capacity", () => r.buyPolicy.staticCall(420100, 12), "underwriting capacity");
    await tx(token.mint(await op.getAddress(), 100000)); await tx(token.approve(target, 100000)); await tx(insurance.fundPool(100000));
    await tx(r.buyPolicy(420100, 12)); await tx(r.buyPolicy(420100, 24));
    await tx(feed(30));
    const verdict = await tx(insurance.submitJudgement(0, 1, 90, 3, 30, H, H, "review"));
    ok("single judgement emits one event", logsOf(verdict, "JudgementSubmitted").length === 1);
    await tx(feed(70));
    ok("status uses pinned judgement reading", await insurance.policyStatus(0) === "claimable");
    ok("later rain does not increase pinned payout", await insurance.payoutOf(0) === 5000n);
    await reject("foreign caller cannot judge", () => insurance.connect(stranger).submitJudgement.staticCall(1, 1, 90, 3, 70, H, H, "x"), "not operator");
    await tx(insurance.settleExpired([0, 1])); ok("mixed not-due batch safely skips", await insurance.openExposure() === 20000n);
    await chain.request({ method: "evm_increaseTime", params: [12 * 3600 + 60] }); await chain.request({ method: "evm_mine", params: [] });
    await tx(insurance.settleExpired([0, 1])); ok("unclaimed exposure protected during grace", !(await insurance.policies(0)).settled);
    const before = await token.balanceOf(await rider.getAddress());
    await tx(insurance.connect(stranger).claim(0));
    ok("timely PAY can be claimed after coverage ends", (await token.balanceOf(await rider.getAddress())) - before === 5000n);
    await reject("double payout prevented", () => r.claim.staticCall(0), "already paid");
    await chain.request({ method: "evm_increaseTime", params: [8 * 86400] }); await chain.request({ method: "evm_mine", params: [] });
    await tx(insurance.settleExpired([0, 1])); ok("expired unresolved exposure eventually released", await insurance.openExposure() === 0n);
    ok("settled status no longer appears active", await insurance.policyStatus(1) === "settled");
    console.log(`V6 local E2E: ${count} checks passed (isolated chain)`);
  } finally { p.destroy(); await chain.disconnect(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
