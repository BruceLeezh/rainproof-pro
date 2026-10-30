// 轮询口径一致性检查（2026-10-27 加，A 侧判据）。
// 用法：node 07-测试工具/check-cadence.js
// 它已挂进 `npm test`：纯离线，不碰网络、不碰链。
//
// 为什么要有这道门禁：计划任务 RainProof-Feed 在 2026-10-27 从 PT4H 改成 PT30M，
// 但代码注释、脚本示例值、运营手册、部署手册里同时散着「4 小时 / --watch=60 /
// --interval=15」三类旧口径。漂移没有任何编译错误、没有任何测试会红——只会在答辩
// 现场被问到「你们到底多久喂一次」时发现三份材料说三个数。所以把口径钉在这里：
// 全仓只允许一个轮询周期（30 分钟），任何一处写成别的值就红。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CANON_MIN = 30; // ← 唯一的轮询周期定义。改这里必须同步计划任务 PT30M 与所有材料。

let bad = 0;
const fail = (msg) => { bad++; console.log("FAIL " + msg); };
const pass = (msg) => console.log("OK   " + msg);

function read(rel) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) { fail(`缺文件 ${rel}`); return null; }
  return fs.readFileSync(f, "utf8");
}

/* ---- 1. 计划任务口径写在哪些文档里：不允许再出现 4 小时 / 每小时一轮 ---- */
const DOCS = [
  "README.md",
  "02-作战与答辩/运营手册-初版-2026-10-25.md",
  "02-作战与答辩/部署-2C2G-生产手册-2026-10-27.md",
  "02-作战与答辩/本轮改动与遗留风险-2026-10-26.md",
  "02-作战与答辩/交接-项目全貌-给接手Agent-2026-10-26.md",
];
// 只匹配「喂价/保鲜/轮询」语境的旧值；历史文档里的演进记录不算（它们描述当时状态）。
const STALE = [
  [/喂价保鲜[^\n]{0,20}每\s*4\s*小时/, "喂价保鲜仍写「每 4 小时」"],
  [/RainProof-Feed[^\n]{0,40}每\s*4\s*小时/, "RainProof-Feed 仍写「每 4 小时」"],
  [/feeder\s*--watch=60/, "feeder 仍推荐 --watch=60"],
  [/[/|]\s*feeder --watch=60/, "推荐配置表仍写 --watch=60"],
  [/每\s*4\s*h\b/, "仍有「每 4h」"],
];
for (const rel of DOCS) {
  const s = read(rel);
  if (s === null) continue;
  const hits = STALE.filter(([re]) => re.test(s));
  if (hits.length) hits.forEach(([, why]) => fail(`${rel}：${why}`));
  else pass(`${rel} 无 4 小时旧口径`);
}

/* ---- 2. 代码里的默认周期必须是 30 分钟 ----
   feeder / warning-watch 是分钟（--watch=30）；keeper 是秒（--interval=1800）；
   hook-watch 也是秒（--watch=1800）。单位不同，但都要落在 1800 秒。 */
const CODE = [
  { rel: "04-脚本/push-rainfall-v5.js", re: /const watchMin = /, unit: "min", label: "--watch（分钟）" },
  { rel: "04-脚本/warning-watch.js", re: /const watchMin = /, unit: "min", label: "--watch（分钟）" },
  { rel: "04-脚本/keeper.js", re: /if \(raw === undefined\) return (\d+);/, unit: "sec", label: "--interval 默认值（秒）" },
];
for (const { rel, re, unit, label } of CODE) {
  const s = read(rel);
  if (s === null) continue;
  const m = s.match(re);
  if (!m) { fail(`${rel}：找不到 ${label} 的定义`); continue; }
  if (unit === "sec") {
    const got = Number(m[1]);
    if (got !== CANON_MIN * 60) fail(`${rel}：${label} = ${got} 秒，应为 ${CANON_MIN * 60}（30 分钟）`);
    else pass(`${rel}：${label} = ${got} 秒（30 分钟）`);
  } else {
    // 分钟口径没有硬编码默认值（不带 --watch 就跑一轮），只校验示例值/文档值一致。
    if (!/--watch=30/.test(s)) fail(`${rel}：用法示例里没有 --watch=30`);
    else pass(`${rel}：用法示例 --watch=30`);
  }
}

/* ---- 3. 三个 --watch / --interval 必须有非法值校验，否则 NaN ⇒ 零延迟死循环 ----
   （keeper.js:46-57 / hook-watch.js:74-82 / push-rainfall.js:420 已修过三处，
     2026-10-27 又把漏掉的 push-rainfall-v5.js 与 warning-watch.js 补上。）
   同时要求分钟口径的 `--watch` 认两种写法：用法注释写的是空格形式 `--watch 30`，
   只认等号会让「照文档敲」变成静默跑一轮 —— 这道检查就是钉这个的。 */
