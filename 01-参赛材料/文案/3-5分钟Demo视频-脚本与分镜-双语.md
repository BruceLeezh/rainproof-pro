# 3–5 分钟 Demo 视频 · 脚本与分镜（v3 适配 · 中英双语）

> 用途：BOT Chain 赛道提交里的「3–5 分钟 Demo 视频」这一格（`提交材料/BOT Chain-提交表填写-2026-10-07.md` §6 标 ⏳ 待录）。
> 口径来源：`提交材料/演讲稿-叙事版修订5-2026-10-08.md`（13 页母版台词）—— **旁白列基本照抄那份稿，本文件只做两件事：把 45 秒现场演示改成可录制的实机段，并给每一格补英文。**
> 规格（沿用已交付的 60 秒片）：**1280×720 · 30 fps · H.264（`h264_amf` + `+faststart`）· 无音轨、字幕烧进画面**（做法见 `提交材料/60秒演示-分镜与字幕.md` §二，管线 `D:\DSH\_tmp\rec.js` + `captions.py` + ffmpeg —— 三者在**仓库外的临时目录**里，不随仓库分发）。
> 双语规则：**底部字幕一行中文、一行英文**（中文在上、英文在下，字号小 15%）；画面上的 PPT 页本来就带英文小标题（`01 / THE RIDER` 这种）**不动**；本文件的「旁白」列是**可选配音稿**——不配音时，字幕就是观众读到的全部文字，所以字幕句都控制在一行内。
> 时长：主版 **≈4:30**（3–5 分钟格内）；压到 **≈3:20** 的砍句清单在 §五。
>
> ⚠️ 口径变更（2026-10-11）：本文件是 2026-10-07/08 按「演示基线 = 968 上的 v2」写的**拍摄说明**（S1 角标「chainId 968」、S7 实机段、§二 的代理与 968 喂价保鲜），**原样保留**。**2026-10-08 起演示基线已改为 BOT Chain 主网 677 上的 v3**（三个页面默认读 677，只有连不上才按节点阶梯退到只读中转或 968），**968 降为测试网留痕**（v2 事实不变：12,378 字节、只卖 24/48/72、6 张保单全部赔付、池子 0.0643 BOT）。现在开录 S7 实机段，要么改拍 677 上的 v3，要么按「968 测试网留痕」如实标注。
> ⚠️ **成片对应关系（2026-10-12 补）**：上面第 3 行的「⏳ 待录」**已过期** —— 本题的 3–5 分钟片**已成片并入库**：`提交材料/雨证-路演演示片-中英字幕.mp4`（**3:46.17** / 1920×1080 / 9.54 MB / 37 条中英双语字幕 + 英文配音 en-US-MichelleNeural）。但那条片子是**按已移出仓库的 13 页 deck 逐页推进**的另一次录制，**逐页文字稿与生成脚本未随文件保留**（以画面烧的字幕为准）；**本文件的旁白列只是可复用的文字底稿，与成片逐条对不上**。另外 60 秒母片也已移出仓库，库内只剩英文配音版（79.87 s，与母片 60.5 s 时长不同）。

---

## 一、分镜表（12 段）

