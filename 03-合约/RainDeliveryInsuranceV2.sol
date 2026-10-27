// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * RainDeliveryInsurance v2 —— 雨天骑手配送中断险（参数化保险）
 *
 * v1（Sepolia `0x89e7C942535930B61cB61631051E8b0bD670596a`）已在跑、证据完整；
 * v2 是**加固版**，目标链 = BOT Chain 主网（chainId 677）。
 *
 * ★ v2 只改「定价」与「投保时刻」的表达能力，**判定层一字未动**
 *   （同一套 canonical 哈希纪律：inputHash = 快照哈希，outputHash = 结论哈希，只写一次）。
 *
 * 本版相对 v1 的九项改动：
 *   A1  保费网格（区域 × 时长）+ 保费地板          A3  限购 + 在保赔付额封顶
 *   A4  保单生效时刻与冷静期（可配，演示设 0）       A4b 喂价新鲜度（投保前 24h 内必须喂过价）
 *   A5  `sources` 上链（v1 里恒为 0）              A6  在保敞口账本 → 准备金自动化
 *   A7  赔付分档（以国标暴雨线为基准，链上可算）     A8  骑手白名单（可开关）
 *   A9  `productId` 参数化（暴雨 = 1；只参数化，不实现第二个险种）
 *
 * ★ 红线不变：**AI 不决定赔不赔，只决定「喂进来的数据可不可信」**。
 *   本版的赔付分档同样是**链上确定性函数**（国标三级 × 窗口缩放），不需要 AI 参与 ——
 *   所以「AI 不决定赔多少钱」这句话在 v2 里依然成立。
 */
