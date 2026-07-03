// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./interfaces/IDestinationContract.sol";
import "./interfaces/OnChainData.sol";

/// @notice Simple destination contract used in local cross-chain bridge tests.
/// Stores the last received data so scripts can verify delivery on the destination chain.
contract BridgeReceiverTestApp is IDestinationContract {
    address public lastSender;
    string public lastStartChain;
    uint256 public callCount;

    address[] public lastAddresses;
    uint256[] public lastIntegers;
    string[] public lastStrings;
    bool[] public lastBools;

    event BridgeMessageReceived(
        address indexed sender,
        string startChain
    );

    function portMessage(
        address sender,
        OnChainData calldata data,
        string calldata _startChain
    ) external override {
        lastSender = sender;
        lastStartChain = _startChain;
        callCount++;

        // Copy arrays element-by-element to avoid calldata-to-storage copy issue
        uint256 addrLen = data.addresses.length;
        delete lastAddresses;
        for (uint256 i = 0; i < addrLen; i++) {
            lastAddresses.push(data.addresses[i]);
        }

        uint256 intLen = data.integers.length;
        delete lastIntegers;
        for (uint256 i = 0; i < intLen; i++) {
            lastIntegers.push(data.integers[i]);
        }

        uint256 strLen = data.strings.length;
        delete lastStrings;
        for (uint256 i = 0; i < strLen; i++) {
            lastStrings.push(data.strings[i]);
        }

        uint256 boolLen = data.bools.length;
        delete lastBools;
        for (uint256 i = 0; i < boolLen; i++) {
            lastBools.push(data.bools[i]);
        }

        emit BridgeMessageReceived(sender, _startChain);
    }
}

