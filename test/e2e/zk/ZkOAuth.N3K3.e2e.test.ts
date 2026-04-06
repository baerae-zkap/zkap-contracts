/**
 * E2E Tests: ZK OAuth RS256 Verifier (N=3, K=3)
 *
 * 3-slot, 3-authentication configuration test
 * - Circuit build: ZK_N=3 ZK_K=3 bash setup-zk-build.sh
 */

import { ethers, network as hre_network } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import path from "path";
import fs from "fs";
import { IdTokenSimulator } from "../../helpers/idTokenSimulator";
import crypto from "../../helpers/crypto";
import { AccountKeyZkOAuthRS256Verifier, PoseidonMerkleTreeDirectory, ZkapAccountFactory } from "../../../typechain-types";

// NAPI bindings
import { napiGenerateAnchor, napiGenerateProof, napiGeneratePoseidonHash } from "../../../zk-assets/n3k3/napi";

// N=3, K=3 configuration
const ZKAP_N = 3;
const ZKAP_K = 3;

// CRS file path
const CRS_DIR = path.join(__dirname, "../../../zk-assets/n3k3/crs");
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

// Test constants
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
  signer: any; // ethers.Wallet connected to provider
}

// Helper: register key in singleton AccountKeyZkOAuthRS256Verifier and return test wrapper
// Singleton pattern: call register() directly without ERC1967Proxy
async function registerTestVerifier(
  implementation: AccountKeyZkOAuthRS256Verifier,
  encoded: string,
  poseidonMerkleTreeDirectoryAddress: string,
): Promise<TestVerifier> {
  // Create test account address (unique per test)
  const testAccount = ethers.Wallet.createRandom().connect(ethers.provider);
  const [funder] = await ethers.getSigners();

  // Send gas fee to testAccount
  await funder.sendTransaction({
    to: testAccount.address,
    value: ethers.parseEther("0.1"),
  });

  // Encode singleton initData (pure ABI encoding, no function selector)
  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "address"],
    [encoded, poseidonMerkleTreeDirectoryAddress],
  );

  // testAccount calls register() to register key
  const connectedImpl = implementation.connect(testAccount);
  const tx = await connectedImpl.register(0, initData);
  const receipt = await tx.wait();

  // Extract keyId from event
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

  const Groth16Verifier = await ethers.deployContract("contracts/Utils/Groth16VerifierN3K3.sol:Groth16Verifier");
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

  const simulatorGoogle = new IdTokenSimulator("google");
  const simulatorKakao = new IdTokenSimulator("kakao");
  await simulatorGoogle.initialize();
  await simulatorKakao.initialize();

  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();
  await accountKeyAddressLogic.waitForDeployment();

  return {
    owner,
    entryPoint,
    poseidonMerkleTreeDirectory: poseidonMerkleTreeDirectory as PoseidonMerkleTreeDirectory,
    accountKeyZkOAuthRS256VerifierImpl,
    zkapAccountFactory: zkapAccountFactory as ZkapAccountFactory,
    simulatorGoogle,
    simulatorKakao,
    accountKeyAddressLogic,
  };
}

