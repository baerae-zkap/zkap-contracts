/**
 * ZK Test Data Extraction Script
 *
 * Saves proof data used in e2e tests to a JSON file.
 * This data is used in unit tests to test the success path.
 *
 * Run: npx ts-node scripts/extract-zk-test-data.ts
 */

import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import path from "path";
import fs from "fs";
import { IdTokenSimulator } from "../test/helpers/idTokenSimulator";
import crypto from "../test/helpers/crypto";
import { napiGenerateAnchor, napiGenerateProof, napiGeneratePoseidonHash } from "../zk-assets/napi";

const ZKAP_N = 6;
const ZKAP_K = 3;
const CRS_DIR = path.join(__dirname, "../zk-assets/crs");
const PK_KEY_PATH = path.join(CRS_DIR, "pk.key");
const OUTPUT_PATH = path.join(__dirname, "../test/fixtures/zk-test-data.json");

const MAX_ISS_LEN = 93;
const PAD_CHAR = 0;

const H_GOOGLE_AUD = "0x3663427A957C7693D40523587FD9A138EF4055676E3D900993A2AB03E238220";
const H_KAKAO_AUD = "0x245EC8B02B6D98E1E3BBCF2C7DE1C4981A6CEFD0833B3ECE23172B5A479269CF";
const H_AUD_LISTS = "0x4FD75F1BE3EEB4AF5268644996E30BAEEAFE98C7BE082456E080E3F6A683F39";

const TEST_H_SIGN_USEROP = "67890";
const TEST_RANDOM = "12345";
const TEST_NONCE = "0x2803f757a950838bddd0386fde28d1e84508eb42c08d0bd5aa5541f74069828e";

async function computePoseidonHash(inputs: string[]): Promise<string> {
  const result = napiGeneratePoseidonHash({ inputs });
  return result.hash;
}

async function computeAnchor(secrets: Array<{ iss: string; sub: string; aud: string }>): Promise<string[]> {
  const result = napiGenerateAnchor({ secrets });
  return result.anchor;
}

function prepareLeafInput(iss: string, rsaN: string): string[] {
  const issFields = crypto.padAndStrToFieldsBN254(`"${iss}"`, MAX_ISS_LEN, PAD_CHAR);
  const formattedN = crypto.formattingModulorN(rsaN);
  const nDecimal = formattedN.map((value) => ethers.toBigInt(value));
  const leafInput = issFields.concat(nDecimal);
  return leafInput.map((value) => value.toString());
}

