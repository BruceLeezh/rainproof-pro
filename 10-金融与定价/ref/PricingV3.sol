// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title 雨证 v3 定价层参考实现
/// @notice **这是 B 给 A 的落地参考，不是部署件。** 完整改造规格见
///         `10-金融与定价/v3-合约规格.md`。按 AGENTS.md §1，`03-合约/` 是 A 独占。
///
/// 本文件只实现"定价"这一层，且刻意做成**自包含**：它不继承 v2，也不碰判定链
/// （submitJudgement / updateRainfall / claim / settleExpired 一行都不动）。
/// A 落地时应当把这里的 storage 与函数**搬进** `RainDeliveryInsuranceV3.sol`，
/// 由 `Ownable`/`Pausable` 那套接上 operator 权限。
///
/// 设计要点（每条都能在规格文件里找到理由）：
///   1. 五个维度：regionId × hours × (riderTier, channel) × count。
///      `hours` 本批只有 {12, 24}：GB/T 28592-2012 §3 只定义 12h/24h 两档，
///      48h/72h 随 `thresholdOf(h) = 50 * h / 24` 线性外推一起作废（见
///      `10-金融与定价/pricing_engine.js` 文件头）。→ `hoursAllowed()`。
///      (riderTier, channel) 先经 `segmentId()` 塌缩成 0..3，因为 9 种组合里
///      只有 4 种合法，且它们不是独立乘数。
///   2. `0` 是"这一格不卖"的哨兵值 → `premiumOf` 必须 revert，**不许回退**。
///      本批 40 格零售价**全部可售（0 格触发）**，但这条 revert 路径必须留着：
///      `premiumWei == 0` 是"产品政策决定不卖"，不是"价格算错了"。
///   3. 批量价是一张两维表（每格 6 个 band），不是一组折扣 bp。
///      批量 band 只存在于 channel=1（seg 0/1）：5 城 × 2 时长 × 2 seg
///      = 20 格 × 6 档 = 120 行。
///   4. `MIN_PREMIUM` 必须是 0.00002 ether。v2 的 0.0002 会让全部批量价被拒。
///   5. 赔付档本批只有 2 档（`meta.tierBps = [5000, 7500]`），第三档特大暴雨
///      （≥140mm / ≥250mm）不卖。档线不在本文件里 —— 定价层只存价，不碰判定链。
contract PricingV3 {
    // ── 维度常量 ────────────────────────────────────────────────────────────
    uint8 public constant SEGMENT_COUNT = 4;
    uint8 public constant BAND_COUNT = 6;
    uint256 public constant MAX_BATCH_MINT = 100;
    /// 本批只卖 12h / 24h（GB/T 28592-2012 表 1 只定义这两档）
    uint8 public constant HOURS_COUNT = 2;
    /// 零售格 = 5 城 × 2 时长 × 4 seg = 40；批量行 = 5 × 2 × 2 × 6 = 120
    uint256 public constant RETAIL_CELL_COUNT = 40;
    uint256 public constant BAND_CELL_COUNT = 120;

    // ── 经济常量（与 10-金融与定价/pricing_engine.js 逐字对应）───────────────
    uint256 public constant MIN_PREMIUM = 0.00002 ether; // v2 是 0.0002 → 必须降
    uint256 public constant PAYOUT_MAX = 0.01 ether;

    // 用户类型：0 众包自助 / 1 认证骑手 / 2 平台团体
    // 使用场景：0 自助投保 / 1 平台代付（2 预警增保 **已下线**，见规格 §2.1）

    address public operator;

    /// 零售价：[regionId][hours][segId] → wei。0 = 不卖。
    mapping(uint8 => mapping(uint256 => uint256[SEGMENT_COUNT])) private _retail;

    /// 批量单价：[regionId][hours][segId][band] → wei。band 0 恒 = 零售价。
    /// 只有 channel=1 的 seg 0/1 有批量行（20 格 × 6 档 = 120 行）；
    /// 自助投保渠道没有批量承诺量，其 6 档全写零售价。
    /// ⚠️ 声明顺序是 `[BAND_COUNT][SEGMENT_COUNT]` 而不是反过来 —— Solidity 的定长
    /// 多维数组下标是**从右往左**对应的（`T[A][B]` 是 B 个 `T[A]`，写作 `[i][j]` 时
    /// i<B、j<A）。写成 `[SEGMENT_COUNT][BAND_COUNT]` 再去 `[segId][band]` 取，
    /// band≥4 就会 Panic ARRAY_RANGE_ERROR。这一行已经用 staticCall 真跑出来过。
    /// （声明本身与维度迁移无关：SEGMENT_COUNT/BAND_COUNT 两批都是 4/6。）
    mapping(uint8 => mapping(uint256 => uint256[BAND_COUNT][SEGMENT_COUNT])) private _band;

    /// 平台在 (regionId, hours_, segId) 上的月度承诺量 → 决定用哪个 band
    mapping(address => mapping(bytes32 => uint256)) public platformCommitment;

    event PremiumRowSet(
        uint8 indexed regionId, uint256 indexed windowHours, uint8 indexed segId,
        uint256 retailWei, bytes32 reasonHash
    );
    event PlatformCommitmentSet(address indexed platform, uint8 regionId, uint256 windowHours, uint256 count);

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    // ══════════════════════════════════════════════════════════════════════
    // 维度压缩：这几个函数是**冻结接口**（AGENTS.md §6），
    // 顺序必须与 pricing_engine.js 的 SEGMENTS 数组逐字一致。
    // ══════════════════════════════════════════════════════════════════════

    /// 合法保障时长：12h / 24h。与 pricing_engine.js 的 `const HOURS = [12, 24]`
    /// 逐字对应（引擎那行的注释写的就是"= 合约 hoursAllowed()"）。
    /// 48h/72h 不是"暂时不卖"，是 GB/T 28592-2012 里**不存在这两档** —— 线性外推
    /// 出来的档线（72h 暴雨线 150mm）在五城 11 年历史里一次都没触发过。
    function hoursAllowed(uint256 hours_) public pure returns (bool) {
        return hours_ == 12 || hours_ == 24;
    }

    /// 0 = (2,1) 平台团体·平台代付  κ=0.00
    /// 1 = (1,1) 认证骑手·平台代付  κ=0.15
    /// 2 = (1,0) 认证骑手·自助投保  κ=0.55
    /// 3 = (0,0) 众包自助·自助投保  κ=1.00
    /// 其余（含 channel=2 预警增保）一律 revert —— 不留后门。
    function segmentId(uint8 riderTier, uint8 channel) public pure returns (uint8) {
        if (riderTier == 2 && channel == 1) return 0;
        if (riderTier == 1 && channel == 1) return 1;
        if (riderTier == 1 && channel == 0) return 2;
        if (riderTier == 0 && channel == 0) return 3;
        revert("illegal segment");
    }

    /// 与 pricing-engine.json 的 BATCH_N = [1,10,50,100,500,1000] 对应
    function bandOf(uint256 count) public pure returns (uint8) {
        if (count >= 1000) return 5;
        if (count >= 500) return 4;
        if (count >= 100) return 3;
        if (count >= 50) return 2;
        if (count >= 10) return 1;
        return 0;
    }

    // ══════════════════════════════════════════════════════════════════════
    // 写价（operator）
    // ══════════════════════════════════════════════════════════════════════

    /// 一次交易写一格：零售价 + 该格的 6 个 band 单价。
    /// 全部 40 格 = 40 次调用（不是 40×6 次）。
    function setPremiumRow(
        uint8 regionId,
        uint256 hours_,
        uint8 segId,
        uint256 retailWei,
        uint256[BAND_COUNT] calldata bandWei,
        bytes32 reasonHash
    ) external onlyOperator {
        require(regionId >= 1 && regionId <= 5, "bad region");
        require(hoursAllowed(hours_), "bad window");
        require(segId < SEGMENT_COUNT, "bad seg");
        // retailWei == 0 是合法的（"这一格不卖"）；否则必须落在 [MIN_PREMIUM, PAYOUT_MAX)
        require(retailWei == 0 || (retailWei >= MIN_PREMIUM && retailWei < PAYOUT_MAX), "retail out of range");
        _retail[regionId][hours_][segId] = retailWei;
        for (uint8 b = 0; b < BAND_COUNT; ++b) {
            uint256 p = bandWei[b];
            require(p >= MIN_PREMIUM && p < PAYOUT_MAX, "band out of range");
            // 单调性：份数越多单价不增。写成断言而不是"信任输入"，
            // 因为这一格一旦写错，赔付率就错了，链上没有任何别的地方能发现。
            if (b > 0) require(p <= bandWei[b - 1], "band not monotone");
            _band[regionId][hours_][segId][b] = p;
        }
        // 不卖的格：band 全写零售地板即可，premiumOf 会在读 retail 时就 revert
        if (retailWei != 0) require(bandWei[0] == retailWei, "band0 must equal retail");
        emit PremiumRowSet(regionId, hours_, segId, retailWei, reasonHash);
    }

    /// 平台声明月度承诺量。当前不做事后差额结算。
    /// ponytail: 未做"承诺未达标补差价"，演示够用；产品化时加 settleCommitment()。
    function setPlatformCommitment(
        uint8 regionId, uint256 hours_, uint256 count
    ) external {
        uint8 seg = segmentId(_tierOf(msg.sender), 1);
        bytes32 k = _commitKey(regionId, hours_, seg);
        platformCommitment[msg.sender][k] = count;
        emit PlatformCommitmentSet(msg.sender, regionId, hours_, count);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 读价
    // ══════════════════════════════════════════════════════════════════════

    /// @param count 0 或 1 = 零售；>1 = 按 band 单价（见规格 §2.2 为何是"承诺量"）
    /// @dev 不可售格 **revert**，不回退到别的价。这是定价结论，不是实现细节。
    ///      本批 40 格全可售，所以这条路径当前只对"没写过的格"生效（核验脚本用
    ///      它守住"premiumWei=0 必须 revert"这个性质）。
    function premiumOf(
        uint8 regionId, uint256 hours_, uint8 riderTier, uint8 channel, uint256 count
    ) public view returns (uint256) {
        uint8 seg = segmentId(riderTier, channel);
        uint256 retail = _retail[regionId][hours_][seg];
        require(retail != 0, "not offered");
        if (count <= 1) return retail;
        return _band[regionId][hours_][seg][bandOf(count)];
    }

    /// 只读辅助：不 revert，方便核验台/演示页展示"这一格卖不卖"
    function quoteOrZero(
        uint8 regionId, uint256 hours_, uint8 riderTier, uint8 channel, uint256 count
    ) external view returns (uint256 price, bool sellable) {
        uint8 seg;
        if (riderTier == 2 && channel == 1) seg = 0;
        else if (riderTier == 1 && channel == 1) seg = 1;
        else if (riderTier == 1 && channel == 0) seg = 2;
        else if (riderTier == 0 && channel == 0) seg = 3;
        else return (0, false);
        uint256 retail = _retail[regionId][hours_][seg];
        if (retail == 0) return (0, false);
        price = count <= 1 ? retail : _band[regionId][hours_][seg][bandOf(count)];
        sellable = true;
    }

    /// 批量出单时的应收总额（A 的 buyPolicyBatch 用来核 msg.value）
    function batchCost(
        uint8 regionId, uint256 hours_, uint8 riderTier, uint256 count
    ) public view returns (uint256) {
        require(count >= 1 && count <= MAX_BATCH_MINT, "count out of range");
        return premiumOf(regionId, hours_, riderTier, 1, count) * count;
    }

    function retailOf(uint8 regionId, uint256 hours_, uint8 segId) external view returns (uint256) {
        return _retail[regionId][hours_][segId];
    }

    function bandOfCell(uint8 regionId, uint256 hours_, uint8 segId, uint8 band) external view returns (uint256) {
        return _band[regionId][hours_][segId][band];
    }

    // ── 内部 ──────────────────────────────────────────────────────────────
    // 身份映射由 A 的实现提供（v2 里已有 eligible / riderTier 语义）。
    // 这里留成可覆盖的钩子，避免本参考件与 v2 的权限体系冲突。
    function _tierOf(address) internal view virtual returns (uint8) {
        return 0; // 默认按众包自助；A 落地时接上 attestation
    }

    function _commitKey(uint8 regionId, uint256 hours_, uint8 seg) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(regionId, hours_, seg));
    }
}
