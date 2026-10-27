// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * OperatorMultisig —— 比赛用最小 N/M 多签（本项目用 2/3）
 *
 * 解决的唯一问题：RainDeliveryInsuranceV2 的 `operator` 原本是一把私钥
 * （0xb466B1D1fA19026e08C3311C555d220AE2E1Ba3a），而 `updateRainfall` 能改写全部五城
 * 雨量计数器，`setPaused` / `withdrawPool` / `transferOperator` 等也都挂在 onlyOperator 上。
 * 把 operator 换成这个多签地址后，任何一次状态改写都需要 threshold 个 owner 同意。
 *
 * ⚠️ 这是给 hackathon 演示用的最小实现，请按它的真实定位使用：
 *   - 代码短到可以整篇读完，零外部依赖 / 无接口引用 / 无代理 / 无可升级性；
 *   - 它**没有经过任何专业审计**，也刻意省掉了 Gnosis Safe 那一整套东西
 *     （EIP-712 离线签名、模块与守卫、批量 nonce、owner 变更的两阶段确认、payload 去重等）。
 *   - 生产环境请直接用经过审计的多签钱包（Safe 等）来接管 operator，不要用这个文件。
 *
 * 有意为之的设计取舍：
 *   - 不按 payload 去重：同一组 (target, value, data) 再 submit 会拿到一个**新的 txId**，
 *     与 Gnosis Safe 的语义一致。防重放靠 txId + `executed` 一次性标志，而不是内容哈希——
 *     内容哈希去重会多存一张表，还会挡住「合法地再调一次同样参数」这类正常操作。
 *   - 不做离线签名：确认必须由 owner 自己发一笔交易，演示够用。
 *   - 换 owner / 改 threshold 没有 owner 直连入口，只能由**多签自己调用自己**
 *     （target == address(this) 的待执行交易），见 onlySelf。
 *   - 目标调用失败时把目标的 revert 数据**原样冒泡**（4 行汇编），而不是统一换成一句
 *     "call failed"：排障时能直接看到目标合约的原始 require 文案（例如
 *     "cumulative must not decrease"）。状态语义不变，整笔交易照旧全部回滚。
 */
