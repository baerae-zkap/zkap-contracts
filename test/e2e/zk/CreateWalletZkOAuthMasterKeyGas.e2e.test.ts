/**
 * Gas Benchmark: createAccount with ZkOAuth RS256 masterKey (1 vs 2 keys)
 *
 * Measures gas consumption when creating a wallet with 1 or 2 ZkOAuth RS256
 * keys as masterKey (multisig 2-of-2 for 2-key case).
 */

import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import path from "path";
import fs from "fs";
import { IdTokenSimulator } from "../../helpers/idTokenSimulator";
import { napiGenerateAnchor } from "../../../zk-assets/n3k3/napi";

const CURRENT_ZKAP_N = 3;
const CURRENT_ZKAP_K = 3;

const CRS_DIR = path.join(__dirname, "../../../zk-assets/n3k3/crs");
const PK_KEY_PATH = path.join(CRS_DIR, "pk.key");

const H_AUD_LISTS = "0x4FD75F1BE3EEB4AF5268644996E30BAEEAFE98C7BE082456E080E3F6A683F39";
const GOOGLE_LEAF = "0x845216E3AC9E7597B166A57FB053CD030DF5FDAD0C2ABB0A33DBFA95BF687B7";
const KAKAO_LEAF = "0x833B9FBD56D31820FC81698B97C4A49647FE902841EA8DCBA8CD790339EAA7F";

function checkCrsFilesExist(): boolean {
  try {
    return fs.existsSync(PK_KEY_PATH);
  } catch {
    return false;
  }
}

async function computeAnchor(secrets: Array<{ iss: string; sub: string; aud: string }>): Promise<string[]> {
  const result = napiGenerateAnchor({ secrets });
  return result.anchor;
}

async function deployFixture() {
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
    poseidonMerkleTreeDirectory,
    accountKeyZkOAuthRS256VerifierImpl,
    zkapAccountFactory,
    accountKeyAddressLogic,
    simulatorGoogle,
    simulatorKakao,
  };
}

