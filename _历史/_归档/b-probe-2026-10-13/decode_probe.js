// 只读探针：验证「页面 ABI（v2 形状）解码 677 v3 的 policies / judgements 返回值」会发生什么
// 运行：node C:\Users\lenovo\Desktop\汉客松\_b_probe\decode_probe.js
const { ethers } = require("C:/Users/lenovo/Desktop/汉客松/rainproof/07-测试工具/node_modules/ethers");
const fs = require("fs");

const V3 = JSON.parse(fs.readFileSync("C:/Users/lenovo/Desktop/汉客松/rainproof/03-合约/RainDeliveryInsuranceV3.abi.json", "utf8"));
const coder = ethers.AbiCoder.defaultAbiCoder();

// 页面内嵌 ABI 里的形状（已由 pageabi.py 核实：policies 15 字段 / judgements 9 字段，均 v2 形状）
const PAGE_POL = "address,uint8,uint8,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint256,bool,bool,bool".split(",");
const PAGE_JUD = "uint8,uint8,uint8,uint8,uint256,bool,bytes32,bytes32,string".split(",");

const v3pol = V3.find(e => e.name === "policies").outputs.map(o => o.type);
const v3jud = V3.find(e => e.name === "judgements").outputs.map(o => o.type);
console.log("v3 policies:", v3pol.length, v3pol.join(","));
console.log("v3 judgements:", v3jud.length, v3jud.join(","));

const A = "0x89e7C942535930B61cB61631051E8b0bD670596a";
const polEnc = coder.encode(v3pol, [A, A, 1, 2, 760000000000000n, 1000n, 2000n, 3000n, 24n, 30n, 0n, 1n, 10000000000000000n, false, false, true]);
const judEnc = coder.encode(v3jud, [1, 1, 90, 3, 1700000000n, 42n, true, "0x" + "11".repeat(32), "0x" + "22".repeat(32), "gpt-x/2026-10"]);

for (const [name, enc, types] of [["policies", polEnc, PAGE_POL], ["judgements", judEnc, PAGE_JUD]]) {
  try {
    const out = coder.decode(types, enc);
    console.log("页面 ABI 解码 " + name + " 不抛错 ->", out.toArray().map(String).join(" | "));
  } catch (e) {
    console.log("页面 ABI 解码 " + name + " 抛错 ->", e.code, "|", e.shortMessage || e.message);
  }
}
