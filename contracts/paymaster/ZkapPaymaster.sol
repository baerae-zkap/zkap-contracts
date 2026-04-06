// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

import {BaseSingletonPaymaster, ERC20PaymasterData} from "./base/BaseSingletonPaymaster.sol";
import {IPaymasterV7} from "./interfaces/IPaymasterV7.sol";
import {PostOpMode} from "./interfaces/PostOpMode.sol";

using UserOperationLib for PackedUserOperation;

/// @title ZkapPaymaster
/// @author Using Solady (https://github.com/vectorized/solady)
/// @notice An ERC-4337 Paymaster contract which supports two modes, Verifying and ERC-20.
/// In ERC-20 mode, the paymaster sponsors a UserOperation in exchange for tokens.
/// In Verifying mode, the paymaster sponsors a UserOperation and deducts prepaid balance from the user's Pimlico
/// balance.
/// @dev Inherits from BaseSingletonPaymaster.
/// @custom:security-contact security@pimlico.io
contract ZkapPaymaster is BaseSingletonPaymaster, IPaymasterV7 {
    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                       CUSTOM ERRORS                        */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                  CONSTANTS AND IMMUTABLES                  */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    uint256 private immutable PAYMASTER_DATA_OFFSET =
        UserOperationLib.PAYMASTER_DATA_OFFSET;
    uint256 private immutable PAYMASTER_VALIDATION_GAS_OFFSET =
        UserOperationLib.PAYMASTER_VALIDATION_GAS_OFFSET;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        CONSTRUCTOR                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    constructor(
        address _entryPoint,
        address _owner,
        address _manager,
        address[] memory _signers
    ) BaseSingletonPaymaster(_entryPoint, _owner, _manager, _signers) {}

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*        ENTRYPOINT V0.7 ERC-4337 PAYMASTER OVERRIDES        */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IPaymasterV7
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 requiredPreFund
    ) external override returns (bytes memory context, uint256 validationData) {
        _requireFromEntryPoint();
        requiredPreFund;
        return _validatePaymasterUserOp(userOp, userOpHash);
    }

    /// @inheritdoc IPaymasterV7
    /// @dev ZKAPSC-003: No-op. ERC20 token collection moved to validation phase.
    /// Context is always empty, so postOp is never meaningfully called.
    function postOp(
        PostOpMode,
        bytes calldata,
        uint256,
        uint256
    ) external override {
        _requireFromEntryPoint();
    }

    /**
     * @notice Internal helper to parse and validate the userOperation's paymasterAndData.
     * @param _userOp The userOperation.
     * @param _userOpHash The userOperation hash.
     * @return (context, validationData) The context and validation data to return to the EntryPoint.
     *
     * @dev paymasterAndData for mode 0:
     * - paymaster address (20 bytes)
     * - paymaster verification gas (16 bytes)
     * - paymaster postop gas (16 bytes)
     * - mode and allowAllBundlers (1 byte) - lowest bit represents allowAllBundlers, rest of the bits represent mode
     * - validUntil (6 bytes)
     * - validAfter (6 bytes)
     * - signature (64 or 65 bytes)
     *
     * @dev paymasterAndData for mode 1:
     * - paymaster address (20 bytes)
     * - paymaster verification gas (16 bytes)
     * - paymaster postop gas (16 bytes)
     * - mode and allowAllBundlers (1 byte) - lowest bit represents allowAllBundlers, rest of the bits represent mode
     * - constantFeePresent and recipientPresent and preFundPresent (1 byte) - 00000{preFundPresent
     * bit}{recipientPresent bit}{constantFeePresent bit}
     * - validUntil (6 bytes)
     * - validAfter (6 bytes)
     * - token address (20 bytes)
     * - postOpGas (16 bytes)
     * - exchangeRate (32 bytes)
     * - paymasterValidationGasLimit (16 bytes)
     * - treasury (20 bytes)
     * - preFund (16 bytes) - only if preFundPresent is 1
     * - constantFee (16 bytes - only if constantFeePresent is 1)
     * - recipient (20 bytes - only if recipientPresent is 1)
     * - signature (64 or 65 bytes)
     *
     *
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata _userOp,
        bytes32 _userOpHash
    ) internal returns (bytes memory, uint256) {
        (
            uint8 mode,
            bool allowAllBundlers,
            bytes calldata paymasterConfig
        ) = _parsePaymasterAndData(
                _userOp.paymasterAndData,
                PAYMASTER_DATA_OFFSET
            );

        // ZKAPSC-002: Remove tx.origin access when allowAllBundlers is true (ERC-7562 Opcode Rules)
        if (!allowAllBundlers) {
            // solhint-disable-next-line avoid-tx-origin
            if (!isBundlerAllowed[tx.origin]) {
                // solhint-disable-next-line avoid-tx-origin
                revert BundlerNotAllowed(tx.origin);
            }
        }

        if (mode != ERC20_MODE && mode != VERIFYING_MODE) {
            revert PaymasterModeInvalid();
        }

        bytes memory context;
        uint256 validationData;

        if (mode == VERIFYING_MODE) {
            (context, validationData) = _validateVerifyingMode(
                _userOp,
                paymasterConfig,
                _userOpHash
            );
        } else {
            // mode must be ERC20_MODE (validated above)
            (context, validationData) = _validateERC20Mode(
                _userOp,
                paymasterConfig,
                _userOpHash
            );
        }

        return (context, validationData);
    }

    /**
     * @notice Internal helper to validate the paymasterAndData when used in verifying mode.
     * @param _userOp The userOperation.
     * @param _paymasterConfig The encoded paymaster config taken from paymasterAndData.
     * @param _userOpHash The userOperation hash.
     * @return (context, validationData) The validation data to return to the EntryPoint.
     */
    function _validateVerifyingMode(
        PackedUserOperation calldata _userOp,
        bytes calldata _paymasterConfig,
        bytes32 _userOpHash
    ) internal returns (bytes memory, uint256) {
        (
            uint48 validUntil,
            uint48 validAfter,
            bytes calldata signature
        ) = _parseVerifyingConfig(_paymasterConfig);

        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(
            getHash(VERIFYING_MODE, _userOp)
        );
        address recoveredSigner = ECDSA.recover(hash, signature);

        bool isSignatureValid = signers[recoveredSigner];
        uint256 validationData = _packValidationData(
            !isSignatureValid,
            validUntil,
            validAfter
        );

        emit UserOperationSponsored(
            _userOpHash,
            _userOp.sender,
            VERIFYING_MODE,
            address(0),
            0
        );
        return ("", validationData);
    }

    /**
     * @notice Internal helper to validate the paymasterAndData when used in ERC-20 mode.
     * @param _userOp The userOperation.
     * @param _paymasterConfig The encoded paymaster config taken from paymasterAndData.
     * @param _userOpHash The userOperation hash.
     * @return (context, validationData) The validation data to return to the EntryPoint.
     */
    function _validateERC20Mode(
        PackedUserOperation calldata _userOp,
        bytes calldata _paymasterConfig,
        bytes32 _userOpHash
    ) internal returns (bytes memory, uint256) {
        ERC20PaymasterData memory cfg = _parseErc20Config(_paymasterConfig);

        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(
            getHash(ERC20_MODE, _userOp)
        );
        address recoveredSigner = ECDSA.recover(hash, cfg.signature);

        bool isSignatureValid = signers[recoveredSigner];
        uint256 validationData = _packValidationData(
            !isSignatureValid,
            cfg.validUntil,
            cfg.validAfter
        );

        if (isSignatureValid) {
            // Pre-charge tokens during validation to prevent postOp griefing (ZKAPSC-003)
            SafeTransferLib.safeTransferFrom(
                cfg.token,
                _userOp.sender,
                cfg.treasury,
                cfg.tokenAmount
            );

            emit UserOperationSponsored(
                _userOpHash,
                _userOp.sender,
                ERC20_MODE,
                cfg.token,
                cfg.tokenAmount
            );
        }

        // Return empty context - postOp is no longer needed for ERC20 mode
        return ("", validationData);
    }


    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      PUBLIC HELPERS                        */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @notice Hashses the userOperation data when used in ERC-20 mode.
     * @param _userOp The user operation data.
     * @param _mode The mode that we want to get the hash for.
     * @return bytes32 The hash that the signer should sign over.
     */
    function getHash(
        uint8 _mode,
        PackedUserOperation calldata _userOp
    ) public view virtual returns (bytes32) {
        if (_mode == VERIFYING_MODE) {
            return
                _getHash(
                    _userOp,
                    MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH +
                        VERIFYING_PAYMASTER_DATA_LENGTH
                );
        } else {
            return
                _getHash(
                    _userOp,
                    MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH +
                        ERC20_PAYMASTER_DATA_LENGTH
                );
        }
    }

    /**
     * @notice Internal helper that hashes the user operation data.
     * @dev We hash over all fields in paymasterAndData but the paymaster signature.
     * @param paymasterDataLength The paymasterData length.
     * @return bytes32 The hash that the signer should sign over.
     */
    function _getHash(
        PackedUserOperation calldata _userOp,
        uint256 paymasterDataLength
    ) internal view returns (bytes32) {
        bytes32 userOpHash = keccak256(
            abi.encode(
                _userOp.sender,
                _userOp.nonce,
                _userOp.accountGasLimits,
                _userOp.preVerificationGas,
                _userOp.gasFees,
                keccak256(_userOp.initCode),
                keccak256(_userOp.callData),
                // hashing over all paymaster fields besides signature
                keccak256(
                    _userOp.paymasterAndData[:PAYMASTER_DATA_OFFSET +
                        paymasterDataLength]
                )
            )
        );

        return keccak256(abi.encode(userOpHash, block.chainid));
    }
}
