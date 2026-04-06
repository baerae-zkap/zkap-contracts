/**
 * E2E Tests: ZK OAuth Gas Benchmark
 *
 * ZK Proof generation time and gas cost measurement
 * - Proof generation time
 * - Proof validation gas
 * - Key Update scenario gas
 */

import { ethers, network as hre_network } from "hardhat";
import { expect } from "chai";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import path from "path";
import fs from "fs";
import { IdTokenSimulator } from "../../helpers/idTokenSimulator";
import crypto from "../../helpers/crypto";
import { AccountKeyZkOAuthRS256Verifier, PoseidonMerkleTreeDirectory, ZkapAccountFactory } from "../../../typechain-types";

// NAPI bindings
import { napiGenerateAnchor, napiGenerateProof, napiGeneratePoseidonHash } from "../../../zk-assets/n6k3/napi";

// Current built CRS configuration
const CURRENT_ZKAP_N = 6;
const CURRENT_ZKAP_K = 3;

// CRS file path
const CRS_DIR = path.join(__dirname, "../../../zk-assets/n6k3/crs");
const PK_KEY_PATH = path.join(CRS_DIR, "pk.key");

let pkPath: string;

// ZK parameter constants
const MAX_ISS_LEN = 93;
const PAD_CHAR = 0;

// Audience hash values
const H_GOOGLE_AUD = "0x3663427A957C7693D40523587FD9A138EF4055676E3D900993A2AB03E238220";
const H_KAKAO_AUD = "0x245EC8B02B6D98E1E3BBCF2C7DE1C4981A6CEFD0833B3ECE23172B5A479269CF";

// Audience list hash value
const H_AUD_LISTS = "0x4FD75F1BE3EEB4AF5268644996E30BAEEAFE98C7BE082456E080E3F6A683F39";

// Test user operation hash and random values
const TEST_H_SIGN_USEROP = "67890";
const TEST_RANDOM = "12345";
const TEST_NONCE = "0x2803f757a950838bddd0386fde28d1e84508eb42c08d0bd5aa5541f74069828e";

// Helper: check if CRS files exist
function checkCrsFilesExist(): boolean {
  try {
    return fs.existsSync(PK_KEY_PATH);
  } catch {
    return false;
  }
}

// Helper: CRS path load
function loadCRSPath(): string {
  return PK_KEY_PATH;
}

// Helper: compute Poseidon hash
async function computePoseidonHash(inputs: string[]): Promise<string> {
  const result = napiGeneratePoseidonHash({ inputs });
  return result.hash;
}

// Helper: compute Anchor
async function computeAnchor(secrets: Array<{ iss: string; sub: string; aud: string }>): Promise<string[]> {
  const result = napiGenerateAnchor({ secrets });
  return result.anchor;
}

// Helper: generate ZK Proof
async function generateZkProof(params: {
  pkPath: string;
  jwts: string[];
  pkOps: string[];
  merklePaths: string[][];
  leafIndices: number[];
  root: string;
  anchor: string[];
  hSignUserOp: string;
  random: string;
  audList: string[];
}): Promise<{ proofs: string[][]; sharedInputs: string[]; partialRhsList: string[] }> {
  const result = napiGenerateProof(params);
  return result;
}

// Helper: convert RSA N to leaf input
function prepareLeafInput(iss: string, rsaN: string): string[] {
  const issFields = crypto.padAndStrToFieldsBN254(`"${iss}"`, MAX_ISS_LEN, PAD_CHAR);
  const formattedN = crypto.formattingModulorN(rsaN);
  const nDecimal = formattedN.map((value) => ethers.toBigInt(value));
  const leafInput = issFields.concat(nDecimal);
  return leafInput.map((value) => value.toString());
}

// Test Verifier wrapper interface
interface TestVerifier {
  impl: AccountKeyZkOAuthRS256Verifier;
  account: string;
  keyId: bigint;
  signer: any;
}

