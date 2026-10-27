/**
 * 本地全流程演练：把 RainDeliveryInsurance 在本地链上真跑一遍
 * 目标不是"能部署"，而是"把演示当天会炸的地方提前炸出来"。
 *
 * 用法：NODE_PATH=<workspace>/node_modules node e2e_contract.js [合约目录]
 *
 * ★ 赛期新增：AI 判定层（喂价验收 + 损失判定）的断言。
 *   `claim()` 现在是「确定性规则 + AI 三重条件」，所以每一条 buy → feed → claim
 *   的用例都必须补上 `submitJudgement`，否则会 revert 在 "no AI judgement"。
 */
const path = require("path");
const fs = require("fs");
const ganache = require("ganache");
const { ethers } = require("ethers");

const SOL_DIR = process.argv[2] || path.join(__dirname, "..", "03-合约");
const ABI = JSON.parse(fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsurance.abi.json"), "utf8"));
const BIN = fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsurance.bytecode.txt"), "utf8").trim();

const pass = [], fail = [];
// ★ A36：ok() 必须收到**真条件**（第 2 参）。老写法 ok("标签") / ok("标签","说明") 只推标签、恒绿，
//   等于把「执行到了这一行」当成「这一行是对的」。现在条件为假一律计入 fail；第 3 参只负责打印说明。
//   漏传条件直接抛错 —— 宁可当场炸得响，也不留一个假绿灯。
//   ★ 实测（离线静态扫描 ok( 调用点，含本定义处）：改前 35 个调用点 / 其中 30 个只推标签，
//     改后 36 个（+1 = A33 把一条只 console.log 的「代码长度校验」升格成真断言）/ 弱断言 0 个。
const ok = (n, cond, txt = "") => {
  if (cond === undefined) throw new Error(`ok() 漏传条件（A36）：${n}`);
  if (cond) { pass.push(n); console.log(`  ✅ ${n}${txt ? "  " + txt : ""}`); }
  else { fail.push(`${n} (条件不成立)`); console.log(`  ❌ ${n}${txt ? "  " + txt : ""}  ← 条件不成立`); }
};
const bad = (n, why) => { fail.push(`${n} (${why})`); console.log(`  ❌ ${n}  ← ${why}`); };

// 期望失败。callable 建议用 .staticCall(...)，因为 eth_call 才会把 revert reason 带回来。
async function expectRevert(name, callable, keyword) {
  try {
    await callable();
    bad(name, "本该失败，却成功了");
  } catch (e) {
    const msg = [e.shortMessage, e.reason, e.message,
                 e.info && e.info.error && e.info.error.message, e.data]
                .filter(Boolean).join(" | ");
    // 「进到 catch」本身就证明它真的拒绝了；hit 再把「拒绝理由对不对得上」算进来 —— 两条 ok 的第二参都是实算的。
    const hit = !keyword || msg.includes(keyword);
    if (!keyword) return ok(name, hit, `已拒绝（${msg.slice(0, 70)}）`);
    if (msg.includes(keyword)) ok(name, hit, `已拒绝（${keyword}）`);
    else bad(name, `期望含「${keyword}」，实际：${msg.slice(0, 120)}`);
  }
}

// 判定哈希：真实系统里是「多源数据快照的哈希」，本地演练里用 keccak256(字符串) 代替
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

(async () => {
  console.log("=".repeat(78));
  console.log("本地链全流程演练 · RainDeliveryInsurance");
  console.log("=".repeat(78));

  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" } });
  const provider = new ethers.BrowserProvider(chain);

  // ★ 本地 harness 的坑，真链不存在：eth_estimateGas 偶尔**低估** —— 实测 updateRainfall 估到
  //   50,519，上链后正好烧完 50,519 gas 才 out-of-gas revert（收据里没有 reason、没有 revert 数据），
  //   而同一状态 eth_call 却成功。表现是「约十次崩一次」的假失败，崩点恒在 [3] 喂价的 feed().wait()。
  //   对策与 07-测试工具/e2e_v2.js:59-65 同一套（一处共享守卫，不在每个调用点上贴）：估不到就给宽裕值，
  //   估出来偏低也抬到 150 万。交易仍由 EVM 裁决 —— 真实 require 失败照样在 tx.wait() 抛出，
  //   gasUsed 也照实打印，不会盖住合约缺陷。
  const estGas = provider.estimateGas.bind(provider);
  provider.estimateGas = async (tx) => {
    let v = 0n;
    try { v = await estGas(tx); }
    catch (e) { console.log(`     [gas 兜底] 估算失败：${e.shortMessage || e.message}`); }
    return v < 500_000n ? 1_500_000n : v;
  };

  // ★ 余额必须用裸 RPC 读。
  //   ethers v6 的 AbstractProvider 对 getBalance 有 250ms 结果缓存，
  //   ganache 又是即时出块 —— 前后两次读会拿到同一个值，测出来的"没到账"是假的。
  const rawBal = async (addr) =>
    BigInt(await chain.request({ method: "eth_getBalance", params: [addr, "latest"] }));

  const accts = await chain.request({ method: "eth_accounts" });
  const [opAddr, riderA, riderB] = accts;
  const operator = await provider.getSigner(opAddr);
  const a = await provider.getSigner(riderA);
  const b = await provider.getSigner(riderB);

  // ---------- 0 ----------
  console.log("\n[0] 部署");
  const factory = new ethers.ContractFactory(ABI, BIN, operator);
  const c = await factory.deploy();
  await c.waitForDeployment();
  const addr = await c.getAddress();
  ok("部署成功", addr.length === 42 && (await provider.getCode(addr)) !== "0x", addr);
  console.log(`     operator = ${opAddr}`);
  console.log(`     骑手 A   = ${riderA}`);
  const code = await provider.getCode(addr);
  // ★ A33：这里原来只有一行 console.log("…编译报告 10758，一致 ✅") —— 没有任何断言，合约改大了也照样绿。
  //   改成真断言：链上 eth_getCode 的实测运行时长度必须等于 10758。
  //   10758 的权威来源 = v1 在 Sepolia 11155111 上的 eth_getCode 实测（08-截图存证/真链留痕-2026-10-06.md:19
  //   「运行时代码长度 | 10,758 字节」；同一数字另见 README.md:401、02-作战与答辩/汉客松-交易哈希清单.md:150）。
  //   v1 没有 03-合约/RainDeliveryInsurance.runtime-size.txt 可对（那个文件只对 V2/V3 存在），所以这里只认链上实测值。
  {
    const codeLen = (code.length - 2) / 2;
    ok("部署后链上代码长度 = 10758 字节（与 Sepolia 11155111 实测值一致）", codeLen === 10758,
       `实测 ${codeLen} 字节`);
  }

  const PREMIUM = await c.PREMIUM(), PAYOUT = await c.PAYOUT(), THRESHOLD = await c.THRESHOLD();
  const MIN_CONFIDENCE = await c.MIN_CONFIDENCE();
  console.log(`     PREMIUM=${ethers.formatEther(PREMIUM)}  PAYOUT=${ethers.formatEther(PAYOUT)}  THRESHOLD=${THRESHOLD}mm  MIN_CONFIDENCE=${MIN_CONFIDENCE}`);
  if (MIN_CONFIDENCE === 60n) ok("MIN_CONFIDENCE 常量 = 60", MIN_CONFIDENCE === 60n, String(MIN_CONFIDENCE));
  else bad("MIN_CONFIDENCE", `${MIN_CONFIDENCE} ≠ 60`);

  // 喂价辅助：默认 90 分置信度 / 3 个数据源
  const feed = (regionId, mm, confidence = 90, sources = 3, tag = "") =>
    c.connect(operator).updateRainfall(regionId, mm, H(`snapshot:${regionId}:${mm}:${tag}`), confidence, sources);
  // 只读版喂价（走 eth_call，不花 gas）。**revert 断言必须用它** —— 本文件 :24 的约定：
  // 用交易版时，"合约拒绝了"这件事是被「估算 gas 失败 → ethers 抛错」间接满足的，
  // 一旦 gas 兜底（见文件顶部 estimateGas 包装）把估算失败吞掉，断言就会变成假的「本该失败却成功了」。
  const feedCall = (regionId, mm, confidence = 90, sources = 3, tag = "") =>
    c.connect(operator).updateRainfall.staticCall(regionId, mm, H(`snapshot:${regionId}:${mm}:${tag}`), confidence, sources);

  // ---------- 1 资金池 ----------
  console.log("\n[1] 资金池 —— ★ 教科书骨架版的致命 bug 就在这");
  console.log(`     注资前余额 = ${ethers.formatEther(await c.poolBalance())} ETH`);
  {
    // 另起一份不注资的合约，证明"不注资就赔不了"
    const c2 = await new ethers.ContractFactory(ABI, BIN, operator).deploy();
    await c2.waitForDeployment();
    await (await c2.connect(a).buyPolicy(1, 6, { value: PREMIUM })).wait();
    await (await c2.connect(operator).updateRainfall(1, 80, H("c2:1:80"), 90, 3)).wait();
    // 判定也得先补上，否则 revert 会停在 "no AI judgement"，测不到池子那条 require
    await (await c2.connect(operator).submitJudgement(0, 1, 90, H("c2:in"), H("c2:out"), "e2e")).wait();
    await expectRevert("池子空的，claim 会被拒绝",
      () => c2.connect(a).claim.staticCall(0), "insurance pool empty");
    console.log("     ↑ 骨架版 PREMIUM=0.001 / PAYOUT=0.01，收 1 份保费就想赔 10 倍 —— 第 1 笔就挂");
  }
  await (await c.connect(operator).fundPool({ value: ethers.parseEther("0.1") })).wait();
  ok("团队注资 0.1 ETH（池子余额真的等于 0.1）", (await c.poolBalance()) === ethers.parseEther("0.1"),
     `池子 ${ethers.formatEther(await c.poolBalance())} ETH`);

  // ---------- 2 投保 ----------
  console.log("\n[2] 投保");
  await expectRevert("保费金额不对要拒绝",
    () => c.connect(a).buyPolicy.staticCall(1, 6, { value: 1n }), "premium mismatch");
  await expectRevert("超长保单要拒绝",
    () => c.connect(a).buyPolicy.staticCall(1, 999, { value: PREMIUM }), "hours out of range");
  await expectRevert("0 小时保单要拒绝",
    () => c.connect(a).buyPolicy.staticCall(1, 0, { value: PREMIUM }), "hours out of range");
  await expectRevert("非法区域要拒绝",
    () => c.connect(a).buyPolicy.staticCall(9, 6, { value: PREMIUM }), "bad region");
  await expectRevert("区域 0 要拒绝",
    () => c.connect(a).buyPolicy.staticCall(0, 6, { value: PREMIUM }), "bad region");

  await (await c.connect(a).buyPolicy(1, 6, { value: PREMIUM })).wait();   // policy 0 武汉 · 正常赔付路径
  await (await c.connect(a).buyPolicy(2, 6, { value: PREMIUM })).wait();   // policy 1 上海 · 永远不达阈值
  ok("骑手 A 买了 2 张保单", (await c.policiesOf(riderA)).length === 2, `nextPolicyId = ${await c.nextPolicyId()}`);
  const mine = await c.policiesOf(riderA);
  ok("policiesOf() 列出自己的保单号（正好是 0 和 1）", mine.length === 2 && mine[0] === 0n && mine[1] === 1n,
     `[${mine.join(", ")}]`);
  const p0 = await c.policies(0);
  console.log(`     policy0: region=${p0.regionId} 快照=${p0.rainfallAtBuy}mm 状态=${await c.policyStatus(0)}`);
  console.log(`     池子 ${ethers.formatEther(await c.poolBalance())} ETH（0.1 + 2×0.001）`);
  {
    const p1 = await c.premiumOf(1);
    ok("premiumOf() 未设定时回退到 PREMIUM", p1 === PREMIUM, `${ethers.formatEther(p1)} ETH`);
    if (p1 !== PREMIUM) bad("premiumOf 回退", "不等于 PREMIUM");
  }

  // ---------- 3 喂价 + AI 喂价验收 ----------
  console.log("\n[3] 喂价（operator 专属）+ AI 喂价验收");
  await expectRevert("非 operator 喂价要拒绝",
    () => c.connect(a).updateRainfall.staticCall(1, 30, H("x"), 90, 3), "not operator");
  await (await feed(1, 30)).wait();
  ok("武汉累计降雨推到 30mm", (await c.rainfall(1)) === 30n);
  await expectRevert("累计值倒退要拒绝",
    () => feedCall(1, 10), "must not decrease");
  await expectRevert("置信度低于 MIN_CONFIDENCE 要拒收",
    () => feedCall(1, 31, 59), "feed confidence too low");
  await expectRevert("喂价缺少证据哈希要拒绝",
    () => c.connect(operator).updateRainfall.staticCall(1, 31, ethers.ZeroHash, 90, 3), "evidence required");
  ok("喂价验收：置信度 59 被合约真拒收（不是只写在文档里）", (await c.rainfall(1)) === 30n, "未改动链上 rainfall");
  {
    const r1 = await c.rainfall(1);
    ok("被拒收的喂价确实没有改动 rainfall", r1 === 30n, `仍为 ${r1}mm`);
    if (r1 !== 30n) bad("拒收后 rainfall", `${r1} ≠ 30`);
  }

  // @ts-ignore
  const fj = await c.feedJudgements(1);
  {
    const hit = fj.exists && fj.decision === 1n && fj.confidence === 90n && fj.sources === 3n;
    const detail = `exists=${fj.exists} decision=${fj.decision} conf=${fj.confidence} src=${fj.sources}`;
    ok("feedJudgements[1] 记录了本次验收", hit,
       hit ? `decision=PAY confidence=${fj.confidence} sources=${fj.sources}` : detail);
    if (!hit) bad("feedJudgements[1]", detail);
  }

  // rejectFeed：不喂价，但把异常留证
  const rain3Before = await c.rainfall(3);
  await (await c.connect(operator).rejectFeed(3, 40, 3, H("bad:3"), "feed-judge-v1")).wait();
  const fj3 = await c.feedJudgements(3);
  {
    const r3 = await c.rainfall(3);
    ok("rejectFeed 不改动 rainfall", r3 === rain3Before, `仍为 ${r3}mm`);
    if (r3 !== rain3Before) bad("rejectFeed 改动了 rainfall", `${rain3Before} → ${r3}`);
  }
  {
    const hit = fj3.exists && fj3.decision === 0n && fj3.confidence === 40n;
    const detail = `exists=${fj3.exists} decision=${fj3.decision} conf=${fj3.confidence}`;
    ok("rejectFeed 写入 DECISION_DENY 判定", hit,
       hit ? `confidence=${fj3.confidence} sources=${fj3.sources}` : detail);
    if (!hit) bad("rejectFeed 判定", detail);
  }
  await expectRevert("rejectFeed 置信度越界要拒绝",
    () => c.connect(operator).rejectFeed.staticCall(3, 101, 3, H("x"), "v"), "confidence out of range");

  console.log(`     武汉保单状态 = ${await c.policyStatus(0)}   还差 ${await c.shortfall(0)} mm 才赔`);
  await expectRevert("未达阈值不能赔",
    () => c.connect(a).claim.staticCall(0), "threshold not met");

  await (await feed(1, 80)).wait();
  ok("武汉累计降雨推到 80mm", (await c.rainfall(1)) === 80n, "保单期间增量 = 80 − 0 = 80 ≥ 50");
  console.log(`     武汉保单状态 = ${await c.policyStatus(0)}   还差 ${await c.shortfall(0)} mm`);

  // ★ 保单期间增量口径验证：先买、再涨，老保单不该被"过去的雨"白送
  await (await c.connect(a).buyPolicy(1, 6, { value: PREMIUM })).wait();   // policy 2，快照=80
  console.log(`     policy2 快照降雨 = ${(await c.policies(2)).rainfallAtBuy}mm（=买入时的累计值）`);
  await expectRevert("新买的保单不能白吃之前的雨（增量口径生效）",
    () => c.connect(a).claim.staticCall(2), "threshold not met");
  ok("增量口径正确：保单只认「投保之后」下的雨", (await c.policies(2)).rainfallAtBuy === 80n,
     "policy2 的快照被钉在投保当刻的 80mm（所以上面那条 claim 才会 revert）");

  // ---------- 4 AI 损失判定 ----------
  console.log("\n[4] AI 损失判定（拼上链的最后一块）");
  await expectRevert("没有 AI 判定不能赔",
    () => c.connect(a).claim.staticCall(0), "no AI judgement");
  // @ts-ignore
  const st0a = await c.policyStatus(0);
  {
    ok("policyStatus 把「雨量够但没判定」显出来", st0a === "pending_judgement", st0a);
    if (st0a !== "pending_judgement") bad("policyStatus(0)", `${st0a} ≠ pending_judgement`);
  }

  await expectRevert("非 operator 不能提交判定",
    () => c.connect(a).submitJudgement.staticCall(0, 1, 90, H("i"), H("o"), "v"), "not operator");
  await expectRevert("对不存在的保单不能判定",
    () => c.connect(operator).submitJudgement.staticCall(999, 1, 90, H("i"), H("o"), "v"), "no such policy");
  await expectRevert("decision 越界要拒绝",
    () => c.connect(operator).submitJudgement.staticCall(0, 2, 90, H("i"), H("o"), "v"), "bad decision");
  await expectRevert("confidence 越界要拒绝",
    () => c.connect(operator).submitJudgement.staticCall(0, 1, 101, H("i"), H("o"), "v"), "confidence out of range");

  // case A：AI 判定「不赔」—— 雨下够了，但这场雨没砸在这个骑手身上
  await (await c.connect(b).buyPolicy(3, 6, { value: PREMIUM })).wait();   // policy 3 北京
  await (await feed(3, 80, 90, 3, "deny-case")).wait();
  await (await c.connect(operator).submitJudgement(3, 0, 95, H("in:3"), H("out:3"), "judge-v1")).wait();
  {
    const j3a = await c.judgements(3);
    ok("submitJudgement(DECISION_DENY) 写入成功", j3a.exists && j3a.decision === 0n,
       `decision=${j3a.decision} confidence=${j3a.confidence}`);
  }
  await expectRevert("AI 判定「不赔」时不能赔",
    () => c.connect(b).claim.staticCall(3), "AI: no loss confirmed");
  // @ts-ignore
  const st3 = await c.policyStatus(3);
  {
    ok("policyStatus 显示 denied", st3 === "denied", st3);
    if (st3 !== "denied") bad("policyStatus(3)", `${st3} ≠ denied`);
  }

  // case B：AI 判定「赔」但置信度不够
  await (await c.connect(b).buyPolicy(4, 6, { value: PREMIUM })).wait();   // policy 4 广州
  await (await feed(4, 80, 90, 3, "lowconf-case")).wait();
  await (await c.connect(operator).submitJudgement(4, 1, 50, H("in:4"), H("out:4"), "judge-v1")).wait();
  await expectRevert("AI 置信度不足时不能赔",
    () => c.connect(b).claim.staticCall(4), "AI: low confidence");
  // @ts-ignore
  const st4 = await c.policyStatus(4);
  {
    ok("policyStatus 显示 low_confidence", st4 === "low_confidence", st4);
    if (st4 !== "low_confidence") bad("policyStatus(4)", `${st4} ≠ low_confidence`);
  }

  // 判定只能写一次（否则 operator 可以事后把 DENY 翻成 PAY）
  await expectRevert("同一份保单不能重复判定",
    () => c.connect(operator).submitJudgement.staticCall(3, 1, 99, H("in:3b"), H("out:3b"), "judge-v2"),
    "judgement already submitted");
  // @ts-ignore
  const j3 = await c.judgements(3);
  ok("judgements[3] 记录写入且未被第二次调用覆盖",
     j3.exists && j3.kind === 1n && j3.decision === 0n && j3.confidence === 95n,
     `exists=${j3.exists} kind=${j3.kind} decision=${j3.decision} conf=${j3.confidence}`);

  // 正常路径：policy 0 判定为赔
  await (await c.connect(operator).submitJudgement(0, 1, 95, H("in:0"), H("out:0"), "judge-v1")).wait();
  {
    const j0 = await c.judgements(0);
    ok("policy0 判定为「确认损失 · 95 分」", j0.exists && j0.decision === 1n && j0.confidence === 95n,
       `decision=${j0.decision} confidence=${j0.confidence}`);
  }
  // @ts-ignore
  const st0b = await c.policyStatus(0);
  if (st0b === "claimable") ok("policyStatus → claimable", st0b);
  else bad("policyStatus(0)", `${st0b} ≠ claimable`);

  // ---------- 5 赔付 ----------
  console.log("\n[5] 赔付");
  const poolBefore0 = await c.poolBalance();
  const balBefore = await rawBal(riderA);
  const rcpt = await (await c.connect(a).claim(0)).wait();
  const balAfter = await rawBal(riderA);
  const poolAfter0 = await c.poolBalance();

  // 权威判据：池子少了多少。它不受 gas 影响。
  {
    const dPool = poolBefore0 - poolAfter0;
    ok("资金池精确扣减 PAYOUT", dPool === PAYOUT, `${ethers.formatEther(dPool)} ETH`);
    if (dPool !== PAYOUT) bad("资金池扣减", `${dPool} ≠ ${PAYOUT}`);
  }

  // 骑手净到账 = 收到 PAYOUT − 自付 gas
  const gasCost = rcpt.gasUsed * rcpt.gasPrice;
  const netDelta = balAfter - balBefore;
  {
    const hit = netDelta + gasCost === PAYOUT;
    ok("骑手净到账 = PAYOUT − 自付 gas", hit,
      `+${ethers.formatEther(PAYOUT)} − gas ${gasCost} wei = ${netDelta} wei`);
    if (!hit) bad("骑手净到账", `${netDelta} + ${gasCost} ≠ ${PAYOUT}`);
  }
  console.log(`     gasUsed=${rcpt.gasUsed}  gasPrice=${rcpt.gasPrice} wei`);
  console.log(`     池子 ${ethers.formatEther(poolBefore0)} → ${ethers.formatEther(poolAfter0)} ETH   （差 ${ethers.formatEther(poolBefore0 - poolAfter0)} = PAYOUT）`);
  console.log(`     保单状态 = ${await c.policyStatus(0)}`);

  await expectRevert("同一张保单不能赔两次",
    () => c.connect(a).claim.staticCall(0), "already paid");
  await expectRevert("上海没下雨不能赔",
    () => c.connect(a).claim.staticCall(1), "threshold not met");
  await expectRevert("不存在的保单不能赔",
    () => c.connect(a).claim.staticCall(999), "no such policy");

  // 第三方帮骑手触发
  await (await feed(1, 200, 90, 3, "third-party")).wait();
  await (await c.connect(operator).submitJudgement(2, 1, 92, H("in:2"), H("out:2"), "judge-v1")).wait();
  const poolB = await c.poolBalance();
  const beforeB = await rawBal(riderA);
  await (await c.connect(b).claim(2)).wait();
  const d2 = (await rawBal(riderA)) - beforeB;
  {
    const dPool2 = poolB - (await c.poolBalance());
    const hit = d2 === PAYOUT && dPool2 === PAYOUT;
    ok("第三方可代为触发赔付", hit, `钱只进保单里的 rider（骑手 +${ethers.formatEther(d2)} ETH，gas 由代触发者付）`);
    if (!hit) bad("代触发赔付", `骑手 ${d2}，池子扣 ${dPool2}`);
  }

  // ---------- 6 承保人（精算定价）----------
  console.log("\n[6] 承保人：精算结论怎么落到链上");
  await expectRevert("非 operator 不能设定承保参数",
    () => c.connect(a).setUnderwriting.staticCall(5, 1, PREMIUM, H("r")), "not operator");
  await expectRevert("风险等级越界要拒绝",
    () => c.connect(operator).setUnderwriting.staticCall(5, 9, PREMIUM, H("r")), "bad level");
  await expectRevert("区域越界要拒绝",
    () => c.connect(operator).setUnderwriting.staticCall(9, 1, PREMIUM, H("r")), "bad region");
  await expectRevert("保费等于赔付额要拒绝（零毛利）",
    () => c.connect(operator).setUnderwriting.staticCall(5, 1, PAYOUT, H("r")), "premium out of range");
  await expectRevert("保费为 0 要拒绝",
    () => c.connect(operator).setUnderwriting.staticCall(5, 1, 0n, H("r")), "premium out of range");

  await (await c.connect(operator).setUnderwriting(5, 1, ethers.parseEther("0.002"), H("actuary:5"))).wait();
  const prem5 = await c.premiumOf(5);
  {
    const hit = prem5 === ethers.parseEther("0.002");
    ok("预警加价后 premiumOf 跟着变", hit, `${ethers.formatEther(prem5)} ETH`);
    if (!hit) bad("premiumOf(5)", `${prem5} ≠ 0.002e18`);
  }
  await expectRevert("加价后按旧保费投保要拒绝",
    () => c.connect(b).buyPolicy.staticCall(5, 6, { value: PREMIUM }), "premium mismatch");
  await (await c.connect(b).buyPolicy(5, 6, { value: ethers.parseEther("0.002") })).wait();
  // riderB 到这时一共 3 张（policy 3 北京 / 4 广州 / 5 成都），这一笔是第 3 张 —— 用「名下单数」当条件比数 nextPolicyId 稳。
  ok("按新保费投保成功", (await c.policiesOf(riderB)).length === 3,
     `riderB 名下保单 ${(await c.policiesOf(riderB)).length} 张（3/4/5）`);

  await (await c.connect(operator).setUnderwriting(5, 2, ethers.parseEther("0.002"), H("actuary:5:suspend"))).wait();
  {
    const prem5b = await c.premiumOf(5);
    // 合约里拒保（RISK_SUSPENDED）会把 aiPremium 清零，premiumOf 随即回退到默认 PREMIUM。
    ok("区域 5 被设为拒保（RISK_SUSPENDED）", prem5b === PREMIUM, `premiumOf 回退到 ${ethers.formatEther(prem5b)} ETH`);
  }
  await expectRevert("被拒保的区域不能再投保",
    () => c.connect(b).buyPolicy.staticCall(5, 6, { value: PREMIUM }), "region suspended by underwriter");

  // ---------- 7 资金池准备金 ----------
  console.log("\n[7] 资金池准备金（修掉「注释撒谎」）");
  const balNow = await c.poolBalance();
  await (await c.connect(operator).setReserve(balNow)).wait();
  ok("setReserve() 把准备金设为当前全部余额", (await c.reserve()) === balNow, `${ethers.formatEther(balNow)} ETH`);
  await expectRevert("有准备金时不能把池子提空",
    () => c.connect(operator).withdrawPool.staticCall(1n), "would break reserve");
  await expectRevert("准备金不能超过余额",
    () => c.connect(operator).setReserve.staticCall(balNow + 1n), "reserve exceeds balance");
  await expectRevert("非 operator 不能设定准备金",
    () => c.connect(a).setReserve.staticCall(0n), "not operator");
  await (await c.connect(operator).setReserve(0)).wait();
  ok("准备金可重置为 0", (await c.reserve()) === 0n);

  // ---------- 8 边界与权限 ----------
  console.log("\n[8] 边界与权限");
  await expectRevert("非 operator 不能提款",
    () => c.connect(a).withdrawPool.staticCall(1n), "not operator");
  await expectRevert("超额提款要拒绝",
    () => c.connect(operator).withdrawPool.staticCall(ethers.parseEther("999")), "would break reserve");
  await expectRevert("非 operator 不能暂停",
    () => c.connect(a).setPaused.staticCall(true), "not operator");
  await expectRevert("非 operator 不能转交权限",
    () => c.connect(a).transferOperator.staticCall(riderB), "not operator");

  await (await c.connect(operator).setPaused(true)).wait();
  await expectRevert("暂停后不能投保",
    () => c.connect(a).buyPolicy.staticCall(2, 6, { value: PREMIUM }), "contract paused");
  await expectRevert("暂停后不能赔付",
    () => c.connect(a).claim.staticCall(1), "contract paused");
  await (await c.connect(operator).setPaused(false)).wait();
  // 标签原来写「后可继续投保」，但这一段并没有再投一张来验它 —— 所以把标签收到真正被断言的那件事上，
  // 「暂停时不能投保」由上面两条 expectRevert 负责，两条合起来才是完整口径。
  ok("解除暂停（paused 回到 false）", (await c.paused()) === false);

  const poolBefore = await c.poolBalance();
  await (await c.connect(operator).withdrawPool(ethers.parseEther("0.05"))).wait();
  const poolAfter = await c.poolBalance();
  ok("operator 可提取多余资金（正好 0.05 ETH）", poolBefore - poolAfter === ethers.parseEther("0.05"),
     `${ethers.formatEther(poolBefore)} → ${ethers.formatEther(poolAfter)} ETH`);

  {
    const n1 = await c.regionName(1), n3 = await c.regionName(3), n9 = await c.regionName(9);
    ok("regionName 1/3/9 = wuhan/beijing/unknown", n1 === "wuhan" && n3 === "beijing" && n9 === "unknown",
       `1=${n1} 3=${n3} 9=${n9}`);
  }
  {
    const pb = await c.poolBalance(), rf = await c.rainfall(1), rv = await c.reserve();
    ok("只读接口可用（三个 view 都读得出且值对）", rf === 200n && rv === 0n,
       `poolBalance=${ethers.formatEther(pb)}  rainfall(1)=${rf}mm  reserve=${rv}`);
  }

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(78));
  console.log(`结果：${pass.length} 项通过 / ${fail.length} 项失败`);
  if (fail.length) { fail.forEach(f => console.log("  ✗ " + f)); console.log("=".repeat(78)); process.exit(1); }
  console.log("✅ 全部通过 —— 这个合约可以拿去 Sepolia 部署了");
  console.log("=".repeat(78));
  process.exit(0);
})().catch(e => {
  console.error("\n💥 演练中断：", e.shortMessage || e.message || e);
  console.error(e.stack ? e.stack.split("\n").slice(0, 5).join("\n") : "");
  process.exit(1);
});
