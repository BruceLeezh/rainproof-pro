// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * RainDeliveryInsurance v5 —— v4 的 **全国区域版**（2026-10-26）
 * ★ 本版相对 v4 的改动（资金轨道与判定语义零改动）：
 *   V5-① 区域从 5 个硬编码 uint8 改为 **uint32 行政区划代码**（民政部 6 位码，如
 *         武汉 420100 / 上海 310100 / 县级市义乌 330782），regions(code) 动态注册，
 *         运营方（多签）可开通全国任意省市县 —— REGION_COUNT 与 regionName() 纯函数退役；
 *   V5-② updateRainfallBatch / submitJudgements 批量入口：一场雨 N 城喂价、N 份保单
 *         判定，各打包成一笔 operator 交易（轮询喂价与批量理赔的吞吐前提）；
 *   V5-③ 阈值/档位不变：国标 GB/T 28592—2012 全国统一（12h 30/70、24h 50/100）。
 *
 * 血缘：v1（Sepolia）→ v2（968 留痕）→ v3（677 基线，原生币收付）→ **v4 = 本文件**。
 *       v4 从 v3 逐字复制后**只改资金轨道**，判定/档位/敞口/状态机一字未动。
 *
 * ★ 本版相对 v3 的改动（就这八处，其余与 v3 完全一致）：
 *   V4-① 计价换成自造模拟代币 `RainToken`（ERC-20，decimals=2，1 单位=1 元、最小单位 1 分）；
 *          一切金额常量随之改为「分」：`PAYOUT_MAX` 10000（=100 元）、`MIN_PREMIUM` 100（=1 元）
 *   V4-② 构造器收 `token_`，`immutable token`；无 payable 收款
 *   V4-③ 买入不再 `msg.value`：`token.transferFrom(payer, 本合约, premium)`（`buyPolicy`/`buyFor` 去 payable）
 *   V4-④ 赔付/退保改 `token.transfer(...)`
 *   V4-⑤ `fundPool(uint256 amount)`：先 `approve` 再转入（原 payable 版作废）
 *   V4-⑥ `setReserve` / `withdrawPool` / `poolBalance` 全部按 `token.balanceOf(本合约)`
 *   V4-⑦ 事件签名与 v3 完全相同（topic0 不变，前端与核验台零改动）
 *   V4-⑧ 定价模块接口保留但**不设**（旧 `IPricingV3` 模块是 ETH 口径，数字不可比；本地网格按分报价）
 *
 * ★ 红线不变：AI 不决定赔不赔，只验数据可信；赔付档位是链上确定性国标查表。
 */
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @notice v3 的五维定价模块接口（保留；v4 本地网格按「分」报价，勿挂 ETH 口径的旧模块）
interface IPricingV3 {
    function quoteOrZero(uint32 regionId, uint256 hours_, uint8 riderTier, uint8 channel, uint256 count)
        external view returns (uint256 price, bool sellable);
}

