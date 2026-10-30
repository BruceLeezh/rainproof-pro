#!/usr/bin/env node
/**
 * gen-owner-addresses.js —— 生成换主用全新钱包地址（2026-10-25）
 *
 * 产出：
 *   ① 控制台【只打印地址】（私钥/助记词永不打印到屏幕——对话与日志都不该出现它们）
 *   ② 完整密钥材料写入仓库外的本地文件（默认 ..\密钥-本地\owner-keys-<日期>.json）：
 *      一条全新助记词 + 从它派生的 N 个账户（m/44'/60'/0'/0/i）。
 *      一个助记词管所有地址，备份一次即可。
 *
 * 用法：node gen-owner-addresses.js [--count 3] [--out 路径]
 * 安全：生成后尽快把 json 转移到离线介质；不要把它放进雨证仓库目录（防误提交）。
 */
"use strict";
const path = require("path");
const fs = require("fs");
const { ethers, HDNodeWallet } = require(path.join(__dirname, "node_modules", "ethers"));

const argv = process.argv.slice(2);
const opt = (n) => { const m = argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.slice(n.length + 3) : null; };
const count = Math.max(1, Math.min(10, Number(opt("count") || 3)));
const outDir = opt("out") || path.join(__dirname, "..", "..", "密钥-本地");
const outFile = path.join(outDir, `owner-keys-${new Date().toISOString().slice(0, 10)}.json`);

const phrase = ethers.Wallet.createRandom().mnemonic.phrase;
const root = HDNodeWallet.fromPhrase(phrase);                 // 仅用于取 mnemonic 结构
const base = HDNodeWallet.fromPhrase(phrase, null, "m/44'/60'/0'/0"); // 派生基点（深度 4）
const accounts = [];
for (let i = 0; i < count; i++) {
  const w = base.derivePath(String(i));
  accounts.push({ index: i, path: `m/44'/60'/0'/0/${i}`, address: w.address, privateKey: w.privateKey });
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({
  _warn: "本文件含助记词与私钥。只存本地/离线介质；绝不放进 git 仓库；绝不粘进任何聊天窗口或在线工具。",
  createdAt: new Date().toISOString(),
  purpose: "雨证多签换主用新地址（B 侧独立生成）",
  mnemonic: root.mnemonic.phrase,
  derivationBase: "m/44'/60'/0'/0/i",
  accounts,
}, null, 2), "utf8");

console.log(`已生成 ${count} 个全新地址（同一助记词派生，m/44'/60'/0'/0/0..${count - 1}）：`);
accounts.forEach((a) => console.log(`  B${a.index + 1}  ${a.address}`));
console.log(`\n密钥材料已写入（含助记词与私钥，屏幕上不显示）：\n  ${outFile}`);
console.log(`\n下一步：把上面的地址发给交接对方并抄进《交接-B侧行动清单》§三.1；json 文件尽快转移到离线介质。`);
