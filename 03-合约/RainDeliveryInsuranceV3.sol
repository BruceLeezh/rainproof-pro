// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * RainDeliveryInsurance v3 —— 雨天骑手配送中断险（参数化保险）· **赛后演进版**
 *
 * 血缘：v1（Sepolia 第一阶段留痕）→ v2（BOT Chain 测试网 968 上的**演示基线**，本版一字未动）
 *       → **v3 = 本文件**。v3 从 v2 逐字复制后定点改，**不改 968 上已部署那份的语义**：
 *       演示读的仍是 968 的 v2，所有已上链存证继续有效。
 *
 * ★ 本版相对 v2 的改动（每条都有出处，不是顺手改的）
 *   A-5①  `MIN_PREMIUM` 0.0002 → **0.00002 ETH**（v3 批量价最低 0.00006，不改则批量档全部 revert）
 *   A-5②  `premiumOf` 从 2 参扩成 **5 参**（地区 × 时长 × 骑手类型 × 渠道 × 购买量），
 *          价从**独立定价模块** `IPricingV3` 取；未配置模块时回退到 v2 的本地网格口径
 *          （旧的 2 参 `premiumOf(regionId, hours)` 保留为「自助投保默认段」的重载，前端不用改）
 *   A-5③  时长收成国标唯二的 **12h / 24h**；`thresholdOf` 从 `50 × h / 24` **线性外推**改成
 *          **GB/T 28592—2012 表 1 查表**（12h 30/70、24h 50/100）；赔付档 3 档收成 **2 档**（50% / 75%）
 *   A-5④  `submitJudgement` 多一个 `rainfallAtJudgement` 参数：**把判定当时链上读到的
 *          rainfall[regionId] 一起钉上链**，`claim` 改用这个快照算增量与档位 ——
 *          修掉「AI 按 A 时刻读数判、赔付按 B 时刻读数算」的时间基准错配
 *   A-6    投保人 / 受益人分离：新增 `buyFor(beneficiary, …)`（平台代付时钱由平台出、
 *          保单与赔付归属骑手本人；`payer` 单独落库）。v2 的 `buyPolicy` 保留为
 *          「自己给自己买」的等价调用
 *   路线图 `下一步计划.md` §7：③ 限购改成**只计未结清**（`openPoliciesOf`，O(1) 计数）
 *          ④ `settleExpired` 去掉 onlyOperator（任何人为过期未赔保单了结敞口）
 *          ⑥ 新增 `refundPolicy`：冷静期内（生效前）可退保，钱退回**付款人**
 *
 * ★ 红线不变：**AI 不决定赔不赔，只决定「喂进来的数据可不可信」**。
 *   赔付档位仍是链上确定性函数（国标两档查表），不需要 AI 参与。
 */
/// @notice v3 的五维定价模块（= `10-金融与定价/ref/PricingV3.sol`，独立部署；未配置时回退到本地网格）
interface IPricingV3 {
    function quoteOrZero(uint8 regionId, uint256 hours_, uint8 riderTier, uint8 channel, uint256 count)
        external view returns (uint256 price, bool sellable);
}

