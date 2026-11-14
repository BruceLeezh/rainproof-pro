#!/usr/bin/env node
/**
 * 雨证 · 路演日晨检（2026-11-16 08:45）
 *
 * 目的：一条命令回答三个问题——
 *   1) 链还活着吗？      → preflight 的 ❌ 行
 *   2) 演示城市还能投吗？ → stage-card 的七城表
 *   3) 出问题该跑哪条补救命令？
 *
 * 用法：双击仓库根目录的 morning-check.bat，或
 *       node morning-check.js
 */
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = __dirname;
const SCRIPTS = path.join(ROOT, "04-脚本");
const TOOLS = path.join(ROOT, "07-测试工具");

function run(label, args, cwd) {
  console.log("\n" + "=".repeat(64));
  console.log(label);
  console.log("=".repeat(64));
  const r = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const out = (r.stdout || "") + (r.stderr || "");
  process.stdout.write(out);
  return { code: r.status, out };
}

console.log("雨证 · 路演日晨检   " + new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }));

const pre = run("[1/3] preflight —— 只看 ❌ 行；⏳ 是数据未到，不用管", ["preflight.js"], SCRIPTS);
const card = run("[2/3] 上台读数卡 —— 汉南/黄陂/广州/北京/上海/成都 是否可投", ["../07-测试工具/stage-card.js"], SCRIPTS);

// ---- 判定 ----
const bad = (pre.out.match(/❌/g) || []).length;
const wait = (pre.out.match(/⏳/g) || []).length;
const notBuy = [];
for (const name of ["武汉（主城）", "汉南区", "黄陂区", "广州", "北京", "上海", "成都"]) {
  const line = card.out.split("\n").find((l) => l.startsWith("| " + name));
  if (line && line.includes("⛔")) notBuy.push(name);
}
const poolLine = (card.out.match(/池子：\*\*([\d.,]+)\*\*/) || [])[1];
const freshLine = (card.out.match(/喂价新鲜：\*\*(\d+)\/(\d+)\*\*/) || []).slice(1);
const feedAge = (card.out.match(/最近一次成功喂价：([^\n（]+)/) || [])[1];

console.log("\n" + "-".repeat(64));
console.log("结论");
console.log("-".repeat(64));
console.log(`  preflight ❌ ${bad} 项 ｜ ⏳ ${wait} 项（不阻塞）`);
console.log(`  池子 ${poolLine || "读不到"} 模拟元 ｜ 喂价新鲜 ${freshLine.join("/") || "读不到"}`);
console.log(`  最近成功喂价：${feedAge || "读不到"}`);
if (notBuy.length === 0) {
  console.log("  演示七区划：全部可投 ✅ —— 可以上台");
} else {
  console.log("  演示七区划不可投：" + notBuy.join("、"));
}

if (bad > 0) {
  console.log("\n  ⚠️ 有 ❌，先看第一条；多半是 gas 或 RPC。补救：");
  console.log("     cd 04-脚本 && node fund-v6-ops-gas.js --send");
}
if (notBuy.length) {
  const ids = { "武汉（主城）": 420100, 汉南区: 420113, 黄陂区: 420116, 广州: 440100, 北京: 110100, 上海: 310100, 成都: 510100 };
  console.log("\n  补喂命令（各约 0.013 BOT，补完重跑本文件）：");
  for (const n of notBuy) console.log(`     cd 04-脚本 && node push-rainfall-v6.js --city=${ids[n]} --send`);
}

console.log("\n  演示站点：05-演示站点/insurance.html（本地直接双击即可，读链要联网）");
const pack = path.join(ROOT, "01-参赛材料/交付物/演示备份");
const zips = fs.existsSync(pack) ? fs.readdirSync(pack).filter((f) => f.endsWith(".zip")).sort() : [];
if (zips.length) console.log("  断网包：" + path.join(pack, zips[zips.length - 1]));
console.log("");
