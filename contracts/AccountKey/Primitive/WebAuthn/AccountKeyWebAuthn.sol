// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.34;

import "@openzeppelin/contracts/utils/cryptography/P256.sol";
import "../PrimitiveAccountKey.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

contract AccountKeyWebAuthn is PrimitiveAccountKey {
    error SignatureTooShort();
    error SignatureTooLong();
    error InvalidRLength();
    error SignatureTruncatedAtSLength();
    error InvalidSLength();
    error SignatureTruncatedAtSValue();
    error InvalidKeyData();
    error InvalidOrigin();
    error InvalidRpId();
    error MaxKeysExceeded();
    error InvalidWebAuthnType();
    error UserPresenceRequired();
    error UserVerificationRequired();
    error InvalidSValue();
    error InvalidChallenge();
    error AuthDataTooShort();

    struct Key {
        bytes32 x;
        bytes32 y;
        string credentialId;
    }

    /// @dev Contains only data accessed during the validation phase (ERC-7562 contiguous slots)
    struct ValidationEntry {
        bytes32 x;             // +0
        bytes32 y;             // +1
        bytes32 allowedOrigin; // +2
        bytes32 allowedRpId;   // +3
        bool requireUV;        // +4
    }

    /// @dev ZKAPSC-001: Complies with ERC-7562 associated storage: keccak(A||slot) + n
    /// Maximum 5 keys per account (ValidationEntry 5 slots x 5 + count 1)
    uint8 public constant MAX_KEYS_PER_ACCOUNT = 5;

    struct ValidationSlots {
        ValidationEntry[MAX_KEYS_PER_ACCOUNT] entries; // +0 ~ +24
        uint8 count;                // +25
    }
    /// @dev Independent storage for Master/Tx (prevents slot exhaustion when reusing the same singleton)
    mapping(address => ValidationSlots) private _masterValidationSlots;
    mapping(address => ValidationSlots) private _txValidationSlots;

    /// @dev credentialId is not accessed during the validation phase -> not subject to ERC-7562
    mapping(address => mapping(uint256 => string)) private _masterCredentialIds;
    mapping(address => mapping(uint256 => string)) private _txCredentialIds;

    event AccountKeyWebAuthnRegistered(address indexed account, uint256 indexed keyId, Key _key);

    bytes32 private constant _SECP256R1_N =
        bytes32(uint256(0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551));
    bytes32 private constant _SECP256R1_HALF_N =
        bytes32(uint256(0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8));

    /// @dev Returns the ValidationSlots for the given purpose
    function _getSlots(KeyPurpose purpose, address account) internal view returns (ValidationSlots storage) {
        if (purpose == KeyPurpose.Master) return _masterValidationSlots[account];
        return _txValidationSlots[account];
    }

    /// @dev Returns the credentialIds mapping for the given purpose (for writing)
    function _setCredentialId(KeyPurpose purpose, address account, uint256 keyId, string memory credId) internal {
        if (purpose == KeyPurpose.Master) {
            _masterCredentialIds[account][keyId] = credId;
        } else {
            _txCredentialIds[account][keyId] = credId;
        }
    }

    /// @dev Returns the credentialIds mapping for the given purpose (for reading)
    function _getCredentialId(KeyPurpose purpose, address account, uint256 keyId) internal view returns (string memory) {
        if (purpose == KeyPurpose.Master) return _masterCredentialIds[account][keyId];
        return _txCredentialIds[account][keyId];
    }

    function register(
        KeyPurpose purpose,
        bytes calldata initData
    ) external override returns (uint256 keyId) {
        (bytes memory encoded, bytes32 rpIdHash, bytes memory origin, bool requireUV) = abi.decode(
            initData,
            (bytes, bytes32, bytes, bool)
        );
        Key memory _key = abi.decode(encoded, (Key));
        if (_key.x == bytes32(0) || _key.y == bytes32(0)) revert InvalidKeyData();

        ValidationSlots storage slots = _getSlots(purpose, msg.sender);
        if (slots.count >= MAX_KEYS_PER_ACCOUNT) revert MaxKeysExceeded();

        keyId = slots.count;
        slots.entries[keyId] = ValidationEntry({
            x: _key.x,
            y: _key.y,
            allowedOrigin: keccak256(origin),
            allowedRpId: rpIdHash,
            requireUV: requireUV
        });
        _setCredentialId(purpose, msg.sender, keyId, _key.credentialId);
        slots.count++;

        emit AccountKeyWebAuthnRegistered(msg.sender, keyId, _key);
    }

    /// @inheritdoc IAccountKey
    function resetKeys(KeyPurpose purpose) external override {
        ValidationSlots storage slots = _getSlots(purpose, msg.sender);
        uint8 count = slots.count;
        if (purpose == KeyPurpose.Master) {
            for (uint256 i = 0; i < count; ++i) {
                delete _masterCredentialIds[msg.sender][i];
            }
            delete _masterValidationSlots[msg.sender];
        } else {
            for (uint256 i = 0; i < count; ++i) {
                delete _txCredentialIds[msg.sender][i];
            }
            delete _txValidationSlots[msg.sender];
        }
    }

    function extractSignature(
        bytes memory sig
    ) internal pure returns (bytes32 r, bytes32 s) {
        // DER signature format validation
        // Minimum length: 8 bytes (2 header + 2 r header + 1 r + 2 s header + 1 s)
        // solhint-disable-next-line gas-strict-inequalities
        if (sig.length < 8) revert SignatureTooShort();
        // solhint-disable-next-line gas-strict-inequalities
        if (sig.length > 72) revert SignatureTooLong(); // Max DER signature length

        uint8 rLength = uint8(sig[3]);
        // solhint-disable-next-line gas-strict-inequalities
        if (rLength < 32 || rLength > 33) revert InvalidRLength();

        uint8 rStart = 4 + rLength - 32;
        uint8 rEnd = rStart + 32;

        // solhint-disable-next-line gas-strict-inequalities
        if (sig.length <= rEnd + 1) revert SignatureTruncatedAtSLength();
        uint8 sLength = uint8(sig[rEnd + 1]);
        // solhint-disable-next-line gas-strict-inequalities
        if (sLength < 32 || sLength > 33) revert InvalidSLength();

        uint8 sStart = rEnd + 2 + sLength - 32;
        // solhint-disable-next-line gas-strict-inequalities
        if (sig.length < sStart + 32) revert SignatureTruncatedAtSValue();

        assembly {
            r := mload(add(add(sig, 0x20), rStart))
            s := mload(add(add(sig, 0x20), sStart))
        }
    }

    /// @dev Checks whether data[startIdx..startIdx+len] matches expected
    function _bytesEqualAt(
        bytes memory data,
        uint256 startIdx,
        bytes memory expected
    ) internal pure returns (bool) {
        uint256 len = expected.length;
        if (startIdx + len > data.length) return false;
        for (uint256 i; i < len; ) {
            if (data[startIdx + i] != expected[i]) return false;
            unchecked { ++i; }
        }
        return true;
    }

    /// @notice Validates a signature using a registered WebAuthn key
    /// @param purpose Key purpose (Master or Tx)
    /// @param keyId Key slot index (return value of register, 0~4)
    /// @param sig ABI-encoded (authData, clientJson, signature, typeIndex, challengeIndex, originIndex, originLength)
    /// @param msgHash Message hash to be verified
    /// @return Whether the signature is valid
    // solhint-disable-next-line function-max-lines
    function validate(
        KeyPurpose purpose,
        uint256 keyId,
        bytes calldata sig,
        uint256 msgHash
    ) external view override returns (bool) {
        ValidationSlots storage slots = _getSlots(purpose, msg.sender);
        if (keyId >= slots.count) return false;
        ValidationEntry storage d = slots.entries[keyId];
        bytes32 kx = d.x;
        bytes32 ky = d.y;
        /* istanbul ignore next */
        if (kx == bytes32(0) || ky == bytes32(0)) return false;

        bytes memory authData;
        bytes memory clientJson;
        bytes memory signature;
        uint256 typeIndex;
        uint256 challengeIndex;
        uint256 originIndex;
        uint256 originLength;
        (authData, clientJson, signature, typeIndex, challengeIndex, originIndex, originLength) = abi.decode(
            sig,
            (bytes, bytes, bytes, uint256, uint256, uint256, uint256)
        );

        // Minimum authData length: rpIdHash(32) + flags(1) + signCount(4) = 37
        if (authData.length < 37) revert AuthDataTooShort();

        // WebAuthn type validation: verify presence of prefix '"type":"' then compare value
        {
            // solhint-disable-next-line quotes
            bytes memory typeKey = bytes('"type":"');
            if (typeIndex < typeKey.length) revert InvalidWebAuthnType();
            if (!_bytesEqualAt(clientJson, typeIndex - typeKey.length, typeKey)) revert InvalidWebAuthnType();
            if (!_bytesEqualAt(clientJson, typeIndex, bytes("webauthn.get"))) revert InvalidWebAuthnType();
        }

        // Challenge validation: verify presence of prefix '"challenge":"' then compare Base64URL value
        {
            // solhint-disable-next-line quotes
            bytes memory challengeKey = bytes('"challenge":"');
            if (challengeIndex < challengeKey.length) revert InvalidChallenge();
            if (!_bytesEqualAt(clientJson, challengeIndex - challengeKey.length, challengeKey)) revert InvalidChallenge();
            bytes memory expectedChallenge = bytes(Base64.encodeURL(abi.encodePacked(bytes32(msgHash))));
            if (!_bytesEqualAt(clientJson, challengeIndex, expectedChallenge)) revert InvalidChallenge();
        }

        // Origin validation: verify prefix '"origin":"' + bounds check + keccak256 comparison
        {
            // solhint-disable-next-line quotes
            bytes memory originKey = bytes('"origin":"');
            if (originIndex < originKey.length) revert InvalidOrigin();
            if (originIndex + originLength > clientJson.length) revert InvalidOrigin();
            if (!_bytesEqualAt(clientJson, originIndex - originKey.length, originKey)) revert InvalidOrigin();
            bytes32 originHash;
            assembly {
                originHash := keccak256(add(add(clientJson, 0x20), originIndex), originLength)
            }
            if (d.allowedOrigin != originHash) revert InvalidOrigin();
        }

        // authData = rpIdHash(32 bytes) + flags(1 byte) + signCount(4 bytes) + ...
        bytes32 rpIdHash = bytes32(authData);
        if (d.allowedRpId != rpIdHash) revert InvalidRpId();

        // UP flag validation (User Presence, bit 0) - always required
        if ((uint8(authData[32]) & 0x01) != 0x01) revert UserPresenceRequired();

        // UV flag validation (User Verification, bit 2) - only when requireUV is set
        if (d.requireUV && (uint8(authData[32]) & 0x04) != 0x04) revert UserVerificationRequired();

        // claim3. webAuthnHash = sha256(authData | sha256(clientJson))
        bytes32 webAuthnHash = sha256(
            abi.encodePacked(authData, sha256(clientJson))
        );
        // rawSignature = extractSignature(signature)
        bytes32 r;
        bytes32 s;
        (r, s) = extractSignature(signature);

        // Enforce lower-S: reject high-S signatures
        if (uint256(s) >= uint256(_SECP256R1_N)) revert InvalidSValue();
        if (uint256(s) > uint256(_SECP256R1_HALF_N)) revert InvalidSValue();

        // rawSignature == sign(msgHash, key)
        return P256.verify(webAuthnHash, r, s, kx, ky);
    }

    function keyType()
        external
        pure
        override
        returns (IPrimitiveAccountKey.KeyType)
    {
        return KeyType.keyWebAuthn;
    }

    /// @notice Retrieves the WebAuthn key data registered for an account
    /// @param purpose Key purpose (Master or Tx)
    /// @param account Address of the account to query
    /// @param keyId Key slot index (0~4)
    /// @return x Public key x coordinate
    /// @return y Public key y coordinate
    /// @return credentialId WebAuthn credential ID
    /// @return allowedOriginHash Hash of the allowed origin
    /// @return allowedRpIdHash Hash of the allowed RP ID
    function getKeyData(KeyPurpose purpose, address account, uint256 keyId) external view returns (bytes32 x, bytes32 y, string memory credentialId, bytes32 allowedOriginHash, bytes32 allowedRpIdHash) {
        ValidationSlots storage slots = _getSlots(purpose, account);
        if (keyId >= slots.count) return (bytes32(0), bytes32(0), "", bytes32(0), bytes32(0));
        ValidationEntry storage d = slots.entries[keyId];
        return (d.x, d.y, _getCredentialId(purpose, account, keyId), d.allowedOrigin, d.allowedRpId);
    }
}
