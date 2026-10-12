// 前端契约检查：页面上的三件事必须和代码/产品设计保持一致。
//
// ① 降雨看板的「刻度」与「触发线」必须指同一个地方
//    真实修过的 bug：条子按 0→阈值 画（阈值落在条尾），触发线却写死在 left:50%（=25mm），
//    于是页面上「50 在块的最后、触发线却在中间」—— 视觉上自相矛盾。结论：错的是公式不是线。
// ② 保障时长只列主网现行 v3 的两档（静态脚手架 12/24，运行时按链上 hoursAllowed 收窄）
//    产品设计上短窗口档的公平保费比一次交易的手续费还便宜 51 倍，所以只卖有限几档
//    （见 02-作战与答辩/定价-时长差异化设计.md）。自由输入会让人选出 1~72 的任意值。
//    口径分两层，两层都对：静态 <select> 记的是 v2 的三档（那套设计的痕迹，本文件钉它不被改成自由输入），
//    真正能卖哪几档由链上 hoursAllowed(h) 收窄 —— v3 只放 12/24，见同目录 e2e_v3.js 与 check-frozen-node.js ④。
// ③ 页面 JS 里引用的 DOM id / class 必须真实存在
//    UI 改版最常见的坏法是改了 id 或 class，JS 就静默失效 —— 现场表现是"按钮点了没反应"。
//
// 跑法：node 07-测试工具/check-ui.js    （也挂在 npm test 里）
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (t, c, x = "") => { if (c) { pass++; console.log("  [OK] " + t); } else { fail++; console.log("  [FAIL] " + t + (x ? "  -> " + x : "")); } };

const DEMO = path.join(__dirname, "..", "05-演示站点");
const index = fs.readFileSync(path.join(DEMO, "index.html"), "utf8");

console.log("\n[① 降雨看板] 刻度与触发线必须指同一个地方");
{
  const m = index.match(/const pct = (Math\.min\(100, Math\.round\(v \/ \(thr \* 2\) \* 100\)\));/);
  ok("填充公式是 v / (阈值 × 2) × 100", !!m, m ? "" : "没找到，公式可能又被改回 v/thr（那会让触发线落到中间）");
  ok("触发线 .bar::after 在 left:50%", /\.bar::after\{[^}]*left:50%/.test(index));
  ok("触发线标签 .bar::before 在 calc(50% + 6px)", /\.bar::before\{[^}]*left:calc\(50% \+ 6px\)/.test(index));

  // ⚠️ 下面是**固定样本**，不是链上读回来的雨量：它只验公式本身（50mm 必须正好压在触发线上）。
  //    thr = 50 也不是链上读的，是为了让这段算得出来的人工基准；页面上的阈值由合约
  //    entryThresholdOf(小时档) 给。真实链上的五城累计雨量在 05-演示站点/frozen-node.js 快照里
  //    （67 / 128 / 39 / 162 / 0 mm），这里不引网络、不去读它，只钉公式。
  const thr = 50;
  const vals = [["武汉", 24], ["上海", 34], ["北京", 0], ["广州", 50], ["成都", 120]];
  const pctFn = m ? new Function("v", "thr", `return ${m[1]};`) : null;
  const pct = (v) => (pctFn ? pctFn(v, thr) : NaN);
  // A31：这段不再另写一份公式 —— 算的就是上面从 index.html 抠出来的那一条（单一来源）。
  //   原来检查文件里又抄了一份 pct()，页面改了也不影响它，那 4 条断言等于自己跟自己比。
  console.log("\n  阈值 50mm，条子满格 = 100mm，触发线在 50%：");
  for (const [n, v] of vals) {
    const p = pct(v);
    console.log(`    ${n.padEnd(3)} ${String(v).padStart(3)} mm  → 填 ${String(p).padStart(3)}%   ${p === 50 ? "← 正好压在触发线上" : p > 50 ? "（冲过触发线）" : ""}`);
  }
  ok("50mm 的填充比例 == 触发线位置 50%", pct(50) === 50);
  ok("24mm 明显在触发线左侧", pct(24) < 50, String(pct(24)));
  ok("120mm 顶满条子", pct(120) === 100, String(pct(120)));
  ok("没有区域被算成负数", vals.every(([, v]) => pct(v) >= 0));
}

