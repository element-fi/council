// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.3;

interface IComptroller {
    function enterMarkets(address[] calldata cTokens)
        external
        returns (uint256[] memory);
}
