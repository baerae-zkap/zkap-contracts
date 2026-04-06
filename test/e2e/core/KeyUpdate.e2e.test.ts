/**
 * E2E Tests: Key Update
 *
 * CNT-371 ~ CNT-380: Key Update Tests
 * - txKey update (1-of-1 -> 1-of-1, 1-of-1 -> 2-of-2, 2-of-2 -> 1-of-1)
 * - Verify old key no longer works after update
 * - masterKey update
 */

import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import {
  encodeAddressKey,
  encodePrimitiveKeys,
  createDummyEncodedKey,
  encodeWebAuthnKey,
} from "../../helpers/accountKeyHelper";
import {
  createUserOp,
  getUserOpHash,
  signUserOp,
  encodeZkapSignature,
  createSignedUserOp,
  generateWebAuthnKeyPair,
  signUserOpWebAuthn,
  WebAuthnKeyPair,
} from "../../helpers/userOpHelper";

// Helper: Create test wallet
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Fixture: Deploy contracts for key update tests
async function deployKeyUpdateTestContracts() {
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

  // Create test wallets for various keys
  const masterWallet = createTestWallet(100);
  const oldTxWallet = createTestWallet(200);
  const newTxWallet = createTestWallet(201);
  const newTxWallet2 = createTestWallet(202);
  const newMasterWallet = createTestWallet(300);

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    owner,
    signers,
    masterWallet,
    oldTxWallet,
    newTxWallet,
    newTxWallet2,
    newMasterWallet,
  };
}

// Fixture: Deploy contracts with WebAuthn support for key update tests
async function deployKeyUpdateWithWebAuthn() {
  const base = await deployKeyUpdateTestContracts();
  const { entryPoint, factory, accountKeyAddressLogic, owner, masterWallet, oldTxWallet } = base;

  // Deploy AccountKeyWebAuthn Logic (no library linking needed)
  const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
  const accountKeyWebAuthnLogic = await AccountKeyWebAuthnFactory.deploy();
  await accountKeyWebAuthnLogic.waitForDeployment();

  // Generate WebAuthn key pair for tests
  const webAuthnKeyPair = generateWebAuthnKeyPair();

  // Create wallet with AddressKey for masterKey and txKey
  const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedMasterKey = encodePrimitiveKeys(1, [masterKey]);

  const txKey = encodeAddressKey(oldTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
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
    accountKeyWebAuthnLogic,
    webAuthnKeyPair,
    encodedMasterKey,
    encodedTxKey,
  };
}

