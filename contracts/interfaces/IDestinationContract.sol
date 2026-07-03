// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./OnChainData.sol";

interface IDestinationContract {
    function portMessage(
        address sender,
        OnChainData memory data,
        string memory _startChain
    ) external;
}

