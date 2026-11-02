# 9 区划分歧裁决 · 即用命令（2026-11-03 生成）

> 依据：gate 三模型窗口增量（09-AI判定留痕 raw）+ 三套独立模型（GEM/JMA/ARPEGE）同窗口佐证
> （extra-models.json，SHA-256 1662f8016fe96458412dbbfbc65400da5e515d1873300fd8c2c69c956a42c202）。
> 规则：独立中位数落在 gate 范围内 → 建议按 gate 中位数（Math.round，与自动喂价同取整口径）人工喂价。
> evidenceHash 为 keccak256(可复算 canonical 字符串)，每城证据文件见 adjudication-<code>.json。
> confidence 沿用自动喂价公式 min(95, 60+增量)；sources=6（三 gate 模型 + 三独立模型）。
> **鹤峰县 hold**：6 个模型 21.1–53.1mm 无收敛，继续拒喂，等 ERA5 回填后裁决。

## 建议喂价（8 城，逐条执行；去掉注释前先确认 target 无误）

```bash
node 07-测试工具/multisig-call.js updateRainfall 420324 143 0x5f4c172da028dca59f9d3bce4d6df3bc5972911bda760e0b92975e3223fbe464 75 6 --send   # 竹溪县 128→143mm（gate 中位 15.0，独立三模型 10.5 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420525 141 0xf90de77fa07bfed1c2afd33b00dec257ae25f1b612923f7cde9abcb2a7c09203 76 6 --send   # 远安县 125→141mm（gate 中位 15.9，独立三模型 15.3 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420526 95 0x232624657dae7fedb0bf712be7e05e15d541675ff67c09b22118cb6abd79878c 79 6 --send   # 兴山县 76→95mm（gate 中位 19.5，独立三模型 19.7 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420527 133 0x496058cd0b5f55916d5a5564372c245772ab3242e7b9447adef35d912229d55d 75 6 --send   # 秭归县 118→133mm（gate 中位 14.7，独立三模型 15.3 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421123 66 0xf30c90851bd139e764cbc699bdf2ea930f85eb2cf165a80319c11d6aab7fcc1b 72 6 --send   # 罗田县 54→66mm（gate 中位 12.2，独立三模型 12.1 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421321 204 0x6f5693268e34a9d184171ce8f4e585cd99c7b86ac8263023d0c31508d87eeeb8 75 6 --send   # 随县 189→204mm（gate 中位 15.0，独立三模型 13.3 佐证）
node 07-测试工具/multisig-call.js updateRainfall 422827 149 0xbf9bc7b8fb1b16dead1356d71cc6c4756127f171cb27f3e93369f1a872fea82b 72 6 --send   # 来凤县 137→149mm（gate 中位 12.1，独立三模型 8.7 佐证）
```

## 执行后验证

```bash
node 07-测试工具/audit-events-full.js   # 应看到 8 条新 RainfallUpdated，且 lastFeedAt 刷新
node 04-脚本/preflight.js               # ❌ 喂价项应只剩 鹤峰县（或清零）
```
