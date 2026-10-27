/**
 * 规范化序列化 + 证据哈希 —— 全项目【唯一】的哈希口径
 * ============================================================================
 *
 * 【为什么必须单独一个文件】
 *   链上的 evidenceHash / inputHash / outputHash 要能被【第三方独立复算】才有意义。
 *   第三方复算的前提是：同一份数据，无论谁算、在哪算、用什么语言算，都得到同一个值。
 *   所以这个口径不能在两个地方各写一份 —— 只要有一处不同（哪怕只是键的顺序），
 *   链上的哈希就永远对不上账，而且【看起来一切正常】。
 *
 *   喂价脚本（04-脚本/push-rainfall.js）和 AI 判定模块都用它，
 *   测试（07-测试工具/check-canonical.js）钉住它的行为。
 *
 * 【口径】
 *   1. 对象键【递归升序】排列
 *   2. 数值统一到【6 位小数】再去掉尾随 0 —— 37.2 与 37.20 必须同哈希
 *   3. 数组保持原顺序（顺序本身是信息：逐日降雨的日期序列不能被打乱）
 *   4. 除 null / 数字 / 布尔 / 字符串 / 数组 / 对象外的类型一律报错（不做隐式转换）
 *   5. 最终经 keccak256 取 32 字节哈希
 *
 * ⚠️ 直接 JSON.stringify 做不到上面第 1、2 条：
 *   键序取决于对象字面量的书写顺序，37.2 与 37.20 也会序列化成不同的字符串。
 */

const { keccak256, toUtf8Bytes } = require("ethers");

/** 规范化序列化：把任意可哈希的值转成【唯一确定】的字符串 */
function canonicalize(v) {
  if (v === null) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("canonicalize: 非有限数 " + v);
    return JSON.stringify(Number(v.toFixed(6)));
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (typeof v === "object") {
    // 只接受【纯对象】。Date / Map / 类实例的字段用 Object.keys 看不见，
    // 会被静默序列化成 {} —— 链上哈希「看起来正常，但对不上账」（审计 A4）。
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error("canonicalize: 只接受纯对象，收到 " + ((v.constructor && v.constructor.name) || "非纯原型对象"));
    }
    return "{" + Object.keys(v).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
  }
  throw new Error("canonicalize: 不支持的类型 " + typeof v);
}

/** 证据哈希：bytes32，写进链上 */
const evidenceHashOf = (snapshot) => keccak256(toUtf8Bytes(canonicalize(snapshot)));

module.exports = { canonicalize, evidenceHashOf };
