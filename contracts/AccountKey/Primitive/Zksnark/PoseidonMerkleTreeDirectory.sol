// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BaseMerkleTree.sol";
import "../../../Utils/PoseidonHash.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PoseidonMerkleTree
 * @notice Poseidon hash-based Merkle Tree implementation. Includes commitment insertion, root query,
 *         path query, and Merkle membership proof verification.
 * @dev Root update delay is enforced by the TimelockController (the Owner), not inside this contract.
 *      Since insertCm/updateCm/deleteCm calls themselves only execute after minDelay,
 *      contract-level activatesAt validation is unnecessary.
 */
contract PoseidonMerkleTreeDirectory is BaseMerkleTree, Ownable {
    error InvalidDepth();
    error LevelOutOfBounds();
    error CommitmentDoesNotExist();
    error CommitmentAlreadyExists();
    error CommitmentToRemoveDoesNotExist();
    error PubkeyHashDoesNotExist();
    error PubkeyHashAlreadyExists();
    error InvalidPubkeyHash();

    // Mappings for leaf lookup and duplicate insertion prevention
    mapping(bytes32 => uint256) public cmToIndex;
    mapping(uint256 => bytes32) public indexToCm;
    mapping(bytes32 => bool) public cmExists;
    mapping(bytes32 => uint256) public pubkeyHashToIndex;
    mapping(uint256 => bytes32) public indexToPubkeyHash;
    mapping(bytes32 => bool) public pubkeyHashExists;

    uint256 public constant ROOT_HISTORY_SIZE = 8;
    bytes32[8] public rootHistory;
    uint256 public latestRootIndex;
    uint256 public knownRootCount;

    event LeafInserted(bytes32 indexed leaf, uint256 indexed index, bytes32 root);
    event LeafUpdated(uint256 indexed index, bytes32 oldLeaf, bytes32 newLeaf, bytes32 root);
    event LeafDeleted(uint256 indexed index, bytes32 oldLeaf, bytes32 root);

    /// @param _depth Depth of the tree (actual leaf count = 2^(_depth-1), merkle path length = _depth-1)
    constructor(uint256 _depth) Ownable(msg.sender) {
        // solhint-disable-next-line gas-strict-inequalities
        if (_depth < 2 || _depth > 32) revert InvalidDepth();
        __BaseMerkleTree_init(_depth - 1);
    }

    /// @dev Poseidon hash implementation (left, right)
    function _hash(
        bytes32 left,
        bytes32 right
    ) internal pure override returns (bytes32) {
        return bytes32(PoseidonHashLib._hash(uint256(left), uint256(right)));
    }

    /// @notice Adds a single commitment as a leaf and returns (index, root).
    function insertCm(
        bytes32 cm,
        bytes32 pubkeyHash
    ) external onlyOwner returns (uint256 index, bytes32 root) {
        if (pubkeyHash == bytes32(0)) revert InvalidPubkeyHash();
        if (pubkeyHashExists[pubkeyHash]) revert PubkeyHashAlreadyExists();

        index = _getNumLeaves();
        _insert(cm);
        root = _recomputeRoot(1);

        _addRoot(root);
        _onLeafAdded(index, cm);

        // Set pubkeyHash-related mappings
        pubkeyHashToIndex[pubkeyHash] = index;
        indexToPubkeyHash[index] = pubkeyHash;
        pubkeyHashExists[pubkeyHash] = true;

        emit LeafInserted(cm, index, root);
    }

    /// @notice Replaces an already-inserted leaf with a new value.
    /// @dev The pubkeyHash mapping is preserved and not changed.
    function updateCm(
        uint256 idx,
        bytes32 newCm
    ) external onlyOwner returns (bytes32 root) {
        // Back up the previous leaf value
        bytes32 oldLeaf = _nodes[(2 ** (_DEPTH) - 1) + idx];

        // Clean up only the cm (preserve pubkeyHash mappings)
        _onCmRemoved(idx);
        _onLeafAdded(idx, newCm);

        _update(idx, newCm);
        root = _recomputeRootFromIndex(idx);

        _addRoot(root);

        emit LeafUpdated(idx, oldLeaf, newCm, root);
    }

    /// @notice Deletes (nullifies) an already-inserted leaf.
    function deleteCm(uint256 idx) external onlyOwner returns (bytes32 root) {
        // Back up the previous leaf value
        bytes32 oldLeaf = _nodes[(2 ** (_DEPTH) - 1) + idx];
        _delete(idx);
        root = _recomputeRootFromIndex(idx);

        _addRoot(root);
        _onLeafRemoved(idx);
        emit LeafDeleted(idx, oldLeaf, root);
    }

    /// @notice Returns the current Merkle root
    function getRoot() external view returns (bytes32) {
        return _getRoot();
    }

    /// @notice Returns the current number of inserted leaves
    function getNumLeaves() external view returns (uint256) {
        return _getNumLeaves();
    }

    /// @notice Returns the Merkle path for a specific leaf index
    function getMerklePath(uint256 idx) external view returns (bytes32[] memory) {
        return _computeMerklePath(idx);
    }

    /// @notice [DEBUG] Reads defaultValues[i] for each level.
    function getDefaultValue(uint256 level) external view returns (bytes32) {
        // solhint-disable-next-line gas-strict-inequalities
        if (level >= _DEPTH) revert LevelOutOfBounds();
        return _defaultValues[level];
    }

    /// @notice [DEBUG] Reads the raw hash stored at the leaf level (= _nodes[leafPos]).
    function getLeafNode(uint256 idx) external view returns (bytes32) {
        uint256 leafPos = (2 ** (_DEPTH) - 1) + idx;
        return _nodes[leafPos];
    }

    /// @notice Returns the index of the leaf for a given commitment (cm) if it exists in the tree.
    function getLeafIndex(bytes32 cm) external view returns (uint256) {
        if (!cmExists[cm]) revert CommitmentDoesNotExist();
        return cmToIndex[cm];
    }

    /// @notice Returns the index of the leaf for a given pubkeyHash if it exists in the tree.
    function getLeafIndexByPubkeyHash(
        bytes32 pubkeyHash
    ) external view returns (uint256) {
        if (!pubkeyHashExists[pubkeyHash]) revert PubkeyHashDoesNotExist();
        return pubkeyHashToIndex[pubkeyHash];
    }

    /// @notice Adds a new root to the root history. Overwrites the oldest root when the list is full.
    function _addRoot(bytes32 newRoot) internal {
        uint256 nextIndex;
        if (knownRootCount < ROOT_HISTORY_SIZE) {
            nextIndex = knownRootCount;
            ++knownRootCount;
        } else {
            nextIndex = (latestRootIndex + 1) % ROOT_HISTORY_SIZE;
        }
        rootHistory[nextIndex] = newRoot;
        latestRootIndex = nextIndex;
    }

    /// @notice Checks whether a root exists in the history
    function isRecentRoot(bytes32 root) external view returns (bool) {
        if (root == bytes32(0)) return false;
        for (uint256 i = 0; i < knownRootCount && i < ROOT_HISTORY_SIZE; ++i) {
            if (rootHistory[i] == root) return true;
        }
        return false;
    }

    /// @notice Returns the 2 most recent roots in descending order (execution timing is guaranteed by the TimelockController)
    function getRecentRoots() external view returns (bytes32 root0, bytes32 root1) {
        uint256 found = 0;
        for (uint256 i = 0; i < knownRootCount && i < ROOT_HISTORY_SIZE && found < 2; ++i) {
            uint256 idx = (latestRootIndex + ROOT_HISTORY_SIZE - i) % ROOT_HISTORY_SIZE;
            bytes32 r = rootHistory[idx];
            if (r != bytes32(0)) {
                if (found == 0) root0 = r;
                else root1 = r;
                ++found;
            }
        }
    }

    /// @notice Updates the related state (cmToIndex, indexToCm, cmExists) when a new leaf is added.
    function _onLeafAdded(uint256 index, bytes32 cm) internal {
        if (cmExists[cm]) revert CommitmentAlreadyExists();

        cmToIndex[cm] = index;
        indexToCm[index] = cm;
        cmExists[cm] = true;
    }

    /// @notice Cleans up the related state (cmToIndex, indexToCm, cmExists) when only the cm is removed.
    /// @dev The pubkeyHash mapping is preserved. Used by updateCm().
    function _onCmRemoved(uint256 index) internal {
        bytes32 cmToRemove = indexToCm[index];

        if (!cmExists[cmToRemove]) revert CommitmentToRemoveDoesNotExist();

        delete cmToIndex[cmToRemove];
        delete indexToCm[index];
        cmExists[cmToRemove] = false;
    }

    /// @notice Cleans up the related state (cmToIndex, indexToCm, cmExists, pubkeyHash mappings) when a leaf is removed.
    function _onLeafRemoved(uint256 index) internal {
        _onCmRemoved(index);

        // ZKAPSC-008: also clean up pubkeyHash-related mappings
        bytes32 pubkeyHash = indexToPubkeyHash[index];
        if (pubkeyHashExists[pubkeyHash]) {
            delete pubkeyHashToIndex[pubkeyHash];
            delete indexToPubkeyHash[index];
            pubkeyHashExists[pubkeyHash] = false;
        }
    }

    /// @notice [DEBUG] Verifies whether a Merkle path is valid.
    function verifyMerklePath(
        uint256 idx,
        bytes32[] calldata merklePath,
        bytes32 expectedRoot
    ) external view returns (bool) {
        uint256 leafPos = (2 ** (_DEPTH) - 1) + idx;
        bytes32 leaf = _nodes[leafPos];

        uint256 index = idx;
        for (uint256 i = 0; i < merklePath.length; ++i) {
            if ((index & 1) == 1) {
                leaf = _hash(merklePath[i], leaf); // right child
            } else {
                leaf = _hash(leaf, merklePath[i]); // left child
            }
            index >>= 1;
        }
        return leaf == expectedRoot;
    }
}
