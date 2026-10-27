/**
 * 编译 RainDeliveryInsurance.sol
 * 用法：NODE_PATH=<workspace>/node_modules node compile.js <sol文件> <输出目录> [--via-ir]
 *
 * `--via-ir`：v2 的 `buyPolicy` 等函数字段较多，默认流水线会报 Stack too deep，
 * 按 solc 自己的建议改用 viaIR 流水线编译（v1 仍走默认流水线，字节码保持不变）。
 */
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const SRC = process.argv[2];
const OUT = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : path.dirname(SRC);
const NAME = path.basename(SRC);
const VIA_IR = process.argv.includes("--via-ir");

const source = fs.readFileSync(SRC, "utf8");

const input = {
  language: "Solidity",
  sources: { [NAME]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",          // Sepolia 已支持 Cancun，但 paris 更保险
    viaIR: VIA_IR,
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] }
    }
  }
};

console.log("solc 版本 :", solc.version());
console.log("源文件    :", NAME);
console.log("viaIR     :", VIA_IR);

const out = JSON.parse(solc.compile(JSON.stringify(input)));

const errs = (out.errors || []);
const fatal = errs.filter(e => e.severity === "error");
const warns = errs.filter(e => e.severity === "warning");

if (errs.length) {
  console.log("\n--- 编译器输出 ---");
  errs.forEach(e => {
    const loc = e.formattedMessage.split("\n").slice(0, 6).join("\n");
    console.log(loc, "\n");
  });
}

if (fatal.length) {
  console.log(`\n❌ 编译失败：${fatal.length} 个错误`);
  process.exit(1);
}

const contracts = out.contracts[NAME];
const names = Object.keys(contracts);
console.log(`\n✅ 编译通过（0 error / ${warns.length} warning）`);
console.log("产出合约  :", names.join(", "));

for (const n of names) {
  const c = contracts[n];
  const abiPath = path.join(OUT, `${n}.abi.json`);
  const binPath = path.join(OUT, `${n}.bytecode.txt`);
  fs.writeFileSync(abiPath, JSON.stringify(c.abi, null, 2), "utf8");
  fs.writeFileSync(binPath, "0x" + c.evm.bytecode.object, "utf8");

  const deployBytes = c.evm.bytecode.object.length / 2;
  const runtimeBytes = c.evm.deployedBytecode.object.length / 2;
  // 把运行时字节数落成旁车文件：e2e 断言「部署后链上 code 长度 == 编译报告」时读它，
  // 免得每次改合约都要手改测试里的魔数（以前就是这么过期的）。
  fs.writeFileSync(path.join(OUT, `${n}.runtime-size.txt`), String(runtimeBytes), "utf8");
  console.log(`\n  ${n}`);
  console.log(`    ABI 条目        : ${c.abi.length}`);
  console.log(`    部署字节码      : ${deployBytes} 字节`);
  console.log(`    运行时字节码    : ${runtimeBytes} 字节   (部署后链上 code 长度就是这个)`);
  console.log(`    函数            : ${c.abi.filter(x => x.type === "function").map(x => x.name).join(", ")}`);
  console.log(`    事件            : ${c.abi.filter(x => x.type === "event").map(x => x.name).join(", ")}`);
  console.log(`    → ${abiPath}`);
  console.log(`    → ${binPath}`);
}
