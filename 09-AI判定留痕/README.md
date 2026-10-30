# 09-AI判定留痕 · 索引与缺号说明（2026-10-11 建立）

> 本目录是 AI 判定环节的**原始留痕**（JSON），不是插图。以下索引按 2026-10-11 的目录实测结果写；**每个 JSON 文件本身才是事实**，本 README 只做索引与缺号登记。
> 实测方式：`Get-ChildItem -Recurse` 列文件 + 逐个 `ConvertFrom-Json` 读 `schema` / `policyId` / `chainId` / `simulated`。共 **22 个 JSON**。

## 1. 三套 schema（版本号写在 JSON 内部的 `schema` 字段，不是文件名）

| schema 版本 | 文件形态 | 顶层键 | 字段含义要点 |
|---|---|---|---|
| `rainproof/judge-input@1` | `snapshot-policy{N}.json` | `snapshot` + `inputHash` | `snapshot.collectVersion` = `ai-collect-v1`；`snapshot.policyId`；`snapshot.collectedAt`；`snapshot.simulated`；`snapshot.epoch`；`snapshot.region`；`snapshot.policy`（rider / 时间窗 / 买入时雨量）；`snapshot.oracle`（`cumulativeMm` / `officialIncrementMm` / `contract` / `chainId`） |
| `rainproof/judgement@1` | `judgement-policy{N}.json` | `judgement` + `outputHash` | `judgement.judgeVersion` = `ai-judge-v1`；`judgement.policyId`；`judgement.decidedAt`；`judgement.decision` / `decisionLabel`（DENY / PAY）；`judgement.confidence`；`judgement.sources`；`judgement.simulated`；`judgement.metrics`（`thresholdMm` / `minConfidence` / `officialIncrementMm` / 三模型增量 / `medianMm` / `spreadMm` / `agreeCount` / `divergencePct`） |
| `rainproof/underwrite-review@1` | `承保复核-chain{chainId}-policy{N}.json` | `schema` / `review` / `reviewHash` / `reviewedAt` / `file` | 承保复核记录；`review.policyId`、`review.chainId`；`file` 字段写的是导出时的**旧本机绝对路径**（历史值，未回改）。**本目录 9 份实测全是 `@1`**（2026-10-12 复核）；当前脚本写的是 `@3`（`04-脚本/hook-watch.js:60-61`：`payoutWei` 也从 `review` 挪进 `observed` —— 未赔付保单链上 `payout` 恒 0，放进哈希会让「赔付后重算同一条留痕」换哈希）。**既有 `@1` 文件不回改、不重签** |

## 2. 根目录留痕（判断环节，按保单号 policyId）

| 保单 # | snapshot（判定输入） | judgement（判定输出） | 该保单的承保复核 | 链归属（实测 `snapshot.oracle.chainId` / `simulated`） |
|---|---|---|---|---|
| #0 | `snapshot-policy0.json`（3,837 B） | `judgement-policy0.json`（1,094 B） | `承保复核-chain11155111-policy0.json`、`承保复核-chain968-policy0.json` | **11155111（Sepolia）**，`simulated=false` |
| #1 | `snapshot-policy1.json`（2,096 B） | `judgement-policy1.json`（1,408 B） | `承保复核-chain11155111-policy1.json`、`承保复核-chain968-policy1.json` | 11155111，**`simulated=true`**；judgement 也是 `simulated=true`、`decisionLabel=PAY`、`confidence=94` |
| #2 | `snapshot-policy2.json`（2,151 B） | `judgement-policy2.json`（1,402 B） | `承保复核-chain968-policy2.json` | **968（BOT Chain Testnet）** |
| **#3** | **缺 `snapshot-policy3.json`** | **缺 `judgement-policy3.json`** | `承保复核-chain968-policy3.json`（2,611 B）**存在** | —（**判定留痕缺失**） |
| #4 | `snapshot-policy4.json`（2,150 B） | `judgement-policy4.json`（1,399 B） | `承保复核-chain968-policy4.json` | 968 |
| #5 | `snapshot-policy5.json`（2,150 B） | `judgement-policy5.json`（1,399 B） | `承保复核-chain968-policy5.json` | 968 |

