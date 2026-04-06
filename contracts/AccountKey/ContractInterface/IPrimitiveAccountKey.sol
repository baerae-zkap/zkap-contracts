// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "./IAccountKey.sol";

interface IPrimitiveAccountKey is IAccountKey {
    enum KeyType {
        keyNone,
        keyAddress,
        keySecp256k1,
        keySecp256r1,
        keyWebAuthn,
        keyOAuthRS256,
        keyZkOAuthRS256
    }

    function keyType() external pure returns (KeyType);
}
