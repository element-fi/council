// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.3;

library CompoundVaultStorage {
    struct twarSnapshot {
        uint256 cumulativeRate; // cumulative rate of borrow rate at time of struct creation
        uint256 timestamp; // timestamp this struct was created
    }

    /**
     * @notice returns storage pointer for an array with the given name
     * @param name name of the array
     * @return data the array pointer
     */
    function arrayPtr(string memory name)
        internal
        pure
        returns (twarSnapshot[] storage data)
    {
        bytes32 typehash = keccak256("twarSnapshot[]");
        bytes32 offset = keccak256(abi.encodePacked(typehash, name));
        assembly {
            data.slot := offset
        }
    }
}