contract RainDeliveryInsuranceV3 {

    // ==================== 参数 ====================

    uint8   public constant PRODUCT_RAIN = 1;              // A9：险种编号（目前只有暴雨）

    uint256 public constant PAYOUT_MAX       = 0.01  ether; // 100% 档赔付额（v3 只有两档：50% / 75%）
    uint256 public constant PREMIUM_DEFAULT  = 0.001 ether; // 未设网格/区域价时的兜底
    uint256 public constant MIN_PREMIUM      = 0.00002 ether;// A-5①：地板降 10 倍（v3 批量价最低 0.00006 ETH）

    // A-5③：GB/T 28592—2012《降水量等级》**只有 12h / 24h 两个时段**（国标无 48h/72h）。
    //   12h：暴雨 30.0~69.9mm（写 30）、大暴雨 70.0~139.9mm（写 70）
    //   24h：暴雨 50.0~99.9mm（写 50）、大暴雨 100.0~249.9mm（写 100）
    //   **第三档（特大暴雨）不卖**：五城 11 年里 24h ≥250mm 零命中、12h ≥140mm 仅 0.002%~0.007%
    //   —— 写进合约却永远赔不到的档位是虚假承诺（v2 的 `250 × h/24` 就是这个问题）。
    //   出处：`10-金融与定价/GB28592-12h24h重建-B给A-2026-10-07.md`、`v3-合约规格.md` §1.3/§1.4
    uint256 public constant MIN_HOURS = 12;
    uint256 public constant MAX_HOURS = 24;
    uint8   public constant TIER_COUNT = 2;                 // 暴雨(50%) / 大暴雨(75%)

    uint8   public constant REGION_COUNT = 5;               // 1=武汉 2=上海 3=北京 4=广州 5=成都

    uint64  public constant MAX_FEED_AGE = 24 hours;        // A4b：喂价新鲜度上限

    // A3：限购两道闸门 —— 笔数上限 3，在保赔付额上限 0.02 ETH（= 2 × 满额赔付）。
    //     前者管"历史上买过几张"，后者管"此刻还有多少赔付额挂在外面"；
    //     后者先到（同时在保最多 2 笔），保单结算后敞口回落，前者才成为下一道。
    uint256 public constant MAX_POLICIES_PER_RIDER       = 3;
    uint256 public constant MAX_OPEN_EXPOSURE_PER_RIDER  = 0.02 ether;

    // ---- AI 判定层参数（与 v1 完全一致）----

    uint8 public constant KIND_FEED = 0;   // 喂价验收：这批外部数据可不可信
    uint8 public constant KIND_LOSS = 1;   // 损失判定：这场雨有没有砸在人身上

    uint8 public constant DECISION_DENY = 0;
    uint8 public constant DECISION_PAY  = 1;

    uint8 public constant MIN_CONFIDENCE = 60;

    uint8 public constant RISK_NORMAL    = 0;
    uint8 public constant RISK_LOADED    = 1;
    uint8 public constant RISK_SUSPENDED = 2;

    uint8 public constant TIER_NONE = 255;                 // A7：未达最低档

    address public operator;
    address public pricingModule;                           // A-5②：五维定价模块（address(0) = 回退本地网格）
    bool    public paused;
    uint256 public reserve;                                 // operator 额外设的准备金下限

    uint64  public coolingPeriod = 3 days;                  // A4：冷静期（operator 可配；演示设 0）
    bool    public eligibleRequired = false;                // A8：白名单开关（演示关、生产开）

    // ==================== 数据结构 ====================

    struct Policy {
        address rider;          // A-6：**受益人**（钱赔给他）；自己给自己买时 = payer
        address payer;          // A-6：实际付款人（平台代付时是平台；退保退款退给这个人）
        uint8   productId;      // A9
        uint8   regionId;
        uint256 premium;        // 实付保费（A1 网格价）
        uint256 startTime;      // 投保时刻
        uint256 effectiveFrom;  // A4：生效时刻 = startTime + coolingPeriod
        uint256 endTime;        // = effectiveFrom + hours
        uint256 windowHours;    // 保障时长（12/24，国标只有这两档）
        uint256 thresholdMm;    // A7：该保单的国标暴雨线 = thresholdOf(windowHours, 0)
        uint256 rainfallAtBuy;  // 投保当刻的【累计】降雨快照
        uint8   tier;           // A7：赔付档位（claim 时写入，未赔付为 TIER_NONE）
        uint256 payout;         // 实际赔付额
        bool    paid;
        bool    settled;        // A6：在保敞口是否已了结
        bool    exists;
    }

    /// @notice 一次 AI 判定。喂价验收和损失判定共用这一个结构，靠 kind 区分。
    struct Judgement {
        uint8   kind;
        uint8   decision;
        uint8   confidence;
        uint8   sources;        // A5：本次采信的数据源个数（v1 里恒为 0）
        uint64  judgedAt;
        uint256 rainfallAtJudgement; // A-5④：判定当时链上读到的 rainfall[regionId]（赔付据此，不按此刻读数）
        bool    exists;
        bytes32 inputHash;
        bytes32 outputHash;
        string  modelVersion;
    }

    mapping(uint256 => Policy)    public policies;
    mapping(uint8   => uint256)   public rainfall;         // 累计降雨量(mm)
    mapping(uint256 => Judgement) public judgements;       // policyId => 损失判定
    mapping(uint8   => Judgement) public feedJudgements;   // regionId => 最近一次喂价验收（含拒收）
    mapping(uint8   => uint256)   public aiPremium;        // regionId => AI 定的区域基准价
    mapping(uint8   => uint8)     public riskLevel;
    mapping(uint8   => mapping(uint256 => uint256)) public premiumGrid; // A1：regionId => hours => premium
    mapping(uint8   => uint64)    public lastFeedAt;       // A4b：regionId => 最后喂价时间
    mapping(address => bool)      public eligible;         // A8

    mapping(address => uint256[]) private _byRider;
    mapping(address => uint256)   public openPoliciesOf;   // 路线图③：只计**未结清**的保单笔数（O(1) 计数）
    uint256 public nextPolicyId;

    // A6：在保敞口账本（累加器，避免 O(n) 循环）
    uint256 public openExposure;                           // 所有未了结保单的满额赔付之和
    mapping(address => uint256) public riderExposure;      // 骑手维度的在保敞口

    // ==================== 事件 ====================

    /// @notice ⚠️ v2 的 PolicyBought 加了 effectiveFrom，topic0 与 v1 不同 —— 核验台要同步。
    event PolicyBought(uint256 indexed policyId, address indexed rider, uint8 indexed regionId,
                       uint256 effectiveFrom, uint256 endTime);

    event RainfallUpdated(uint8 indexed regionId, uint256 cumulativeMm,
                          bytes32 evidenceHash, uint8 confidence, address indexed reporter);

    /// @notice ⚠️ v2 的 ClaimPaid 加了 tier/amount 语义：amount = PAYOUT_MAX × 档位比例
    event ClaimPaid(uint256 indexed policyId, address indexed rider, uint256 amount, uint8 tier);

    event PoolFunded(address indexed from, uint256 amount, uint256 newBalance);
    event PoolWithdrawn(address indexed to, uint256 amount);
    event OperatorChanged(address indexed from, address indexed to);
    event PausedSet(bool paused);

    event FeedRejected(uint8 indexed regionId, uint8 confidence, uint8 sources,
                       bytes32 inputHash, string modelVersion);

    /// @notice ⚠️ v3 加了 `rainfallAtJudgement`（A-5④：判定当时的链上读数）—— topic0 与 v2 不同
    event JudgementSubmitted(uint256 indexed policyId, uint8 indexed kind, uint8 decision,
                             uint8 confidence, uint8 sources, uint256 rainfallAtJudgement,
                             bytes32 inputHash, bytes32 outputHash,
                             string modelVersion);

    event UnderwritingDecision(uint8 indexed regionId, uint8 level, uint256 premium, bytes32 reasonHash);
    event PremiumSet(uint8 indexed regionId, uint256 windowHours, uint256 premium, bytes32 reasonHash); // A1
    event ReserveSet(uint256 amount);
    event CoolingPeriodSet(uint64 seconds_);               // A4
    event EligibleSet(address indexed who, bool ok, bytes32 reasonHash);  // A8
    event EligibleRequiredSet(bool required);              // A8
    event ExposureSettled(uint256 indexed policyId, uint256 openExposure); // A6
    event PolicyRefunded(uint256 indexed policyId, address indexed payer, uint256 amount); // 路线图⑥
    event PricingModuleSet(address indexed module);                        // A-5②

    // ==================== 修饰器 ====================

    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    modifier notPaused()    { require(!paused, "contract paused"); _; }

    constructor() {
        operator = msg.sender;
        emit OperatorChanged(address(0), msg.sender);
    }

    // ==================== A-5③：定价与阈值（纯函数，任何人可复算）====================

    /// @notice A-5③：只卖国标唯二的 12h / 24h 两档
    function hoursAllowed(uint256 hours_) public pure returns (bool) {
        return hours_ == 12 || hours_ == 24;
    }

    /**
     * @notice A-5③：GB/T 28592—2012 表 1 **查表**（tier 0 = 暴雨线、tier 1 = 大暴雨线），单位 mm
     * @dev    v2 的 `50 × hours / 24` 线性外推**作废**：国标自己 24h÷12h 的比值是
     *         1.667 / 1.429 / 1.786 —— 没有一个是 2，线性缩放从一开始就不成立。
     */
    function thresholdOf(uint256 hours_, uint8 tier) public pure returns (uint256) {
        require(tier < TIER_COUNT, "bad tier");
        if (hours_ == 12) return tier == 0 ? 30 : 70;
        if (hours_ == 24) return tier == 0 ? 50 : 100;
        revert("hours must be 12/24");
    }

    /// @notice 入口闸线（= 暴雨线）；保单里存的 `thresholdMm` 就是它
    function entryThresholdOf(uint256 hours_) public pure returns (uint256) {
        return thresholdOf(hours_, 0);
    }

    /**
     * @notice A-5③：按国标两档给赔付档位 —— 纯链上函数，不经 AI
     * @return 0=暴雨(50%)  1=大暴雨(75%)  255=未达最低档
     */
    function tierOf(uint256 duringMm, uint256 hours_) public pure returns (uint8) {
        if (duringMm >= thresholdOf(hours_, 1)) return 1;   // 大暴雨 70mm/12h、100mm/24h
        if (duringMm >= thresholdOf(hours_, 0)) return 0;   // 暴雨   30mm/12h、 50mm/24h
        return TIER_NONE;
    }

    function tierBps(uint8 tier) public pure returns (uint256) {
        if (tier == 0) return 5000;
        if (tier == 1) return 7500;
        revert("bad tier");
    }

    /**
     * @notice A-5②：五维报价（地区 × 时长 × 骑手类型 × 渠道 × 购买量）
     * @dev    优先问独立定价模块 `pricingModule`（B 的 v3 定价表，链上逐格可读）；
     *         未配置模块（address(0)）时回退 v2 的本地网格口径，保证本合约单独也能跑。
     *         模块 revert 就让整笔调用 revert —— 不吞异常。
     * @return price    单价（wei）
     * @return sellable false = 这一格**不卖**（调用方应 revert，别拿 0 当价钱）
     */
    function quoteOf(uint8 regionId, uint256 hours_, uint8 riderTier, uint8 channel, uint256 count)
        public view returns (uint256 price, bool sellable)
    {
        require(regionId >= 1 && regionId <= REGION_COUNT, "bad region");
        require(hoursAllowed(hours_),                      "hours must be 12/24");

        if (pricingModule != address(0)) {
            return IPricingV3(pricingModule).quoteOrZero(regionId, hours_, riderTier, channel, count);
        }

        uint256 p = premiumGrid[regionId][hours_];
        if (p == 0) p = aiPremium[regionId];
        if (p == 0) p = PREMIUM_DEFAULT;
        return (p < MIN_PREMIUM ? MIN_PREMIUM : p, true);
    }

    /// @notice A-5②：五维保费（不卖的格子直接 revert "not offered"）
    function premiumOf(uint8 regionId, uint256 hours_, uint8 riderTier, uint8 channel, uint256 count)
        public view returns (uint256)
    {
        (uint256 price, bool sellable) = quoteOf(regionId, hours_, riderTier, channel, count);
        require(sellable,                                     "not offered");
        require(price >= MIN_PREMIUM && price < PAYOUT_MAX,   "premium out of range");
        return price;
    }

    /// @notice 兼容重载（v2 口径）：自助投保默认段 = 众包 · 自助 · 单份
    function premiumOf(uint8 regionId, uint256 hours_) external view returns (uint256) {
        return premiumOf(regionId, hours_, 0, 0, 1);
    }

    // ==================== 投保 ====================

    /// @notice A-6：自己给自己买（等价于 `buyFor(msg.sender, …, 默认段)`）
    function buyPolicy(uint8 regionId, uint256 hours_) external payable returns (uint256) {
        return _buy(msg.sender, msg.sender, regionId, hours_, 0, 0, 1);
    }

    /**
     * @notice A-6：**投保人 / 受益人分离** —— `msg.sender` 出钱，`beneficiary` 得到保障与赔付。
     * @dev    平台代付（channel=1）走这里：保单挂在骑手名下、钱由平台出，`payer` 单独落库。
     *         白名单、限购、敞口一律按**受益人**算（他才是被保的人）。
     *         `riderTier` / `channel` 只影响报价段；`count` 只用于**批量带报价** ——
     *         链上按单元成交（`count == 1`），N≥10 的平台批量走对账单 + 逐人单笔，
     *         因为「给同一个骑手一次买 1000 份」会被骑手维度的敞口闸挡掉，也不该放开。
     */
    function buyFor(address beneficiary, uint8 regionId, uint256 hours_,
                    uint8 riderTier, uint8 channel, uint256 count)
        external payable returns (uint256)
    {
        return _buy(msg.sender, beneficiary, regionId, hours_, riderTier, channel, count);
    }

    function _buy(address payer, address beneficiary, uint8 regionId, uint256 hours_,
                  uint8 riderTier, uint8 channel, uint256 count)
        internal notPaused returns (uint256 id)
    {
        require(beneficiary != address(0),                     "zero beneficiary");
        require(regionId >= 1 && regionId <= REGION_COUNT,     "bad region");
        require(riskLevel[regionId] != RISK_SUSPENDED,         "region suspended by underwriter");
        require(hoursAllowed(hours_),                          "hours must be 12/24");
        require(count == 1,                                    "on-chain buys are per-unit (count must be 1)");
        require(block.timestamp - lastFeedAt[regionId] <= MAX_FEED_AGE, "stale feed: feed before buying"); // A4b
        if (eligibleRequired) {                                 // A8
            require(eligible[beneficiary],                     "not an eligible rider");
        }
        require(openPoliciesOf[beneficiary] < MAX_POLICIES_PER_RIDER, "too many open policies");        // 路线图③
        require(riderExposure[beneficiary] + PAYOUT_MAX <= MAX_OPEN_EXPOSURE_PER_RIDER,
                "open exposure cap exceeded");                                                          // A3

        uint256 premium = premiumOf(regionId, hours_, riderTier, channel, count);                       // A-5②
        require(msg.value == premium,                          "premium mismatch");                     // A1

        id = nextPolicyId++;

        // 逐字段写入（不用 15 字段的结构体字面量：那会让 _buy 爆栈 too deep）
        Policy storage p = policies[id];
        p.rider         = beneficiary;                          // A-6：赔付对象 = 被保骑手
        p.payer         = payer;                                // A-6：出钱的人（退保退给他）
        p.productId     = PRODUCT_RAIN;
        p.regionId      = regionId;
        p.premium       = premium;
        p.startTime     = block.timestamp;
        p.effectiveFrom = block.timestamp + coolingPeriod;      // A4
        p.endTime       = p.effectiveFrom + hours_ * 1 hours;
        p.windowHours   = hours_;
        p.thresholdMm   = entryThresholdOf(hours_);             // A-5③：国标暴雨线查表
        p.rainfallAtBuy = rainfall[regionId];
        p.tier          = TIER_NONE;
        p.exists        = true;

        _byRider[beneficiary].push(id);
        openPoliciesOf[beneficiary] += 1;                       // 路线图③：只计未结清

        openExposure += PAYOUT_MAX;                             // A6
        riderExposure[beneficiary] += PAYOUT_MAX;

        emit PolicyBought(id, beneficiary, regionId, p.effectiveFrom, p.endTime);
    }

    // ==================== 喂价验收（AI 落点一）====================

    function updateRainfall(uint8 regionId, uint256 cumulativeMm, bytes32 evidenceHash,
                            uint8 confidence, uint8 sources) external onlyOperator
    {
        require(regionId >= 1 && regionId <= REGION_COUNT, "bad region");
        require(cumulativeMm >= rainfall[regionId],        "cumulative must not decrease");
        require(evidenceHash != bytes32(0),                "evidence required");
        require(confidence <= 100,                         "confidence out of range");
        require(confidence >= MIN_CONFIDENCE,              "feed confidence too low");

        rainfall[regionId] = cumulativeMm;
        lastFeedAt[regionId] = uint64(block.timestamp);    // A4b

        // 逐字段写入（9 字段的结构体字面量同样会爆栈）
        Judgement storage f = feedJudgements[regionId];
        f.kind         = KIND_FEED;
        f.decision     = DECISION_PAY;
        f.confidence   = confidence;
        f.sources      = sources;
        f.judgedAt     = uint64(block.timestamp);
        f.exists       = true;
        f.inputHash    = evidenceHash;
        f.outputHash   = bytes32(cumulativeMm);
        f.modelVersion = "";

        emit RainfallUpdated(regionId, cumulativeMm, evidenceHash, confidence, msg.sender);
    }

    /// @notice 多源验收判定不可信时调用：不喂价，但把这次异常留在链上。
    /// @dev    ⚠️ 拒收**不会**刷新 lastFeedAt —— A4b 问的是「最近一次被采信的喂价有多新」。
    function rejectFeed(uint8 regionId, uint8 confidence, uint8 sources,
                        bytes32 inputHash, string calldata modelVersion) external onlyOperator
    {
        require(regionId >= 1 && regionId <= REGION_COUNT, "bad region");
        require(confidence <= 100,                         "confidence out of range");
        require(inputHash != bytes32(0),                   "evidence required");

        Judgement storage f = feedJudgements[regionId];
        f.kind         = KIND_FEED;
        f.decision     = DECISION_DENY;
        f.confidence   = confidence;
        f.sources      = sources;
        f.judgedAt     = uint64(block.timestamp);
        f.exists       = true;
        f.inputHash    = inputHash;
        f.outputHash   = bytes32(0);
        f.modelVersion = modelVersion;

        emit FeedRejected(regionId, confidence, sources, inputHash, modelVersion);
    }

    // ==================== 损失判定写入（AI 落点二）====================

    /**
     * @notice 写入某份保单的损失判定。只有 operator 能写，**一份保单只能判一次**。
     * @param  rainfallAtJudgement A-5④：本次判定**读到的链上累计降雨**。它被钉上链，
     *         之后 `claim` 就用它算增量与档位，不再用「申请赔付那一刻」的读数 ——
     *         否则 AI 按 A 时刻判、赔付按 B 时刻算，留痕和钱对不上。
     */
    function submitJudgement(uint256 policyId, uint8 decision, uint8 confidence, uint8 sources,
                             uint256 rainfallAtJudgement,
                             bytes32 inputHash, bytes32 outputHash,
                             string calldata modelVersion) external onlyOperator
    {
        Policy storage p = policies[policyId];
        require(p.exists,                         "no such policy");
        require(!judgements[policyId].exists,     "judgement already submitted");
        // 退过保 / 已到期结算过的保单不该再产生判定（钱那条路已由 claim 挡住，这里是防垃圾写入）
        require(!p.settled,                       "already settled");
        require(decision <= DECISION_PAY,         "bad decision");
        require(confidence <= 100,                "confidence out of range");
        // A-5④ 两条边界：判定读数不能低于投保基线，也不能**超过链上此刻的读数**
        //（否则等于凭空发明一个降水值，钱会跟着这个幻觉走）
        require(rainfallAtJudgement >= p.rainfallAtBuy,      "judged reading below buy baseline");
        require(rainfallAtJudgement <= rainfall[p.regionId], "judged reading ahead of chain");

        Judgement storage j = judgements[policyId];
        j.kind                = KIND_LOSS;
        j.decision            = decision;
        j.confidence          = confidence;
        j.sources             = sources;                       // A5：真的写进去了
        j.judgedAt            = uint64(block.timestamp);
        j.rainfallAtJudgement = rainfallAtJudgement;           // A-5④
        j.exists              = true;
        j.inputHash           = inputHash;
        j.outputHash          = outputHash;
        j.modelVersion        = modelVersion;

        emit JudgementSubmitted(policyId, KIND_LOSS, decision, confidence, sources,
                                rainfallAtJudgement, inputHash, outputHash, modelVersion);
    }

    // ==================== 赔付 ====================

    /**
     * @notice 申请赔付。任何人都可以触发，但钱只会打给保单里的骑手本人。
     * @dev    规则全在链上：① 保单存在/未赔/未到期/已生效 → ② 期间累计降雨达到国标档位（纯确定性）
     *         → ③ AI 判定三关（kind/decision/confidence）→ ④ 资金够 → ⑤ 档位决定赔多少（纯确定性）
     */
    function claim(uint256 policyId) external notPaused {
        Policy storage p = policies[policyId];

        require(p.exists,                            "no such policy");
        require(!p.paid,                             "already paid");
        // ★ 必须挡在这里：`refundPolicy`（路线图⑥）会在冷静期内把 settled 置 true，
        //   若 claim 只看 paid，退过保的保单过了生效点还能再赔一次 —— 保费已退、赔款照拿。
        require(!p.settled,                          "already settled");
        require(block.timestamp >= p.effectiveFrom,  "not yet effective");       // A4
        require(block.timestamp <= p.endTime,        "policy expired");

        // A-5④：增量与档位都取**判定当时钉在链上的读数**（不是申请赔付这一刻的读数）——
        //        这样「AI 看到的雨」与「赔出去的钱」是同一份数据。
        Judgement storage j = judgements[policyId];
        require(j.exists,                            "no AI judgement");
        require(j.kind == KIND_LOSS,                 "wrong judgement kind");
        require(j.decision == DECISION_PAY,          "AI: no loss confirmed");
        require(j.confidence >= MIN_CONFIDENCE,      "AI: low confidence");

        uint256 during = j.rainfallAtJudgement - p.rainfallAtBuy;
        uint8 t = tierOf(during, p.windowHours);                                 // A-5③
        require(t != TIER_NONE,                      "below threshold");

        uint256 amount = PAYOUT_MAX * tierBps(t) / 10000;
        require(address(this).balance >= amount,     "insurance pool empty");

        p.paid   = true;
        p.tier   = t;
        p.payout = amount;
        if (!p.settled) {                                                         // A6
            p.settled = true;
            openExposure -= PAYOUT_MAX;
            riderExposure[p.rider] -= PAYOUT_MAX;
            openPoliciesOf[p.rider] -= 1;                                         // 路线图③
        }

        (bool ok, ) = payable(p.rider).call{value: amount}("");
        require(ok, "payout transfer failed");

        emit ClaimPaid(policyId, p.rider, amount, t);
    }

    // ==================== A6：在保敞口的了结（到期未赔）====================

    /**
     * @notice 结算「已到期且未赔付」的保单，把它们的敞口从账本里减掉。
     * @dev    没有这一步，`openExposure` 只会涨不会落，准备金要求会虚高。
     *         已赔付的保单在 claim 里就了结了，这里会跳过（幂等）。
     *         路线图④：**去掉 onlyOperator** —— 它只会把敞口**减下来**、不产生任何付款，
     *         谁调都安全；keeper 因此不必持有 operator 私钥（少一个单点）。
     */
    function settleExpired(uint256[] calldata policyIds) external {
        for (uint256 i = 0; i < policyIds.length; i++) {
            Policy storage p = policies[policyIds[i]];
            if (!p.exists || p.settled || p.paid) continue;
            require(block.timestamp > p.endTime, "policy not expired yet");
            p.settled = true;
            openExposure -= PAYOUT_MAX;
            riderExposure[p.rider] -= PAYOUT_MAX;
            openPoliciesOf[p.rider] -= 1;                                     // 路线图③
            emit ExposureSettled(policyIds[i], openExposure);
        }
    }

    // ==================== 路线图⑥：冷静期内退保 ====================

    /**
     * @notice 生效前退保：保费原路退回**付款人**，敞口了结。
     * @dev    仅在冷静期内（`block.timestamp < effectiveFrom`）、未赔付且未了结时可用。
     *         演示里 `coolingPeriod = 0` ⇒ 这条路径默认不可达（生效前后没有缝隙）；
     *         生产把冷静期打开（如 3 天）后它才是真的「下完单还能反悔」。
     *         付款人或 operator 可调 —— 平台代付的保单，骑手自己不该能退别人的钱。
     */
    function refundPolicy(uint256 policyId) external notPaused {
        Policy storage p = policies[policyId];
        require(p.exists,                                        "no such policy");
        require(!p.paid && !p.settled,                           "already settled");
        require(p.effectiveFrom > block.timestamp,               "already effective: cooling period over");
        require(msg.sender == p.payer || msg.sender == operator, "only payer or operator");

        p.settled = true;
        openExposure -= PAYOUT_MAX;                                            // A6
        riderExposure[p.rider] -= PAYOUT_MAX;
        openPoliciesOf[p.rider] -= 1;                                          // 路线图③

        (bool ok, ) = payable(p.payer).call{value: p.premium}("");
        require(ok, "refund transfer failed");

        emit PolicyRefunded(policyId, p.payer, p.premium);
    }

    // ==================== 承保人写入（AI 落点：精算定价）====================

    function setUnderwriting(uint8 regionId, uint8 level, uint256 premium, bytes32 reasonHash)
        external onlyOperator
    {
        require(regionId >= 1 && regionId <= REGION_COUNT, "bad region");
        require(level <= RISK_SUSPENDED,                   "bad level");
        require(premium > 0 && premium < PAYOUT_MAX,       "premium out of range");

        riskLevel[regionId] = level;
        aiPremium[regionId] = (level == RISK_NORMAL || level == RISK_LOADED) ? premium : 0;

        emit UnderwritingDecision(regionId, level, premium, reasonHash);
    }

    /// @notice A1：按（区域 × 时长）设置保费。精算输出直接落这个口子。
    function setPremiumGrid(uint8 regionId, uint256 hours_, uint256 premium, bytes32 reasonHash)
        external onlyOperator
    {
        require(regionId >= 1 && regionId <= REGION_COUNT, "bad region");
        require(hoursAllowed(hours_),                      "hours must be 12/24");
        require(premium >= MIN_PREMIUM && premium < PAYOUT_MAX, "premium out of range");

        premiumGrid[regionId][hours_] = premium;
        emit PremiumSet(regionId, hours_, premium, reasonHash);
    }

    // ==================== 管理 ====================

    function setPaused(bool v) external onlyOperator {
        paused = v;
        emit PausedSet(v);
    }

    /// @notice A-5②：接上/更换五维定价模块（`address(0)` = 回退本地网格）。只改报价口径，不碰钱。
    function setPricingModule(address module) external onlyOperator {
        pricingModule = module;
        emit PricingModuleSet(module);
    }

    function transferOperator(address next) external onlyOperator {
        require(next != address(0), "zero address");
        emit OperatorChanged(operator, next);
        operator = next;
    }

    /// @notice A4：冷静期。演示/彩排设 0，生产设 3 days。
    function setCoolingPeriod(uint64 seconds_) external onlyOperator {
        require(seconds_ <= 30 days, "cooling period too long");
        coolingPeriod = seconds_;
        emit CoolingPeriodSet(seconds_);
    }

    /// @notice A8：白名单开关。生产打开（只允许平台签过字的地址投保）。
    function setEligibleRequired(bool v) external onlyOperator {
        eligibleRequired = v;
        emit EligibleRequiredSet(v);
    }

    function setEligible(address who, bool ok, bytes32 reasonHash) external onlyOperator {
        eligible[who] = ok;
        emit EligibleSet(who, ok, reasonHash);
    }

    // ==================== 资金池 ====================

    function fundPool() external payable {
        require(msg.value > 0, "zero amount");
        emit PoolFunded(msg.sender, msg.value, address(this).balance);
    }

    /// @notice A6：实际生效的准备金下限 = max(operator 设的下限, 在保敞口满额)。
    function reserveOf() public view returns (uint256) {
        return reserve > openExposure ? reserve : openExposure;
    }

    function setReserve(uint256 amount) external onlyOperator {
        require(amount <= address(this).balance, "reserve exceeds balance");
        reserve = amount;
        emit ReserveSet(amount);
    }

    /// @notice 提取多余资金。不能击穿 `reserveOf()`（= max(operator 下限, 在保敞口)）。
    function withdrawPool(uint256 amount) external onlyOperator {
        uint256 bal = address(this).balance;
        uint256 res = reserveOf();
        // 先比大小再相减：准备金（或未结算敞口）超过池子余额时，可提额就是 0。
        // 直接写 `bal - res` 会 uint256 下溢成 Panic(0x11)，第三方核验时看不出真实原因，
        // 也拿不到 "would break reserve" 这句人话（本地 e2e 就是这么撞出来的）。
        uint256 free = bal > res ? bal - res : 0;
        require(amount <= free, "would break reserve");
        (bool ok, ) = payable(operator).call{value: amount}("");
        require(ok, "withdraw failed");
        emit PoolWithdrawn(operator, amount);
    }

    // ==================== 只读接口（前端直接用这些） ====================

    function regionName(uint8 regionId) public pure returns (string memory) {
        if (regionId == 1) return "wuhan";
        if (regionId == 2) return "shanghai";
        if (regionId == 3) return "beijing";
        if (regionId == 4) return "guangzhou";
        if (regionId == 5) return "chengdu";
        return "unknown";
    }

    /// @dev A-5④：判定已写入时以**判定快照**为准（与 `claim` 用同一份数据），
    ///      否则看此刻链上读数。四个只读辅助函数都走这里，避免口径分叉。
    function _readingFor(uint256 policyId, Policy storage p) private view returns (uint256) {
        Judgement storage j = judgements[policyId];
        return j.exists ? j.rainfallAtJudgement : rainfall[p.regionId];
    }

    function rainfallDuring(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return 0;
        return _readingFor(policyId, p) - p.rainfallAtBuy;
    }

    /// @notice 距离**最低档**（国标暴雨线）还差多少毫米（0 = 已达标）
    function shortfall(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return entryThresholdOf(MAX_HOURS);
        uint256 during = _readingFor(policyId, p) - p.rainfallAtBuy;
        return during >= p.thresholdMm ? 0 : p.thresholdMm - during;
    }

    /// @notice 这份保单现在按档位能赔多少（未达最低档返回 0）
    function payoutOf(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return 0;
        uint8 t = tierOf(_readingFor(policyId, p) - p.rainfallAtBuy, p.windowHours);
        if (t == TIER_NONE) return 0;
        return PAYOUT_MAX * tierBps(t) / 10000;
    }

    function currentTier(uint256 policyId) external view returns (uint8) {
        Policy storage p = policies[policyId];
        if (!p.exists) return TIER_NONE;
        return tierOf(_readingFor(policyId, p) - p.rainfallAtBuy, p.windowHours);
    }

    function policiesOf(address rider) external view returns (uint256[] memory) {
        return _byRider[rider];
    }

    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function pendingExposureOf(address rider) external view returns (uint256) {
        return riderExposure[rider];
    }

    /**
     * @notice 这份保单现在处于什么状态（前端直接显示，不用自己拼逻辑）
     * @dev    与 `claim()` 的门槛**逐条对齐** —— 两边口径不一致就是界面在撒谎。
     *         v2 新增 `pending`（投保了但冷静期未过）。
     */
    function policyStatus(uint256 policyId) external view returns (string memory) {
        Policy storage p = policies[policyId];
        if (!p.exists)                                  return "not_found";
        if (p.paid)                                     return "paid";
        if (block.timestamp < p.effectiveFrom)          return "pending";
        if (block.timestamp > p.endTime)                return "expired";

        uint256 during = rainfall[p.regionId] - p.rainfallAtBuy;
        if (during < p.thresholdMm)                     return "active";

        Judgement storage j = judgements[policyId];
        if (!j.exists)                                  return "pending_judgement";
        if (j.kind != KIND_LOSS)                        return "pending_judgement";
        if (j.decision != DECISION_PAY)                 return "denied";
        if (j.confidence < MIN_CONFIDENCE)              return "low_confidence";
        return "claimable";
    }
}
