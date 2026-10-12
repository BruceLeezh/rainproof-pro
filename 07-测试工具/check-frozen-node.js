// 快照兜底的最小门禁：frozen-node.js 与页面的口径必须对得上，否则断网时页面会安静地显示错的东西。
// 断言（都是「错了就会让评委看到假数据」的那类）：
//   ① 文件存在且能被 JSON.parse（页面 window.FROZEN_NODE = {...} 的写法）
//   ② 链必须是 677、地址必须与页面 FALLBACK_ADDR 完全一致（防两份口径漂移）
//   ③ code 必须与仓库编译产物 03-合约/RainDeliveryInsuranceV3.bytecode.txt 尾部的运行时字节逐字节一致
//      （长度 = meta.codeLength，与旁车 RainDeliveryInsuranceV3.runtime-size.txt 也对得上）—— 防「长度自证」
//   ④ eth_call 至少 40 条；白名单必须如实记录 revert（v3 现行只卖 12/24，48/72 链上真的 revert）
//   ⑤ 保费网格必须满 10 格（5 地区 × 12h/24h）—— 这正是「城市和时长都有区分度」的证据
//   ⑥ 事件行 ≥8 且含 FeedRejected（成都被三模型闸门拒收的留痕）
//   ⑦ index.html 必须在主脚本之前加载 frozen-node.js，并且真的有兜底代码（FrozenProvider / snapshotAllowed）
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { ethers } = require("ethers");

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log("  ✅ " + msg); } else { fail++; console.log("  ❌ " + msg); } };

const frozenPath = path.join(ROOT, "05-演示站点", "frozen-node.js");
const indexPath = path.join(ROOT, "05-演示站点", "index.html");

console.log("=".repeat(60));
console.log("检查：链上快照兜底（05-演示站点/frozen-node.js ↔ index.html）");
console.log("=".repeat(60));

