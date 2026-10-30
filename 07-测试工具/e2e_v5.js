/**
 * e2e_v5.js —— v5（全国区域版）冒烟：注册区域 → 批量喂价 → 义乌（县级市）投保 →
 *              批量判定 → 理赔 → 未注册区域拒保 → 批量判定对非 operator 拒绝。
 * 要证的三件事：
 *   ① 行政区划码（uint32）全链路可用，县级市与地级市无差别；
 *   ② updateRainfallBatch / submitJudgements 批量入口语义与单条一致（失败整笔回滚）；
 *   ③ 未注册区域在投保/喂价/定价三处都被挡住。
 */
const path = require("path");
const fs = require("fs");
const ganache = require("ganache");
const { ethers } = require("ethers");
const SOL_DIR = path.join(__dirname, "..", "03-合约");
const rd = n => fs.readFileSync(path.join(SOL_DIR, n), "utf8");
const T_ABI = JSON.parse(rd("RainToken.abi.json")), T_BIN = rd("RainToken.bytecode.txt").trim();
const ABI = JSON.parse(rd("RainDeliveryInsuranceV5.abi.json")), BIN = rd("RainDeliveryInsuranceV5.bytecode.txt").trim();

const pass = [], fail = [];
const ok = (n, c, t = "") => { if (c === undefined) throw new Error("ok() 漏条件：" + n); (c ? pass : fail).push(n); console.log(`  ${c ? "✅" : "❌"} ${n}${t ? "  " + t : ""}`); };
async function expectRevert(n, callable, keyword) {
  try { await callable(); ok(n, false, "本该失败却成功"); }
  catch (e) { const m = [e.shortMessage, e.reason, e.message].filter(Boolean).join(" | "); ok(n, !keyword || m.includes(keyword), `已拒绝（${keyword || m.slice(0, 50)}）`); }
}
const CODE = { 武汉: 420100, 上海: 310100, 义乌: 330782, 未开通: 654321 };

