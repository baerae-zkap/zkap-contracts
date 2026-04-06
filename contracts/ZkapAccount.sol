// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.34;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "@account-abstraction/contracts/accounts/callback/TokenCallbackHandler.sol";
import "@account-abstraction/contracts/core/EntryPoint.sol";
import "./AccountKey/ContractInterface/IPrimitiveAccountKey.sol";
import "./AccountKey/ContractInterface/IAccountKey.sol";


interface IRefreshableRoots {
    function refreshCachedRoots(IAccountKey.KeyPurpose purpose, uint256 keyId) external;
}

/**
 * minimal account.
 *  this is sample minimal account.
 *  has execute, eth handling methods
 *  has a single signer that can send requests through the entryPoint.
 */
contract ZkapAccount is
    BaseAccount,
    TokenCallbackHandler,
    UUPSUpgradeable,
    Initializable,
    IERC1271
{
    error InvalidEntryPointAddress();
    error OnlyOwner();
    error WrongArrayLengths();
    error MasterKeyThresholdMustBePositive();
    error MasterKeyListMustNotBeEmpty();
    error InsufficientMasterKeyWeight();
    error MasterKeyLogicAddressZero();
    error TxKeyThresholdMustBePositive();
    error TxKeyListMustNotBeEmpty();
    error InsufficientTxKeyWeight();
    error TxKeyLogicAddressZero();
    error TxKeyUpdateInProgress();
    error MasterKeyUpdateInProgress();
    error KeyIndexOutOfBounds();
    error DuplicateKeyIndex();
    error CannotUpgradeViaTxKey();
    error CannotCallKeyProxy();
    error CannotCallKeySingleton();

    struct KeyRef {
        address logic;
        uint256 keyId;
    }

    KeyRef[] public masterKeyList;
    KeyRef[] public txKeyList;
    uint8 public masterKeyThreshold;
    uint8 public txKeyThreshold;
    uint8[] public masterKeyWeightList;
    uint8[] public txKeyWeightList;

    uint256 private masterKeyUpdateBlock;
    uint256 private txKeyUpdateBlock;
    // solhint-disable-next-line var-name-mixedcase
    IEntryPoint private immutable _ENTRY_POINT;

    event ZkapAccountInitialized(IEntryPoint indexed entryPoint);
    event TxKeyUpdated(address indexed account);
    event MasterKeyUpdated(address indexed account);

    uint256 private constant ZKAP_VERSION = 1;

    // EIP-1271 constants
    bytes4 internal constant EIP1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 internal constant EIP1271_INVALID_SIGNATURE = 0xffffffff;

    // ZKAPSC-005: ERC-7739 defensive rehashing constants (prevents signature replay in isValidSignature)
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");
    bytes32 private constant _PERSONAL_SIGN_TYPEHASH =
        keccak256("PersonalSign(bytes32 prefixed)");

    // UUPS upgrade function selector (blocked for txKey)
    bytes4 private constant UPGRADE_TO_AND_CALL_SELECTOR = 0x4f1ef286; // upgradeToAndCall(address,bytes)

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    /// @inheritdoc BaseAccount
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _ENTRY_POINT;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor(IEntryPoint anEntryPoint) {
        if (address(anEntryPoint) == address(0)) revert InvalidEntryPointAddress();
        _ENTRY_POINT = anEntryPoint;
        _disableInitializers();
    }

    function _onlyOwner() internal view {
        // through the account itself (which gets redirected through execute())
        if (msg.sender != address(this)) revert OnlyOwner();
    }

    /**
     * execute a transaction (called by entryPoint)
     * @param dest destination address to call
     * @param value the value to pass in this call
     * @param func the calldata to pass in this call
     */
    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external override {
        _requireFromEntryPoint();
        _requireAfterTxKeyUpdate();
        _requireSafeCall(dest, func);
        _call(dest, value, func);
    }

    /**
     * execute a sequence of transactions
     * @dev to reduce gas consumption for trivial case (no value), use a zero-length array to mean zero value
     * @param dest an array of destination addresses
     * @param value an array of values to pass to each call. can be zero-length for no-value calls
     * @param func an array of calldata to pass to each call
     */
    function executeBatch(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external {
        _requireFromEntryPoint();
        _requireAfterTxKeyUpdate();
        if (
            dest.length != func.length ||
            (value.length != 0 && value.length != func.length)
        ) revert WrongArrayLengths();
        uint256 destLen = dest.length;
        if (value.length == 0) {
            for (uint256 i = 0; i < destLen; ++i) {
                _requireSafeCall(dest[i], func[i]);
                _call(dest[i], 0, func[i]);
            }
        } else {
            for (uint256 i = 0; i < destLen; ++i) {
                _requireSafeCall(dest[i], func[i]);
                _call(dest[i], value[i], func[i]);
            }
        }
    }

    /**
     * @dev The _ENTRY_POINT member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of ZkapAccount must be deployed with the new EntryPoint address, then upgrading
     * the implementation by calling `upgradeToAndCall()`
     */
    // solhint-disable-next-line function-max-lines
    function initialize(
        bytes calldata encodedMasterKey,
        bytes calldata encodedTxKey
    ) public virtual initializer {
        address[] memory masterKeyLogicList;
        address[] memory txKeyLogicList;
        bytes[] memory masterKeyInitDataList;
        bytes[] memory txKeyInitDataList;

        (
            masterKeyThreshold,
            masterKeyLogicList,
            masterKeyInitDataList,
            masterKeyWeightList
        ) = abi.decode(encodedMasterKey, (uint8, address[], bytes[], uint8[]));
        if (masterKeyThreshold == 0) revert MasterKeyThresholdMustBePositive();
        if (masterKeyLogicList.length == 0) revert MasterKeyListMustNotBeEmpty();
        if (
            masterKeyLogicList.length != masterKeyInitDataList.length ||
            masterKeyLogicList.length != masterKeyWeightList.length
        ) revert WrongArrayLengths();
        {
            uint256 weightSum = 0;
            uint256 weightLen = masterKeyWeightList.length;
            for (uint256 i = 0; i < weightLen; ++i) {
                weightSum += masterKeyWeightList[i];
            }
            // solhint-disable-next-line gas-strict-inequalities
            if (weightSum < masterKeyThreshold) revert InsufficientMasterKeyWeight();
        }

        uint256 masterKeyLogicLen = masterKeyLogicList.length;
        for (uint256 i = 0; i < masterKeyLogicLen; ++i) {
            if (masterKeyLogicList[i] == address(0)) revert MasterKeyLogicAddressZero();
            uint256 keyId = IAccountKey(masterKeyLogicList[i]).register(IAccountKey.KeyPurpose.Master, masterKeyInitDataList[i]);
            masterKeyList.push(KeyRef(masterKeyLogicList[i], keyId));
        }

        if (encodedTxKey.length == 0) {
            txKeyThreshold = type(uint8).max;   // if no txKey is provided, operations must be impossible, so set to max value
        } else {
            (
                txKeyThreshold,
                txKeyLogicList,
                txKeyInitDataList,
                txKeyWeightList
            ) = abi.decode(encodedTxKey, (uint8, address[], bytes[], uint8[]));
            if (txKeyThreshold == 0) revert TxKeyThresholdMustBePositive();
            if (txKeyLogicList.length == 0) revert TxKeyListMustNotBeEmpty();
            if (
                txKeyLogicList.length != txKeyInitDataList.length ||
                txKeyLogicList.length != txKeyWeightList.length
            ) revert WrongArrayLengths();
            {
                uint256 weightSum = 0;
                uint256 txWeightLen = txKeyWeightList.length;
                for (uint256 i = 0; i < txWeightLen; ++i) {
                    weightSum += txKeyWeightList[i];
                }
                // solhint-disable-next-line gas-strict-inequalities
                if (weightSum < txKeyThreshold) revert InsufficientTxKeyWeight();
            }

            uint256 txKeyLogicLen = txKeyLogicList.length;
            for (uint256 i = 0; i < txKeyLogicLen; ++i) {
                if (txKeyLogicList[i] == address(0)) revert TxKeyLogicAddressZero();
                uint256 keyId = IAccountKey(txKeyLogicList[i]).register(IAccountKey.KeyPurpose.Tx, txKeyInitDataList[i]);
                txKeyList.push(KeyRef(txKeyLogicList[i], keyId));
            }
        }

        emit ZkapAccountInitialized(_ENTRY_POINT);
    }

    function zkapVersion() external pure returns (uint256) {
        return ZKAP_VERSION;
    }

    function updateKeys(bytes calldata encodedMasterKey, bytes calldata encodedTxKey) external {
        _requireFromEntryPoint();
        _requireAfterMasterKeyUpdate();
        _updateMasterKey(encodedMasterKey);
        _updateTxKey(encodedTxKey);
    }

    function updateMasterKey(bytes calldata encoded) external {
        _requireFromEntryPoint();
        _requireAfterMasterKeyUpdate();
        _updateMasterKey(encoded);
    }

    function updateTxKey(bytes calldata encoded) external {
        _requireFromEntryPoint();
        _requireAfterMasterKeyUpdate();
        _updateTxKey(encoded);
    }

    /**
     * @notice ZKAPSC-004: upgradeToAndCall override — prevents upgrade immediately after a masterKey update
     * @param newImplementation Address of the new implementation contract
     * @param data Calldata to delegatecall on the new implementation
     */
    function upgradeToAndCall(address newImplementation, bytes memory data) public payable override {
        _requireFromEntryPoint();
        _requireAfterMasterKeyUpdate();
        super.upgradeToAndCall(newImplementation, data);
    }

    function _updateTxKey(bytes calldata encoded) internal {
        address[] memory txKeyLogicList;
        bytes[] memory txKeyInitDataList;

        (
            txKeyThreshold,
            txKeyLogicList,
            txKeyInitDataList,
            txKeyWeightList
        ) = abi.decode(encoded, (uint8, address[], bytes[], uint8[]));
        if (txKeyThreshold == 0) revert TxKeyThresholdMustBePositive();
        if (txKeyLogicList.length == 0) revert TxKeyListMustNotBeEmpty();
        if (
            txKeyLogicList.length != txKeyInitDataList.length ||
            txKeyLogicList.length != txKeyWeightList.length
        ) revert WrongArrayLengths();
        {
            uint256 weightSum = 0;
            uint256 txWeightLen = txKeyWeightList.length;
            for (uint256 i = 0; i < txWeightLen; ++i) {
                weightSum += txKeyWeightList[i];
            }
            // solhint-disable-next-line gas-strict-inequalities
            if (weightSum < txKeyThreshold) revert InsufficientTxKeyWeight();
        }

        // Storage is independent per purpose, so always reset before registering (skip duplicate addresses)
        uint256 oldTxLen = txKeyList.length;
        for (uint256 i = 0; i < oldTxLen; ++i) {
            address logic = txKeyList[i].logic;
            bool alreadyReset = false;
            for (uint256 j = 0; j < i; ++j) {
                if (txKeyList[j].logic == logic) { alreadyReset = true; break; }
            }
            if (!alreadyReset) {
                IAccountKey(logic).resetKeys(IAccountKey.KeyPurpose.Tx);
            }
        }
        delete txKeyList;
        uint256 txKeyLogicLen = txKeyLogicList.length;
        for (uint256 i = 0; i < txKeyLogicLen; ++i) {
            if (txKeyLogicList[i] == address(0)) revert TxKeyLogicAddressZero();
            uint256 keyId = IAccountKey(txKeyLogicList[i]).register(IAccountKey.KeyPurpose.Tx, txKeyInitDataList[i]);
            txKeyList.push(KeyRef(txKeyLogicList[i], keyId));
        }

        txKeyUpdateBlock = block.number;
        emit TxKeyUpdated(address(this));
    }

    function _updateMasterKey(bytes calldata encoded) internal {
        address[] memory masterKeyLogicList;
        bytes[] memory masterKeyInitDataList;

        (
            masterKeyThreshold,
            masterKeyLogicList,
            masterKeyInitDataList,
            masterKeyWeightList
        ) = abi.decode(encoded, (uint8, address[], bytes[], uint8[]));
        if (masterKeyThreshold == 0) revert MasterKeyThresholdMustBePositive();
        if (masterKeyLogicList.length == 0) revert MasterKeyListMustNotBeEmpty();
        if (
            masterKeyLogicList.length != masterKeyInitDataList.length ||
            masterKeyLogicList.length != masterKeyWeightList.length
        ) revert WrongArrayLengths();
        {
            uint256 weightSum = 0;
            uint256 weightLen = masterKeyWeightList.length;
            for (uint256 i = 0; i < weightLen; ++i) {
                weightSum += masterKeyWeightList[i];
            }
            // solhint-disable-next-line gas-strict-inequalities
            if (weightSum < masterKeyThreshold) revert InsufficientMasterKeyWeight();
        }

        // Storage is independent per purpose, so always reset before registering (skip duplicate addresses)
        uint256 oldMasterLen = masterKeyList.length;
        for (uint256 i = 0; i < oldMasterLen; ++i) {
            address logic = masterKeyList[i].logic;
            bool alreadyReset = false;
            for (uint256 j = 0; j < i; ++j) {
                if (masterKeyList[j].logic == logic) { alreadyReset = true; break; }
            }
            if (!alreadyReset) {
                IAccountKey(logic).resetKeys(IAccountKey.KeyPurpose.Master);
            }
        }
        delete masterKeyList;
        uint256 masterKeyLogicLen = masterKeyLogicList.length;
        for (uint256 i = 0; i < masterKeyLogicLen; ++i) {
            if (masterKeyLogicList[i] == address(0)) revert MasterKeyLogicAddressZero();
            uint256 keyId = IAccountKey(masterKeyLogicList[i]).register(IAccountKey.KeyPurpose.Master, masterKeyInitDataList[i]);
            masterKeyList.push(KeyRef(masterKeyLogicList[i], keyId));
        }

        masterKeyUpdateBlock = block.number;
        emit MasterKeyUpdated(address(this));
    }

    function _requireAfterTxKeyUpdate() internal view {
        // solhint-disable-next-line gas-strict-inequalities
        if (txKeyUpdateBlock >= block.number) revert TxKeyUpdateInProgress();
    }

    function _requireAfterMasterKeyUpdate() internal view {
        // solhint-disable-next-line gas-strict-inequalities
        if (masterKeyUpdateBlock >= block.number) revert MasterKeyUpdateInProgress();
    }

    /// @dev Prevents dangerous calls via txKey:
    ///      1. Self-call to upgradeToAndCall (account takeover)
    ///      2. Calls to key singleton addresses (state manipulation)
    function _requireSafeCall(address dest, bytes calldata func) internal view {
        // Block self-call to upgrade functions
        if (dest == address(this) && func.length >= 4) {
            bytes4 selector;
            assembly {
                selector := calldataload(func.offset)
            }
            if (selector == UPGRADE_TO_AND_CALL_SELECTOR) {
                revert CannotUpgradeViaTxKey();
            }
        }

        // Block calls to key singleton addresses
        uint256 masterLen = masterKeyList.length;
        for (uint256 i = 0; i < masterLen; ++i) {
            if (dest == masterKeyList[i].logic) revert CannotCallKeySingleton();
        }
        uint256 txLen = txKeyList.length;
        for (uint256 i = 0; i < txLen; ++i) {
            if (dest == txKeyList[i].logic) revert CannotCallKeySingleton();
        }
    }

    /// implement template method of BaseAccount
    /// @dev ZKAPSC-007: userOpHash is already in EIP-712 format, so toEthSignedMessageHash is not needed
    // solhint-disable-next-line function-max-lines
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
        bytes32 hash = userOpHash;

        bytes calldata callData = userOp.callData;
        bytes4 methodSig;
        assembly {
            let len := callData.length
            if gt(len, 3) {
                methodSig := calldataload(callData.offset)
            }
        }

        uint8[] memory keyIndexList;
        bytes[] memory keySignatureList;
        uint256 validatedWeightedSum = 0;

        (keyIndexList, keySignatureList) = abi.decode(
            userOp.signature,
            (uint8[], bytes[])
        );
        uint256 keyIndexLen = keyIndexList.length;
        if (keyIndexLen != keySignatureList.length) revert WrongArrayLengths();

        if (
            methodSig == this.updateMasterKey.selector ||
            methodSig == this.updateTxKey.selector ||
            methodSig == this.updateKeys.selector ||
            methodSig == UPGRADE_TO_AND_CALL_SELECTOR
        ) {
            uint256 usedKeys = 0;
            for (uint256 i = 0; i < keyIndexLen; ++i) {
                // solhint-disable-next-line gas-strict-inequalities
                if (keyIndexList[i] >= masterKeyList.length) revert KeyIndexOutOfBounds();
                uint256 keyBit = 1 << keyIndexList[i];
                if ((usedKeys & keyBit) != 0) revert DuplicateKeyIndex();
                usedKeys |= keyBit;
                if (
                    IAccountKey(masterKeyList[keyIndexList[i]].logic).validate(
                        IAccountKey.KeyPurpose.Master,
                        masterKeyList[keyIndexList[i]].keyId,
                        keySignatureList[i],
                        uint256(hash)
                    )
                ) {
                    validatedWeightedSum += masterKeyWeightList[
                        keyIndexList[i]
                    ];
                }
            }
            // solhint-disable-next-line gas-strict-inequalities
            if (validatedWeightedSum >= masterKeyThreshold) {
                return SIG_VALIDATION_SUCCESS;
            }
        } else {
            uint256 usedKeys = 0;
            for (uint256 i = 0; i < keyIndexLen; ++i) {
                // solhint-disable-next-line gas-strict-inequalities
                if (keyIndexList[i] >= txKeyList.length) revert KeyIndexOutOfBounds();
                uint256 keyBit = 1 << keyIndexList[i];
                if ((usedKeys & keyBit) != 0) revert DuplicateKeyIndex();
                usedKeys |= keyBit;
                if (
                    IAccountKey(txKeyList[keyIndexList[i]].logic).validate(
                        IAccountKey.KeyPurpose.Tx,
                        txKeyList[keyIndexList[i]].keyId,
                        keySignatureList[i],
                        uint256(hash)
                    )
                ) {
                    validatedWeightedSum += txKeyWeightList[keyIndexList[i]];
                }
            }

            // solhint-disable-next-line gas-strict-inequalities
            if (validatedWeightedSum >= txKeyThreshold) {
                return SIG_VALIDATION_SUCCESS;
            }
        }
        return SIG_VALIDATION_FAILED;
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /**
     * check current account deposit in the entryPoint
     */
    function getDeposit() external view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * deposit more funds for this account in the entryPoint
     */
    function addDeposit() external payable {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /**
     * withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(
        address payable withdrawAddress,
        uint256 amount
    ) external onlyOwner {
        _requireAfterTxKeyUpdate();
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal view override {
        (newImplementation);
        _requireFromEntryPoint();
    }

    /// @notice Computes the EIP-712 domain separator for this account
    /// @dev Used for ERC-7739 defensive rehashing to bind signatures to this account
    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, block.chainid, address(this)));
    }

    /**
     * @notice Validates a signature according to EIP-1271 with ERC-7739 defensive rehashing
     * @dev Uses txKey for signature validation. Applies defensive rehashing to bind
     *      the hash to this account's address, preventing cross-account signature replay.
     * @param _hash The hash of the data to be signed
     * @param _signature The signature bytes, ABI encoded as (uint8[] keyIndexList, bytes[] keySignatureList)
     * @return magicValue EIP1271_MAGIC_VALUE if valid, EIP1271_INVALID_SIGNATURE otherwise
     */
    function isValidSignature(
        bytes32 _hash,
        bytes memory _signature
    ) external view override returns (bytes4) {
        // ERC-7739: defensive rehashing to bind hash to this account
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                keccak256(abi.encode(_PERSONAL_SIGN_TYPEHASH, _hash))
            )
        );

        (uint8[] memory keyIndexList, bytes[] memory keySignatureList) = abi
            .decode(_signature, (uint8[], bytes[]));

        uint256 keyIndexLen = keyIndexList.length;
        if (keyIndexLen != keySignatureList.length) {
            return EIP1271_INVALID_SIGNATURE;
        }

        uint256 validatedWeightedSum = 0;
        uint256 usedKeys = 0;

        for (uint256 i = 0; i < keyIndexLen; ++i) {
            // solhint-disable-next-line gas-strict-inequalities
            if (keyIndexList[i] >= txKeyList.length) {
                return EIP1271_INVALID_SIGNATURE;
            }

            uint256 keyBit = 1 << keyIndexList[i];
            if ((usedKeys & keyBit) != 0) {
                return EIP1271_INVALID_SIGNATURE;
            }
            usedKeys |= keyBit;

            if (
                IAccountKey(txKeyList[keyIndexList[i]].logic).validate(
                    IAccountKey.KeyPurpose.Tx,
                    txKeyList[keyIndexList[i]].keyId,
                    keySignatureList[i],
                    uint256(digest)
                )
            ) {
                validatedWeightedSum += txKeyWeightList[keyIndexList[i]];
            }
        }

        // solhint-disable-next-line gas-strict-inequalities
        if (validatedWeightedSum >= txKeyThreshold) {
            return EIP1271_MAGIC_VALUE;
        }
        return EIP1271_INVALID_SIGNATURE;
    }

    /**
     * @notice Refresh cached Merkle roots for a ZkOAuth key
     * @param keyListIndex Index in the key list
     * @param isMaster Whether to use masterKeyList or txKeyList
     * @dev Anyone can call this - root refresh has no security impact
     */
    function refreshMerkleRoots(uint256 keyListIndex, bool isMaster) external {
        KeyRef storage ref = isMaster ? masterKeyList[keyListIndex] : txKeyList[keyListIndex];
        IRefreshableRoots(ref.logic).refreshCachedRoots(
            isMaster ? IAccountKey.KeyPurpose.Master : IAccountKey.KeyPurpose.Tx,
            ref.keyId
        );
    }
}