console.log("\n[② 保障时长] 静态脚手架只能是主网现行 v3 的两档（12/24），某层实际卖哪几档由链上 hoursAllowed 说了算");
{
  ok("hoursInput 是 <select> 不是自由输入框", /<select id="hoursInput"/.test(index) && !/<input id="hoursInput"/.test(index));
  const blk = index.match(/<select id="hoursInput"[\s\S]*?<\/select>/);
  const opts = blk ? [...blk[0].matchAll(/value="(\d+)"/g)].map(m => m[1]) : [];
  ok("静态脚手架只有 12 / 24（按顺序；不再摆 v3 已删的 48/72）", opts.join(",") === "12,24", opts.join(",") || "没解析到 options");
  ok("默认选中 24 小时（v3 两档里的长档）", blk ? /value="24"[^>]*selected/.test(blk[0]) : false);
  ok("JS 用 .value 读它（select 没有 valueAsNumber）", !/hoursInput"\)\.valueAsNumber/.test(index) && /Number\(\$\("hoursInput"\)\.value\)/.test(index));
  ok("档位标签与设计页一致（12 小时 / 24 小时）", /12 小时/.test(index) && /24 小时/.test(index));

  // A38 / J10（2026-10-12 用户裁定「只出现 12/24」）：静态脚手架 = 主网现行 v3 口径 12/24，
  // 运行时再按链上 hoursAllowed(h) 收窄成「这一层真能卖的档位」（968 上的 v2 只放 24）。
  // 两层缺一不可：少了收窄，页面会把这一层不卖的档摆出来卖（点了链上必 revert）；
  // 候选里带上 48/72，就会在 v3 上列出已删的档、默认值还是 677 非法的 72 小时。
  ok("候选只有 12/24，并由链上 hoursAllowed(h) 收窄",
     /const hourCands = \[12, 24\]/.test(index) && /hoursAllowed\(/.test(index),
     "index.html 里没找到「候选 12/24 + hoursAllowed 收窄」的代码");
}

console.log("\n[③ DOM 契约] 页面 JS 引用的 id / class 必须真实存在");
{
  const files = [
    ["05-演示站点/index.html", path.join(DEMO, "index.html")],
    ["05-演示站点/verifier.html", path.join(DEMO, "verifier.html")],
    ["06-核验台单文件/汉客松-链上核验台.html", path.join(__dirname, "..", "06-核验台单文件", "汉客松-链上核验台.html")],
  ];
  for (const [name, p] of files) {
    const src = fs.readFileSync(p, "utf8");

    const ids = new Set(), classes = new Set();
    for (const m of src.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) ids.add(m[1]);
    for (const m of src.matchAll(/\bclass\s*=\s*["']([^"']*)["']/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c);

    // 只取内联脚本（跳过 <script src=...>）
    const scripts = [];
    for (const m of src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) if (!/\bsrc\s*=/.test(m[1])) scripts.push(m[2]);
    const js = scripts.join("\n");

    const usedIds = new Set(), usedCls = new Set();
    for (const m of js.matchAll(/\$\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) usedIds.add(m[1]);
    for (const m of js.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) usedIds.add(m[1]);
    for (const m of js.matchAll(/querySelector(?:All)?\(\s*["'`]\.([A-Za-z0-9_-]+)/g)) usedCls.add(m[1]);

    const missIds = [...usedIds].filter(x => !ids.has(x));
    const missCls = [...usedCls].filter(x => !classes.has(x));
    ok(`${name}：引用的 ${usedIds.size} 个 id / ${usedCls.size} 个 class 都在`, missIds.length + missCls.length === 0,
       [...missIds.map(x => "id:" + x), ...missCls.map(x => "class:" + x)].join(", "));
    if (missIds.length || missCls.length) console.log(`    （${scripts.length} 段内联脚本 / ${js.length} 字符 / HTML 里 ${ids.size} 个 id · ${classes.size} 个 class）`);
  }
}

console.log('\n[④ 演讲提示] 演示界面里不许出现"讲给我们自己听"的话');
{
  // 页面上只放产品本身。讲稿、动作提示、分镜这类东西属于 提交材料/演示讲稿.md 与 02-作战与答辩/，
  // 出现在界面里会显得像"照着念的脚本"，评委的目光应该落在数据上。
  // 后两条是 2026-10-07 加进来的：它们是写给"操作的人"而不是写给"看的人"的话，
  // 界面上一律换成产品自己的陈述（池子必须有余额 / 这不是真链）。
  const CUES = ["演示动线", "给评委演示时", "怎么讲", "指着", "照念", "演示讲稿", "分镜",
                "不要把这一页给评委看", "演示前必须先把池子喂饱"];
  const pages = [
    ["05-演示站点/index.html", path.join(DEMO, "index.html")],
    ["05-演示站点/verifier.html", path.join(DEMO, "verifier.html")],
    ["06-核验台单文件/汉客松-链上核验台.html", path.join(__dirname, "..", "06-核验台单文件", "汉客松-链上核验台.html")],
  ];
  for (const [name, p] of pages) {
    const src = fs.readFileSync(p, "utf8");
    const hit = CUES.filter(k => src.includes(k));
    ok(`${name}：没有演讲提示`, hit.length === 0, hit.length ? "命中 " + hit.join(" / ") : "");
  }
}

console.log("\n[⑤ 判定口径] 赔付按「投保后的增量」，不是累计雨量");
{
  // 合约里判定是 rainfall[region] - rainfallAtBuy >= THRESHOLD，而 rainfallAtBuy 是
  // 投保当刻的累计快照 —— 所以「累计雨量已经超过阈值」不等于「现在投保就能赔」：
  // 现在投保的增量是 0。看板曾经写「买这个区域的保单现在就能申请赔付」，与口径冲突，已改。
  // 同类错误的第二个实例（第一个是①的触发线刻度）：界面承诺了合约不会做的事。
  ok("看板越过阈值时说的是「投保后的增量」", /投保后的增量/.test(index));
  ok("投保区说明写「新增累计降雨」而不是「累计降雨」", /新增累计降雨 ≥ 阈值/.test(index));
  ok("没有「现在就能申请赔付」这种承诺", !/现在就能申请赔付/.test(index));
}

console.log("\n[⑥ 窄屏不溢出的静态代理] 长地址 / 长数字必须能换行，否则 390px 下横向滚动");
{
  // 来源：2026-10-07 全仓只读审计「390px 横向溢出 0 处」在仓库内不可复现 ——
  // 真溢出要靠 CDP 量（仓库外的 D:\DSH\_tmp\overflow.js）。这里只钉住「能防溢出的那条 CSS 还在」：
  // flex/grid 子项默认 min-width:auto，长 0x 地址会把格子顶破；min-width:0 + overflow-wrap:anywhere 是解药。
  const pages = [
    ["05-演示站点/index.html", path.join(DEMO, "index.html")],
    ["05-演示站点/verifier.html", path.join(DEMO, "verifier.html")],
    ["06-核验台单文件/汉客松-链上核验台.html", path.join(__dirname, "..", "06-核验台单文件", "汉客松-链上核验台.html")],
  ];
  const srcs = pages.map(([n, p]) => [n, fs.readFileSync(p, "utf8")]);
  ok("index.html 的栅格子项有 min-width:0（.grid2 > * / .cols > *）", /\.grid2\s*>\s*\*[^{]*\{[^}]*min-width:0/.test(index));
  for (const [n, s] of srcs) ok(`${n}：至少一条 min-width:0 守卫`, /min-width:0/.test(s));
  for (const [n, s] of srcs.slice(1)) ok(`${n}：长地址容器有 overflow-wrap:anywhere`, /overflow-wrap:anywhere/.test(s));
}

console.log("\n" + "=".repeat(56));
console.log(`结果：${pass} 项通过 / ${fail} 项失败`);
console.log(fail === 0 ? "前端契约没被改坏" : "契约破了，别提交");
console.log("=".repeat(56));
process.exit(fail === 0 ? 0 : 1);