const GUARDED = [
  { rel: "04-脚本/push-rainfall-v5.js", minuteForm: true },
  { rel: "04-脚本/warning-watch.js", minuteForm: true },
  { rel: "04-脚本/keeper.js", minuteForm: false },
  { rel: "04-脚本/hook-watch.js", minuteForm: false },
];
for (const { rel, minuteForm } of GUARDED) {
  const s = read(rel);
  if (s === null) continue;
  if (!/Number\.isFinite\(|Number\.isInteger\(/.test(s)) fail(`${rel}：缺 --watch/--interval 非法值校验`);
  else pass(`${rel} 有非法值校验`);
  if (minuteForm) {
    if (!s.includes('process.argv.indexOf("--watch")')) fail(`${rel}：--watch 不支持空格写法（--watch 30 会被静默当成跑一轮）`);
    else pass(`${rel}：--watch 同时认 = 与空格两种写法`);
  }
}

/* ---- 4. 计划任务（仅 Windows 可查；其他平台跳过不判红） ---- */
if (process.platform === "win32" && process.argv.includes("--ops")) {
  try {
    const { execFileSync } = require("child_process");
    const xml = execFileSync("schtasks", ["/Query", "/TN", "RainProof-Feed", "/XML"], { encoding: "utf8" });
    const m = xml.match(/<Interval>(P[^<]+)<\/Interval>/);
    if (!m) fail("RainProof-Feed 找不到 Repetition.Interval");
    else if (m[1] === `PT${CANON_MIN}M`) pass(`计划任务 RainProof-Feed = ${m[1]}`);
    else fail(`计划任务 RainProof-Feed = ${m[1]}，应为 PT${CANON_MIN}M`);
  } catch {
    fail("RainProof-Feed 计划任务查不到（未注册？）");
  }
} else {
  console.log("SKIP 计划任务检查（运行环境核验请在 Windows 使用 --ops；离线门禁不依赖本机任务）");
}

/* ---- 5. 额度自证：122 区划 × 48 轮/日 必须仍在免费额度内 ----
   这条把「文档里写的 58.6%」变成可计算的事实，而不是手抄的数字。 */
const FREE_PER_DAY = 10000;
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, "04-脚本/v5-regions.json"), "utf8"));
const roundsPerDay = (24 * 60) / CANON_MIN;
const calls = REG.length * roundsPerDay;
const pct = (calls / FREE_PER_DAY) * 100;
if (pct > 100) fail(`${REG.length} 区划 × ${roundsPerDay} 轮 = ${calls} 次/日，占 ${pct.toFixed(1)}% —— 超免费额度`);
else pass(`${REG.length} 区划 × ${roundsPerDay} 轮 = ${calls} 次/日，占免费额度 ${pct.toFixed(1)}%`);

/* ---- 6. 门禁组数不许漂移：材料里写的「N 组门禁」必须等于 npm test 链的长度 ----
   2026-10 里这个数字在材料中先后出现过 17/21/22/23/24/27/28 —— 每加一道门禁就多
   一个手抄数字，没人记得改全。这里直接数 package.json 的 test 链，让组数只有一个来源。 */
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
const GATE_COUNT = PKG.scripts.test.split("&&").map((s) => s.trim()).filter(Boolean).length;
const COUNT_DOCS = [
  "01-参赛材料/01-项目计划书-草稿.md",
  "01-参赛材料/03-引用与待核清单.md",
  "01-参赛材料/05-提交清单与材料索引-2026-10-26.md",
  "01-参赛材料/06-答辩框架与时间分配-2026-10-28.md",
  "01-参赛材料/08-全面审查结论与提交前检查.md",
];
let countHits = 0;
for (const rel of COUNT_DOCS) {
  const s = read(rel);
  if (s === null) continue;
  for (const m of s.matchAll(/(\d+)\s*组(?:门禁|自动化)/g)) {
    countHits++;
    if (Number(m[1]) !== GATE_COUNT) fail(`${rel}：写「${m[1]} 组门禁」，npm test 实际是 ${GATE_COUNT} 组`);
  }
}
if (!countHits) fail("提交材料里找不到任何「N 组门禁」表述，组数无从校验");
else pass(`材料里的门禁组数与 npm test 一致（${GATE_COUNT} 组，校验 ${countHits} 处）`);

console.log(bad ? `\n${bad} 项失败` : "\n轮询口径一致：全仓 30 分钟一轮");
process.exit(bad ? 1 : 0);