contract RainDeliveryInsuranceV2 {

    // ==================== 参数 ====================

    uint8   public constant PRODUCT_RAIN = 1;              // A9：险种编号（目前只有暴雨）

    uint256 public constant PAYOUT_MAX       = 0.01  ether; // 100% 档赔付额
    uint256 public constant PREMIUM_DEFAULT  = 0.001 ether; // 未设网格/区域价时的兜底
    uint256 public constant MIN_PREMIUM      = 0.0002 ether;// A1：保费地板（依据：一笔投保链上手续费≈0.00046 ETH）

    uint256 public constant THRESHOLD_PER_24H = 50;         // A7 基准：国标《降水量等级》24h 暴雨下限 50mm
    uint256 public constant MIN_HOURS = 24;                 // A1：只卖三档
    uint256 public constant MAX_HOURS = 72;

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
    bool    public paused;
    uint256 public reserve;                                 // operator 额外设的准备金下限

    uint64  public coolingPeriod = 3 days;                  // A4：冷静期（operator 可配；演示设 0）
    bool    public eligibleRequired = false;                // A8：白名单开关（演示关、生产开）

    // ==================== 数据结构 ====================

    struct Policy {
        address rider;
        uint8   productId;      // A9
        uint8   regionId;
        uint256 premium;        // 实付保费（A1 网格价）
        uint256 startTime;      // 投保时刻
        uint256 effectiveFrom;  // A4：生效时刻 = startTime + coolingPeriod
        uint256 endTime;        // = effectiveFrom + hours
        uint256 windowHours;    // 保障时长（24/48/72）
        uint256 thresholdMm;    // A7：该保单的国标暴雨线 = thresholdOf(windowHours)
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

    /// @notice ⚠️ v2 加了 sources 字段
    event JudgementSubmitted(uint256 indexed policyId, uint8 indexed kind, uint8 decision,
                             uint8 confidence, uint8 sources, bytes32 inputHash, bytes32 outputHash,
                             string modelVersion);

    event UnderwritingDecision(uint8 indexed regionId, uint8 level, uint256 premium, bytes32 reasonHash);
    event PremiumSet(uint8 indexed regionId, uint256 windowHours, uint256 premium, bytes32 reasonHash); // A1
    event ReserveSet(uint256 amount);
    event CoolingPeriodSet(uint64 seconds_);               // A4
    event EligibleSet(address indexed who, bool ok, bytes32 reasonHash);  // A8
    event EligibleRequiredSet(bool required);              // A8
    event ExposureSettled(uint256 indexed policyId, uint256 openExposure); // A6

    // ==================== 修饰器 ====================

    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    modifier notPaused()    { require(!paused, "contract paused"); _; }

    constructor() {
        operator = msg.sender;
        emit OperatorChanged(address(0), msg.sender);
    }

    // ==================== A1/A7：定价与阈值（纯函数，任何人可复算）====================

    /// @notice 只卖三档：24 / 48 / 72 小时
    function hoursAllowed(uint256 hours_) public pure returns (bool) {
        return hours_ == 24 || hours_ == 48 || hours_ == 72;
    }

    /// @notice A7：国标暴雨线随窗口缩放（24h→50mm、48h→100mm、72h→150mm）
    function thresholdOf(uint256 hours_) public pure returns (uint256) {
        return THRESHOLD_PER_24H * hours_ / 24;
    }

    /**
     * @notice A7：按国标《降水量等级》三级给出赔付档位 —— 纯链上函数，不经 AI
     * @return 0=暴雨(50%)  1=大暴雨(75%)  2=特大暴雨(100%)  255=未达最低档
     */
    function tierOf(uint256 duringMm, uint256 hours_) public pure returns (uint8) {
        uint256 base = thresholdOf(hours_);
        if (duringMm >= base * 5) return 2;   // 国标特大暴雨 = 250mm/24h
        if (duringMm >= base * 2) return 1;   // 国标大暴雨   = 100mm/24h
        if (duringMm >= base)     return 0;   // 国标暴雨     =  50mm/24h
        return TIER_NONE;
    }

    function tierBps(uint8 tier) public pure returns (uint256) {
        if (tier == 0) return 5000;
        if (tier == 1) return 7500;
        return 10000;
    }

    /// @notice A1：当前实际保费。网格 → 区域基准价 → 默认价，逐级回退，且不得低于地板。
    function premiumOf(uint8 regionId, uint256 hours_) public view returns (uint256) {
        uint256 p = premiumGrid[regionId][hours_];
        if (p == 0) p = aiPremium[regionId];
        if (p == 0) p = PREMIUM_DEFAULT;
        return p < MIN_PREMIUM ? MIN_PREMIUM : p;
    }

    // ==================== 投保 ====================

    function buyPolicy(uint8 regionId, uint256 hours_) external payable notPaused returns (uint256 id) {
        require(regionId >= 1 && regionId <= REGION_COUNT,     "bad region");
        require(riskLevel[regionId] != RISK_SUSPENDED,         "region suspended by underwriter");
        require(hoursAllowed(hours_),                          "hours must be 24/48/72");
        require(block.timestamp - lastFeedAt[regionId] <= MAX_FEED_AGE, "stale feed: feed before buying"); // A4b
        if (eligibleRequired) {                                 // A8
            require(eligible[msg.sender],                      "not an eligible rider");
        }
        require(_byRider[msg.sender].length < MAX_POLICIES_PER_RIDER, "too many policies");            // A3
        require(riderExposure[msg.sender] + PAYOUT_MAX <= MAX_OPEN_EXPOSURE_PER_RIDER,
                "open exposure cap exceeded");                                                          // A3

        uint256 premium = premiumOf(regionId, hours_);
        require(msg.value == premium,                          "premium mismatch");                     // A1

        id = nextPolicyId++;

        // 逐字段写入（不用 15 字段的结构体字面量：那会让 buyPolicy 爆栈 too deep）
        Policy storage p = policies[id];
        p.rider         = msg.sender;
        p.productId     = PRODUCT_RAIN;
        p.regionId      = regionId;
        p.premium       = premium;
        p.startTime     = block.timestamp;
        p.effectiveFrom = block.timestamp + coolingPeriod;      // A4
        p.endTime       = p.effectiveFrom + hours_ * 1 hours;
        p.windowHours   = hours_;
        p.thresholdMm   = thresholdOf(hours_);                  // A7
        p.rainfallAtBuy = rainfall[regionId];
        p.tier          = TIER_NONE;
        p.exists        = true;

        _byRider[msg.sender].push(id);

        openExposure += PAYOUT_MAX;                             // A6
        riderExposure[msg.sender] += PAYOUT_MAX;

        emit PolicyBought(id, msg.sender, regionId, p.effectiveFrom, p.endTime);
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

    /// @notice 写入某份保单的损失判定。只有 operator 能写，**一份保单只能判一次**。
    function submitJudgement(uint256 policyId, uint8 decision, uint8 confidence, uint8 sources,
                             bytes32 inputHash, bytes32 outputHash,
                             string calldata modelVersion) external onlyOperator
    {
        require(policies[policyId].exists,        "no such policy");
        require(!judgements[policyId].exists,     "judgement already submitted");
        require(decision <= DECISION_PAY,         "bad decision");
        require(confidence <= 100,                "confidence out of range");

        Judgement storage j = judgements[policyId];
        j.kind         = KIND_LOSS;
        j.decision     = decision;
        j.confidence   = confidence;
        j.sources      = sources;                              // A5：真的写进去了
        j.judgedAt     = uint64(block.timestamp);
        j.exists       = true;
        j.inputHash    = inputHash;
        j.outputHash   = outputHash;
        j.modelVersion = modelVersion;

        emit JudgementSubmitted(policyId, KIND_LOSS, decision, confidence, sources,
                                inputHash, outputHash, modelVersion);
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
        require(block.timestamp >= p.effectiveFrom,  "not yet effective");       // A4
        require(block.timestamp <= p.endTime,        "policy expired");

        uint256 during = rainfall[p.regionId] - p.rainfallAtBuy;
        uint8 t = tierOf(during, p.windowHours);                                 // A7
        require(t != TIER_NONE,                      "below threshold");

        Judgement storage j = judgements[policyId];
        require(j.exists,                            "no AI judgement");
        require(j.kind == KIND_LOSS,                 "wrong judgement kind");
        require(j.decision == DECISION_PAY,          "AI: no loss confirmed");
        require(j.confidence >= MIN_CONFIDENCE,      "AI: low confidence");

        uint256 amount = PAYOUT_MAX * tierBps(t) / 10000;
        require(address(this).balance >= amount,     "insurance pool empty");

        p.paid   = true;
        p.tier   = t;
        p.payout = amount;
        if (!p.settled) {                                                         // A6
            p.settled = true;
            openExposure -= PAYOUT_MAX;
            riderExposure[p.rider] -= PAYOUT_MAX;
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
     */
    function settleExpired(uint256[] calldata policyIds) external onlyOperator {
        for (uint256 i = 0; i < policyIds.length; i++) {
            Policy storage p = policies[policyIds[i]];
            if (!p.exists || p.settled || p.paid) continue;
            require(block.timestamp > p.endTime, "policy not expired yet");
            p.settled = true;
            openExposure -= PAYOUT_MAX;
            riderExposure[p.rider] -= PAYOUT_MAX;
            emit ExposureSettled(policyIds[i], openExposure);
        }
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
        require(hoursAllowed(hours_),                      "hours must be 24/48/72");
        require(premium >= MIN_PREMIUM && premium < PAYOUT_MAX, "premium out of range");

        premiumGrid[regionId][hours_] = premium;
        emit PremiumSet(regionId, hours_, premium, reasonHash);
    }

    // ==================== 管理 ====================

    function setPaused(bool v) external onlyOperator {
        paused = v;
        emit PausedSet(v);
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

    function rainfallDuring(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return 0;
        return rainfall[p.regionId] - p.rainfallAtBuy;
    }

    /// @notice 距离**最低档**（国标暴雨线）还差多少毫米（0 = 已达标）
    function shortfall(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return THRESHOLD_PER_24H;
        uint256 during = rainfall[p.regionId] - p.rainfallAtBuy;
        return during >= p.thresholdMm ? 0 : p.thresholdMm - during;
    }

    /// @notice 这份保单现在按档位能赔多少（未达最低档返回 0）
    function payoutOf(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return 0;
        uint8 t = tierOf(rainfall[p.regionId] - p.rainfallAtBuy, p.windowHours);
        if (t == TIER_NONE) return 0;
        return PAYOUT_MAX * tierBps(t) / 10000;
    }

    function currentTier(uint256 policyId) external view returns (uint8) {
        Policy storage p = policies[policyId];
        if (!p.exists) return TIER_NONE;
        return tierOf(rainfall[p.regionId] - p.rainfallAtBuy, p.windowHours);
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
