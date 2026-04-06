import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const DEPTH = 4;

async function deployPoseidonMerkleTreeDirectory(depth: number = DEPTH) {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const nonOwner = signers[1];

  // Deploy PoseidonHashLib
  const PoseidonHashLibFactory = await ethers.getContractFactory("PoseidonHashLib");
  const poseidonHashLib = await PoseidonHashLibFactory.deploy();
  await poseidonHashLib.waitForDeployment();

  // Deploy PoseidonMerkleTreeDirectory with library
  const PoseidonMerkleTreeDirectoryFactory = await ethers.getContractFactory("PoseidonMerkleTreeDirectory", {
    libraries: {
      PoseidonHashLib: await poseidonHashLib.getAddress(),
    },
  });
  const poseidonMerkleTreeDirectory = await PoseidonMerkleTreeDirectoryFactory.deploy(depth);
  await poseidonMerkleTreeDirectory.waitForDeployment();

  return { poseidonMerkleTreeDirectory, poseidonHashLib, owner, nonOwner };
}

describe("PoseidonMerkleTreeDirectory", function () {
  describe("Deployment", function () {
    // CNT-250: contract deployment success
    it("Should deploy PoseidonMerkleTreeDirectory successfully", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);
      expect(await poseidonMerkleTreeDirectory.getAddress()).to.be.properAddress;
    });

    // CNT-251: verify depth initialization
    it("Should initialize with correct depth", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);
      // After initialization, the tree should be empty
      expect(await poseidonMerkleTreeDirectory.getNumLeaves()).to.equal(0);
    });

    // CNT-253: revert when depth < 2
    it("revert when depth is too small (less than 2)", async function () {
      const { poseidonHashLib } = await loadFixture(deployPoseidonMerkleTreeDirectory);
      const PoseidonMerkleTreeDirectoryFactory = await ethers.getContractFactory("PoseidonMerkleTreeDirectory", {
        libraries: { PoseidonHashLib: await poseidonHashLib.getAddress() },
      });
      await expect(PoseidonMerkleTreeDirectoryFactory.deploy(1)).to.be.revertedWithCustomError(
        PoseidonMerkleTreeDirectoryFactory,
        "InvalidDepth"
      );
    });

    // CNT-254: revert when depth > 32
    it("revert when depth is too large (greater than 32)", async function () {
      const { poseidonHashLib } = await loadFixture(deployPoseidonMerkleTreeDirectory);
      const PoseidonMerkleTreeDirectoryFactory = await ethers.getContractFactory("PoseidonMerkleTreeDirectory", {
        libraries: { PoseidonHashLib: await poseidonHashLib.getAddress() },
      });
      await expect(PoseidonMerkleTreeDirectoryFactory.deploy(33)).to.be.revertedWithCustomError(
        PoseidonMerkleTreeDirectoryFactory,
        "InvalidDepth"
      );
    });
  });

  describe("Leaf Management - insertCm", function () {
    // CNT-255: insert commitment and update root
    it("Should insert commitment and update root", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const numBefore = await poseidonMerkleTreeDirectory.getNumLeaves();
      const rootBefore = await poseidonMerkleTreeDirectory.getRoot();

      const randomCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      const [retIndex, retRoot] = await poseidonMerkleTreeDirectory.insertCm.staticCall(randomCommitment, pubkeyHash);

      const tx = await poseidonMerkleTreeDirectory.insertCm(randomCommitment, pubkeyHash);
      await tx.wait();

      const numAfter = await poseidonMerkleTreeDirectory.getNumLeaves();
      const rootAfter = await poseidonMerkleTreeDirectory.getRoot();

      // Verify insertion
      expect(retIndex).to.equal(numBefore);
      expect(retRoot).to.equal(rootAfter);
      expect(numAfter).to.equal(numBefore + 1n);
      expect(rootAfter).to.not.equal(rootBefore);

      expect(await poseidonMerkleTreeDirectory.cmExists(randomCommitment)).to.equal(true);
      expect(await poseidonMerkleTreeDirectory.cmToIndex(randomCommitment)).to.equal(numBefore);
      expect(await poseidonMerkleTreeDirectory.indexToCm(numBefore)).to.equal(randomCommitment);
    });

    // CNT-256: emit LeafInserted event
    it("emit LeafInserted event", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const randomCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await expect(poseidonMerkleTreeDirectory.insertCm(randomCommitment, pubkeyHash))
        .to.emit(poseidonMerkleTreeDirectory, "LeafInserted");
    });

    // CNT-257: revert when inserting duplicate commitment
    it("revert when inserting duplicate commitment", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const randomCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash1 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash2 = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(randomCommitment, pubkeyHash1);

      // Same commitment, different pubkeyHash
      await expect(
        poseidonMerkleTreeDirectory.insertCm(randomCommitment, pubkeyHash2)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "CommitmentAlreadyExists");
    });

    // ZKAPSC-008: revert when inserting duplicate pubkeyHash
    it("revert when inserting duplicate pubkeyHash", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment1 = ethers.hexlify(ethers.randomBytes(32));
      const commitment2 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(commitment1, pubkeyHash);

      // Different commitment, same pubkeyHash
      await expect(
        poseidonMerkleTreeDirectory.insertCm(commitment2, pubkeyHash)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "PubkeyHashAlreadyExists");
    });

    // ZKAPSC-008: revert when inserting bytes32(0) pubkeyHash
    it("revert when inserting with zero pubkeyHash", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment = ethers.hexlify(ethers.randomBytes(32));

      await expect(
        poseidonMerkleTreeDirectory.insertCm(commitment, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "InvalidPubkeyHash");
    });

    // CNT-258: revert when exceeding max number of leaves
    it("revert when inserting more than max leaves", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const maxLeaves = 2 ** (DEPTH - 1);
      for (let i = 0; i < maxLeaves; i++) {
        const randomCommitment = ethers.hexlify(ethers.randomBytes(32));
        const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
        await poseidonMerkleTreeDirectory.insertCm(randomCommitment, pubkeyHash);
      }

      const randomCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await expect(
        poseidonMerkleTreeDirectory.insertCm(randomCommitment, pubkeyHash)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "CannotAppendAnymore");
    });

    // CNT-259: store pubkeyHash to index mapping
    it("store pubkeyHash to index mapping", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const randomCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(randomCommitment, pubkeyHash);

      expect(await poseidonMerkleTreeDirectory.getLeafIndexByPubkeyHash(pubkeyHash)).to.equal(0);
    });

    // ZKAPSC-008: revert when querying non-existent pubkeyHash
    it("revert getLeafIndexByPubkeyHash for non-existent pubkeyHash", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const nonExistentPubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await expect(
        poseidonMerkleTreeDirectory.getLeafIndexByPubkeyHash(nonExistentPubkeyHash)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "PubkeyHashDoesNotExist");
    });

    // CNT-260: non-owner insertCm revert
    it("revert when non-owner tries to insert", async function () {
      const { poseidonMerkleTreeDirectory, nonOwner } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const randomCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await expect(
        poseidonMerkleTreeDirectory.connect(nonOwner).insertCm(randomCommitment, pubkeyHash)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "OwnableUnauthorizedAccount");
    });
  });

  describe("Leaf Management - updateCm", function () {
    // CNT-261: update an existing leaf
    it("Should update an existing leaf", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const oldCommitment = ethers.hexlify(ethers.randomBytes(32));
      const newCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(oldCommitment, pubkeyHash);
      const oldRoot = await poseidonMerkleTreeDirectory.getRoot();

      await expect(poseidonMerkleTreeDirectory.updateCm(0, newCommitment)).to.emit(
        poseidonMerkleTreeDirectory,
        "LeafUpdated"
      );

      const newRoot = await poseidonMerkleTreeDirectory.getRoot();
      expect(newRoot).to.not.equal(oldRoot);
      expect(await poseidonMerkleTreeDirectory.cmExists(oldCommitment)).to.be.false;
      expect(await poseidonMerkleTreeDirectory.cmExists(newCommitment)).to.be.true;
      expect(await poseidonMerkleTreeDirectory.indexToCm(0)).to.equal(newCommitment);
    });

    // ZKAPSC-008: verify pubkeyHash mapping is preserved after update
    it("Should preserve pubkeyHash mapping after update", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const oldCommitment = ethers.hexlify(ethers.randomBytes(32));
      const newCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(oldCommitment, pubkeyHash);

      // Verify pubkeyHash mapping before update
      expect(await poseidonMerkleTreeDirectory.getLeafIndexByPubkeyHash(pubkeyHash)).to.equal(0);

      await poseidonMerkleTreeDirectory.updateCm(0, newCommitment);

      // pubkeyHash mapping should still be preserved after update
      expect(await poseidonMerkleTreeDirectory.getLeafIndexByPubkeyHash(pubkeyHash)).to.equal(0);
      expect(await poseidonMerkleTreeDirectory.pubkeyHashExists(pubkeyHash)).to.be.true;
    });

    // CNT-262: revert when updating non-existent leaf
    it("revert when updating non-existent leaf", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const newCommitment = ethers.hexlify(ethers.randomBytes(32));

      // No leaf has been inserted, so index 0 does not have a valid commitment
      await expect(
        poseidonMerkleTreeDirectory.updateCm(0, newCommitment)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "CommitmentToRemoveDoesNotExist");
    });

    // CNT-263: revert when updating out-of-bounds index
    it("revert when updating out of bounds index", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      // Insert 1 leaf, then try to update index 5 (out of bounds)
      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const newCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      // _numLeaves = 1, so index 5 is out of bounds - caught by _onLeafRemoved
      await expect(
        poseidonMerkleTreeDirectory.updateCm(5, newCommitment)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "CommitmentToRemoveDoesNotExist");
    });

    // CNT-264: non-owner updateCm revert
    it("revert when non-owner tries to update", async function () {
      const { poseidonMerkleTreeDirectory, nonOwner } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const newCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      await expect(
        poseidonMerkleTreeDirectory.connect(nonOwner).updateCm(0, newCommitment)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "OwnableUnauthorizedAccount");
    });
  });

  describe("Leaf Management - deleteCm", function () {
    // CNT-265: delete a leaf (nullify)
    it("Should delete a leaf by nullifying it", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);
      const oldCommitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(oldCommitment, pubkeyHash);
      const oldRoot = await poseidonMerkleTreeDirectory.getRoot();

      await expect(poseidonMerkleTreeDirectory.deleteCm(0)).to.emit(
        poseidonMerkleTreeDirectory,
        "LeafDeleted"
      );

      const newRoot = await poseidonMerkleTreeDirectory.getRoot();
      expect(newRoot).to.not.equal(oldRoot);
      expect(await poseidonMerkleTreeDirectory.cmExists(oldCommitment)).to.be.false;

      // Deleted node should equal default value
      const defaultValue0 = await poseidonMerkleTreeDirectory.getDefaultValue(0);
      expect(await poseidonMerkleTreeDirectory.getLeafNode(0)).to.equal(defaultValue0);
    });

    // ZKAPSC-008: verify pubkeyHash mapping is cleaned up after deletion
    it("Should clean up pubkeyHash mapping after deletion", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);
      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      // Verify pubkeyHash mapping exists
      expect(await poseidonMerkleTreeDirectory.getLeafIndexByPubkeyHash(pubkeyHash)).to.equal(0);

      await poseidonMerkleTreeDirectory.deleteCm(0);

      // Verify pubkeyHash mapping is cleaned up after deletion
      await expect(
        poseidonMerkleTreeDirectory.getLeafIndexByPubkeyHash(pubkeyHash)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "PubkeyHashDoesNotExist");

      // Should be able to insert a new commitment with the same pubkeyHash
      const newCommitment = ethers.hexlify(ethers.randomBytes(32));
      await expect(
        poseidonMerkleTreeDirectory.insertCm(newCommitment, pubkeyHash)
      ).to.not.be.reverted;
    });

    // CNT-266: revert when deleting non-existent leaf
    it("revert when deleting non-existent leaf", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      // First insert a leaf, then delete it, then try to delete again
      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);
      await poseidonMerkleTreeDirectory.deleteCm(0);

      await expect(
        poseidonMerkleTreeDirectory.deleteCm(0)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "CommitmentToRemoveDoesNotExist");
    });

    // CNT-267: revert when deleting out-of-bounds index
    it("revert when deleting out of bounds index", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      // Insert 1 leaf, then try to delete index 5 (out of bounds)
      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      // _numLeaves = 1, so index 5 is out of bounds
      await expect(
        poseidonMerkleTreeDirectory.deleteCm(5)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "BadIndex");
    });

    // CNT-268: non-owner deleteCm revert
    it("revert when non-owner tries to delete", async function () {
      const { poseidonMerkleTreeDirectory, nonOwner } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      await expect(
        poseidonMerkleTreeDirectory.connect(nonOwner).deleteCm(0)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "OwnableUnauthorizedAccount");
    });
  });

  describe("Root Management", function () {
    // CNT-269: manage the most recent 8 roots (ROOT_HISTORY_SIZE = 8)
    it("Should correctly manage root history with size 8", async function () {
      // Deploy with depth 5 to allow 2^(5-1) = 16 leaves (enough for 9 insertions)
      const { poseidonMerkleTreeDirectory } = await deployPoseidonMerkleTreeDirectory(5);

      const roots = [];

      // Insert 8 leaves to fill the history
      for (let i = 0; i < 8; i++) {
        const commitment = ethers.hexlify(ethers.randomBytes(32));
        const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
        await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);
        roots[i] = await poseidonMerkleTreeDirectory.getRoot();
        expect(await poseidonMerkleTreeDirectory.isRecentRoot(roots[i])).to.be.true;
      }

      // All 8 roots should be in history
      for (let i = 0; i < 8; i++) {
        expect(await poseidonMerkleTreeDirectory.isRecentRoot(roots[i])).to.be.true;
      }

      // Insert 9th leaf (root0 should be removed from history)
      const commitment9 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash9 = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment9, pubkeyHash9);
      const root9 = await poseidonMerkleTreeDirectory.getRoot();

      expect(await poseidonMerkleTreeDirectory.isRecentRoot(roots[0])).to.be.false;
      expect(await poseidonMerkleTreeDirectory.isRecentRoot(roots[1])).to.be.true;
      expect(await poseidonMerkleTreeDirectory.isRecentRoot(root9)).to.be.true;
    });

    // CNT-270: return false for zero root
    it("return false for zero root", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);
      expect(await poseidonMerkleTreeDirectory.isRecentRoot(ethers.ZeroHash)).to.be.false;
    });

    // CNT-271: return false for unknown root
    it("return false for unknown root", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);
      const randomRoot = ethers.hexlify(ethers.randomBytes(32));
      expect(await poseidonMerkleTreeDirectory.isRecentRoot(randomRoot)).to.be.false;
    });
  });

  describe("View Functions", function () {
    // CNT-272: getLeafIndex returns correct index
    it("getLeafIndex returns correct index", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment1 = ethers.hexlify(ethers.randomBytes(32));
      const commitment2 = ethers.hexlify(ethers.randomBytes(32));
      const commitment3 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash1 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash2 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash3 = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(commitment1, pubkeyHash1);
      expect(await poseidonMerkleTreeDirectory.getLeafIndex(commitment1)).to.equal(0n);

      await poseidonMerkleTreeDirectory.insertCm(commitment2, pubkeyHash2);
      expect(await poseidonMerkleTreeDirectory.getLeafIndex(commitment2)).to.equal(1n);

      await poseidonMerkleTreeDirectory.insertCm(commitment3, pubkeyHash3);
      expect(await poseidonMerkleTreeDirectory.getLeafIndex(commitment3)).to.equal(2n);
    });

    // CNT-273: revert getLeafIndex for non-existent commitment
    it("revert getLeafIndex for non-existent commitment", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const randomCommitment = ethers.hexlify(ethers.randomBytes(32));
      await expect(
        poseidonMerkleTreeDirectory.getLeafIndex(randomCommitment)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "CommitmentDoesNotExist");
    });

    // CNT-274: getRoot returns current root
    it("getRoot returns current root", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const initialRoot = await poseidonMerkleTreeDirectory.getRoot();
      expect(initialRoot).to.not.equal(ethers.ZeroHash);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      const newRoot = await poseidonMerkleTreeDirectory.getRoot();
      expect(newRoot).to.not.equal(initialRoot);
    });

    // CNT-275: getNumLeaves returns correct count
    it("getNumLeaves returns correct count", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      expect(await poseidonMerkleTreeDirectory.getNumLeaves()).to.equal(0);

      for (let i = 0; i < 3; i++) {
        const commitment = ethers.hexlify(ethers.randomBytes(32));
        const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
        await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);
        expect(await poseidonMerkleTreeDirectory.getNumLeaves()).to.equal(i + 1);
      }
    });

    // CNT-276: getDefaultValue returns value for each level
    it("getDefaultValue returns value for each level", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      for (let level = 0; level < DEPTH - 1; level++) {
        const defaultValue = await poseidonMerkleTreeDirectory.getDefaultValue(level);
        expect(defaultValue).to.not.equal(ethers.ZeroHash);
      }
    });

    // CNT-277: revert getDefaultValue for out-of-bounds level
    it("revert getDefaultValue for out of bounds level", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      await expect(
        poseidonMerkleTreeDirectory.getDefaultValue(DEPTH)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "LevelOutOfBounds");
    });

    // CNT-278: getLeafNode returns non-zero value
    it("getLeafNode returns non-zero value after insertion", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      const leafNode = await poseidonMerkleTreeDirectory.getLeafNode(0);
      // The leaf node stores the commitment (may be hashed internally)
      expect(leafNode).to.not.equal(ethers.ZeroHash);
    });

    // CNT-279: getMerklePath returns correct path length
    it("getMerklePath returns correct path length", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      const merkleProof = await poseidonMerkleTreeDirectory.getMerklePath(0);
      expect(merkleProof.length).to.equal(DEPTH - 1);
    });

    // ZKAPSC-009: revert getMerklePath for out-of-bounds index
    it("revert getMerklePath for out of bounds index", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      // Revert when querying index 0 with no leaves inserted
      await expect(
        poseidonMerkleTreeDirectory.getMerklePath(0)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "BadIndex");

      // Revert when querying index 5 after inserting 1 leaf
      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      await expect(
        poseidonMerkleTreeDirectory.getMerklePath(5)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "BadIndex");
    });

    // getRecentRoots: returns 2 most recent roots in descending order
    it("getRecentRoots returns newest roots first", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment1 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash1 = ethers.hexlify(ethers.randomBytes(32));
      const commitment2 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash2 = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(commitment1, pubkeyHash1);
      const root1 = await poseidonMerkleTreeDirectory.getRoot();

      await poseidonMerkleTreeDirectory.insertCm(commitment2, pubkeyHash2);
      const root2 = await poseidonMerkleTreeDirectory.getRoot();

      const [recentRoot0, recentRoot1] = await poseidonMerkleTreeDirectory.getRecentRoots();

      // Most recent is root0
      expect(recentRoot0).to.equal(root2);
      expect(recentRoot1).to.equal(root1);
    });
  });

  describe("Merkle Proof Verification", function () {
    // CNT-280: verify a valid Merkle proof
    it("Should verify a valid Merkle proof", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      const merkleProof = await poseidonMerkleTreeDirectory.getMerklePath(0);
      const root = await poseidonMerkleTreeDirectory.getRoot();
      const isValid = await poseidonMerkleTreeDirectory.verifyMerklePath(0, [...merkleProof], root);
      expect(isValid).to.be.true;
    });

    // CNT-281: verify multiple Merkle proofs
    it("Should verify multiple Merkle proofs", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const numLeaves = 5;
      for (let i = 0; i < numLeaves; i++) {
        const commitment = ethers.hexlify(ethers.randomBytes(32));
        const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
        await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);
      }

      const root = await poseidonMerkleTreeDirectory.getRoot();
      for (let i = 0; i < numLeaves; i++) {
        const merkleProof = await poseidonMerkleTreeDirectory.getMerklePath(i);
        const isValid = await poseidonMerkleTreeDirectory.verifyMerklePath(i, [...merkleProof], root);
        expect(isValid).to.be.true;
      }
    });

    // CNT-282: return false for invalid Merkle proof
    it("Should return false for invalid Merkle proof", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);

      const merkleProof = await poseidonMerkleTreeDirectory.getMerklePath(0);
      const wrongRoot = ethers.hexlify(ethers.randomBytes(32));
      const isValid = await poseidonMerkleTreeDirectory.verifyMerklePath(0, [...merkleProof], wrongRoot);
      expect(isValid).to.be.false;
    });
  });

  describe("Branch Coverage - Right Child Path", function () {
    // Test right child path in _recomputeRootFromIndex (even nodeIdx)
    it("Should correctly recompute root when updating leaf at index 1 (right child path)", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      // Insert two leaves to ensure we can test index 1
      const commitment0 = ethers.hexlify(ethers.randomBytes(32));
      const commitment1 = ethers.hexlify(ethers.randomBytes(32));
      const newCommitment1 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash0 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash1 = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(commitment0, pubkeyHash0);
      await poseidonMerkleTreeDirectory.insertCm(commitment1, pubkeyHash1);

      const rootBefore = await poseidonMerkleTreeDirectory.getRoot();

      // Update leaf at index 1 (triggers right child path in _recomputeRootFromIndex)
      await poseidonMerkleTreeDirectory.updateCm(1, newCommitment1);

      const rootAfter = await poseidonMerkleTreeDirectory.getRoot();
      expect(rootAfter).to.not.equal(rootBefore);
      expect(await poseidonMerkleTreeDirectory.indexToCm(1)).to.equal(newCommitment1);
    });

    it("Should correctly recompute root when deleting leaf at index 1 (right child path)", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      // Insert two leaves
      const commitment0 = ethers.hexlify(ethers.randomBytes(32));
      const commitment1 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash0 = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash1 = ethers.hexlify(ethers.randomBytes(32));

      await poseidonMerkleTreeDirectory.insertCm(commitment0, pubkeyHash0);
      await poseidonMerkleTreeDirectory.insertCm(commitment1, pubkeyHash1);

      const rootBefore = await poseidonMerkleTreeDirectory.getRoot();

      // Delete leaf at index 1 (triggers right child path)
      await poseidonMerkleTreeDirectory.deleteCm(1);

      const rootAfter = await poseidonMerkleTreeDirectory.getRoot();
      expect(rootAfter).to.not.equal(rootBefore);
      expect(await poseidonMerkleTreeDirectory.cmExists(commitment1)).to.be.false;
    });

    it("Should handle getMerklePath for odd index (tests both branches of path computation)", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      // Insert three leaves to test various indices
      for (let i = 0; i < 3; i++) {
        const commitment = ethers.hexlify(ethers.randomBytes(32));
        const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
        await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);
      }

      // Get merkle path for index 1 (odd index - tests right sibling selection)
      const merklePath1 = await poseidonMerkleTreeDirectory.getMerklePath(1);
      expect(merklePath1.length).to.equal(DEPTH - 1);

      // Verify the path is valid
      const root = await poseidonMerkleTreeDirectory.getRoot();
      const isValid = await poseidonMerkleTreeDirectory.verifyMerklePath(1, [...merklePath1], root);
      expect(isValid).to.be.true;
    });

    it("Should handle _getNodeOrDefault returning actual value (not default)", async function () {
      const { poseidonMerkleTreeDirectory } = await loadFixture(deployPoseidonMerkleTreeDirectory);

      // Insert multiple leaves to populate sibling nodes
      for (let i = 0; i < 4; i++) {
        const commitment = ethers.hexlify(ethers.randomBytes(32));
        const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));
        await poseidonMerkleTreeDirectory.insertCm(commitment, pubkeyHash);
      }

      // Update leaf at index 2 - this will trigger _getNodeOrDefault to return actual values
      // because siblings at index 3 will have real values
      const newCommitment = ethers.hexlify(ethers.randomBytes(32));
      await poseidonMerkleTreeDirectory.updateCm(2, newCommitment);

      const root = await poseidonMerkleTreeDirectory.getRoot();
      expect(root).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("TimelockController integration", function () {
    const TIMELOCK_MIN_DELAY = 60; // 60 seconds (shortened for testing)

    async function deployWithTimelockFixture() {
      const signers = await ethers.getSigners();
      const owner = signers[0];
      const nonOwner = signers[1];
      const canceller = signers[2]; // simulates security committee role

      // Deploy PoseidonHashLib (required for linking ZkapTimelockController)
      const PoseidonHashLibFactory = await ethers.getContractFactory("PoseidonHashLib");
      const poseidonHashLib = await PoseidonHashLibFactory.deploy();
      await poseidonHashLib.waitForDeployment();

      // Deploy ZkapTimelockController — deploys PoseidonMerkleTreeDirectory directly in constructor
      // There is no window where the deployer is the owner
      const ZkapTimelockControllerFactory = await ethers.getContractFactory("ZkapTimelockController", {
        libraries: { PoseidonHashLib: await poseidonHashLib.getAddress() },
      });
      const timelock = await ZkapTimelockControllerFactory.deploy(
        TIMELOCK_MIN_DELAY,
        [owner.address], // PROPOSER_ROLE
        [owner.address], // EXECUTOR_ROLE
        owner.address,   // DEFAULT_ADMIN_ROLE
        DEPTH            // treeDepth
      );
      await timelock.waitForDeployment();

      // Reference the PoseidonMerkleTreeDirectory deployed internally
      const poseidonMerkleTreeDirectory = await ethers.getContractAt(
        "PoseidonMerkleTreeDirectory",
        await timelock.directory()
      );

      // Grant CANCELLER_ROLE to a separate party (role separation)
      const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
      await timelock.connect(owner).grantRole(CANCELLER_ROLE, canceller.address);

      return { poseidonMerkleTreeDirectory, timelock, owner, nonOwner, canceller };
    }

    // TC-TL-001: block direct onlyOwner calls
    it("revert OwnableUnauthorizedAccount when calling insertCm directly", async function () {
      const { poseidonMerkleTreeDirectory, owner } = await loadFixture(deployWithTimelockFixture);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      // Reverts even when owner calls directly because TimelockController is the owner
      await expect(
        poseidonMerkleTreeDirectory.connect(owner).insertCm(commitment, pubkeyHash)
      ).to.be.revertedWithCustomError(poseidonMerkleTreeDirectory, "OwnableUnauthorizedAccount");
    });

    // TC-TL-002: schedule → wait minDelay → execute succeeds
    it("TimelockController schedule → wait minDelay → execute → insertCm succeeds", async function () {
      const { poseidonMerkleTreeDirectory, timelock, owner } = await loadFixture(deployWithTimelockFixture);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      // Encode calldata for insertCm call
      const insertCalldata = poseidonMerkleTreeDirectory.interface.encodeFunctionData(
        "insertCm",
        [commitment, pubkeyHash]
      );

      const target = await poseidonMerkleTreeDirectory.getAddress();
      const salt = ethers.ZeroHash;

      // schedule
      await timelock.connect(owner).schedule(
        target,
        0,
        insertCalldata,
        ethers.ZeroHash, // predecessor
        salt,
        TIMELOCK_MIN_DELAY
      );

      // Wait for minDelay to pass
      await time.increase(TIMELOCK_MIN_DELAY);

      // execute
      await timelock.connect(owner).execute(
        target,
        0,
        insertCalldata,
        ethers.ZeroHash,
        salt
      );

      // insertCm should have executed so leaf count should be 1
      expect(await poseidonMerkleTreeDirectory.getNumLeaves()).to.equal(1);
    });

    // TC-TL-003: cannot execute before minDelay
    it("revert when execute is attempted before minDelay", async function () {
      const { poseidonMerkleTreeDirectory, timelock, owner } = await loadFixture(deployWithTimelockFixture);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      const insertCalldata = poseidonMerkleTreeDirectory.interface.encodeFunctionData(
        "insertCm",
        [commitment, pubkeyHash]
      );

      const target = await poseidonMerkleTreeDirectory.getAddress();
      const salt = ethers.ZeroHash;

      // Attempt to execute immediately after schedule without waiting
      await timelock.connect(owner).schedule(
        target,
        0,
        insertCalldata,
        ethers.ZeroHash,
        salt,
        TIMELOCK_MIN_DELAY
      );

      // minDelay not elapsed → revert with TimelockUnexpectedOperationState
      await expect(
        timelock.connect(owner).execute(
          target,
          0,
          insertCalldata,
          ethers.ZeroHash,
          salt
        )
      ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    });

    // TC-TL-004: cannot execute after CANCELLER_ROLE cancels
    it("revert on execute after CANCELLER_ROLE cancels the operation", async function () {
      const { poseidonMerkleTreeDirectory, timelock, owner, canceller } =
        await loadFixture(deployWithTimelockFixture);

      const commitment = ethers.hexlify(ethers.randomBytes(32));
      const pubkeyHash = ethers.hexlify(ethers.randomBytes(32));

      const insertCalldata = poseidonMerkleTreeDirectory.interface.encodeFunctionData(
        "insertCm",
        [commitment, pubkeyHash]
      );

      const target = await poseidonMerkleTreeDirectory.getAddress();
      const salt = ethers.ZeroHash;

      // schedule
      await timelock.connect(owner).schedule(
        target,
        0,
        insertCalldata,
        ethers.ZeroHash,
        salt,
        TIMELOCK_MIN_DELAY
      );

      // CANCELLER_ROLE cancels the operation
      const operationId = await timelock.hashOperation(
        target,
        0,
        insertCalldata,
        ethers.ZeroHash,
        salt
      );
      await timelock.connect(canceller).cancel(operationId);

      // Attempt execute after minDelay → revert because operation was cancelled
      await time.increase(TIMELOCK_MIN_DELAY);
      await expect(
        timelock.connect(owner).execute(
          target,
          0,
          insertCalldata,
          ethers.ZeroHash,
          salt
        )
      ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    });
  });
});
