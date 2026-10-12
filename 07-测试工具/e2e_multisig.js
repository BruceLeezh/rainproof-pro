/**
 * 多签本地演练：OperatorMultisig（2/3）自身行为 + 与 RainDeliveryInsuranceV2 的集成。
 *
 * 要证的三件事：
 *   ① 多签本身按规矩来（1 票不执行 / 第 2 票才执行 / 不能重复确认 / 非 owner 全被拒 /
 *      目标 revert 时整笔回滚 / revoke 后重投有效 / 治理只能由多签自己发起）；
 *   ② 把 V2 的 operator 换成多签后，**原来那把单私钥再也动不了合约**（not operator）；
 *   ③ 通过多签 2 票调用同一个函数能成功，而且链上状态真的变了。
 *
 * 用法：NODE_PATH=<workspace>/node_modules node e2e_multisig.js [合约目录]
 */
const path = require("path");
const fs = require("fs");
const ganache = require("ganache");
const { ethers } = require("ethers");

const SOL_DIR = process.argv[2] || path.join(__dirname, "..", "03-合约");
const MS_ABI = JSON.parse(fs.readFileSync(path.join(SOL_DIR, "OperatorMultisig.abi.json"), "utf8"));
const MS_BIN = fs.readFileSync(path.join(SOL_DIR, "OperatorMultisig.bytecode.txt"), "utf8").trim();
const ABI = JSON.parse(fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsuranceV2.abi.json"), "utf8"));
const BIN = fs.readFileSync(path.join(SOL_DIR, "RainDeliveryInsuranceV2.bytecode.txt"), "utf8").trim();

const pass = [], fail = [];
// ★ A36：ok() 必须收到**真条件**（第 2 参）。老写法 ok("标签") / ok("标签","说明") 只推标签、恒绿。
//   条件为假一律计入 fail；第 3 参只负责打印说明；漏传条件直接抛错。
//   ★ 实测（离线静态扫描 ok( 调用点，含定义处）：改前 44 个调用点 / 其中 41 个只推标签，改后 44 / 0。
const ok = (n, cond, txt = "") => {
  if (cond === undefined) throw new Error(`ok() 漏传条件（A36）：${n}`);
  if (cond) { pass.push(n); console.log(`  ✅ ${n}${txt ? "  " + txt : ""}`); }
  else { fail.push(`${n} (条件不成立)`); console.log(`  ❌ ${n}${txt ? "  " + txt : ""}  ← 条件不成立`); }
};
const bad = (n, why) => { fail.push(`${n} (${why})`); console.log(`  ❌ ${n}  ← ${why}`); };

async function expectRevert(name, callable, keyword) {
  try {
    const r = await callable();
    // 与 e2e_v2 同样的处理：真正的 revert 有的是在 wait() 才抛出来的，这里统一等到收据
    if (r && typeof r.wait === "function") await r.wait();
    bad(name, "本该失败，却成功了");
  } catch (e) {
    const msg = [e.shortMessage, e.reason, e.message,
                 e.info && e.info.error && e.info.error.message, e.data]
                .filter(Boolean).join(" | ");
    const hit = !keyword || msg.includes(keyword);
    if (hit) ok(name, true, `已拒绝（${keyword || msg.slice(0, 70)}）`);
    else ok(name, false, `期望含「${keyword}」，实际：${msg.slice(0, 140)}`);
  }
}

/**
 * 真实发送一笔注定失败的上链交易。★ 只说"失败了"，不断言文案：
 * ethers v6 对 status=0 的收据**不会**回放 eth_call，拿不到 reason（data=null/reason=null）；
 * 想断言 revert 文案就得走 expectRevert 的 staticCall（eth_call 才带得回原因）。
 */
async function expectTxFail(name, callable) {
  try {
    const r = await callable();
    if (r && typeof r.wait === "function") await r.wait();
    bad(name, "本该失败，却成功了");
  } catch (e) {
    // 走到 catch 本身就是「这笔真的失败了」这个条件成立 —— 与 expectRevert 不同，这里不断言文案。
    ok(name, true, `交易失败并回滚（${String(e.shortMessage || e.message || "").slice(0, 30)}）`);
  }
}

const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const eth = (w) => ethers.formatEther(w);
const low = (a) => String(a).toLowerCase();
const ZERO = ethers.ZeroAddress;

(async () => {
  console.log("=".repeat(78));
  console.log("本地链演练 · OperatorMultisig（2/3 多签） + RainDeliveryInsuranceV2 集成");
  console.log("=".repeat(78));

  // ---------- 0 起链 ----------
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: "shanghai" } });
  const provider = new ethers.BrowserProvider(chain);

  // ★ 与 e2e_v2 同一套 gas 兜底：ganache 的 eth_estimateGas 会低估（实测 updateRainfall
  //   只给 5 万 gas，上链后烧光才 revert，而同一状态 eth_call 却成功）。
  //   交易最终仍由 EVM 裁决，真实 require 失败照样在 tx.wait() 抛出来。
  const estGas = provider.estimateGas.bind(provider);
  provider.estimateGas = async (tx) => {
    let v = 0n;
    try { v = await estGas(tx); }
    catch (e) { console.log(`     [gas 兜底] 估算失败：${e.shortMessage || e.message}`); }
    return v < 500_000n ? 1_500_000n : v;
  };
  // 余额用裸 RPC 读：ethers v6 的 getBalance 有结果缓存，会掩盖到账
  const rawBal = async (addr) =>
    BigInt(await chain.request({ method: "eth_getBalance", params: [addr, "latest"] }));

  const accts = await chain.request({ method: "eth_accounts" });
  const [opAddr, rA, rB, rC, rD] = accts;
  const operator = await provider.getSigner(opAddr);   // 原单私钥（V2 的部署者/首任 operator）
  const a = await provider.getSigner(rA);              // owner #1
  const b = await provider.getSigner(rB);              // owner #2
  const cc = await provider.getSigner(rC);             // owner #3
  const d = await provider.getSigner(rD);              // 非 owner

  const deployMs = async (owners, th) => {
    const c = await new ethers.ContractFactory(MS_ABI, MS_BIN, operator).deploy(owners, th);
    await c.waitForDeployment();
    return c;
  };
  // ★ 构造函数 revert 的文案只能从 eth_call 拿（真实发送的那笔收据里没有 revert data）：
  //   逐份契约的 eth_call 语义和交易完全一样，构造参数守卫照样会被 EVM 执行。
  const expectDeployRevert = (name, owners, th, keyword) =>
    expectRevert(name, async () => {
      const f = new ethers.ContractFactory(MS_ABI, MS_BIN, operator);
      const req = await f.getDeployTransaction(owners, th);
      return provider.call({ data: req.data });
    }, keyword);

  // ---------- 1 部署多签（2/3）----------
  console.log("\n[1] 部署 OperatorMultisig（owners = 3 个地址，threshold = 2）");
  const ms = await deployMs([rA, rB, rC], 2);
  await ms.waitForDeployment();
  const msAddr = await ms.getAddress();
  ok("部署成功", msAddr.length === 42 && (await provider.getCode(msAddr)) !== "0x", msAddr);

  const code = await provider.getCode(msAddr);
  const wantRuntime = Number(fs.readFileSync(path.join(SOL_DIR, "OperatorMultisig.runtime-size.txt"), "utf8").trim());
  console.log(`     链上代码长度 = ${(code.length - 2) / 2} 字节（编译报告 ${wantRuntime}）`);
  const msCodeLen = (code.length - 2) / 2;
  ok("部署后链上代码长度与编译报告一致", msCodeLen === wantRuntime, `${msCodeLen} / 编译报告 ${wantRuntime}`);

  const owners0 = await ms.getOwners();
  ok("getOwners() = 3 个 owner 且顺序保持",
     owners0.length === 3 && owners0.map(low).join(",") === [rA, rB, rC].map(low).join(","),
     `[${owners0.join(", ")}]`);
  const th0 = await ms.threshold();
  ok("threshold() = 2", th0 === 2n, String(th0));
  const tc0 = await ms.txCount();
  ok("txCount() 初始 = 0", tc0 === 0n, String(tc0));
  ok("isOwner()：3 个 owner 为 true，非 owner 为 false",
     (await ms.isOwner(rA)) && (await ms.isOwner(rC)) && !(await ms.isOwner(rD)));

  // ---------- 2 构造参数守卫 ----------
  console.log("\n[2] 构造参数守卫（owner 去重 / 非零 / threshold 区间）");
  await expectDeployRevert("owners 为空要拒绝", [], 1, "no owners");
  await expectDeployRevert("threshold = 0 要拒绝", [rA, rB], 0, "bad threshold");
  await expectDeployRevert("threshold > owners 数要拒绝", [rA, rB], 3, "bad threshold");
  await expectDeployRevert("owner 含零地址要拒绝", [rA, ZERO], 1, "zero owner");
  await expectDeployRevert("owner 重复要拒绝", [rA, rB, rA], 2, "duplicate owner");

  // ---------- 3 receive() ----------
  console.log("\n[3] receive()：多签能持有 BOT（执行时带 value / 收 gas 补贴）");
  await (await operator.sendTransaction({ to: msAddr, value: ethers.parseEther("0.1") })).wait();
  const msBal1 = await rawBal(msAddr);
  ok("多签余额 = 0.1 ETH", msBal1 === ethers.parseEther("0.1"), `${eth(msBal1)} ETH`);

  // ---------- 4 部署 V2 并把 operator 交给多签 ----------
  console.log("\n[4] 部署 RainDeliveryInsuranceV2，并把 operator 交给多签");
  const c = await new ethers.ContractFactory(ABI, BIN, operator).deploy();
  await c.waitForDeployment();
  const addr = await c.getAddress();
  ok("部署成功", addr.length === 42 && (await provider.getCode(addr)) !== "0x", addr);
  const opNow0 = await c.operator();
  ok("部署时 operator = 部署者 EOA（这就是原来的单点）", low(opNow0) === low(opAddr), opNow0);
  await (await c.connect(operator).transferOperator(msAddr)).wait();
  const opNow1 = await c.operator();
  ok("transferOperator(multisig) 生效：operator() 已指向多签", low(opNow1) === low(msAddr), opNow1);

  // ---------- 5 单签直连全被拒 ----------
  console.log("\n[5] 原单私钥直连 operator 函数 → 全部 not operator（本任务要消掉的单点）");
  await expectRevert("原 EOA 直接 setPaused(true) 被拒",
    () => c.connect(operator).setPaused.staticCall(true), "not operator");
  await expectRevert("原 EOA 直接 updateRainfall 被拒",
    () => c.connect(operator).updateRainfall.staticCall(1, 500, H("eoa:1:500"), 90, 3), "not operator");
  await expectRevert("原 EOA 直接 setReserve 被拒",
    () => c.connect(operator).setReserve.staticCall(ethers.parseEther("1")), "not operator");
  await expectRevert("原 EOA 直接 withdrawPool 被拒",
    () => c.connect(operator).withdrawPool.staticCall(1), "not operator");
  await expectRevert("原 EOA 直接 transferOperator 被拒",
    () => c.connect(operator).transferOperator.staticCall(opAddr), "not operator");

  // ---------- 6 多签 2 票：setPaused ----------
  console.log("\n[6] 多签 2 票通过：setPaused(true)");
  const id1 = await ms.txCount();
  await (await ms.connect(a).submit(addr, 0, c.interface.encodeFunctionData("setPaused", [true]))).wait();
  let t1 = await ms.getTx(id1);
  ok("submit 后自动 1 票、未执行", t1.confirmations === 1n && t1.executed === false,
     `confirmations=${t1.confirmations} executed=${t1.executed}`);
  const paused1 = await c.paused();
  ok("只有 1 票时目标状态没变（paused 仍 false）", paused1 === false, `paused=${paused1}`);
  ok("isConfirmed() 逐地址可查", (await ms.isConfirmed(id1, rA)) && !(await ms.isConfirmed(id1, rB)));
  await expectRevert("同一 owner 重复 confirm 被拒",
    () => ms.connect(a).confirm.staticCall(id1), "already confirmed");
  await expectRevert("票数不足时 execute 被拒",
    () => ms.connect(b).execute.staticCall(id1), "not enough confirmations");
  await (await ms.connect(b).confirm(id1)).wait();
  t1 = await ms.getTx(id1);
  ok("第 2 票到位 → 立即执行（confirmations=2, executed=true）",
     t1.confirmations === 2n && t1.executed === true, `confirmations=${t1.confirmations} executed=${t1.executed}`);
  const paused2 = await c.paused();
  ok("链上状态真的变了：paused() == true", paused2 === true, `paused=${paused2}`);
  await expectRevert("已执行的交易不能再 execute",
    () => ms.connect(cc).execute.staticCall(id1), "already executed");
  await expectRevert("已执行的交易不能再 confirm",
    () => ms.connect(cc).confirm.staticCall(id1), "already executed");
  await expectRevert("已执行的交易不能再 revoke",
    () => ms.connect(a).revoke.staticCall(id1), "already executed");
  await expectRevert("给不存在的 txId 投票要拒绝",
    () => ms.connect(a).confirm.staticCall(999), "no such tx");

  // ---------- 7 多签 2 票：喂价 + 带 value 的执行 ----------
  console.log("\n[7] 多签 2 票通过：updateRainfall（五城雨量计数器）+ 带 value 调 fundPool");
  const rainBefore = await c.rainfall(1);
  const id2 = await ms.txCount();
  await (await ms.connect(a).submit(addr, 0,
    c.interface.encodeFunctionData("updateRainfall", [1, 80, H("ms:1:80"), 90, 3]))).wait();
  await (await ms.connect(cc).confirm(id2)).wait();
  const rainAfter = await c.rainfall(1);
  ok("通过多签喂价成功：rainfall(1) 变了", rainAfter === 80n && rainAfter !== rainBefore,
     `${rainBefore} → ${rainAfter} mm`);

  const msBalBefore = await rawBal(msAddr);
  const id2b = await ms.txCount();
  await (await ms.connect(a).submit(addr, ethers.parseEther("0.05"),
    c.interface.encodeFunctionData("fundPool", []))).wait();
  await (await ms.connect(b).confirm(id2b)).wait();
  const poolAfterFund = await c.poolBalance();
  ok("执行时把 0.05 ETH 带进资金池", poolAfterFund === ethers.parseEther("0.05"), `${eth(poolAfterFund)} ETH`);
  const msBalAfterFund = await rawBal(msAddr);
  ok("多签余额同步减少", msBalAfterFund === msBalBefore - ethers.parseEther("0.05"),
     `${eth(msBalBefore)} → ${eth(msBalAfterFund)} ETH`);

  // ---------- 8 非 owner 四个入口全被拒 ----------
  console.log("\n[8] 非 owner 调 submit / confirm / revoke / execute → 全部 not owner");
  await expectRevert("非 owner submit 被拒",
    () => ms.connect(d).submit.staticCall(addr, 0, c.interface.encodeFunctionData("setPaused", [false])), "not owner");
  await expectRevert("非 owner confirm 被拒", () => ms.connect(d).confirm.staticCall(id1), "not owner");
  await expectRevert("非 owner revoke 被拒", () => ms.connect(d).revoke.staticCall(id1), "not owner");
  await expectRevert("非 owner execute 被拒", () => ms.connect(d).execute.staticCall(id1), "not owner");

  // ---------- 9 目标 revert → 整笔回滚 ----------
  console.log("\n[9] 目标 revert → 整笔回滚（不标记 executed、不吞失败、钱不动）");
  const id3 = await ms.txCount();
  // 雨量累计值不允许倒退：现在 rainfall(1)=80，喂 0 必然被目标 require 拒绝（带 require 文案）。
  await (await ms.connect(a).submit(addr, 0,
    c.interface.encodeFunctionData("updateRainfall", [1, 0, H("fail:1:0"), 90, 3]))).wait();
  await expectRevert("目标 revert 的原因被原样冒泡（eth_call 复现）",
    () => ms.connect(b).confirm.staticCall(id3), "cumulative must not decrease");
  await expectTxFail("第 2 票触发执行、目标 revert → confirm 整笔回滚",
    () => ms.connect(b).confirm(id3));
  const t3 = await ms.getTx(id3);
  ok("executed 仍为 false", t3.executed === false);
  // ★ 第 2 票和执行的 true 是同一笔交易里的，一起回滚 → 票数回到 1，rB 的票没留下
  ok("票数回到第 2 票之前（confirm 整笔回滚）", t3.confirmations === 1n, `confirmations=${t3.confirmations}`);
  const rBConfirmed = await ms.isConfirmed(id3, rB);
  ok("rB 的确认没有被记下", rBConfirmed === false);
  const rain1AfterFail = await c.rainfall(1);
  ok("目标状态没变：rainfall(1) 仍 80mm", rain1AfterFail === 80n, `${rain1AfterFail}mm`);
  // 失败的那笔仍挂在那儿（票数 1），撤票就能清掉 —— 顺便验证 revoke 对失败交易也有效
  await (await ms.connect(a).revoke(id3)).wait();
  const t3AfterRevoke = await ms.getTx(id3);
  ok("对失败的待执行交易也能 revoke（票数清零）",
     t3AfterRevoke.confirmations === 0n, `confirmations=${t3AfterRevoke.confirmations}`);

  // 失败时「钱一分不动」单独测一笔：updateRainfall 非 payable，带 value 必被 EVM 拒绝
  // （注意这种 revert 不带任何数据，所以只能断言「失败了」，不能断言文案）。
  const balBeforeFail = await rawBal(msAddr);
  const poolBeforeFail = await c.poolBalance();
  const id3b = await ms.txCount();
  await (await ms.connect(a).submit(addr, ethers.parseEther("0.01"),
    c.interface.encodeFunctionData("updateRainfall", [1, 90, H("fail:1:val"), 90, 3]))).wait();
  await expectTxFail("带 value 调非 payable 目标 → 执行失败并回滚", () => ms.connect(b).confirm(id3b));
  const t3b = await ms.getTx(id3b);
  ok("该笔 executed 仍为 false", t3b.executed === false);
  const msBalAfterFail = await rawBal(msAddr);
  ok("多签资产没变（0.01 ETH 没出去）", msBalAfterFail === balBeforeFail, `${eth(msBalAfterFail)} ETH`);
  const poolAfterFail = await c.poolBalance();
  ok("目标合约余额没变", poolAfterFail === poolBeforeFail, `${eth(poolAfterFail)} ETH`);
  const rain1AfterFail2 = await c.rainfall(1);
  ok("目标状态也没变：rainfall(1) 仍 80mm", rain1AfterFail2 === 80n, `${rain1AfterFail2}mm`);

  // ---------- 10 revoke / 重投 ----------
  console.log("\n[10] revoke：执行前可撤票，撤票后重投有效");
  const id4 = await ms.txCount();
  await (await ms.connect(a).submit(addr, 0, c.interface.encodeFunctionData("setPaused", [false]))).wait();
  const t4a = await ms.getTx(id4);
  ok("提交换来 1 票", t4a.confirmations === 1n, `confirmations=${t4a.confirmations}`);
  await (await ms.connect(a).revoke(id4)).wait();
  const t4b = await ms.getTx(id4);
  ok("撤票后票数降到 0", t4b.confirmations === 0n && !(await ms.isConfirmed(id4, rA)),
     `confirmations=${t4b.confirmations}`);
  await expectRevert("没投过票的人 revoke 被拒", () => ms.connect(b).revoke.staticCall(id4), "not confirmed");
  await (await ms.connect(a).confirm(id4)).wait();
  const t4c = await ms.getTx(id4);
  ok("撤票后重新 confirm 能再记 1 票", t4c.confirmations === 1n, `confirmations=${t4c.confirmations}`);
  await (await ms.connect(b).confirm(id4)).wait();
  const paused3 = await c.paused();
  ok("第 2 票到位 → setPaused(false) 执行成功", paused3 === false, `paused=${paused3}`);

  // ---------- 11 治理只能走多签自己 ----------
  console.log("\n[11] 治理（换 owner / 改 threshold）只能由多签自己发起，没有 owner 直连后门");
  await expectRevert("owner 直连 setThreshold 被拒", () => ms.connect(a).setThreshold.staticCall(3), "only self");
  await expectRevert("owner 直连 addOwner 被拒", () => ms.connect(a).addOwner.staticCall(rD), "only self");
  await expectRevert("owner 直连 removeOwner 被拒", () => ms.connect(a).removeOwner.staticCall(rC), "only self");

  const id5 = await ms.txCount();
  await (await ms.connect(a).submit(msAddr, 0, ms.interface.encodeFunctionData("setThreshold", [3]))).wait();
  await (await ms.connect(b).confirm(id5)).wait();
  const th3 = await ms.threshold();
  ok("多签自己调 setThreshold(3) 生效", th3 === 3n, `threshold=${th3}`);
  await expectRevert("直接调 setThreshold 传非法值也要拒（onlySelf 之外还有区间校验）",
    () => ms.connect(a).setThreshold.staticCall(9), "only self");

  // threshold=3 之后，2 票不再够改 owner 集合
  const id6 = await ms.txCount();
  await (await ms.connect(a).submit(msAddr, 0, ms.interface.encodeFunctionData("addOwner", [rD]))).wait();
  await (await ms.connect(b).confirm(id6)).wait();
  const t6 = await ms.getTx(id6), owners6 = await ms.getOwners();
  ok("threshold=3 后 2 票不够，addOwner 没有执行（owner 仍 3 个）",
     t6.executed === false && owners6.length === 3, `executed=${t6.executed} owners=${owners6.length}`);

  // removeOwner 的「不能把门槛搞成不可能」守卫：owners=3、threshold=3 时去掉一人 ⇒ 整笔回滚
  const id7 = await ms.txCount();
  await (await ms.connect(a).submit(msAddr, 0, ms.interface.encodeFunctionData("removeOwner", [rC]))).wait();
  await (await ms.connect(b).confirm(id7)).wait();
  await expectRevert("removeOwner 会让人凑不齐 threshold → 第 3 票执行时被拒（eth_call 复现）",
    () => ms.connect(cc).confirm.staticCall(id7), "threshold too high");
  await expectTxFail("第 3 票真实上链 → 整笔回滚", () => ms.connect(cc).confirm(id7));
  const t7 = await ms.getTx(id7), owners7 = await ms.getOwners();
  ok("被拒后 owner 集合与交易状态都没变", t7.executed === false && owners7.length === 3,
     `executed=${t7.executed} owners=${owners7.length}`);

  await (await ms.connect(cc).confirm(id6)).wait();
  const owners4 = await ms.getOwners();
  ok("第 3 票到位 → addOwner(rD) 执行，owner 变 4 个", owners4.length === 4 && (await ms.isOwner(rD)), `${owners4.length} 个`);

  const id8 = await ms.txCount();
  await (await ms.connect(a).submit(msAddr, 0, ms.interface.encodeFunctionData("removeOwner", [rD]))).wait();
  await (await ms.connect(b).confirm(id8)).wait();
  await (await ms.connect(cc).confirm(id8)).wait();
  const owners3 = await ms.getOwners();
  ok("3 票通过 removeOwner(rD)：owner 回到 3 个", owners3.length === 3 && !(await ms.isOwner(rD)), `${owners3.length} 个`);

  // ---------- 12 execute 补触发入口 ----------
  console.log("\n[12] execute 补触发：票数够了但还没执行时的兜底入口（真的能走通）");
  const ms2 = await deployMs([rA, rB, rC], 3);
  await ms2.waitForDeployment();
  const ms2Addr = await ms2.getAddress();
  const idK = await ms2.txCount();
  // K：一笔想执行的交易，但门槛是 3 → 只攒到 2 票，不会自动执行
  await (await ms2.connect(a).submit(ms2Addr, 0, ms2.interface.encodeFunctionData("addOwner", [rD]))).wait();
  await (await ms2.connect(b).confirm(idK)).wait();
  const tK = await ms2.getTx(idK);
  ok("ms2（3/3）上 K 攒到 2 票仍未执行", tK.executed === false);
  // L：把门槛降到 1（这笔自身要 3 票才能过）
  const idL = await ms2.txCount();
  await (await ms2.connect(a).submit(ms2Addr, 0, ms2.interface.encodeFunctionData("setThreshold", [1]))).wait();
  await (await ms2.connect(b).confirm(idL)).wait();
  await (await ms2.connect(cc).confirm(idL)).wait();
  const thMs2 = await ms2.threshold();
  ok("ms2 通过 3 票把 threshold 降到 1", thMs2 === 1n, `threshold=${thMs2}`);
  // 现在 K 的 2 票 ≥ 新门槛 1，但 K 还没执行 → execute 补触发
  const tK2 = await ms2.getTx(idK);
  ok("K 仍是未执行状态（票数已够）", tK2.executed === false);
  await (await ms2.connect(cc).execute(idK)).wait();
  const tK3 = await ms2.getTx(idK), ownersMs2 = await ms2.getOwners();
  ok("execute(K) 补触发成功：addOwner(rD) 执行，owner 变 4 个",
     tK3.executed === true && ownersMs2.length === 4, `executed=${tK3.executed} owners=${ownersMs2.length}`);
  await expectRevert("补触发过的交易再 execute 会拒绝",
    () => ms2.connect(cc).execute.staticCall(idK), "already executed");

  // 同一 payload 再 submit 会拿到新 txId（不做内容去重，同 Gnosis Safe），老交易不受影响。
  // payload 用 setThreshold(1)：幂等（门槛已经是 1 也照样成功），能在 threshold=1 下重复跑通。
  const idM = await ms2.txCount();
  await (await ms2.connect(a).submit(ms2Addr, 0, ms2.interface.encodeFunctionData("setThreshold", [1]))).wait();
  const freshExecuted = (await ms2.getTx(idM)).executed;
  const oldStill = (await ms2.getTx(idK));
  ok("同一 payload 再 submit = 新 txId 并独立执行，老交易不会被二次执行",
     idM === idK + 2n && freshExecuted === true && oldStill.executed === true && oldStill.confirmations === 2n,
     `老 id ${idK}(executed=${oldStill.executed}, 票=${oldStill.confirmations}) / 新 id ${idM}`);
  await expectRevert("老交易不能被当成新交易再跑一遍（没有重复执行的缝）",
    () => ms2.connect(a).execute.staticCall(idK), "already executed");

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(78));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  if (fail.length) { console.log("\n失败清单："); fail.forEach(f => console.log("  - " + f)); }
  console.log("=".repeat(78));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error("\n💥 演练脚本自身抛错：", e); process.exit(2); });
