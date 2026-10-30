// 读 677 上指定区块的时间戳（只读；需代理环境变量）
const RPC = process.env.RPC || "https://rpc.botchain.ai";
const blocks = process.argv.slice(2).map(Number);
(async () => {
  const call = async (method, params) => {
    const r = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
    return j.result;
  };
  console.log("RPC =", RPC);
  for (const n of blocks) {
    const b = await call("eth_getBlockByNumber", ["0x" + n.toString(16), false]);
    const t = parseInt(b.timestamp, 16);
    const iso = new Date(t * 1000 + 8 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
    console.log(`  区块 ${n}  ts=${t}  ${iso} +0800  txs=${b.transactions.length}`);
  }
})();