// Helper: register key in singleton AccountKeyZkOAuthRS256Verifier and return test wrapper
// Singleton pattern: call register() directly without ERC1967Proxy
async function registerTestVerifier(
  implementation: AccountKeyZkOAuthRS256Verifier,
  encoded: string,
  poseidonMerkleTreeDirectoryAddress: string,
): Promise<TestVerifier> {
  const testAccount = ethers.Wallet.createRandom().connect(ethers.provider);
  const [funder] = await ethers.getSigners();

  await funder.sendTransaction({
    to: testAccount.address,
    value: ethers.parseEther("0.1"),
  });

  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "address"],
    [encoded, poseidonMerkleTreeDirectoryAddress]
  );

  const connectedImpl = implementation.connect(testAccount);
  const tx = await connectedImpl.register(initData);
  const receipt = await tx.wait();

  const event = receipt?.logs.find((log) => {
    try {
      const parsed = implementation.interface.parseLog({ topics: log.topics as string[], data: log.data });
      return parsed?.name === "ZkOAuthRS256VerifierRegistered";
    } catch {
      return false;
    }
  });

  let keyId = 0n;
  if (event) {
    const parsed = implementation.interface.parseLog({ topics: event.topics as string[], data: event.data });
    keyId = parsed?.args.keyId ?? 0n;
  }

  return {
    impl: implementation,
    account: testAccount.address,
    keyId,
    signer: testAccount,
  };
}

// Fixture: deploy ZK-related contracts
async function deployZkContracts() {
  const [owner] = await ethers.getSigners();

  const Groth16Verifier = await ethers.deployContract("contracts/Utils/Groth16Verifier.sol:Groth16Verifier");
  const PoseidonHashLib = await ethers.deployContract("PoseidonHashLib");

  const EntryPointFactory = await ethers.getContractFactory("SimpleEntryPoint");
  const entryPoint = await EntryPointFactory.deploy();
  await entryPoint.waitForDeployment();

  const PoseidonMerkleTreeDirectoryFactory = await ethers.getContractFactory("PoseidonMerkleTreeDirectory", {
    libraries: { PoseidonHashLib: await PoseidonHashLib.getAddress() },
  });
  const poseidonMerkleTreeDirectory = await PoseidonMerkleTreeDirectoryFactory.deploy(16);
  await poseidonMerkleTreeDirectory.waitForDeployment();

  const AccountKeyZkOAuthRS256VerifierFactory = await ethers.getContractFactory("AccountKeyZkOAuthRS256Verifier", {
    libraries: {
      Groth16Verifier: await Groth16Verifier.getAddress(),
      PoseidonHashLib: await PoseidonHashLib.getAddress(),
    },
  });
  const accountKeyZkOAuthRS256VerifierImpl = await AccountKeyZkOAuthRS256VerifierFactory.deploy();
  await accountKeyZkOAuthRS256VerifierImpl.waitForDeployment();

  const ZkapAccountFactoryFactory = await ethers.getContractFactory("ZkapAccountFactory");
  const zkapAccountFactory = await ZkapAccountFactoryFactory.deploy(await entryPoint.getAddress());
  await zkapAccountFactory.waitForDeployment();

  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();
  await accountKeyAddressLogic.waitForDeployment();

  const simulatorGoogle = new IdTokenSimulator("google");
  const simulatorKakao = new IdTokenSimulator("kakao");
  await simulatorGoogle.initialize();
  await simulatorKakao.initialize();

  return {
    owner,
    entryPoint,
    poseidonMerkleTreeDirectory: poseidonMerkleTreeDirectory as PoseidonMerkleTreeDirectory,
    accountKeyZkOAuthRS256VerifierImpl,
    zkapAccountFactory: zkapAccountFactory as ZkapAccountFactory,
    simulatorGoogle,
    simulatorKakao,
    accountKeyAddressLogic,
    Groth16Verifier,
    PoseidonHashLib,
  };
}

