/**
 * E2E Tests: Recovery
 *
 * CNT-418 ~ CNT-423: Recovery Tests
 * - Recover txKey using masterKey
 * - Execute transaction with new txKey after recovery
 * - Fail transaction with old txKey after recovery
 * - 2-of-3 multisig masterKey recovery
 * - 3-of-3 multisig masterKey recovery
 */

import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { encodeAddressKey, encodePrimitiveKeys } from "../../helpers/accountKeyHelper";
import { createUserOp, getUserOpHash, signUserOp, encodeZkapSignature } from "../../helpers/userOpHelper";

// Helper: Create test wallet
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Fixture: Deploy base contracts
async function deployBaseContracts() {
  const signers = await ethers.getSigners();
  const owner = signers[0];

  // 1. Deploy EntryPoint
  const EntryPointFactory = await ethers.getContractFactory("SimpleEntryPoint");
  const entryPoint = await EntryPointFactory.deploy();
  await entryPoint.waitForDeployment();

  // 2. Deploy AccountKeyAddress Logic
  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();
  await accountKeyAddressLogic.waitForDeployment();

  // 3. Deploy ZkapAccountFactory
  const FactoryContract = await ethers.getContractFactory("ZkapAccountFactory");
  const factory = await FactoryContract.deploy(await entryPoint.getAddress());
  await factory.waitForDeployment();

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    owner,
    signers,
  };
}

