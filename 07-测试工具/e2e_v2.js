/**
 * v2 本地全流程演练：把 RainDeliveryInsuranceV2 在本地链上真跑一遍。
 *
 * 目标不是"能部署"，而是"把 BOT Chain 主网部署当天会炸的地方提前炸出来"。
 * v2 的九项改动（A1 保费网格 / A3 限购 / A4 冷静期 / A4b 喂价新鲜度 / A5 sources 上链 /
 * A6 在保敞口 / A7 国标分档 / A8 白名单 / A9 productId）每一条都要有断言，
 * 否则"改了"只是我写在文档里的话。
 *
 * 用法：NODE_PATH=<workspace>/node_modules node e2e_v2.js [合约目录]
 */
const path = require("path");
const fs = require("fs");
const ganache = require("ganache");
const { ethers } = require("ethers");

const SOL_DIR = process.argv[2] || path.join(__dirname, "..", "03-合约");
const ABI = JSON.parse(fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsuranceV2.abi.json"), "utf8"));
const BIN = fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsuranceV2.bytecode.txt"), "utf8").trim();

const pass = [], fail = [];
// ★ A36：ok() 必须收到**真条件**（第 2 参）。老写法 ok("标签") / ok("标签","说明") 只推标签、恒绿，
//   等于没断言。第 3 参才是可选的说明文字。
const ok = (n, cond, txt = "") => {
  if (cond === undefined) throw new Error(`ok() 漏传条件（A36）：${n}`);
  if (cond) { pass.push(n); console.log(`  ✅ ${n}${txt ? "  " + txt : ""}`); }
  else bad(n, "条件为假（A36）");
};
const bad = (n, why) => { fail.push(`${n} (${why})`); console.log(`  ❌ ${n}  ← ${why}`); };

async function expectRevert(name, callable, keyword) {
  try {
    const r = await callable();
    // ★ 有的调用点给的是「已发出、尚未等待」的交易（ethers 在估算 gas 通过后就把 promise 兑现了），
    //   真正的 revert 要等 wait() 才抛出来。这里统一等到收据，否则断言会假通过。
    if (r && typeof r.wait === "function") await r.wait();
    bad(name, "本该失败，却成功了");
  } catch (e) {
    const msg = [e.shortMessage, e.reason, e.message,
                 e.info && e.info.error && e.info.error.message, e.data]
                .filter(Boolean).join(" | ");
    const hit = !keyword || msg.includes(keyword);
    if (!keyword) return ok(name, hit, `已拒绝（${msg.slice(0, 70)}）`);
    if (hit) ok(name, hit, `已拒绝（${keyword}）`);
    else bad(name, `期望含「${keyword}」，实际：${msg.slice(0, 140)}`);
  }
}

const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const eth = (w) => ethers.formatEther(w);

(async () => {
  console.log("=".repeat(78));
  console.log("本地链全流程演练 · RainDeliveryInsuranceV2");
  console.log("=".repeat(78));

  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" } });
  const provider = new ethers.BrowserProvider(chain);

  // ★ ganache 两个坑，都是本地 harness 的、真链不存在：
  //   ① eth_estimateGas 会拿**偏早/偏晚**的块时间戳去模拟，于是"喂价明明新鲜"也会被判成 stale feed
  //      （实测：同一状态 eth_call 成功、estimateGas 报 stale feed）。
  //   ② eth_estimateGas 偶尔**低估**：实测 updateRainfall 只给 gasLimit=50519，交易上链后把
  //      50,519 gas 全部烧光才 revert（out-of-gas，收据里没有 reason），而同一状态 eth_call 却成功。
  //   对策：估算失败 → 固定宽裕值；估算成功但偏低 → 抬到 150 万（高估值保留，如 settleExpired）。
  //   交易仍由 EVM 裁决，真实 require 失败照样在 tx.wait() 抛出，gasUsed 也照实打印，不会盖住合约缺陷。
  const estGas = provider.estimateGas.bind(provider);
  provider.estimateGas = async (tx) => {
    let v = 0n;
    try { v = await estGas(tx); }
    catch (e) { console.log(`     [gas 兜底] 估算失败：${e.shortMessage || e.message}`); }
    return v < 500_000n ? 1_500_000n : v;
  };

  // ★ 余额必须用裸 RPC 读：ethers v6 的 getBalance 有 250ms 结果缓存，实测会掩盖到账。
  const rawBal = async (addr) =>
    BigInt(await chain.request({ method: "eth_getBalance", params: [addr, "latest"] }));

  const accts = await chain.request({ method: "eth_accounts" });
  const [opAddr, rA, rB, rC, rD, rE, rF] = accts;
  const operator = await provider.getSigner(opAddr);
  const a = await provider.getSigner(rA);
  const b = await provider.getSigner(rB);
  const cc = await provider.getSigner(rC);
  const d = await provider.getSigner(rD);
  // ★ A3 的笔数闸门是「每个地址终身计数」（_byRider 只增不减），所以 a/b/cc/d 跑完前面的用例都到顶了；
  //   要单独验证「敞口闸门」和「白名单闸门」，必须用没买过的新地址。
  const e = await provider.getSigner(rE);
  const f = await provider.getSigner(rF);

  // 时间旅行：A4 冷静期 / A4b 新鲜度 / A6 到期结算都要用它。
  // ★ 用 evm_setTime（绝对时间）而不是 evm_increaseTime（相对漂移）：
  //   实测 increaseTime 之后 ganache 的 eth_call/estimateGas 会用一个偏早的时间戳模拟，
  //   甚至后续区块时间会倒退（合约里的 `block.timestamp - lastFeedAt` 直接下溢成 stale feed）。
  //   绝对时间只前进不后退，所有路径看到的是同一个时钟。
  const advance = async (secs) => {
    const blk = await chain.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
    const target = (Number(blk.timestamp) + secs) * 1000; // evm_setTime 收毫秒
    await chain.request({ method: "evm_setTime", params: [target] });
    await chain.request({ method: "evm_mine", params: [] });
    const now = await chain.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
    return BigInt(now.timestamp);
  };

  // ---------- 0 部署 ----------
  console.log("\n[0] 部署");
  const c = await new ethers.ContractFactory(ABI, BIN, operator).deploy();
  await c.waitForDeployment();
  const addr = await c.getAddress();
  ok("部署成功", addr.length === 42 && (await provider.getCode(addr)) !== "0x", addr);
  const code = await provider.getCode(addr);
  // 期望值从编译旁车文件读（compile_sol.js 写），不写死魔数
  const wantRuntime = Number(fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsuranceV2.runtime-size.txt"), "utf8").trim());
  console.log(`     链上代码长度 = ${(code.length - 2) / 2} 字节（编译报告 ${wantRuntime}）`);
  ok("部署后链上代码长度与编译报告一致", (code.length - 2) / 2 === wantRuntime,
     `链上 ${(code.length - 2) / 2} 字节 / 编译报告 ${wantRuntime} 字节`);

  const PAYOUT_MAX = await c.PAYOUT_MAX();
  const MIN_PREMIUM = await c.MIN_PREMIUM();
  const MIN_CONF = await c.MIN_CONFIDENCE();
  const MAX_AGE = await c.MAX_FEED_AGE();
  const MAX_N = await c.MAX_POLICIES_PER_RIDER();
  const MAX_EXP = await c.MAX_OPEN_EXPOSURE_PER_RIDER();
  console.log(`     PAYOUT_MAX=${eth(PAYOUT_MAX)}  MIN_PREMIUM=${eth(MIN_PREMIUM)}  MIN_CONFIDENCE=${MIN_CONF}`);
  const thr24 = await c.THRESHOLD_PER_24H();
  ok("THRESHOLD_PER_24H = 50（国标暴雨下限）", thr24 === 50n, String(thr24));
  ok("MAX_FEED_AGE = 24 小时", MAX_AGE === 86400n, String(MAX_AGE));
  const cooling0 = await c.coolingPeriod();
  ok("coolingPeriod 默认 = 3 天（259200 秒）", cooling0 === 259200n, String(cooling0));
  const elig0 = await c.eligibleRequired();
  ok("eligibleRequired 默认 = false（演示不拦人）", elig0 === false, String(elig0));
  ok("限购常量：3 笔 / 0.02 ETH 在保敞口", MAX_N === 3n && MAX_EXP === ethers.parseEther("0.02"),
     `${MAX_N} 笔 / ${eth(MAX_EXP)} ETH`);

  // 喂价辅助：cumulative 单调不减，所以这里自己记着每个区的水位
  const water = {};
  async function feed(region, mm, confidence = 90, sources = 3, tag = "") {
    const next = BigInt(Math.max(Number(water[region] || 0n), Number(mm)));
    water[region] = next;
    return c.connect(operator).updateRainfall(region, next, H(`snapshot:${region}:${next}:${tag}`), confidence, sources);
  }
  const need = (region, hours) => c.premiumOf(region, hours);

  // ---------- 1 A7：纯函数分档（不花 gas，任何人可复算）----------
  console.log("\n[1] A7 赔付分档 —— 国标三级 × 窗口缩放，纯链上函数");
  const T = { none: 255n, t0: 0n, t1: 1n, t2: 2n };
  const cases = [
    ["thresholdOf(24) = 50",   await c.thresholdOf(24), 50n],
    ["thresholdOf(48) = 100",  await c.thresholdOf(48), 100n],
    ["thresholdOf(72) = 150",  await c.thresholdOf(72), 150n],
    ["49mm/24h 未达档",        await c.tierOf(49, 24),  T.none],
    ["50mm/24h = 暴雨档",      await c.tierOf(50, 24),  T.t0],
    ["99mm/24h 仍是暴雨档",    await c.tierOf(99, 24),  T.t0],
    ["100mm/24h = 大暴雨档",   await c.tierOf(100, 24), T.t1],
    ["249mm/24h 仍是大暴雨",   await c.tierOf(249, 24), T.t1],
    ["250mm/24h = 特大暴雨档", await c.tierOf(250, 24), T.t2],
    ["100mm/48h = 暴雨档",     await c.tierOf(100, 48), T.t0],
    ["150mm/72h = 暴雨档",     await c.tierOf(150, 72), T.t0],
    ["300mm/72h = 大暴雨档",   await c.tierOf(300, 72), T.t1],
    ["750mm/72h = 特大暴雨档", await c.tierOf(750, 72), T.t2],
    // ★ 这一条就是 P1-2「期限套利」的修复证据：同样 50mm，24h 档赔、72h 档不赔
    ["50mm/72h 不达档（期限套利已封）", await c.tierOf(50, 72), T.none],
  ];
  for (const [name, got, want] of cases) {
    ok(name, BigInt(got) === BigInt(want), `got=${got} / want=${want}`);
  }
  const bps = [await c.tierBps(0), await c.tierBps(1), await c.tierBps(2)];
  ok("档位赔付比例 = 50% / 75% / 100%", bps.join(",") === "5000,7500,10000", bps.join(" / "));
  const hAllow = { 24: await c.hoursAllowed(24), 36: await c.hoursAllowed(36), 48: await c.hoursAllowed(48), 72: await c.hoursAllowed(72) };
  ok("hoursAllowed：只放 24/48/72（v2 口径）", hAllow[24] && hAllow[48] && hAllow[72] && !hAllow[36],
     `24=${hAllow[24]} 48=${hAllow[48]} 72=${hAllow[72]} 36=${hAllow[36]}`);

  // ---------- 2 A4b 喂价新鲜度 ----------
  console.log("\n[2] A4b 喂价新鲜度 —— 没喂过价不许投保（真链上踩过的坑）");
  await expectRevert("没喂过价就投保要拒绝",
    async () => c.connect(a).buyPolicy.staticCall(1, 24, { value: await need(1, 24) }), "stale feed");
  const fj1Before = (await c.feedJudgements(1)).exists;
  await (await feed(1, 0, 90, 3, "baseline")).wait();
  ok("先喂一次价（哪怕 0mm）", !fj1Before && (await c.feedJudgements(1)).exists,
     "(1, 0mm) 已上链：feedJudgements[1] 从无到有");
  await (await c.connect(a).buyPolicy(1, 24, { value: await need(1, 24) })).wait();
  const idA0 = (await c.nextPolicyId()) - 1n;
  ok("喂价后投保成功", (await c.policies(idA0)).windowHours === 24n, `policy #${idA0}`);
  await advance(25 * 3600);
  await expectRevert("喂价超过 24h 后投保要拒绝（基线会陈旧）",
    async () => c.connect(b).buyPolicy.staticCall(1, 24, { value: await need(1, 24) }), "stale feed");
  await (await feed(1, 0, 90, 3, "refresh")).wait();
  await (await c.connect(b).buyPolicy(1, 24, { value: await need(1, 24) })).wait();
  const idB0 = (await c.nextPolicyId()) - 1n;
  ok("重新喂价后又可以投保", (await c.policies(idB0)).windowHours === 24n, `policy #${idB0}`);

  // ---------- 3 A4 冷静期 ----------
  console.log("\n[3] A4 冷静期 —— 生效前不许索赔，状态显示 pending");
  const st0 = await c.policyStatus(0);
  ok("冷静期内状态 = pending", st0 === "pending", st0);
  await expectRevert("冷静期内索赔要拒绝",
    async () => c.connect(a).claim.staticCall(0), "not yet effective");
  await (await c.connect(operator).setCoolingPeriod(0)).wait();
  const cooling1 = await c.coolingPeriod();
  ok("operator 把冷静期改成 0（演示口径）", cooling1 === 0n, `coolingPeriod=${cooling1}`);
  await expectRevert("非 operator 改冷静期要拒绝",
    async () => c.connect(a).setCoolingPeriod.staticCall(0), "not operator");
  await (await c.connect(cc).buyPolicy(1, 24, { value: await need(1, 24) })).wait();
  const stC = await c.policyStatus(2);
  ok("冷静期 0 时新保单立刻 active", stC === "active", stC);

  // ---------- 4 A1 保费网格 ----------
  console.log("\n[4] A1 保费网格（区域 × 时长）+ 保费地板");
  const pDefault = await c.premiumOf(1, 24);
  const pDefOnChain = await c.PREMIUM_DEFAULT();
  ok("未设网格时回退到 PREMIUM_DEFAULT", pDefault === pDefOnChain && pDefault > 0n,
     `${eth(pDefault)} ETH / PREMIUM_DEFAULT=${eth(pDefOnChain)} ETH`);
  await (await c.connect(operator).setPremiumGrid(1, 24, ethers.parseEther("0.0008"), H("actuary:1:24"))).wait();
  const grid124 = await c.premiumOf(1, 24);
  ok("setPremiumGrid 后 24h 档 = 0.0008", grid124 === ethers.parseEther("0.0008"),
     `${eth(grid124)} ETH（72h 档仍未设 → 仍走区域基准价）`);
  await expectRevert("低于保费地板的网格价要拒绝",
    async () => c.connect(operator).setPremiumGrid.staticCall(1, 48, ethers.parseEther("0.00005"), H("too-low")), "premium out of range");
  await expectRevert("非 24/48/72 的网格价要拒绝",
    async () => c.connect(operator).setPremiumGrid.staticCall(1, 36, ethers.parseEther("0.001"), H("h36")), "hours must be 24/48/72");
  await expectRevert("非 operator 设网格价要拒绝",
    async () => c.connect(a).setPremiumGrid.staticCall(1, 48, ethers.parseEther("0.001"), H("x")), "not operator");
  // 区域基准价低于地板 → 抬到地板
  await (await c.connect(operator).setUnderwriting(2, await c.RISK_NORMAL(), ethers.parseEther("0.00005"), H("uw:2"))).wait();
  const floored = await c.premiumOf(2, 24);
  ok("区域价低于地板时抬到 MIN_PREMIUM", floored === MIN_PREMIUM && MIN_PREMIUM > 0n,
     `${eth(floored)} ETH / MIN_PREMIUM=${eth(MIN_PREMIUM)} ETH`);
  await expectRevert("保费金额不对要拒绝",
    async () => c.connect(d).buyPolicy.staticCall(1, 24, { value: 1n }), "premium mismatch");
  await expectRevert("非 24/48/72 的时长要拒绝",
    async () => c.connect(d).buyPolicy.staticCall(1, 36, { value: await need(1, 36) }), "hours must be 24/48/72");
  await expectRevert("非法区域要拒绝",
    async () => c.connect(d).buyPolicy.staticCall(9, 24, { value: 1n }), "bad region");
  const SUSPENDED = await c.RISK_SUSPENDED();
  const pSusp = await need(3, 24);
  await expectRevert("被承保人拒保的区域要拒绝",
    async () => {
      await (await c.connect(operator).setUnderwriting(3, SUSPENDED, ethers.parseEther("0.001"), H("uw:3"))).wait();
      return c.connect(d).buyPolicy.staticCall(3, 24, { value: pSusp });
    }, "region suspended");

  // ---------- 5 A7 分档赔付（三档各真赔一笔）----------
  console.log("\n[5] A7 分档赔付 —— 三档各走一遍真赔付");
  const poolBeforeFund = await c.poolBalance();
  await (await c.connect(operator).fundPool({ value: ethers.parseEther("0.1") })).wait();
  ok("注资 0.1 ETH", (await c.poolBalance()) - poolBeforeFund === ethers.parseEther("0.1"),
     `池子 ${eth(await c.poolBalance())} ETH（+${eth((await c.poolBalance()) - poolBeforeFund)}）`);

  async function claimTier(label, signer, riderAddr, region, mm, wantTier, wantEth, judgeConf = 90) {
    await (await feed(region, 0, 90, 3, "pre")).wait();
    const base = Number(water[region] || 0n);   // ★ 从当前水位起加 delta：链上 require 累计值单调不减，
                                              //   直接喂 mm 会在已有水位的区（如 [2] 喂过的 #1 区 90mm）被拒
    const price = await need(region, 24);
    await (await c.connect(signer).buyPolicy(region, 24, { value: price })).wait();
    const id = (await c.nextPolicyId()) - 1n;
    const snap = await c.policies(id);
    await (await c.connect(operator).submitJudgement(id, 1, judgeConf, 3, H(`in:${id}`), H(`out:${id}`), "ai-judge-v1")).wait();
    await (await feed(region, base + mm)).wait();
    const tier = await c.currentTier(id);
    const pay = await c.payoutOf(id);
    const before = await rawBal(riderAddr);
    await (await c.connect(operator).claim(id)).wait();
    const after = await rawBal(riderAddr);
    const st = await c.policyStatus(id);
    ok(`${label}：档位 = ${tier}`, BigInt(tier) === BigInt(wantTier), `wantTier=${wantTier}`);
    ok(`${label}：payoutOf = ${wantEth} ETH`, pay === ethers.parseEther(wantEth), `实得 ${eth(pay)} ETH`);
    ok(`${label}：骑手净到账 = 赔付额（gas 由触发者出）`, after - before === pay, `+${eth(after - before)} ETH`);
    ok(`${label}：状态 = paid`, st === "paid", st);
    return id;
  }
  await claimTier("武汉 50mm/24h（暴雨档 50%）", a, rA, 1, 50, 0n, "0.005");
  await claimTier("广州 100mm/24h（大暴雨档 75%）", b, rB, 4, 100, 1n, "0.0075");
  await claimTier("成都 250mm/24h（特大暴雨档 100%）", cc, rC, 5, 250, 2n, "0.01");

  // 未达档：不许赔
  console.log("\n[6] 未达最低档 / AI 三关");
  await (await feed(2, 0, 90, 3, "pre2")).wait();
  const idBelow = await (async () => {
    await (await c.connect(d).buyPolicy(2, 24, { value: await need(2, 24) })).wait();
    const id = (await c.nextPolicyId()) - 1n;
    await (await c.connect(operator).submitJudgement(id, 1, 90, 3, H("b:in"), H("b:out"), "v1")).wait();
    return id;
  })();
  await (await feed(2, 49)).wait();
  await expectRevert("雨量未达国标线不许赔",
    async () => c.connect(d).claim.staticCall(idBelow), "below threshold");
  const tierBelow = await c.currentTier(idBelow);
  ok("未达档时 currentTier = 255", BigInt(tierBelow) === BigInt(T.none), String(tierBelow));
  const payBelow = await c.payoutOf(idBelow);
  ok("未达档时 payoutOf = 0", payBelow === 0n, `${eth(payBelow)} ETH`);
  const shortfallBelow = await c.shortfall(idBelow);
  ok("shortfall() 算出还差 1mm", shortfallBelow === 1n, `${shortfallBelow}mm`);
  const rainDuringBelow = await c.rainfallDuring(idBelow);
  ok("rainfallDuring() = 49mm", rainDuringBelow === 49n, `${rainDuringBelow}mm`);

  // AI 三关（用一个新的达档保单）
  await (await feed(2, 100)).wait();
  const idAI = idBelow;   // 同一张保单，雨量现在够了
  const stClaimable = await c.policyStatus(idAI);
  ok("达档 + PAY 判定 → claimable", stClaimable === "claimable", stClaimable);
  // 先把它赔掉，再拿新保单测 AI 三关
  const balDBeforeClaim = await rawBal(rD);
  await (await c.connect(operator).claim(idBelow)).wait();
  const balDAfterClaim = await rawBal(rD);
  ok("未达档那条恢复到达档后可以赔（id " + idBelow + "）",
     balDAfterClaim > balDBeforeClaim && (await c.policyStatus(idBelow)) === "paid",
     `D 到账 +${eth(balDAfterClaim - balDBeforeClaim)} ETH`);

  const mkPolicy = async (signer, region) => {
    await (await c.connect(signer).buyPolicy(region, 24, { value: await need(region, 24) })).wait();
    return (await c.nextPolicyId()) - 1n;
  };
  // (a) 没有判定
  const idNoJ = await mkPolicy(a, 1);
  await (await feed(1, 200)).wait();
  await expectRevert("没有 AI 判定时不许赔",
    async () => c.connect(a).claim.staticCall(idNoJ), "no AI judgement");
  // (b) 判定为不赔
  await (await c.connect(operator).submitJudgement(idNoJ, 0, 95, 3, H("d:in"), H("d:out"), "v1")).wait();
  await expectRevert("AI 判定 DENY 时不许赔",
    async () => c.connect(a).claim.staticCall(idNoJ), "AI: no loss confirmed");
  const stDeny = await c.policyStatus(idNoJ);
  ok("AI 判定 DENY → 状态 = denied（合约把判定结论直接映射成状态）", stDeny === "denied", stDeny);
  // (c) 置信度不足
  const idLow = await mkPolicy(b, 1);
  await (await feed(1, Number(water[1] || 0n) + 60)).wait();   // ★ 先把雨量推过国标线，才会走到 AI 置信度那一关
  await (await c.connect(operator).submitJudgement(idLow, 1, 59, 3, H("l:in"), H("l:out"), "v1")).wait();
  await expectRevert("AI 置信度不足不许赔",
    async () => c.connect(b).claim.staticCall(idLow), "AI: low confidence");
  const stLow = await c.policyStatus(idLow);
  ok("低置信度状态 = low_confidence", stLow === "low_confidence", stLow);
  // (d) 判定只能写一次
  await expectRevert("同一保单判定不能写两次",
    async () => c.connect(operator).submitJudgement.staticCall(idLow, 1, 90, 3, H("again"), H("again"), "v1"), "already submitted");
  await expectRevert("非 operator 写判定要拒绝",
    async () => c.connect(a).submitJudgement.staticCall(idLow, 1, 90, 3, H("x"), H("x"), "v1"), "not operator");
  await expectRevert("给不存在的保单写判定要拒绝",
    async () => c.connect(operator).submitJudgement.staticCall(999, 1, 90, 3, H("x"), H("x"), "v1"), "no such policy");

  // ---------- 7 A5 sources 上链 ----------
  console.log("\n[7] A5 sources 真的写进链上（v1 里恒为 0）");
  const idSrc = await mkPolicy(cc, 2);
  await (await c.connect(operator).submitJudgement(idSrc, 1, 88, 3, H("s:in"), H("s:out"), "ai-judge-v1")).wait();
  const jj = await c.judgements(idSrc);
  ok("judgements().sources = 3（链上真值）", jj.sources === 3n,
     `kind=${jj.kind} decision=${jj.decision} conf=${jj.confidence} sources=${jj.sources}`);
  const fj2 = await c.feedJudgements(1);
  ok("feedJudgements 同样记录 sources", fj2.sources === 3n && fj2.confidence === 90n,
     `sources=${fj2.sources} conf=${fj2.confidence}`);

  // ---------- 8 A3 限购 + A6 敞口 ----------
  console.log("\n[8] A3 限购 / A6 在保敞口账本");
  const exp0 = await c.openExposure();
  console.log(`     当前全部在保敞口 = ${eth(exp0)} ETH`);
  const idCap1 = await mkPolicy(d, 1);
  const idCap2 = await mkPolicy(d, 1);
  const expD = await c.pendingExposureOf(rD);
  ok("骑手维度的在保敞口在累加", expD === ethers.parseEther("0.02"),
     `${eth(expD)} ETH（两笔 0.01 之和）`);
  // ★ A3 的笔数闸门是「终身计数」（_byRider 只增不减）：d 已经买满 3 笔 → 这里先撞笔数闸门
  await expectRevert("笔数上限（3 笔/人，终身计数）要拒绝第 4 笔",
    async () => c.connect(d).buyPolicy.staticCall(1, 24, { value: await need(1, 24) }), "too many policies");
  // ★ 敞口闸门要单独验：换一个终身笔数没到顶的新骑手 e，先买满 2 笔（敞口 0.02 = 上限），第 3 笔才会撞敞口
  const idE1 = await mkPolicy(e, 1);
  const idE2 = await mkPolicy(e, 1);
  const expE2 = await c.pendingExposureOf(rE);
  ok("新骑手 e 买到 2 笔，敞口正好顶到上限", expE2 === ethers.parseEther("0.02"), `${eth(expE2)} ETH`);
  await expectRevert("在保敞口上限（0.02 ETH/人）要拒绝第 3 笔",
    async () => c.connect(e).buyPolicy.staticCall(1, 24, { value: await need(1, 24) }), "open exposure cap exceeded");
  const reserve = await c.reserveOf();
  ok("reserveOf() = max(operator 下限, 在保敞口)", reserve >= exp0,
     `${eth(reserve)} ETH ≥ 在保敞口 ${eth(exp0)} ETH`);
  const bal = await c.poolBalance();
  // ★ 在保敞口可能已经超过池子余额 → 此时「多提 1 wei」也该被拒；断言不能算成负数（会报 out-of-bounds）
  const over = bal > reserve ? bal - reserve + 1n : 1n;
  await expectRevert("提款击穿准备金要拒绝",
    async () => c.connect(operator).withdrawPool.staticCall(over), "would break reserve");
  const withdrawable = bal > reserve ? bal - reserve : 0n;
  if (withdrawable > 0n) {
    await (await c.connect(operator).withdrawPool(withdrawable)).wait();
    ok("提走超出准备金的部分", (await c.poolBalance()) === reserve, `${eth(withdrawable)} ETH`);
    const bal2 = await c.poolBalance();
    await (await c.connect(operator).fundPool({ value: withdrawable })).wait();
    ok("再把钱打回池子（后续用例还要赔付）", (await c.poolBalance()) === bal2 + withdrawable,
       `${eth(bal2)} → ${eth(await c.poolBalance())} ETH`);
  } else {
    ok("池子余额已被准备金全部占用 → 无可提款额（这本身就是 A6 要表达的事）", bal <= reserve,
       `${eth(bal)} ≤ ${eth(reserve)}`);
  }
  // A6 到期结算：先用一张刚买的保单证明「未到期不给结」的守卫在（必须放在拨钟之前）
  await expectRevert("未到期就结算要拒绝",
    async () => c.connect(operator).settleExpired.staticCall([idCap1]), "policy not expired yet");
  await advance(25 * 3600);   // 让所有 24h 保单到期
  const beforeSettle = await c.openExposure();
  await (await c.connect(operator).settleExpired([idCap1, idCap2, idNoJ, idLow, idSrc, idE1, idE2])).wait();
  const afterSettle = await c.openExposure();
  ok("settleExpired 把到期的敞口从账本里减掉", afterSettle < beforeSettle,
     `${eth(beforeSettle)} → ${eth(afterSettle)} ETH`);
  const expDAfter = await c.pendingExposureOf(rD);
  ok("骑手 D 的在保敞口清零", expDAfter === 0n, `${eth(expDAfter)} ETH`);
  // 到期后不能再赔
  await expectRevert("过期保单不能赔",
    async () => c.connect(d).claim.staticCall(idCap1), "policy expired");
  // ★ 结算只释放「敞口闸门」；笔数闸门是终身计数，不会因为结算而放行 —— 这也正是两条闸门的分工
  //   注意 buyPolicy 的 require 顺序：stale feed 排在笔数闸门之前，所以这里得先补一次新鲜喂价，
  //   否则这条断言先撞 stale feed，就验不到笔数闸门了。
  await (await feed(1, Number(water[1] || 0n) + 1)).wait();
  await expectRevert("结算后 d 仍然买不了（笔数闸门是终身的）",
    async () => c.connect(d).buyPolicy.staticCall(1, 24, { value: await need(1, 24) }), "too many policies");

  // ---------- 9 A8 白名单 ----------
  console.log("\n[9] A8 骑手白名单（生产开关，演示默认关）");
  await (await feed(1, Number(water[1] || 0n) + 10)).wait();   // ★ 上面拨了 25h，先补一次新鲜喂价，否则先撞 stale feed
  await (await c.connect(operator).setEligibleRequired(true)).wait();
  await expectRevert("打开白名单后未登记地址不能投保",
    async () => c.connect(f).buyPolicy.staticCall(1, 24, { value: await need(1, 24) }), "not an eligible rider");
  await (await c.connect(operator).setEligible(rF, true, H("platform:rF"))).wait();
  const idBeforeF = await c.nextPolicyId();
  await (await c.connect(f).buyPolicy(1, 24, { value: await need(1, 24) })).wait();
  ok("登记后同一地址可以投保", (await c.nextPolicyId()) === idBeforeF + 1n && (await c.policiesOf(rF)).length === 1,
     `policy #${idBeforeF}`);
  await (await c.connect(operator).setEligible(rF, false, H("platform:rF:revoke"))).wait();
  await expectRevert("撤销登记后又不能投保",
    async () => c.connect(f).buyPolicy.staticCall(1, 24, { value: await need(1, 24) }), "not an eligible rider");
  await (await c.connect(operator).setEligibleRequired(false)).wait();
  ok("关掉白名单开关，任何人可投保（演示口径）", (await c.eligibleRequired()) === false);

  // ---------- 10 暂停 / 权限 / 只读 ----------
  console.log("\n[10] 暂停、权限与只读接口");
  await (await c.connect(operator).setPaused(true)).wait();
  await expectRevert("暂停后不能投保",
    async () => c.connect(cc).buyPolicy.staticCall(1, 24, { value: await need(1, 24) }), "contract paused");
  const resumeReceipt = await (await c.connect(operator).setPaused(false)).wait();
  ok("恢复后可以投保", resumeReceipt.status === 1 && (await c.paused()) === false, "paused 回到 false");
  await expectRevert("非 operator 喂价要拒绝",
    async () => c.connect(a).updateRainfall.staticCall(1, 1000, H("x"), 90, 3), "not operator");
  await expectRevert("累计值倒退要拒绝",
    async () => c.connect(operator).updateRainfall.staticCall(1, 1, H("x"), 90, 3), "must not decrease");
  await expectRevert("置信度低于 MIN_CONFIDENCE 要拒收",
    async () => c.connect(operator).updateRainfall.staticCall(1, 9999, H("lowconf"), 59, 3), "feed confidence too low");
  const rain1Before = await c.rainfall(1);
  const rain3Before = await c.rainfall(3);
  await (await c.connect(operator).rejectFeed(3, 40, 3, H("bad:3"), "feed-judge-v1")).wait();
  const rain3After = await c.rainfall(3);
  ok("rejectFeed 不改动 rainfall（丰台 0mm 仍为 0）",
     rain3After === rain3Before && rain3After === 0n && (await c.rainfall(1)) === rain1Before,
     `丰台 ${rain3After}mm（喂价前 ${rain3Before}mm），武汉仍 ${rain1Before}mm`);
  const fj3 = await c.feedJudgements(3);
  ok("rejectFeed 写入 DENY 判定留证", fj3.exists && fj3.decision === 0n && fj3.confidence === 40n,
     `exists=${fj3.exists} decision=${fj3.decision} conf=${fj3.confidence}`);
  const rn1 = await c.regionName(1), rn3 = await c.regionName(3), rn9 = await c.regionName(9);
  ok("regionName 映射正确", rn1 === "wuhan" && rn3 === "beijing" && rn9 === "unknown",
     `1=${rn1} 3=${rn3} 9=${rn9}`);
  const mine = await c.policiesOf(rA);
  ok("policiesOf() 列出骑手 A 的保单", mine.length > 0 && (await c.policies(mine[0])).windowHours === 24n,
     `[${mine.join(", ")}]`);
  const pAny = await c.policies(0);
  ok("Policy.productId = 1（A9 参数化占位）", pAny.productId === 1n, String(pAny.productId));
  ok("Policy 存了时长与国标线", pAny.windowHours === 24n && pAny.thresholdMm === 50n,
     `${pAny.windowHours}h / ${pAny.thresholdMm}mm`);
  await expectRevert("暂停中的合约不能索赔",
    () => {
      return c.connect(operator).setPaused(true)
        .then(async () => c.connect(operator).claim.staticCall(idNoJ))
        .finally(async () => { await (await c.connect(operator).setPaused(false)).wait(); });
    }, "contract paused");

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(78));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  if (fail.length) { console.log("\n失败清单："); fail.forEach(f => console.log("  - " + f)); }
  console.log(`\n最终池子余额 = ${eth(await c.poolBalance())} ETH   剩余敞口 = ${eth(await c.openExposure())} ETH`);
  console.log("=".repeat(78));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error("\n💥 演练脚本自身抛错：", e); process.exit(2); });
