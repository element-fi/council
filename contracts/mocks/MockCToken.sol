// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;
import "./MockERC20.sol";
import "../interfaces/ICToken.sol";
import "../interfaces/IERC20.sol";

contract MockCToken is ICToken, MockERC20 {
    // MockERC20 has 18 decimal places
    // Assume 2 cTokens are equivalent to 1 underlying
    uint256 public exchangeRate = 5 * 10**(10 + 18 - 1);
    uint256 public borrowRate = 44388081445;

    address public underlying;

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        address underlying_
    ) MockERC20(name_, symbol_, owner_) {
        underlying = underlying_;
    }

    function balanceOfUnderlying(address account)
        external
        view
        override
        returns (uint256)
    {
        return (balanceOf[account] * exchangeRate) / (10**28);
    }

    function borrowRatePerBlock() external view override returns (uint256) {
        // Let's say we want 10% annual borrow rate
        // This is (0.1 * 10^18) / (num blocks a year)
        return borrowRate;
    }

    function setBorrowRate(uint256 value) external {
        borrowRate = value;
    }

    function exchangeRateCurrent() external view override returns (uint256) {
        return exchangeRate;
    }

    function mint(uint256 mintAmount) external override returns (uint256) {
        IERC20(underlying).transferFrom(msg.sender, address(this), mintAmount);
        // Assumes that 2 cTokens are 1 underlying
        _mint(msg.sender, mintAmount * 2);
        return 0;
    }

    function redeem(uint256 redeemTokens) external override returns (uint256) {
        balanceOf[msg.sender] -= redeemTokens;
        uint256 underlyingToTransfer = redeemTokens / 2;
        IERC20(underlying).transfer(msg.sender, underlyingToTransfer);
        return 0;
    }
}
