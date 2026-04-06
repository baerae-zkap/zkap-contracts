// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Strings.sol";
import "../PrimitiveAccountKey.sol";
import "./PoseidonMerkleTreeDirectory.sol";
import "../../../Utils/Groth16Verifier.sol";
import "../../../Utils/PoseidonHash.sol";

contract AccountKeyZkOAuthRS256Verifier is PrimitiveAccountKey {
    error AnchorMismatch();
    error InvalidMerkleRoot();
    error InvalidNonce();
    error InvalidJwtExpiry();
    error VerificationFailed();
    error InvalidMerkleTreeDirectoryAddress();
    error InvalidAudienceList();
    error InvalidLhsSum();
    error InvalidProofCount();
    error InvalidProofK();
    error MaxKeysExceeded();

    /// @dev ZKAPSC-001: ERC-7562 associated storage compliance: single entry structure (7 slots)
    struct ZkOAuthData {
        PoseidonMerkleTreeDirectory directory;  // +0
        uint256 n;                               // +1
        uint256 k;                               // +2
        uint256 hAudList;                        // +3
        uint256 hanchor;                         // +4
        bytes32 cachedRoot0;                     // +5
        bytes32 cachedRoot1;                     // +6
    }

    /// @dev ERC-7562 associated storage: keccak(A||slot) + n (n=0..35)
    /// Maximum 5 keys per account (ZkOAuthData 7 slots x 5 + count 1)
    uint8 public constant MAX_KEYS_PER_ACCOUNT = 5;

    struct ZkOAuthSlots {
        ZkOAuthData[MAX_KEYS_PER_ACCOUNT] entries;  // MAX_KEYS_PER_ACCOUNT x 7 = 35 slots
        uint8 count;             // +35
    }
    /// @dev Independent storage for Master/Tx (prevents slot exhaustion when reusing the same singleton)
    mapping(address => ZkOAuthSlots) private _masterDataSlots;
    mapping(address => ZkOAuthSlots) private _txDataSlots;

    /// @dev Stores the full anchor array (not accessed during validation -> unrelated to ERC-7562)
    mapping(address => mapping(uint256 => uint256[])) private _masterFullAnchors;
    mapping(address => mapping(uint256 => uint256[])) private _txFullAnchors;

    // BN254 Scalar Field Modulus
    uint256 private constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    event ZkOAuthRS256VerifierRegistered(
        address indexed account,
        uint256 indexed keyId,
        uint256[] anchor,
        uint256 hAudList,
        PoseidonMerkleTreeDirectory directory
    );

    /// @dev Returns storage for the given purpose
    function _getSlots(KeyPurpose purpose, address account) internal view returns (ZkOAuthSlots storage) {
        if (purpose == KeyPurpose.Master) return _masterDataSlots[account];
        return _txDataSlots[account];
    }

    /// @dev Returns fullAnchors for the given purpose
    function _getFullAnchors(KeyPurpose purpose, address account, uint256 keyId) internal view returns (uint256[] storage) {
        if (purpose == KeyPurpose.Master) return _masterFullAnchors[account][keyId];
        return _txFullAnchors[account][keyId];
    }

    function register(
        KeyPurpose purpose,
        bytes calldata initData
    ) external override returns (uint256 keyId) {
        (bytes memory encoded, address directoryAddr) = abi.decode(
            initData,
            (bytes, address)
        );
        if (directoryAddr == address(0)) revert InvalidMerkleTreeDirectoryAddress();

        PoseidonMerkleTreeDirectory directory = PoseidonMerkleTreeDirectory(directoryAddr);

        uint256 _n;
        uint256 _k;
        uint256 _hAudList;
        uint256[] memory _anchor;
        (_n, _k, _hAudList, _anchor) = abi.decode(
            encoded,
            (uint256, uint256, uint256, uint256[])
        );

        // k must be positive to prevent proof bypass
        if (_k == 0) revert InvalidProofK();

        // Compute hanchor
        uint256 h = PoseidonHashLib._hash(_anchor[0], 0);
        for (uint256 i = 1; i < _anchor.length; ++i) {
            h = PoseidonHashLib._hash(h, _anchor[i]);
        }

        keyId = _storeAndEmit(purpose, directory, _n, _k, _hAudList, _anchor, h);
    }

    /// @dev Saves storage and emits event for register (avoids stack too deep)
    function _storeAndEmit(
        KeyPurpose purpose,
        PoseidonMerkleTreeDirectory directory,
        uint256 _n,
        uint256 _k,
        uint256 _hAudList,
        uint256[] memory _anchor,
        uint256 h
    ) private returns (uint256 keyId) {
        ZkOAuthSlots storage slots = _getSlots(purpose, msg.sender);
        if (slots.count >= MAX_KEYS_PER_ACCOUNT) revert MaxKeysExceeded();

        keyId = slots.count;

        // Store data
        ZkOAuthData storage data = slots.entries[keyId];
        data.directory = directory;
        data.n = _n;
        data.k = _k;
        data.hAudList = _hAudList;
        data.hanchor = h;

        // Cache current recent roots from directory (execution phase, external calls OK)
        (data.cachedRoot0, data.cachedRoot1) = directory.getRecentRoots();

        // Store full anchor (view-only, not accessed during validation)
        {
            if (purpose == KeyPurpose.Master) {
                delete _masterFullAnchors[msg.sender][keyId];
            } else {
                delete _txFullAnchors[msg.sender][keyId];
            }
            uint256[] storage fullAnchors = _getFullAnchors(purpose, msg.sender, keyId);
            uint256 anchorLen = _anchor.length;
            for (uint256 i = 0; i < anchorLen; ++i) {
                fullAnchors.push(_anchor[i]);
            }
            fullAnchors.push(h); // hanchor
        }

        slots.count++;

        emit ZkOAuthRS256VerifierRegistered(msg.sender, keyId, _getFullAnchors(purpose, msg.sender, keyId), _hAudList, directory);
    }

    /// @inheritdoc IAccountKey
    function resetKeys(KeyPurpose purpose) external override {
        ZkOAuthSlots storage slots = _getSlots(purpose, msg.sender);
        uint8 count = slots.count;
        if (purpose == KeyPurpose.Master) {
            for (uint256 i = 0; i < count; ++i) {
                delete _masterFullAnchors[msg.sender][i];
            }
            delete _masterDataSlots[msg.sender];
        } else {
            for (uint256 i = 0; i < count; ++i) {
                delete _txFullAnchors[msg.sender][i];
            }
            delete _txDataSlots[msg.sender];
        }
    }

    /**
     * @notice Refresh cached Merkle roots from directory
     * @dev Must be called through ZkapAccount so msg.sender is the account address
     * @param purpose Key purpose (Master or Tx)
     * @param keyId The key slot index (0~4)
     */
    function refreshCachedRoots(KeyPurpose purpose, uint256 keyId) external {
        ZkOAuthSlots storage slots = _getSlots(purpose, msg.sender);
        if (keyId >= slots.count) revert InvalidMerkleTreeDirectoryAddress();
        ZkOAuthData storage data = slots.entries[keyId];
        /* istanbul ignore if */
        if (address(data.directory) == address(0)) revert InvalidMerkleTreeDirectoryAddress();
        (data.cachedRoot0, data.cachedRoot1) = data.directory.getRecentRoots();
    }

    /**
     * @notice Verifies k proofs from the Baerae circuit
     * @param purpose Key purpose (Master or Tx)
     * @param keyId Key slot index (0~4)
     * @param sig Encoded proof data
     * @param msgHash UserOp Hash
     */
    // solhint-disable-next-line function-max-lines
    function validate(
        KeyPurpose purpose,
        uint256 keyId,
        bytes calldata sig,
        uint256 msgHash
    ) external view override returns (bool) {
        ZkOAuthSlots storage slots = _getSlots(purpose, msg.sender);
        if (keyId >= slots.count) return false;
        ZkOAuthData storage data = slots.entries[keyId];
        /* istanbul ignore if */
        if (data.k == 0) return false;

        // sharedInputs layout:
        // [0] hanchor, [1] h_ctx, [2] root, [3] h_sign_userop, [4] lhs, [5] h_aud_list
        // jwtExpList: per-proof JWT expiry (circuit guarantees jwt_exp == jwt.exp binding)
        // partialRhsList: per-proof partial_rhs
        (
            uint256[6] memory sharedInputs,
            uint256[] memory jwtExpList,
            uint256[] memory partialRhsList,
            uint256[8][] memory proofs
        ) = abi.decode(sig, (uint256[6], uint256[], uint256[], uint256[8][]));

        if (proofs.length != data.k || partialRhsList.length != data.k || jwtExpList.length != data.k) {
            revert InvalidProofCount();
        }

        // 1. Pre-validation of shared inputs
        // 1-1. hanchor verification (fixed field access -> ERC-7562 compliant)
        if (data.hanchor != sharedInputs[0]) revert AnchorMismatch();

        // 1-2. Root verification (inline cached roots -> ERC-7562 compliant)
        // When knownRootCount < 2, getRecentRoots() may return bytes32(0),
        // so explicitly reject if proofRoot is 0.
        bytes32 proofRoot = bytes32(sharedInputs[2]);
        if (proofRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (data.cachedRoot0 != proofRoot && data.cachedRoot1 != proofRoot) {
            revert InvalidMerkleRoot();
        }

        // 1-3. h_sign_userop verification (msgHash % SNARK_SCALAR_FIELD)
        uint256 modMsgHash = msgHash % SNARK_SCALAR_FIELD;
        if (sharedInputs[3] != modMsgHash) {
            revert InvalidNonce();
        }

        // 1-4. h_aud_list verification
        if (sharedInputs[5] != data.hAudList) {
            revert InvalidAudienceList();
        }

        // 1-5. Sum Check: sum(partial_rhs_i) == lhs
        uint256 sumPartialRhs = 0;
        for (uint256 i = 0; i < data.k; ++i) {
            sumPartialRhs = addmod(sumPartialRhs, partialRhsList[i], SNARK_SCALAR_FIELD);
        }
        if (sumPartialRhs != sharedInputs[4]) {
            revert InvalidLhsSum();
        }

        // 2. Verify k proofs
        for (uint256 i = 0; i < data.k; ++i) {
            // 2-1. ZKAPSC-009: JWT expiry verification (per-proof)
            // Circuit guarantees jwt_exp == jwt.exp; expiry confirmed on-chain
            // solhint-disable-next-line gas-strict-inequalities
            if (block.timestamp >= jwtExpList[i]) revert InvalidJwtExpiry();

            // 2-2. Groth16 proof verification
            uint256[8] memory verifyInputs;
            verifyInputs[0] = sharedInputs[0]; // hanchor
            verifyInputs[1] = sharedInputs[1]; // h_ctx
            verifyInputs[2] = sharedInputs[2]; // root
            verifyInputs[3] = sharedInputs[3]; // h_sign_userop
            verifyInputs[4] = jwtExpList[i];    // jwt_exp (per-proof)
            verifyInputs[5] = partialRhsList[i]; // partial_rhs (per-proof)
            verifyInputs[6] = sharedInputs[4];   // lhs
            verifyInputs[7] = sharedInputs[5];   // h_aud_list

            /* istanbul ignore next */
            if (!verifyWithProof(verifyInputs, proofs[i])) {
                revert VerificationFailed();
            }
        }

        return true;
    }

    function verifyWithProof(
        uint256[8] memory inputs,
        uint256[8] memory proof
    ) internal view returns (bool) {
        if (!Groth16Verifier._verify(inputs, proof)) revert VerificationFailed();
        return true;
    }

    function keyType() external pure override returns (KeyType) {
        return KeyType.keyZkOAuthRS256;
    }

    /// @notice Returns the anchor array registered for an account
    /// @param purpose Key purpose (Master or Tx)
    /// @param account Account address to query
    /// @param keyId Key slot index (0~4)
    /// @return Registered anchor array
    function getAnchor(KeyPurpose purpose, address account, uint256 keyId) external view returns (uint256[] memory) {
        ZkOAuthSlots storage slots = _getSlots(purpose, account);
        if (keyId >= slots.count) return new uint256[](0);
        return _getFullAnchors(purpose, account, keyId);
    }

    /// @notice Returns the cached Merkle roots for an account
    /// @param purpose Key purpose (Master or Tx)
    /// @param account Account address to query
    /// @param keyId Key slot index (0~4)
    /// @return cachedRoot0 First cached root
    /// @return cachedRoot1 Second cached root
    function getCachedRoots(KeyPurpose purpose, address account, uint256 keyId) external view returns (bytes32, bytes32) {
        ZkOAuthSlots storage slots = _getSlots(purpose, account);
        if (keyId >= slots.count) return (bytes32(0), bytes32(0));
        ZkOAuthData storage data = slots.entries[keyId];
        return (data.cachedRoot0, data.cachedRoot1);
    }

    /// @notice Returns the ZkOAuth registration data for an account
    /// @param purpose Key purpose (Master or Tx)
    /// @param account Account address to query
    /// @param keyId Key slot index (0~4)
    /// @return directory Merkle tree directory address
    /// @return n RSA modulus bit length
    /// @return k Number of required proofs
    /// @return hAudList Hash of the audience list
    function getData(KeyPurpose purpose, address account, uint256 keyId) external view returns (
        address directory,
        uint256 n,
        uint256 k,
        uint256 hAudList
    ) {
        ZkOAuthSlots storage slots = _getSlots(purpose, account);
        if (keyId >= slots.count) return (address(0), 0, 0, 0);
        ZkOAuthData storage data = slots.entries[keyId];
        return (address(data.directory), data.n, data.k, data.hAudList);
    }
}
