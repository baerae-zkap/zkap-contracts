/**
 * Gas Benchmark: updateTxKey with 5 WebAuthn keys
 *
 * Measures gas consumption when registering 1~5 WebAuthn keys
 * via a single updateTxKey call.
 */

import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { encodeAddressKey, encodePrimitiveKeys, encodeWebAuthnKey } from "../../helpers/accountKeyHelper";
import {
  createUserOp,
  getUserOpHash,
  signUserOp,
  encodeZkapSignature,
  generateWebAuthnKeyPair,
} from "../../helpers/userOpHelper";

function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

async function deployFixture() {
  const signers = await ethers.getSigners();
  const owner = signers[0];

  const EntryPointFactory = await ethers.getContractFactory("SimpleEntryPoint");
  const entryPoint = await EntryPointFactory.deploy();
  await entryPoint.waitForDeployment();

  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();
  await accountKeyAddressLogic.waitForDeployment();

  const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
  const accountKeyWebAuthnLogic = await AccountKeyWebAuthnFactory.deploy();
  await accountKeyWebAuthnLogic.waitForDeployment();

  const FactoryContract = await ethers.getContractFactory("ZkapAccountFactory");
  const factory = await FactoryContract.deploy(await entryPoint.getAddress());
  await factory.waitForDeployment();

  return { entryPoint, factory, accountKeyAddressLogic, accountKeyWebAuthnLogic, owner };
}

describe("Gas Benchmark: updateTxKey with WebAuthn keys", function () {
  it("measure gas for updateTxKey with 1, 2, 3, 4, 5 WebAuthn keys", async function () {
    const { entryPoint, factory, accountKeyAddressLogic, accountKeyWebAuthnLogic, owner } =
      await loadFixture(deployFixture);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const webAuthnLogicAddr = await accountKeyWebAuthnLogic.getAddress();
    const addressLogicAddr = await accountKeyAddressLogic.getAddress();
    const keyCounts = [1, 2, 3, 4, 5];
    const gasResults: { keyCount: number; gasUsed: bigint }[] = [];

    for (const keyCount of keyCounts) {
      // Create a fresh wallet per iteration (AddressKey for masterKey, AddressKey for initial txKey)
      const masterWallet = createTestWallet(700 + keyCount);
      const oldTxWallet = createTestWallet(800 + keyCount);

      const masterKey = encodeAddressKey(masterWallet.address, addressLogicAddr, 1);
      const encodedMasterKey = encodePrimitiveKeys(1, [masterKey]);

      const oldTxKey = encodeAddressKey(oldTxWallet.address, addressLogicAddr, 1);
      const encodedOldTxKey = encodePrimitiveKeys(1, [oldTxKey]);

      const salt = 9000 + keyCount;
      const accountAddress = await factory.createAccount.staticCall(salt, encodedMasterKey, encodedOldTxKey);
      await factory.createAccount(salt, encodedMasterKey, encodedOldTxKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
      await account.addDeposit({ value: ethers.parseEther("5.0") });

      // Generate N WebAuthn keys
      const webAuthnKeys = [];
      for (let i = 0; i < keyCount; i++) {
        const kp = generateWebAuthnKeyPair();
        webAuthnKeys.push(
          encodeWebAuthnKey(kp.publicKey.x, kp.publicKey.y, kp.credentialId, kp.rpIdHash, kp.origin, webAuthnLogicAddr, 1),
        );
      }
      const newEncodedTxKey = encodePrimitiveKeys(keyCount, webAuthnKeys); // threshold = keyCount

      // Build & sign UserOp for updateTxKey (higher gas limits for many keys)
      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);
      const userOp = await createUserOp(account, callData);

      // Override gas limits: 5 WebAuthn key registrations need more gas
      const verificationGasLimit = 3000000n;
      const callGasLimit = 3000000n;
      userOp.accountGasLimits = ethers.concat([
        ethers.toBeHex(verificationGasLimit, 16),
        ethers.toBeHex(callGasLimit, 16),
      ]);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const sig = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [sig]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      gasResults.push({ keyCount, gasUsed: receipt!.gasUsed });

      // Verify update succeeded
      const actualThreshold = await account.txKeyThreshold();
      expect(actualThreshold).to.equal(keyCount, `txKeyThreshold mismatch for keyCount=${keyCount}`);
    }

    // Print results
    console.log("\n--- updateTxKey Gas: WebAuthn keys ---");
    for (const r of gasResults) {
      console.log(`  ${r.keyCount} WebAuthn key(s): ${r.gasUsed.toString()} gas`);
    }
    if (gasResults.length >= 2) {
      const perKeyDelta =
        (gasResults[gasResults.length - 1].gasUsed - gasResults[0].gasUsed) / BigInt(keyCounts.length - 1);
      console.log(`  Approx per-key delta: ~${perKeyDelta.toString()} gas`);
    }

    // Sanity: gas should increase with more keys
    for (let i = 1; i < gasResults.length; i++) {
      expect(gasResults[i].gasUsed).to.be.greaterThan(gasResults[i - 1].gasUsed);
    }
  });
});
