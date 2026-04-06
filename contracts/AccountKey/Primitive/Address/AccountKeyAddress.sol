// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.34;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../PrimitiveAccountKey.sol";

contract AccountKeyAddress is PrimitiveAccountKey {
    /// @dev ZKAPSC-001: ERC-7562 associated storage compliance: keccak(A||slot) + n (n=0..5)
    /// Stores up to 5 signers per account in consecutive slots
    uint8 public constant MAX_KEYS_PER_ACCOUNT = 5;

    struct SignerSlots {
        address[MAX_KEYS_PER_ACCOUNT] signers;  // +0 ~ +4
        uint8 count;         // +5
    }
    /// @dev Independent storage for Master/Tx (prevents slot exhaustion when reusing the same singleton)
    mapping(address => SignerSlots) private _masterSignerSlots;
    mapping(address => SignerSlots) private _txSignerSlots;

    error SignerCannotBeZeroAddress();
    error MaxKeysExceeded();

    event AccountKeyAddressRegistered(address indexed account, uint256 indexed keyId, address signer);

    /// @dev Returns storage for the given purpose
    function _getSlots(KeyPurpose purpose, address account) internal view returns (SignerSlots storage) {
        if (purpose == KeyPurpose.Master) return _masterSignerSlots[account];
        return _txSignerSlots[account];
    }

    function register(
        KeyPurpose purpose,
        bytes calldata initData
    ) external override returns (uint256 keyId) {
        address signer = abi.decode(initData, (address));
        if (signer == address(0)) revert SignerCannotBeZeroAddress();

        SignerSlots storage slots = _getSlots(purpose, msg.sender);
        if (slots.count >= MAX_KEYS_PER_ACCOUNT) revert MaxKeysExceeded();

        keyId = slots.count;
        slots.signers[keyId] = signer;
        slots.count++;

        emit AccountKeyAddressRegistered(msg.sender, keyId, signer);
    }

    /// @inheritdoc IAccountKey
    function resetKeys(KeyPurpose purpose) external override {
        if (purpose == KeyPurpose.Master) {
            delete _masterSignerSlots[msg.sender];
        } else {
            delete _txSignerSlots[msg.sender];
        }
    }

    // pure functions
    function keyType()
        external
        pure
        override
        returns (IPrimitiveAccountKey.KeyType)
    {
        return KeyType.keyAddress;
    }

    /// @notice Validates a signature using the registered ECDSA signer
    /// @param purpose Key purpose (Master or Tx)
    /// @param keyId Key slot index (return value from register, 0~4)
    /// @param sig ECDSA signature
    /// @param msgHash Hash of the message to be signed
    /// @return Whether the signature is valid
    function validate(
        KeyPurpose purpose,
        uint256 keyId,
        bytes calldata sig,
        uint256 msgHash
    ) external view override returns (bool) {
        SignerSlots storage slots = _getSlots(purpose, msg.sender);
        if (keyId >= slots.count) return false;
        address stored = slots.signers[keyId];
        if (stored == address(0)) return false;
        address recovered = ECDSA.recover(bytes32(msgHash), sig);
        return recovered != address(0) && stored == recovered;
    }

    /// @notice Returns the registered signer address for an account
    /// @param purpose Key purpose (Master or Tx)
    /// @param account Account address to query
    /// @param keyId Key slot index (0~4)
    /// @return Registered signer address
    function getSigner(KeyPurpose purpose, address account, uint256 keyId) external view returns (address) {
        SignerSlots storage slots = _getSlots(purpose, account);
        if (keyId >= slots.count) return address(0);
        return slots.signers[keyId];
    }
}