describe(`E2E: ZK OAuth Benchmark (N=${CURRENT_ZKAP_N}, K=${CURRENT_ZKAP_K})`, function () {
  let zkServerAvailable = false;

  before(async function () {
    this.timeout(10000);
    zkServerAvailable = checkCrsFilesExist();
    if (!zkServerAvailable) {
      console.log("\n⚠️  CRS files not found. Skipping benchmarks.");
      console.log(`   CRS directory: ${CRS_DIR}`);
    } else {
      pkPath = loadCRSPath();
      console.log(`✅ CRS files found (N=${CURRENT_ZKAP_N}, K=${CURRENT_ZKAP_K})`);
    }
  });

  describe("ZK Proof Generation Time Benchmark", function () {
    it(`BM-001: measure Proof generation time (N=${CURRENT_ZKAP_N}, K=${CURRENT_ZKAP_K})`, async function () {
      if (!zkServerAvailable) this.skip();
      this.timeout(300000);

      const { poseidonMerkleTreeDirectory, accountKeyZkOAuthRS256VerifierImpl, simulatorGoogle } = await loadFixture(
        deployZkContracts
      );

      // Initialize Merkle Tree

      // Register Google RSA public key
      const googleInfo = simulatorGoogle.getUserInfo();
      const rsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const leafInputStr = prepareLeafInput(googleInfo.iss, rsaN);
      const hash = await computePoseidonHash(leafInputStr);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(hash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(rsaN)))
      );

      // Generate anchor with N identical secrets
      const secret = {
        iss: `"${googleInfo.iss}"`,
        sub: `"${googleInfo.sub}"`,
        aud: `"${googleInfo.aud}"`,
      };
      const secrets = Array(CURRENT_ZKAP_N).fill(secret);
      const anchor = await computeAnchor(secrets);

      // Create Verifier
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [CURRENT_ZKAP_N, CURRENT_ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor]
      );

      const verifier = await registerTestVerifier(
        accountKeyZkOAuthRS256VerifierImpl,
        encoded,
        await poseidonMerkleTreeDirectory.getAddress()
      );

      // Get anchor including hanchor from Verifier (singleton pattern)
      const SCanchor = await verifier.impl.getAnchor(verifier.account, verifier.keyId);
      const anchorUint = SCanchor.map((x: bigint) => x.toString());

      // Generate JWT (CNT-689 style)
      const nonceHex = ethers.toBeHex(TEST_NONCE, 32);
      const token = await simulatorGoogle.generateIdToken(nonceHex);
      const jwts = Array(CURRENT_ZKAP_K).fill(token);
      const now = await time.latest();
      const pkOps = Array(CURRENT_ZKAP_K).fill(simulatorGoogle.getRsaComponents().n);

      // Prepare Merkle proof
      const root = await poseidonMerkleTreeDirectory.getRoot();
      const leafIndex = 0;
      const merklePath = await poseidonMerkleTreeDirectory.getMerklePath(leafIndex);
      const pathUint = merklePath.map((x: string) => ethers.toBigInt(x).toString());
      const rootUint = ethers.toBigInt(root).toString();

      const merklePaths: string[][] = [];
      const leafIndices: number[] = [];

      for (let i = 0; i < CURRENT_ZKAP_K; i++) {
        merklePaths.push(pathUint);
        leafIndices.push(leafIndex);
      }

      // Generate audList (using hash values)
      const audList = [H_GOOGLE_AUD, H_KAKAO_AUD];

      // Measure Proof generation time
      const startTime = Date.now();
      const proofResult = await generateZkProof({
        pkPath,
        jwts,
        pkOps,
        merklePaths,
        leafIndices,
        root: rootUint,
        anchor: anchorUint,
        hSignUserOp: TEST_H_SIGN_USEROP,
        random: TEST_RANDOM,
        audList,
      });
      const endTime = Date.now();

      const proofGenerationTime = endTime - startTime;
      console.log(`\n    ⏱️  ZK Proof generation time (N=${CURRENT_ZKAP_N}, K=${CURRENT_ZKAP_K}): ${proofGenerationTime}ms`);

      expect(proofResult.proofs.length).to.equal(CURRENT_ZKAP_K);
    });
  });

  describe("ZK Proof Validation Gas Benchmark", function () {
    it(`BM-002: measure Proof validation gas (N=${CURRENT_ZKAP_N}, K=${CURRENT_ZKAP_K})`, async function () {
      if (!zkServerAvailable) this.skip();
      this.timeout(300000);

      const { poseidonMerkleTreeDirectory, accountKeyZkOAuthRS256VerifierImpl, simulatorGoogle, owner } =
        await loadFixture(deployZkContracts);

      // Initialize Merkle Tree

      // Register Google RSA public key
      const googleInfo = simulatorGoogle.getUserInfo();
      const rsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const leafInputStr = prepareLeafInput(googleInfo.iss, rsaN);
      const hash = await computePoseidonHash(leafInputStr);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(hash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(rsaN)))
      );

      // Generate anchor with N identical secrets
      const secret = {
        iss: `"${googleInfo.iss}"`,
        sub: `"${googleInfo.sub}"`,
        aud: `"${googleInfo.aud}"`,
      };
      const secrets = Array(CURRENT_ZKAP_N).fill(secret);
      const anchor = await computeAnchor(secrets);

      // Create Verifier
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [CURRENT_ZKAP_N, CURRENT_ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor]
      );

      const verifier = await registerTestVerifier(
        accountKeyZkOAuthRS256VerifierImpl,
        encoded,
        await poseidonMerkleTreeDirectory.getAddress()
      );

      // Get anchor including hanchor from Verifier (singleton pattern)
      const SCanchor = await verifier.impl.getAnchor(verifier.account, verifier.keyId);
      const anchorUint = SCanchor.map((x: bigint) => x.toString());

      // Prepare Merkle proof
      const root = await poseidonMerkleTreeDirectory.getRoot();
      const leafIndex = 0;
      const merklePath = await poseidonMerkleTreeDirectory.getMerklePath(leafIndex);
      const pathUint = merklePath.map((x: string) => ethers.toBigInt(x).toString());
      const rootUint = ethers.toBigInt(root).toString();

      const now = await time.latest();

      // Generate JWT (CNT-689 style)
      const nonceHex = ethers.toBeHex(TEST_NONCE, 32);
      const token = await simulatorGoogle.generateIdToken(nonceHex);
      const jwts = Array(CURRENT_ZKAP_K).fill(token);
      const pkOps = Array(CURRENT_ZKAP_K).fill(simulatorGoogle.getRsaComponents().n);
      const merklePaths = Array(CURRENT_ZKAP_K).fill(pathUint);
      const leafIndices = Array(CURRENT_ZKAP_K).fill(leafIndex);

      // Generate audList (using hash values)
      const audList = [H_GOOGLE_AUD, H_KAKAO_AUD];

      // Generate Proof
      const proofResult = await generateZkProof({
        pkPath,
        jwts,
        pkOps,
        merklePaths,
        leafIndices,
        root: rootUint,
        anchor: anchorUint,
        hSignUserOp: TEST_H_SIGN_USEROP,
        random: TEST_RANDOM,
        audList,
      });

      // Move block timestamp sufficiently into the future
      const futureTimestamp = now + 6000000;
      await time.setNextBlockTimestamp(futureTimestamp);
      await ethers.provider.send("evm_mine", []);

      // Encode Signature
      // sharedInputs[7]: [hanchor(0), h_ctx(1), root(2), h_sign_userop(3), jwt_exp(4), lhs(5), h_aud_list(6)]
      // contractSharedInputs: skip jwt_exp at index 4
      const contractSharedInputs: [bigint, bigint, bigint, bigint, bigint, bigint] = [
        BigInt(proofResult.sharedInputs[0]),
        BigInt(proofResult.sharedInputs[1]),
        BigInt(proofResult.sharedInputs[2]),
        BigInt(proofResult.sharedInputs[3]),
        BigInt(proofResult.sharedInputs[5]),
        BigInt(proofResult.sharedInputs[6]),
      ];

      // jwtExpList: Array of K elements, all with the same jwt_exp value
      const jwtExpList = Array(CURRENT_ZKAP_K).fill(BigInt(proofResult.sharedInputs[4]));

      const partialRhsList = proofResult.partialRhsList.map((v) => BigInt(v));

      const proofs: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint][] = proofResult.proofs.map(
        (proof) => proof.map((v) => BigInt(v)) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
      );

      const sig = abiCoder.encode(["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"], [contractSharedInputs, jwtExpList, partialRhsList, proofs]);

      // Measure gas (singleton pattern: use verifier.signer directly)
      const validateGas = await verifier.impl
        .connect(verifier.signer)
        .validate.estimateGas(verifier.keyId, sig, TEST_H_SIGN_USEROP);
      console.log(`\n    ⛽ ZK proof validation gas (N=${CURRENT_ZKAP_N}, K=${CURRENT_ZKAP_K}): ${validateGas}`);

      expect(validateGas).to.be.greaterThan(0n);
    });
  });

  describe("ZK Key Update Gas Benchmark", function () {
    it(`BM-003: measure gas for updating txKey to ZK key (N=${CURRENT_ZKAP_N}, K=${CURRENT_ZKAP_K})`, async function () {
      if (!zkServerAvailable) this.skip();
      this.timeout(120000);

      const {
        owner,
        entryPoint,
        poseidonMerkleTreeDirectory,
        zkapAccountFactory,
        accountKeyAddressLogic,
        accountKeyZkOAuthRS256VerifierImpl,
        simulatorGoogle,
      } = await loadFixture(deployZkContracts);

      // Initialize PoseidonMerkleTreeDirectory

      // Register Google RSA public key
      const googleInfo = simulatorGoogle.getUserInfo();
      const rsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const leafInputStr = prepareLeafInput(googleInfo.iss, rsaN);
      const hash = await computePoseidonHash(leafInputStr);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(hash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(rsaN)))
      );

      const abiCoder = ethers.AbiCoder.defaultAbiCoder();

      // Create wallet with AddressKey (singleton pattern: pure ABI encoding)
      const addressKeyInitData = abiCoder.encode(["address"], [owner.address]);

      const encodedAddressKey = abiCoder.encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [await accountKeyAddressLogic.getAddress()], [addressKeyInitData], [1]]
      );

      const accountAddress = await zkapAccountFactory.createAccount.staticCall(1, encodedAddressKey, encodedAddressKey);
      await zkapAccountFactory.createAccount(1, encodedAddressKey, encodedAddressKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Send ETH to owner
      await owner.sendTransaction({
        to: accountAddress,
        value: ethers.parseEther("1.0"),
      });

      // Compute ZkOAuth anchor
      const secret = {
        iss: `"${googleInfo.iss}"`,
        sub: `"${googleInfo.sub}"`,
        aud: `"${googleInfo.aud}"`,
      };
      const secrets = Array(CURRENT_ZKAP_N).fill(secret);
      const anchor = await computeAnchor(secrets);

      // Encode ZkOAuth Key
      const zkOAuthEncoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [CURRENT_ZKAP_N, CURRENT_ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor]
      );
      // Singleton pattern: pure ABI encoding (no function selector)
      const zkOAuthKeyInitData = abiCoder.encode(
        ["bytes", "address"],
        [zkOAuthEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );

      // Encode new ZK txKey
      const encodedZkTxKey = abiCoder.encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [await accountKeyZkOAuthRS256VerifierImpl.getAddress()], [zkOAuthKeyInitData], [1]]
      );

      // Impersonate EntryPoint to call updateTxKey
      const entryPointAddress = await entryPoint.getAddress();

      await hre_network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [entryPointAddress],
      });
      await hre_network.provider.send("hardhat_setBalance", [entryPointAddress, "0x1000000000000000000"]);
      const entryPointSigner = await ethers.getSigner(entryPointAddress);

      // Measure gas
      const updateTxKeyGas = await account.connect(entryPointSigner).updateTxKey.estimateGas(encodedZkTxKey);
      console.log(`\n    ⛽ updateTxKey (ZK) gas (N=${CURRENT_ZKAP_N}, K=${CURRENT_ZKAP_K}): ${updateTxKeyGas}`);

      // Actual execution
      await account.connect(entryPointSigner).updateTxKey(encodedZkTxKey);

      await hre_network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [entryPointAddress],
      });

      // Verify updated txKey (singleton pattern: KeyRef struct)
      const newTxKeyRef = await account.txKeyList(0);
      const txKeyContract = await ethers.getContractAt("AccountKeyZkOAuthRS256Verifier", newTxKeyRef.logic);
      expect(await txKeyContract.keyType()).to.equal(6); // keyZkOAuthRS256

      expect(updateTxKeyGas).to.be.greaterThan(0n);
    });
  });
});
