# 9 区划分歧裁决 · 即用命令（2026-11-03 生成）

> 依据：gate 三模型窗口增量（09-AI判定留痕 raw）+ 三套独立模型（GEM/JMA/ARPEGE）同窗口佐证
> （extra-models.json，SHA-256 fa2083d2b17c90929c05d30074a7c8f426cb9d555132d5e475eb8c447f539e0b）。
> 规则：独立中位数落在 gate 范围内 → 建议按 gate 中位数（Math.round，与自动喂价同取整口径）人工喂价。
> evidenceHash 为 keccak256(可复算 canonical 字符串)，每城证据文件见 adjudication-<code>.json。
> confidence 沿用自动喂价公式 min(95, 60+增量)；sources=6（三 gate 模型 + 三独立模型）。
> **鹤峰县 hold**：6 个模型 21.1–53.1mm 无收敛，继续拒喂，等 ERA5 回填后裁决。

## 建议喂价（8 城，逐条执行；去掉注释前先确认 target 无误）

```bash
node 07-测试工具/multisig-call.js updateRainfall 420200 149 0xf191c41ea5f944e8bf347285cca895a748c7095b9dd55c16db03d61e37af5403 72 6 --send   # 黄石市 137→149mm（gate 中位 12.2，独立三模型 21.1 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420202 149 0x9844eef732eca3567ce4f5ee6b5c577838613ee42956699a9c3c3812979a51ff 72 6 --send   # 黄石港区 137→149mm（gate 中位 12.2，独立三模型 21.1 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420203 149 0xa9e21bdd51c66d1f55091b798602eecf23a5c490c475e8210e94ed9f7ae9c194 72 6 --send   # 西塞山区 137→149mm（gate 中位 12.2，独立三模型 21.1 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420204 138 0x9348c7910be050301e312bb8e735409a564e0b8e0dcebc07bad4131a64a89d99 74 6 --send   # 下陆区 124→138mm（gate 中位 13.9，独立三模型 21.1 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420205 143 0x523a4808c43f291da54634017831aa19f41cea4cd046f8b8b5c4a10fccabd010 75 6 --send   # 铁山区 128→143mm（gate 中位 15.3，独立三模型 20.4 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420281 151 0xd02bdb0cc49578919b398a45648c1f555fcdf24bf4a902daf4938b9268676a7c 76 6 --send   # 大冶市 135→151mm（gate 中位 15.7，独立三模型 20.4 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420700 118 0x59f42a5af2b4af98dc9e4aff7be0c86ffca25bbe2da29da9189d5a3ebfdeefc3 73 6 --send   # 鄂州市 105→118mm（gate 中位 12.7，独立三模型 12.5 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420702 131 0x537eb33cf2bf7be4f1438c3bf0bf3ecef72b795e0de2bb4be9a5ac4cb97429fc 73 6 --send   # 梁子湖区 118→131mm（gate 中位 12.9，独立三模型 18.4 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420704 118 0x13dff0101b3edbd3c131616926017f794aa80d2e7502c9e1b7e9a8a49055c5e1 73 6 --send   # 鄂城区 105→118mm（gate 中位 12.7，独立三模型 12.5 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421100 105 0x53147938957a534fb4c8f9ceb61e4935e5b3253477338743290bb7ecfb2acf26 73 6 --send   # 黄冈市 92→105mm（gate 中位 12.7，独立三模型 12.5 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421102 105 0x7457017c688ce4192a4bd90fb0355f8e09ce0426b0530b037ec954a78280bd42 73 6 --send   # 黄州区 92→105mm（gate 中位 12.7，独立三模型 12.5 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421125 121 0xb56ced303331371bb37924d47accd34fea2c2080b1a0b6a689c838e0c0e23cd5 74 6 --send   # 浠水县 107→121mm（gate 中位 14.5，独立三模型 18.9 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421171 105 0xb290da05a54458d37439a358db658c65596d97e358415c500078d6524a6b9567 73 6 --send   # 龙感湖管理区 92→105mm（gate 中位 12.7，独立三模型 12.5 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421181 154 0xab5fb374d2f13670de8dcd7663fefeeac457fa0b2846749a53b253cbd96551b4 66 6 --send   # 麻城市 148→154mm（gate 中位 6.0，独立三模型 7.8 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421200 157 0x74cef285ff73b44b216125e50cef34067273728ce0cd5aaa3310c167b5293fb8 79 6 --send   # 咸宁市 138→157mm（gate 中位 19.3，独立三模型 21.5 佐证）
node 07-测试工具/multisig-call.js updateRainfall 421202 171 0xad6ad982c43b1d4ebc32e5b8ab61d682b3afacacdcb10e75b31d46d79da2afe1 79 6 --send   # 咸安区 152→171mm（gate 中位 19.3，独立三模型 21.5 佐证）
node 07-测试工具/multisig-call.js updateRainfall 420882 216 0x099fb839a5f925b8262e3ab42c75052c82fe6d3571e3686198d29b936ecbaf4b 63 6 --send   # 京山市 213→216mm（gate 中位 3.3，独立三模型 2.1 佐证）
node 07-测试工具/multisig-call.js updateRainfall 422827 164 0x7a18fca6461e5bbf5ca8a282db00316f4fc1b4875d505f08ebf7caaf381cd9f9 68 6 --send   # 来凤县 156→164mm（gate 中位 8.3，独立三模型 7.1 佐证）
```

## 执行后验证

```bash
node 07-测试工具/audit-events-full.js   # 应看到 8 条新 RainfallUpdated，且 lastFeedAt 刷新
node 04-脚本/preflight.js               # ❌ 喂价项应只剩 鹤峰县（或清零）
```