async function main() {
  console.log("🚀 Starting ZK test data extraction...\n");

  if (!fs.existsSync(PK_KEY_PATH)) {
    console.error("❌ CRS file not found. Run setup-zk-build-mobile.sh first.");
    process.exit(1);
  }

  // Deploy contracts
  const [owner] = await ethers.getSigners();

  const Groth16Verifier = await ethers.deployContract("contracts/Utils/Groth16Verifier.sol:Groth16Verifier");
  const PoseidonHashLib = await ethers.deployContract("PoseidonHashLib");

  const PoseidonMerkleTreeDirectoryFactory = await ethers.getContractFactory("PoseidonMerkleTreeDirectory", {
    libraries: { PoseidonHashLib: await PoseidonHashLib.getAddress() },
  });
  const poseidonMerkleTreeDirectory = await PoseidonMerkleTreeDirectoryFactory.deploy();
  await poseidonMerkleTreeDirectory.waitForDeployment();

  const AccountKeyZkOAuthRS256VerifierFactory = await ethers.getContractFactory("AccountKeyZkOAuthRS256Verifier", {
    libraries: {
      Groth16Verifier: await Groth16Verifier.getAddress(),
      PoseidonHashLib: await PoseidonHashLib.getAddress(),
    },
  });
  const verifierImpl = await AccountKeyZkOAuthRS256VerifierFactory.deploy();
  await verifierImpl.waitForDeployment();

  // Initialize simulator
  const simulatorGoogle = new IdTokenSimulator("google");
  await simulatorGoogle.initialize();
  const googleInfo = simulatorGoogle.getUserInfo();

  // Generate secrets (use all N=6 slots)
  const secrets = [];
  for (let i = 0; i < ZKAP_N; i++) {
    secrets.push({
      iss: `"${googleInfo.iss}"`,
      sub: `"${googleInfo.sub}"`,
      aud: `"${googleInfo.aud}"`,
    });
  }

  // Initialize Merkle Tree and register RSA public key
  await poseidonMerkleTreeDirectory.initialize(16);
  const rsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
  const leafInputStr = prepareLeafInput(googleInfo.iss, rsaN);
  const leafHash = await computePoseidonHash(leafInputStr);

  await poseidonMerkleTreeDirectory.insertCm(
    ethers.zeroPadBytes(ethers.toBeHex(leafHash, 32), 32),
    ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(rsaN))),
    0
  );

  // Compute anchor
  const anchor = await computeAnchor(secrets);

  // Deploy verifier proxy
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    ["uint256", "uint256", "uint256", "uint256[]"],
    [ZKAP_N, ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), anchor]
  );

  const ERC1967ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
  const iface = new ethers.Interface([
    "function initialize(bytes encoded, address poseidonMerkleTreeDirectory)",
  ]);
  const initData = iface.encodeFunctionData("initialize", [encoded, await poseidonMerkleTreeDirectory.getAddress()]);
  const proxy = await ERC1967ProxyFactory.deploy(await verifierImpl.getAddress(), initData);
  await proxy.waitForDeployment();

  const verifier = await ethers.getContractAt("AccountKeyZkOAuthRS256Verifier", await proxy.getAddress());

  // Get anchor from verifier (including hanchor)
  const SCanchor = await verifier.getAnchor();
  const anchorUint = SCanchor.map((x: bigint) => x.toString());

  // Generate JWT (K=3)
  const nonceHex = ethers.toBeHex(TEST_NONCE, 32);
  const token = await simulatorGoogle.generateIdToken(nonceHex);
  const jwts = Array(ZKAP_K).fill(token);
  const pkOps = Array(ZKAP_K).fill(simulatorGoogle.getRsaComponents().n);

  // Merkle proof
  const root = await poseidonMerkleTreeDirectory.getRoot();
  const leafIndex = 0;
  const merklePath = await poseidonMerkleTreeDirectory.getMerklePath(leafIndex);
  const pathUint = merklePath.map((x: string) => ethers.toBigInt(x).toString());
  const rootUint = ethers.toBigInt(root).toString();

  const merklePaths = Array(ZKAP_K).fill(pathUint);
  const leafIndices = Array(ZKAP_K).fill(leafIndex);
  const audList = [H_GOOGLE_AUD, H_KAKAO_AUD];

  const now = Math.floor(Date.now() / 1000);

  console.log("📝 Generating ZK Proof...");

  // Generate proof
  const proofResult = napiGenerateProof({
    pkPath: PK_KEY_PATH,
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

  console.log("✅ Proof generation complete\n");

  // Build test data
  const testData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      zkParams: { n: ZKAP_N, k: ZKAP_K },
    },
    constants: {
      hAudLists: H_AUD_LISTS,
      testHSignUserop: TEST_H_SIGN_USEROP,
      testRandom: TEST_RANDOM,
      testNonce: TEST_NONCE,
    },
    deploymentData: {
      anchor: anchor,
      leafHash: leafHash,
      merkleRoot: rootUint,
      merklePath: pathUint,
    },
    proofData: {
      sharedInputs: proofResult.sharedInputs,
      partialRhsList: proofResult.partialRhsList,
      proofs: proofResult.proofs,
    },
  };

  // Save file
  const fixturesDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(testData, null, 2));
  console.log(`💾 Test data saved: ${OUTPUT_PATH}`);

  // Verification test
  console.log("\n🔍 Running verification test...");

  const sharedInputs: [bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
    BigInt(proofResult.sharedInputs[0]),
    BigInt(proofResult.sharedInputs[1]),
    BigInt(proofResult.sharedInputs[2]),
    BigInt(proofResult.sharedInputs[3]),
    BigInt(proofResult.sharedInputs[4]),
    BigInt(proofResult.sharedInputs[5]),
    BigInt(proofResult.sharedInputs[6]),
  ];

  const contractSharedInputs: [bigint, bigint, bigint, bigint, bigint, bigint] = [
    sharedInputs[0],
    sharedInputs[1],
    sharedInputs[2],
    sharedInputs[3],
    sharedInputs[5],
    sharedInputs[6],
  ];

  const jwtExpList = Array(ZKAP_K).fill(sharedInputs[4]);

  const partialRhsListBigInt = proofResult.partialRhsList.map((v: string) => BigInt(v));
  const proofsBigInt = proofResult.proofs.map(
    (proof: string[]) => proof.map((v) => BigInt(v)) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
  );

  const sig = abiCoder.encode(
    ["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"],
    [contractSharedInputs, jwtExpList, partialRhsListBigInt, proofsBigInt]
  );

  // Set block timestamp
  const futureTimestamp = now + 6000000;
  await time.setNextBlockTimestamp(futureTimestamp);
  await ethers.provider.send("evm_mine", []);

  // Verify
  const result = await verifier.validate.staticCall(sig, TEST_H_SIGN_USEROP);

  if (result === true) {
    console.log("✅ Verification successful! Test data is valid.\n");
  } else {
    console.log("❌ Verification failed!");
    process.exit(1);
  }

  console.log("🎉 Done!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
