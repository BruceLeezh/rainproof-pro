// 只读 JSON-RPC 转发（Vercel Serverless Function）
//
// 为什么存在：BOT Chain 主网节点 rpc.botchain.ai 在**没有代理**的网络里连不上（实测直连 curl = 000），
// 而 Vercel 的函数跑在能直连它的机房里。把这个函数当节点用，任何网络下都能读主网 677。
//
// 用法：POST /api/rpc，body 就是标准 JSON-RPC（单个对象或数组都行）。
// 安全：**只放读方法**，eth_sendRawTransaction 之类一律 403 —— 免得变成一个谁都能拿来发交易的中继。
//       再加每 IP 限流，免得被当成免费公共节点刷（公共 RPC 的额度是别人的）。
const UPSTREAM = process.env.RPC_UPSTREAM || "https://rpc.botchain.ai";

// 每 IP 令牌桶。N=60/分钟的依据：页面一次加载最坏十几次请求（链状态 + 事件 + 若干 eth_call），
// 一个演示房间里几十个人各自 60 也够；再多就是有人在循环刷，本来就该停。
// 进程内实现：Vercel 每个实例一份，够挡脚本误刷；要跨实例精确限流得上外部存储，为一个只读演示代理不值当。
// ponytail: 进程内桶，实例横向扩容后实际额度 = 60 × 实例数；真需要精确限流时换成 Redis/Upstash 计数器。
const PER_MINUTE = 60;
const buckets = new Map(); // ip -> { tokens, ts }
function allow(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    if (buckets.size > 5000) { for (const [k, v] of buckets) if (now - v.ts > 600000) buckets.delete(k); }
    b = { tokens: PER_MINUTE, ts: now };   // 新桶是满的：第一次请求不该被自己限流
    buckets.set(ip, b);
  }
  b.tokens = Math.min(PER_MINUTE, b.tokens + ((now - b.ts) / 60000) * PER_MINUTE);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

const READ_ONLY = new Set([
  "eth_chainId", "net_version", "web3_clientVersion", "eth_blockNumber", "eth_gasPrice",
  "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount",
  "eth_call", "eth_estimateGas", "eth_getLogs", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockTransactionCountByNumber",
  "eth_syncing", "eth_maxPriorityFeePerGas", "eth_feeHistory",
]);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only / 只接受 POST" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
             (req.socket && req.socket.remoteAddress) || "unknown";
  if (!allow(ip)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "rate limited: max " + PER_MINUTE + " req/min per IP / 限流：每 IP 每分钟最多 " + PER_MINUTE + " 次" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "bad json" }); } }
  if (!body) return res.status(400).json({ error: "empty body" });
  const items = Array.isArray(body) ? body : [body];
  for (const it of items) {
    const m = it && it.method;
    if (!READ_ONLY.has(m)) return res.status(403).json({ error: "method not allowed (read-only proxy): " + m });
  }

  try {
    const r = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // 上游状态如实透传（403/429/5xx 不吞成 200，否则页面会把失败当成功）；只挡掉非法的伪状态码。
    const status = Number.isInteger(r.status) && r.status >= 100 && r.status <= 599 ? r.status : 502;
    if (status === 204 || status === 304) return res.status(status).end();
    return res.status(status).send(text);
  } catch (e) {
    return res.status(502).json({ error: "upstream failed: " + (e && e.message) });
  }
};
