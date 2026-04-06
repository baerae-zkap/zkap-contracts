// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {ISenderCreator} from "@account-abstraction/contracts/interfaces/ISenderCreator.sol";

contract SimpleEntryPoint is EntryPoint {
    function getSenderCreator() external view returns (ISenderCreator) {
        return senderCreator();
    }
}
