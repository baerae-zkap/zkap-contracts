// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.34;

import "@openzeppelin/contracts/utils/cryptography/P256.sol";
import "../../PrimitiveAccountKey.sol";

contract AccountKeySecp256r1 is PrimitiveAccountKey {
    bytes32 private constant _SECP256R1_N =
        bytes32(uint256(0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551));
    bytes32 private constant _SECP256R1_HALF_N =
        bytes32(uint256(0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8));

    struct Key {
        bytes32 x;
        bytes32 y;
    }

    /// @dev ZKAPSC-001: ERC-7562 associated storage compliance: keccak(A||slot) + n (n=0..10)
    /// Stores up to 5 keys per account in consecutive slots (2 slots per Key × 5 + count 1)
    uint8 public constant MAX_KEYS_PER_ACCOUNT = 5;

    struct KeySlots {
        Key[MAX_KEYS_PER_ACCOUNT] keys;    // +0 ~ +9 (each Key occupies 2 slots: x, y)
        uint8 count;    // +10
    }
    /// @dev Independent storage for Master/Tx (prevents slot exhaustion when reusing the same singleton)
    mapping(address => KeySlots) private _masterKeySlots;
    mapping(address => KeySlots) private _txKeySlots;

    error InvalidKeyData();
    error InvalidSignatureLength();
    error MaxKeysExceeded();
    error InvalidSValue();

    event AccountKeySecp256r1Registered(address indexed account, uint256 indexed keyId, Key _registeredKey);

    /// @dev Returns storage for the given purpose
    function _getSlots(KeyPurpose purpose, address account) internal view returns (KeySlots storage) {
        if (purpose == KeyPurpose.Master) return _masterKeySlots[account];
        return _txKeySlots[account];
    }

    function register(
        KeyPurpose purpose,
        bytes calldata initData
    ) external override returns (uint256 keyId) {
        Key memory registeredKey = abi.decode(initData, (Key));
        if (registeredKey.x == bytes32(0) || registeredKey.y == bytes32(0)) revert InvalidKeyData();

        KeySlots storage slots = _getSlots(purpose, msg.sender);
        if (slots.count >= MAX_KEYS_PER_ACCOUNT) revert MaxKeysExceeded();

        keyId = slots.count;
        slots.keys[keyId] = registeredKey;
        slots.count++;

        emit AccountKeySecp256r1Registered(msg.sender, keyId, registeredKey);
    }

    /// @inheritdoc IAccountKey
    function resetKeys(KeyPurpose purpose) external override {
        if (purpose == KeyPurpose.Master) {
            delete _masterKeySlots[msg.sender];
        } else {
            delete _txKeySlots[msg.sender];
        }
    }

    /// @notice Validates a signature using the registered secp256r1 public key
    /// @param purpose Key purpose (Master or Tx)
    /// @param keyId Key slot index (return value from register, 0~4)
    /// @param sig ABI-encoded (bytes32 r, bytes32 s)
    /// @param msgHash Hash of the message to be signed
    /// @return Whether the signature is valid
    function validate(
        KeyPurpose purpose,
        uint256 keyId,
        bytes calldata sig,
        uint256 msgHash
    ) external view override returns (bool) {
        KeySlots storage slots = _getSlots(purpose, msg.sender);
        if (keyId >= slots.count) return false;
        Key storage k = slots.keys[keyId];
        /* istanbul ignore next */
        if (k.x == bytes32(0) || k.y == bytes32(0)) return false;
        if (sig.length != 64) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        (r, s) = abi.decode(sig, (bytes32, bytes32));

        if (uint256(s) >= uint256(_SECP256R1_N)) revert InvalidSValue();
        if (uint256(s) > uint256(_SECP256R1_HALF_N)) revert InvalidSValue();

        return P256.verify(bytes32(msgHash), r, s, k.x, k.y);
    }

    function keyType()
        external
        pure
        override
        returns (IPrimitiveAccountKey.KeyType)
    {
        return KeyType.keySecp256r1;
    }

    /// @notice Returns the registered secp256r1 public key coordinates for an account
    /// @param purpose Key purpose (Master or Tx)
    /// @param account Account address to query
    /// @param keyId Key slot index (0~4)
    /// @return x Public key x coordinate
    /// @return y Public key y coordinate
    function getKey(KeyPurpose purpose, address account, uint256 keyId) external view returns (bytes32, bytes32) {
        KeySlots storage slots = _getSlots(purpose, account);
        if (keyId >= slots.count) return (bytes32(0), bytes32(0));
        Key storage k = slots.keys[keyId];
        return (k.x, k.y);
    }
}
