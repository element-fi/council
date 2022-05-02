// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "./libraries/Authorizable.sol";
import "./interfaces/ICoreVoting.sol";
import "./interfaces/IVotingVault.sol";

contract BalanceQuery is Authorizable {
    // stores approved voting vaults
    IVotingVault[] public vaults;

    /// @notice Constructs this contract and stores needed data
    /// @param _owner The contract owner authorized to remove vaults
    /// @param votingVaults An array of the vaults to query balances from
    constructor(address _owner, address[] memory votingVaults) {
        // create a new array of voting vaults
        vaults = new IVotingVault[](votingVaults.length);
        // populate array with each vault passed into constructor
        for (uint256 i = 0; i < votingVaults.length; i++) {
            vaults[i] = IVotingVault(votingVaults[i]);
        }

        // authorize the owner address to be able to add/remove vaults
        _authorize(_owner);
    }

    /// @notice Queries and adds together the vault balances for specified user
    /// @param user The user to query balances for
    /// @return The total voting power for the user
    function balanceOfVaults(address user) external returns (uint256) {
        uint256 votingPower = 0;
        // query voting power from each vault and add to total
        for (uint256 i = 0; i < vaults.length; i++) {
            votingPower =
                votingPower +
                vaults[i].queryVotePower(user, block.number - 1, "0x");
        }
        // return that balance
        return votingPower;
    }

    /// @notice Updates the storage variable for vaults to query
    /// @param _vaults An array of the new vaults to store
    function updateVaults(address[] memory _vaults) external onlyAuthorized {
        // reset our array in storage
        vaults = new IVotingVault[](_vaults.length);

        // populate with each vault passed into the method
        for (uint256 i = 0; i < _vaults.length; i++) {
            vaults[i] = IVotingVault(_vaults[i]);
        }
    }
}
