// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * RainDeliveryInsurance —— 雨天骑手配送中断险（参数化保险）
 *
 * 场景：外卖骑手在暴雨天配送，配送中断造成的收入损失，由保险自动赔付。
 * 特点：不看发票、不报案、不人工定损 —— 天气数据触发阈值 + AI 判定确认，就赔。
 *
 * ★ 本版（赛期新增）把 AI 的判定结果接进了判定链，见下方「AI 判定层」段。
 *   核心口径：**AI 不决定赔不赔，只决定「喂进去的数可不可信」和「这场雨有没有砸在人身上」**。
 *   赔不赔仍然由 `during >= THRESHOLD` 这条确定性规则算。
 *
 * 相比「教科书骨架版」，这一版修掉了 4 个会在演示现场炸掉的问题，见下方 ★ 标注。
 */
contract RainDeliveryInsurance {

    // ==================== 参数 ====================

    uint256 public constant PREMIUM   = 0.001 ether;   // 保费（默认值，未设定 AI 保费时用）
    uint256 public constant PAYOUT    = 0.01  ether;   // 赔付额
    uint256 public constant THRESHOLD = 50;            // 触发阈值：保单期间累计降雨 ≥ 50mm
    uint256 public constant MIN_HOURS = 1;
    uint256 public constant MAX_HOURS = 72;            // ★ 修正 1：保单时长必须有上限

    uint8   public constant REGION_COUNT = 5;          // ★ 修正 2：区域要有白名单

    // ---- AI 判定层参数 ----

    uint8 public constant KIND_FEED = 0;   // 喂价验收：这批外部数据可不可信
    uint8 public constant KIND_LOSS = 1;   // 损失判定：这场雨有没有砸在人身上

    uint8 public constant DECISION_DENY = 0;   // 判定结论：不赔（没砸到人 / 数据不可信）
    uint8 public constant DECISION_PAY  = 1;   // 判定结论：赔（确认损失 / 数据可信）

    // ⚠️ decision 是**独立字段**，不是「confidence 高低」的代名词。
    //    「AI 说这场雨没砸到人」必须是一个合约能读到的结论，而不是「置信度低」。
    uint8 public constant MIN_CONFIDENCE = 60; // 两类判定的置信度下限（0-100）

    uint8 public constant RISK_NORMAL    = 0;  // 承保人：正常承保
    uint8 public constant RISK_LOADED    = 1;  // 承保人：预警加价
    uint8 public constant RISK_SUSPENDED = 2;  // 承保人：拒保（该区域停止承保）

    address public operator;                   // 喂价者 / 判定提交者 = 你的脚本
    bool    public paused;
    uint256 public reserve;                    // 赔付准备金下限，withdrawPool 不得击穿

    // ==================== 数据结构 ====================

    struct Policy {
        address rider;          // 投保骑手
        uint8   regionId;       // 1=武汉 2=上海 3=北京 4=广州 5=成都
        uint256 startTime;
        uint256 endTime;
        uint256 rainfallAtBuy;  // ★ 关键设计：投保当刻的【累计】降雨快照
        bool    paid;
        bool    exists;
    }

    /// @notice 一次 AI 判定。喂价验收和损失判定共用这一个结构，靠 kind 区分。
    struct Judgement {
        uint8   kind;          // KIND_FEED / KIND_LOSS
        uint8   decision;      // DECISION_DENY / DECISION_PAY  ← 结论，与置信度解耦
        uint8   confidence;    // 0-100
        uint8   sources;       // 本次采信的数据源个数（仅 KIND_FEED 有意义，KIND_LOSS 写 0）
        uint64  judgedAt;      // 由合约写入 block.timestamp
        bool    exists;
        bytes32 inputHash;     // 多源数据快照的哈希
        bytes32 outputHash;    // 判定结果的哈希
        string  modelVersion;  // 模型 / 提示词版本
    }

    mapping(uint256 => Policy)    public policies;        // policyId => 保单
    mapping(uint8   => uint256)   public rainfall;        // regionId => 累计降雨量(mm)，由喂价脚本推
    mapping(uint256 => Judgement) public judgements;      // policyId => 损失判定
    mapping(uint8   => Judgement) public feedJudgements;  // regionId => 最近一次喂价验收（含拒收）
    mapping(uint8   => uint256)   public aiPremium;       // regionId => AI 定的保费
    mapping(uint8   => uint8)     public riskLevel;       // regionId => 风险等级
    mapping(address => uint256[]) private _byRider;       // 骑手 => 自己的保单号
    uint256 public nextPolicyId;                          // 从 0 开始

    // ==================== 事件 ====================

    event PolicyBought(uint256 indexed policyId, address indexed rider, uint8 indexed regionId, uint256 endTime);

    /// @notice ⚠️ 加了 evidenceHash / confidence / sources 三个参数后，
    ///         本事件的 topic0 **变了**（原来是 0x93238e87…，现在不同）。
    ///         核验台的 EVENT_SIG 映射、以及任何按 topic0 过滤的地方都要同步。
    event RainfallUpdated(uint8 indexed regionId, uint256 cumulativeMm,
                          bytes32 evidenceHash, uint8 confidence, address indexed reporter);

    event ClaimPaid(uint256 indexed policyId, address indexed rider, uint256 amount);
    event PoolFunded(address indexed from, uint256 amount, uint256 newBalance);
    event PoolWithdrawn(address indexed to, uint256 amount);
    event OperatorChanged(address indexed from, address indexed to);
    event PausedSet(bool paused);

    // ---- AI 判定层新增事件 ----

    /// @notice 多源验收判定不可信时留证（不喂价，但把这次异常留在链上）
    event FeedRejected(uint8 indexed regionId, uint8 confidence, uint8 sources,
                       bytes32 inputHash, string modelVersion);

    event JudgementSubmitted(uint256 indexed policyId, uint8 indexed kind, uint8 decision,
                             uint8 confidence, bytes32 inputHash, bytes32 outputHash,
                             string modelVersion);

    event UnderwritingDecision(uint8 indexed regionId, uint8 level, uint256 premium, bytes32 reasonHash);

    event ReserveSet(uint256 amount);

    // ==================== 修饰器 ====================

    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    modifier notPaused()    { require(!paused, "contract paused"); _; }

    constructor() {
        operator = msg.sender;
        emit OperatorChanged(address(0), msg.sender);
    }

    // ==================== 投保 ====================

    /// @notice 当前实际保费。0 表示未设定，回退到 PREMIUM。
    function premiumOf(uint8 regionId) public view returns (uint256) {
        uint256 p = aiPremium[regionId];
        return p == 0 ? PREMIUM : p;
    }

    /// @notice 骑手投保。regionId 1~5，hours_ 1~72，需随交易附带 premiumOf(regionId)
    function buyPolicy(uint8 regionId, uint256 hours_) external payable notPaused returns (uint256 id) {
        require(regionId >= 1 && regionId <= REGION_COUNT,    "bad region");
        require(riskLevel[regionId] != RISK_SUSPENDED,        "region suspended by underwriter");
        require(msg.value == premiumOf(regionId),             "premium mismatch");
        require(hours_ >= MIN_HOURS && hours_ <= MAX_HOURS,   "hours out of range");

        id = nextPolicyId++;
        policies[id] = Policy({
            rider:         msg.sender,
            regionId:      regionId,
            startTime:     block.timestamp,
            endTime:       block.timestamp + hours_ * 1 hours,
            rainfallAtBuy: rainfall[regionId],     // 记下快照
            paid:          false,
            exists:        true
        });
        _byRider[msg.sender].push(id);

        emit PolicyBought(id, msg.sender, regionId, policies[id].endTime);
    }

    // ==================== 喂价验收（AI 落点一）====================

    /**
     * @notice 更新某区域的【累计】降雨量。只有 operator（你的喂价脚本）能调。
     * @dev    传累计值，不是单次增量。脚本每次推送「截至目前的累计降雨」，
     *         合约靠「当前累计 − 投保时快照」算出保单期间的真实降雨。
     *
     *         ★ 新增的 evidenceHash / confidence 是喂价验收的落点：
     *         AI 把 ECMWF / GFS / ICON 三家交叉核验后，给出共识值 + 置信度 + 数据快照哈希。
     *         置信度不够，合约**真的会拒收**（不是只写在文档里）。
     */
    function updateRainfall(uint8 regionId, uint256 cumulativeMm, bytes32 evidenceHash,
                            uint8 confidence, uint8 sources) external onlyOperator
    {
        require(regionId >= 1 && regionId <= REGION_COUNT, "bad region");
        require(cumulativeMm >= rainfall[regionId],        "cumulative must not decrease"); // 单调不减
        require(evidenceHash != bytes32(0),                "evidence required");
        require(confidence <= 100,                         "confidence out of range");
        require(confidence >= MIN_CONFIDENCE,              "feed confidence too low");      // ★ 合约真的会拒收

        rainfall[regionId] = cumulativeMm;

        feedJudgements[regionId] = Judgement({
            kind: KIND_FEED, decision: DECISION_PAY,
            confidence: confidence, sources: sources,
            judgedAt: uint64(block.timestamp), exists: true,
            inputHash: evidenceHash, outputHash: bytes32(cumulativeMm),
            modelVersion: ""
        });

        emit RainfallUpdated(regionId, cumulativeMm, evidenceHash, confidence, msg.sender);
    }

    /// @notice 多源验收判定不可信时调用：不喂价，但把这次异常留在链上。
    /// @dev    与 updateRainfall 的区别只有一件事：**不改 rainfall**。
    function rejectFeed(uint8 regionId, uint8 confidence, uint8 sources,
                        bytes32 inputHash, string calldata modelVersion) external onlyOperator
    {
        require(regionId >= 1 && regionId <= REGION_COUNT, "bad region");
        require(confidence <= 100,                         "confidence out of range");
        require(inputHash != bytes32(0),                   "evidence required");

        feedJudgements[regionId] = Judgement({
            kind: KIND_FEED, decision: DECISION_DENY,
            confidence: confidence, sources: sources,
            judgedAt: uint64(block.timestamp), exists: true,
            inputHash: inputHash, outputHash: bytes32(0),
            modelVersion: modelVersion
        });

        emit FeedRejected(regionId, confidence, sources, inputHash, modelVersion);
    }

    // ==================== 损失判定写入（AI 落点二）====================

    /// @notice 写入某份保单的损失判定。只有 operator 能写，**一份保单只能判一次**。
    /// @dev    既然要「拿判定当付款依据」，判定就必须是不可篡改、且写入后不可推翻的。
    function submitJudgement(uint256 policyId, uint8 decision, uint8 confidence,
                             bytes32 inputHash, bytes32 outputHash,
                             string calldata modelVersion) external onlyOperator
    {
        require(policies[policyId].exists,        "no such policy");
        require(!judgements[policyId].exists,     "judgement already submitted");  // ★ 只写一次
        require(decision <= DECISION_PAY,         "bad decision");
        require(confidence <= 100,                "confidence out of range");

        judgements[policyId] = Judgement({
            kind: KIND_LOSS, decision: decision,
            confidence: confidence, sources: 0,
            judgedAt: uint64(block.timestamp), exists: true,
            inputHash: inputHash, outputHash: outputHash,
            modelVersion: modelVersion
        });

        emit JudgementSubmitted(policyId, KIND_LOSS, decision, confidence,
                                inputHash, outputHash, modelVersion);
    }

    // ==================== 赔付 ====================

    /**
     * @notice 申请赔付。任何人都可以触发，但钱只会打给保单里的骑手本人。
     * @dev    这里是全合约最该看懂的一段：**五条 require 就是「为什么赔 / 为什么不赔」的完整规则**，
     *         全部链上公开可查、任何人可复算。
     *
     *         确定性规则（可复现）+ AI 判定（可审计）的咬合点：
     *           ① 保单存在、没赔过、没到期
     *           ② 期间累计降雨 ≥ THRESHOLD        ← 纯确定性，一个字节的 AI 都没有
     *           ③ AI 判定 kind/decision/confidence 三关过了
     *         ② 保证「雨真的下够了」，③ 保证「这场雨真的砸在这个骑手身上」。
     */
    function claim(uint256 policyId) external notPaused {
        Policy storage p = policies[policyId];

        // ---- 确定性规则层 ----
        require(p.exists,                          "no such policy");
        require(!p.paid,                           "already paid");
        require(block.timestamp <= p.endTime,      "policy expired");
        uint256 during = rainfall[p.regionId] - p.rainfallAtBuy;
        require(during >= THRESHOLD,               "threshold not met");

        // ---- AI 判定层（三重条件）----
        Judgement storage j = judgements[policyId];
        require(j.exists,                          "no AI judgement");
        require(j.kind == KIND_LOSS,               "wrong judgement kind");   // ★ 防御性：判定必须来自损失通道
        require(j.decision == DECISION_PAY,        "AI: no loss confirmed");  // ★ 用的是结论，不是置信度
        require(j.confidence >= MIN_CONFIDENCE,    "AI: low confidence");     // ★

        // ---- 资金 ----
        require(address(this).balance >= PAYOUT,   "insurance pool empty");   // ★ 修正 3

        // 先改状态再转账 —— 防重入的标准写法（Checks-Effects-Interactions）
        p.paid = true;

        // ★ 修正 4：用 call 而不是 transfer
        //   transfer 只转发 2300 gas，收款方若是合约会失败；call 是现行推荐做法。
        (bool ok, ) = payable(p.rider).call{value: PAYOUT}("");
        require(ok, "payout transfer failed");

        emit ClaimPaid(policyId, p.rider, PAYOUT);
    }

    // ==================== 承保人写入（AI 落点：精算定价）====================

    /**
     * @notice 按精算结论设置某区域的风险等级与保费。
     * @dev    允许**降价**——这是精算结论能落地的前提（纯保费远低于默认 0.001 时要能调下来），
     *         但必须有边界：premium 必须 > 0 且 < PAYOUT。
     *         用 `< PAYOUT` 而不是 `<= PAYOUT`：保费等于赔付额意味着零毛利，
     *         只要发生赔付，这个区域在数学上就不可能长期存活。
     */
    function setUnderwriting(uint8 regionId, uint8 level, uint256 premium, bytes32 reasonHash)
        external onlyOperator
    {
        require(regionId >= 1 && regionId <= REGION_COUNT, "bad region");
        require(level <= RISK_SUSPENDED,                   "bad level");
        require(premium > 0 && premium < PAYOUT,           "premium out of range");

        riskLevel[regionId] = level;
        // 拒保时把保费清零，让 premiumOf 回退到默认值；真正的拦阻是 buyPolicy 里的 suspended 检查。
        aiPremium[regionId] = (level == RISK_NORMAL || level == RISK_LOADED) ? premium : 0;

        emit UnderwritingDecision(regionId, level, premium, reasonHash);
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

    // ==================== 资金池 ====================

    /// @notice 团队注资到赔付资金池（演示前必须做，否则第一笔赔付就失败）
    function fundPool() external payable {
        require(msg.value > 0, "zero amount");
        emit PoolFunded(msg.sender, msg.value, address(this).balance);
    }

    /// @notice 设置赔付准备金下限。已经低于该值时不允许再设新值，
    ///         否则 `withdrawPool` 会因下溢而直接 revert（checked 算术下 `balance - reserve` 溢出错）。
    function setReserve(uint256 amount) external onlyOperator {
        require(amount <= address(this).balance, "reserve exceeds balance");
        reserve = amount;
        emit ReserveSet(amount);
    }

    /// @notice 提取多余资金。只允许 operator，且不能把赔付准备金掏空。
    /// @dev    reserve 拦的是「提取」，claim 仍按 balance >= PAYOUT 判断 ——
    ///         准备金是运营纪律，不是把赔付权也锁死。
    function withdrawPool(uint256 amount) external onlyOperator {
        require(amount <= address(this).balance - reserve, "would break reserve");
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

    /// @notice 保单期间至今的累计降雨（未到期时随时可查，用于「还差多少才赔」）
    function rainfallDuring(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return 0;
        return rainfall[p.regionId] - p.rainfallAtBuy;
    }

    /// @notice 距离触发赔付还差多少毫米（0 = 已达标）
    function shortfall(uint256 policyId) external view returns (uint256) {
        Policy storage p = policies[policyId];
        if (!p.exists) return THRESHOLD;
        uint256 during = rainfall[p.regionId] - p.rainfallAtBuy;
        return during >= THRESHOLD ? 0 : THRESHOLD - during;
    }

    /// @notice 某个骑手的全部保单号（前端「我的保单」列表用）
    function policiesOf(address rider) external view returns (uint256[] memory) {
        return _byRider[rider];
    }

    /// @notice 赔付资金池余额 —— 前端顶部显示「偿付能力」
    function poolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice 这份保单现在处于什么状态（前端直接显示，不用自己拼逻辑）
     * @dev    ★ 与旧版的区别：雨量达标**不等于**可赔。`claim()` 还要 AI 判定三关，
     *         所以状态机必须把中间态显出来，否则前端会显示「可赔」而一点就 revert ——
     *         那是界面在撒谎。keeper 也依赖这个函数挑单，所以口径必须和 claim 完全对齐。
     */
    function policyStatus(uint256 policyId) external view returns (string memory) {
        Policy storage p = policies[policyId];
        if (!p.exists)                                  return "not_found";
        if (p.paid)                                     return "paid";
        if (block.timestamp > p.endTime)                return "expired";
        if (rainfall[p.regionId] - p.rainfallAtBuy < THRESHOLD) return "active";

        // 雨量够了，接下来的门槛全在 AI 判定这一层
        Judgement storage j = judgements[policyId];
        if (!j.exists)                                  return "pending_judgement";
        if (j.kind != KIND_LOSS)                        return "pending_judgement";
        if (j.decision != DECISION_PAY)                 return "denied";
        if (j.confidence < MIN_CONFIDENCE)              return "low_confidence";
        return "claimable";
    }
}
