// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/**
 * @title OnChainData
 * @notice Struct for passing data between contracts
 */
struct OnChainData {
    address[] addresses;
    uint256[] integers;
    string[] strings;
    bool[] bools;
}