实测结论：
- **968 的六笔判定只留下 5 笔**（#0–#5 中缺 #3）；`snapshot-policy4.json` 与 `snapshot-policy5.json` 仅有 `policyId` / `startTime` / `inputHash` 不同，其余近乎重复。
- 承保复核共 8 份：`承保复核-chain11155111-policy{0,1}.json`（Sepolia 两份）+ `承保复核-chain968-policy{0,1,2,3,4,5}.json`（968 六份，`chainId` 恒为 968）。
- ⚠️ 清单（A44）写「#0/#1/#3 只有 `承保复核-chain968-policy*.json`」：按本次实测，`承保复核-chain968-policy0/1.json` 确实在，但 `承保复核-chain11155111-policy0/1.json` **同样在**（两条链各留了一份复核）。真正缺的只是**判断环节**的 #3 两件。

## 3. ⚠️ 缺号与「链上事件 ≠ 留痕」的不可互证（对齐审计 A44）

- 两个核验台的「判定交易」锚点**已从 #3 换到 #2**（2026-10-12 晚，用户拍板）：
  - `05-演示站点/verifier.html`、`06-核验台单文件/雨证-链上核验台.html` 的 chips 行：`0x02af3d51399808cd62fca3a20bee9ef8d8716dffe5f35cbf8f5a2703a02ad6e9`（保单 #2 · 判定 PAY · `ai-judge-v1`）。
  - 换的理由是只读实测的六笔：**#2 / #4 / #5** 的链上 `inputHash` / `outputHash` 与本目录 `snapshot-policy{N}.json` / `judgement-policy{N}.json` 的重算值**逐字节相同**、`modelVersion = ai-judge-v1`；而 **#0 / #1 / #3** 的 `modelVersion` 是 **`bot-rehearsal-v1`**（`04-脚本/rehearse-v2.js` 提交，两个哈希是 `keccak256("input/N")` / `keccak256("output/N")` 占位值），本来就没有 AI 留痕。
  - 旧的 #3 锚点 `0x25148f13742d89dce755cee28f72366ed89a6ef577ab7d13ebb36d893fcc2211` 在链上仍是一笔**真实且可读**的判定交易（PAY · 置信 90 · 源 3 · 区块 25,980,217），只是它由排练脚本提交 ⇒ 与 AI 留痕不可互证。哈希仍留在 `02-作战与答辩/汉客松-交易哈希清单.md` §5.2 与提交表里（已就地标注为排练提交）。
- ⚠️ 本目录的 **#0 / #1 两套留痕属于第一阶段 Sepolia 链**（`chainId 11155111`，见 §1 表；#1 的 `simulated=true`）⇒ 它们与 968 上那两笔排练提交不是一回事，别拿它们去解释 968 的 #0 / #1。
- 本 README **不补造任何 JSON**：重跑管线生成的会是**新**记录、不是当时那一笔（且见 §5「重跑即毁证」）。
- **2026-10-12 处置（A）**：两个核验台的锚点哈希**照旧保留**（它是一笔真实的链上判定交易，仍是现场最值得反查的那一个），但在锚点下面各加了一行可见声明：这笔判定的 AI 留痕未保留、所以不能与 AI 留痕互证（`05-演示站点/verifier.html`、`06-核验台单文件/雨证-链上核验台.html` 的 chips 行下方）。若要彻底闭合，两条路都还在：① 把锚点换到有留痕的保单号（需另取一个真实的 `JudgementSubmitted` 哈希并同步改标签）；② 从生成管线补一份**明确标注为「事后重跑」**的 #3 留痕。两者都留待决策。

## 4. 子目录（历史暴雨回放，各 1 组）

| 子目录 | 文件 | schema | 实测要点 |
|---|---|---|---|
| `2024武汉暴雨回放/` | `snapshot-policy0.json`（6,354 B）、`judgement-policy0.json`（1,256 B） | `judge-input@1` / `judgement@1` | snapshot `policyId=0`、`chainId=11155111` |
| `2026-08-09上海暴雨回放/` | `snapshot-policy0.json`（6,570 B）、`judgement-policy0.json`（1,248 B） | `judge-input@1` / `judgement@1` | snapshot `policyId=0`、`chainId=11155111`、`epoch=2026-06-01`、`simulated=false` |

## 5. 重跑即毁证

这些 JSON 是**判定过程的原始留痕**（含 `inputHash` / `outputHash` / `reviewHash`），重跑生成管线数值会变 —— 与 `08-截图存证/README.md` 里「Sepolia 四份 JSON 不重拍」同一条理由。**引用时以文件内的哈希与 `collectedAt` / `decidedAt` 为准。**