// Fixture: Deploy wallet for 1-of-1 recovery test
async function deployWalletForRecovery() {
  const base = await deployBaseContracts();
  const { factory, entryPoint, accountKeyAddressLogic, owner } = base;

  // Create test wallets
  const masterWallet = createTestWallet(100);
  const lostTxWallet = createTestWallet(200); // Simulating lost txKey
  const newTxWallet = createTestWallet(201);

  // Create encoded keys
  const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedMasterKey = encodePrimitiveKeys(1, [masterKey]);

  const txKey = encodeAddressKey(lostTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedTxKey = encodePrimitiveKeys(1, [txKey]);

  // Create wallet
  const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
  await factory.createAccount(1, encodedMasterKey, encodedTxKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return {
    ...base,
    account,
    accountAddress,
    masterWallet,
    lostTxWallet,
    newTxWallet,
  };
}

// Fixture: Deploy wallet with 2-of-3 multisig masterKey
async function deployWalletWith2of3MasterKey() {
  const base = await deployBaseContracts();
  const { factory, entryPoint, accountKeyAddressLogic, owner } = base;

  // Create master wallets for 2-of-3 multisig
  const masterWallet1 = createTestWallet(100);
  const masterWallet2 = createTestWallet(101);
  const masterWallet3 = createTestWallet(102);

  // Create txKey wallet (simulating lost key)
  const lostTxWallet = createTestWallet(200);
  const newTxWallet = createTestWallet(201);

  // Create 2-of-3 masterKey (threshold = 2, 3 keys with weight 1 each)
  const masterKey1 = encodeAddressKey(masterWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
  const masterKey2 = encodeAddressKey(masterWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
  const masterKey3 = encodeAddressKey(masterWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedMasterKey = encodePrimitiveKeys(2, [masterKey1, masterKey2, masterKey3]);

  // Create 1-of-1 txKey
  const txKey = encodeAddressKey(lostTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedTxKey = encodePrimitiveKeys(1, [txKey]);

  // Create wallet
  const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
  await factory.createAccount(1, encodedMasterKey, encodedTxKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return {
    ...base,
    account,
    accountAddress,
    masterWallet1,
    masterWallet2,
    masterWallet3,
    lostTxWallet,
    newTxWallet,
  };
}

// Fixture: Deploy wallet with 3-of-3 multisig masterKey
async function deployWalletWith3of3MasterKey() {
  const base = await deployBaseContracts();
  const { factory, entryPoint, accountKeyAddressLogic, owner } = base;

  // Create master wallets for 3-of-3 multisig
  const masterWallet1 = createTestWallet(100);
  const masterWallet2 = createTestWallet(101);
  const masterWallet3 = createTestWallet(102);

  // Create txKey wallet (simulating lost key)
  const lostTxWallet = createTestWallet(200);
  const newTxWallet = createTestWallet(201);

  // Create 3-of-3 masterKey (threshold = 3, 3 keys with weight 1 each)
  const masterKey1 = encodeAddressKey(masterWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
  const masterKey2 = encodeAddressKey(masterWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
  const masterKey3 = encodeAddressKey(masterWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedMasterKey = encodePrimitiveKeys(3, [masterKey1, masterKey2, masterKey3]);

  // Create 1-of-1 txKey
  const txKey = encodeAddressKey(lostTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedTxKey = encodePrimitiveKeys(1, [txKey]);

  // Create wallet
  const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
  await factory.createAccount(1, encodedMasterKey, encodedTxKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return {
    ...base,
    account,
    accountAddress,
    masterWallet1,
    masterWallet2,
    masterWallet3,
    lostTxWallet,
    newTxWallet,
  };
}

describe("E2E: Recovery", function () {
  describe("1-of-1 MasterKey Recovery", function () {
    // CNT-418: recover wallet using masterKey (replace txKey)
    it("CNT-418: recover wallet by replacing txKey with masterKey", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newTxWallet } = await loadFixture(
        deployWalletForRecovery
      );

      // Create new txKey to replace the lost one
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      // Call updateTxKey directly (recovery operation)
      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with masterKey for recovery
      const signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify recovery was successful
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-419: execute transaction with new txKey after recovery
    it("CNT-419: execute transaction with new txKey after recovery", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newTxWallet } = await loadFixture(
        deployWalletForRecovery
      );

      // Step 1: Recovery - replace txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const recoveryCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      let userOp = await createUserOp(account, recoveryCallData);
      let chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      let signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);
      await mine(1); // Pass txKeyUpdateBlock check

      // Step 2: Execute transaction with recovered txKey
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("1.0");
      const transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with new (recovered) txKey
      signature = await signUserOp(userOpHash, newTxWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-420: transaction fails with old txKey after recovery
    it("CNT-420: fail transaction with old txKey after recovery", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, lostTxWallet, newTxWallet } =
        await loadFixture(deployWalletForRecovery);

      // Step 1: Recovery - replace txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const recoveryCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      let userOp = await createUserOp(account, recoveryCallData);
      let chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      let signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);
      await mine(1);

      // Step 2: Try to execute with old (lost) txKey - should fail
      const recipient = ethers.Wallet.createRandom().address;
      const transferCallData = account.interface.encodeFunctionData("execute", [
        recipient,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with old (lost) txKey
      signature = await signUserOp(userOpHash, lostTxWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail because old key is no longer valid
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });
  });

  describe("Multisig MasterKey Recovery", function () {
    // CNT-421: recover txKey using 2-of-3 on-chain masterKey
    it("CNT-421: recover txKey with 2-of-3 multisig masterKey", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet1, masterWallet2, newTxWallet } =
        await loadFixture(deployWalletWith2of3MasterKey);

      // Verify initial 2-of-3 masterKey setup
      expect(await account.masterKeyThreshold()).to.equal(2);

      // Create new txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      // Call updateTxKey directly
      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with 2 out of 3 masterKeys
      const signature1 = await signUserOp(userOpHash, masterWallet1);
      const signature2 = await signUserOp(userOpHash, masterWallet2);

      // Encode multiple signatures (keys 0 and 1)
      userOp.signature = encodeZkapSignature([0, 1], [signature1, signature2]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey was recovered
      expect(await account.txKeyThreshold()).to.equal(1);

      // Verify new txKey works
      await mine(1);
      const transferCallData = account.interface.encodeFunctionData("execute", [
        owner.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp2 = await createUserOp(account, transferCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const sig = await signUserOp(userOpHash2, newTxWallet);
      userOp2.signature = encodeZkapSignature([0], [sig]);

      await entryPoint.handleOps([userOp2], owner.address);
    });

    // CNT-422: recover txKey using 3-of-3 on-chain masterKey
    it("CNT-422: recover txKey with 3-of-3 multisig masterKey", async function () {
      const {
        account,
        entryPoint,
        accountKeyAddressLogic,
        owner,
        masterWallet1,
        masterWallet2,
        masterWallet3,
        newTxWallet,
      } = await loadFixture(deployWalletWith3of3MasterKey);

      // Verify initial 3-of-3 masterKey setup
      expect(await account.masterKeyThreshold()).to.equal(3);

      // Create new txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      // Call updateTxKey directly
      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with all 3 masterKeys
      const signature1 = await signUserOp(userOpHash, masterWallet1);
      const signature2 = await signUserOp(userOpHash, masterWallet2);
      const signature3 = await signUserOp(userOpHash, masterWallet3);

      // Encode all 3 signatures
      userOp.signature = encodeZkapSignature([0, 1, 2], [signature1, signature2, signature3]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey was recovered
      expect(await account.txKeyThreshold()).to.equal(1);

      // Verify new txKey works
      await mine(1);
      const transferCallData = account.interface.encodeFunctionData("execute", [
        owner.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp2 = await createUserOp(account, transferCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const sig = await signUserOp(userOpHash2, newTxWallet);
      userOp2.signature = encodeZkapSignature([0], [sig]);

      await entryPoint.handleOps([userOp2], owner.address);
    });

    // CNT-421 extra: recovery fails with only 1-of-3 signatures in 2-of-3
    it("CNT-421-fail: fail recovery with only 1-of-3 signatures", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet1, newTxWallet } = await loadFixture(
        deployWalletWith2of3MasterKey
      );

      // Create new txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with only 1 masterKey (threshold is 2)
      const signature1 = await signUserOp(userOpHash, masterWallet1);
      userOp.signature = encodeZkapSignature([0], [signature1]);

      // Should fail because threshold not met
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });
  });
});