| # | 时间 | 画面 / 操作 | 屏幕字幕 · 中文 | On-screen · English | 旁白 · 中文（可选配音） | Narration · EN（可选配音） |
|---|---|---|---|---|---|---|
| S1 | 0:00–0:12 | PPT 页 1 全屏；右下角小字「BOT Chain Testnet · chainId 968」 | 雨证 RainProof · 可验证的 AI 参数化配送险 | RainProof — verifiable AI parametric insurance for delivery riders | 先看一个人，再看一条链。 | First, one rider. Then, one chain. |
| S2 | 0:12–0:34 | PPT 页 2；四个数字（12 小时 / 300 万 / −30% / 0）逐个高亮放大 | 暴雨橙色预警那天，他还是出门了，跑了 12 个小时 | On an orange rainstorm-alert day he still went out — and rode for 12 hours | 不出勤就没有收入。光美团一个平台，官方口径是 300 万骑手；暴雨天收入大概掉三成。真出了事，他能拿到的赔偿是 0 —— 因为不知道该找谁赔。 | No shift, no income. Meituan alone reports about 3 million riders; on a storm day their earnings drop by roughly 30%. If something happens, the compensation he can get is zero — because there is no one to claim from. |
| S3 | 0:34–0:52 | PPT 页 3；镜头推到「≈」那个符号 | 查一次的成本 ≈ 赔一次的钱 | Assessing one claim costs about as much as paying it out | 为什么没人做这件事？不是没需求，是账算不过来：赔一次几十块，人工报案、查勘、核赔也得几十块。查的成本和赔款是一个量级，所以保险公司的理性选择是：不卖。 | Why has nobody done it? Not for lack of demand — the maths doesn't work. A payout is a few dozen yuan; manual reporting, inspection and assessment cost a few dozen yuan too. Assessment costs the same order as the payout, so the rational choice for an insurer is: don't sell it. |
| S4 | 0:52–1:04 | PPT 页 4 | 预报越准，这类产品越难成立 | The better the forecast, the harder this product is to sustain | 现在做天气加 AI 的团队很多。但说句实话：预报越准，这类产品越难成立 —— 因为人人都挑下雨那天来买。 | Many teams now combine weather with AI. But honestly: the more accurate the forecast, the harder this product is to sustain — because everyone buys only on the day it rains. |
| S5 | 1:04–1:24 | PPT 页 5；说「不问他损失了多少」时停两秒 | 我们不问他损失了多少 —— 只看一个公开数字 | We never ask what he lost — only one public number | 所以我们干脆不问他损失了多少。只看一个公开数字：保单期内，这个区域下了多少雨。投保、喂价、判定、赔付、核验，五步，每一步链上留一条事件。定损成本 —— 接近零。 | So we don't ask what he lost at all. We look at one public number: how much rain fell in that region during the policy window. Buy, feed, judge, pay, verify — five steps, each leaving one event on-chain. Loss assessment cost: close to zero. |
| S6 | 1:24–1:50 | PPT 页 6；三条证据逐条下划；第 3 条旁标注小字「v3 本地回放链」 | 三条真证据，两种相反的结论 | Three real records. Two opposite outcomes. | 第一条是真实气象数据，链上增量 34 毫米，没到 50 的线，判 DENY —— 不赔。第二条模拟暴雨，赔了。第三条是 2026-08-09 上海那场暴雨的历史回放，跑在 v3 合约上，也赔了。我们没只演赢的那一次。 | The first is real weather data: a 34 mm on-chain increase, below the 50 mm line — DENY, no payout. The second is a simulated storm — paid. The third is a historical replay of the 2026-08-09 Shanghai rainstorm on the v3 contract — also paid. We didn't only show the wins. |
| S7 | 1:50–2:40 | **实机 A · 968 v2 真链**（屏幕录制）：① 演示页顶部读数（资金池 / 五城雨量，现场念）② 滚到「链上动态」事件流（现行 V4 页面落点：`#dashboard` 看板下半）：投保 → 喂价 → AI 判定 → 赔付 ③ 切核验台，粘赔付哈希 `0x07f7ef…286b` 回车 ④ 回合约卡片：`0x89e7C942…596a` · chainId 968 · 12,378 字节 | 浏览器直接问 968 —— 没有后端、没有数据库 | The browser asks chain 968 directly — no backend, no database | 先别信我的 PPT，看真链。这是纯静态页面：没有后端、没有数据库，浏览器直接问 968 要数。右边这条流：投保、喂价、AI 判定、赔付，一条条留痕。这笔赔付 `0x07f7ef…286b`，谁都能查 —— 这不用信我。合约在 `0x89e7C942…596a`，chainId 968。 | Don't trust my slides — look at the chain. This page is fully static: no backend, no database; the browser queries chain 968 itself. This stream on the right is the ledger: buy, feed, AI judgement, payout. This payout transaction, `0x07f7ef…286b`, anyone can look up — you don't have to trust me. The contract is at `0x89e7C942…596a`, chainId 968. |
| S8 | 2:40–3:30 | **实机 B · v3 承保层**（本地回放链，录制时终端 4× 加速）：① 终端跑 `deploy.js --v3` → 运行时 15,823 B ② 基线喂价 448 mm ③ 投保保单 #0（上海 · 24h · 保费 0.001 ETH · 阈值 50 mm）④ 判定前喂价 553 mm + AI 判定 PAY 91 ⑤ `keeper --once --v3` 赔付 0.0075 ETH 到骑手 `0xDA2E…3D28`；右侧同步开核验台 `?rpc=http://127.0.0.1:8546&q=<哈希>` 读同一笔。**画面角落常驻小字**：本地回放链 · chainId 伪装 11155111 · 非有效部署 | v3 把时长收成国标两档；判定从旁证变成前提 | v3 narrows durations to the two national-standard windows; judgement becomes a precondition | 这是 v3 —— 本次提交的承保层。时长只卖国标的两档：12 小时和 24 小时；阈值按国标表查，不再线性外推。判定在 v3 里成了前提：合约的 `claim()` 直接要求判定已上链、且结论是赔。这一笔是 2026-08-09 上海的暴雨回放：448 毫米起步，判定前 553 毫米，链上增量 105 毫米，判 PAY 91，赔 0.0075 ETH 给保单里登记的骑手地址。它在本地回放链上跑，不是有效部署 —— 但每一步都留了哈希和事件。 | This is v3, the underwriting layer in this submission. Durations are only the two national-standard windows: 12 and 24 hours; thresholds are looked up in the national-standard table instead of extrapolated linearly. And in v3 the judgement becomes a precondition: `claim()` requires an on-chain judgement whose decision is PAY. This record is the 2026-08-09 Shanghai replay: 448 mm at the start, 553 mm before judgement, a 105 mm on-chain increase, PAY 91, paying 0.0075 ETH to the rider address recorded in the policy. It runs on a local replay chain, not a live deployment — but every step leaves a hash and an event. |
| S9 | 3:30–3:48 | PPT 页 8；指柱子与 10% 保本线 | 广州 72 小时的期望赔付比例 11.57% —— 越过 10% 保本线 | Guangzhou, 72 h: expected payout ratio 11.57% — above the 10% break-even line | 保费不是我们拍的。11 年、每个城市 96,432 小时的真实降雨跑出来：广州 72 小时的期望赔付比例 11.57%，越过 10% 的保本线 —— 按统一价卖就是收 1 赔 1.16。所以广州在链上单独加价；每次改价都写一条带依据哈希的事件上链。 | Premiums aren't guesswork. From 11 years of real rainfall — 96,432 hours per city — Guangzhou's expected payout ratio over 72 hours is 11.57%, above the 10% break-even line: at a flat price you collect 1 and pay 1.16. So Guangzhou is priced up on-chain, and every price change writes an event with a reference hash. |
| S10 | 3:48–4:02 | PPT 页 9 | 骑手自己不付钱 —— 向平台收 | Riders don't pay — the platform does | 那谁付钱？骑手自己不付 —— 单均保费只有千分之几 ETH，靠骑手逐单买撑不起渠道。我们向平台收：一次决策覆盖上万骑手，边际获客成本接近零；暴雨天的运力缺口和事故舆情，本来就是平台要花的钱。 | Who pays? Not the rider — a per-order premium of a few thousandths of an ETH can't support a distribution channel. We charge the platform: one decision covers tens of thousands of riders, so marginal acquisition cost is near zero — and storm-day capacity gaps and safety incidents are costs the platform already carries. |
| S11 | 4:02–4:14 | PPT 页 10 | 24 小时档 100 毫米就赔 —— 不需要他举证 | A 24-hour policy pays at 100 mm — no evidence required from him | 回到开头那个骑手。传统意外险要他自己报案、等人查勘；我们看的是链上雨量越过合约阈值：**v3 只卖 12 / 24 小时两档，24 小时档 100 毫米就赔**；链上现在跑的 v2 是 72 小时档 150 毫米。都不需要他举证。 | Back to the rider we started with. A traditional accident policy makes him report and wait for an inspector; we look at on-chain rainfall crossing the contract threshold: **v3 sells only the 12- and 24-hour windows, and the 24-hour one pays at 100 mm** — the v2 contract running on-chain today pays at 150 mm on the 72-hour window. Neither needs evidence from him. |
| S12 | 4:14–4:30 | PPT 页 11；结尾停住，二维码留屏 | 雨是数据，判定是代码，付款不需要我们点头 | Rain is data. The judgement is code. Payment doesn't need our approval. | ① 雨是数据，判定是代码，付款不需要我们点头 —— 规则和证据都在链上，你自己验。② 合约没有自动触发机制：`claim` 权限开放、任何人可触发，钱只进保单里登记的骑手地址。 | ① Rain is data, the judgement is code, and payment doesn't need our approval — the rules and the evidence are on-chain; verify them yourself. ② The contract has no timer: a judgement must be submitted by someone, but `claim()` has no access modifier — anyone can trigger it, and funds only ever go to the rider address recorded in the policy. |

