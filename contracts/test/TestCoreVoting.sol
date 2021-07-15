pragma solidity ^0.8.0;

import "../CoreVoting.sol";

contract TestCoreVoting is CoreVoting {
    // public dummy value used to test calldata calls
    uint256 public dummyValue;

    constructor(
        address _timelock,
        uint256 _baseQuorum,
        uint256 _lockDuration,
        uint256 _minProposalPower,
        address _gsc,
        address[] memory votingVaults
    )
        CoreVoting(
            _timelock,
            _baseQuorum,
            _lockDuration,
            _minProposalPower,
            _gsc,
            votingVaults
        )
    {}

    function getProposalData(uint256 _proposalID)
        public
        view
        returns (
            bytes32,
            uint128,
            uint128,
            uint128,
            uint128[3] memory,
            bool
        )
    {
        return (
            proposals[_proposalID].proposalHash,
            proposals[_proposalID].created,
            proposals[_proposalID].unlock,
            proposals[_proposalID].quorum,
            proposals[_proposalID].votingPower,
            proposals[_proposalID].active
        );
    }

    function updateDummy(uint256 _newValue) public {
        dummyValue = _newValue;
    }
}
