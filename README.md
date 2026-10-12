# 雨证 · RainProof

[![Gates](https://github.com/juice-butterfly/rainproof/actions/workflows/gates.yml/badge.svg)](https://github.com/juice-butterfly/rainproof/actions/workflows/gates.yml)
[![Deploy demo site](https://github.com/juice-butterfly/rainproof/actions/workflows/deploy-demo.yml/badge.svg)](https://github.com/juice-butterfly/rainproof/actions/workflows/deploy-demo.yml)

> **可验证的 AI 参数化配送险** —— 把「你信不信我」换成「你自己验」。

汉客松 S1 & ETH Wuhan 2026 参赛作品 · 赛程 2026-10-06 20:00 → 2026-10-08 12:00
队名：**神麻** · 仓库：https://github.com/juice-butterfly/rainproof

---

## RainProof at a glance (English)

> **Verifiable AI parametric delivery insurance** — replace *"trust me"* with *"verify it yourself"*.

- **What it is** — a parametric rain policy for food-delivery riders. The rules live in a smart contract, the rainfall reading is written on-chain by an oracle, and the payout fires when the on-chain rainfall crosses the tier line. No claim filing, no loss adjustment, the rider proves nothing.
- **Deployed on BOT Chain Mainnet (chainId 677)** — underwriting contract `0x89e7C942535930B61cB61631051E8b0bD670596a` (v3, runtime 15,823 B; deploy tx `0x54fc1e69…f436`). Demo site: https://juice-butterfly.github.io/rainproof/ — it reads mainnet 677 by default and falls back to Testnet 968 (RPC `rpc.bohr.life`) when the mainnet RPC is unreachable from your network. Explorer links: see the delivery checklist below.
- **v3 underwriting layer** (deployed on mainnet 677; verified end-to-end on a local replay chain) — cover windows **12 h / 24 h only** (GB/T 28592—2012), threshold table 12 h → **30 / 70 mm**, 24 h → **50 / 100 mm**, two payout tiers **50% / 75%**.
- **AI judgement layer** — three independent weather models are crossed-checked, deterministic rules R1–R5 return **DENY / PAY**, and the input hash + output hash go on-chain. The LLM never decides, and its explanation never enters the hash.
- **Verify it yourself** — open `06-核验台单文件/汉客松-链上核验台.html` (one file, no backend) or the demo site's `verifier.html`, paste any transaction hash or address, and read the raw `eth_getLogs` / `eth_getTransactionByHash` output. No block explorer required.
- **Team** 神麻 · 汉客松 S1 & ETH Wuhan 2026. The rest of this README is Chinese-first; this block is the English summary.

---

## 主网交付清单（BOT Chain Mainnet · chainId 677）

> 下列链接都指向 BOT Chain 官方浏览器 `scan.botchain.ai`。**注意：国内网络直连 `*.botchain.ai` 目前不通（TCP 443 被拦），打开链接需要代理/VPN**；链上事实本身可以用任意 RPC 独立复核（见本节末尾命令），不依赖浏览器、也不依赖我们的页面。

| 这条证明什么 | 地址 / 交易 |
|---|---|
| 承保合约 **v3**（运行时 15,823 字节） | [`0x89e7C942535930B61cB61631051E8b0bD670596a`](https://scan.botchain.ai/address/0x89e7C942535930B61cB61631051E8b0bD670596a) |
| 部署 v3（区块 25,921,072 · gas 3,518,186 = **0.07036372 BOT**） | [tx `0x54fc1e69…f436`](https://scan.botchain.ai/tx/0x54fc1e694748338d63a2e9f6f46cf2c8623eaa141b71a10904a7b56dc3b9f436) |
| **2/3 多签** `OperatorMultisig`（运行时 4,746 字节） | [`0x676b791da72Ef072718c9f078377bF21be1b160f`](https://scan.botchain.ai/address/0x676b791da72Ef072718c9f078377bF21be1b160f) · 部署 [tx `0x16a80230…8b3f`](https://scan.botchain.ai/tx/0x16a80230a0d7cb6b4e3e2c551730d89a60a1c5f9f34ae6416ac45a22ecef8b3f) |
| `operator` 已移交多签（原单钥匙从此改不动喂价与判定） | [tx `0xf713302a…fea3`](https://scan.botchain.ai/tx/0xf713302aa8c54b4b809f068f6c864e200ccd29654c5baaf1e8a694cbec03fea3) |
| 2-of-3 真跑通一次状态写入（2 票 · `executed=true`） | [submit `0x312dcd0c…fbf5`](https://scan.botchain.ai/tx/0x312dcd0c4cf0e17153ee2a018e8b8dac0e6a2e8c4f45d4e1a05d8c8f46b1fbf5) · [confirm `0x7b679243…9832`](https://scan.botchain.ai/tx/0x7b67924326127bf07f941c2c9b0ace51f971062e23dd6abf1b03ba0282539832) |
| 注池 0.05 BOT（`fundPool`，任何人可触发） | [tx `0xe36da83a…f9aa`](https://scan.botchain.ai/tx/0xe36da83a8a107d8fe4e90c998a9d012a2a69ee46ee6831ea2cebd8e208dff9aa) |
| 喂价：武汉 67 mm | [tx `0x1d5384ce…d8af`](https://scan.botchain.ai/tx/0x1d5384ce45c70042f3bb7744120ede46e6f6a936d358eb4c89f822fb5678d8af) |
| 喂价：上海 128 mm | [tx `0x377fc386…fe84`](https://scan.botchain.ai/tx/0x377fc38670443cfaabb753d04cbdb5845af51897ce796ed9a6dd86951b6bfe84) |
| 喂价：北京 39 mm | [tx `0x7ca72ceb…4d8e`](https://scan.botchain.ai/tx/0x7ca72ceb8d279828e866425885a9725bc6c9cc28e44109bba46f46eb5a1b4d8e) |
| 喂价：广州 162 mm | [tx `0x57c9daec…38e1`](https://scan.botchain.ai/tx/0x57c9daecbf02ffa70ecc16bcd13bdf67bd1ebeda6886a388b2e363f7b24238e1) |
| 成都被闸门拒收（三模型离散度超容差，读数不上链，拒收也留痕） | [tx `0x25383509…f956`](https://scan.botchain.ai/tx/0x25383509ce33c3a84526889bf4e7ed0fb968af2dfe3ad13d100f73500ae3f956) |
| **真实产品交互**：钱包投保 2 笔 → 冷静期退保 2 笔 | 退保 [tx `0x6fa9c09a…4476`](https://scan.botchain.ai/tx/0x6fa9c09ab04ece18444350571460281fc184362569cd3ef8e1aefc3c21224476) · [tx `0x5519b6d1…bc29`](https://scan.botchain.ai/tx/0x5519b6d1f3b40af47518c733db72253aff0be100b95871c5dffd2667d694bc29) |
| 10 格差异化保费网格（5 城 × 12h/24h，20 笔多签交易） | 完整哈希见 [链上留痕-主网677-v3部署.md](08-截图存证/链上留痕-主网677-v3部署.md) §六 |

自己独立复核（不需要浏览器，也不需要我们的页面）：

```powershell
$env:SEPOLIA_RPC='https://rpc.botchain.ai'    # 变量名是历史遗留，内容填目标链的 RPC
node 04-脚本/push-rainfall.js --status        # 资金池 / 五城累计降雨 / 阈值 / 喂价时效
```

### 连不上主网时：演示页自带的链上快照（2026-10-11）

`05-演示站点/frozen-node.js` 里烘了一份**主网 677 的链上快照**（节点当时的原始回答：合约地址、代码长度 15,823 字节、
资金池 0.05 BOT、五城累计 67/128/39/162/0 mm、两档阈值、10 格差异化保费、8 条事件含成都拒收）。
页面的节点阶梯（官方 677 → Vercel 中转 → 测试网 968）**全部连不上**时自动用它兜底，并在顶部打出横幅、
链名写成「BOT Chain Mainnet · 链上快照」—— 不假装是实时数据。`?snap=1` 强制只看快照，`?snap=0` 关掉兜底。

```powershell
node 07-测试工具/make-frozen-node.js --from-rpc   # 能连主网时（或走代理）真抓一份，最完整
node 07-测试工具/make-frozen-node.js --rebuild    # 连不上时用已核实的读数重建（仓库里这份就是这个来源）
cd 07-测试工具; node check-frozen-node.js         # 17 项断言：快照与页面口径必须一致
```

> 诚实边界：快照是**某一时刻的读数**，不是实时；它只覆盖读操作（不含真字节码、不含交易回执），
> 是「没代理也能看懂主网长什么样」的兜底，不能替代能连主网的节点。国内真正缺的是一条可达的 677 RPC
> （Ankr 认这条链，但要付费 / 要 API key —— 2026-10-11 实测匿名调用 403，**不采用**。现行规划按「评委在外网」：官方

---

## 1. 项目介绍

### 目标用户

外卖骑手。当前覆盖五个城市：**武汉 / 上海 / 北京 / 广州 / 成都**（合约里的区域表，见 `04-脚本/regions.js`）。

### 解决的问题

暴雨天骑手跑不了单，当天收入直接断掉。传统保险要报案、定损、核赔，周期以周计；而且骑手和保险公司
对「那天下没下暴雨、下了多少」经常各执一词 —— **争议点在于谁来认定事实，而不在于赔多少**。

### 核心功能：参数化保险

规则写进智能合约，气象数据由预言机写到链上，**雨量越过阈值就赔付**，全程无需人工核赔：

| 步骤 | 谁做 | 做什么 |
|---|---|---|
| ① 投保 | 骑手 | 交该区域保费（**0.0002–0.0020 ETH，按「区域 × 保障时长」网格差异化**），锁定「区域 + 保障时长（**v3 口径 12 / 24 小时**，国标 GB/T 28592—2012 唯二的两档；968 上的 v2（测试网留痕）现卖 24 / 48 / 72）」，并记下投保当刻的链上降雨快照 `rainfallAtBuy` |
| ② 喂价 | 预言机 | 把该区域自起点（`RAIN_EPOCH`）以来的累计降雨量写到链上，附**置信度、来源数、证据哈希** |
| ③ 判定 | AI 判定层 | 三个独立气象模型交叉复核 → 确定性规则给出 **DENY / PAY** → 结论 + 输入哈希 + 输出哈希一起上链 |
| ④ 赔付 | 任何人 | 保单期间降雨增量达到该时长的档线（**v3 查国标表**：12h → **30 / 70 mm**、24h → **50 / 100 mm**；链上 v2 是 `50 × h / 24` 外推，24/48/72h → **50 / 100 / 150 mm**）、AI 判定为 PAY、置信度 ≥ **60** → 按档位赔付（**v3 两档 50% / 75%**；v2 三档 50% / 75% / 100%，单笔最高 0.01 ETH）给骑手 |

**演示基线（对外统一口径）**：BOT Chain 主网 **677** 上的 **v3 合约**
`0x89e7C942535930B61cB61631051E8b0bD670596a`（2026-10-08 部署；`rpc.botchain.ai` / `scan.botchain.ai`）。
BOT Chain 测试网 **968** 上的 v2 降为**测试网留痕**（6 张保单已全部赔付；要看它加 `?rpc=https://rpc.bohr.life`）。
Sepolia 上的 v1 是**第一阶段留痕**，见文末「第一阶段留痕（Sepolia v1）」——别再拿它当演示对象。

关键参数（`03-合约/RainDeliveryInsuranceV2.sol`；下表 `constant` 的部分部署后不可改）：

| 参数 | 值 | 说明 |
|---|---|---|
| `PAYOUT_MAX` | 0.01 ETH | 最高（100%）档赔付额；实赔走 `tierBps` 50% / 75% / 100% |
| `THRESHOLD_PER_24H` | 50 mm | 国标 24h 暴雨下限；`thresholdOf(24/48/72)` = **50 / 100 / 150 mm** |
| `MIN_HOURS` / `MAX_HOURS` | 24 / 72 | 只卖 24 / 48 / 72 三档（`hoursAllowed`） |
| `MIN_CONFIDENCE` | 60 | AI 判定与喂价验收共用的门槛 |
| `REGION_COUNT` | 5 | 1=武汉 2=上海 3=北京 4=广州 5=成都 |
| `MAX_FEED_AGE` | 24 h | A4b：投保前 24h 内该区域必须喂过价 |
| `MAX_POLICIES_PER_RIDER` | 3 | A3：**终身**笔数上限（结算不回退） |
| `MAX_OPEN_EXPOSURE_PER_RIDER` | 0.02 ETH | A3：同时在保的赔付额上限（= 2 × 满额） |
| `MIN_PREMIUM` | 0.0002 ETH | A1：保费地板 |
| `PREMIUM_DEFAULT` | 0.001 ETH | 没设过网格价/区域价时的兜底 |
| `PRODUCT_RAIN` | 1 | A9：险种编号（只做了暴雨） |

**其中两个不是 `constant`、`operator` 能改的开关**，所以对外要分版本说：`coolingPeriod`（默认 3 天，**968 上的 v2 是 0，677 上的 v3 读回 `259200` = 3 天**）与
`eligibleRequired`（白名单总开关，**968 上的 v2 是 false**）。链上现值直接读，别背：`node 04-脚本/keeper.js --once --dry-run`。

`PREMIUM_DEFAULT` 只是**兜底常量**。实际保费走合约里的两个承保旋钮
`setUnderwriting(regionId, level, premium, reasonHash)` 与 `setPremiumGrid(regionId, hours, premium, reasonHash)`（只有 operator 能调），
读价接口 `premiumOf(regionId, hours)` 逐级回退：**网格价 → 区域基准价 `aiPremium` → `PREMIUM_DEFAULT`，且不低于 `MIN_PREMIUM`**。
链上现价**不是手填的**：
`04-脚本/set-premium.js` 读 `10-金融与定价/actuary-output.json`（11 年逐小时实测），按
`上整( p × PAYOUT ÷ 0.60 )` 算出（**0.60 是赔付率上限 R\*** —— 约束是「期望赔付率不超过 60%」，不是「把 60% 当分母」的定价目标；v3 的完整式还把单笔固定成本 `C` 算进去：`P_net = ceilTick((E_upper × PAYOUT + C)/0.6)`，推导见 `10-金融与定价/定价逻辑与正收益保障-B-2026-10-07.md:175-181`），依据串照抄即可复算出同一个 `reasonHash`。

| 区域 | 72h 触发概率 | 链上保费（72h 档） | 赔付率（旧统一价 0.001 口径） | 现价赔付率 | 承保动作 |
|---|---|---|---|---|---|
| 武汉 | 4.770% | 0.0008 ETH | 47.7% | 59.6% | NORMAL |
| 上海 | 4.557% | 0.0008 ETH | 45.6% | 57.0% | NORMAL |
| 北京 | 2.281% | 0.0004 ETH | 22.8% | 57.0% | NORMAL |
| **广州** | **11.574%** | **0.0020 ETH** | **115.7%** | 57.9% | **RISK_LOADED** |
| 成都 | 3.724% | 0.0007 ETH | 37.2% | 53.2% | NORMAL |

> p 为 11 年（2015-10 → 2026-09）逐小时真实降水、72 小时滑动窗口、**整数十分位零浮点**的权威值
> （`10-金融与定价/audit-verified.json`；`node 10-金融与定价/audit_numbers.js` 可复算）。
> 现价赔付率 = `p × PAYOUT ÷ 链上保费`，五城 53%–60% —— 因为现价正是 `上整(p × PAYOUT ÷ 0.60)` 算出来的（**0.60 是赔付率上限 R\***，即「期望赔付率不超过 60%」这条约束；v3 的完整式还把单笔固定成本算进去，见 `10-金融与定价/定价逻辑与正收益保障-B-2026-10-07.md:175-181`）。
>
> 广州这一行就是**为什么统一价 0.001 在真实数据下会亏**：收 1 赔 1.16。
> **但不要读成「广州一定亏」**：它的月聚类自举 95% 区间是 **[9.35%, 13.88%]**，下界低于 10% 保本线，
> **越线本身不显著**；能站住的说法是「广州**显著高于**其余四城，所以我们单独加价」。
> 链上两轮定价变更（日粒度口径 → 72 小时权威口径）都有 `UnderwritingDecision` 事件留痕，参数怎么变的可查。

**v3：补齐缺的三个维度（已算好并核验；**v3 定价模块已作为独立合约部署在 968**，产品合约赛期不动）。** 上表那一列是**链上 v2 网格在 72h 档上的现价**
（v2 已按「区域 × 保障时长」出价：武汉 0.0002 / 0.0005 / 0.0008，广州 0.0003 / 0.001 / 0.002，
都能用 `premiumOf(regionId, hours)` 读回 —— 以链上为准，别背）。
⚠️ **别说「v2 各档同价」**：同价的是**更早的 v1**；v2 是 15 格逐格不同价，只是 **24h 列多数格触到 0.0002 保费地板**，短端看起来被压平——那是地板效应。
v2 里真正缺的是**骑手类型 / 渠道 / 购买量**。v3 把它换成
`premiumOf(regionId, hours, riderTier, channel, count)`：**40 格零售 + 120 格批量带**，
在 v2 已有的地区×时长之上补上 用户类型（众包/认证/平台团体）× 场景（自助/平台代付）× 购买量（1–1000）。
**时长只有 12h / 24h 两档** —— 因为 GB/T 28592—2012《降水量等级》§3 只定义了这两个时段，
档线就直接取国标表 1 的暴雨 / 大暴雨下限（12h 30/70mm、24h 50/100mm）。
v2 的 48h/72h 是 `50 × h/24` 的线性外推：国标自己 24h÷12h 的比值是 1.667/1.429/1.786、**没有一个是 2**。
实测更直接，**同基数**（武汉，拿链上 v2 自己的 24h 与 72h 比）：保费 0.0002 → 0.0008（**多付 4 倍**），
档 0 触发率 0.4377% → 0.2117%（**中奖率降到 1/2.07**）—— **多付钱、换更低的中奖率**。
（常被引用的"72h 只有 12h 的 1/4"是**跨档线**比的：v2 72h 的 150mm 对 v3 12h 的 30mm，基数不同，说的时候必须带档线。）所以删掉。
五维合起来极差 **3.750×**（最低 北京 12h 平台团体 0.00028 → 最高 武汉 24h 众包自助 0.00105）；
其中"用户类型 × 场景"这一对在同一城市同一时长内就有 **1.893×–3.194×** 的价差（最陡 成都 24h：平台团体 0.00031 → 众包自助 0.00099）；
单份**固定成本**（判定 gas ＋ 期望赔付 gas）从 **0.00013053 → 6.6e-7 ETH**（逐格摊薄 **84×～326×**，武汉 12h 平台团体格 198×）。

**40 格全部卖得动，0 格触到尊严上限**：最贵那格 0.00105 ETH 离 0.002 还有 **1.90 倍**余量
（原来那 3 格"不卖"的成因就是 72h —— 随 72h 一起消失）。代价是身份分档从"开关"变成"倍数"：
成都 24h 众包自助 0.00099 vs 平台团体 0.00031 = **3.18 倍** ——
**"平台 attestation"不是风控装饰，它直接决定你付几倍价钱。**

**v3 定价模块已上链**（是**独立合约**，不在产品合约里）：BOT Chain 968 `0xB339EdA9d9491584716e9900c7bf2987cf4bfB5A`，
部署 tx `0xb6553004…5024`（区块 26,002,511，运行时代码 3,522 字节）。
链上那一版是**上一轮口径（60 格零售价 + 360 条批量带、24/48/72）**，**逐格可读** —— `cd 07-测试工具 && node check-v3-prices.js` 拿**冻结在链上那份规格的对照表**（`07-测试工具/fixtures/pricing-engine-deployed-968.json`，取自部署当时）真读 968 比对 **480 项全部相符**；本轮按国标重建的那份 **40 格 / 12h-24h** 表用 `node 10-金融与定价/ref/verify_pricing_v3.js` 自证（真编译 + 内存链，687 项）；**本轮重建的 40 格 / 12h-24h 尚未上链**。
产品合约（承保 / 赔付那一支）这轮**不动**，为的是不把现有链上存证作废；两者是分开的两支。

> 复算：`cd 10-金融与定价 && node pricing_engine.js --self-check`（**509 项断言**）；
> 数表 `node pricing_engine.js --md` → `定价体系-v3-数表.md`。
> 设计 [`定价体系-v3.md`](10-金融与定价/定价体系-v3.md) ·
> B→A 规格 [`v3-合约规格.md`](10-金融与定价/v3-合约规格.md) ·
> 参考合约 [`ref/PricingV3.sol`](10-金融与定价/ref/PricingV3.sol)（solc 0.8.37 **真编译 + 内存链部署 + 40 格读回比对**）。
> ⚠️ 这次真编译抓出一个纸面审查看不出的 bug：Solidity 定长多维数组下标**从右往左**对应，
> 声明写反会让 `band≥4` 直接 `Panic ARRAY_RANGE_ERROR`。**"能编译"和"跑得对"是两件事。**

### 为什么用链，以及它到底承重多少

我们不主张「不用链就做不了」—— 纯中心化服务也能实现同样的流程。链带来的、**我们的实现真正承重的**是两条：

1. **规则不可事后修改**：上表里 `constant` 的那些参数、以及国标分档公式（`thresholdOf` / `tierOf` / `tierBps`），
   部署后连部署者自己也改不了。`operator` 能改的**只有** `coolingPeriod` 与 `eligibleRequired` 两个开关，
   以及承保价（`setUnderwriting` / `setPremiumGrid`）——这三类改动全部留事件，可以查、可以复算。
2. **判定过程公开可复算**：每次喂价和每次 AI 判定都把**输入证据哈希 + 输出结论哈希**写进链上事件，
   链上不存原文。任何人拿到 `09-AI判定留痕/` 里的 JSON 重算一遍，就能验证我们没在事后改结论。

**还没承重的部分我们也说清楚**：预言机目前是单一运营方在喂价；准备金下限要**分版本说** ——
v1 只有 `reserve` 且**没有自动规则**（operator 手工设定、设为 0 时池子可被提空），
v2 已把它自动化成 `reserveOf() = max(reserve, openExposure)`（买入累加、赔付与到期结算回收，提款被它夹住）；
AI 判定登记后不影响已生效的赔付条件。详见下面「已知边界」。

### 比赛期间完成的工作

用 git tag 划界，可自行复算：

| 边界 | tag | commit（`git rev-parse <tag>^{commit}`） |
|---|---|---|
| 赛前基线 | `baseline-pre-hackathon` | `b522196` |
| 开赛分界 | `hackathon-start` | `31d7851` |
| 开赛前最后一次提交 | `prestart-freeze` | `73bb6bc` |
| 赛期全部提交 | — | `git log --oneline prestart-freeze..HEAD` |

> 三个 tag 都是**带注释的 tag**，`git rev-parse <tag>` 给出的是 tag 对象哈希（`4f0e29e` / `a353b34` / `2eabfa1`），
> 上表的 commit 由 `git rev-parse <tag>^{commit}` 得到 —— 两个都对，但引用"赛前基线是哪一笔"要写 commit。

**赛期新增（相对 `prestart-freeze`，`git diff --stat prestart-freeze..HEAD` 可复算）**：

- **合约判定层**：`submitJudgement` / `judgements` 映射 / `MIN_CONFIDENCE` / `reserve()` /
  `aiPremium()` / `riskLevel()` / `feedJudgements()` 等 —— 赛前基线里**完全没有**这些（已用
  `git show hackathon-start:03-合约/RainDeliveryInsurance.sol` 逐项核对）。
- **AI 判定模块**（`04-脚本/`）：`canonical.js`（确定性哈希口径）、`regions.js`（唯一区域表）、
  `ai-collect.js`（三模型证据快照）、`ai-judge.js`（确定性判定，大模型只写解释）、
  `submit-judgement.js`（提交前重算核对 + 提交后读回校验）。
- **AI 喂价闸门**：`04-脚本/feed-verify.js` —— ECMWF / GFS / ICON 三个**独立机构**的模型各拉一份
  逐日序列，只在公共日期上比「自 RAIN_EPOCH 起的累计值」，多数落在中位数 ± 容差内才认这份数据；
  `push-rainfall.js` 写链前调它，不认就走 `rejectFeed` 留证（**拒收也是一种上链动作**）。
  2026-10-07 首跑即真拒收一次（广州），见 `02-作战与答辩/汉客松-交易哈希清单.md` §三。
- **事件钩子（承保复核）**：`04-脚本/hook-watch.js` —— 链上一出现 `PolicyBought`，AI 层就对这份保单
  自动做一次**独立复核**并留痕到 `09-AI判定留痕/承保复核-chain<链号>-policy<id>.json`（文件名带链号：
  同一地址在 Sepolia 与 BOT Chain 上是两个合约）：查窗口时长是否在合约允许的
  24/48/72 内、基线单调（投保时 ≤ 现值）、喂价新鲜度（> 24h 标红）、三模型是否认这份天气形势，
  以及链上累计值与三模型中位数的背离（阈值 60%，与判定层 R2 同口径）。
  **它不改链上状态、不阻断投保、也不代替判定** —— 判该不该赔是 `ai-judge.js` 的事。
  「拿不到数」记 `REVIEW_PARTIAL`，不假装查过。
  复算口径：进哈希的值全部取自**投保所在区块**（喂价时间用「投保区块前 10000 块内最近一次
  `RainfallUpdated`」反推，查询窗口写死，不受扫描范围影响），因此链上那一层稳定可复算；
  三模型那一层取的是投保当日的预报，隔天再拉可能拿到修订后的数值，`reviewHash` 会随之变化。
  **2026-10-08 起（schema `rainproof/underwrite-review@2`）**：`rainfall[region]` 现值、
  `policyStatus()` 这类**会随赔付/退保而变的链上读数移出 `review`、改记在 `observed` 段**。
  它们原来在 `review` 里，等于同一份留痕隔天重算就换哈希 —— 「每条留痕的哈希都能当场重算」
  这条门禁会因链上状态自己变了而红，报的还不是错。`observed` 只给人看，不参与复算。
- **测试**：`check-canonical.js`、`check-ai.js`（29 项 + 1369 个用例的硬约束扫描，含「每条留痕的哈希都能当场重算」）、`check-feed-verify.js`（喂价闸门判定 12 项 + 承保复核判定 7 项，含「极差超容差但三个都离中位数很近 → 必须判一致」这条回归用例）、
  `check-ui.js`（前端契约：降雨看板刻度与触发线对齐、保障时长三档下拉、三个页面 DOM 引用完整）、
  `e2e_contract.js`（v1 合约，73 项断言）、`e2e_v2.js`（v2 合约，101 项断言）。
- **真链部署与端到端彩排**：Sepolia 部署、真实气象数据喂价、AI 判定上链、赔付出款，
  完整留痕见 [`08-截图存证/真链留痕-2026-10-06.md`](08-截图存证/真链留痕-2026-10-06.md)。
- **差异化承保定价**：`04-脚本/set-premium.js` 把精算输出算成链上保费，
  五城从统一 0.001 改为 0.0004–0.0020（广州标 `RISK_LOADED`），依据串哈希上链。
- **历史极端天气回放**：`07-测试工具/replay_chain.js` 起一条可拨表的本地区块链，把链上时钟拨回
  2024-06-27，用**真实历史数据**（武汉三天 230mm）跑完整个闭环 —— 判定 **PAY 76**、赔付 0.01 ETH。
  过程中发现并修掉一个真缺陷（判定哈希里混进了运行时间戳，"可复算"曾经是假话），完整记录见
   [`08-截图存证/历史回放-2024武汉暴雨.md`](08-截图存证/历史回放-2024武汉暴雨.md)。
- **v3 回放（2026-08-09 上海暴雨 · 本机回放链）**：同一把「拨表」钥匙接到 **v3 合约**上再跑一遍闭环 ——
  投保 08-06（v3 冷静期 3 天 ⇒ 保障窗 08-09 00:00 → 08-10 00:00），链上累计 **448 → 553 mm**、AI 判 **PAY 91**（三模型增量 93.5 / 78 / 88.7），
  `claim` 按增量 105 mm 落 **tier1 = 0.0075 ETH**；完整记录见 [`08-截图存证/历史回放-2026-08-09上海暴雨.md`](08-截图存证/历史回放-2026-08-09上海暴雨.md)，留痕 JSON 在 `09-AI判定留痕/2026-08-09上海暴雨回放/`。
- **自动理赔 keeper**：`04-脚本/keeper.js` 轮询链上保单状态，发现 `claimable` 就替骑手领赔款。
  它能这么做，是因为 `claim(uint256)` 本身**没有权限修饰符** —— 理赔不依赖某一家运营方在线。
  边界说清楚：keeper 只负责「领钱」；**判定必须由 operator 的两条脚本先提交上链**（`ai-judge` →
  `submit-judgement`），合约里没有任何定时器。`--settle`（把到期未赔的保单结算掉、回收敞口）是
  `settleExpired`，`onlyOperator`，需要 operator 私钥。
- **演示前端**：合约地址自愈、钱包缺网络时自动添加、赔付按钮按保单状态说明原因、
  注资按钮按钱包余额封顶。

---

## 2. 代码与运行说明

### 目录结构

```
01-赛事资料/        赛事手册（权威规则来源）
02-作战与答辩/      分工与流程、交易哈希清单、下一步计划
03-合约/            RainDeliveryInsurance.sol + 编译产物（ABI / 字节码）
04-脚本/            部署、喂价、AI 采集 / 判定 / 提交
05-演示站点/        演示前端（index.html + verifier.html）
06-核验台单文件/    离线可用的链上核验台（单个 HTML，双击即开）
07-测试工具/        e2e 与规则检查、本地链准备、ABI 同步
08-截图存证/        链上留痕与截图
09-AI判定留痕/      每张保单的证据快照与判定结果（JSON）
```

### 环境依赖

- **Node.js** ≥ 20（开发时用的是 v24）
- `07-测试工具/`：`ethers ^6.13.0`、`ganache ^7.9.2`、`solc ^0.8.26`
- `04-脚本/`：`ethers ^6.13.0`、`dotenv ^16.4.5`
- 外部数据源：**Open-Meteo**（免费、无需 API Key）。AI 判定层可选调大模型写解释文案，
  不配也能跑（判定结论完全由确定性规则给出）。

### 安装

```bash
cd 07-测试工具 && npm install
cd ../04-脚本   && npm install
```

### 跑测试（不需要网络）

```bash
cd 07-测试工具
npm test          # 一条命令跑完 14 道门禁、共 483 项断言（2026-10-12 实测全绿；CI 每次推送都会重跑一遍，见上面的徽章）
```

- `check-public-repo.js`：公开仓库自检（不该进公开仓库的路径/二进制/PII 一律拒收；本机 7 项、CI 6 项 —— 差的第 7 项是「拿本地 `.env` 的真密钥去反查全部被跟踪文件」，CI 上没有 `.env`，脚本按设计打印 `[SKIP]`）
- `check-frozen-node.js`：断网快照与页面口径必须一致（code 长度 15,823 字节 = 链上 `eth_getCode`、48 条 `eth_call`、如实记录 2 条 revert、10 格保费、8 条事件）
- `make-verify-pack.js`（npm script 名 `check-verify-pack`）：贴到区块浏览器 verify 表单里的东西必须复现得了 —— 源文件无 import（本身即 flatten）、盘上 `.bytecode.txt` 与本次重编逐字节一致、运行时长度 = 链上实测的 15,823（V3，主网 677）/ 4,746（多签，677）/ 10,758（v1，Sepolia）/ 12,378（v2，968）字节；2026-10-12 起 v1/v2 也纳入（原来只查 V3 与多签，改 `.sol` 不重编能一路全绿）
- `check-canonical.js`：确定性哈希口径（递归键排序、数值精度）自检（8 项）
- `check-ai.js`：判定规则 R1–R5 + 1369 个用例的硬约束扫描（任何一格出现「PAY 且置信度低于门槛」即失败）
- `check-ui.js`：前端契约 —— 降雨看板刻度与触发线必须指同一个地方（修过的 bug 不复发）、保障时长只能是 24/48/72 三档下拉、三个页面 JS 引用的 id/class 都真实存在（防 UI 改版让按钮静默失效）、演示界面里不许出现演讲提示（讲稿与分镜只放在 `提交材料/` 与 `02-作战与答辩/`）
- `e2e_contract.js`：本地链上跑完整业务流（v1 合约），73 项断言
- `e2e_v2.js`：本地链上跑 v2 合约的九项改动（A1 保费网格 / A3 限购 / A4 冷静期 / A4b 喂价新鲜度 / A5 sources 上链 / A6 在保敞口 / A7 国标分档 / A8 白名单 / A9 productId），101 项断言 —— 它在部署前抓出过 `withdrawPool` 的 uint256 下溢缺陷

### 连真链（演示链路 = BOT Chain 主网 677，跑 v3 合约；换链只改 RPC 环境变量）

```bash
cd 04-脚本
cp .env.example .env      # 填入 PRIVATE_KEY / CONTRACT_ADDRESS / SEPOLIA_RPC
node push-rainfall.js --status    # 看链上总览：池子、5 个区域雨量、最近喂价
node push-rainfall.js             # 真实气象数据喂价（Open-Meteo）
node push-rainfall.js --demo      # 演示模式：注入模拟暴雨（链上会标记 simulated；现值 +60~130mm，不可逆）
node push-rainfall.js --refresh   # 同值刷新：累计值不变，只把喂价时刻（lastFeedAt）推到现在
node feed-verify.js               # 三模型交叉核验（只读、不写链）：认不认这份数据
node hook-watch.js --once         # 事件钩子：扫一遍链上保单，对新保单做承保复核并留痕
node ai-collect.js <保单号>        # 采集三模型证据快照 → 09-AI判定留痕/
node ai-judge.js <保单号>          # 确定性判定 → 判定结果 JSON
node submit-judgement.js <保单号>  # 重算核对后把判定提交上链
node keeper.js --once             # 理赔 keeper：赔掉所有 claimable 的保单（claim() 无权限，谁跑都行）
node keeper.js --once --settle    # 额外把「到期未赔」的保单结算掉、回收在保敞口（onlyOperator，需 operator 私钥）
node rehearse-v2.js               # v2 九项改动彩排（默认只读演练，--apply 才发交易）
node set-premium.js               # 承保价网格读/写（默认只读，--apply 才写链）
```

### 部署合约

```bash
cd 04-脚本
npm run deploy        # v3（RainDeliveryInsuranceV3.sol，现行产品；968 与主网 677 上跑的就是它）
npm run deploy:v2     # v2（RainDeliveryInsuranceV2.sol，968 上的测试网留痕那版；先跑 npm run compile:v2）
npm run deploy:v1     # v1（RainDeliveryInsurance.sol，2026-10-06 第一阶段留在 Sepolia 的那版）
# 版本旗标必须显式给（不带旗标的 `node deploy.js` 直接报错退出，防止默认部署错版本）；主网 677 另需 --yes-mainnet
```

换链只改 RPC 环境变量（脚本用 chainId + 块高双重确认身份，认不出的链会直接拒绝）：

```bash
# BOT Chain 主网（chainId 677，RPC https://rpc.botchain.ai）—— 主网要显式加 --yes-mainnet 才发交易
$env:SEPOLIA_RPC='https://rpc.botchain.ai'; npm run deploy -- --yes-mainnet

# BOT Chain 测试网（chainId 968，RPC https://rpc.bohr.life，水龙头 https://faucet.botchain.ai 免费领 BOT）
$env:SEPOLIA_RPC='https://rpc.bohr.life'; npm run deploy:v2
```

**部署前先确认两件事**：① 部署账户在目标链上有原生代币付 gas（v2 部署约 260 万 gas，20 gwei 下约 0.05 BOT）；② 能连上 RPC（`rpc.botchain.ai` 在部分网络下 DNS 会被污染、解析到无法连接的地址，需要换网络或挂 VPN）。余额为 0 或连不上时脚本会明确报出来，不会静默重试。

**主网 gas 从哪来**：主网**没有**水龙头。按 [BOT Chain 项目集成指南](https://docs.google.com/document/d/1xYzdfJlD08UOV9CKE3nV7NTSQg6lPz9B17aIW2NF5Wg/edit)与[开发者文档](https://dev-docs.botchain.ai/docs/Developers/quick-guide/)，主网 BOT 只能在官方 [B DEX](https://dex.botchain.ai/#/swap) 用已支持的资产换（或由主办方为参赛项目发放）；测试网 BOT 从 [水龙头](https://faucet.botchain.ai)免费领。所以顺序是：**先测试网跑通 → 再拿主网 gas 上线**。

### 在线演示（不用装环境，直接点开）

**https://juice-butterfly.github.io/rainproof/**

由 GitHub Pages 直接从 `05-演示站点/` 发布（见 `.github/workflows/deploy-demo.yml`），**与仓库里的文件字节一致**，不是另一份副本。

- **只读浏览不需要钱包**：降雨看板、资金池余额、事件流、核验台打开就能看 —— 这些数据是页面现读 **BOT Chain 主网 677** 的（连不上主网时按「677 → 只读中转 → 968」阶梯回退，全都连不上就落到页面自带的 677 快照，横幅写明「页面自带快照，非实时」；退到 968 时写明当前是测试网。现场不想赌网络可加 `?snap=1`，想关掉兜底用 `?snap=0`）。
- 要真的走「投保 / 注资 / 申请赔付」，需要浏览器装 MetaMask 并切到 BOT Chain 主网（chainId `677`）。这是链上交互的固有前提：网页不能替用户签名。
- 核验台：https://juice-butterfly.github.io/rainproof/verifier.html

### 打开演示前端（本地，开发用）

```bash
# 需要一个 HTTP 服务（MetaMask 默认不注入 file:// 页面）
python -m http.server 8090 --directory 05-演示站点
# 然后浏览器打开 http://127.0.0.1:8090/index.html
```

钱包连 BOT Chain 主网（chainId `677`；页面在你钱包里没有这条链时会自动帮你加）。要看去 968 上的测试网留痕，给页面加 `?rpc=https://rpc.bohr.life`。

### 离线核验（不依赖任何在线区块浏览器）

双击 `06-核验台单文件/汉客松-链上核验台.html`，把交易哈希或地址粘进去即可。
> ⚠️ 不要用 `sepolia.otterscan.io` —— 它的后端节点已挂，页面会一直转圈。

---

## 3. 链上地址

**演示基线是 BOT Chain 主网 677 上的 v3**（2026-10-08 起）；BOT Chain 测试网 968 上的 v2 是**测试网留痕**（要看它加 `?rpc=https://rpc.bohr.life`）；Sepolia 上的 v1 是第一阶段留痕与对照，别拿它们当演示对象。

### 演示基线：BOT Chain 主网 677（v3）

| 项 | 值 |
|---|---|
| 网络 | BOT Chain 主网（chainId `677` · RPC `https://rpc.botchain.ai`） |
| 合约（v3） | `0x89e7C942535930B61cB61631051E8b0bD670596a`（与 968 上的 v2 **地址相同、合约不同**） |
| 运行时代码长度 | 15,823 字节 |
| 浏览器 | https://scan.botchain.ai/address/0x89e7C942535930B61cB61631051E8b0bD670596a |
| 当前状态 | 池子 0.05105 BOT · 五城真值已喂（2026-10-09 写入，现已在 24h 保鲜期外：`MAX_FEED_AGE` 到期后 `buyPolicy` 会 revert `stale feed`，重喂需 2/3 多签）· 10 格差异化保费网格（12h / 24h 两档）已落链 · 3 笔投保 + 2 笔冷静期退保，尚无赔付 |
| 完整交易记录 | [主网 677 的部署与写价留痕](08-截图存证/链上留痕-主网677-v3部署.md) · [BOT Chain 677 主网哈希](02-作战与答辩/汉客松-交易哈希清单.md) |
| 测试网留痕 | BOT Chain 测试网 968 上的 **v2**（12,378 字节）：池子 0.0643 BOT · 准备金 0 BOT · 6 张保单（**6 张全部已赔付**）· 五城累计 101 / 287 / 109 / 303 / 227 mm → 完整事件见 [BOT Chain 968 的全部链上事件](02-作战与答辩/汉客松-交易哈希清单.md)（§五），页面加 `?rpc=https://rpc.bohr.life` 可切过去看 |

PPT、存证截图与两版演示片是按 968 上的 v2 录制的（录制时 677 尚未部署 v3）；材料里那些 968 数字是真实留痕，不是现读。

演示页与核验台默认读的就是这一条链：`05-演示站点/index.html` 里 `CHAIN_ID = 677n`，
且页面用 **chainId + 块高双重确认**身份（块高太小一律判为本地假链，并锁死投保 / 注资）。连不上 677 时按「**677 → 只读中转 → 968**」的并行阶梯回退，退到 968 时页面会写明当前是测试网，不假装还在主网；**全都连不上时落到页面自带的 677 快照**（真实读数、块 25,950,600），横幅如实写「页面自带快照，非实时」——现场想不赌网络就加 `?snap=1`，想关掉兜底加 `?snap=0`。
主网 677 **已部署 v3**（2026-10-08 10:06 +0800；`operator` 10:48 交给 2/3 多签 `0x676b791da72Ef072718c9f078377bF21be1b160f`——`updateRainfall`/`submitJudgement` 从此要 2 个 owner 同意，`claim`/`fundPool` 依旧谁都能触发）· 10 格保费网格已按定价引擎表写入（武汉 0.00076/0.00105 · 上海 0.00059/0.0007 · 北京 0.00053/0.00068 · 广州 0.00077/0.00097 · 成都 0.00075/0.00099，12h/24h）：`0x89e7C942535930B61cB61631051E8b0bD670596a`，部署 tx `0x54fc1e694748338d63a2e9f6f46cf2c8623eaa141b71a10904a7b56dc3b9f436`（区块 25,921,072 · gas 3,518,186 = 0.0704 BOT），运行时 15,823 字节；链上实测两档阈值 `entryThresholdOf(24)=50` / `thresholdOf(24,1)=100`、`TIER_COUNT=2`、`coolingPeriod=259200`（3 天）、`MIN_PREMIUM=0.00002`。**968 上的 v2 是测试网留痕**（要看它加 `?rpc=https://rpc.bohr.life`），两链同址不同合约。

### 第一阶段留痕：Sepolia `11155111`（v1）

赛期第一阶段用 v1 合约在 Sepolia 上把「喂价 → 投保 → 判定 → 赔付」整条流程真跑过一遍，证据留在这里：

| 项 | 值 |
|---|---|
| 合约（v1） | `0x89e7C942535930B61cB61631051E8b0bD670596a` —— 与 968 上的 v2、677 上的 v3 **地址相同**（同一部署账户的第 1 个 nonce），引用时务必写清是哪条链 |
| 部署 | 区块 11,855,936 · 运行时代码 10,758 字节 · 部署交易 `0x197ef6ca029dd59df77e28951ed6eb0cd18b26fc20463fb2d0b1bdf882eaaf03` |
| 留痕 | [Sepolia 全部链上事件（17 条）](08-截图存证/真链留痕-2026-10-06.md) · [2024 武汉暴雨历史回放](08-截图存证/历史回放-2024武汉暴雨.md) · [2026-08-09 上海暴雨 v3 回放](08-截图存证/历史回放-2026-08-09上海暴雨.md) · [AI 判定留痕 JSON](09-AI判定留痕/) |

v1 与 968 上的 v2 的参数差别（**v1 的留痕仍是有效证据，但它不是演示基线；现行演示基线 677 上的 v3 见上一节**）：

| | v1（Sepolia） | v2（BOT Chain 968，测试网留痕） |
|---|---|---|
| 保障时长 | `MIN_HOURS`/`MAX_HOURS` = 1 / 72（任意小时） | 只卖 `24 / 48 / 72` 三档 |
| 触发阈值 | 单一 `THRESHOLD = 50 mm` | `thresholdOf(24/48/72)` = 50 / 100 / 150 mm |
| 赔付额 | 固定 `PAYOUT = 0.01 ETH` | 国标分档 `PAYOUT_MAX` × 50% / 75% / 100% |
| 保费 | `PREMIUM = 0.001 ETH` + `setUnderwriting` 区域价 | 网格价 `setPremiumGrid(区域 × 时长)` → `aiPremium` → `PREMIUM_DEFAULT`，地板 `MIN_PREMIUM` |
| 喂价新鲜度 | 无 | `MAX_FEED_AGE = 24h`（投保前该区域必须喂过价） |
| 限购 / 敞口 | 无 | `MAX_POLICIES_PER_RIDER = 3` · `MAX_OPEN_EXPOSURE_PER_RIDER = 0.02 ETH` |
| 结算敞口回收 | 无 | `openExposure` + `settleExpired` |
| 数据源个数 | `sources` 恒为 0 | `sources` 上链 |
| 冷静期 / 白名单 | 无 | 代码已实现；**968 上的 v2 两个开关都关着，677 上的 v3 冷静期已开（`coolingPeriod = 259200`，3 天）** |

判定层（canonical 哈希、R1–R5、三模型交叉复核）**两版一字未改**。

---

## 4. 沿用组件来源

**本项目在赛事开始前已有代码基础**（赛前基线见上方 tag），赛期新增内容已在上文逐项列出。
沿用的第三方组件：

| 组件 | 用途 | 来源 |
|---|---|---|
| OpenZeppelin 风格的手写 `Ownable`/`Pausable` 逻辑 | 合约权限与暂停 | 自行实现，未引入 OZ 依赖 |
| `ethers` v6 | 链上交互 | npm |
| `solc` | Solidity 编译 | npm |
| `ganache` | 本地开发链（仅测试） | npm |
| Open-Meteo Archive / Forecast API | 气象数据 | https://open-meteo.com |
| DeepSeek `deepseek-chat`（可选） | 只用于生成判定理由文案，**不参与判定结论** | https://api.deepseek.com |

> **数据来源署名（CC BY 4.0）**：气象数据由 [Open-Meteo.com](https://open-meteo.com) 提供，依 **CC BY 4.0** 许可使用（**必须署名**）；本仓所有触发概率 `p`、定价表、蒙特卡洛与回测结论都是基于该数据的**衍生结果**。免费额度限**非商用**用途（额度与条款见 `https://open-meteo.com/en/terms`），本项目当前定位为**赛事 / 非商用研究** —— 详见 `10-金融与定价/README.md` §数据来源与许可署名。

---

## 5. 已知边界（我们主动说清楚，不藏着）

1. **真实数据下系统会判定「不赔」**：赛期实测中，上海真实累计降雨 34mm < 阈值 50mm，AI 判定为 DENY。
   这不是失败 —— 这是它没有为了演示而撒谎的证据。
2. **演示用的是模拟暴雨**：10 月初的武汉 / 上海够不到 50mm，所以现场演示走 `--demo` 注入模拟数据。
   模拟标记 `simulated: true` 被写进证据哈希，链上永久留痕，不是事后口头解释。
   喂价过期（`MAX_FEED_AGE = 24h`）时用 `--refresh` **同值重喂**保鲜 —— 数值不动，只推进喂价时刻；
   再跑 `--demo` 会让累计值继续上涨，把已归档的存证数字推废。
3. **预言机是单一运营方**：`updateRainfall` 只有 operator 能调。AI 判定层的三模型独立复核是用来
   **交叉验证这个单点**的，不能替代它。
4. **准备金下限（分版本）**：**v1** —— `reserve` / `setReserve()` / `withdrawPool()` 的守卫都已实现
   （`require(amount <= balance - reserve)`），但 `reserve` 是 operator **手工设定**的，合约不强制它
   与在保敞口挂钩；若 `reserve` 被设为 0，池子仍可被提空。
   **v2** —— `openExposure`（买入逐笔累加、赔付与到期结算回收：`03-合约/RainDeliveryInsuranceV2.sol:118`/`:238`/`:356`/`:379`）
   + `reserveOf() = max(reserve, openExposure)`（`:451`，提款在 `:464` 被它夹住）**就是那条自动规则**，
   不再依赖人工托底。两边给出的规则都是**总和口径**：`reserve ≥ 全部未了结保单数 × PAYOUT`
   （同一区域同时触发，所以要覆盖最大同时敞口，不是期望值）——
   详见 [`10-金融与定价/精算口径.md`](10-金融与定价/精算口径.md) §6 与 [`02-作战与答辩/合约v2-设计方案.md`](02-作战与答辩/合约v2-设计方案.md) A6。
5. **赔付条件之间没有联动**：AI 判定结果上链后，`claim()` 仍以「链上雨量增量 ≥ 阈值」为第一道条件；
   雨量未达标时，即使已有 PAY 判定也不会赔。
6. **`transferOperator` 是单步、不可逆的**。

---

## 6. 团队

| 成员 | 负责 |
|---|---|
| `juice-butterfly`（选手 A） | 链上工程、AI 判定模块、演示前端 |
| `BruceLeezh`（选手 B） | 金融与定价、提交材料 |

> 写权限、决策权、红区与冲突处理的完整界定见 **[AGENTS.md](AGENTS.md)** ——
> 两边的 AI 助手动手前先读那份。

---

## 7. 更多材料

- [交易哈希清单](02-作战与答辩/汉客松-交易哈希清单.md) —— 每个关键操作对应的链上交易
- [真链留痕](08-截图存证/真链留痕-2026-10-06.md) —— 全部链上事件（含「不赔」与「赔付」两条路径）
- [精算与定价口径](10-金融与定价/精算口径.md) —— 11 年真实降雨算出的触发概率、保本条件、准备金策略
- [产品说明与商业模式](提交材料/产品说明与商业模式.md) —— 单位经济、谁付钱、与传统骑手险的对比
- [分工与流程](02-作战与答辩/分工与流程.md)
- [下一步计划](02-作战与答辩/下一步计划.md)
- [中期检查一页纸](02-作战与答辩/中期检查-一页纸.md) —— 一页讲清问题、AI 判定层、三条证据链与已知弱点
- [决策记录](02-作战与答辩/决策记录.md) —— 分歧、证据与结论
- **[AGENTS.md](AGENTS.md)** —— **双方 AI 协作者的权责界限（动手前先读）**
