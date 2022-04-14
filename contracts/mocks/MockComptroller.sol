// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "../interfaces/IComptroller.sol";

contract MockComptroller is IComptroller {
    function enterMarkets(address[] calldata cTokens)
        external
        pure
        override
        returns (uint256[] memory)
    {
        uint256[] memory result = new uint256[](cTokens.length);
        for (uint256 i = 0; i < cTokens.length; i++) {
            result[i] = 0;
        }
        return result;
    }
}