contract OperatorMultisig {
    struct Transaction {
        address target;
        uint256 value;
        bytes   data;
        uint256 confirmations;
        bool    executed;
    }

    address[] private _owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;                                        // 通过门槛票数
    uint256 public txCount;                                          // 已登记交易数（txId 从 0 起）
    mapping(uint256 => Transaction) private _txs;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    event Submitted(uint256 indexed txId, address indexed owner, address target, uint256 value, bytes data);
    event Confirmed(uint256 indexed txId, address indexed owner, uint256 confirmations);
    event Revoked(uint256 indexed txId, address indexed owner, uint256 confirmations);
    event Executed(uint256 indexed txId, bytes returnData);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdSet(uint256 threshold);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    /// @dev 治理类函数只有一条路：多签地址调用自己，也就是一笔票数达标的待执行交易。
    modifier onlySelf() {
        require(msg.sender == address(this), "only self");
        _;
    }

    constructor(address[] memory owners_, uint256 threshold_) {
        require(owners_.length > 0, "no owners");
        require(threshold_ >= 1 && threshold_ <= owners_.length, "bad threshold");
        for (uint256 i = 0; i < owners_.length; i++) {
            address o = owners_[i];
            require(o != address(0), "zero owner");
            require(!isOwner[o], "duplicate owner");
            isOwner[o] = true;
            _owners.push(o);
        }
        threshold = threshold_;
    }

    /// @dev 多签要能持有 BOT：被执行时带 value 出去，也接受别人打进来的 gas 补贴。
    receive() external payable {}

    // ==================== 提议 / 确认 / 撤销 / 执行 ====================

    /// @notice 登记一笔待执行交易；提交者自动计 1 票，够票立刻执行。
    function submit(address target, uint256 value, bytes calldata data)
        external onlyOwner returns (uint256 txId)
    {
        require(target != address(0), "zero target");
        txId = txCount++;
        Transaction storage t = _txs[txId];
        t.target = target;
        t.value = value;
        t.data = data;
        emit Submitted(txId, msg.sender, target, value, data);
        _confirm(txId);
    }

    /// @notice 确认一笔待执行交易；票数达到 threshold 时立即执行。
    function confirm(uint256 txId) external onlyOwner {
        _confirm(txId);
    }

    /// @notice 执行前撤回自己的票（票数会减少）；之后可以重新 confirm。
    function revoke(uint256 txId) external onlyOwner {
        Transaction storage t = _requirePending(txId);
        require(isConfirmed[txId][msg.sender], "not confirmed");
        isConfirmed[txId][msg.sender] = false;
        t.confirmations -= 1;
        emit Revoked(txId, msg.sender, t.confirmations);
    }

    /// @notice 票数已够但还没执行时的补触发入口；重复调用不会重复执行。
    function execute(uint256 txId) external onlyOwner {
        _execute(txId);
    }

    function _confirm(uint256 txId) internal {
        Transaction storage t = _requirePending(txId);
        require(!isConfirmed[txId][msg.sender], "already confirmed");
        isConfirmed[txId][msg.sender] = true;
        t.confirmations += 1;
        emit Confirmed(txId, msg.sender, t.confirmations);
        if (t.confirmations >= threshold) _execute(txId);
    }

    function _execute(uint256 txId) internal {
        Transaction storage t = _requirePending(txId);
        require(t.confirmations >= threshold, "not enough confirmations");
        // 先置 executed 再外调：万一目标回头再进来，看到的是「已执行」。
        // 目标 revert 时下面的回滚会把整笔交易（含这个 true 和刚记的那一票）一起回滚 ——
        // 于是「不能标记 executed」和「不能吞掉失败」同时成立。
        t.executed = true;
        (bool ok, bytes memory ret) = t.target.call{value: t.value}(t.data);
        if (!ok) {
            // 原样冒泡目标的 revert 数据（含 require 文案）；目标 revert 时 ret 为空
            // 就变成无数据的 revert，效果同样是整笔回滚。
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        emit Executed(txId, ret);
    }

    /// @dev 交易存在性哨兵：submit 拒绝 target == 0，所以 target == 0 等价于「这笔交易不存在」。
    function _requirePending(uint256 txId) internal view returns (Transaction storage t) {
        t = _txs[txId];
        require(t.target != address(0), "no such tx");
        require(!t.executed, "already executed");
    }

    // ==================== 只读 ====================

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function getTx(uint256 txId)
        external view
        returns (address target, uint256 value, bytes memory data, uint256 confirmations, bool executed)
    {
        Transaction storage t = _txs[txId];
        return (t.target, t.value, t.data, t.confirmations, t.executed);
    }

    // ==================== 治理（只能由多签自己执行）====================

    function setThreshold(uint256 threshold_) external onlySelf {
        require(threshold_ >= 1 && threshold_ <= _owners.length, "bad threshold");
        threshold = threshold_;
        emit ThresholdSet(threshold_);
    }

    function addOwner(address owner_) external onlySelf {
        require(owner_ != address(0), "zero owner");
        require(!isOwner[owner_], "already owner");
        isOwner[owner_] = true;
        _owners.push(owner_);
        emit OwnerAdded(owner_);
    }

    function removeOwner(address owner_) external onlySelf {
        require(isOwner[owner_], "not owner");
        // 去掉一个人之后必须还凑得齐 threshold，否则合约当场永久锁死
        require(_owners.length - 1 >= threshold, "threshold too high");
        isOwner[owner_] = false;
        for (uint256 i = 0; i < _owners.length; i++) {
            if (_owners[i] == owner_) {
                _owners[i] = _owners[_owners.length - 1];
                _owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner_);
    }
}
