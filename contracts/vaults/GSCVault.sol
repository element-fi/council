// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.3;

import "../interfaces/ICoreVoting.sol";
import "../interfaces/IVotingVault.sol";
import "../libraries/Authorizable.sol";

// This vault allows someone to gain one vote on the GSC and tracks that status through time
// it will be a voting vault of the gsc voting contract
// It is not going to be an upgradable proxy since only a few users use it and it doesn't have
// high migration overhead. It also won't have full historical tracking which will cause
// GSC votes to behave differently than others. Namely, anyone who is a member at any point
// in the voting period can vote.

contract GSCVault is Authorizable {
    // Tracks which people are in the GSC and which vaults they use
    mapping(address => address[]) public memberVaults;
    // The core voting contract with approved voting vaults
    ICoreVoting public coreVoting;
    // The amount of votes needed to be on the GSC
    uint256 public votingPowerBound;
    // The challenge duration
    uint256 public challengeDuration = 1330;

    // Event to help tracking members
    event MembershipProved(address indexed who, uint256 when);
    // Event to help tracking kicks
    event Kicked(address indexed who, uint256 when);

    /// @notice constructs this contract and initial vars
    /// @param _coreVoting The core voting contract
    /// @param _votingPowerBound The first voting power bound
    /// @param _owner The owner of this contract, should be the timelock contract
    constructor(
        ICoreVoting _coreVoting,
        uint256 _votingPowerBound,
        address _owner
    ) {
        // Set the state variables
        coreVoting = _coreVoting;
        votingPowerBound = _votingPowerBound;
        // Set the owner
        setOwner(address(_owner));
    }

    /// @notice Called to prove membership in the GSC
    /// @param votingVaults The contracts this person has their voting power in
    function proveMembership(address[] calldata votingVaults) external {
        // Check for call validity
        assert(votingVaults.length > 0);
        // We loop through the voting vaults to check they are authorized
        // We check all up front to prevent any reentrancy or weird side effects
        for (uint256 i = 0; i < votingVaults.length; i++) {
            // Call the mapping the core voting contract to check that
            // the provided address is in fact approved.
            // Note - Post Berlin hardfork this repeated access is quite cheap.
            bool vaultStatus = coreVoting.approvedVaults(votingVaults[i]);
            require(vaultStatus, "Voting vault not approved");
        }
        // Now we tally the caller's voting power
        uint256 totalVotes = 0;
        // Parse through the list of vaults
        for (uint256 i = 0; i < votingVaults.length; i++) {
            // Call the vault to check last block's voting power
            // Last block to ensure there's no flash loan or other
            // intra contract interaction
            uint256 votes =
                IVotingVault(votingVaults[i]).queryVotePower(
                    msg.sender,
                    block.number - 1
                );
            // Add up the votes
            totalVotes += votes;
        }
        // Require that the caller has proven that they have enough votes
        require(totalVotes >= votingPowerBound, "Not enough votes");
        // If that passes we store that the caller is a member
        // This storage will wipe out that the caller has been challenged
        memberVaults[msg.sender] = votingVaults;
        // Emit the event tracking this
        emit MembershipProved(msg.sender, block.timestamp);
    }

    /// @notice Removes a GSC member who's registered vaults no longer contain enough votes
    /// @param who The address to challenge.
    function kick(address who) external {
        // Load the vaults into memory
        address[] memory votingVaults = memberVaults[who];
        // We verify that they have lost sufficient voting power to be kicked
        uint256 totalVotes = 0;
        // Parse through the list of vaults
        for (uint256 i = 0; i < votingVaults.length; i++) {
            // If the vault is not approved we don't count its votes now
            if (coreVoting.approvedVaults(votingVaults[i])) {
                // Call the vault to check last block's voting power
                // Last block to ensure there's no flash loan or other
                // intra contract interaction
                uint256 votes =
                    IVotingVault(votingVaults[i]).queryVotePower(
                        who,
                        block.number - 1
                    );
                // Add up the votes
                totalVotes += votes;
            }
        }
        // Only proceed if the member is currently kick-able
        require(totalVotes < votingPowerBound, "Not kick-able");
        // Delete the member
        delete memberVaults[who];
        // Emit a challenge event
        emit Kicked(who, block.number);
    }

    /// @notice Queries voting power, GSC members get one vote and the owner gets 100k
    /// @param who Which address to query
    /// @dev Because this function ignores the when variable it creates a unique voting system
    ///      and should not be plugged in with truly historic ones.
    function queryVotingPower(address who, uint256)
        public
        view
        returns (uint256)
    {
        // If the address queried is the owner they get a huge number of votes
        // This allows the primary governance timelock to take any action the GSC
        // can make or block any action the GSC can make. But takes as many votes as
        // a protocol upgrade.
        if (who == owner) {
            return 100000;
        }
        // If the who is in the GSC return 1 and otherwise return 0
        if (memberVaults[who].length > 0) {
            return 1;
        } else {
            return 0;
        }
    }

    /// Functions to allow gov to reset the state vars

    /// @notice Sets the core voting contract
    /// @param _newVoting The new core voting contract
    function setCoreVoting(ICoreVoting _newVoting) external onlyOwner() {
        coreVoting = _newVoting;
    }

    /// @notice Sets the vote power bound
    /// @param _newBound The new vote power bound
    function setVotePowerBound(uint256 _newBound) external onlyOwner() {
        votingPowerBound = _newBound;
    }

    /// @notice Sets the vote power bound
    /// @param _newDuration The new challenge duration
    function setChallengeDuration(uint256 _newDuration) external onlyOwner() {
        challengeDuration = _newDuration;
    }
}