describe("Gas Benchmark: createAccount with ZkOAuth RS256 masterKey", function () {
  let crsAvailable = false;

  before(function () {
    crsAvailable = checkCrsFilesExist();
    if (!crsAvailable) {
      console.log("\n  CRS files not found. Skipping ZK tests.");
      console.log(`  CRS directory: ${CRS_DIR}`);
      console.log("  Run ./setup-zk-build.sh to generate CRS files.\n");
    }
  });

  it("measure gas for createAccount with 1 and 2 ZkOAuth RS256 masterKeys", async function () {
    if (!crsAvailable) this.skip();
    this.timeout(120000);

    const {
      owner,
      poseidonMerkleTreeDirectory,
      accountKeyZkOAuthRS256VerifierImpl,
      zkapAccountFactory,
      accountKeyAddressLogic,
      simulatorGoogle,
      simulatorKakao,
    } = await loadFixture(deployFixture);

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const zkOAuthLogicAddr = await accountKeyZkOAuthRS256VerifierImpl.getAddress();
    const addressLogicAddr = await accountKeyAddressLogic.getAddress();
    const pmtdAddr = await poseidonMerkleTreeDirectory.getAddress();

    // Register Google RSA public key in PoseidonMerkleTreeDirectory
    const googleInfo = simulatorGoogle.getUserInfo();
    const googleRsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorGoogle.getRsaComponents().n, "base64")));
    await poseidonMerkleTreeDirectory.insertCm(
      ethers.zeroPadBytes(ethers.toBeHex(GOOGLE_LEAF, 32), 32),
      ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(googleRsaN))),
    );

    // Register Kakao RSA public key in PoseidonMerkleTreeDirectory
    const kakaoInfo = simulatorKakao.getUserInfo();
    const kakaoRsaN = ethers.hexlify(Uint8Array.from(Buffer.from(simulatorKakao.getRsaComponents().n, "base64")));
    await poseidonMerkleTreeDirectory.insertCm(
      ethers.zeroPadBytes(ethers.toBeHex(KAKAO_LEAF, 32), 32),
      ethers.toBeHex(ethers.sha256(ethers.toUtf8Bytes(kakaoInfo.iss + kakaoRsaN))),
    );

    // --- Prepare Google ZkOAuth key ---
    const googleSecret = {
      iss: `"${googleInfo.iss}"`,
      sub: `"${googleInfo.sub}"`,
      aud: `"${googleInfo.aud}"`,
    };
    const googleSecrets = Array(CURRENT_ZKAP_N).fill(googleSecret);
    const googleAnchor = await computeAnchor(googleSecrets);

    const googleZkOAuthEncoded = abiCoder.encode(
      ["uint256", "uint256", "uint256", "uint256[]"],
      [CURRENT_ZKAP_N, CURRENT_ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), googleAnchor],
    );
    const googleZkOAuthKeyInitData = abiCoder.encode(
      ["bytes", "address"],
      [googleZkOAuthEncoded, pmtdAddr],
    );

    // --- Prepare Kakao ZkOAuth key ---
    const kakaoSecret = {
      iss: `"${kakaoInfo.iss}"`,
      sub: `"${kakaoInfo.sub}"`,
      aud: `"${kakaoInfo.aud}"`,
    };
    const kakaoSecrets = Array(CURRENT_ZKAP_N).fill(kakaoSecret);
    const kakaoAnchor = await computeAnchor(kakaoSecrets);

    const kakaoZkOAuthEncoded = abiCoder.encode(
      ["uint256", "uint256", "uint256", "uint256[]"],
      [CURRENT_ZKAP_N, CURRENT_ZKAP_K, ethers.toBeHex(H_AUD_LISTS, 32), kakaoAnchor],
    );
    const kakaoZkOAuthKeyInitData = abiCoder.encode(
      ["bytes", "address"],
      [kakaoZkOAuthEncoded, pmtdAddr],
    );

    // --- Common txKey: AddressKey ---
    const addressKeyInitData = abiCoder.encode(["address"], [owner.address]);
    const encodedTxKey = abiCoder.encode(
      ["uint8", "address[]", "bytes[]", "uint8[]"],
      [1, [addressLogicAddr], [addressKeyInitData], [1]],
    );

    const gasResults: { keyCount: number; gasUsed: bigint }[] = [];

    // === Case 1: 1 ZkOAuth masterKey (threshold=1) ===
    {
      const encodedMasterKey = abiCoder.encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [zkOAuthLogicAddr], [googleZkOAuthKeyInitData], [1]],
      );

      const accountAddress = await zkapAccountFactory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
      const tx = await zkapAccountFactory.createAccount(1, encodedMasterKey, encodedTxKey);
      const receipt = await tx.wait();

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(1);

      gasResults.push({ keyCount: 1, gasUsed: receipt!.gasUsed });
    }

    // === Case 2: 2 ZkOAuth masterKeys (threshold=2, 2-of-2 multisig) ===
    {
      const encodedMasterKey = abiCoder.encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          2, // threshold
          [zkOAuthLogicAddr, zkOAuthLogicAddr],
          [googleZkOAuthKeyInitData, kakaoZkOAuthKeyInitData],
          [1, 1], // weights
        ],
      );

      const accountAddress = await zkapAccountFactory.createAccount.staticCall(2, encodedMasterKey, encodedTxKey);
      const tx = await zkapAccountFactory.createAccount(2, encodedMasterKey, encodedTxKey);
      const receipt = await tx.wait();

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(2);

      const masterKeyRef0 = await account.masterKeyList(0);
      const masterKeyRef1 = await account.masterKeyList(1);
      expect(masterKeyRef0.logic).to.equal(zkOAuthLogicAddr);
      expect(masterKeyRef1.logic).to.equal(zkOAuthLogicAddr);

      gasResults.push({ keyCount: 2, gasUsed: receipt!.gasUsed });
    }

    // Print results
    console.log("\n--- createAccount Gas: ZkOAuth RS256 masterKey ---");
    for (const r of gasResults) {
      console.log(`  ${r.keyCount} ZkOAuth masterKey(s): ${r.gasUsed.toString()} gas`);
    }
    if (gasResults.length === 2) {
      const delta = gasResults[1].gasUsed - gasResults[0].gasUsed;
      console.log(`  Delta (2-key vs 1-key): +${delta.toString()} gas`);
    }

    // Gas should increase with more keys
    expect(gasResults[1].gasUsed).to.be.greaterThan(gasResults[0].gasUsed);
  });
});
