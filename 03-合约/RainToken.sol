// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * RainToken —— 雨证的**模拟计价单位**（ERC-20，2026-10-25）
 *
 * 定位：1 个 RainDrop = 1 元人民币（演示口径）；decimals = 2 ⇒ 最小单位 = 1 分。
 *      保费、赔款、资金池全部以「分」记账：满额赔付 10000 = 100.00 元，保费 110 = 1.10 元。
 * ⚠️  这是**演示/教学代币**：不众筹、不交易、不锚定真实法币、不在任何交易所流通；
 *      铸造权在 owner（= 合约部署者），只为给演示地址发放模拟资金。
 * 血缘：仓库手写传统（不引 OpenZeppelin），接口与 ERC-20 标准对齐。
 */
contract RainToken {

    string  public constant name     = "RainDrop - simulated CNY unit (1:1, demo only)";
    string  public constant symbol   = "RDROP";
    uint8   public constant decimals = 2;              // 1 token = 100 raw；1 raw = 1 分

    address public owner;

    uint256 public totalSupply;
    mapping(address => uint256)                      public balanceOf;
    mapping(address => mapping(address => uint256))  public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed tokenOwner, address indexed spender, uint256 value);
    event Minted(address indexed to, uint256 value);
    event OwnerChanged(address indexed from, address indexed to);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor() { owner = msg.sender; }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "insufficient allowance");
        // 无限授权（type(uint256).max）不扣减，便于演示脚本反复用
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _move(from, to, value);
        return true;
    }

    /// @notice 只给演示地址发模拟资金（分）。永不回收——账目可对。
    function mint(address to, uint256 value) external onlyOwner returns (bool) {
        require(to != address(0), "zero address");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
        emit Minted(to, value);
        return true;
    }

    function transferOwner(address next) external onlyOwner {
        require(next != address(0), "zero address");
        emit OwnerChanged(owner, next);
        owner = next;
    }

    function _move(address from, address to, uint256 value) internal {
        require(to != address(0), "zero address");
        uint256 b = balanceOf[from];
        require(b >= value, "insufficient balance");
        balanceOf[from] = b - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
