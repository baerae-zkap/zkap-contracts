// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

interface IAccountKey {
    /// @notice Distinguishes key purpose (master / tx independent storage)
    enum KeyPurpose { Master, Tx }

    function register(
        KeyPurpose purpose,
        bytes calldata initData
    ) external returns (uint256 keyId);

    /// @notice Validates a signature using the registered key
    /// @param purpose Key purpose (Master or Tx)
    /// @param keyId Key slot index (return value from register)
    /// @param sig Signature data
    /// @param msgHash Hash of the message to be signed
    /// @return Whether the signature is valid
    function validate(
        KeyPurpose purpose,
        uint256 keyId,
        bytes calldata sig,
        uint256 msgHash
    ) external view returns (bool);

    /// @notice Resets all registered data for the given purpose on key update
    /// @param purpose Key purpose to reset
    function resetKeys(KeyPurpose purpose) external;
}
