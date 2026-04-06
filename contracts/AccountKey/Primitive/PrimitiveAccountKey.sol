// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "./AccountKey.sol";
import "../ContractInterface/IPrimitiveAccountKey.sol";

abstract contract PrimitiveAccountKey is AccountKey, IPrimitiveAccountKey {}
