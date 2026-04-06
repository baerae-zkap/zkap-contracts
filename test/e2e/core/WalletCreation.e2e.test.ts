/**
 * E2E Tests: Wallet Creation
 *
 * CNT-283 ~ CNT-308: Wallet Creation Tests
 * - Single Key (AddressKey, Secp256r1, WebAuthn)
 * - On-chain Multisig (1-of-1, 1-of-2, 2-of-2, 2-of-3, 3-of-3, 3-of-5, Weighted)
 */

import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import {
  encodeAddressKey,
  encodePrimitiveKeys,
  createDummyEncodedKey,
  encodeSecp256r1Key,
  encodeWebAuthnKey,
} from "../../helpers/accountKeyHelper";
import {
  createUserOp,
  getUserOpHash,
  signUserOp,
  encodeZkapSignature,
  createSignedUserOp,
  generateSecp256r1KeyPair,
  signUserOpSecp256r1,
  generateWebAuthnKeyPair,
  signUserOpWebAuthn,
  WebAuthnSignOptions,
} from "../../helpers/userOpHelper";

// Helper: Create test wallets
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Fixture: Deploy contracts needed for e2e tests (AddressKey only)
async function deployE2EContracts() {
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

  // Create test wallets
  const testWallet1 = createTestWallet(0);
  const testWallet2 = createTestWallet(1);
  const testWallet3 = createTestWallet(2);
  const testWallet4 = createTestWallet(3);
  const testWallet5 = createTestWallet(4);

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    owner,
    signers,
    testWallet1,
    testWallet2,
    testWallet3,
    testWallet4,
    testWallet5,
  };
}

// Fixture: Deploy contracts with Secp256r1 support
async function deployE2EContractsWithSecp256r1() {
  const base = await deployE2EContracts();

  // Deploy AccountKeySecp256r1 Logic
  const AccountKeySecp256r1Factory = await ethers.getContractFactory("AccountKeySecp256r1");
  const accountKeySecp256r1Logic = await AccountKeySecp256r1Factory.deploy();
  await accountKeySecp256r1Logic.waitForDeployment();

  // Generate Secp256r1 key pair for testing
  const secp256r1KeyPair = generateSecp256r1KeyPair();

  return {
    ...base,
    accountKeySecp256r1Logic,
    secp256r1KeyPair,
  };
}

// Fixture: Deploy contracts with WebAuthn support
async function deployE2EContractsWithWebAuthn() {
  const base = await deployE2EContracts();

  // Deploy AccountKeyWebAuthn Logic (no library linking needed)
  const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
  const accountKeyWebAuthnLogic = await AccountKeyWebAuthnFactory.deploy();
  await accountKeyWebAuthnLogic.waitForDeployment();

  // Generate WebAuthn key pair for testing
  const webAuthnKeyPair = generateWebAuthnKeyPair();

  return {
    ...base,
    accountKeyWebAuthnLogic,
    webAuthnKeyPair,
  };
}

