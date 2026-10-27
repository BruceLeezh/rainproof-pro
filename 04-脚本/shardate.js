/** 全仓唯一的日期口径 —— 东八区（Asia/Shanghai）。
 *
 * 为什么值得单独一个文件：同一条雨，喂价按「日累计」写链、判定按「日序列」算纳什、
 * 留痕按「窗口」取模型预报 —— 三处都在把 unix 秒切成日期。切法一旦不一致
 * （东八区 / UTC / 主机本地时区），同一场雨会在喂价那边算进 10-02、在判定那边算进 10-01，
 * 而两边的哈希各自自洽，谁也不会报错。所以日期只允许从这一个文件取。
 *
 * 口径为什么是东八区：雨下在中国，RAIN_EPOCH 与所有对外材料都用北京时间。
 * CI / Docker 默认 UTC，主机本地时区随人走 —— 都不能作为事实来源。
 *
 *   node shardate.js --self-check
 */
const SH_OFFSET_SEC = 8 * 3600;

/**
 * unix 秒 / 毫秒 / Date → 东八区 YYYY-MM-DD。
 * 秒与毫秒靠量级区分（>= 1e11 视为毫秒，即 1973 年之后的毫秒时间戳）。
 */
function shDate(t) {
  if (t instanceof Date) return new Date(t.getTime() + SH_OFFSET_SEC * 1000).toISOString().slice(0, 10);
  const n = Number(t);
  const ms = Math.abs(n) >= 1e11 ? n : n * 1000;
  return new Date(ms + SH_OFFSET_SEC * 1000).toISOString().slice(0, 10);
}

/** 此刻的东八区日期 */
function shToday() {
  return shDate(Date.now());
}

/** 东八区 YYYY-MM-DD + n 天（负数往回） */
function shDatePlus(dateStr, days) {
  return shDate(Date.parse(dateStr + "T00:00:00Z") + days * 86400000);
}

/** 两个东八区日期之间相差几天（闭区间含首尾：同日 = 1） */
function shDaySpan(fromStr, toStr) {
  return Math.round((Date.parse(toStr + "T00:00:00Z") - Date.parse(fromStr + "T00:00:00Z")) / 86400000) + 1;
}

module.exports = { SH_OFFSET_SEC, shDate, shToday, shDatePlus, shDaySpan };

/* ------------------------------------------------- 自检（--self-check，不联网不写盘）
 * ★ 必须带 require.main === module：本文件是被 require 进来的（ai-collect / feed-verify /
 *   hook-watch / push-rainfall 四处）。少了这道判断，任何一个脚本带 --self-check 跑，
 *   本块都会在 require 那一刻跟着执行并 process.exit() —— 把调用方的自检结果整段吃掉。 */
if (require.main === module && process.argv.includes("--self-check")) {
  let pass = 0, fail = 0;
  const ok = (n, c, extra = "") => { c ? pass++ : fail++; console.log(`${c ? "✅" : "❌"} ${n}${extra ? "  " + extra : ""}`); };
  const T = (s) => Date.parse(s) / 1000;                    // ISO 字符串 → unix 秒

  ok("东八区 00:00 就是当天", shDate(T("2026-10-02T00:00:00+08:00")) === "2026-10-02");
  ok("东八区 23:59 还是当天（UTC 已经是次日 15:59）", shDate(T("2026-10-02T23:59:00+08:00")) === "2026-10-02");
  ok("★ UTC 的 10-02 16:00 = 东八区 10-03 00:00（跨日那一刻必须+8）", shDate(T("2026-10-02T16:00:00Z")) === "2026-10-03");
  ok("★ 如果按 UTC 切，上面这条会得到 10-02（这正是要钉住的分歧）",
    new Date(T("2026-10-02T16:00:00Z") * 1000).toISOString().slice(0, 10) === "2026-10-02");
  ok("毫秒时间戳与秒同解", shDate(T("2026-10-02T16:00:00Z") * 1000) === shDate(T("2026-10-02T16:00:00Z")));
  ok("接受 Date 对象", shDate(new Date(T("2026-10-02T16:00:00Z") * 1000)) === "2026-10-03");
  ok("epoch 起点 RAIN_EPOCH 落回 2026-10-01", shDate(T("2026-10-01T00:00:00+08:00")) === "2026-10-01");
  ok("shToday() 与 shDate(Date.now()) 一致", shToday() === shDate(Date.now()));
  ok("加一天", shDatePlus("2026-10-01", 1) === "2026-10-02", shDatePlus("2026-10-01", 1));
  ok("跨月加一天", shDatePlus("2026-10-31", 1) === "2026-11-01");
  ok("往回 14 天（判定窗口的下界就是它）", shDatePlus("2026-10-15", -14) === "2026-10-01");
  ok("日期跨度同一天算 1 天", shDaySpan("2026-10-01", "2026-10-01") === 1);
  ok("日期跨度 14 天", shDaySpan("2026-10-01", "2026-10-14") === 14);

  console.log(`\n${fail ? "❌" : "✅"} shardate 自检：${pass} 项通过 / ${fail} 项失败`);
  process.exit(fail ? 1 : 0);
}