describe("E2E: ZK OAuth RS256 Verifier (N=3, K=3)", function () {
  let zkServerAvailable = false;

  before(async function () {
    zkServerAvailable = checkCrsFilesExist();
    if (zkServerAvailable) {
      pkPath = loadCRSPath();
      console.log(`✅ CRS files found (N=${ZKAP_N}, K=${ZKAP_K})`);
    } else {
      console.log(`⚠️  CRS files not found. Run: ZK_N=3 ZK_K=3 bash setup-zk-build.sh`);
    }
  });

  describe("TC-N3K3-001: Wallet Creation (3-of-3, slots=[A,B,C])", function () {
    it("create 3-user ZK wallet", async function () {
      if (!zkServerAvailable) this.skip();
      this.timeout(60000);

      const { poseidonMerkleTreeDirectory, accountKeyZkOAuthRS256VerifierImpl, simulatorGoogle, simulatorKakao } =
        await loadFixture(deployZkContracts);

      // 3 different users (Google, Kakao, Google2)
      const googleInfo = simulatorGoogle.getUserInfo();
      const kakaoInfo = simulatorKakao.getUserInfo();

      // Google2 is simulated as a Google user with a different sub
      const secrets = [
        { iss: `"${googleInfo.iss}"`, sub: `"${googleInfo.sub}"`, aud: `"${googleInfo.aud}"` },
        { iss: `"${kakaoInfo.iss}"`, sub: `"${kakaoInfo.sub}"`, aud: `"${kakaoInfo.aud}"` },
        { iss: `"${googleInfo.iss}"`, sub: `"user3_sub"`, aud: `"${googleInfo.aud}"` },
      ];

      // Initialize Merkle Tree and register RSA public keys

      // Register Google RSA
      const googleRsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const googleLeafInput = prepareLeafInput(googleInfo.iss, googleRsaN);
      const googleHash = await computePoseidonHash(googleLeafInput);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(googleHash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(googleRsaN))),
      );

      // Register Kakao RSA
      const kakaoRsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorKakao.getRsaComponents().n, "base64")));
      const kakaoLeafInput = prepareLeafInput(kakaoInfo.iss, kakaoRsaN);
      const kakaoHash = await computePoseidonHash(kakaoLeafInput);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(kakaoHash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(kakaoInfo.iss + kakaoRsaN))),
      );

      // Compute Anchor
      const anchor = await computeAnchor(secrets);

      // Create Verifier
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [ZKAP_N, ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor],
      );

      const verifier = await registerTestVerifier(
        accountKeyZkOAuthRS256VerifierImpl,
        encoded,
        await poseidonMerkleTreeDirectory.getAddress(),
      );

      expect(await verifier.impl.getAddress()).to.not.equal(ethers.ZeroAddress);
      const SCanchor = await verifier.impl.getAnchor(0, verifier.account, verifier.keyId);
      expect(SCanchor.length).to.be.greaterThan(0); // includes hanchor
    });
  });

  describe("TC-N3K3-002: Wallet Creation (1-of-1, slots=[A,A,A])", function () {
    it("create single-user 3-slot ZK wallet", async function () {
      if (!zkServerAvailable) this.skip();
      this.timeout(60000);

      const { poseidonMerkleTreeDirectory, accountKeyZkOAuthRS256VerifierImpl, simulatorGoogle } = await loadFixture(
        deployZkContracts,
      );

      // 3 slots with the same user
      const googleInfo = simulatorGoogle.getUserInfo();
      const secret = {
        iss: `"${googleInfo.iss}"`,
        sub: `"${googleInfo.sub}"`,
        aud: `"${googleInfo.aud}"`,
      };
      const secrets = [secret, secret, secret]; // 3 identical secrets

      const rsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const leafInputStr = prepareLeafInput(googleInfo.iss, rsaN);
      const hash = await computePoseidonHash(leafInputStr);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(hash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(rsaN))),
      );

      const anchor = await computeAnchor(secrets);

      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [ZKAP_N, ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor],
      );

      const verifier = await registerTestVerifier(
        accountKeyZkOAuthRS256VerifierImpl,
        encoded,
        await poseidonMerkleTreeDirectory.getAddress(),
      );

      expect(await verifier.impl.getAddress()).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("TC-N3K3-003: A Single Authentication Success (slots=[A,A,A])", function () {
    it("authenticate with 3 JWTs from the same user", async function () {
      if (!zkServerAvailable) this.skip();
      this.timeout(180000);

      const { poseidonMerkleTreeDirectory, accountKeyZkOAuthRS256VerifierImpl, simulatorGoogle } = await loadFixture(
        deployZkContracts,
      );

      const googleInfo = simulatorGoogle.getUserInfo();
      const secret = {
        iss: `"${googleInfo.iss}"`,
        sub: `"${googleInfo.sub}"`,
        aud: `"${googleInfo.aud}"`,
      };
      const secrets = [secret, secret, secret];

      const rsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const leafInputStr = prepareLeafInput(googleInfo.iss, rsaN);
      const hash = await computePoseidonHash(leafInputStr);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(hash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(rsaN))),
      );

      const anchor = await computeAnchor(secrets);
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [ZKAP_N, ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor],
      );

      const verifier = await registerTestVerifier(
        accountKeyZkOAuthRS256VerifierImpl,
        encoded,
        await poseidonMerkleTreeDirectory.getAddress(),
      );

      const SCanchor = await verifier.impl.getAnchor(0, verifier.account, verifier.keyId);
      const anchorUint = SCanchor.map((x: bigint) => x.toString());

      // Generate JWTs (K=3, all same Google)
      const nonceHex = ethers.toBeHex(TEST_NONCE, 32);
      const token = await simulatorGoogle.generateIdToken(nonceHex);
      const jwts = [token, token, token]; // K=3
      const pkOps = Array(ZKAP_K).fill(simulatorGoogle.getRsaComponents().n);

      // Merkle proof
      const root = await poseidonMerkleTreeDirectory.getRoot();
      const leafIndex = 0;
      const merklePath = await poseidonMerkleTreeDirectory.getMerklePath(leafIndex);
      const pathUint = merklePath.map((x: string) => ethers.toBigInt(x).toString());
      const rootUint = ethers.toBigInt(root).toString();

      const merklePaths = [pathUint, pathUint, pathUint];
      const leafIndices = [leafIndex, leafIndex, leafIndex];

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

      expect(proofResult.proofs.length).to.equal(ZKAP_K);

      // Encode Signature
      // NAPI sharedInputs[6]: [hanchor(0), h_ctx(1), root(2), h_sign_userop(3), lhs(4), h_aud_list(5)]
      // jwt_exp, partial_rhs are separated into distinct fields
      const contractSharedInputs: [bigint, bigint, bigint, bigint, bigint, bigint] = [
        BigInt(proofResult.sharedInputs[0]), // hanchor
        BigInt(proofResult.sharedInputs[1]), // h_ctx
        BigInt(proofResult.sharedInputs[2]), // root
        BigInt(proofResult.sharedInputs[3]), // h_sign_userop
        BigInt(proofResult.sharedInputs[4]), // lhs
        BigInt(proofResult.sharedInputs[5]), // h_aud_list
      ];
      const jwtExpList: bigint[] = proofResult.jwtExpList.map((v) => BigInt(v));

      const partialRhsList = proofResult.partialRhsList.map((v) => BigInt(v));
      const proofs: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint][] = proofResult.proofs.map(
        (proof) => proof.map((v) => BigInt(v)) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
      );

      const sig = abiCoder.encode(["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"], [contractSharedInputs, jwtExpList, partialRhsList, proofs]);

      // Validate - use verifier.signer directly
      const result = await verifier.impl
        .connect(verifier.signer)
        .validate.staticCall(0, verifier.keyId, sig, TEST_H_SIGN_USEROP);
      expect(result).to.equal(true);
    });
  });

  describe("TC-N3K3-004: Google+Kakao Mixed Authentication", function () {
    it("mixed multi-provider authentication success", async function () {
      if (!zkServerAvailable) this.skip();
      this.timeout(180000);

      const { poseidonMerkleTreeDirectory, accountKeyZkOAuthRS256VerifierImpl, simulatorGoogle, simulatorKakao } =
        await loadFixture(deployZkContracts);

      // slots = [Google, Google, Kakao]
      const googleInfo = simulatorGoogle.getUserInfo();
      const kakaoInfo = simulatorKakao.getUserInfo();

      const secrets = [
        { iss: `"${googleInfo.iss}"`, sub: `"${googleInfo.sub}"`, aud: `"${googleInfo.aud}"` },
        { iss: `"${googleInfo.iss}"`, sub: `"${googleInfo.sub}"`, aud: `"${googleInfo.aud}"` },
        { iss: `"${kakaoInfo.iss}"`, sub: `"${kakaoInfo.sub}"`, aud: `"${kakaoInfo.aud}"` },
      ];


      // Register Google RSA
      const googleRsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const googleLeafInput = prepareLeafInput(googleInfo.iss, googleRsaN);
      const googleHash = await computePoseidonHash(googleLeafInput);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(googleHash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(googleRsaN))),
      );

      // Register Kakao RSA
      const kakaoRsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorKakao.getRsaComponents().n, "base64")));
      const kakaoLeafInput = prepareLeafInput(kakaoInfo.iss, kakaoRsaN);
      const kakaoHash = await computePoseidonHash(kakaoLeafInput);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(kakaoHash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(kakaoInfo.iss + kakaoRsaN))),
      );

      const anchor = await computeAnchor(secrets);
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [ZKAP_N, ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor],
      );

      const verifier = await registerTestVerifier(
        accountKeyZkOAuthRS256VerifierImpl,
        encoded,
        await poseidonMerkleTreeDirectory.getAddress(),
      );

      const SCanchor = await verifier.impl.getAnchor(0, verifier.account, verifier.keyId);
      const anchorUint = SCanchor.map((x: bigint) => x.toString());

      // Generate JWTs (Google, Google, Kakao)
      const nonceHex = ethers.toBeHex(TEST_NONCE, 32);
      const googleToken = await simulatorGoogle.generateIdToken(nonceHex);
      const kakaoToken = await simulatorKakao.generateIdToken(nonceHex);
      const jwts = [googleToken, googleToken, kakaoToken];
      const pkOps = [
        simulatorGoogle.getRsaComponents().n,
        simulatorGoogle.getRsaComponents().n,
        simulatorKakao.getRsaComponents().n,
      ];

      // Merkle proof
      const root = await poseidonMerkleTreeDirectory.getRoot();
      const googleLeafIdx = 0;
      const kakaoLeafIdx = 1;

      const googlePath = await poseidonMerkleTreeDirectory.getMerklePath(googleLeafIdx);
      const kakaoPath = await poseidonMerkleTreeDirectory.getMerklePath(kakaoLeafIdx);
      const googlePathUint = googlePath.map((x: string) => ethers.toBigInt(x).toString());
      const kakaoPathUint = kakaoPath.map((x: string) => ethers.toBigInt(x).toString());
      const rootUint = ethers.toBigInt(root).toString();

      const merklePaths = [googlePathUint, googlePathUint, kakaoPathUint];
      const leafIndices = [googleLeafIdx, googleLeafIdx, kakaoLeafIdx];

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

      expect(proofResult.proofs.length).to.equal(ZKAP_K);

      // NAPI sharedInputs[6]: [hanchor(0), h_ctx(1), root(2), h_sign_userop(3), lhs(4), h_aud_list(5)]
      const contractSharedInputs: [bigint, bigint, bigint, bigint, bigint, bigint] = [
        BigInt(proofResult.sharedInputs[0]), // hanchor
        BigInt(proofResult.sharedInputs[1]), // h_ctx
        BigInt(proofResult.sharedInputs[2]), // root
        BigInt(proofResult.sharedInputs[3]), // h_sign_userop
        BigInt(proofResult.sharedInputs[4]), // lhs
        BigInt(proofResult.sharedInputs[5]), // h_aud_list
      ];
      const jwtExpList: bigint[] = proofResult.jwtExpList.map((v) => BigInt(v));

      const partialRhsList = proofResult.partialRhsList.map((v) => BigInt(v));
      const proofs: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint][] = proofResult.proofs.map(
        (proof) => proof.map((v) => BigInt(v)) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
      );

      const sig = abiCoder.encode(["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"], [contractSharedInputs, jwtExpList, partialRhsList, proofs]);

      // Validate - use verifier.signer directly
      const result = await verifier.impl
        .connect(verifier.signer)
        .validate.staticCall(0, verifier.keyId, sig, TEST_H_SIGN_USEROP);
      expect(result).to.equal(true);
    });
  });

  describe("TC-N3K3-005: Proof Validation Gas Measurement", function () {
    it("N=3, K=3 Proof validation gas", async function () {
      if (!zkServerAvailable) this.skip();
      this.timeout(180000);

      const { poseidonMerkleTreeDirectory, accountKeyZkOAuthRS256VerifierImpl, simulatorGoogle } = await loadFixture(
        deployZkContracts,
      );

      const googleInfo = simulatorGoogle.getUserInfo();
      const secret = {
        iss: `"${googleInfo.iss}"`,
        sub: `"${googleInfo.sub}"`,
        aud: `"${googleInfo.aud}"`,
      };
      const secrets = [secret, secret, secret];

      const rsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const leafInputStr = prepareLeafInput(googleInfo.iss, rsaN);
      const hash = await computePoseidonHash(leafInputStr);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(hash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(rsaN))),
      );

      const anchor = await computeAnchor(secrets);
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [ZKAP_N, ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor],
      );

      const verifier = await registerTestVerifier(
        accountKeyZkOAuthRS256VerifierImpl,
        encoded,
        await poseidonMerkleTreeDirectory.getAddress(),
      );

      const SCanchor = await verifier.impl.getAnchor(0, verifier.account, verifier.keyId);
      const anchorUint = SCanchor.map((x: bigint) => x.toString());

      const nonceHex = ethers.toBeHex(TEST_NONCE, 32);
      const token = await simulatorGoogle.generateIdToken(nonceHex);
      const jwts = [token, token, token];
      const pkOps = Array(ZKAP_K).fill(simulatorGoogle.getRsaComponents().n);

      const root = await poseidonMerkleTreeDirectory.getRoot();
      const leafIndex = 0;
      const merklePath = await poseidonMerkleTreeDirectory.getMerklePath(leafIndex);
      const pathUint = merklePath.map((x: string) => ethers.toBigInt(x).toString());
      const rootUint = ethers.toBigInt(root).toString();

      const merklePaths = [pathUint, pathUint, pathUint];
      const leafIndices = [leafIndex, leafIndex, leafIndex];

      const audList = [H_GOOGLE_AUD, H_KAKAO_AUD];

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

      // NAPI sharedInputs[6]: [hanchor(0), h_ctx(1), root(2), h_sign_userop(3), lhs(4), h_aud_list(5)]
      const contractSharedInputs: [bigint, bigint, bigint, bigint, bigint, bigint] = [
        BigInt(proofResult.sharedInputs[0]), // hanchor
        BigInt(proofResult.sharedInputs[1]), // h_ctx
        BigInt(proofResult.sharedInputs[2]), // root
        BigInt(proofResult.sharedInputs[3]), // h_sign_userop
        BigInt(proofResult.sharedInputs[4]), // lhs
        BigInt(proofResult.sharedInputs[5]), // h_aud_list
      ];
      const jwtExpList: bigint[] = proofResult.jwtExpList.map((v) => BigInt(v));

      const partialRhsList = proofResult.partialRhsList.map((v) => BigInt(v));
      const proofs: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint][] = proofResult.proofs.map(
        (proof) => proof.map((v) => BigInt(v)) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
      );

      const sig = abiCoder.encode(["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"], [contractSharedInputs, jwtExpList, partialRhsList, proofs]);

      // Measure gas - use verifier.signer directly
      const validateGas = await verifier.impl
        .connect(verifier.signer)
        .validate.estimateGas(0, verifier.keyId, sig, TEST_H_SIGN_USEROP);
      console.log(`\n    ⛽ ZK proof validation gas (N=${ZKAP_N}, K=${ZKAP_K}): ${validateGas}`);

      expect(validateGas).to.be.greaterThan(0n);
    });
  });

  describe("TC-N3K3-006: Register ZK Key via updateTxKey", function () {
    it("register N=3,K=3 ZK OAuth key in AddressKey wallet", async function () {
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


      const googleInfo = simulatorGoogle.getUserInfo();
      const rsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
      const leafInputStr = prepareLeafInput(googleInfo.iss, rsaN);
      const hash = await computePoseidonHash(leafInputStr);
      await poseidonMerkleTreeDirectory.insertCm(
        ethers.zeroPadBytes(ethers.toBeHex(hash, 32), 32),
        ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(rsaN))),
      );

      const abiCoder = ethers.AbiCoder.defaultAbiCoder();

      // Create wallet with AddressKey (singleton pattern: pure ABI encoding)
      const addressKeyInitData = abiCoder.encode(["address"], [owner.address]);

      const encodedAddressKey = abiCoder.encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [await accountKeyAddressLogic.getAddress()], [addressKeyInitData], [1]],
      );

      const accountAddress = await zkapAccountFactory.createAccount.staticCall(1, encodedAddressKey, encodedAddressKey);
      await zkapAccountFactory.createAccount(1, encodedAddressKey, encodedAddressKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      await owner.sendTransaction({
        to: accountAddress,
        value: ethers.parseEther("1.0"),
      });

      // Compute ZkOAuth anchor (N=3)
      const secret = {
        iss: `"${googleInfo.iss}"`,
        sub: `"${googleInfo.sub}"`,
        aud: `"${googleInfo.aud}"`,
      };
      const secrets = [secret, secret, secret];
      const anchor = await computeAnchor(secrets);

      // Encode ZkOAuth Key (singleton pattern: pure ABI encoding)
      const zkOAuthEncoded = abiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256[]"],
        [ZKAP_N, ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor],
      );
      const zkOAuthKeyInitData = abiCoder.encode(
        ["bytes", "address"],
        [zkOAuthEncoded, await poseidonMerkleTreeDirectory.getAddress()],
      );

      const encodedZkTxKey = abiCoder.encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [await accountKeyZkOAuthRS256VerifierImpl.getAddress()], [zkOAuthKeyInitData], [1]],
      );

      const entryPointAddress = await entryPoint.getAddress();
      await hre_network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [entryPointAddress],
      });
      await hre_network.provider.send("hardhat_setBalance", [entryPointAddress, "0x1000000000000000000"]);
      const entryPointSigner = await ethers.getSigner(entryPointAddress);

      // Measure gas
      const updateTxKeyGas = await account.connect(entryPointSigner).updateTxKey.estimateGas(encodedZkTxKey);
      console.log(`\n    ⛽ updateTxKey (ZK) gas (N=${ZKAP_N}, K=${ZKAP_K}): ${updateTxKeyGas}`);

      await account.connect(entryPointSigner).updateTxKey(encodedZkTxKey);

      await hre_network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [entryPointAddress],
      });

      // Singleton pattern: use KeyRef.logic
      const newTxKeyRef = await account.txKeyList(0);
      const txKeyContract = await ethers.getContractAt("AccountKeyZkOAuthRS256Verifier", newTxKeyRef.logic);
      expect(await txKeyContract.keyType()).to.equal(6);

      expect(updateTxKeyGas).to.be.greaterThan(0n);
    });
  });
});
