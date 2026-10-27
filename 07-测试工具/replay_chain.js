#!/usr/bin/env node
/**
 * 历史回放 · 本地链 + 时钟控制
 * ============================================================================
 *
 * 为什么要它：保单的保障窗口由 `block.timestamp` 决定。想回放「2024-06-27 武汉
 * 那场暴雨」，链上时间就必须真的停在 2024 年 —— 否则 buyPolicy 记下的 startTime
 * 是"现在"，而 push-rainfall / ai-collect 会按 startTime 去取窗口，
 * 回放出来的就成了一场不存在的雨。
 *
 * 用法（在 07-测试工具 目录下跑）：
 *   node replay_chain.js serve "2024-06-27T00:00:00+08:00" [port]   起链并常驻（默认 8546）
 *   node replay_chain.js set   "2024-06-29T23:30:00+08:00" [port]   把运行中的链时钟拨过去
 *
 * 链上账户 = 04-脚本/.env 里的 PRIVATE_KEY（运营/部署）与 RIDER_KEY（骑手），
 * 各注 100 ETH 的假币。chainId 仍是 11155111，好让其余脚本的链身份检查一致通过。
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "04-脚本", ".env") });
const ganache = require("ganache");
const { JsonRpcProvider } = require("ethers");

const [MODE, WHEN, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG || 8546);
const RPC = `http://127.0.0.1:${PORT}`;

/** 读链上时间必须绕开 ethers 的 "latest" 缓存 */
async function chainTime(provider) {
  const b = await provider.send("eth_getBlockByNumber", ["latest", false]);
  return { ts: Number(b.timestamp), iso: new Date(Number(b.timestamp) * 1000).toISOString(), block: Number(b.number) };
}

(async () => {
  if (MODE === "serve") {
    const t0 = new Date(WHEN);
    if (isNaN(t0)) { console.error("用法：node replay_chain.js serve \"2024-06-27T00:00:00+08:00\" [port]"); process.exit(2); }
    const accounts = [process.env.PRIVATE_KEY, process.env.RIDER_KEY]
      .filter(Boolean).map((secretKey) => ({ secretKey, balance: "0x56BC75E2D63100000" }));  // 100 ETH
    const server = ganache.server({
      logging: { quiet: true },
      chain: { chainId: 11155111, hardfork: "shanghai", time: t0 },
      miner: { blockGasLimit: 30000000 },
      wallet: accounts.length ? { accounts } : { deterministic: true },
    });
    await server.listen(PORT, "127.0.0.1");
    const t = await chainTime(new JsonRpcProvider(RPC));
    console.log(`历史回放链已启动 ${RPC}`);
    console.log(`  链上时间 ${t.iso}（= ${new Date(t.ts * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ")} +0800）· 块高 ${t.block}`);
    console.log(`  注资账户 ${accounts.length} 个 · chainId 11155111`);
    return;
  }

  if (MODE === "set") {
    const target = new Date(WHEN);
    if (isNaN(target)) { console.error("用法：node replay_chain.js set \"2024-06-29T23:30:00+08:00\" [port]"); process.exit(2); }
    const provider = new JsonRpcProvider(RPC);
    const before = await chainTime(provider);
    const delta = await provider.send("evm_setTime", [target.getTime()]);
    await provider.send("evm_mine", []);
    const after = await chainTime(provider);
    console.log(`链上时间 ${before.iso} → ${after.iso}（区块 ${before.block} → ${after.block}，evm_setTime 返回 ${delta}）`);
    return;
  }

  console.error("用法：\n  node replay_chain.js serve \"2024-06-27T00:00:00+08:00\" [port]\n  node replay_chain.js set   \"2024-06-29T23:30:00+08:00\" [port]");
  process.exit(2);
})().catch((e) => { console.error("💥", e.shortMessage || e.message); process.exit(1); });
