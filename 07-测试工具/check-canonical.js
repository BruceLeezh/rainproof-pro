/**
 * 哈希口径的回归测试 —— 钉住 04-脚本/canonical.js 的行为
 * ============================================================================
 * 这个文件存在的原因：链上的 evidenceHash / inputHash / outputHash 要能被第三方
 * 【独立复算】。口径一旦悄悄变了（比如有人改了精度、或给对象加了键序依赖），
 * 链上的哈希就全部对不上账，而且表面上看不出任何异常 —— 没有测试就发现不了。
 *
 * 用法：node check-canonical.js
 */
const assert = require("assert");
const { canonicalize, evidenceHashOf } = require("../04-脚本/canonical");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log("  ✅ " + name); pass++; }
  catch (e) { console.log("  ❌ " + name + "\n       " + (e.message || e)); fail++; }
};

console.log("\n哈希口径回归 · canonical.js\n" + "=".repeat(60));

/* ---- 1. 键序无关：这是这个文件存在的全部理由 ---- */
t("键序不同 → 同一个哈希", () => {
  const a = { region: "wuhan", mm: 37.2, src: "archive" };
  const b = { src: "archive", mm: 37.2, region: "wuhan" };
  assert.strictEqual(evidenceHashOf(a), evidenceHashOf(b));
});

t("嵌套对象的键序也不同 → 仍同一个哈希", () => {
  const a = { x: { p: 1, q: { m: 2, n: 3 } }, y: [1, 2] };
  const b = { y: [1, 2], x: { q: { n: 3, m: 2 }, p: 1 } };
  assert.strictEqual(evidenceHashOf(a), evidenceHashOf(b));
});

/* ---- 2. 数值精度：37.2 与 37.20 必须同哈希 ---- */
t("37.2 与 37.20 同哈希；第 7 位小数被截掉，也同哈希", () => {
  const h1 = evidenceHashOf({ mm: 37.2 });
  const h2 = evidenceHashOf({ mm: 37.20 });
  const h3 = evidenceHashOf({ mm: 37.2000001 });   // 第 7 位超出精度，被 toFixed(6) 截掉
  assert.strictEqual(h1, h2);
  assert.strictEqual(h1, h3);
});

t("精度差异落在第 6 位 → 哈希必须不同（否则精度就没意义了）", () => {
  assert.notStrictEqual(evidenceHashOf({ mm: 37.2 }), evidenceHashOf({ mm: 37.200002 }));
});

/* ---- 3. 数组顺序是信息，不能被打散 ---- */
t("数组顺序不同 → 哈希必须不同", () => {
  assert.notStrictEqual(evidenceHashOf({ d: [1, 2, 3] }), evidenceHashOf({ d: [3, 2, 1] }));
});

/* ---- 4. 序列化形状 ---- */
t("canonicalize 的具体形状符合约定的口径", () => {
  assert.strictEqual(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.strictEqual(canonicalize([1, "x", true, null]), '[1,"x",true,null]');
  assert.strictEqual(canonicalize(37.2), "37.2");
  assert.strictEqual(canonicalize(-0), "0");
});

t("不支持的类型直接报错，不做隐式转换", () => {
  assert.throws(() => canonicalize(undefined), /不支持的类型/);
  assert.throws(() => canonicalize(NaN), /非有限数/);
  assert.throws(() => canonicalize(Infinity), /非有限数/);
  // 非纯对象：字段看不见 ⇒ 必须报错，不能静默哈希成 {}（审计 A4）
  assert.throws(() => canonicalize(new Date(0)), /只接受纯对象/);
  assert.throws(() => canonicalize(new Map([["a", 1]])), /只接受纯对象/);
  assert.throws(() => canonicalize({ when: new Date(0) }), /只接受纯对象/);   // 嵌套也要拦
  assert.strictEqual(canonicalize(Object.create(null)), "{}");              // 无原型纯对象仍合法
});

/* ---- 5. 真实快照形状：交付值改了，哈希必须跟着变 ---- */
t("雨量改 1mm → 哈希变（防「哈希没跟着数据走」）", () => {
  const snap = (mm) => ({
    schema: "rainproof/feed-snapshot@1", regionId: 1, regionKey: "wuhan",
    epoch: "2026-10-01", source: "open-meteo", endpoints: ["archive", "forecast"],
    dates: ["2026-10-01", "2026-10-02"], dailyMm: [20.0, 17.2], cumulativeMm: mm,
    overlapDays: 2, overlapArchiveMm: 37.2, overlapForecastMm: 37.2, toleranceMm: 7.4,
  });
  assert.notStrictEqual(evidenceHashOf(snap(37)), evidenceHashOf(snap(38)));
  assert.strictEqual(evidenceHashOf(snap(37)), evidenceHashOf(snap(37.0)));
});

console.log("=".repeat(60));
console.log(`结果：${pass} 项通过 / ${fail} 项失败\n`);
process.exit(fail ? 1 : 0);
