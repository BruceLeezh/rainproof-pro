# 节点代理（Vercel Serverless Function）

**要解决的问题**：主网 RPC `https://rpc.botchain.ai` 在我们这边**必须走代理才通**（2026-10-08 实测：直连 curl = `000`，走 7890 = `200`）；测试网 `https://rpc.bohr.life` 反过来（直连 200，走代理 000）。队友的机器没有代理 ⇒ 演示页只读主网时会显示「节点连不上」。

这个函数跑在 Vercel 的机房里（能直连主网节点），把只读 JSON-RPC 转发出去 —— 于是能连上 Vercel 的网络都能读 677 主网。

## 已经部署好了（2026-10-08）

| 项 | 值 |
|---|---|
| 项目 | `rainproof`（Vercel 账号 `juice-butterfly`，team `juice-68d3`，从 GitHub 导入） |
| 域名 | `https://rainproof-juice-68d3.vercel.app` |
| 节点 URL | **`https://rainproof-juice-68d3.vercel.app/api/rpc`** |
| 落地页 | `https://rainproof-juice-68d3.vercel.app/`（页内「测一下」按钮会 POST `eth_chainId`） |
| 实测 | 浏览器点按钮 → `HTTP 200 {"jsonrpc":"2.0","id":1,"result":"0x2a5"}`（`0x2a5` = 677 主网）；演示页带 `?rpc=<上面的节点 URL>` 打开显示 **BOT Chain Mainnet** |

⚠️ **两个必须的 Vercel 设置**（踩过坑，别忘）：

1. **Root Directory 必须填 `11-节点代理-vercel`**（Settings → Build and Deployment）。
   不填的话 Vercel 拿仓库根当项目，根目录下既没有 `api/` 也没有 `index.html` ⇒ 访问 `/` 和 `/api/rpc` **全是 404**（看着像部署失败，其实只是根指错了）。
2. **Deployment Protection → Vercel Authentication 必须关掉**（要求登录时，外部请求一律 401 `Protected deployment`）。

改完这两项要 **Redeploy** 才生效。

## 怎么用

- **页面已经默认接上了**：`05-演示站点/index.html` 里 `VERCEL_RELAY` 常量写的就是这个地址，排在 `RPC_NODES` **第二位**（主网官方节点之后、测试网之前）；探测是并行阶梯，所以多这一条不会拖慢任何人。
- 临时指定（不用改代码）：
  `https://juice-butterfly.github.io/rainproof/?rpc=https://rainproof-juice-68d3.vercel.app/api/rpc`
- 换上游：设 Vercel 环境变量 `RPC_UPSTREAM`（默认 `https://rpc.botchain.ai`）。

## 边界（别越界）

- **只放读方法**：`eth_sendRawTransaction`、`eth_sendTransaction` 等一律返回 403，避免变成谁都能拿来发交易的中继。
- 部署区域写在 `vercel.json`（默认 `hkg1` 香港，离节点近）。
- 本地自测：`node D:\DSH\_tmp\test-rpc-proxy.js`（不需要 Vercel，直接拿 mock 请求打这个 handler）。
- ⚠️ **本机 curl 测这个端点会得到 HTTP 400（空 body）**，那是本地代理（7890）转发 POST 的问题，不是函数的问题 —— 用浏览器打开落地页点按钮测，或者在能直连 Vercel 的机器上测。
