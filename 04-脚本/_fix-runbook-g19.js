#!/usr/bin/env node
/** 修复运营手册 §八（被 bash 反引号污染）：截断到 §八 前，重写干净版。 */
const fs = require("fs");
const path = require("path");
const F = path.join(__dirname, "..", "02-作战与答辩", "运营手册-初版-2026-10-25.md");
let s = fs.readFileSync(F, "utf8");
const i = s.indexOf("## 八、本地定时任务");
if (i < 0) throw new Error("§八 未找到");
const before = s.slice(0, i).replace(/\r?\n$/, "");
// 前段完整性哨兵：§七 红线必须在场
if (!before.includes("## 七、纪律")) throw new Error("前段完整性校验失败：§七 缺失");
const section = [
"", "## 八、本地定时任务（G19，2026-10-26 起）—— 替代已停用的 GitHub Actions", "",
"| 任务 | 载体 | 内容 | 注册 |",
"|---|---|---|---|",
"| 每日例检 09:00 | Windows 任务计划 → 04-脚本/ops-daily.ps1 | ① npm test 全量门禁 ② notify 巡检（异常码 2）③ 喂价干跑决策+留痕；输出追加 02-作战与答辩/自动完善-定时日志.txt | 见 ops-daily.ps1 头部注释（schttasks 一行注册/卸载/查看） |",
"| 喂价轮询（人工值守时） | node push-rainfall-v5.js --watch=30 | 30 分钟一轮；真上链必须人工加 --send（两票自动提交） | 免注册，需要时前台跑 |",
"| 预警哨兵（雨季） | node warning-watch.js --watch=10 | 明日降水中位 ≥50mm 出停售两票命令（只建议不动链） | 免注册 |", "",
"纪律：例检结论为 ⚠ 时当天必须处置（门禁红=先修门禁；巡检告警=按 §六应急）；机器休眠会漏跑——恢复后看日志缺口，手动补跑一次 ops-daily.ps1 即可。", "",
].join("\r\n");
fs.writeFileSync(F, before + section, "utf8");
console.log("OK §八 已重写干净（前段 " + before.length + " 字符保留）");
