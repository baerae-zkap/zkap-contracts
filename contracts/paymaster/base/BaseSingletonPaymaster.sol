// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/* solhint-disable reason-string */
import {BasePaymaster} from "./BasePaymaster.sol";
import {MultiSigner} from "./MultiSigner.sol";

import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

import {ManagerAccessControl} from "./ManagerAccessControl.sol";

using UserOperationLib for PackedUserOperation;

/// @notice Hold all configs needed in ERC-20 mode.
struct ERC20PaymasterData {
    /// @dev The treasury address where the tokens will be sent to.
    address treasury;
    /// @dev Timestamp until which the sponsorship is valid.
    uint48 validUntil;
    /// @dev Timestamp after which the sponsorship is valid.
    uint48 validAfter;
    /// @dev ERC-20 token that the sender will pay with.
    address token;
    /// @dev The fee of the ERC-20 token during sponsorship.
    uint256 tokenAmount;
    /// @dev The paymaster signature.
    bytes signature;
}

/// @title BaseSingletonPaymaster
/// @author Pimlico (https://github.com/pimlicolabs/singleton-paymaster/blob/main/src/base/BaseSingletonPaymaster.sol)
/// @notice Helper class for creating a singleton paymaster.
/// @dev Inherits from BasePaymaster.
/// @dev Inherits from MultiSigner.
abstract contract BaseSingletonPaymaster is
    ManagerAccessControl,
    BasePaymaster,
    MultiSigner
{
    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                       CUSTOM ERRORS                        */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @notice The paymaster data length is invalid.
    error PaymasterAndDataLengthInvalid();

    /// @notice The paymaster data mode is invalid. The mode should be 0 or 1.
    error PaymasterModeInvalid();

    /// @notice The paymaster data length is invalid for the selected mode.
    error PaymasterConfigLengthInvalid();

    /// @notice The paymaster signature length is invalid.
    error PaymasterSignatureLengthInvalid();

    /// @notice The token is invalid.
    error TokenAddressInvalid();

    /// @notice The token amount is invalid.
    error TokenAmountInvalid();

    /// @notice The payment failed due to the TransferFrom call in the PostOp reverting.
    /// @dev We need to throw with params due to this bug in EntryPoint v0.6:
    /// https://github.com/eth-infinitism/account-abstraction/pull/293
    error PostOpTransferFromFailed(string msg);

    /// @notice The preFund is too high.
    error PreFundTooHigh();

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                           EVENTS                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @dev Emitted when a user operation is sponsored by the paymaster.
    event UserOperationSponsored(
        bytes32 indexed userOpHash,
        /// @param The user that requested sponsorship.
        address indexed user,
        /// @param The paymaster mode that was used.
        uint8 paymasterMode,
        /// @param The token that was used during sponsorship (ERC-20 mode only).
        address token,
        /// @param The amount of token paid during sponsorship (ERC-20 mode only).
        uint256 tokenAmount
    );

    /// @notice Event for changing a bundler allowlist configuration
    ///
    /// @param bundler Address of the bundler
    /// @param allowed True if was allowlisted, false if removed from allowlist
    event BundlerAllowlistUpdated(address bundler, bool allowed);

    /// @notice Error for bundler not allowed
    ///
    /// @param bundler address of the bundler that was not allowlisted
    error BundlerNotAllowed(address bundler);

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                  CONSTANTS AND IMMUTABLES                  */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @notice Mode indicating that the Paymaster is in Verifying mode.
    uint8 immutable VERIFYING_MODE = 0;

    /// @notice Mode indicating that the Paymaster is in ERC-20 mode.
    uint8 immutable ERC20_MODE = 1;

    /// @notice The length of the mode and allowAllBundlers bytes.
    uint8 immutable MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH = 1;

    /// @notice The length of the ERC-20 config without singature.
    uint8 immutable ERC20_PAYMASTER_DATA_LENGTH = 84;

    /// @notice The length of the verfiying config without singature.
    uint8 immutable VERIFYING_PAYMASTER_DATA_LENGTH = 12; // 12

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                          STORAGE                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @notice Allowlist of bundlers to use if restricting bundlers is enabled by flag
    mapping(address bundler => bool allowed) public isBundlerAllowed;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        CONSTRUCTOR                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @notice Initializes a SingletonPaymaster instance.
     * @param _entryPoint The entryPoint address.
     * @param _owner The initial contract owner.
     */
    constructor(
        address _entryPoint,
        address _owner,
        address _manager,
        address[] memory _signers
    ) BasePaymaster(_entryPoint, _owner, _manager) MultiSigner(_signers) {}

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      ADMIN FUNCTIONS                       */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @notice Add or remove multiple bundlers to/from the allowlist
    ///
    /// @param bundlers Array of bundler addresses
    /// @param allowed Boolean indicating if bundlers should be allowed or not
    function updateBundlerAllowlist(
        address[] calldata bundlers,
        bool allowed
    ) external onlyAdminOrManager {
        for (uint256 i = 0; i < bundlers.length; i++) {
            isBundlerAllowed[bundlers[i]] = allowed;
            emit BundlerAllowlistUpdated(bundlers[i], allowed);
        }
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      INTERNAL HELPERS                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @notice Parses the userOperation's paymasterAndData field and returns the paymaster mode and encoded paymaster
     * configuration bytes.
     * @dev _paymasterDataOffset should have value 20 for V6 and 52 for V7.
     * @param _paymasterAndData The paymasterAndData to parse.
     * @param _paymasterDataOffset The paymasterData offset in paymasterAndData.
     * @return mode The paymaster mode.
     * @return paymasterConfig The paymaster config bytes.
     */
    function _parsePaymasterAndData(
        bytes calldata _paymasterAndData,
        uint256 _paymasterDataOffset
    ) internal pure returns (uint8, bool, bytes calldata) {
        if (_paymasterAndData.length < _paymasterDataOffset + 1) {
            revert PaymasterAndDataLengthInvalid();
        }

        uint8 combinedByte = uint8(_paymasterAndData[_paymasterDataOffset]);
        // allowAllBundlers is in the *lowest* bit
        bool allowAllBundlers = (combinedByte & 0x01) != 0;
        // rest of the bits represent the mode
        uint8 mode = uint8((combinedByte >> 1));

        bytes
            calldata paymasterConfig = _paymasterAndData[_paymasterDataOffset +
                1:];

        return (mode, allowAllBundlers, paymasterConfig);
    }

    /**
     * @notice Parses the paymaster configuration when used in ERC-20 mode.
     * @param _paymasterConfig The paymaster configuration in bytes.
     * @return config The parsed paymaster configuration values.
     */
    function _parseErc20Config(
        bytes calldata _paymasterConfig
    ) internal pure returns (ERC20PaymasterData memory config) {
        if (_paymasterConfig.length < ERC20_PAYMASTER_DATA_LENGTH) {
            revert PaymasterConfigLengthInvalid();
        }

        uint128 configPointer = 0;
        config.validUntil = uint48(
            bytes6(_paymasterConfig[configPointer:configPointer + 6])
        ); // 6 bytes
        configPointer += 6;
        config.validAfter = uint48(
            bytes6(_paymasterConfig[configPointer:configPointer + 6])
        ); // 6 bytes
        configPointer += 6;
        config.token = address(
            bytes20(_paymasterConfig[configPointer:configPointer + 20])
        ); // 20 bytes
        configPointer += 20;
        config.tokenAmount = uint256(
            bytes32(_paymasterConfig[configPointer:configPointer + 32])
        ); // 32 bytes
        configPointer += 32;
        config.treasury = address(
            bytes20(_paymasterConfig[configPointer:configPointer + 20])
        ); // 20 bytes
        configPointer += 20;
        config.signature = _paymasterConfig[configPointer:];

        if (config.token == address(0)) {
            revert TokenAddressInvalid();
        }

        if (config.tokenAmount == 0) {
            revert TokenAmountInvalid();
        }

        if (config.signature.length != 64 && config.signature.length != 65) {
            revert PaymasterSignatureLengthInvalid();
        }

        return config;
    }

    /**
     * @notice Parses the paymaster configuration when used in verifying mode.
     * @param _paymasterConfig The paymaster configuration in bytes.
     * @return validUntil The timestamp until which the sponsorship is valid.
     * @return validAfter The timestamp after which the sponsorship is valid.
     * @return signature The signature over the hashed sponsorship fields.
     * @dev The function reverts if the configuration length is invalid or if the signature length is not 64 or 65
     * bytes.
     */
    function _parseVerifyingConfig(
        bytes calldata _paymasterConfig
    ) internal pure returns (uint48, uint48, bytes calldata) {
        if (_paymasterConfig.length < VERIFYING_PAYMASTER_DATA_LENGTH) {
            revert PaymasterConfigLengthInvalid();
        }

        uint48 validUntil = uint48(bytes6(_paymasterConfig[0:6]));
        uint48 validAfter = uint48(bytes6(_paymasterConfig[6:12]));
        bytes calldata signature = _paymasterConfig[12:];

        if (signature.length != 64 && signature.length != 65) {
            revert PaymasterSignatureLengthInvalid();
        }

        return (validUntil, validAfter, signature);
    }

}
