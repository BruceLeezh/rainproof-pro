/**
 * A5 源码验证包：把「03-合约 里这两个部署件，就是 677 上跑的那份字节码」做成可复跑的清单。
 *
 * 用法：cd 07-测试工具 && node make-verify-pack.js
 * 产出：03-合约/verify-manifest.json   （源码 sha256 + 创建/运行时字节码 sha256 & keccak256 + 编译参数）
 * 退出码：任一处对不上即非零退出（编译失败、产物与盘上的 .bytecode.txt 不一致、
 *         运行时长度与链上实测长度不一致、源文件含 import 以致「单文件即 flatten」不成立）。
 *
 * 为什么需要它：scan.botchain.ai 在国内直连不通（见 02-作战与答辩/赛后优化-二人方案-2026-10-11.md §0.2），
 * 浏览器上提交 verify 这条路当时走不通，所以退到「导出 flatten + 编译参数 + sha256 清单」。
 * 两个 .sol 都不含 import，源文件本身就是 flatten 结果，因此这里不另存一份副本（避免两份源码漂移）。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const solc = require("solc");
const { keccak256, AbiCoder } = require("ethers");
const abiCoder = new AbiCoder();

const ROOT = path.join(__dirname, "..");
const CDIR = path.join(ROOT, "03-合约");
const OUT = path.join(CDIR, "verify-manifest.json");

// runtimeBytes = 10-08 经代理在主网 677 上 eth_getCode 实测的长度；不一致就说明源码与部署件不是同一份。
const TARGETS = [
  {
    name: "RainDeliveryInsuranceV3",
    file: "RainDeliveryInsuranceV3.sol",
    viaIR: true,                      // 不加 --via-ir 会 Stack too deep
    runtimeBytes: 15823,
    ctor: { types: [], values: [] },  // constructor() 无参
    chain: {
      chainId: 677,
      address: "0x89e7C942535930B61cB61631051E8b0bD670596a",
      deployTx: "0x54fc1e694748338d63a2e9f6f46cf2c8623eaa141b71a10904a7b56dc3b9f436",
      deployBlock: 25921072,
    },
  },
  {
    name: "OperatorMultisig",
    file: "OperatorMultisig.sol",
    viaIR: false,
    runtimeBytes: 4746,
    // constructor(address[] owners_, uint256 threshold_)：3 个 owner + 2 票（见 08-截图存证/链上留痕-主网677-v3部署.md §五）
    ctor: {
      types: ["address[]", "uint256"],
      values: [
        [
          "0xb466B1D1fA19026e08C3311C555d220AE2E1Ba3a",
          "0xDA2E6266529Ce8b3E606B17628072c15Cfa33D28",
          "0xBc360891Fa4708d57eF21bCBeCFa303fbBb7bB26",
        ],
        2,
      ],
    },
    chain: {
      chainId: 677,
      address: "0x676b791da72Ef072718c9f078377bF21be1b160f",
      deployTx: "0x16a80230a0d7cb6b4e3e2c551730d89a60a1c5f9f34ae6416ac45a22ecef8b3f",
      deployBlock: 25923049,
    },
  },
];

const sha256 = (buf) => "0x" + crypto.createHash("sha256").update(buf).digest("hex");
const hexHash = (h) => {
  const buf = Buffer.from(h.slice(2), "hex");
  return { sha256: sha256(buf), keccak256: keccak256(buf), bytes: buf.length };
};

let bad = 0;
const fail = (msg) => { bad++; console.log("  ❌ " + msg); };
const ok = (msg) => console.log("  ✅ " + msg);

const contracts = [];
console.log("solc:", solc.version());

for (const t of TARGETS) {
  console.log(`\n=== ${t.name}（${t.file}）===`);
  const srcPath = path.join(CDIR, t.file);
  const source = fs.readFileSync(srcPath, "utf8");

  // 「单文件即 flatten」是这份清单成立的前提：有 import 就得先真 flatten，不能谎称源文件就是 flatten 结果。
  const imports = source.split("\n").filter((l) => /^\s*import\b/.test(l));
  if (imports.length) fail(`源文件含 ${imports.length} 行 import，不是 flatten 结果，需先展开：${imports[0].trim()}`);
  else ok("源文件无 import ⇒ 它本身就是 flatten 结果（无需另存副本）");

  const input = {
    language: "Solidity",
    sources: { [t.file]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      viaIR: t.viaIR,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === "error");
  if (errs.length) { fail("编译报错：" + errs.map((e) => e.formattedMessage).join(" | ").slice(0, 400)); continue; }
  const c = (out.contracts[t.file] || {})[t.name];
  if (!c) { fail(`编译产物里没有合约 ${t.name}`); continue; }

  const creation = "0x" + c.evm.bytecode.object;
  const runtime = "0x" + c.evm.deployedBytecode.object;
  const creationHash = hexHash(creation);
  const runtimeHash = hexHash(runtime);

  // 盘上的 .bytecode.txt 是部署时用的产物；重编后对不上 ⇒ 产物已过期，verify 会失败。
  const onDisk = (fs.readFileSync(path.join(CDIR, `${t.name}.bytecode.txt`), "utf8") || "").trim();
  onDisk === creation ? ok("盘上 .bytecode.txt 与本次重编逐字节一致") : fail("盘上 .bytecode.txt 已过期，与本次重编不一致（先 npm run compile:v3）");

  const sidecar = Number((fs.readFileSync(path.join(CDIR, `${t.name}.runtime-size.txt`), "utf8") || "").trim());
  runtimeHash.bytes === t.runtimeBytes
    ? ok(`运行时 ${runtimeHash.bytes} 字节 = 677 上 eth_getCode 实测长度`)
    : fail(`运行时 ${runtimeHash.bytes} 字节 ≠ 677 实测 ${t.runtimeBytes} 字节`);
  sidecar === runtimeHash.bytes ? ok("runtime-size 旁车文件一致") : fail(`runtime-size 旁车文件写的是 ${sidecar}`);

  console.log(`     源码 sha256        : ${sha256(Buffer.from(source, "utf8"))}`);
  console.log(`     创建码 sha256      : ${creationHash.sha256}`);
  console.log(`     运行时 sha256      : ${runtimeHash.sha256}`);
  console.log(`     运行时 keccak256   : ${runtimeHash.keccak256}`);

  contracts.push({
    name: t.name,
    sourceFile: `03-合约/${t.file}`,
    sourceSha256: sha256(Buffer.from(source, "utf8")),
    compiler: solc.version(),
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", viaIR: t.viaIR },
    creationBytecode: { bytes: creationHash.bytes, sha256: creationHash.sha256, keccak256: creationHash.keccak256 },
    runtimeBytecode: { bytes: runtimeHash.bytes, sha256: runtimeHash.sha256, keccak256: runtimeHash.keccak256 },
    isFlattenedSingleFile: imports.length === 0,
    constructorArgsAbiEncoded: t.ctor.types.length ? abiCoder.encode(t.ctor.types, t.ctor.values) : "",
    deployedOn: t.chain,
  });
}

const manifest = {
  what: "A5 源码验证包：03-合约 的部署件源码、编译参数与字节码哈希。验浏览器若支持 verify，按这里的 compiler/settings 提交；不支持时这份清单就是替代证据。",
  reproduce: "cd 07-测试工具 && npm run compile:v3 && node make-verify-pack.js",
  runtimeLengthIsOnChainMeasured: "运行时字节数与 10-08 在主网 677 上 eth_getCode 的实测长度一致；逐字节一致性需在有代理时再跑一次 eth_getCode 比对。",
  chains: "Sepolia 11155111 = v1 留痕 / BOT Chain 968 = v2 / BOT Chain 677 = v3，三链同址不同合约。",
  contracts,
};
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`\n${bad ? "❌" : "✅"} ${bad} 项失败 → ${path.relative(ROOT, OUT)}`);
process.exit(bad ? 1 : 0);
