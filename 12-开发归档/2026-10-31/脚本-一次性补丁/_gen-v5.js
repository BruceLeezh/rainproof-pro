#!/usr/bin/env node
/** v4→v5 外科手术生成器（一次性，2026-10-26） */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "03-合约");
let s = fs.readFileSync(path.join(dir, "RainDeliveryInsuranceV4.sol"), "utf8");
let n = 0;
function rep(oldStr, newStr, label) {
  const hits = s.split(oldStr).length - 1;
  if (hits === 0) throw new Error("未命中：" + label);
  s = s.split(oldStr).join(newStr); n += hits;
}
rep("/**\n * RainDeliveryInsurance v4 —— v3 的 **ERC-20（人民币分）收付版**（2026-10-25）",
"/**\n * RainDeliveryInsurance v5 —— v4 的 **全国区域版**（2026-10-26）\n" +
" * ★ 本版相对 v4 的改动（资金轨道与判定语义零改动）：\n" +
" *   V5-① 区域从 5 个硬编码 uint8 改为 **uint32 行政区划代码**（民政部 6 位码，如\n" +
" *         武汉 420100 / 上海 310100 / 县级市义乌 330782），regions(code) 动态注册，\n" +
" *         运营方（多签）可开通全国任意省市县 —— REGION_COUNT 与 regionName() 纯函数退役；\n" +
" *   V5-② updateRainfallBatch / submitJudgements 批量入口：一场雨 N 城喂价、N 份保单\n" +
" *         判定，各打包成一笔 operator 交易（轮询喂价与批量理赔的吞吐前提）；\n" +
" *   V5-③ 阈值/档位不变：国标 GB/T 28592—2012 全国统一（12h 30/70、24h 50/100）。", "头注释");
rep("    IERC20  public immutable token;                          // V4-②：模拟计价代币（RainToken）",
"    IERC20  public immutable token;                          // V4-②：模拟计价代币（RainToken）\n\n" +
"    // ---- V5-①：动态区域表（行政区划代码 → 名称/开通状态）----\n" +
"    struct Region { string name; bool active; }\n" +
"    mapping(uint32 => Region) public regions;\n" +
"    uint256 public regionCount;", "区域表");
rep("    mapping(uint8   => uint256)   public rainfall;", "    mapping(uint32  => uint256)   public rainfall;", "rainfall");
rep("    mapping(uint8   => Judgement) public feedJudgements;", "    mapping(uint32  => Judgement) public feedJudgements;", "feedJudgements");
rep("    mapping(uint8   => uint256)   public aiPremium;", "    mapping(uint32  => uint256)   public aiPremium;", "aiPremium");
rep("    mapping(uint8   => uint8)     public riskLevel;", "    mapping(uint32  => uint8)     public riskLevel;", "riskLevel");
rep("    mapping(uint8   => mapping(uint256 => uint256)) public premiumGrid;", "    mapping(uint32  => mapping(uint256 => uint256)) public premiumGrid;", "premiumGrid");
rep("    mapping(uint8   => uint64)    public lastFeedAt;", "    mapping(uint32  => uint64)    public lastFeedAt;", "lastFeedAt");
rep("event RainfallUpdated(uint8 indexed regionId, uint256 cumulativeMm,", "event RainfallUpdated(uint32 indexed regionId, uint256 cumulativeMm,", "ev feed");
rep("event FeedRejected(uint8 indexed regionId, uint8 confidence, uint8 sources,", "event FeedRejected(uint32 indexed regionId, uint8 confidence, uint8 sources,", "ev reject");
rep("event UnderwritingDecision(uint8 indexed regionId, uint8 level, uint256 premium, bytes32 reasonHash);", "event UnderwritingDecision(uint32 indexed regionId, uint8 level, uint256 premium, bytes32 reasonHash);", "ev uw");
rep("event PremiumSet(uint8 indexed regionId, uint256 windowHours, uint256 premium, bytes32 reasonHash);", "event PremiumSet(uint32 indexed regionId, uint256 windowHours, uint256 premium, bytes32 reasonHash);", "ev grid");
rep("event PolicyBought(uint256 indexed policyId, address indexed rider, uint8 indexed regionId,", "event PolicyBought(uint256 indexed policyId, address indexed rider, uint32 indexed regionId,", "ev buy");
rep("        uint8   productId;\n        uint8   regionId;", "        uint8   productId;\n        uint32  regionId;", "Policy.regionId");
rep("    uint8   public constant REGION_COUNT = 5;               // 1=武汉 2=上海 3=北京 4=广州 5=成都\n\n", "", "REGION_COUNT 常量");
rep("        require(regionId >= 1 && regionId <= REGION_COUNT, \"bad region\");\n        require(hoursAllowed(hours_),                      \"hours must be 12/24\");\n\n        if (pricingModule != address(0)) {",
"        require(regions[regionId].active,                  \"region not available\");\n        require(hoursAllowed(hours_),                      \"hours must be 12/24\");\n\n        if (pricingModule != address(0)) {", "quoteOf 校验");
rep("        require(regionId >= 1 && regionId <= REGION_COUNT,     \"bad region\");\n        require(riskLevel[regionId] != RISK_SUSPENDED,         \"region suspended by underwriter\");",
"        require(regions[regionId].active,                      \"region not available\");\n        require(riskLevel[regionId] != RISK_SUSPENDED,         \"region suspended by underwriter\");", "buy 校验");
rep("    function updateRainfall(uint8 regionId, uint256 cumulativeMm, bytes32 evidenceHash,\n                            uint8 confidence, uint8 sources) external onlyOperator\n    {\n        require(regionId >= 1 && regionId <= REGION_COUNT, \"bad region\");\n        require(cumulativeMm >= rainfall[regionId],        \"cumulative must not decrease\");",
"    function updateRainfall(uint32 regionId, uint256 cumulativeMm, bytes32 evidenceHash,\n                            uint8 confidence, uint8 sources) external onlyOperator\n    {\n        _feed(regionId, cumulativeMm, evidenceHash, confidence, sources);\n        emit RainfallUpdated(regionId, cumulativeMm, evidenceHash, confidence, msg.sender);\n    }\n\n" +
"    /// @notice V5-②：批量喂价（一场雨多城一次上链；数组逐位对齐，任一失败整笔回滚）\n" +
"    function updateRainfallBatch(uint32[] calldata regionIds, uint256[] calldata cumulativeMm,\n" +
"                                 bytes32[] calldata evidenceHashes, uint8[] calldata confidences,\n" +
"                                 uint8[] calldata sourcesArr) external onlyOperator\n" +
"    {\n" +
"        require(regionIds.length == cumulativeMm.length && regionIds.length == evidenceHashes.length\n" +
"             && regionIds.length == confidences.length && regionIds.length == sourcesArr.length,\n" +
"                \"array length mismatch\");\n" +
"        for (uint256 i = 0; i < regionIds.length; i++) {\n" +
"            _feed(regionIds[i], cumulativeMm[i], evidenceHashes[i], confidences[i], sourcesArr[i]);\n" +
"            emit RainfallUpdated(regionIds[i], cumulativeMm[i], evidenceHashes[i], confidences[i], msg.sender);\n" +
"        }\n" +
"    }\n\n" +
"    function _feed(uint32 regionId, uint256 cumulativeMm, bytes32 evidenceHash,\n" +
"                   uint8 confidence, uint8 sources) internal\n" +
"    {\n" +
"        require(regions[regionId].active,                  \"region not available\");\n" +
"        require(cumulativeMm >= rainfall[regionId],        \"cumulative must not decrease\");", "updateRainfall 批量");
rep("    function rejectFeed(uint8 regionId, uint8 confidence, uint8 sources,",
"    /// @notice V5-①：开通一个行政区划（多签二票）。重复注册视为改名，不重复计数。\n" +
"    function registerRegion(uint32 code, string calldata name) external onlyOperator {\n" +
"        require(code != 0,               \"zero code\");\n" +
"        require(bytes(name).length != 0, \"empty name\");\n" +
"        if (!regions[code].active) { regionCount += 1; regions[code].active = true; }\n" +
"        regions[code].name = name;\n" +
"        emit RegionRegistered(code, name, regionCount);\n" +
"    }\n\n" +
"    /// @notice 关停一个区域（在保保单照常履行，仅停售新单）\n" +
"    function setRegionActive(uint32 code, bool active_) external onlyOperator {\n" +
"        require(regions[code].active || active_, \"unknown region\");\n" +
"        if (regions[code].active && !active_) regionCount -= 1;\n" +
"        regions[code].active = active_;\n" +
"        emit RegionActiveSet(code, active_);\n" +
"    }\n\n" +
"    function rejectFeed(uint32 regionId, uint8 confidence, uint8 sources,", "注册函数");
rep("        require(regionId >= 1 && regionId <= REGION_COUNT, \"bad region\");\n        require(confidence <= 100,                         \"confidence out of range\");\n        require(inputHash != bytes32(0),                   \"evidence required\");",
"        require(regions[regionId].active,                  \"region not available\");\n        require(confidence <= 100,                         \"confidence out of range\");\n        require(inputHash != bytes32(0),                   \"evidence required\");", "rejectFeed 校验");
rep("    function submitJudgement(uint256 policyId, uint8 decision, uint8 confidence, uint8 sources,\n                             uint256 rainfallAtJudgement,\n                             bytes32 inputHash, bytes32 outputHash,\n                             string calldata modelVersion) external onlyOperator\n    {",
"    function submitJudgement(uint256 policyId, uint8 decision, uint8 confidence, uint8 sources,\n                             uint256 rainfallAtJudgement,\n                             bytes32 inputHash, bytes32 outputHash,\n                             string calldata modelVersion) external onlyOperator\n    {\n        _judge(policyId, decision, confidence, sources, rainfallAtJudgement, inputHash, outputHash, modelVersion);\n    }\n\n" +
"    /// @notice V5-②：批量判定（一场雨 N 份保单一次上链；逐份校验，任一失败整笔回滚）\n" +
"    function submitJudgements(uint256[] calldata policyIds, uint8[] calldata decisions,\n" +
"                              uint8[] calldata confidences, uint8[] calldata sourcesArr,\n" +
"                              uint256[] calldata rainfalls, bytes32[] calldata inputHashes,\n" +
"                              bytes32[] calldata outputHashes, string[] calldata modelVersions)\n" +
"        external onlyOperator\n" +
"    {\n" +
"        require(policyIds.length == decisions.length && policyIds.length == confidences.length\n" +
"             && policyIds.length == sourcesArr.length && policyIds.length == rainfalls.length\n" +
"             && policyIds.length == inputHashes.length && policyIds.length == outputHashes.length\n" +
"             && policyIds.length == modelVersions.length,\n" +
"                \"array length mismatch\");\n" +
"        for (uint256 i = 0; i < policyIds.length; i++) {\n" +
"            _judge(policyIds[i], decisions[i], confidences[i], sourcesArr[i], rainfalls[i],\n" +
"                   inputHashes[i], outputHashes[i], modelVersions[i]);\n" +
"            emit JudgementSubmitted(policyIds[i], KIND_LOSS, decisions[i], confidences[i], sourcesArr[i],\n" +
"                                    rainfalls[i], inputHashes[i], outputHashes[i], modelVersions[i]);\n" +
"        }\n" +
"    }\n\n" +
"    function _judge(uint256 policyId, uint8 decision, uint8 confidence, uint8 sources,\n" +
"                    uint256 rainfallAtJudgement, bytes32 inputHash, bytes32 outputHash,\n" +
"                    string calldata modelVersion) internal\n" +
"    {", "submitJudgement 批量");
rep("    function setUnderwriting(uint8 regionId, uint8 level, uint256 premium, bytes32 reasonHash)", "    function setUnderwriting(uint32 regionId, uint8 level, uint256 premium, bytes32 reasonHash)", "setUnderwriting");
rep("    function setPremiumGrid(uint8 regionId, uint256 hours_, uint256 premium, bytes32 reasonHash)", "    function setPremiumGrid(uint32 regionId, uint256 hours_, uint256 premium, bytes32 reasonHash)", "setPremiumGrid");
rep("        require(regionId >= 1 && regionId <= REGION_COUNT, \"bad region\");\n        require(level <= RISK_SUSPENDED,                   \"bad level\");",
"        require(regions[regionId].active,                  \"region not available\");\n        require(level <= RISK_SUSPENDED,                   \"bad level\");", "setUnderwriting 校验");
rep("        require(regionId >= 1 && regionId <= REGION_COUNT, \"bad region\");\n        require(hoursAllowed(hours_),                      \"hours must be 12/24\");\n        require(premium >= MIN_PREMIUM && premium < PAYOUT_MAX, \"premium out of range\");",
"        require(regions[regionId].active,                  \"region not available\");\n        require(hoursAllowed(hours_),                      \"hours must be 12/24\");\n        require(premium >= MIN_PREMIUM && premium < PAYOUT_MAX, \"premium out of range\");", "setPremiumGrid 校验");
rep("    function regionName(uint8 regionId) public pure returns (string memory) {\n        if (regionId == 1) return \"wuhan\";\n        if (regionId == 2) return \"shanghai\";\n        if (regionId == 3) return \"beijing\";\n        if (regionId == 4) return \"guangzhou\";\n        if (regionId == 5) return \"chengdu\";\n        return \"unknown\";\n    }\n\n", "", "regionName 退役");
rep("    event PricingModuleSet(address indexed module);",
"    event PricingModuleSet(address indexed module);\n" +
"    event RegionRegistered(uint32 indexed code, string name, uint256 regionCount);   // V5-①\n" +
"    event RegionActiveSet(uint32 indexed code, bool active);", "新事件");
if (!s.includes("emit JudgementSubmitted(policyId, KIND_LOSS, decision, confidence, sources,")) throw new Error("单条判定 emit 未找到");
fs.writeFileSync(path.join(dir, "RainDeliveryInsuranceV5.sol"), s, "utf8");
console.log("OK v5 生成：" + n + " 组替换 · " + s.length + " 字节");
