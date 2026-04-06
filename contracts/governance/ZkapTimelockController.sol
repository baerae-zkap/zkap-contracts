// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "../AccountKey/Primitive/Zksnark/PoseidonMerkleTreeDirectory.sol";

/**
 * @title ZkapTimelockController
 * @notice Inherits TimelockController and deploys PoseidonMerkleTreeDirectory directly in the constructor.
 * @dev Since this contract becomes the owner of PoseidonMerkleTreeDirectory at deploy time,
 *      there is no window in which the deployer holds ownership.
 *      insertCm/updateCm/deleteCm can only execute after minDelay has elapsed.
 */
contract ZkapTimelockController is TimelockController {
    PoseidonMerkleTreeDirectory public immutable directory;

    /**
     * @param minDelay    Minimum delay before a queued operation can be executed (in seconds)
     * @param proposers   List of PROPOSER_ROLE holders (scheduling rights for insertCm etc., multisig recommended)
     * @param executors   List of EXECUTOR_ROLE holders (address(0) = anyone can execute)
     * @param admin       DEFAULT_ADMIN_ROLE holder (recommend renouncing after deployment)
     * @param treeDepth   Initial depth for PoseidonMerkleTreeDirectory
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin,
        uint256 treeDepth
    ) TimelockController(minDelay, proposers, executors, admin) {
        PoseidonMerkleTreeDirectory dir = new PoseidonMerkleTreeDirectory(treeDepth);
        directory = dir;
    }
}
