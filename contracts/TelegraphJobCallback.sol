// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// Mirror of the protocol's OnChainData parameter struct (interfaces/OnChainData.sol).
struct OnChainData {
    address[] addresses;
    uint256[] integers;
    string[] strings;
    bool[] bools;
}

/// @title TelegraphJobCallback
/// @notice Minimal ERC-8183 receiver: the Telegraph Diamond calls
///         `subnetMessage` after validators finalize a job. This contract
///         stores every result so the outcome is queryable on-chain forever.
contract TelegraphJobCallback {
    address public immutable diamond;

    struct StoredResult {
        bool received;
        bool success;
        string firstString;   // e.g. the LLM reply
        string errorMessage;
        uint256 receivedAt;
    }

    mapping(uint256 => StoredResult) public results;
    uint256[] public jobIds;

    event ResultReceived(uint256 indexed jobId, bool success, string firstString, string errorMessage);

    constructor(address _diamond) {
        diamond = _diamond;
    }

    /// Called by the protocol (name is legacy — it delivers a miner's result).
    function subnetMessage(
        uint256 jobId,
        bool success,
        OnChainData memory response,
        string memory errorMessage
    ) external {
        require(msg.sender == diamond, "only Telegraph Diamond");
        string memory first = response.strings.length > 0 ? response.strings[0] : "";
        results[jobId] = StoredResult(true, success, first, errorMessage, block.timestamp);
        jobIds.push(jobId);
        emit ResultReceived(jobId, success, first, errorMessage);
    }

    function receivedCount() external view returns (uint256) {
        return jobIds.length;
    }
}