// Fixture: Deploy wallet with separate master and tx keys
async function deployWalletForKeyUpdate() {
  const base = await deployKeyUpdateTestContracts();
  const { factory, entryPoint, accountKeyAddressLogic, owner, masterWallet, oldTxWallet, newTxWallet } = base;

  // Create encoded keys
  const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedMasterKey = encodePrimitiveKeys(1, [masterKey]);

  const txKey = encodeAddressKey(oldTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedTxKey = encodePrimitiveKeys(1, [txKey]);

  // Create wallet
  const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
  await factory.createAccount(1, encodedMasterKey, encodedTxKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return { ...base, account, accountAddress, encodedMasterKey, encodedTxKey };
}

describe("E2E: Key Update", function () {
  describe("txKey Update", function () {
    // CNT-371: txKey update (1-of-1 to 1-of-1)
    it("CNT-371: update txKey (1-of-1 to 1-of-1)", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newTxWallet } = await loadFixture(
        deployWalletForKeyUpdate
      );

      // Create new txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      // Call updateTxKey directly (not wrapped in execute)
      // The contract checks methodSig to determine which keyList to use
      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      // Sign with masterKey (for key updates)
      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with masterKey - standard encoding (no type prefix)
      const signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey was updated (threshold should still be 1)
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-372: txKey update (1-of-1 to 2-of-2)
    it("CNT-372: update txKey (1-of-1 to 2-of-2)", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newTxWallet, newTxWallet2 } =
        await loadFixture(deployWalletForKeyUpdate);

      // Create new 2-of-2 txKey
      const newTxKey1 = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxKey2 = encodeAddressKey(newTxWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(2, [newTxKey1, newTxKey2]); // threshold = 2

      // Call updateTxKey directly
      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      const signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey threshold is now 2
      expect(await account.txKeyThreshold()).to.equal(2);
    });

    // CNT-374: execute transaction with updated txKey
    it("CNT-374: execute transaction with updated txKey", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newTxWallet } = await loadFixture(
        deployWalletForKeyUpdate
      );

      // Step 1: Update txKey (call updateTxKey directly)
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      let userOp = await createUserOp(account, updateCallData);
      let chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      let signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Mine a block to pass the txKeyUpdateBlock check
      await mine(1);

      // Step 2: Execute transaction with new txKey
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.5");
      const transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with new txKey
      signature = await signUserOp(userOpHash, newTxWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-375: confirm transaction fails with old txKey
    it("CNT-375: fail transaction with old txKey after update", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, oldTxWallet, newTxWallet } =
        await loadFixture(deployWalletForKeyUpdate);

      // Step 1: Update txKey (call updateTxKey directly)
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      let userOp = await createUserOp(account, updateCallData);
      let chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      let signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);
      await mine(1);

      // Step 2: Try to execute with OLD txKey (should fail)
      const recipient = ethers.Wallet.createRandom().address;
      const transferCallData = account.interface.encodeFunctionData("execute", [
        recipient,
        ethers.parseEther("0.5"),
        "0x",
      ]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with OLD txKey
      signature = await signUserOp(userOpHash, oldTxWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail because old key is no longer valid
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-373: txKey update (2-of-2 to 1-of-1)
    it("CNT-373: update txKey (2-of-2 to 1-of-1)", async function () {
      const base = await loadFixture(deployKeyUpdateTestContracts);
      const {
        factory,
        entryPoint,
        accountKeyAddressLogic,
        owner,
        masterWallet,
        oldTxWallet,
        newTxWallet,
        newTxWallet2,
      } = base;

      // Create wallet with 2-of-2 txKey
      const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedMasterKey = encodePrimitiveKeys(1, [masterKey]);

      const txKey1 = encodeAddressKey(oldTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const txKey2 = encodeAddressKey(newTxWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedTxKey = encodePrimitiveKeys(2, [txKey1, txKey2]); // 2-of-2

      const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
      await factory.createAccount(1, encodedMasterKey, encodedTxKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      // Verify initial threshold is 2
      expect(await account.txKeyThreshold()).to.equal(2);

      // Update to 1-of-1 txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]); // 1-of-1

      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with masterKey
      const signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey threshold is now 1
      expect(await account.txKeyThreshold()).to.equal(1);
    });
  });

  describe("masterKey Update", function () {
    // CNT-378: masterKey update (1-of-1 to 1-of-1)
    it("CNT-378: update masterKey (1-of-1 to 1-of-1)", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newMasterWallet } = await loadFixture(
        deployWalletForKeyUpdate
      );

      // Create new masterKey
      const newMasterKey = encodeAddressKey(newMasterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedMasterKey = encodePrimitiveKeys(1, [newMasterKey]);

      // Call updateMasterKey directly (not wrapped in execute)
      const callData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with current masterKey
      const signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify masterKey threshold is still 1
      expect(await account.masterKeyThreshold()).to.equal(1);
    });

    // CNT-379: masterKey update (1-of-1 to 2-of-2)
    it("CNT-379: update masterKey (1-of-1 to 2-of-2)", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newMasterWallet, newTxWallet } =
        await loadFixture(deployWalletForKeyUpdate);

      // Create new 2-of-2 masterKey
      const newMasterKey1 = encodeAddressKey(newMasterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newMasterKey2 = encodeAddressKey(
        newTxWallet.address, // Reusing wallet for simplicity
        await accountKeyAddressLogic.getAddress(),
        1
      );
      const newEncodedMasterKey = encodePrimitiveKeys(2, [newMasterKey1, newMasterKey2]);

      // Call updateMasterKey directly
      const callData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      const signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify masterKey threshold is now 2
      expect(await account.masterKeyThreshold()).to.equal(2);
    });

    // CNT-380: update txKey using updated masterKey
    it("CNT-380: update txKey with new masterKey after masterKey update", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newMasterWallet, newTxWallet2 } =
        await loadFixture(deployWalletForKeyUpdate);

      // Step 1: Update masterKey (call updateMasterKey directly)
      const newMasterKey = encodeAddressKey(newMasterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedMasterKey = encodePrimitiveKeys(1, [newMasterKey]);

      let callData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);

      let userOp = await createUserOp(account, callData);
      let chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      let signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);
      await mine(1); // Pass masterKeyUpdateBlock check

      // Step 2: Update txKey using NEW masterKey (call updateTxKey directly)
      const newTxKey = encodeAddressKey(newTxWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      userOp = await createUserOp(account, callData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with NEW masterKey
      signature = await signUserOp(userOpHash, newMasterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey was updated
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-381: confirm update fails with old masterKey
    it("CNT-381: fail update with old masterKey after masterKey update", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newMasterWallet, newTxWallet } =
        await loadFixture(deployWalletForKeyUpdate);

      // Step 1: Update masterKey
      const newMasterKey = encodeAddressKey(newMasterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedMasterKey = encodePrimitiveKeys(1, [newMasterKey]);

      let callData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);

      let userOp = await createUserOp(account, callData);
      let chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      let signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);
      await mine(1);

      // Step 2: Try to update txKey with OLD masterKey (should fail)
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      userOp = await createUserOp(account, callData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with OLD masterKey
      signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });
  });

  describe("Block Wait Requirements", function () {
    // CNT-382: execution blocked in same block after txKey update
    // Note: This test verifies that execute fails in the same block after txKey update.
    // In ERC-4337, execution failures don't revert the whole handleOps - instead
    // the execution is marked as failed silently. We verify by checking the transfer didn't happen.
    it("CNT-382: fail execute in same block after txKey update", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newTxWallet, oldTxWallet } =
        await loadFixture(deployWalletForKeyUpdate);

      // Update txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      let userOp1 = await createUserOp(account, updateCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);

      let signature1 = await signUserOp(userOpHash1, masterWallet);
      userOp1.signature = encodeZkapSignature([0], [signature1]);

      // Prepare execute userOp (using OLD txKey since update hasn't happened yet)
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.5");
      const transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      // Get nonce for second userOp (it will be nonce + 1)
      const nonce = await account.getNonce();
      let userOp2 = await createUserOp(account, transferCallData);
      userOp2.nonce = nonce + 1n;
      let userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);

      // Sign with OLD txKey (this userOp will be in same block as key update)
      let signature2 = await signUserOp(userOpHash2, oldTxWallet);
      userOp2.signature = encodeZkapSignature([0], [signature2]);

      // Record recipient balance before
      const balanceBefore = await ethers.provider.getBalance(recipient);

      // Execute both UserOps in the same handleOps call (same block)
      // The second one will fail silently (TxKeyUpdateInProgress) during execution
      await entryPoint.handleOps([userOp1, userOp2], owner.address);

      // Verify the transfer did NOT happen (execution failed)
      const balanceAfter = await ethers.provider.getBalance(recipient);
      expect(balanceAfter).to.equal(balanceBefore);
    });

    // CNT-383: execution succeeds in next block after txKey update
    it("CNT-383: succeed execute in next block after txKey update", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newTxWallet } = await loadFixture(
        deployWalletForKeyUpdate
      );

      // Update txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      let userOp = await createUserOp(account, updateCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      let signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Mine a block to pass the txKeyUpdateBlock check
      await mine(1);

      // Now execute should succeed
      const recipient = ethers.Wallet.createRandom().address;
      const transferCallData = account.interface.encodeFunctionData("execute", [
        recipient,
        ethers.parseEther("0.5"),
        "0x",
      ]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      signature = await signUserOp(userOpHash, newTxWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.5"));
    });

    // CNT-384: txKey update blocked in same block after masterKey update
    // Note: This test verifies that txKey update fails in the same block after masterKey update.
    // We verify by checking the txKeyThreshold was NOT updated (execution failed).
    it("CNT-384: fail txKey update in same block after masterKey update", async function () {
      const {
        account,
        entryPoint,
        accountKeyAddressLogic,
        owner,
        masterWallet,
        newMasterWallet,
        newTxWallet,
        newTxWallet2,
      } = await loadFixture(deployWalletForKeyUpdate);

      // Prepare masterKey update UserOp
      const newMasterKey = encodeAddressKey(newMasterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedMasterKey = encodePrimitiveKeys(1, [newMasterKey]);

      let callData1 = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);

      let userOp1 = await createUserOp(account, callData1);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);

      let signature1 = await signUserOp(userOpHash1, masterWallet);
      userOp1.signature = encodeZkapSignature([0], [signature1]);

      // Prepare txKey update UserOp to 2-of-2 (with nonce + 1)
      // We'll check if threshold changed to verify if update happened
      const newTxKey1 = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxKey2 = encodeAddressKey(newTxWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(2, [newTxKey1, newTxKey2]); // threshold 2

      let callData2 = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const nonce = await account.getNonce();
      let userOp2 = await createUserOp(account, callData2);
      userOp2.nonce = nonce + 1n;
      let userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);

      // Sign with OLD masterKey (will be validated before masterKey update)
      let signature2 = await signUserOp(userOpHash2, masterWallet);
      userOp2.signature = encodeZkapSignature([0], [signature2]);

      // Record txKey threshold before (should be 1)
      const thresholdBefore = await account.txKeyThreshold();
      expect(thresholdBefore).to.equal(1);

      // Execute both UserOps in the same handleOps call (same block)
      // The second one will fail silently (MasterKeyUpdateInProgress) during execution
      await entryPoint.handleOps([userOp1, userOp2], owner.address);

      // Verify the txKey update did NOT happen (threshold still 1, not 2)
      const thresholdAfter = await account.txKeyThreshold();
      expect(thresholdAfter).to.equal(1);
    });

    // CNT-385: txKey update succeeds in next block after masterKey update
    it("CNT-385: succeed txKey update in next block after masterKey update", async function () {
      const { account, entryPoint, accountKeyAddressLogic, owner, masterWallet, newMasterWallet, newTxWallet } =
        await loadFixture(deployWalletForKeyUpdate);

      // Update masterKey
      const newMasterKey = encodeAddressKey(newMasterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedMasterKey = encodePrimitiveKeys(1, [newMasterKey]);

      let callData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      let signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Mine a block to pass the masterKeyUpdateBlock check
      await mine(1);

      // Now txKey update should succeed
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      userOp = await createUserOp(account, callData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with NEW masterKey
      signature = await signUserOp(userOpHash, newMasterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey was updated
      expect(await account.txKeyThreshold()).to.equal(1);
    });
  });

  describe("WebAuthn Key Update", function () {
    // CNT-376: change txKey to WebAuthn
    it("CNT-376: update txKey to WebAuthn key", async function () {
      const { account, entryPoint, accountKeyWebAuthnLogic, owner, masterWallet, webAuthnKeyPair } = await loadFixture(
        deployKeyUpdateWithWebAuthn
      );

      // Create new WebAuthn txKey
      const newWebAuthnTxKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const newEncodedTxKey = encodePrimitiveKeys(1, [newWebAuthnTxKey]);

      // Call updateTxKey to change from AddressKey to WebAuthn
      const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      // Sign with masterKey
      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      const signature = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey was updated (threshold should still be 1)
      expect(await account.txKeyThreshold()).to.equal(1);

      // Mine a block to pass the txKeyUpdateBlock check
      await mine(1);

      // Step 2: Execute transaction with new WebAuthn txKey
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.5");
      const transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      const userOp2 = await createUserOp(account, transferCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);

      // Sign with WebAuthn key
      const webAuthnSignature = signUserOpWebAuthn(userOpHash2, webAuthnKeyPair);
      userOp2.signature = encodeZkapSignature([0], [webAuthnSignature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      const tx2 = await entryPoint.handleOps([userOp2], owner.address);
      expect((await tx2.wait())?.status).to.equal(1);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });
  });

  // Recovery Tests
  describe("Recovery", function () {
    // CNT-542: fully replace txKey with master key (recovery) - execute succeeds with new txKey, fails with old txKey
    it("CNT-542: recover txKey using masterKey (new txKey succeeds, old txKey fails)", async function () {
      const base = await loadFixture(deployKeyUpdateTestContracts);
      const { factory, accountKeyAddressLogic, owner, entryPoint } = base;

      // Create wallets: wallet where masterKey and txKey differ
      const masterWallet = createTestWallet(500);
      const oldTxWallet = createTestWallet(600);
      const newTxWallet = createTestWallet(601);

      // Create account with different masterKey and txKey
      const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterEncodedKey = encodePrimitiveKeys(1, [masterKey]);

      const oldTxKey = encodeAddressKey(oldTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const oldTxEncodedKey = encodePrimitiveKeys(1, [oldTxKey]);

      const accountAddress = await factory.createAccount.staticCall(542, masterEncodedKey, oldTxEncodedKey);
      await factory.createAccount(542, masterEncodedKey, oldTxEncodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: Recover txKey using masterKey - call updateTxKey directly (not wrapped in execute)
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxEncodedKey = encodePrimitiveKeys(1, [newTxKey]);
      const callData1 = account.interface.encodeFunctionData("updateTxKey", [newTxEncodedKey]);

      const userOp1 = await createUserOp(account, callData1);
      const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
      const signature1 = await signUserOp(userOpHash1, masterWallet);
      userOp1.signature = encodeZkapSignature([0], [signature1]);

      await entryPoint.handleOps([userOp1], owner.address);

      // Wait for next block
      await mine(1);

      // Step 2: Verify new txKey works
      const recipient = ethers.Wallet.createRandom().address;
      const transferCallData = account.interface.encodeFunctionData("execute", [
        recipient,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp2 = await createSignedUserOp(account, entryPoint, transferCallData, newTxWallet, 0);
      await entryPoint.handleOps([userOp2], owner.address);

      expect(await ethers.provider.getBalance(recipient)).to.equal(ethers.parseEther("0.1"));

      // Step 3: Verify old txKey fails
      const recipient2 = ethers.Wallet.createRandom().address;
      const transferCallData2 = account.interface.encodeFunctionData("execute", [
        recipient2,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      let userOp3 = await createUserOp(account, transferCallData2);
      const userOpHash3 = await getUserOpHash(entryPoint, userOp3, chainId);
      const signature3 = await signUserOp(userOpHash3, oldTxWallet);
      userOp3.signature = encodeZkapSignature([0], [signature3]);

      await expect(entryPoint.handleOps([userOp3], owner.address)).to.be.revertedWithCustomError(
        entryPoint,
        "FailedOp"
      );

      // recipient2 should NOT have received funds
      expect(await ethers.provider.getBalance(recipient2)).to.equal(0n);
    });

    // CNT-543: recover another master key using 2/3 master keys
    it("CNT-543: recover masterKey using 2-of-3 multisig masterKey", async function () {
      const base = await loadFixture(deployKeyUpdateTestContracts);
      const { factory, accountKeyAddressLogic, owner, entryPoint } = base;

      // Create 3 master wallets for 2-of-3 multisig
      const masterWallet1 = createTestWallet(700);
      const masterWallet2 = createTestWallet(701);
      const masterWallet3 = createTestWallet(702);
      const txWallet = createTestWallet(800);
      const newMasterWallet = createTestWallet(750);

      // Create 2-of-3 masterKey
      const masterKey1 = encodeAddressKey(masterWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterKey2 = encodeAddressKey(masterWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterKey3 = encodeAddressKey(masterWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterEncodedKey = encodePrimitiveKeys(2, [masterKey1, masterKey2, masterKey3]); // threshold=2

      const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const txEncodedKey = encodePrimitiveKeys(1, [txKey]);

      const accountAddress = await factory.createAccount.staticCall(543, masterEncodedKey, txEncodedKey);
      await factory.createAccount(543, masterEncodedKey, txEncodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Recover masterKey using 2 of 3 keys - call updateMasterKey directly
      const newMasterKey = encodeAddressKey(newMasterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newMasterEncodedKey = encodePrimitiveKeys(1, [newMasterKey]);
      const callData = account.interface.encodeFunctionData("updateMasterKey", [newMasterEncodedKey]);

      const userOp = await createUserOp(account, callData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with 2 of 3 master keys
      const signature1 = await signUserOp(userOpHash, masterWallet1);
      const signature2 = await signUserOp(userOpHash, masterWallet2);
      userOp.signature = encodeZkapSignature([0, 1], [signature1, signature2]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Wait for next block
      await mine(1);

      // Verify new masterKey can update txKey
      const anotherTxWallet = createTestWallet(801);
      const anotherTxKey = encodeAddressKey(anotherTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const anotherTxEncodedKey = encodePrimitiveKeys(1, [anotherTxKey]);
      const updateTxKeyCallData = account.interface.encodeFunctionData("updateTxKey", [anotherTxEncodedKey]);

      const userOp2 = await createUserOp(account, updateTxKeyCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const sig2 = await signUserOp(userOpHash2, newMasterWallet);
      userOp2.signature = encodeZkapSignature([0], [sig2]);

      const tx2 = await entryPoint.handleOps([userOp2], owner.address);
      expect((await tx2.wait())?.status).to.equal(1);

      // Wait for next block
      await mine(1);

      // Verify old masterKeys no longer work for updateMasterKey
      const yetAnotherMasterWallet = createTestWallet(760);
      const yetAnotherMasterKey = encodeAddressKey(
        yetAnotherMasterWallet.address,
        await accountKeyAddressLogic.getAddress(),
        1
      );
      const yetAnotherMasterEncodedKey = encodePrimitiveKeys(1, [yetAnotherMasterKey]);
      const updateMasterKeyCallData2 = account.interface.encodeFunctionData("updateMasterKey", [
        yetAnotherMasterEncodedKey,
      ]);

      let userOp3 = await createUserOp(account, updateMasterKeyCallData2);
      const userOpHash3 = await getUserOpHash(entryPoint, userOp3, chainId);
      const oldSig1 = await signUserOp(userOpHash3, masterWallet1);
      const oldSig2 = await signUserOp(userOpHash3, masterWallet2);
      userOp3.signature = encodeZkapSignature([0, 1], [oldSig1, oldSig2]);

      // Old masterKeys should fail (signature validation fails, so FailedOpWithRevert)
      await expect(entryPoint.handleOps([userOp3], owner.address)).to.be.revertedWithCustomError(
        entryPoint,
        "FailedOpWithRevert"
      );
    });
  });

  // ===========================================
  // UpdateMasterKey Advanced Tests (CNT-563~567)
  // ===========================================
  describe("UpdateMasterKey Advanced", function () {
    // CNT-563: txKey update possible with new key after masterKey update
    it("CNT-563: new masterKey can update txKey after masterKey update", async function () {
      const { factory, accountKeyAddressLogic, entryPoint, owner } = await loadFixture(deployKeyUpdateTestContracts);

      // Create wallets
      const txWallet = createTestWallet(600);
      const masterWallet1 = createTestWallet(601);
      const masterWallet2 = createTestWallet(602);
      const newTxWallet = createTestWallet(603);

      // Create keys - separate master and tx keys
      const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterKey1 = encodeAddressKey(masterWallet1.address, await accountKeyAddressLogic.getAddress(), 1);

      const txEncodedKey = encodePrimitiveKeys(1, [txKey]);
      const masterEncodedKey = encodePrimitiveKeys(1, [masterKey1]);

      // Create account with different master and tx keys
      const accountAddress = await factory.createAccount.staticCall(1, masterEncodedKey, txEncodedKey);
      await factory.createAccount(1, masterEncodedKey, txEncodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: Update masterKey to masterWallet2
      const newMasterKey = encodeAddressKey(masterWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const newMasterEncodedKey = encodePrimitiveKeys(1, [newMasterKey]);
      const updateMasterCallData = account.interface.encodeFunctionData("updateMasterKey", [newMasterEncodedKey]);

      let userOp1 = await createUserOp(account, updateMasterCallData);
      const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
      const sig1 = await signUserOp(userOpHash1, masterWallet1);
      userOp1.signature = encodeZkapSignature([0], [sig1]);

      await entryPoint.handleOps([userOp1], owner.address);
      await mine(1);

      // Step 2: Use new masterKey to update txKey
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxEncodedKey = encodePrimitiveKeys(1, [newTxKey]);
      const updateTxCallData = account.interface.encodeFunctionData("updateTxKey", [newTxEncodedKey]);

      let userOp2 = await createUserOp(account, updateTxCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const sig2 = await signUserOp(userOpHash2, masterWallet2); // New masterKey
      userOp2.signature = encodeZkapSignature([0], [sig2]);

      const tx = await entryPoint.handleOps([userOp2], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-564: fails with old key after masterKey update
    it("CNT-564: old masterKey fails after masterKey update", async function () {
      const { factory, accountKeyAddressLogic, entryPoint, owner } = await loadFixture(deployKeyUpdateTestContracts);

      const txWallet = createTestWallet(610);
      const masterWallet1 = createTestWallet(611);
      const masterWallet2 = createTestWallet(612);

      const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterKey1 = encodeAddressKey(masterWallet1.address, await accountKeyAddressLogic.getAddress(), 1);

      const txEncodedKey = encodePrimitiveKeys(1, [txKey]);
      const masterEncodedKey = encodePrimitiveKeys(1, [masterKey1]);

      const accountAddress = await factory.createAccount.staticCall(1, masterEncodedKey, txEncodedKey);
      await factory.createAccount(1, masterEncodedKey, txEncodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Update masterKey
      const newMasterKey = encodeAddressKey(masterWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const newMasterEncodedKey = encodePrimitiveKeys(1, [newMasterKey]);
      const updateMasterCallData = account.interface.encodeFunctionData("updateMasterKey", [newMasterEncodedKey]);

      let userOp1 = await createUserOp(account, updateMasterCallData);
      const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
      const sig1 = await signUserOp(userOpHash1, masterWallet1);
      userOp1.signature = encodeZkapSignature([0], [sig1]);

      await entryPoint.handleOps([userOp1], owner.address);
      await mine(1);

      // Try to use old masterKey to update txKey - should fail
      const newTxWallet = createTestWallet(613);
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxEncodedKey = encodePrimitiveKeys(1, [newTxKey]);
      const updateTxCallData = account.interface.encodeFunctionData("updateTxKey", [newTxEncodedKey]);

      let userOp2 = await createUserOp(account, updateTxCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const sig2 = await signUserOp(userOpHash2, masterWallet1); // Old masterKey
      userOp2.signature = encodeZkapSignature([0], [sig2]);

      await expect(entryPoint.handleOps([userOp2], owner.address)).to.be.revertedWithCustomError(
        entryPoint,
        "FailedOp"
      );
    });

    // CNT-565: masterKey upgrade from 1-of-1 to 2-of-3
    it("CNT-565: upgrade masterKey from 1-of-1 to 2-of-3", async function () {
      const { factory, accountKeyAddressLogic, entryPoint, owner } = await loadFixture(deployKeyUpdateTestContracts);

      const txWallet = createTestWallet(620);
      const masterWallet1 = createTestWallet(621);
      const newMaster1 = createTestWallet(622);
      const newMaster2 = createTestWallet(623);
      const newMaster3 = createTestWallet(624);

      const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterKey1 = encodeAddressKey(masterWallet1.address, await accountKeyAddressLogic.getAddress(), 1);

      const txEncodedKey = encodePrimitiveKeys(1, [txKey]);
      const masterEncodedKey = encodePrimitiveKeys(1, [masterKey1]);

      const accountAddress = await factory.createAccount.staticCall(1, masterEncodedKey, txEncodedKey);
      await factory.createAccount(1, masterEncodedKey, txEncodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Upgrade to 2-of-3 masterKey
      const newKey1 = encodeAddressKey(newMaster1.address, await accountKeyAddressLogic.getAddress(), 1);
      const newKey2 = encodeAddressKey(newMaster2.address, await accountKeyAddressLogic.getAddress(), 1);
      const newKey3 = encodeAddressKey(newMaster3.address, await accountKeyAddressLogic.getAddress(), 1);
      const newMasterEncodedKey = encodePrimitiveKeys(2, [newKey1, newKey2, newKey3]); // threshold=2

      const updateMasterCallData = account.interface.encodeFunctionData("updateMasterKey", [newMasterEncodedKey]);

      let userOp = await createUserOp(account, updateMasterCallData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const sig = await signUserOp(userOpHash, masterWallet1);
      userOp.signature = encodeZkapSignature([0], [sig]);

      await entryPoint.handleOps([userOp], owner.address);
      await mine(1);

      // Verify 2-of-3 works: use 2 keys to update txKey
      const newTxWallet = createTestWallet(625);
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxEncodedKey = encodePrimitiveKeys(1, [newTxKey]);
      const updateTxCallData = account.interface.encodeFunctionData("updateTxKey", [newTxEncodedKey]);

      let userOp2 = await createUserOp(account, updateTxCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const sig1 = await signUserOp(userOpHash2, newMaster1);
      const sig2 = await signUserOp(userOpHash2, newMaster2);
      userOp2.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const tx = await entryPoint.handleOps([userOp2], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-566: masterKey downgrade from 2-of-3 to 1-of-1
    it("CNT-566: downgrade masterKey from 2-of-3 to 1-of-1", async function () {
      const { factory, accountKeyAddressLogic, entryPoint, owner } = await loadFixture(deployKeyUpdateTestContracts);

      const txWallet = createTestWallet(630);
      const master1 = createTestWallet(631);
      const master2 = createTestWallet(632);
      const master3 = createTestWallet(633);
      const newSingleMaster = createTestWallet(634);

      const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const mKey1 = encodeAddressKey(master1.address, await accountKeyAddressLogic.getAddress(), 1);
      const mKey2 = encodeAddressKey(master2.address, await accountKeyAddressLogic.getAddress(), 1);
      const mKey3 = encodeAddressKey(master3.address, await accountKeyAddressLogic.getAddress(), 1);

      const txEncodedKey = encodePrimitiveKeys(1, [txKey]);
      const masterEncodedKey = encodePrimitiveKeys(2, [mKey1, mKey2, mKey3]); // 2-of-3

      const accountAddress = await factory.createAccount.staticCall(1, masterEncodedKey, txEncodedKey);
      await factory.createAccount(1, masterEncodedKey, txEncodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Downgrade to 1-of-1
      const newMasterKey = encodeAddressKey(newSingleMaster.address, await accountKeyAddressLogic.getAddress(), 1);
      const newMasterEncodedKey = encodePrimitiveKeys(1, [newMasterKey]);
      const updateMasterCallData = account.interface.encodeFunctionData("updateMasterKey", [newMasterEncodedKey]);

      let userOp = await createUserOp(account, updateMasterCallData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const sig1 = await signUserOp(userOpHash, master1);
      const sig2 = await signUserOp(userOpHash, master2);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      await entryPoint.handleOps([userOp], owner.address);
      await mine(1);

      // Verify 1-of-1 works: use single key to update txKey
      const newTxWallet = createTestWallet(635);
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxEncodedKey = encodePrimitiveKeys(1, [newTxKey]);
      const updateTxCallData = account.interface.encodeFunctionData("updateTxKey", [newTxEncodedKey]);

      let userOp2 = await createUserOp(account, updateTxCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const sig = await signUserOp(userOpHash2, newSingleMaster);
      userOp2.signature = encodeZkapSignature([0], [sig]);

      const tx = await entryPoint.handleOps([userOp2], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-567: masterKey type change (Address to WebAuthn)
    it("CNT-567: change masterKey type from Address to WebAuthn", async function () {
      const { factory, accountKeyAddressLogic, accountKeyWebAuthnLogic, entryPoint, owner } = await loadFixture(
        deployKeyUpdateWithWebAuthn
      );

      const txWallet = createTestWallet(640);
      const masterWallet = createTestWallet(641);

      const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);

      const txEncodedKey = encodePrimitiveKeys(1, [txKey]);
      const masterEncodedKey = encodePrimitiveKeys(1, [masterKey]);

      const accountAddress = await factory.createAccount.staticCall(1, masterEncodedKey, txEncodedKey);
      await factory.createAccount(1, masterEncodedKey, txEncodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Change to WebAuthn masterKey
      const webAuthnKeyPair = generateWebAuthnKeyPair();
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const newMasterEncodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      const updateMasterCallData = account.interface.encodeFunctionData("updateMasterKey", [newMasterEncodedKey]);

      let userOp = await createUserOp(account, updateMasterCallData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const sig = await signUserOp(userOpHash, masterWallet);
      userOp.signature = encodeZkapSignature([0], [sig]);

      await entryPoint.handleOps([userOp], owner.address);
      await mine(1);

      // Verify WebAuthn masterKey works: use it to update txKey
      const newTxWallet = createTestWallet(642);
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxEncodedKey = encodePrimitiveKeys(1, [newTxKey]);
      const updateTxCallData = account.interface.encodeFunctionData("updateTxKey", [newTxEncodedKey]);

      let userOp2 = await createUserOp(account, updateTxCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const webAuthnSig = signUserOpWebAuthn(userOpHash2, webAuthnKeyPair);
      userOp2.signature = encodeZkapSignature([0], [webAuthnSig]);

      const tx = await entryPoint.handleOps([userOp2], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });
  });
});