(async () => {
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" } });
  const provider = new ethers.BrowserProvider(chain);
  const est = provider.estimateGas.bind(provider);
  provider.estimateGas = async (tx) => { let v = 0n; try { v = await est(tx); } catch {} return v < 500_000n ? 2_000_000n : v; };
  const accts = await chain.request({ method: "eth_accounts" });
  const [opA, riderA] = accts;
  const op = await provider.getSigner(opA), rider = await provider.getSigner(riderA);
  const tok = await (await new ethers.ContractFactory(T_ABI, T_BIN, op).deploy()).waitForDeployment();
  const v5 = await (await new ethers.ContractFactory(ABI, BIN, op).deploy(await tok.getAddress())).waitForDeployment();
  const EV = ethers.id("e2e-v5");
  const v5R = v5.connect(rider), tokR = tok.connect(rider);

  console.log("[1] 区域注册（运营方）");
  await (await v5.registerRegion(CODE.武汉, "武汉市")).wait();
  await (await v5.registerRegion(CODE.上海, "上海市")).wait();
  await (await v5.registerRegion(CODE.义乌, "义乌市")).wait();   // 县级市
  ok("regionCount=3（含县级市）", (await v5.regionCount()) === 3n);
  ok("regions(义乌).active=true", (await v5.regions(CODE.义乌))[1] === true);

  console.log("[2] 未注册区域三处全挡");
  await expectRevert("未注册区域投保拒", () => v5R.buyPolicy.staticCall(CODE.未开通, 12), "region not available");
  await expectRevert("未注册区域喂价拒", () => v5.updateRainfall.staticCall(CODE.未开通, 1, EV, 80, 3), "region not available");
  await expectRevert("未注册区域设价拒", () => v5.setPremiumGrid.staticCall(CODE.未开通, 12, 500, EV), "region not available");

  console.log("[3] 批量喂价");
  await (await v5.setPremiumGrid(CODE.义乌, 24, 500, EV)).wait();   // 义乌 24h 5.00 元（兜底演示价）
  await (await v5.updateRainfallBatch(
    [CODE.武汉, CODE.上海, CODE.义乌], [67n, 172n, 12n], [EV, EV, EV], [84, 84, 80], [3, 3, 3])).wait();
  ok("批量后 义乌=12mm", (await v5.rainfall(CODE.义乌)) === 12n);
  ok("批量后 上海=172mm", (await v5.rainfall(CODE.上海)) === 172n);
  const b = v5.interface.encodeFunctionData("updateRainfallBatch", [[CODE.上海], [100n], [EV], [80], [3]]);
  await (await v5.updateRainfall(CODE.上海, 172n, EV, 84, 3)).wait();   // 保持上海不变
  await expectRevert("批量里有一格倒退 → 整笔回滚", () => v5.updateRainfallBatch.staticCall([CODE.上海], [171n], [EV], [80], [3]), "cumulative must not decrease");

  console.log("[4] 县级市投保 + 批量判定 + 理赔");
  await (await v5.setCoolingPeriod(0)).wait();
  await (await tok.mint(riderA, 10_000n)).wait();
  await (await tok.mint(opA, 1_000_000n)).wait();
  await (await tok.approve(await v5.getAddress(), 500_000n)).wait();
  await (await v5.fundPool(500_000n)).wait();               // 池子（赔付资金来源）
  await (await tokR.approve(await v5.getAddress(), 500n)).wait();
  await (await v5R.buyPolicy(CODE.义乌, 24)).wait();
  const p0 = await v5.policies(0);
  ok("保单0：义乌 24h · 保费500分 · 档线50mm", p0.regionId === BigInt(CODE.义乌) && p0.premium === 500n && p0.thresholdMm === 50n);
  await (await v5.updateRainfall(CODE.义乌, 68n, EV, 84, 3)).wait();    // 增量 56mm ≥ 50
  // 批量判定（这里只有 1 份，但走批量入口验证语义）
  await (await v5.submitJudgements([0n], [1], [80], [3], [68n], [EV], [EV], ["v5-smoke"])).wait();
  const due = await v5.payoutOf(0);
  ok("批量判定后 payoutOf=5000（50 元）", due === 5000n);
  await (await v5R.claim(0)).wait();
  ok("骑手到账 5000 分", (await tok.balanceOf(riderA)) === 10_000n - 500n + 5000n);
  await expectRevert("批量判定同一保单第二次要拒", () => v5.submitJudgements.staticCall([0n], [1], [80], [3], [68n], [EV], [EV], ["x"]), "judgement already submitted");

  console.log("[5] 长度不齐防护");
  await expectRevert("批量喂价数组长度不齐要拒", () => v5.updateRainfallBatch.staticCall([CODE.武汉], [67n, 67n], [EV], [80], [3]), "array length mismatch");
  await expectRevert("批量判定数组长度不齐要拒", () => v5.submitJudgements.staticCall([1n], [1], [80], [3], [68n], [EV], [EV], ["a", "b"]), "array length mismatch");

  // ───────────────────────────────────────────────────────────────────────────
  // 2026-10-26 补测：状态机与守卫（原来 14 项只覆盖 happy path，改合约时没有回归网）。
  // 契约事实（源码 RainDeliveryInsuranceV5.sol）：_judge 放开置信度，但 claim 会卡；
  // 敞口上限 MAX_OPEN_EXPOSURE_PER_RIDER=20000 分 = 2 张满额保单；refundPolicy 只在冷却期内可退。
  console.log("[6] 喂价的脏数据守卫");
  const minConf = Number(await v5.MIN_CONFIDENCE());
  await expectRevert("置信度低于 MIN_CONFIDENCE 的喂价要拒",
    () => v5.updateRainfall.staticCall(CODE.武汉, 70n, EV, minConf - 1, 3), "feed confidence too low");
  await expectRevert("证据哈希为 0 的喂价要拒",
    () => v5.updateRainfall.staticCall(CODE.武汉, 70n, ethers.ZeroHash, 84, 3), "evidence required");

  console.log("[7] 保单状态机：未判定 / 判不赔 / 低置信 都不能 claim");
  await (await tokR.approve(await v5.getAddress(), 10_000n)).wait();
  const idPending = Number(await v5.nextPolicyId());
  await (await v5R.buyPolicy(CODE.义乌, 12)).wait();
  ok("新保单状态 = active（冷却期已置 0）", (await v5.policyStatus(idPending)) === "active");
  await expectRevert("未判定的保单 claim 要拒", () => v5R.claim.staticCall(idPending), "no AI judgement");
  // 先灌一条「判赔但置信度只有 10」的判定：合约允许写入，但 claim 必须被卡住（这是 AI 规则与合约的接缝）
  const ywRain = await v5.rainfall(CODE.义乌);
  await (await v5.submitJudgement(idPending, 1, 10, 3, ywRain, EV, EV, "low-conf-pay")).wait();
  // 注意 policyStatus 的顺序：窗口增量未达档线时一律 "active"，不看判定；
  // 所以「低置信」这个状态只在增量已过档后才会露出来 —— 这里先验判定本身被写上链了。
  ok("低置信判定确实写进了 judgements（置信 10）", (await v5.judgements(idPending)).confidence === 10n);
  await expectRevert("低置信判定的 claim 要拒", () => v5R.claim.staticCall(idPending), "AI: low confidence");

  console.log("[8] 冷却期 > 0 时买完是 pending，冷却期内可退款");
  await (await v5.setCoolingPeriod(3600)).wait();
  const idCool = Number(await v5.nextPolicyId());
  const expoBefore = await v5.openExposure();
  await (await v5R.buyPolicy(CODE.上海, 12)).wait();
  ok("冷却期内状态 = pending", (await v5.policyStatus(idCool)) === "pending");
  ok("买入后敞口增加", (await v5.openExposure()) > expoBefore);
  await expectRevert("冷却期内 claim 要拒", () => v5R.claim.staticCall(idCool), "not yet effective");
  await (await v5R.refundPolicy(idCool)).wait();
  // 已知缺陷（v6 修）：policyStatus() 没有 refunded/settled 分支，退款后仍返回 "pending"，
  // 只靠 policies(id).settled 才能看出已退款。页面因此要自己读 settled 覆盖状态（rider.html 已这样做）。
  ok("退款后 settled=true（policyStatus 仍是 pending —— v6 待修）",
     (await v5.policies(idCool)).settled === true && (await v5.policyStatus(idCool)) === "pending");
  ok("退款后敞口收回", (await v5.openExposure()) === expoBefore);
  await (await v5.setCoolingPeriod(0)).wait();

  console.log("[9] 喂价过期后不再接单（MAX_FEED_AGE 硬门禁）");
  const riderB = await provider.getSigner(accts[2]);   // 新骑手：绕开敞口上限（accts[2] 自带 gas）
  await (await tok.mint(accts[2], 10_000n)).wait();
  await (await tok.connect(riderB).approve(await v5.getAddress(), 10_000n)).wait();
  const feedAge = Number(await v5.MAX_FEED_AGE());
  await chain.request({ method: "evm_increaseTime", params: [feedAge + 60] });
  await chain.request({ method: "evm_mine", params: [] });
  await expectRevert("喂价过期后 buyPolicy 要拒", () => v5.connect(riderB).buyPolicy.staticCall(CODE.上海, 12), "stale feed");
  const shRain = await v5.rainfall(CODE.上海);
  await (await v5.updateRainfallBatch([CODE.上海], [shRain], [EV], [84], [3])).wait();   // 同值保鲜
  await (await v5.connect(riderB).buyPolicy(CODE.上海, 12)).wait();
  ok("同值保鲜后又能接单（cumulative 不降即可）", true);

  console.log("[10] 到期结算释放敞口");
  const idExpire = Number(await v5.nextPolicyId());
  await (await v5.connect(riderB).buyPolicy(CODE.上海, 12)).wait();
  const expo2 = await v5.openExposure();
  await expectRevert("未到期不能结算", () => v5.settleExpired.staticCall([idExpire]), "policy not expired yet");
  await chain.request({ method: "evm_increaseTime", params: [12 * 3600 + 60] });
  await chain.request({ method: "evm_mine", params: [] });
  ok("到期后状态 = expired", (await v5.policyStatus(idExpire)) === "expired");
  await (await v5.settleExpired([idExpire])).wait();
  ok("结算后敞口释放 100 元", (await v5.openExposure()) === expo2 - 10_000n);

  console.log("[11] premiumOf 参数口径（v5 已知限制：批发三参数未实现）");
  const p2 = await v5.premiumOf(CODE.义乌, 24), p5 = await v5.premiumOf(CODE.义乌, 24, 0, 0, 1);
  ok("premiumOf(2 参) == premiumOf(5 参)", p2 === p5, `${p2} / ${p5}`);
  const q2p = await v5.premiumOf(CODE.义乌, 24, 1, 1, 100);
  ok("riderTier/channel/count 不改变价格（v6 才实现批发价）", p2 === q2p, `${p2} / ${q2p}`);
  const [qAmt, qOk] = await v5.quoteOf(CODE.义乌, 24, 0, 0, 1);
  ok("quoteOf 与 premiumOf 同价且可承保", qAmt === p2 && qOk === true);
  ok("档位比例 tierBps(0)=50% / (1)=75%", (await v5.tierBps(0)) === 5000n && (await v5.tierBps(1)) === 7500n);
  await expectRevert("不存在的档位 tierBps(2) 要拒", () => v5.tierBps.staticCall(2), "bad tier");
  ok("档线阈值 12h: 30/70mm", (await v5.thresholdOf(12, 0)) === 30n && (await v5.thresholdOf(12, 1)) === 70n);
  ok("档线阈值 24h: 50/100mm", (await v5.thresholdOf(24, 0)) === 50n && (await v5.thresholdOf(24, 1)) === 100n);

  console.log("=".repeat(70));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  if (fail.length) process.exit(1);
})().catch(e => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
