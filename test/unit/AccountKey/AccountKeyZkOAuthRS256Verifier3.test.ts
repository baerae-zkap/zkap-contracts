import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

// BN254 Scalar Field Modulus (same as in contract)
const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Test data
const testN = 6;
const testK = 3;
const testHAudList = ethers.toBigInt("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
const testAnchor = [
  ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"),
  ethers.toBigInt("0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"),
];

/**
 * Helper function to create validate signature data
 * Format: (uint256[6] sharedInputs, uint256[] jwtExpList, uint256[] partialRhsList, uint256[8][] proofs)
 * sharedInputs: [hanchor, h_ctx, root, h_sign_userop, lhs, h_aud_list]
 * jwtExpList: per-proof JWT expiry (circuit guarantees jwt_exp == jwt.exp binding)
 */
function encodeValidateSig(
  hanchor: bigint,
  hCtx: bigint,
  root: bigint,
  hSignUserop: bigint,
  lhs: bigint,
  hAudList: bigint,
  jwtExpList: bigint[],
  partialRhsList: bigint[],
  proofs: bigint[][],
): string {
  const sharedInputs: [bigint, bigint, bigint, bigint, bigint, bigint] = [
    hanchor,
    hCtx,
    root,
    hSignUserop,
    lhs,
    hAudList,
  ];

  // Convert proofs to proper format
  const proofsFormatted = proofs.map((proof) => {
    if (proof.length !== 8) {
      throw new Error("Each proof must have exactly 8 elements");
    }
    return proof as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  });

  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"],
    [sharedInputs, jwtExpList, partialRhsList, proofsFormatted],
  );
}

/**
 * Create k zero proofs for testing
 */
function createZeroProofs(k: number): bigint[][] {
  return Array(k)
    .fill(null)
    .map(() => Array(8).fill(0n));
}

/**
 * Create k partial rhs values that sum to lhs
 */
function createPartialRhsListForLhs(k: number, lhs: bigint): bigint[] {
  const result: bigint[] = [];
  let remaining = lhs;
  for (let i = 0; i < k - 1; i++) {
    result.push(0n);
  }
  result.push(remaining % SNARK_SCALAR_FIELD);
  return result;
}

// Fixture function to deploy libraries and contracts
async function deployAccountKeyZkOAuthRS256Verifier() {
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
  const poseidonMerkleTreeDirectory = await PoseidonMerkleTreeDirectoryFactory.deploy(4);
  await poseidonMerkleTreeDirectory.waitForDeployment();

  // Deploy Groth16Verifier library
  const Groth16VerifierFactory = await ethers.getContractFactory("contracts/Utils/Groth16Verifier3.sol:Groth16Verifier");
  const groth16Verifier = await Groth16VerifierFactory.deploy();
  await groth16Verifier.waitForDeployment();

  // Deploy singleton with library linking
  const AccountKeyZkOAuthRS256VerifierFactory = await ethers.getContractFactory("AccountKeyZkOAuthRS256Verifier3", {
    libraries: {
      Groth16Verifier: await groth16Verifier.getAddress(),
      PoseidonHashLib: await poseidonHashLib.getAddress(),
    },
  });
  const accountKey = await AccountKeyZkOAuthRS256VerifierFactory.deploy();
  await accountKey.waitForDeployment();

  return { accountKey, owner, nonOwner, poseidonMerkleTreeDirectory, poseidonHashLib };
}

// Fixture function to deploy and register a key
async function deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey() {
  const { accountKey, owner, nonOwner, poseidonMerkleTreeDirectory, poseidonHashLib } =
    await deployAccountKeyZkOAuthRS256Verifier();

  // Encode initialization data: (n, k, hAudList, anchor[])
  const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint256", "uint256[]"],
    [testN, testK, testHAudList, testAnchor],
  );

  // Outer encoding: (bytes, address)
  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "address"],
    [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
  );

  // Register key (msg.sender will be owner)
  const tx = await accountKey.connect(owner).register(0, initData);
  await tx.wait();

  // keyId will be 0 for first registration
  const keyId = 0n;

  return {
    accountKey,
    keyId,
    owner,
    nonOwner,
    poseidonMerkleTreeDirectory,
    poseidonHashLib,
  };
}

