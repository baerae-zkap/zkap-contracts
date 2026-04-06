// Copyright (c) 2015-2020 Clearmatics Technologies Ltd
// Copyright (c) 2021-2024 Zkrypto Inc.
// SPDX-License-Identifier: LGPL-3.0+

pragma solidity ^0.8.2;
/// Abstract Merkle tree implementation. Child classes should implement the
/// hash function.
///
/// The Merkle tree implementation must trade-off complexity, storage,
/// initialization cost, and update & root computation cost.
///
/// This implementation stores all leaves and nodes, skipping those that have
/// not been populated yet. Default values for each layer are stored separately
/// in _defaultValues array, not in _nodes.
abstract contract BaseMerkleTree {
    error CannotAppendAnymore();
    error BadIndex();

    // Depth of the merkle tree
    // solhint-disable-next-line var-name-mixedcase
    uint256 internal _DEPTH;

    // Number of leaves
    // solhint-disable-next-line var-name-mixedcase
    uint256 internal _MAX_NUM_LEAVES;

    // Number of nodes
    // solhint-disable-next-line var-name-mixedcase
    uint256 internal _MAX_NUM_NODES;

    uint256 internal constant _MASK_LS_BIT = ~uint256(1);

    bytes32 internal constant _DEFAULT_NODE_VALUE = bytes32(0);

    mapping(uint256 => bytes32) public _nodes;

    bytes32[] internal _defaultValues;

    // Number of leaves populated in `nodes`.
    uint256 internal _numLeaves;

    // Debug only
    event LogDebug(bytes32 message);

    // solhint-disable-next-line func-name-mixedcase
    /* istanbul ignore next */
    function __BaseMerkleTree_init(uint256 depth) internal {
        __BaseMerkleTree_init_unchained(depth);
    }

    // solhint-disable-next-line func-name-mixedcase
    /* istanbul ignore next */
    function __BaseMerkleTree_init_unchained(
        uint256 depth
    ) internal {
        require(_DEPTH == 0, "already initialized");
        _DEPTH = depth;
        _MAX_NUM_LEAVES = 2 ** _DEPTH;
        _MAX_NUM_NODES = (_MAX_NUM_LEAVES * 2) - 1;
        _defaultValues = new bytes32[](_DEPTH);
        _initDefaultValues();
    }

    function _initDefaultValues() private {
        _defaultValues[0] = _hash(0, 0);

        for (uint256 i = 1; i < _DEPTH; ++i) {
            // Store default values for each layer
            _defaultValues[i] = _hash(
                _defaultValues[i - 1],
                _defaultValues[i - 1]
            );
        }

        // Initialize default root
        _nodes[0] = _hash(
            _defaultValues[_DEPTH - 1],
            _defaultValues[_DEPTH - 1]
        );
    }

    /// Appends a commitment to the tree, and returns its address
    function _insert(bytes32 commitment) internal {
        // If this require fails => the merkle tree is full, we can't append
        // leaves anymore.
        // solhint-disable-next-line gas-strict-inequalities
        if (_numLeaves >= _MAX_NUM_LEAVES) revert CannotAppendAnymore();

        // A hash of commitment is appended to merkle tree
        // Updated _hash(commitment, commitment) to _hash(commitment, 0) to align with Poseidon hash specifications.
        // The second input is fixed to 0 for consistency in Merkle tree leaf hashing
        bytes32 hashedCommitment = _hash(commitment, 0);

        // Address of the next leaf is the current number of leaves (before
        // insertion).  Compute the next index in the full set of nodes, and
        // write.
        uint256 nextAddress = _numLeaves;
        ++_numLeaves;
        uint256 nextEntryIdx = (_MAX_NUM_LEAVES - 1) + nextAddress;

        _nodes[nextEntryIdx] = hashedCommitment;
    }

    function _update(uint256 idx, bytes32 newCm) internal {
        // solhint-disable-next-line gas-strict-inequalities
        /* istanbul ignore if */
        if (idx >= _numLeaves) revert BadIndex();
        uint256 leafPos = (_MAX_NUM_LEAVES - 1) + idx;
        _nodes[leafPos] = _hash(newCm, bytes32(0));
    }

    function _delete(uint256 idx) internal {
        // solhint-disable-next-line gas-strict-inequalities
        if (idx >= _numLeaves) revert BadIndex();
        uint256 leafPos = (_MAX_NUM_LEAVES - 1) + idx;
        _nodes[leafPos] = _defaultValues[0];
    }

    /// Abstract hash function to be supplied by a concrete implementation of
    /// this class.
    function _hash(
        bytes32 left,
        bytes32 right
    ) internal virtual returns (bytes32);

    function _recomputeRoot(uint256 numNewLeaves) internal returns (bytes32) {
        // Assume `numNewLeaves` have been written into the leaf slots.
        // Update any affected nodes in the tree, up to the root, using the
        // default values for any missing nodes.

        uint256 endIdx = _numLeaves;
        uint256 startIdx = _numLeaves - numNewLeaves;

        for (uint256 i = 0; i < _DEPTH; ++i) {
            (startIdx, endIdx) = _recomputeParentLayer(i, startIdx, endIdx);
        }

        return _nodes[0];
    }

    /// @dev Recomputes the root from a specific leaf index up to the root.
    ///      Used for update and delete operations on arbitrary indices.
    function _recomputeRootFromIndex(uint256 leafIndex) internal returns (bytes32) {
        uint256 nodeIdx = (_MAX_NUM_LEAVES - 1) + leafIndex;

        for (uint256 layer = 0; layer < _DEPTH; ++layer) {
            uint256 siblingIdx;
            uint256 parentIdx;
            bytes32 left;
            bytes32 right;

            // Determine if current node is left (even) or right (odd) child
            if (nodeIdx % 2 == 1) {
                // nodeIdx is left child (odd in 0-indexed array where parent = (n-1)/2)
                siblingIdx = nodeIdx + 1;
                parentIdx = (nodeIdx - 1) / 2;
                left = _nodes[nodeIdx];
                right = _getNodeOrDefault(siblingIdx, layer);
            } else {
                // nodeIdx is right child (even)
                siblingIdx = nodeIdx - 1;
                parentIdx = (nodeIdx - 1) / 2;
                left = _getNodeOrDefault(siblingIdx, layer);
                right = _nodes[nodeIdx];
            }

            _nodes[parentIdx] = _hash(left, right);
            nodeIdx = parentIdx;
        }

        return _nodes[0];
    }

    /// @dev Returns the node value or the default value for the layer if not set
    function _getNodeOrDefault(uint256 nodeIdx, uint256 layer) internal view returns (bytes32) {
        bytes32 value = _nodes[nodeIdx];
        if (value == _DEFAULT_NODE_VALUE) {
            return _defaultValues[layer];
        }
        return value;
    }

    /// Recompute nodes in the parent layer that are affected by entries
    /// [childStartIdx, childEndIdx] in the child layer.  If
    /// `childEndIdx` is required in the calculation, the final entry of
    /// the child layer is used (since this contains the default entry for
    /// the layer if the tree is not full).
    ///
    ///            /     \         /     \         /     \
    /// Parent:   ?       ?       F       G       H       0
    ///          / \     / \     / \     / \     / \     / \
    /// Child:  ?   ?   ?   ?   A   B   C   D   E   ?   ?   0
    ///                         ^                   ^
    ///                  childStartIdx          childEndIdx
    ///
    /// Returns the start and end indices (within the parent layer) of touched
    /// parent nodes.
    function _recomputeParentLayer(
        uint256 childLayer,
        uint256 childStartIdx,
        uint256 childEndIdx
    ) private returns (uint256, uint256) {
        uint256 childLayerStart = 2 ** (_DEPTH - childLayer) - 1;

        // Start at the right and iterate left, so we only execute the
        // default_value logic once.  childLeftIdxRend (reverse-end) is the
        // smallest value of childLeftIdx at which we should recompute the
        // parent node hash.

        uint256 childLeftIdxRend = childLayerStart +
            (childStartIdx & _MASK_LS_BIT);

        // If childEndIdx is odd, it is the RIGHT of a computation we need
        // to make. Do the computation using the default value, and move to
        // the next pair (on the left).
        // Otherwise, we have a fully populated pair.

        uint256 childLeftIdx;
        if ((childEndIdx & 1) != 0) {
            // odd
            childLeftIdx = childLayerStart + childEndIdx - 1;
            _nodes[(childLeftIdx - 1) / 2] = _hash(
                _nodes[childLeftIdx],
                _defaultValues[childLayer]
            );
        } else {
            //  even
            childLeftIdx = childLayerStart + childEndIdx;
        }

        // At this stage, pairs are all populated. Compute until we reach
        // childLeftIdxRend.

        while (childLeftIdx > childLeftIdxRend) {
            childLeftIdx = childLeftIdx - 2;
            _nodes[(childLeftIdx - 1) / 2] = _hash(
                _nodes[childLeftIdx],
                _nodes[childLeftIdx + 1]
            );
        }

        return (childStartIdx / 2, (childEndIdx + 1) / 2);
    }

    function _computeMerklePath(
        uint256 index
    ) public view returns (bytes32[] memory) {
        // ZKAPSC-010: add index range validation
        // solhint-disable-next-line gas-strict-inequalities
        if (index >= _numLeaves) revert BadIndex();

        // Given an index into leaves of a Merkle tree, compute the path to the root.
        bytes32[] memory merklePath = new bytes32[](_DEPTH);

        for (uint256 i = 0; i < _DEPTH; ++i) {
            if (index & 0x01 != 0) {
                merklePath[i] = _getNode(index - 1, i);
            } else {
                merklePath[i] = _getNode(index + 1, i);
            }
            index >>= 1;
        }

        return merklePath;
    }

    function _getNode(
        uint256 index,
        uint256 layer
    ) private view returns (bytes32) {
        if (_nodes[2 ** (_DEPTH - layer) - 1 + index] == _DEFAULT_NODE_VALUE) {
            return _defaultValues[layer];
        }
        return _nodes[2 ** (_DEPTH - layer) - 1 + index];
    }

    function _getRoot() public view returns (bytes32) {
        return _nodes[0];
    }

    function _getNumLeaves() public view returns (uint256) {
        return _numLeaves;
    }
}
