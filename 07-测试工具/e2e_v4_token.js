/**
 * e2e_v4_token.js —— v4（ERC-20 人民币分版）冒烟测试：token 部署 → 网格 → 注资 →
 * 投保（approve+transferFrom）→ 判定 → 赔付（tier0/tier1/DENY）→ 退保 → 到期结算 → 提款。
 *
 * 要证的四件事：
 *   ① 资金轨道全部走 RDROP 代币（原生币余额全程不动）；
 *   ② 「分」口径与人民币定价表一致（保费 110=1.10 元、赔 5000/7500=50/75 元）；
 *   ③ 判定/档位/敞口语义与 v3 逐字相同（DENY 不赔、快照判读、敞口回收）；
 *   ④ 免权限动作（claim/settleExpired）仍然任何人可触发。
 *
 * 用法：node e2e_v4_token.js   （NODE_PATH 由本目录 node_modules 满足）
 */
const path = require("path");
const fs = require("fs");
const ganache = require("ganache");
const { ethers } = require("ethers");

const SOL_DIR = path.join(__dirname, "..", "03-合约");
const T_ABI = JSON.parse(fs.readFileSync(path.join(SOL_DIR, "RainToken.abi.json"), "utf8"));
const T_BIN = fs.readFileSync(path.join(SOL_DIR, "RainToken.bytecode.txt"), "utf8").trim();
const ABI = JSON.parse(fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsuranceV4.abi.json"), "utf8"));
const BIN = fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsuranceV4.bytecode.txt"), "utf8").trim();

const pass = [], fail = [];
const ok = (n, c, t = "") => { if (c === undefined) throw new Error("ok() 漏条件：" + n);
  (c ? pass : fail).push(n); console.log(`  ${c ? "✅" : "❌"} ${n}${t ? "  " + t : ""}`); };
async function expectRevert(n, callable, keyword) {
  // ★ 文案断言必须走 staticCall（eth_call 才带 revert reason；真交易收据 data=null——同 e2e_multisig 的坑）
  try { await callable();
    ok(n, false, "本该失败却成功"); }
  catch (e) { const m = [e.shortMessage, e.reason, e.message, e.data].filter(Boolean).join(" | ");
    ok(n, !keyword || m.includes(keyword), keyword ? `已拒绝（${keyword}）` : `已拒绝（${m.slice(0, 60)}）`); }
}

(async () => {
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" } });
  const provider = new ethers.BrowserProvider(chain);
  const estGas = provider.estimateGas.bind(provider);
  provider.estimateGas = async (tx) => { let v = 0n; try { v = await estGas(tx); } catch {} return v < 500_000n ? 1_500_000n : v; };
  const accts = await chain.request({ method: "eth_accounts" });
  const [opA, riderA, platformA, otherA] = accts;
  const op = await provider.getSigner(opA), rider = await provider.getSigner(riderA),
        platform = await provider.getSigner(platformA), other = await provider.getSigner(otherA);

  const eth = (n) => ethers.parseEther(n);
  const tok = await (await new ethers.ContractFactory(T_ABI, T_BIN, op).deploy()).waitForDeployment();
  const v4 = await (await new ethers.ContractFactory(ABI, BIN, op).deploy(await tok.getAddress())).waitForDeployment();
  const EV = ethers.id("e2e-v4-smoke-evidence");
  const tokR = tok.connect(rider), v4R = v4.connect(rider), v4P = v4.connect(platform), v4O = v4.connect(other);

  console.log("[1] 基础");
  ok("token decimals=2（1 raw=1 分）", (await tok.decimals()) === 2n);
  ok("PAYOUT_MAX=10000 分（=100 元）", (await v4.PAYOUT_MAX()) === 10000n);
  ok("MIN_PREMIUM=100 分（=1 元）", (await v4.MIN_PREMIUM()) === 100n);
  ok("v4.token 指向 RainToken", (await v4.token()) === await tok.getAddress());

  console.log("[2] 网格（人民币分口径）");
  await (await v4.setPremiumGrid(1, 12, 110, EV)).wait();   // 武汉 12h = 1.10 元
  await (await v4.setPremiumGrid(1, 24, 880, EV)).wait();   // 武汉 24h = 8.80 元（=定价表众包自助最贵格）
  ok("premiumOf(武汉,12h)=110（1.10 元）", (await v4.premiumOf(1, 12)) === 110n);

  console.log("[3] 注资（approve + fundPool）");
  await (await tok.mint(opA, 1_000_000n)).wait();           // 给运营方 1 万元模拟资金
  await (await tok.mint(riderA, 10_000n)).wait();           // 给骑手 100 元
  await (await tok.mint(platformA, 10_000n)).wait();        // 给平台 100 元
  await (await tok.approve(await v4.getAddress(), 500_000n)).wait();
  await (await v4.fundPool(500_000n)).wait();
  ok("池子=500000 分（5000 元）", (await v4.poolBalance()) === 500_000n);
  const nativeBefore = await provider.getBalance(await v4.getAddress());
  ok("原生币余额=0（资金全走代币）", nativeBefore === 0n);

  console.log("[4] 投保（approve + buyPolicy）");
  await (await v4.setCoolingPeriod(0)).wait();
  await (await v4.updateRainfall(1, 100, EV, 84, 2)).wait();
  await (await tokR.approve(await v4.getAddress(), 110n)).wait();
  await (await v4R.buyPolicy(1, 12)).wait();
  const p0 = await v4.policies(0);
  ok("保单0：保费110 / 档线30 / 基线100", p0.premium === 110n && p0.thresholdMm === 30n && p0.rainfallAtBuy === 100n);
  ok("骑手代币余额 10000-110", (await tok.balanceOf(riderA)) === 9_890n);
  ok("合约代币余额 500000+110", (await v4.poolBalance()) === 500_110n);
  ok("在保敞口=10000", (await v4.openExposure()) === 10_000n);
  await expectRevert("没额度再买要拒（insufficient allowance）", () => v4R.buyPolicy.staticCall(1, 12), "insufficient allowance");

  console.log("[5] 判定与赔付（tier0）");
  await (await v4.updateRainfall(1, 145, EV, 84, 3)).wait();  // 累计 100→145，增量 45mm
  await (await v4.submitJudgement(0, 1, 80, 3, 145, EV, EV, "v4-smoke")).wait();
  ok("判定快照=145 / payoutOf=5000（50 元）", (await v4.payoutOf(0)) === 5000n);
  await (await v4O.claim(0)).wait();                          // ★ 非OWNER 触发理赔
  ok("骑手到账 +5000 → 9890+5000", (await tok.balanceOf(riderA)) === 14_890n);
  const p0after = await v4.policies(0);
  ok("保单0 状态 paid / tier0", (await v4.policyStatus(0)) === "paid" && p0after.tier === 0n && p0after.payout === 5000n);
  await expectRevert("重复理赔要拒", () => v4O.claim.staticCall(0), "already paid");

  console.log("[6] DENY 路径");
  await (await tokR.approve(await v4.getAddress(), 110n)).wait();
  await (await v4R.buyPolicy(1, 12)).wait();                  // 保单1，基线145
  await (await v4.updateRainfall(1, 190, EV, 84, 3)).wait();  // 增量 45（达标）
  await (await v4.submitJudgement(1, 0, 90, 3, 190, EV, EV, "v4-smoke")).wait(); // 但判 DENY
  await expectRevert("雨量达标但 AI 判 DENY → 不赔", () => v4O.claim.staticCall(1), "AI: no loss confirmed");
  ok("保单1 状态 denied", (await v4.policyStatus(1)) === "denied");

  console.log("[7] 冷静期退保（钱回付款人）");
  await (await v4.setCoolingPeriod(3600)).wait();
  await (await tokR.approve(await v4.getAddress(), 110n)).wait();
  await (await v4R.buyPolicy(1, 12)).wait();                  // 保单2（rider 自付）
  ok("冷静期内状态 pending", (await v4.policyStatus(2)) === "pending");
  await (await v4R.refundPolicy(2)).wait();
  ok("退保后保费原路回骑手 → 14780（14890-110(DENY单)-110(本单)+110(退回)）", (await tok.balanceOf(riderA)) === 14_780n);
  await (await v4.setCoolingPeriod(0)).wait();

  console.log("[8] 平台代付（buyFor）与 tier1");
  await (await v4.updateRainfall(1, 250, EV, 84, 3)).wait();
  const tokP = tok.connect(platform);
  await (await tokP.approve(await v4.getAddress(), 880n)).wait();
  await (await v4P.buyFor(riderA, 1, 24, 0, 1, 1)).wait();    // 保单3：平台出钱、骑手受益
  const p3 = await v4.policies(3);
  ok("保单3 payer=平台 / rider=骑手 / 保费880", p3.payer === ethers.getAddress(platformA) && p3.rider === ethers.getAddress(riderA) && p3.premium === 880n);
  await (await v4.updateRainfall(1, 370, EV, 84, 3)).wait();  // 增量 120 ≥100 → 大暴雨
  await (await v4.submitJudgement(3, 1, 80, 3, 370, EV, EV, "v4-smoke")).wait();
  await (await v4O.claim(3)).wait();
  ok("tier1 赔 7500（75 元）给骑手", (await tok.balanceOf(riderA)) === 14_780n + 7500n);
  ok("平台没拿赔付（只出了保费）", (await tok.balanceOf(platformA)) === 10_000n - 880n);

  console.log("[9] 到期结算（免权限）与敞口清零");
  await chain.request({ method: "evm_increaseTime", params: [13 * 3600 + 120] });
  await chain.request({ method: "evm_mine" });
  await (await v4O.settleExpired([1])).wait();
  ok("保单1 结算后 openExposure=0", (await v4.openExposure()) === 0n);

  console.log("[10] 提款与准备金");
  const poolNow = await v4.poolBalance();
  await (await v4.withdrawPool(poolNow)).wait();
  ok("敞口清零后可提空池子", (await v4.poolBalance()) === 0n);
  ok("运营方收到全部池款", (await tok.balanceOf(opA)) === 1_000_000n - 500_000n + poolNow);

  console.log("=".repeat(70));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  if (fail.length) { fail.forEach((f) => console.log("❌ " + f)); process.exit(1); }
})().catch((e) => { console.error("💥 " + (e.shortMessage || e.message)); process.exit(1); });