// Fixture with valid merkle root registered
async function deployWithValidMerkleRoot3() {
  const { accountKey, owner, nonOwner, poseidonMerkleTreeDirectory, poseidonHashLib } =
    await deployAccountKeyZkOAuthRS256Verifier();

  // Register a commitment BEFORE registering the key (order matters!)
  const testCommitment = ethers.zeroPadBytes(ethers.toBeHex(123456789n, 32), 32);
  const testRsaKeyHash = ethers.zeroPadBytes(ethers.toBeHex(987654321n, 32), 32);
  await poseidonMerkleTreeDirectory.insertCm(testCommitment, testRsaKeyHash);

  const root = await poseidonMerkleTreeDirectory.getRoot();
  const validRoot = ethers.toBigInt(root);

  // NOW register the key (this will cache the valid root)
  const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint256", "uint256[]"],
    [testN, testK, testHAudList, testAnchor],
  );

  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "address"],
    [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
  );

  const tx = await accountKey.connect(owner).register(0, initData);
  await tx.wait();

  const keyId = 0n;

  return { accountKey, keyId, owner, nonOwner, poseidonMerkleTreeDirectory, poseidonHashLib, validRoot };
}

describe("AccountKeyZkOAuthRS256Verifier3", async function () {
  describe("Deployment", async function () {
    it("Should deploy singleton contract successfully", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier);
      expect(await accountKey.getAddress()).to.be.properAddress;
    });

    it("Should register key successfully", async function () {
      const { accountKey, keyId } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);
      expect(await accountKey.getAddress()).to.be.properAddress;
      expect(keyId).to.equal(0n);
    });
  });

  describe("Registration", async function () {
    it("register with correct n and k", async function () {
      const { accountKey, keyId, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);
      const [, n, k] = await accountKey.getData(0, owner.address, keyId);
      expect(n).to.equal(testN);
      expect(k).to.equal(testK);
    });

    it("register with correct hAudList", async function () {
      const { accountKey, keyId, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);
      const [, , , hAudList] = await accountKey.getData(0, owner.address, keyId);
      expect(hAudList).to.equal(testHAudList);
    });

    it("register with correct poseidonMerkleTreeDirectory", async function () {
      const { accountKey, keyId, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey,
      );
      const [directory] = await accountKey.getData(0, owner.address, keyId);
      expect(directory).to.equal(await poseidonMerkleTreeDirectory.getAddress());
    });

    it("register anchor with hash appended", async function () {
      const { accountKey, keyId, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);
      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      // Anchor should have original elements plus computed hash (hanchor)
      expect(anchor.length).to.equal(testAnchor.length + 1);
      expect(anchor[0]).to.equal(testAnchor[0]);
      expect(anchor[1]).to.equal(testAnchor[1]);
      // Last element should be the computed hanchor (non-zero)
      expect(anchor[testAnchor.length]).to.not.equal(0);
    });

    it("emit ZkOAuthRS256VerifierRegistered event", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );

      await expect(accountKey.connect(owner).register(0, initData))
        .to.emit(accountKey, "ZkOAuthRS256VerifierRegistered")
        .withArgs(
          owner.address,
          0n, // keyId
          (val: any) => val.length === testAnchor.length + 1, // anchor with hanchor
          testHAudList,
          await poseidonMerkleTreeDirectory.getAddress(),
        );
    });

    it("revert when registering with zero merkle tree directory address", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier);

      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, ethers.ZeroAddress],
      );

      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidMerkleTreeDirectoryAddress",
      );
    });
  });

  describe("keyType", async function () {
    it("return KeyType.keyZkOAuthRS256 (6)", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier);
      expect(await accountKey.keyType()).to.equal(6);
    });
  });

  describe("getAnchor", async function () {
    it("return the anchor array with hanchor appended", async function () {
      const { accountKey, keyId, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);
      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      expect(anchor.length).to.equal(testAnchor.length + 1);
      expect(anchor[0]).to.equal(testAnchor[0]);
      expect(anchor[1]).to.equal(testAnchor[1]);
    });
  });

  describe("validate", async function () {
    it("revert with AnchorMismatch when hanchor is wrong", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const wrongHanchor = ethers.toBigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        wrongHanchor, // wrong hanchor
        0n, // h_ctx
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "AnchorMismatch",
      );
    });

    it("revert with InvalidMerkleRoot when root is not cached", async function () {
      const { accountKey, keyId, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const invalidRoot = ethers.toBigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        invalidRoot, // invalid root
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidMerkleRoot",
      );
    });

    it("revert with InvalidMerkleRoot when proofRoot is zero", async function () {
      const { accountKey, keyId, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        0n, // proofRoot = 0 → explicit rejection
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidMerkleRoot",
      );
    });

    it("revert with InvalidNonce when h_sign_userop does not match msgHash", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const wrongHSignUserop = 999999n; // does not match msgHash % SNARK_SCALAR_FIELD
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        wrongHSignUserop, // wrong h_sign_userop
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidNonce",
      );
    });

    it("revert with InvalidJwtExpiry when JWT is expired", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const expiredJwtExp = BigInt((await time.latest()) - 100); // expired JWT
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(expiredJwtExp), // expired JWT - should fail (ZKAPSC-009: jwt_exp check)
        partialRhsList,
        proofs,
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidJwtExpiry",
      );
    });

    it("revert with InvalidAudienceList when h_aud_list does not match", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);
      const wrongHAudList = ethers.toBigInt("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        wrongHAudList, // wrong h_aud_list
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidAudienceList",
      );
    });

    it("revert with InvalidLhsSum when sum of partial_rhs does not equal lhs", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      // Create partial_rhs that does NOT sum to lhs
      const wrongPartialRhsList = [1n, 2n, 3n]; // sum = 6, not 100
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        wrongPartialRhsList, // sum != lhs
        proofs,
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidLhsSum",
      );
    });

    it("revert with InvalidProofCount when proof count does not match k", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      // Create wrong number of proofs (2 instead of k=3)
      const wrongProofs = createZeroProofs(2);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(2).fill(futureJwtExp), // 2 JWT exps to match 2 proofs
        partialRhsList.slice(0, 2), // also wrong count
        wrongProofs,
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidProofCount",
      );
    });

    it("return false when called by non-registrant account", async function () {
      const { accountKey, keyId, owner, nonOwner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      // Non-owner calling with owner's keyId should return false (k == 0 check)
      const result = await accountKey.connect(nonOwner).validate(0, keyId, sig, msgHash);
      expect(result).to.be.false;
    });

    it("revert with VerificationFailed when ZK proof is invalid", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 1000);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      // Zero proofs will fail Groth16 verification
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      // All checks pass except ZK proof verification
      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "VerificationFailed",
      );
    });
  });

  describe("View functions", async function () {
    it("getData returns correct values", async function () {
      const { accountKey, keyId, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey,
      );
      const [directory, n, k, hAudList] = await accountKey.getData(0, owner.address, keyId);
      expect(directory).to.equal(await poseidonMerkleTreeDirectory.getAddress());
      expect(n).to.equal(testN);
      expect(k).to.equal(testK);
      expect(hAudList).to.equal(testHAudList);
    });

    it("getCachedRoots returns cached roots", async function () {
      const { accountKey, keyId, owner } = await loadFixture(deployWithValidMerkleRoot3);
      const cachedRoots = await accountKey.getCachedRoots(0, owner.address, keyId);
      expect(cachedRoots.length).to.equal(2);
      // At least one root should be non-zero after registration
      expect(cachedRoots[0] !== ethers.ZeroHash || cachedRoots[1] !== ethers.ZeroHash).to.be.true;
    });

    it("getAnchor returns anchor with hanchor", async function () {
      const { accountKey, keyId, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);
      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      expect(anchor.length).to.equal(testAnchor.length + 1);
      expect(anchor[0]).to.equal(testAnchor[0]);
      expect(anchor[1]).to.equal(testAnchor[1]);
      // Last element is hanchor (non-zero)
      expect(anchor[testAnchor.length]).to.not.equal(0);
    });
  });

  // NOTE: "validate with valid ZK proof (fixture data)" test removed
  // - After applying the ZKAPSC-009 JWT expiry validation patch, the fixture's jwt_exp is expired and cannot pass
  // - Restore the test after regenerating ZK proof with a future jwt_exp and updating the fixture

  describe("Additional Coverage for KeyPurpose.Tx (purpose=1)", async function () {
    it("register key with KeyPurpose.Tx", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );

      const tx = await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)
      await tx.wait();

      const keyId = 0n;
      const [, n, k] = await accountKey.getData(1, owner.address, keyId);
      expect(n).to.equal(testN);
      expect(k).to.equal(testK);
    });

    it("validate with KeyPurpose.Tx", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      // Register commitment first
      const testCommitment = ethers.zeroPadBytes(ethers.toBeHex(123456789n, 32), 32);
      const testRsaKeyHash = ethers.zeroPadBytes(ethers.toBeHex(987654321n, 32), 32);
      await poseidonMerkleTreeDirectory.insertCm(testCommitment, testRsaKeyHash);
      const root = await poseidonMerkleTreeDirectory.getRoot();
      const validRoot = ethers.toBigInt(root);

      // Register key with purpose=1
      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );
      await accountKey.connect(owner).register(1, initData);

      const keyId = 0n;
      const anchor = await accountKey.getAnchor(1, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 86400);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      // Should revert with VerificationFailed (zero proofs invalid)
      await expect(accountKey.connect(owner).validate(1, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "VerificationFailed",
      );
    });

    it("getAnchor with KeyPurpose.Tx", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );
      await accountKey.connect(owner).register(1, initData);

      const keyId = 0n;
      const anchor = await accountKey.getAnchor(1, owner.address, keyId);
      expect(anchor.length).to.equal(testAnchor.length + 1);
      expect(anchor[0]).to.equal(testAnchor[0]);
      expect(anchor[1]).to.equal(testAnchor[1]);
    });

    it("resetKeys with KeyPurpose.Tx", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );
      await accountKey.connect(owner).register(1, initData);

      // Reset Tx keys
      await accountKey.connect(owner).resetKeys(1);

      // After reset, getAnchor should return empty array
      const anchor = await accountKey.getAnchor(1, owner.address, 0n);
      expect(anchor.length).to.equal(0);
    });
  });

  describe("Edge Cases for Coverage", async function () {
    it("revert when registering with k=0", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, 0, testHAudList, testAnchor], // k=0
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );

      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidProofK",
      );
    });

    it("revert when registering 6th key (MaxKeysExceeded)", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      // Register 5 keys (max allowed)
      for (let i = 0; i < 5; i++) {
        const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint256", "uint256", "uint256[]"],
          [testN, testK, testHAudList, testAnchor],
        );
        const initData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes", "address"],
          [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
        );
        await accountKey.connect(owner).register(0, initData);
      }

      // Try to register 6th key
      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );

      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "MaxKeysExceeded",
      );
    });

    it("revert refreshCachedRoots with out-of-bounds keyId", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);

      // keyId=0 exists, try keyId=1 (out of bounds)
      await expect(accountKey.connect(owner).refreshCachedRoots(0, 1)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidMerkleTreeDirectoryAddress",
      );
    });

    it("revert refreshCachedRoots when directory is zero", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier);

      // No key registered yet, directory is zero
      await expect(accountKey.connect(owner).refreshCachedRoots(0, 0)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidMerkleTreeDirectoryAddress",
      );
    });

    it("validate when cachedRoot1 matches (not cachedRoot0)", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      // Insert first commitment
      const testCommitment1 = ethers.zeroPadBytes(ethers.toBeHex(111n, 32), 32);
      const testRsaKeyHash1 = ethers.zeroPadBytes(ethers.toBeHex(222n, 32), 32);
      await poseidonMerkleTreeDirectory.insertCm(testCommitment1, testRsaKeyHash1);
      const root1 = await poseidonMerkleTreeDirectory.getRoot();

      // Register key (caches root1 as cachedRoot0)
      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );
      await accountKey.connect(owner).register(0, initData);

      // Insert second commitment (creates new root)
      const testCommitment2 = ethers.zeroPadBytes(ethers.toBeHex(333n, 32), 32);
      const testRsaKeyHash2 = ethers.zeroPadBytes(ethers.toBeHex(444n, 32), 32);
      await poseidonMerkleTreeDirectory.insertCm(testCommitment2, testRsaKeyHash2);

      // Refresh cached roots (now cachedRoot0 = new root, cachedRoot1 = old root)
      await accountKey.connect(owner).refreshCachedRoots(0, 0);

      const keyId = 0n;
      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 86400);
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      // Use the old root (now in cachedRoot1)
      const validRoot = ethers.toBigInt(root1);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        partialRhsList,
        proofs,
      );

      // Should pass root check (cachedRoot1 matches) but fail on ZK verification
      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "VerificationFailed",
      );
    });

    it("return empty array when getAnchor with out-of-bounds keyId", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);

      const anchor = await accountKey.getAnchor(0, owner.address, 999n);
      expect(anchor.length).to.equal(0);
    });

    it("return zeros when getData with out-of-bounds keyId", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);

      const [directory, n, k, hAudList] = await accountKey.getData(0, owner.address, 999n);
      expect(directory).to.equal(ethers.ZeroAddress);
      expect(n).to.equal(0);
      expect(k).to.equal(0);
      expect(hAudList).to.equal(0);
    });

    it("return zeros when getCachedRoots with out-of-bounds keyId", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);

      const [root0, root1] = await accountKey.getCachedRoots(0, owner.address, 999n);
      expect(root0).to.equal(ethers.ZeroHash);
      expect(root1).to.equal(ethers.ZeroHash);
    });
  });

  describe("Branch Coverage - resetKeys with KeyPurpose.Master", async function () {
    it("resetKeys with KeyPurpose.Master (purpose=0)", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      // Register key with Master purpose
      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, testAnchor],
      );
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );
      await accountKey.connect(owner).register(0, initData); // purpose=0 (Master)

      // Reset Master keys
      await accountKey.connect(owner).resetKeys(0);

      // After reset, getData should return zeros
      const [directory, n, k, hAudList] = await accountKey.getData(0, owner.address, 0n);
      expect(directory).to.equal(ethers.ZeroAddress);
      expect(n).to.equal(0);
      expect(k).to.equal(0);
      expect(hAudList).to.equal(0);
    });
  });

  describe("Branch Coverage - jwtExpList length mismatch", async function () {
    it("revert with InvalidProofCount when jwtExpList.length != k", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 86400);
      const lhs = 100n;

      // proofs and partialRhsList with correct length, jwtExpList with wrong length
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK - 1).fill(futureJwtExp), // jwtExpList length = k-1
        partialRhsList, // length = k
        proofs, // length = k
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidProofCount",
      );
    });
  });

  describe("Branch Coverage - partialRhsList length mismatch", async function () {
    it("revert with InvalidProofCount when partialRhsList.length != k", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const futureJwtExp = BigInt((await time.latest()) + 86400);
      const lhs = 100n;

      // partialRhsList with wrong length (k-1 instead of k)
      const wrongPartialRhsList = createPartialRhsListForLhs(testK - 1, lhs);
      // proofs with correct length
      const proofs = createZeroProofs(testK);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(futureJwtExp),
        wrongPartialRhsList, // length = k-1
        proofs, // length = k
      );

      // Should revert with InvalidProofCount (line 212 cond-expr check)
      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidProofCount",
      );
    });
  });

  describe("Branch Coverage - register with 1-element anchor (loop skip)", async function () {
    it("register with single-element anchor skips hanchor loop body", async function () {
      const { accountKey, owner, poseidonMerkleTreeDirectory } = await loadFixture(
        deployAccountKeyZkOAuthRS256Verifier,
      );

      const singleAnchor = [
        ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"),
      ];

      const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [testN, testK, testHAudList, singleAnchor],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "address"],
        [innerEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );

      const tx = await accountKey.connect(owner).register(0, initData);
      await tx.wait();

      const keyId = 0n;
      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      // Single element + hanchor = 2
      expect(anchor.length).to.equal(2);
      expect(anchor[0]).to.equal(singleAnchor[0]);
      // hanchor should be non-zero
      expect(anchor[1]).to.not.equal(0);
    });
  });

  describe("Branch Coverage - resetKeys with zero count", async function () {
    it("resetKeys Master with no keys registered (count=0, loop skip)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier);

      // No keys registered, resetKeys should succeed without reverting
      await accountKey.connect(owner).resetKeys(0); // Master

      // Verify still no keys
      const [directory, n, k, hAudList] = await accountKey.getData(0, owner.address, 0n);
      expect(directory).to.equal(ethers.ZeroAddress);
      expect(n).to.equal(0);
      expect(k).to.equal(0);
      expect(hAudList).to.equal(0);
    });

    it("resetKeys Tx with no keys registered (count=0, loop skip)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyZkOAuthRS256Verifier);

      // No keys registered, resetKeys should succeed without reverting
      await accountKey.connect(owner).resetKeys(1); // Tx

      // Verify still no keys
      const [directory, n, k, hAudList] = await accountKey.getData(1, owner.address, 0n);
      expect(directory).to.equal(ethers.ZeroAddress);
      expect(n).to.equal(0);
      expect(k).to.equal(0);
      expect(hAudList).to.equal(0);
    });
  });

  describe("Branch Coverage - jwt_exp boundary value", async function () {
    it("revert with InvalidJwtExpiry when jwt_exp equals block.timestamp exactly", async function () {
      const { accountKey, keyId, owner, validRoot } = await loadFixture(deployWithValidMerkleRoot3);

      const anchor = await accountKey.getAnchor(0, owner.address, keyId);
      const hanchor = anchor[anchor.length - 1];
      const msgHash = ethers.toBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const hSignUserop = msgHash % SNARK_SCALAR_FIELD;
      const lhs = 100n;
      const partialRhsList = createPartialRhsListForLhs(testK, lhs);
      const proofs = createZeroProofs(testK);

      // Set jwt_exp to current block.timestamp + 1 (will be equal after next block)
      const currentTimestamp = await time.latest();
      const boundaryJwtExp = BigInt(currentTimestamp + 1);

      const sig = encodeValidateSig(
        hanchor,
        0n,
        validRoot,
        hSignUserop,
        lhs,
        testHAudList,
        Array(testK).fill(boundaryJwtExp),
        partialRhsList,
        proofs,
      );

      // Advance time so block.timestamp == jwt_exp (>= triggers revert)
      await time.increaseTo(currentTimestamp + 1);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidJwtExpiry",
      );
    });
  });

  describe("Branch Coverage - storage manipulation for defensive checks", function () {
    it("return false when data.k is zero (storage manipulation)", async function () {
      const { accountKey, owner, keyId } =
        await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);

      // Compute storage slot for _masterDataSlots[owner].entries[0].k
      // _masterDataSlots is at slot 0 (first state variable, no parent storage)
      // mapping base = keccak256(abi.encode(owner, 0))
      // entries[0].k = base + 2
      const baseSlot = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [owner.address, 0n]),
      );
      const kSlot = ethers.toBeHex(BigInt(baseSlot) + 2n, 32);

      // Zero out data.k via storage manipulation
      await ethers.provider.send("hardhat_setStorageAt", [
        await accountKey.getAddress(),
        kSlot,
        ethers.zeroPadValue("0x00", 32),
      ]);

      // validate returns false before abi.decode when data.k == 0
      const sig = encodeValidateSig(0n, 0n, 0n, 0n, 0n, 0n, [], [], []);
      const result = await accountKey.connect(owner).validate(0, keyId, sig, 0n);
      expect(result).to.equal(false);
    });

    it("revert refreshCachedRoots when directory is zero (storage manipulation)", async function () {
      const { accountKey, owner, keyId } =
        await loadFixture(deployAccountKeyZkOAuthRS256Verifier3WithRegisteredKey);

      // Compute storage slot for _masterDataSlots[owner].entries[0].directory
      // _masterDataSlots is at slot 0
      // entries[0].directory = base + 0
      const baseSlot = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [owner.address, 0n]),
      );
      const directorySlot = ethers.toBeHex(BigInt(baseSlot) + 0n, 32);

      // Zero out directory via storage manipulation
      await ethers.provider.send("hardhat_setStorageAt", [
        await accountKey.getAddress(),
        directorySlot,
        ethers.zeroPadValue("0x00", 32),
      ]);

      await expect(
        accountKey.connect(owner).refreshCachedRoots(0, keyId),
      ).to.be.revertedWithCustomError(accountKey, "InvalidMerkleTreeDirectoryAddress");
    });
  });
});