ok(fs.existsSync(frozenPath), "① frozen-node.js 存在");
let F = null;
try {
  const src = fs.readFileSync(frozenPath, "utf8");
  const m = src.match(/window\.FROZEN_NODE\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
  F = JSON.parse(m[1]);
  ok(true, "① 能解析出 window.FROZEN_NODE（JSON 合法）");
} catch (e) {
  ok(false, "① 解析 FROZEN_NODE 失败：" + e.message);
}
if (!F) { console.log("\n结果：" + pass + " 项通过 / " + fail + " 项失败"); process.exit(1); }

const html = fs.readFileSync(indexPath, "utf8");
const fallback = (html.match(/FALLBACK_ADDR\s*=\s*"([^"]+)"/) || [])[1] || "";
ok(Number(F.meta.chainId) === 677, "② 快照链是 677（主网）· 实际 " + F.meta.chainId);
ok(fallback.length === 42 && fallback.toLowerCase() === String(F.meta.address).toLowerCase(),
  "② 快照地址与页面 FALLBACK_ADDR 一致（两处口径不许漂）");
ok((F.code.length - 2) / 2 === F.meta.codeLength && F.meta.codeLength > 10000,
  "③ code 长度 = " + F.meta.codeLength + " 字节，与 meta.codeLength 一致");

// A34：光「长度对得上自己声明的 codeLength」是自证 —— 谁都能编一段等长的 0x00。这里改成对**真实字节**的断言：
// code 必须等于 03-合约/RainDeliveryInsuranceV3.bytecode.txt（部署用的那份）尾部的 codeLength 字节运行时。
// 取法就是生成侧的 runtimeFromArtifact()（make-frozen-node.js:55-59）：raw.slice(raw.length - codeLength*2)。
const bcRaw = (fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV3.bytecode.txt"), "utf8") || "").trim().replace(/^0x/i, "");
const sizeOnDisk = Number((fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV3.runtime-size.txt"), "utf8") || "").trim());
ok(/^[0-9a-fA-F]+$/.test(bcRaw) && bcRaw.length / 2 >= F.meta.codeLength,
  "③ bytecode.txt 是合法十六进制，且不短于 " + F.meta.codeLength + " 字节运行时（实际全长 " + bcRaw.length / 2 + " 字节）");
ok(sizeOnDisk === F.meta.codeLength,
  "③ meta.codeLength = " + F.meta.codeLength + " 与旁车 runtime-size.txt 一致（实际 " + sizeOnDisk + "）");
ok(F.code.toLowerCase() === ("0x" + bcRaw.slice(bcRaw.length - F.meta.codeLength * 2)).toLowerCase(),
  "③ code 与 bytecode.txt 尾部的 " + F.meta.codeLength + " 字节运行时逐字节一致（不再是自己造 0x00 自证）");

const iface = new ethers.Interface(JSON.parse(fs.readFileSync(path.join(ROOT, "03-合约", "RainDeliveryInsuranceV3.abi.json"), "utf8")));
const nCalls = Object.keys(F.calls).length;
ok(nCalls >= 40, "④ eth_call 条目 " + nCalls + " 条（≥40）");
const reverts = Object.values(F.calls).filter((v) => v && v.revert).length;
ok(reverts === 2, "④ 如实记录 2 条 revert（v3 只卖 12/24，48/72 链上真的 revert）· 实际 " + reverts);
for (const h of [12, 24]) {
  const key = F.meta.address.toLowerCase() + ":" + iface.encodeFunctionData("hoursAllowed", [h]).toLowerCase();
  ok(F.calls[key] && !F.calls[key].revert, "④ hoursAllowed(" + h + ") 在快照里是可用的（true）");
}
// A38：把「v3 只放 12/24」钉死到两档都不行的具体档位上，别再靠 reverts === 2 这个总数去间接说明。
for (const h of [48, 72]) {
  const key = F.meta.address.toLowerCase() + ":" + iface.encodeFunctionData("hoursAllowed", [h]).toLowerCase();
  ok(F.calls[key] && !!F.calls[key].revert,
    "④ hoursAllowed(" + h + ") 在快照里如实记录为 revert（v3 现行只卖 12/24；check-ui.js 的 24/48/72 是 v2 静态口径）");
}
const premSel = iface.getFunction("premiumOf(uint8,uint256,uint8,uint8,uint256)").selector;
const premKeys = Object.keys(F.calls).filter((k) => k.split(":")[1] && k.split(":")[1].startsWith(premSel));
ok(premKeys.length === 10, "⑤ 保费网格满 10 格（5 城 × 12h/24h）· 实际 " + premKeys.length);

const rejectTopic = iface.getEvent("FeedRejected").topicHash;
ok(F.logs.length >= 8, "⑥ 事件行 " + F.logs.length + " 条（≥8）");
ok(F.logs.some((l) => l.topics[0] === rejectTopic), "⑥ 含 FeedRejected（成都被闸门拒收的留痕）");
ok(Object.keys(F.blocks).length >= 4, "⑥ 事件区块只收录确凿时间（" + Object.keys(F.blocks).length + " 条 = 四次喂价的链上时刻），其余宁缺勿编");
ok(Object.values(F.blocks).every((t) => t > 1760000000 && t < 1800000000), "⑥ 时间戳都落在 2025-10 ~ 2027-01（1760000000–1800000000）—— 比原来 2023–2030 的松区间更紧，编的 0 或 2025 年也得被卡住");

const iTag = html.indexOf('<script src="frozen-node.js"></script>');
const iMain = html.indexOf("<script>", iTag);
ok(iTag > 0 && iMain > iTag, "⑦ 页面在主脚本之前加载 frozen-node.js");
ok(/class FrozenProvider extends ethers\.AbstractProvider/.test(html), "⑦ 页面里有 FrozenProvider（快照 provider）");
ok(/function snapshotAllowed\(\)/.test(html) && /snap"\) === "1"/.test(html), "⑦ 页面支持 ?snap=1 强制 / ?snap=0 关闭");

console.log("-".repeat(60));
console.log("结果：" + pass + " 项通过 / " + fail + " 项失败");
if (fail) process.exit(1);
console.log("快照兜底口径一致（断网时页面显示的就是这份快照，不再是一片「—」）");
process.exit(0);