**画面素材清单**：PPT 第 1/2/3/4/5/6/8/9/10/11 页导出 PNG（`Slides.Item(n).Export(path,'PNG',1920,1080)`）+ 附录 A1（第 12 页，S8 里闪 3 秒做「九项改动」底）+ S7/S8 两段屏幕录制。

---

## 二、录制前置（照着做，别临场想）

1. **代理**：FlClash 在跑（`127.0.0.1:7890`）。演示页读 968 必须走它。
2. **968 喂价保鲜**（10-08 上午录之前先做一次，否则页面会显示「喂价已过期」）：
   ```powershell
   Set-Location 'D:\workbuddy-use\汉客松-参赛包\04-脚本'
   & 'D:\Claude\node.exe' push-rainfall.js --refresh
   ```
   同值刷新：累计值不变，只把 `lastFeedAt` 推到现在（模式说明见 `04-脚本/push-rainfall.js` 头注释）。

   > ⚠️ 注记（2026-10-11）：第 1、2 条（代理 + 968 喂价保鲜）是 2026-10-07/08 的 968 口径，**原样保留**。2026-10-08 起演示基线是 BOT Chain 主网 677 上的 v3：三个页面默认直接读 677（不需要代理，也没有 968 的喂价保鲜问题），只有退回 968 时才需要这两步 —— 若 S7 仍拍 968，请按「测试网留痕」如实标注。