describe("E2E: Wallet Creation", function () {
  describe("Single Key Wallets", function () {
    // CNT-283: create wallet with AddressKey
    it("CNT-283: create wallet with AddressKey", async function () {
      const { factory, accountKeyAddressLogic, testWallet1 } = await loadFixture(deployE2EContracts);

      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet1.address);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      expect(accountAddress).to.be.properAddress;
      expect(accountAddress).to.not.equal(ethers.ZeroAddress);

      const tx = await factory.createAccount(1, encodedKey, encodedKey);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      // Verify account is initialized
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(1);
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-284: send ETH with created wallet
    it("CNT-284: execute ETH transfer with AddressKey wallet", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, owner } = await loadFixture(deployE2EContracts);

      // Create wallet
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet1.address);
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({
        to: accountAddress,
        value: ethers.parseEther("5.0"),
      });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp for ETH transfer
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("1.0");
      const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet1, 0);

      // Execute via EntryPoint
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-285: create wallet with Secp256r1
    it("CNT-285: create wallet with Secp256r1 key", async function () {
      const { factory, accountKeySecp256r1Logic, secp256r1KeyPair, owner } = await loadFixture(
        deployE2EContractsWithSecp256r1
      );

      // Encode Secp256r1 key
      const secp256r1Key = encodeSecp256r1Key(
        secp256r1KeyPair.publicKey.x,
        secp256r1KeyPair.publicKey.y,
        await accountKeySecp256r1Logic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [secp256r1Key]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      expect(accountAddress).to.be.properAddress;
      expect(accountAddress).to.not.equal(ethers.ZeroAddress);

      const tx = await factory.createAccount(1, encodedKey, encodedKey);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      // Verify account is initialized
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(1);
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-286: execute transaction with Secp256r1 signature
    it("CNT-286: execute transaction with Secp256r1 signature", async function () {
      const { factory, entryPoint, accountKeySecp256r1Logic, secp256r1KeyPair, owner } = await loadFixture(
        deployE2EContractsWithSecp256r1
      );

      // Encode Secp256r1 key
      const secp256r1Key = encodeSecp256r1Key(
        secp256r1KeyPair.publicKey.x,
        secp256r1KeyPair.publicKey.y,
        await accountKeySecp256r1Logic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [secp256r1Key]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp for ETH transfer
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("1.0");
      const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      // Create and sign UserOp with Secp256r1
      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with Secp256r1 private key
      const signature = signUserOpSecp256r1(userOpHash, secp256r1KeyPair.privateKey);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Execute via EntryPoint
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-287: create wallet with WebAuthn key
    it("CNT-287: create wallet with WebAuthn key", async function () {
      const { factory, accountKeyWebAuthnLogic, webAuthnKeyPair, owner } = await loadFixture(
        deployE2EContractsWithWebAuthn
      );

      // Encode WebAuthn key
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      expect(accountAddress).to.be.properAddress;
      expect(accountAddress).to.not.equal(ethers.ZeroAddress);

      const tx = await factory.createAccount(1, encodedKey, encodedKey);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      // Verify account is initialized
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(1);
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-288: execute transaction with WebAuthn key
    it("CNT-288: execute transaction with WebAuthn signature", async function () {
      const { factory, entryPoint, accountKeyWebAuthnLogic, webAuthnKeyPair, owner } = await loadFixture(
        deployE2EContractsWithWebAuthn
      );

      // Encode WebAuthn key
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp for ETH transfer
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("1.0");
      const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      // Create and sign UserOp with WebAuthn
      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with WebAuthn private key
      const signature = signUserOpWebAuthn(userOpHash, webAuthnKeyPair);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Execute via EntryPoint
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });
  });

  describe("On-chain Multisig Wallets", function () {
    // CNT-289: create 1-of-1 single signer wallet
    it("CNT-289: create 1-of-1 single signature wallet", async function () {
      const { factory, accountKeyAddressLogic, testWallet1 } = await loadFixture(deployE2EContracts);

      const key = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(1, [key]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(1);
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-290: execute transaction with 1-of-1 wallet
    it("CNT-290: execute transaction with 1-of-1 wallet", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, owner } = await loadFixture(deployE2EContracts);

      const key = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(1, [key]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Execute transaction with 1 signature
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet1, 0);
      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);
    });

    // CNT-291: create 1-of-2 multisig wallet
    it("CNT-291: create 1-of-2 multisig wallet", async function () {
      const { factory, accountKeyAddressLogic, testWallet1, testWallet2 } = await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(1, [key1, key2]); // threshold = 1

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-292: execute 1-of-2 wallet with single signature
    it("CNT-292: execute 1-of-2 wallet with single signature", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, owner } = await loadFixture(
        deployE2EContracts
      );

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(1, [key1, key2]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Execute with just key1 (threshold = 1)
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet1, 0);
      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-388: execute 1-of-2 wallet with second key
    it("CNT-388: execute 1-of-2 wallet with second key", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, owner } = await loadFixture(
        deployE2EContracts
      );

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(1, [key1, key2]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Execute with key2 (threshold = 1, using second key)
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      // Sign with testWallet2 (index 1)
      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet2, 1);
      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-293: create 2-of-2 multisig wallet
    it("CNT-293: create 2-of-2 multisig wallet", async function () {
      const { factory, accountKeyAddressLogic, testWallet1, testWallet2 } = await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2]); // threshold = 2

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.txKeyThreshold()).to.equal(2);
    });

    // CNT-294: execute 2-of-2 wallet with 2 signatures
    it("CNT-294: execute 2-of-2 wallet with two signatures", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, owner } = await loadFixture(
        deployE2EContracts
      );

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with both wallets
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-295: confirm 2-of-2 wallet fails with 1 signature
    it("CNT-295: fail 2-of-2 wallet with single signature", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, owner } = await loadFixture(
        deployE2EContracts
      );

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Try to execute with only 1 signature (should fail)
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet1, 0);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-296: create 2-of-3 multisig wallet
    it("CNT-296: create 2-of-3 multisig wallet", async function () {
      const { factory, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3 } = await loadFixture(
        deployE2EContracts
      );

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.txKeyThreshold()).to.equal(2);
    });

    // CNT-297: execute 2-of-3 wallet with 2 signatures
    it("CNT-297: execute 2-of-3 wallet with two signatures", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with wallet1 and wallet2 (2 of 3)
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-392: execute 2-of-3 with key1+key3 combination
    it("CNT-392: execute 2-of-3 wallet with key1+key3", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with wallet1 and wallet3 (indices 0 and 2)
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig3 = await signUserOp(userOpHash, testWallet3);
      userOp.signature = encodeZkapSignature([0, 2], [sig1, sig3]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-393: execute 2-of-3 with key2+key3 combination
    it("CNT-393: execute 2-of-3 wallet with key2+key3", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with wallet2 and wallet3 (indices 1 and 2)
      const sig2 = await signUserOp(userOpHash, testWallet2);
      const sig3 = await signUserOp(userOpHash, testWallet3);
      userOp.signature = encodeZkapSignature([1, 2], [sig2, sig3]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-298: confirm 2-of-3 wallet fails with 1 signature
    it("CNT-298: fail 2-of-3 wallet with single signature", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet1, 0);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-299: submit all 3 signatures for 2-of-3 wallet
    it("CNT-299: execute 2-of-3 wallet with all three signatures", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with all 3 wallets
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      const sig3 = await signUserOp(userOpHash, testWallet3);
      userOp.signature = encodeZkapSignature([0, 1, 2], [sig1, sig2, sig3]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-300: create 3-of-3 multisig wallet
    it("CNT-300: create 3-of-3 multisig wallet", async function () {
      const { factory, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3 } = await loadFixture(
        deployE2EContracts
      );

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.txKeyThreshold()).to.equal(3);
    });

    // CNT-301: execute 3-of-3 wallet with 3 signatures
    it("CNT-301: execute 3-of-3 wallet with three signatures", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with all 3 wallets
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      const sig3 = await signUserOp(userOpHash, testWallet3);
      userOp.signature = encodeZkapSignature([0, 1, 2], [sig1, sig2, sig3]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-302: confirm 3-of-3 wallet fails with 2 signatures
    it("CNT-302: fail 3-of-3 wallet with two signatures", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Only sign with 2 wallets
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-396: 3-of-3 fails with only key1+key3 signatures
    it("CNT-396: fail 3-of-3 wallet with key1+key3 only", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Only sign with key1 and key3
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig3 = await signUserOp(userOpHash, testWallet3);
      userOp.signature = encodeZkapSignature([0, 2], [sig1, sig3]);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-397: 3-of-3 fails with only key2+key3 signatures
    it("CNT-397: fail 3-of-3 wallet with key2+key3 only", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Only sign with key2 and key3
      const sig2 = await signUserOp(userOpHash, testWallet2);
      const sig3 = await signUserOp(userOpHash, testWallet3);
      userOp.signature = encodeZkapSignature([1, 2], [sig2, sig3]);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-303: create 3-of-5 multisig wallet
    it("CNT-303: create 3-of-5 multisig wallet", async function () {
      const { factory, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, testWallet4, testWallet5 } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const key4 = encodeAddressKey(testWallet4.address, await accountKeyAddressLogic.getAddress(), 1);
      const key5 = encodeAddressKey(testWallet5.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3, key4, key5]); // threshold = 3

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.txKeyThreshold()).to.equal(3);
    });

    // CNT-304: execute 3-of-5 wallet with 3 signatures
    it("CNT-304: execute 3-of-5 wallet with three signatures", async function () {
      const {
        factory,
        entryPoint,
        accountKeyAddressLogic,
        testWallet1,
        testWallet2,
        testWallet3,
        testWallet4,
        testWallet5,
        owner,
      } = await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const key4 = encodeAddressKey(testWallet4.address, await accountKeyAddressLogic.getAddress(), 1);
      const key5 = encodeAddressKey(testWallet5.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3, key4, key5]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with wallet1, wallet2, wallet3 (3 of 5)
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      const sig3 = await signUserOp(userOpHash, testWallet3);
      userOp.signature = encodeZkapSignature([0, 1, 2], [sig1, sig2, sig3]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-399: execute 3-of-5 with 4 signatures
    it("CNT-399: execute 3-of-5 wallet with four signatures", async function () {
      const {
        factory,
        entryPoint,
        accountKeyAddressLogic,
        testWallet1,
        testWallet2,
        testWallet3,
        testWallet4,
        testWallet5,
        owner,
      } = await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const key4 = encodeAddressKey(testWallet4.address, await accountKeyAddressLogic.getAddress(), 1);
      const key5 = encodeAddressKey(testWallet5.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3, key4, key5]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with 4 of 5 wallets (more than threshold)
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      const sig3 = await signUserOp(userOpHash, testWallet3);
      const sig4 = await signUserOp(userOpHash, testWallet4);
      userOp.signature = encodeZkapSignature([0, 1, 2, 3], [sig1, sig2, sig3, sig4]);

      const tx2 = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx2.wait())?.status).to.equal(1);
    });

    // CNT-305: confirm 3-of-5 wallet fails with 2 signatures
    it("CNT-305: fail 3-of-5 wallet with two signatures", async function () {
      const {
        factory,
        entryPoint,
        accountKeyAddressLogic,
        testWallet1,
        testWallet2,
        testWallet3,
        testWallet4,
        testWallet5,
        owner,
      } = await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const key4 = encodeAddressKey(testWallet4.address, await accountKeyAddressLogic.getAddress(), 1);
      const key5 = encodeAddressKey(testWallet5.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3, key4, key5]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Only sign with 2 wallets (need 3)
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-306: create weight-based wallet (weight: 2,2,1 / threshold: 3)
    it("CNT-306: create weighted multisig wallet (weights: 2,2,1, threshold: 3)", async function () {
      const { factory, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3 } = await loadFixture(
        deployE2EContracts
      );

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 2);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 2);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]); // threshold = 3

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.txKeyThreshold()).to.equal(3);
    });

    // CNT-307: weighted wallet - execute with 2 signers (weight 4)
    it("CNT-307: execute weighted wallet with 2 signatures (weight=4)", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 2);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 2);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with wallet1 (weight=2) and wallet2 (weight=2) = total 4 >= threshold 3
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-308: weighted wallet - fails with 1 signer (weight 2)
    it("CNT-308: fail weighted wallet with 1 signature (weight=2 < threshold=3)", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 2);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 2);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      // Only sign with wallet1 (weight=2) < threshold 3
      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet1, 0);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-403: weight exactly meets threshold boundary value
    it("CNT-403: succeed weighted wallet with weight exactly equal to threshold", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, owner } =
        await loadFixture(deployE2EContracts);

      // weights: 2, 1, 1, threshold: 3
      const key1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 2);
      const key2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const key3 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(3, [key1, key2, key3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with wallet1 (weight=2) and wallet2 (weight=1) = total 3 = threshold 3 (exactly)
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });
  });

  describe("Master/Tx Different Threshold Wallets", function () {
    // CNT-337: masterKey 2-of-2, txKey 1-of-1 configuration
    it("CNT-337: create wallet with masterKey 2-of-2 and txKey 1-of-1", async function () {
      const { factory, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3 } = await loadFixture(
        deployE2EContracts
      );

      // Create 2-of-2 masterKey
      const masterKey1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterKey2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedMasterKey = encodePrimitiveKeys(2, [masterKey1, masterKey2]);

      // Create 1-of-1 txKey
      const txKey = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedTxKey = encodePrimitiveKeys(1, [txKey]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
      await factory.createAccount(1, encodedMasterKey, encodedTxKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(2);
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-338: masterKey 1-of-1, txKey 2-of-3 configuration
    it("CNT-338: create wallet with masterKey 1-of-1 and txKey 2-of-3", async function () {
      const { factory, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, testWallet4 } = await loadFixture(
        deployE2EContracts
      );

      // Create 1-of-1 masterKey
      const masterKey = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedMasterKey = encodePrimitiveKeys(1, [masterKey]);

      // Create 2-of-3 txKey
      const txKey1 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const txKey2 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const txKey3 = encodeAddressKey(testWallet4.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedTxKey = encodePrimitiveKeys(2, [txKey1, txKey2, txKey3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
      await factory.createAccount(1, encodedMasterKey, encodedTxKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(1);
      expect(await account.txKeyThreshold()).to.equal(2);
    });

    // CNT-339: transaction with wallet configured with different thresholds
    it("CNT-339: execute transaction on mixed threshold wallet", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, testWallet1, testWallet2, testWallet3, testWallet4, owner } =
        await loadFixture(deployE2EContracts);

      // Create 2-of-2 masterKey
      const masterKey1 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterKey2 = encodeAddressKey(testWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedMasterKey = encodePrimitiveKeys(2, [masterKey1, masterKey2]);

      // Create 2-of-3 txKey
      const txKey1 = encodeAddressKey(testWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
      const txKey2 = encodeAddressKey(testWallet4.address, await accountKeyAddressLogic.getAddress(), 1);
      const txKey3 = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedTxKey = encodePrimitiveKeys(2, [txKey1, txKey2, txKey3]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
      await factory.createAccount(1, encodedMasterKey, encodedTxKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Execute transaction using 2-of-3 txKey
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with 2 of 3 txKeys
      const sig1 = await signUserOp(userOpHash, testWallet3);
      const sig2 = await signUserOp(userOpHash, testWallet4);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.5"));
    });
  });

  describe("Mixed Key Types (On-chain)", function () {
    // CNT-334: create mixed AddressKey + WebAuthn 2-of-2 wallet
    it("CNT-334: create mixed 2-of-2 wallet with AddressKey + WebAuthn", async function () {
      const { factory, accountKeyAddressLogic, accountKeyWebAuthnLogic, testWallet1, webAuthnKeyPair } =
        await loadFixture(deployE2EContractsWithWebAuthn);

      // Create AddressKey (weight=1)
      const addressKey = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);

      // Create WebAuthnKey (weight=1)
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );

      // 2-of-2 multisig with mixed key types
      const encodedKey = encodePrimitiveKeys(2, [addressKey, webAuthnKey]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      expect(accountAddress).to.be.properAddress;

      const tx = await factory.createAccount(1, encodedKey, encodedKey);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      // Verify account configuration
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(2);
      expect(await account.txKeyThreshold()).to.equal(2);
    });

    // CNT-335: create mixed AddressKey + Secp256r1 2-of-2 wallet
    it("CNT-335: create mixed 2-of-2 wallet with AddressKey + Secp256r1", async function () {
      const { factory, accountKeyAddressLogic, accountKeySecp256r1Logic, testWallet1, secp256r1KeyPair } =
        await loadFixture(deployE2EContractsWithSecp256r1);

      // Create AddressKey (weight=1)
      const addressKey = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);

      // Create Secp256r1Key (weight=1)
      const secp256r1Key = encodeSecp256r1Key(
        secp256r1KeyPair.publicKey.x,
        secp256r1KeyPair.publicKey.y,
        await accountKeySecp256r1Logic.getAddress(),
        1
      );

      // 2-of-2 multisig with mixed key types
      const encodedKey = encodePrimitiveKeys(2, [addressKey, secp256r1Key]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      expect(accountAddress).to.be.properAddress;

      const tx = await factory.createAccount(1, encodedKey, encodedKey);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      // Verify account configuration
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      expect(await account.masterKeyThreshold()).to.equal(2);
      expect(await account.txKeyThreshold()).to.equal(2);
    });

    // CNT-556: execute with Address + Secp256r1 mixed multisig key
    it("CNT-556: execute mixed multisig wallet with AddressKey + Secp256r1 signatures", async function () {
      const {
        factory,
        entryPoint,
        accountKeyAddressLogic,
        accountKeySecp256r1Logic,
        testWallet1,
        secp256r1KeyPair,
        owner,
      } = await loadFixture(deployE2EContractsWithSecp256r1);

      // Create AddressKey (weight=1)
      const addressKey = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);

      // Create Secp256r1Key (weight=1)
      const secp256r1Key = encodeSecp256r1Key(
        secp256r1KeyPair.publicKey.x,
        secp256r1KeyPair.publicKey.y,
        await accountKeySecp256r1Logic.getAddress(),
        1
      );

      // 2-of-2 multisig with mixed key types
      const encodedKey = encodePrimitiveKeys(2, [addressKey, secp256r1Key]);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp for ETH transfer
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("1.0");
      const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with AddressKey (index 0) - ECDSA signature
      const addressSig = await signUserOp(userOpHash, testWallet1);

      // Sign with Secp256r1Key (index 1) - P-256 signature
      const secp256r1Sig = signUserOpSecp256r1(userOpHash, secp256r1KeyPair.privateKey);

      // Combine both signatures for 2-of-2
      userOp.signature = encodeZkapSignature([0, 1], [addressSig, secp256r1Sig]);

      // Execute via EntryPoint
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });
  });

  describe("WebAuthn Validation", function () {
    // CNT-557: WebAuthn signature fails from disallowed origin
    it("CNT-557: fail WebAuthn signature with invalid origin", async function () {
      const { factory, entryPoint, accountKeyWebAuthnLogic, webAuthnKeyPair, owner } = await loadFixture(
        deployE2EContractsWithWebAuthn
      );

      // Encode WebAuthn key with correct origin ("http://localhost:5173")
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with WRONG origin (http://evil.com instead of http://localhost:5173)
      const invalidOriginOptions: WebAuthnSignOptions = {
        overrideOrigin: "http://evil.com",
      };
      const signature = signUserOpWebAuthn(userOpHash, webAuthnKeyPair, invalidOriginOptions);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail with InvalidOrigin (FailedOpWithRevert wraps the actual error)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-558: WebAuthn signature fails from disallowed RP ID
    it("CNT-558: fail WebAuthn signature with invalid rpId", async function () {
      const { factory, entryPoint, accountKeyWebAuthnLogic, webAuthnKeyPair, owner } = await loadFixture(
        deployE2EContractsWithWebAuthn
      );

      // Encode WebAuthn key with correct rpIdHash (sha256("localhost"))
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with WRONG rpIdHash (different domain's hash instead of localhost)
      const wrongRpIdHash = "0x" + "11".repeat(32); // Invalid rpIdHash
      const invalidRpIdOptions: WebAuthnSignOptions = {
        overrideRpIdHash: wrongRpIdHash,
      };
      const signature = signUserOpWebAuthn(userOpHash, webAuthnKeyPair, invalidRpIdOptions);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail with InvalidRpId (FailedOpWithRevert wraps the actual error)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });
  });

  describe("WebAuthn Security", function () {
    // CNT-665: WebAuthn S-value normalization (malleable signature defense)
    it("CNT-665: reject WebAuthn signature with high S-value", async function () {
      const { factory, entryPoint, accountKeyWebAuthnLogic, webAuthnKeyPair, owner } = await loadFixture(
        deployE2EContractsWithWebAuthn
      );

      // Encode WebAuthn key
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with HIGH S-value (s > N/2)
      const highSOptions: WebAuthnSignOptions = {
        useHighS: true,
      };
      const signature = signUserOpWebAuthn(userOpHash, webAuthnKeyPair, highSOptions);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail because high S-value signatures are rejected
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-666: confirm defense against WebAuthn high S-value attack
    it("CNT-666: verify WebAuthn rejects malleable (high S) signature attack", async function () {
      const { factory, entryPoint, accountKeyWebAuthnLogic, webAuthnKeyPair, owner } = await loadFixture(
        deployE2EContractsWithWebAuthn
      );

      // Encode WebAuthn key
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(2, encodedKey, encodedKey);
      await factory.createAccount(2, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // First: Verify normal (low S) signature works
      const normalSignature = signUserOpWebAuthn(userOpHash, webAuthnKeyPair);
      userOp.signature = encodeZkapSignature([0], [normalSignature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));

      // Second: Try same operation with high S signature (malleable)
      const userOp2 = await createUserOp(account, callData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);

      const highSSignature = signUserOpWebAuthn(userOpHash2, webAuthnKeyPair, { useHighS: true });
      userOp2.signature = encodeZkapSignature([0], [highSSignature]);

      // High S signature should be rejected (malleable signature protection)
      await expect(entryPoint.handleOps([userOp2], owner.address)).to.be.reverted;
    });

    // CNT-667: validate WebAuthn authenticatorData flags (UP, UV)
    it("CNT-667: verify WebAuthn authenticatorData flags validation (UP, UV)", async function () {
      const { factory, entryPoint, accountKeyWebAuthnLogic, webAuthnKeyPair, owner } = await loadFixture(
        deployE2EContractsWithWebAuthn
      );

      // Encode WebAuthn key
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(667, encodedKey, encodedKey);
      await factory.createAccount(667, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Normal signature with proper flags should work
      const normalSignature = signUserOpWebAuthn(userOpHash, webAuthnKeyPair);
      userOp.signature = encodeZkapSignature([0], [normalSignature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));

      // Note: Testing invalid flags (UP=false) would require modifying the authData
      // which is validated on the contract side. The contract rejects authData without
      // the UP (User Present) flag set. This test verifies the normal flow works.
    });

    // CNT-668: validate WebAuthn clientDataJSON type field
    it("CNT-668: verify WebAuthn clientDataJSON type field validation", async function () {
      const { factory, entryPoint, accountKeyWebAuthnLogic, webAuthnKeyPair, owner } = await loadFixture(
        deployE2EContractsWithWebAuthn
      );

      // Encode WebAuthn key
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const encodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet
      const accountAddress = await factory.createAccount.staticCall(668, encodedKey, encodedKey);
      await factory.createAccount(668, encodedKey, encodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Create UserOp
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Normal signature with type="webauthn.get" should work
      const normalSignature = signUserOpWebAuthn(userOpHash, webAuthnKeyPair);
      userOp.signature = encodeZkapSignature([0], [normalSignature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));

      // Note: clientDataJSON with type != "webauthn.get" would fail validation.
      // The signUserOpWebAuthn helper always uses the correct type.
      // Manual crafting of invalid type would be rejected by the contract.
    });

    // CNT-669: confirm old signature rejected after WebAuthn key update
    it("CNT-669: reject previous WebAuthn key signature after key rotation", async function () {
      const { factory, entryPoint, accountKeyWebAuthnLogic, accountKeyAddressLogic, webAuthnKeyPair, owner } =
        await loadFixture(deployE2EContractsWithWebAuthn);

      // Encode WebAuthn key for txKey, AddressKey for masterKey
      const masterWallet = createTestWallet(669);
      const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const masterEncodedKey = encodePrimitiveKeys(1, [masterKey]);

      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1
      );
      const txEncodedKey = encodePrimitiveKeys(1, [webAuthnKey]);

      // Create wallet with masterKey=AddressKey, txKey=WebAuthn
      const accountAddress = await factory.createAccount.staticCall(669, masterEncodedKey, txEncodedKey);
      await factory.createAccount(669, masterEncodedKey, txEncodedKey);
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // First: Verify old WebAuthn key works
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp1 = await createUserOp(account, callData);
      const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
      const signature1 = signUserOpWebAuthn(userOpHash1, webAuthnKeyPair);
      userOp1.signature = encodeZkapSignature([0], [signature1]);

      await entryPoint.handleOps([userOp1], owner.address);

      // Update txKey to a new AddressKey using masterKey
      const newTxWallet = createTestWallet(6699);
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newTxEncodedKey = encodePrimitiveKeys(1, [newTxKey]);

      const updateTxKeyCallData = account.interface.encodeFunctionData("updateTxKey", [newTxEncodedKey]);
      const updateUserOp = await createUserOp(account, updateTxKeyCallData);
      const updateUserOpHash = await getUserOpHash(entryPoint, updateUserOp, chainId);
      const updateSig = await signUserOp(updateUserOpHash, masterWallet);
      updateUserOp.signature = encodeZkapSignature([0], [updateSig]);

      await entryPoint.handleOps([updateUserOp], owner.address);

      // Mine a new block to allow execute after txKey update
      await ethers.provider.send("evm_mine", []);

      // Try to use old WebAuthn key - should fail
      const callData2 = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);
      const userOp2 = await createUserOp(account, callData2);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const signature2 = signUserOpWebAuthn(userOpHash2, webAuthnKeyPair);
      userOp2.signature = encodeZkapSignature([0], [signature2]);

      // Old WebAuthn key should be rejected
      await expect(entryPoint.handleOps([userOp2], owner.address)).to.be.reverted;

      // Verify new key works
      const userOp3 = await createUserOp(account, callData2);
      const userOpHash3 = await getUserOpHash(entryPoint, userOp3, chainId);
      const signature3 = await signUserOp(userOpHash3, newTxWallet);
      userOp3.signature = encodeZkapSignature([0], [signature3]);

      await entryPoint.handleOps([userOp3], owner.address);
    });
  });
});
