#!/usr/bin/env node
/**
 * check-v5-bytecode.js —— 承保合约 v5 的「源码 ↔ 产物 ↔ 链上」三重一致性门禁（2026-10-26）
 *
 * 锁一件事：`03-合约/RainDeliveryInsuranceV5.sol` 现场编译出来的字节码，
 * 必须与仓库里的 `RainDeliveryInsuranceV5.bytecode.txt` **逐字节相同**。
 * 在这之前 `make-verify-pack.js` 的 TARGETS 只覆盖 v1/v2/v3，`e2e_v5.js` 直接读
 * `V5.bytecode.txt` 不编译 —— 也就是**改 V5.sol 对整套测试完全不可见**，
 * 最后一分钟改合约也不会被发现（这是 2026-10-26 全量审计的 S1）。
 *
 * 用法：
 *   node check-v5-bytecode.js            纯离线（进 npm test 链）
 *   node check-v5-bytecode.js --onchain  额外比对链上已部署的 runtime code
 *
 * 为什么链上比对要把 RDROP 地址抹掉：`token` 是 immutable，构造函数部署时
 * 才把它写进 runtime code，所以编译产物里那一格是 0，链上是真地址。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const ONCHAIN = process.argv.includes("--onchain");
const SOL = path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV5.sol");
const ART_BC = path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV5.bytecode.txt");
const ART_ABI = path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV5.abi.json");
const ART_SIZE = path.join(__dirname, "..", "03-合约", "RainDeliveryInsuranceV5.runtime-size.txt");

const ADDR = "0xFE3D9f897CE3038B75b876923D843F9F6752e136";
const RPC = process.env.RPC_URL || "https://rpc.bohr.life";
const CHAIN_ID = 968;

const pass = [], fail = [];
const ok = (n, c, t = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "✅" : "❌"} ${n}${t ? "  " + t : ""}`); };

console.log("=".repeat(64));
console.log("v5 字节码一致性门禁（源码 ↔ 产物 ↔ 链上）");
console.log("=".repeat(64));

// ① 现场编译（设置必须与 compile_sol.js 一致，否则字节码永远对不上）
const source = fs.readFileSync(SOL, "utf8");
const input = {
  language: "Solidity",
  sources: { "RainDeliveryInsuranceV5.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    viaIR: true,                       // v4/v5 必须 viaIR，否则 Stack too deep
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const fatal = (out.errors || []).filter((e) => e.severity === "error");
if (fatal.length) {
  ok("编译无错误", false, fatal[0].formattedMessage.split("\n")[0]);
  console.log(`\n结论：FAILED（${fail.length} 项失败）\n`);
  process.exit(1);
}

const c = out.contracts["RainDeliveryInsuranceV5.sol"]["RainDeliveryInsuranceV5"];
const freshBC = "0x" + c.evm.bytecode.object.toLowerCase();
const freshRuntime = c.evm.deployedBytecode.object.toLowerCase();
const freshABI = c.abi;

// ② 部署字节码逐字节
const artBC = fs.readFileSync(ART_BC, "utf8").trim().toLowerCase();
ok("源码重编译 == 仓库 bytecode.txt", freshBC === artBC,
  `${(freshBC.length - 2) / 2} 字节`);

// ③ ABI 逐条（顺序敏感：产物是 solc 原样导出的，任何手改都会露）
const artABI = JSON.parse(fs.readFileSync(ART_ABI, "utf8"));
ok("源码重编译 == 仓库 abi.json", JSON.stringify(freshABI) === JSON.stringify(artABI),
  `${freshABI.length} 条目`);

// ④ runtime 尺寸记录（部署后链上 code 长度必须等于它）
const recSize = Number(fs.readFileSync(ART_SIZE, "utf8").trim());
ok("runtime-size.txt 与实际一致", recSize === freshRuntime.length / 2,
  `${freshRuntime.length / 2} 字节`);

// ⑤ 合约大小上限（EIP-170 24576 字节；超了主网部署会失败，测试网也会）
ok("runtime < 24576 字节（EIP-170）", freshRuntime.length / 2 < 24576,
  `${freshRuntime.length / 2} / 24576`);

// ⑥ 可选：与链上已部署代码比对
// 语义：runtime code 应当逐字节相同；允许的唯一差异是**构造函数部署时才补写的 immutable**
// （`token` 地址）—— 编译产物里那一段全是 0，链上是真地址。所以判定规则是：
//   把「链上与产物不同」的字节聚成连续段，每一段在产物里必须全是 0，否则就是真不一致。
(async () => {
  if (ONCHAIN) {
    try {
      const { ethers } = require("ethers");
      const p = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
      const code = (await p.getCode(ADDR)).toLowerCase().slice(2);
      if (code.length !== freshRuntime.length) {
        ok(`链上 runtime 长度 == 重编译（${ADDR}）`, false,
          `链上 ${code.length / 2} 字节 / 产物 ${freshRuntime.length / 2} 字节`);
      } else {
        const runs = [];
        let cur = null;
        for (let i = 0; i < freshRuntime.length; i += 2) {
          if (freshRuntime.slice(i, i + 2) !== code.slice(i, i + 2)) {
            const b = i / 2;
            if (cur && b === cur.end) cur.end = b + 1; else { cur = { start: b, end: b + 1 }; runs.push(cur); }
          }
        }
        // 每一段差异都必须落在产物的全零区（= 部署时才填的 immutable 槽）
        const bad = runs.filter((r) => !/^0+$/.test(freshRuntime.slice(r.start * 2, r.end * 2)));
        const patched = runs.filter((r) => !bad.includes(r));
        ok(`链上 runtime == 重编译（${ADDR}）`, bad.length === 0,
          runs.length === 0
            ? "逐字节完全一致"
            : `仅 ${patched.length} 段 immutable 由构造函数补写（${patched.map((r) => "字节 " + r.start).join("、")}）` +
              (bad.length ? `；另有 ${bad.length} 段真不一致（${bad.map((r) => "字节 " + r.start).join("、")}）` : ""));
      }
    } catch (e) {
      ok("链上代码比对", false, `RPC 失败：${(e && (e.shortMessage || e.message)) || e}`.slice(0, 90));
    }
  } else {
    console.log("  ⏭  链上比对（--onchain 才跑，节点不可达时不影响离线门禁）");
  }

  console.log("=".repeat(64));
  console.log(`通过 ${pass.length} 项 / 失败 ${fail.length} 项`);
  console.log("=".repeat(64));
  if (fail.length) { console.log("失败项：" + fail.join("; ")); process.exit(1); }
})();
