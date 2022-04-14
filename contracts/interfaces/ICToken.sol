// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.3;
import "./IERC20.sol";

interface ICToken is IERC20 {
    function mint(uint256 mintAmount) external returns (uint256);

    function redeem(uint256 redeemTokens) external returns (uint256);

    function exchangeRateCurrent() external returns (uint256);

    function borrowRatePerBlock() external returns (uint256);

    function balanceOfUnderlying(address account) external returns (uint256);
}