contract RainDeliveryInsuranceV5 {

    // ==================== 参数（单位：分，1 分 = 0.01 元；V4-①）====================

    uint8   public constant PRODUCT_RAIN = 1;              // A9：险种编号（目前只有暴雨）

    uint256 public constant PAYOUT_MAX       = 10_000;     // 100% 档 = 100.00 元（两档：50% / 75%）
    uint256 public constant PREMIUM_DEFAULT  = 1_000;      // 兜底价 = 10.00 元（与 v3 的 10% 满额同比例）
    uint256 public constant MIN_PREMIUM      = 100;        // 地板 = 1.00 元（人民币定价表的尊严地板）

    // GB/T 28592—2012《降水量等级》只有 12h / 24h 两个时段（同 v3，未动）
    uint256 public constant MIN_HOURS = 12;
    uint256 public constant MAX_HOURS = 24;
    uint8   public constant TIER_COUNT = 2;                 // 暴雨(50%) / 大暴雨(75%)

    uint64  public constant MAX_FEED_AGE = 24 hours;        // A4b：喂价新鲜度上限

    // A3：限购两道闸门（分）：未结清 3 笔；同时在保赔付额 ≤ 2 × 满额
    uint256 public constant MAX_POLICIES_PER_RIDER       = 3;
    uint256 public constant MAX_OPEN_EXPOSURE_PER_RIDER  = 20_000;

    // ---- AI 判定层参数（与 v1/v2/v3 完全一致）----

    uint8 public constant KIND_FEED = 0;
    uint8 public constant KIND_LOSS = 1;

    uint8 public constant DECISION_DENY = 0;
    uint8 public constant DECISION_PAY  = 1;

    uint8 public constant MIN_CONFIDENCE = 60;

    uint8 public constant RISK_NORMAL    = 0;
    uint8 public constant RISK_LOADED    = 1;
    uint8 public constant RISK_SUSPENDED = 2;

    uint8 public constant TIER_NONE = 255;

    IERC20  public immutable token;                          // V4-②：模拟计价代币（RainToken）

    // ---- V5-①：动态区域表（行政区划代码 → 名称/开通状态）----
    struct Region { string name; bool active; }
    mapping(uint32 => Region) public regions;
    uint256 public regionCount;
    address public operator;
    address public pricingModule;                            // V4-⑧：保留接口；不设 ETH 口径旧模块
    bool    public paused;
    uint256 public reserve;

    uint64  public coolingPeriod = 3 days;
    bool    public eligibleRequired = false;

    // ==================== 数据结构（与 v3 逐字相同）====================

    struct Policy {
        address rider;
        address payer;
        uint8   productId;
        uint32  regionId;
        uint256 premium;        // 实付保费（分）
        uint256 startTime;
        uint256 effectiveFrom;
        uint256 endTime;
        uint256 windowHours;
        uint256 thresholdMm;
        uint256 rainfallAtBuy;
        uint8   tier;
        uint256 payout;         // 实际赔付额（分）
        bool    paid;
        bool    settled;
        bool    exists;
    }

    struct Judgement {
        uint8   kind;
        uint8   decision;
        uint8   confidence;
        uint8   sources;
        uint64  judgedAt;
        uint256 rainfallAtJudgement;
        bool    exists;
        bytes32 inputHash;
        bytes32 outputHash;
        string  modelVersion;
    }

    mapping(uint256 => Policy)    public policies;
    mapping(uint32  => uint256)   public rainfall;
    mapping(uint256 => Judgement) public judgements;
    mapping(uint32  => Judgement) public feedJudgements;
    mapping(uint32  => uint256)   public aiPremium;
    mapping(uint32  => uint8)     public riskLevel;
    mapping(uint32  => mapping(uint256 => uint256)) public premiumGrid;
    mapping(uint32  => uint64)    public lastFeedAt;
    mapping(address => bool)      public eligible;

    mapping(address => uint256[]) private _byRider;
    mapping(address => uint256)   public openPoliciesOf;
    uint256 public nextPolicyId;

    uint256 public openExposure;
    mapping(address => uint256) public riderExposure;

    // ==================== 事件（与 v3 完全相同，topic0 不变；V4-⑦）====================

    event PolicyBought(uint256 indexed policyId, address indexed rider, uint32 indexed regionId,
                       uint256 effectiveFrom, uint256 endTime);

    event RainfallUpdated(uint32 indexed regionId, uint256 cumulativeMm,
                          bytes32 evidenceHash, uint8 confidence, address indexed reporter);

    event ClaimPaid(uint256 indexed policyId, address indexed rider, uint256 amount, uint8 tier);

    event PoolFunded(address indexed from, uint256 amount, uint256 newBalance);
    event PoolWithdrawn(address indexed to, uint256 amount);
    event OperatorChanged(address indexed from, address indexed to);
    event PausedSet(bool paused);

    event FeedRejected(uint32 indexed regionId, uint8 confidence, uint8 sources,
                       bytes32 inputHash, string modelVersion);

    event JudgementSubmitted(uint256 indexed policyId, uint8 indexed kind, uint8 decision,
                             uint8 confidence, uint8 sources, uint256 rainfallAtJudgement,
                             bytes32 inputHash, bytes32 outputHash,
                             string modelVersion);

    event UnderwritingDecision(uint32 indexed regionId, uint8 level, uint256 premium, bytes32 reasonHash);
    event PremiumSet(uint32 indexed regionId, uint256 windowHours, uint256 premium, bytes32 reasonHash);
    event ReserveSet(uint256 amount);
    event CoolingPeriodSet(uint64 seconds_);
    event EligibleSet(address indexed who, bool ok, bytes32 reasonHash);
    event EligibleRequiredSet(bool required);
    event ExposureSettled(uint256 indexed policyId, uint256 openExposure);
    event PolicyRefunded(uint256 indexed policyId, address indexed payer, uint256 amount);
    event PricingModuleSet(address indexed module);
    event RegionRegistered(uint32 indexed code, string name, uint256 regionCount);   // V5-①
    event RegionActiveSet(uint32 indexed code, bool active);

    // ==================== 修饰器 / 构造器 ====================

    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    modifier notPaused()    { require(!paused, "contract paused"); _; }

    constructor(IERC20 token_) {                            // V4-②
        token = token_;
        operator = msg.sender;
        emit OperatorChanged(address(0), msg.sender);
    }

    // ==================== 定价与阈值（纯函数，与 v3 逐字相同）====================

    function hoursAllowed(uint256 hours_) public pure returns (bool) {
        return hours_ == 12 || hours_ == 24;
    }

    function thresholdOf(uint256 hours_, uint8 tier) public pure returns (uint256) {
        require(tier < TIER_COUNT, "bad tier");
        if (hours_ == 12) return tier == 0 ? 30 : 70;
        if (hours_ == 24) return tier == 0 ? 50 : 100;
        revert("hours must be 12/24");
    }

    function entryThresholdOf(uint256 hours_) public pure returns (uint256) {
        return thresholdOf(hours_, 0);
    }

    function tierOf(uint256 duringMm, uint256 hours_) public pure returns (uint8) {
        if (duringMm >= thresholdOf(hours_, 1)) return 1;
        if (duringMm >= thresholdOf(hours_, 0)) return 0;
        return TIER_NONE;
    }

    function tierBps(uint8 tier) public pure returns (uint256) {
        if (tier == 0) return 5000;
        if (tier == 1) return 7500;
        revert("bad tier");
    }

    function quoteOf(uint32 regionId, uint256 hours_, uint8 riderTier, uint8 channel, uint256 count)
        public view returns (uint256 price, bool sellable)
    {
        require(regions[regionId].active,                  "region not available");
        require(hoursAllowed(hours_),                      "hours must be 12/24");

        if (pricingModule != address(0)) {
            return IPricingV3(pricingModule).quoteOrZero(regionId, hours_, riderTier, channel, count);
        }

        uint256 p = premiumGrid[regionId][hours_];
        if (p == 0) p = aiPremium[regionId];
        if (p == 0) p = PREMIUM_DEFAULT;
        return (p < MIN_PREMIUM ? MIN_PREMIUM : p, true);
    }

    function premiumOf(uint32 regionId, uint256 hours_, uint8 riderTier, uint8 channel, uint256 count)
        public view returns (uint256)
    {
        (uint256 price, bool sellable) = quoteOf(regionId, hours_, riderTier, channel, count);
        require(sellable,                                     "not offered");
        require(price >= MIN_PREMIUM && price < PAYOUT_MAX,   "premium out of range");
        return price;
    }

    function premiumOf(uint32 regionId, uint256 hours_) external view returns (uint256) {
        return premiumOf(regionId, hours_, 0, 0, 1);
    }

    // ==================== 投保（V4-③：代币扣款，不再 payable）====================

    function buyPolicy(uint32 regionId, uint256 hours_) external returns (uint256) {
        return _buy(msg.sender, msg.sender, regionId, hours_, 0, 0, 1);
    }

    function buyFor(address beneficiary, uint32 regionId, uint256 hours_,
                    uint8 riderTier, uint8 channel, uint256 count)
        external returns (uint256)
    {
        return _buy(msg.sender, beneficiary, regionId, hours_, riderTier, channel, count);
    }

    function _buy(address payer, address beneficiary, uint32 regionId, uint256 hours_,
                  uint8 riderTier, uint8 channel, uint256 count)
        internal notPaused returns (uint256 id)
    {
        require(beneficiary != address(0),                     "zero beneficiary");
        require(regions[regionId].active,                      "region not available");
        require(riskLevel[regionId] != RISK_SUSPENDED,         "region suspended by underwriter");
        require(hoursAllowed(hours_),                          "hours must be 12/24");
        require(count == 1,                                    "on-chain buys are per-unit (count must be 1)");
        require(block.timestamp - lastFeedAt[regionId] <= MAX_FEED_AGE, "stale feed: feed before buying");
        if (eligibleRequired) {
            require(eligible[beneficiary],                     "not an eligible rider");
        }
        require(openPoliciesOf[beneficiary] < MAX_POLICIES_PER_RIDER, "too many open policies");
        require(riderExposure[beneficiary] + PAYOUT_MAX <= MAX_OPEN_EXPOSURE_PER_RIDER,
                "open exposure cap exceeded");

        uint256 premium = premiumOf(regionId, hours_, riderTier, channel, count);

        id = nextPolicyId++;

        Policy storage p = policies[id];
        p.rider         = beneficiary;
        p.payer         = payer;
        p.productId     = PRODUCT_RAIN;
        p.regionId      = regionId;
        p.premium       = premium;
        p.startTime     = block.timestamp;
        p.effectiveFrom = block.timestamp + coolingPeriod;
        p.endTime       = p.effectiveFrom + hours_ * 1 hours;
        p.windowHours   = hours_;
        p.thresholdMm   = entryThresholdOf(hours_);
        p.rainfallAtBuy = rainfall[regionId];
        p.tier          = TIER_NONE;
        p.exists        = true;

        // V4-③：钱从这里走代币（先记账后扣款；扣款失败整笔回滚）
        require(token.transferFrom(payer, address(this), premium), "premium transfer failed");

        _byRider[beneficiary].push(id);
        openPoliciesOf[beneficiary] += 1;

        openExposure += PAYOUT_MAX;
        riderExposure[beneficiary] += PAYOUT_MAX;

        emit PolicyBought(id, beneficiary, regionId, p.effectiveFrom, p.endTime);
    }

    // ==================== 喂价验收（与 v3 逐字相同）====================

    function updateRainfall(uint32 regionId, uint256 cumulativeMm, bytes32 evidenceHash,
                            uint8 confidence, uint8 sources) external onlyOperator
    {
        _feed(regionId, cumulativeMm, evidenceHash, confidence, sources);
        emit RainfallUpdated(regionId, cumulativeMm, evidenceHash, confidence, msg.sender);
    }

    /// @notice V5-②：批量喂价（一场雨多城一次上链；数组逐位对齐，任一失败整笔回滚）
    function updateRainfallBatch(uint32[] calldata regionIds, uint256[] calldata cumulativeMm,
                                 bytes32[] calldata evidenceHashes, uint8[] calldata confidences,
                                 uint8[] calldata sourcesArr) external onlyOperator
    {
        require(regionIds.length == cumulativeMm.length && regionIds.length == evidenceHashes.length
             && regionIds.length == confidences.length && regionIds.length == sourcesArr.length,
                "array length mismatch");
        for (uint256 i = 0; i < regionIds.length; i++) {
            _feed(regionIds[i], cumulativeMm[i], evidenceHashes[i], confidences[i], sourcesArr[i]);
            emit RainfallUpdated(regionIds[i], cumulativeMm[i], evidenceHashes[i], confidences[i], msg.sender);
        }
    }

    function _feed(uint32 regionId, uint256 cumulativeMm, bytes32 evidenceHash,
                   uint8 confidence, uint8 sources) internal
    {
        require(regions[regionId].active,                  "region not available");
        require(cumulativeMm >= rainfall[regionId],        "cumulative must not decrease");
        require(evidenceHash != bytes32(0),                "evidence required");
        require(confidence <= 100,                         "confidence out of range");
        require(confidence >= MIN_CONFIDENCE,              "feed confidence too low");

        rainfall[regionId] = cumulativeMm;
        lastFeedAt[regionId] = uint64(block.timestamp);

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

    /// @notice V5-①：开通一个行政区划（多签二票）。重复注册视为改名，不重复计数。
    function registerRegion(uint32 code, string calldata name) external onlyOperator {
        require(code != 0,               "zero code");
        require(bytes(name).length != 0, "empty name");
        if (!regions[code].active) { regionCount += 1; regions[code].active = true; }
        regions[code].name = name;
        emit RegionRegistered(code, name, regionCount);
    }

    /// @notice 关停一个区域（在保保单照常履行，仅停售新单）
    function setRegionActive(uint32 code, bool active_) external onlyOperator {
        require(regions[code].active || active_, "unknown region");
        if (regions[code].active && !active_) regionCount -= 1;
        regions[code].active = active_;
        emit RegionActiveSet(code, active_);
    }

    function rejectFeed(uint32 regionId, uint8 confidence, uint8 sources,
                        bytes32 inputHash, string calldata modelVersion) external onlyOperator
    {
        require(regions[regionId].active,                  "region not available");
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

    // ==================== 损失判定写入（与 v3 逐字相同）====================

    function submitJudgement(uint256 policyId, uint8 decision, uint8 confidence, uint8 sources,
                             uint256 rainfallAtJudgement,
                             bytes32 inputHash, bytes32 outputHash,
                             string calldata modelVersion) external onlyOperator
    {
        _judge(policyId, decision, confidence, sources, rainfallAtJudgement, inputHash, outputHash, modelVersion);
    }

    /// @notice V5-②：批量判定（一场雨 N 份保单一次上链；逐份校验，任一失败整笔回滚）
    function submitJudgements(uint256[] calldata policyIds, uint8[] calldata decisions,
                              uint8[] calldata confidences, uint8[] calldata sourcesArr,
                              uint256[] calldata rainfalls, bytes32[] calldata inputHashes,
                              bytes32[] calldata outputHashes, string[] calldata modelVersions)
        external onlyOperator
    {
        require(policyIds.length == decisions.length && policyIds.length == confidences.length
             && policyIds.length == sourcesArr.length && policyIds.length == rainfalls.length
             && policyIds.length == inputHashes.length && policyIds.length == outputHashes.length
             && policyIds.length == modelVersions.length,
                "array length mismatch");
        for (uint256 i = 0; i < policyIds.length; i++) {
            _judge(policyIds[i], decisions[i], confidences[i], sourcesArr[i], rainfalls[i],
                   inputHashes[i], outputHashes[i], modelVersions[i]);
            emit JudgementSubmitted(policyIds[i], KIND_LOSS, decisions[i], confidences[i], sourcesArr[i],
                                    rainfalls[i], inputHashes[i], outputHashes[i], modelVersions[i]);
        }
    }

    function _judge(uint256 policyId, uint8 decision, uint8 confidence, uint8 sources,
                    uint256 rainfallAtJudgement, bytes32 inputHash, bytes32 outputHash,
                    string calldata modelVersion) internal
    {
        Policy storage p = policies[policyId];
        require(p.exists,                         "no such policy");
        require(!judgements[policyId].exists,     "judgement already submitted");
        require(!p.settled,                       "already settled");
        require(decision <= DECISION_PAY,         "bad decision");
        require(confidence <= 100,                "confidence out of range");
        require(rainfallAtJudgement >= p.rainfallAtBuy,      "judged reading below buy baseline");
        require(rainfallAtJudgement <= rainfall[p.regionId], "judged reading ahead of chain");

        Judgement storage j = judgements[policyId];
        j.kind                = KIND_LOSS;
        j.decision            = decision;
        j.confidence          = confidence;
        j.sources             = sources;
        j.judgedAt            = uint64(block.timestamp);
        j.rainfallAtJudgement = rainfallAtJudgement;
        j.exists              = true;
        j.inputHash           = inputHash;
        j.outputHash          = outputHash;
        j.modelVersion        = modelVersion;

        emit JudgementSubmitted(policyId, KIND_LOSS, decision, confidence, sources,
                                rainfallAtJudgement, inputHash, outputHash, modelVersion);
    }

    // ==================== 赔付（V4-④：代币转账）====================

    function claim(uint256 policyId) external notPaused {
        Policy storage p = policies[policyId];

        require(p.exists,                            "no such policy");
        require(!p.paid,                             "already paid");
        require(!p.settled,                          "already settled");
        require(block.timestamp >= p.effectiveFrom,  "not yet effective");
        require(block.timestamp <= p.endTime,        "policy expired");

        Judgement storage j = judgements[policyId];
        require(j.exists,                            "no AI judgement");
        require(j.kind == KIND_LOSS,                 "wrong judgement kind");
        require(j.decision == DECISION_PAY,          "AI: no loss confirmed");
        require(j.confidence >= MIN_CONFIDENCE,      "AI: low confidence");

        uint256 during = j.rainfallAtJudgement - p.rainfallAtBuy;
        uint8 t = tierOf(during, p.windowHours);
        require(t != TIER_NONE,                      "below threshold");

        uint256 amount = PAYOUT_MAX * tierBps(t) / 10000;
        require(token.balanceOf(address(this)) >= amount, "insurance pool empty");   // V4-⑥

        p.paid   = true;
        p.tier   = t;
        p.payout = amount;
        if (!p.settled) {
            p.settled = true;
            openExposure -= PAYOUT_MAX;
            riderExposure[p.rider] -= PAYOUT_MAX;
            openPoliciesOf[p.rider] -= 1;
        }

        require(token.transfer(p.rider, amount), "payout transfer failed");           // V4-④

        emit ClaimPaid(policyId, p.rider, amount, t);
    }

    // ==================== 到期结算（与 v3 逐字相同）====================

    function settleExpired(uint256[] calldata policyIds) external {
        for (uint256 i = 0; i < policyIds.length; i++) {
            Policy storage p = policies[policyIds[i]];
            if (!p.exists || p.settled || p.paid) continue;
            require(block.timestamp > p.endTime, "policy not expired yet");
            p.settled = true;
            openExposure -= PAYOUT_MAX;
            riderExposure[p.rider] -= PAYOUT_MAX;
            openPoliciesOf[p.rider] -= 1;
            emit ExposureSettled(policyIds[i], openExposure);
        }
    }

    // ==================== 冷静期内退保（V4-④：代币退款）====================

    function refundPolicy(uint256 policyId) external notPaused {
        Policy storage p = policies[policyId];
        require(p.exists,                                        "no such policy");
        require(!p.paid && !p.settled,                           "already settled");
        require(p.effectiveFrom > block.timestamp,               "already effective: cooling period over");
        require(msg.sender == p.payer || msg.sender == operator, "only payer or operator");

        p.settled = true;
        openExposure -= PAYOUT_MAX;
        riderExposure[p.rider] -= PAYOUT_MAX;
        openPoliciesOf[p.rider] -= 1;

        require(token.transfer(p.payer, p.premium), "refund transfer failed");       // V4-④

        emit PolicyRefunded(policyId, p.payer, p.premium);
    }

    // ==================== 承保写入（与 v3 逐字相同；金额单位=分）====================

    function setUnderwriting(uint32 regionId, uint8 level, uint256 premium, bytes32 reasonHash)
        external onlyOperator
    {
        require(regions[regionId].active,                  "region not available");
        require(level <= RISK_SUSPENDED,                   "bad level");
        require(premium > 0 && premium < PAYOUT_MAX,       "premium out of range");

        riskLevel[regionId] = level;
        aiPremium[regionId] = (level == RISK_NORMAL || level == RISK_LOADED) ? premium : 0;

        emit UnderwritingDecision(regionId, level, premium, reasonHash);
    }

    function setPremiumGrid(uint32 regionId, uint256 hours_, uint256 premium, bytes32 reasonHash)
        external onlyOperator
    {
        require(regions[regionId].active,                  "region not available");
        require(hoursAllowed(hours_),                      "hours must be 12/24");
        require(premium >= MIN_PREMIUM && premium < PAYOUT_MAX, "premium out of range");

        premiumGrid[regionId][hours_] = premium;
        emit PremiumSet(regionId, hours_, premium, reasonHash);
    }

    // ==================== 管理（与 v3 逐字相同）====================

    function setPaused(bool v) external onlyOperator {
        paused = v;
        emit PausedSet(v);
    }

    function setPricingModule(address module) external onlyOperator {
        pricingModule = module;
        emit PricingModuleSet(module);
    }

    function transferOperator(address next) external onlyOperator {
        require(next != address(0), "zero address");
        emit OperatorChanged(operator, next);
        operator = next;
    }

    function setCoolingPeriod(uint64 seconds_) external onlyOperator {
        require(seconds_ <= 30 days, "cooling period too long");
        coolingPeriod = seconds_;
        emit CoolingPeriodSet(seconds_);
    }

    function setEligibleRequired(bool v) external onlyOperator {
        eligibleRequired = v;
        emit EligibleRequiredSet(v);
    }

    function setEligible(address who, bool ok, bytes32 reasonHash) external onlyOperator {
        eligible[who] = ok;
        emit EligibleSet(who, ok, reasonHash);
    }

    // ==================== 资金池（V4-⑤/⑥：代币口径）====================

    /// @notice 注资：先对合约 `approve`，再带金额调用本函数（原 payable 版作废）
    function fundPool(uint256 amount) external {
        require(amount > 0, "zero amount");
        require(token.transferFrom(msg.sender, address(this), amount), "fund transfer failed");
        emit PoolFunded(msg.sender, amount, token.balanceOf(address(this)));
    }

    function reserveOf() public view returns (uint256) {
        return reserve > openExposure ? reserve : openExposure;
    }

    function setReserve(uint256 amount) external onlyOperator {
        require(amount <= token.balanceOf(address(this)), "reserve exceeds balance");  // V4-⑥
        reserve = amount;
        emit ReserveSet(amount);
    }

    function withdrawPool(uint256 amount) external onlyOperator {
        uint256 bal = token.balanceOf(address(this));                                   // V4-⑥
        uint256 res = reserveOf();
        uint256 free = bal > res ? bal - res : 0;
        require(amount <= free, "would break reserve");
        require(token.transfer(operator, amount), "withdraw failed");                   // V4-④
        emit PoolWithdrawn(operator, amount);
    }

    // ==================== 只读接口（与 v3 相同；poolBalance 换代币口径）====================

    function _readingFor(uint256 policyId, Policy storage p) private view returns (uint256) {
        Judgement storage j = judgements[policyId];
        return j.exists ? j.rainfallAtJudgement : rainfall[p.regionId];
    }

    function rainfallDuring(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return 0;
        return _readingFor(policyId, p) - p.rainfallAtBuy;
    }

    function shortfall(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return entryThresholdOf(MAX_HOURS);
        uint256 during = _readingFor(policyId, p) - p.rainfallAtBuy;
        return during >= p.thresholdMm ? 0 : p.thresholdMm - during;
    }

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
        return token.balanceOf(address(this));                                          // V4-⑥
    }

    function pendingExposureOf(address rider) external view returns (uint256) {
        return riderExposure[rider];
    }

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