3. **开两个 tab**：`https://juice-butterfly.github.io/rainproof/`（演示页）与 `…/verifier.html`（核验台，或单文件 `06-核验台单文件/雨证-链上核验台.html`）。三页先硬刷新。
4. **本地回放链**（S8 用；两条命令，本轮已原样跑通，完整复现段见 `08-截图存证/历史回放-2026-08-09上海暴雨.md`）：
   ```powershell
   # 终端 1 · 起回放链（链时钟 2026-08-06 00:00 +0800）
   Set-Location 'D:\workbuddy-use\汉客松-参赛包\07-测试工具'
   $env:NODE_PATH='D:\workbuddy-use\汉客松-参赛包\04-脚本\node_modules'
   & 'D:\Claude\node.exe' replay_chain.js serve "2026-08-06T00:00:00+08:00" 8546

   # 终端 2 · 复现那一笔（cwd 必须是 04-脚本：脚本按 cwd 读 .env）
   Set-Location 'D:\workbuddy-use\汉客松-参赛包\04-脚本'
   $env:SEPOLIA_RPC='http://127.0.0.1:8546'
   & 'D:\Claude\node.exe' deploy.js --v3                       # 打印 v3 地址，记下来
   $env:CONTRACT_ADDRESS='<上一步打印的 v3 地址>'
   $env:RAIN_EPOCH='2026-06-01'
   & 'D:\Claude\node.exe' push-rainfall.js --until=2026-08-05 2  # 基线 448 mm 上链
   & 'D:\Claude\node.exe' '..\07-测试工具\replay_v3_setup.js' 2 24 0.05   # 注资 + 买保单 #0
   & 'D:\Claude\node.exe' '..\07-测试工具\replay_chain.js' set "2026-08-09T23:30:00+08:00"
   & 'D:\Claude\node.exe' push-rainfall.js --until=2026-08-09 2  # 判定前 553 mm 上链
   $env:AI_OUT_DIR='D:\workbuddy-use\汉客松-参赛包\09-AI判定留痕\2026-08-09上海暴雨回放'
   & 'D:\Claude\node.exe' ai-collect.js 0 --until=2026-08-09
   & 'D:\Claude\node.exe' ai-judge.js 0
   & 'D:\Claude\node.exe' submit-judgement.js 0                 # 判定 PAY 91 上链
   & 'D:\Claude\node.exe' keeper.js --once --v3                 # 赔付 0.0075 ETH
   ```
   两个坑：`NODE_PATH` 不能省（`replay_chain.js` require dotenv，dotenv 只装在 04-脚本）；`replay_v3_setup.js` 与 `replay_chain.js` 在 07-测试工具，用 `..\07-测试工具\` 引。
5. **S8 的拍法**：真跑一遍约 2 分钟，**别让观众看 2 分钟终端**——录下来后 4× 加速剪到 ~20 秒，只留每步的哈希/区块号一行；核验台那半屏同步读同一笔，慢速正常播。

---

## 三、双语字幕怎么烧

改 `D:\DSH\_tmp\captions.py` 一处：字幕条从一行变两行（中文 42px 在上、英文 26px 在下，条高 +18px，圆角与 0.28 s 淡入淡出不变）。帧文件名与 `frames.txt` 的对应关系不变，所以 `rec.js` 与 ffmpeg 那两条命令**一个字都不用改**。

字幕文本统一放一张表（两列 `zh` / `en`），中文行 ≤ 22 字、英文行 ≤ 68 字符 —— 超了就把句子拆到下一格（S2、S7、S8、S11 已经拆过）。英文用本文件 `On-screen · English` 列，**不要**用旁白列（旁白列是配音稿，太长）。

---

## 四、诚实声明（视频里必须看得见）

- S6 第三条证据旁标小字「**v3 本地回放链**」；S8 画面角落常驻「**本地回放链 · chainId 伪装 11155111 · 非有效部署**」。
- 前两条证据是 **Sepolia v1 第一阶段留痕**，第三条是 **v3 本地回放链**，真正跑业务的是 **BOT Chain 968 上的 v2** —— 三者的关系照 `提交材料/演讲稿-叙事版修订5-2026-10-08.md` 页 6 的原话写，不改口径。
- 968 页面上的五城雨量是**模拟暴雨注入**（`simulated: true` 在链上标着），不是真值写入 —— 与 60 秒片同一口径（`提交材料/60秒演示-分镜与字幕.md` §三）。
- 视频里出现的哈希、区块号、gas、代码长度都是节点真值，任何人可在 `scan.bohr.life` 或核验台复算；**不含任何真实付款镜头**。

> ⚠️ 注记（2026-10-11）：本节的「真正跑业务的是 BOT Chain 968 上的 v2」与「968 页面上的五城雨量」是 2026-10-07/08 录制的 968 口径，**原样保留**；**2026-10-08 起真正跑业务的演示基线是 BOT Chain 主网 677 上的 v3**（3 笔投保 + 2 笔冷静期退保、尚无赔付、池子 0.05105 BOT），968 上的 v2 降为测试网留痕（6 张保单全部赔付、池子 0.0643 BOT，这些事实不变）。

---

## 五、压到 ≈3:20 的砍句清单

1. S6 的「前两条在 Sepolia… v3 本地回放链」（−10s，只留三条结论）
2. S4 整段压成一句「预报越准，这类产品越难成立」（−6s）
3. S9 的逐城保费（−8s，留 11.57% 与保本线）
4. S10 的第二句（−10s）
5. S11 的「传统意外险要他自己报案、等人查勘」（−7s）
6. S2 的 300 万 / 三成（−9s）
7. S8 的终端部分压到 12s（−8s）

**S7 演示段与 S12 收尾永不砍**（拿分的地方）。砍完 ≈3:20，落在 3–5 分钟格的下沿。

---

## 六、纯英文口播稿（给英文配音 / 外国评委看）

If you only read one thing, read this. Full English narration, in shot order:

1. **S1** — First, one rider. Then, one chain.
2. **S2** — On an orange rainstorm-alert day he still went out, and rode for 12 hours. No shift, no income. Meituan alone reports about 3 million riders; on a storm day their earnings drop by roughly 30%. If something happens, the compensation he can get is zero — because there is no one to claim from.
3. **S3** — Why has nobody done it? Not for lack of demand — the maths doesn't work. A payout is a few dozen yuan; manual reporting, inspection and assessment cost a few dozen yuan too. Assessment costs the same order as the payout, so the rational choice for an insurer is: don't sell it.
4. **S4** — Many teams now combine weather with AI. But honestly: the more accurate the forecast, the harder this product is to sustain — because everyone buys only on the day it rains.
5. **S5** — So we don't ask what he lost at all. We look at one public number: how much rain fell in that region during the policy window. Buy, feed, judge, pay, verify — five steps, each leaving one event on-chain. Loss assessment cost: close to zero.
6. **S6** — Three real records. The first: real weather data, a 34 mm on-chain increase, below the 50 mm line — DENY, no payout. The second: a simulated storm — paid. The third: a historical replay of the 2026-08-09 Shanghai rainstorm on the v3 contract — also paid. We didn't only show the wins.
7. **S7** — Don't trust my slides — look at the chain. This page is fully static: no backend, no database; the browser queries chain 968 itself. Buy, feed, AI judgement, payout — each step leaves an event. This payout transaction, `0x07f7ef…286b`, anyone can look up. The contract is at `0x89e7C942…596a`, chainId 968.
8. **S8** — This is v3, the underwriting layer in this submission. Durations are only the two national-standard windows, 12 and 24 hours; thresholds come from the national-standard table, not a linear extrapolation. In v3 the judgement is a precondition: `claim()` requires an on-chain judgement whose decision is PAY. This is the Shanghai replay: 448 mm at the start, 553 mm before judgement, a 105 mm increase, PAY 91, 0.0075 ETH paid to the rider address in the policy. It runs on a local replay chain — not a live deployment — but every step leaves a hash and an event.
9. **S9** — Premiums aren't guesswork. From 11 years of real rainfall, Guangzhou's expected payout ratio over 72 hours is 11.57% — above the 10% break-even line. So Guangzhou is priced up on-chain, with a reference hash on every price change.
10. **S10** — Who pays? Not the rider. We charge the platform: one decision covers tens of thousands of riders, so marginal acquisition cost is near zero.
11. **S11** — Back to that rider. v3 sells only 12- and 24-hour windows; the 24-hour one pays when on-chain rainfall crosses 100 mm. The v2 contract running today pays at 150 mm on the 72-hour window. Neither needs evidence from him.
12. **S12** — Rain is data, the judgement is code, and payment doesn't need our approval. The rules and the evidence are on-chain — verify them yourself. The contract has no timer: anyone can call `claim()`, and funds only ever go to the rider address recorded in the policy.

---

> 诚实标注：秒数是按中文 ≈5.2 字/秒、英文 ≈140 词/分估的，未经录制实测；S7 与 S8 两段实机必须各跑通一遍才算数（S8 的复现命令本轮已跑通一次）。
