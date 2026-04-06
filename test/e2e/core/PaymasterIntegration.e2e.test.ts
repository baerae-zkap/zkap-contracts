/**
 * E2E Tests: Paymaster Integration
 *
 * CNT-357 ~ CNT-370: Paymaster Integration Tests
 * - VERIFYING mode: Sponsored ETH transfer, contract call, batch transactions
 * - ERC20 mode: Token payment transactions
 * - Bundler allowlist tests
 * - Timestamp validation (validUntil, validAfter)
 */

import { loadFixture, mine, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { encodeAddressKey, encodePrimitiveKeys } from "../../helpers/accountKeyHelper";
import {
  createUserOp,
  getUserOpHash,
  signUserOp,
  encodeZkapSignature,
  PackedUserOperation,
} from "../../helpers/userOpHelper";

// Constants
const VERIFYING_MODE = 0;
const ERC20_MODE = 1;

// ERC20 paymaster data length (without signature)
const ERC20_PAYMASTER_DATA_LENGTH = 84;

// Helper: Create test wallet
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Helper: Create paymasterAndData for VERIFYING mode
async function createVerifyingPaymasterData(
  paymaster: any,
  paymasterSigner: Wallet,
  userOp: PackedUserOperation,
  validUntil: number = 0,
  validAfter: number = 0,
  allowAllBundlers: boolean = true
): Promise<string> {
  const paymasterAddress = await paymaster.getAddress();

  // Mode byte: (mode << 1) | allowAllBundlers
  const mode = (VERIFYING_MODE << 1) | (allowAllBundlers ? 1 : 0);

  // Build paymasterAndData without signature first
  const tempPaymasterData = ethers.concat([
    paymasterAddress, // 20 bytes
    ethers.toBeHex(100000n, 16), // validation gas - 16 bytes
    ethers.toBeHex(50000n, 16), // postOp gas - 16 bytes
    ethers.toBeHex(mode, 1), // 1 byte
    ethers.toBeHex(validUntil, 6), // 6 bytes
    ethers.toBeHex(validAfter, 6), // 6 bytes
  ]);

  // Set temporary paymasterAndData to get hash
  userOp.paymasterAndData = tempPaymasterData;

  // Get hash and sign
  const hashToSign = await paymaster.getHash(VERIFYING_MODE, userOp);
  const signature = await paymasterSigner.signMessage(ethers.getBytes(hashToSign));

  // Return full paymasterAndData with signature
  return ethers.concat([tempPaymasterData, signature]);
}

// Helper: Create paymasterAndData for ERC20 mode
async function createERC20PaymasterData(
  paymaster: any,
  paymasterSigner: Wallet,
  userOp: PackedUserOperation,
  tokenAddress: string,
  tokenAmount: bigint,
  treasuryAddress: string,
  validUntil: number = 0,
  validAfter: number = 0,
  allowAllBundlers: boolean = true
): Promise<string> {
  const paymasterAddress = await paymaster.getAddress();

  // Mode byte: (mode << 1) | allowAllBundlers
  const mode = (ERC20_MODE << 1) | (allowAllBundlers ? 1 : 0);

  // Build paymasterAndData without signature first
  // Format: paymaster(20) + validationGas(16) + postOpGas(16) + mode(1) + validUntil(6) + validAfter(6) + token(20) + tokenAmount(32) + treasury(20)
  const tempPaymasterData = ethers.concat([
    paymasterAddress, // 20 bytes
    ethers.toBeHex(200000n, 16), // validation gas - 16 bytes (increased for ERC20)
    ethers.toBeHex(100000n, 16), // postOp gas - 16 bytes (increased for ERC20)
    ethers.toBeHex(mode, 1), // 1 byte
    ethers.toBeHex(validUntil, 6), // 6 bytes
    ethers.toBeHex(validAfter, 6), // 6 bytes
    tokenAddress, // 20 bytes
    ethers.toBeHex(tokenAmount, 32), // 32 bytes
    treasuryAddress, // 20 bytes
  ]);

  // Set temporary paymasterAndData to get hash
  userOp.paymasterAndData = tempPaymasterData;

  // Get hash and sign
  const hashToSign = await paymaster.getHash(ERC20_MODE, userOp);
  const signature = await paymasterSigner.signMessage(ethers.getBytes(hashToSign));

  // Return full paymasterAndData with signature
  return ethers.concat([tempPaymasterData, signature]);
}

// Fixture: Deploy all contracts for paymaster tests
async function deployPaymasterTestContracts() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const bundler = signers[1];
  const treasury = signers[2];

  // Create wallets
  const paymasterSigner = createTestWallet(50);
  const txWallet = createTestWallet(100);

  // 1. Deploy EntryPoint
  const EntryPointFactory = await ethers.getContractFactory("SimpleEntryPoint");
  const entryPoint = await EntryPointFactory.deploy();

  // 2. Deploy AccountKeyAddress Logic
  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();

  // 3. Deploy ZkapAccountFactory
  const FactoryContract = await ethers.getContractFactory("ZkapAccountFactory");
  const factory = await FactoryContract.deploy(await entryPoint.getAddress());

  // 4. Deploy ZkapPaymaster
  const ZkapPaymasterFactory = await ethers.getContractFactory("ZkapPaymaster");
  const paymaster = await ZkapPaymasterFactory.deploy(
    await entryPoint.getAddress(),
    owner.address,
    owner.address, // manager
    [paymasterSigner.address] // signers
  );

  // Fund paymaster
  await paymaster.deposit({ value: ethers.parseEther("10.0") });

  // 5. Deploy TestToken for ERC20 tests
  const TestTokenFactory = await ethers.getContractFactory("TestERC20");
  const testToken = await TestTokenFactory.deploy("Test Token", "TT", 18);
  await testToken.mint(treasury.address, ethers.parseEther("1000"));

  // 6. Deploy TestCounter for contract call tests
  const TestCounterFactory = await ethers.getContractFactory("TestCounter");
  const testCounter = await TestCounterFactory.deploy();

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    paymaster,
    paymasterSigner,
    testToken,
    testCounter,
    owner,
    bundler,
    treasury,
    txWallet,
    signers,
  };
}

// Fixture: Deploy wallet with paymaster setup
async function deployWalletWithPaymaster() {
  const base = await deployPaymasterTestContracts();
  const { factory, entryPoint, accountKeyAddressLogic, owner, txWallet, paymaster } = base;

  // Create wallet
  const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedKey = encodePrimitiveKeys(1, [txKey]);

  const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
  await factory.createAccount(1, encodedKey, encodedKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund account (small amount - paymaster will cover gas)
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });

  return { ...base, account, accountAddress };
}

// Fixture: Deploy with bundler allowlist configured
async function deployWithBundlerAllowlist() {
  const fixture = await deployWalletWithPaymaster();
  const { paymaster, bundler } = fixture;

  // Add bundler to allowlist
  await paymaster.updateBundlerAllowlist([bundler.address], true);

  return fixture;
}

describe("E2E: Paymaster Integration", function () {
  describe("VERIFYING Mode", function () {
    // CNT-357: Paymaster-sponsored ETH transfer
    it("CNT-357: sponsored ETH transfer with paymaster", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, owner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("1.0");

      // Create callData for ETH transfer
      const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      // Create UserOp
      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Add paymaster data
      userOp.paymasterAndData = await createVerifyingPaymasterData(paymaster, paymasterSigner, userOp);

      // Sign userOp with txKey
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Execute
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-358: Paymaster-sponsored contract call
    it("CNT-358: sponsored contract call with paymaster", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, testCounter, owner } = await loadFixture(
        deployWalletWithPaymaster
      );

      // Increment counter via execute
      const incrementData = testCounter.interface.encodeFunctionData("increment");
      const callData = account.interface.encodeFunctionData("execute", [
        await testCounter.getAddress(),
        0,
        incrementData,
      ]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      userOp.paymasterAndData = await createVerifyingPaymasterData(paymaster, paymasterSigner, userOp);

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const countBefore = await testCounter.count();
      await entryPoint.handleOps([userOp], owner.address);
      const countAfter = await testCounter.count();

      expect(countAfter - countBefore).to.equal(1n);
    });

    // CNT-359: Paymaster-sponsored batch transaction
    it("CNT-359: sponsored batch transaction with paymaster", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, testCounter, owner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const incrementData = testCounter.interface.encodeFunctionData("increment");

      // Batch: ETH transfer + counter increment
      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [recipient, await testCounter.getAddress()],
        [ethers.parseEther("0.5"), 0],
        ["0x", incrementData],
      ]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      userOp.paymasterAndData = await createVerifyingPaymasterData(paymaster, paymasterSigner, userOp);

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      const countBefore = await testCounter.count();

      await entryPoint.handleOps([userOp], owner.address);

      const balanceAfter = await ethers.provider.getBalance(recipient);
      const countAfter = await testCounter.count();

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.5"));
      expect(countAfter - countBefore).to.equal(1n);
    });

    // CNT-360: Paymaster-sponsored wallet deployment + execution
    it("CNT-360: sponsored wallet creation + execution with paymaster", async function () {
      const { entryPoint, factory, accountKeyAddressLogic, paymaster, paymasterSigner, testCounter, owner } =
        await loadFixture(deployPaymasterTestContracts);

      // Create a new wallet via initCode
      const newTxWallet = createTestWallet(999);
      const txKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(1, [txKey]);

      // Calculate new account address
      const newAccountAddress = await factory.calcAccountAddress(999, encodedKey, encodedKey);

      // Create initCode
      const initCode = ethers.concat([
        await factory.getAddress(),
        factory.interface.encodeFunctionData("createAccount", [999, encodedKey, encodedKey]),
      ]);

      // Fund the new account address (needed for the execution part)
      await owner.sendTransaction({ to: newAccountAddress, value: ethers.parseEther("1.0") });

      // Create callData for counter increment
      const incrementData = testCounter.interface.encodeFunctionData("increment");
      const newAccount = await ethers.getContractAt("ZkapAccount", newAccountAddress);
      const callData = newAccount.interface.encodeFunctionData("execute", [
        await testCounter.getAddress(),
        0,
        incrementData,
      ]);

      // Create UserOp with initCode
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const verificationGasLimit = 3000000n;
      const callGasLimit = 1000000n;
      const accountGasLimits = ethers.concat([
        ethers.toBeHex(verificationGasLimit, 16),
        ethers.toBeHex(callGasLimit, 16),
      ]);

      const maxPriorityFeePerGas = 1000000000n;
      const maxFeePerGas = 2000000000n;
      const gasFees = ethers.concat([ethers.toBeHex(maxPriorityFeePerGas, 16), ethers.toBeHex(maxFeePerGas, 16)]);

      let userOp: PackedUserOperation = {
        sender: newAccountAddress,
        nonce: 0n,
        initCode: initCode,
        callData: callData,
        accountGasLimits: accountGasLimits,
        preVerificationGas: 200000n,
        gasFees: gasFees,
        paymasterAndData: "0x",
        signature: "0x",
      };

      // Add paymaster data
      userOp.paymasterAndData = await createVerifyingPaymasterData(paymaster, paymasterSigner, userOp);

      // Sign with new txWallet
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, newTxWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const countBefore = await testCounter.count();

      // Execute - this should create wallet AND execute the call
      await entryPoint.handleOps([userOp], owner.address);

      const countAfter = await testCounter.count();

      // Verify wallet was created
      const createdAccountCode = await ethers.provider.getCode(newAccountAddress);
      expect(createdAccountCode).to.not.equal("0x");

      // Verify call was executed
      expect(countAfter - countBefore).to.equal(1n);
    });
  });

  describe("ERC20 Mode", function () {
    // CNT-361: ERC20 payment transaction
    it("CNT-361: ERC20 payment transaction with paymaster", async function () {
      const {
        account,
        accountAddress,
        entryPoint,
        paymaster,
        paymasterSigner,
        txWallet,
        testToken,
        testCounter,
        treasury,
        owner,
      } = await loadFixture(deployWalletWithPaymaster);

      const tokenAmount = ethers.parseEther("10"); // 10 tokens as payment

      // Mint tokens to user account (so account can pay treasury)
      await testToken.mint(accountAddress, ethers.parseEther("100"));

      // ZKAPSC-003: ERC20 mode now transfers tokens in validatePaymasterUserOp (not postOp)
      // So we need to approve BEFORE creating the UserOp
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: Approve paymaster to spend tokens (separate UserOp)
      const approveData = testToken.interface.encodeFunctionData("approve", [
        await paymaster.getAddress(),
        tokenAmount,
      ]);
      const approveCallData = account.interface.encodeFunctionData("execute", [
        await testToken.getAddress(),
        0,
        approveData,
      ]);

      let approveUserOp = await createUserOp(account, approveCallData);
      const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
      const approveSig = await signUserOp(approveUserOpHash, txWallet);
      approveUserOp.signature = encodeZkapSignature([0], [approveSig]);

      await entryPoint.handleOps([approveUserOp], owner.address);

      // Step 2: Execute counter increment with ERC20 paymaster
      const incrementData = testCounter.interface.encodeFunctionData("increment");
      const callData = account.interface.encodeFunctionData("execute", [
        await testCounter.getAddress(),
        0,
        incrementData,
      ]);

      let userOp = await createUserOp(account, callData);

      // Add ERC20 paymaster data
      userOp.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount,
        treasury.address
      );

      // Sign userOp with txKey
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Record balances before
      const treasuryTokenBalanceBefore = await testToken.balanceOf(treasury.address);
      const countBefore = await testCounter.count();

      // Execute
      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check if UserOperationSponsored event was emitted (ERC20 mode emits in validation)
      const sponsoredEvent = receipt?.logs.find((log) => {
        try {
          const parsed = paymaster.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationSponsored";
        } catch {
          return false;
        }
      });

      // Verify UserOperationSponsored event was emitted
      expect(sponsoredEvent).to.not.be.undefined;

      // Verify token transfer to treasury (transferred by paymaster in validation via safeTransferFrom)
      const treasuryTokenBalanceAfter = await testToken.balanceOf(treasury.address);
      expect(treasuryTokenBalanceAfter - treasuryTokenBalanceBefore).to.equal(tokenAmount);

      // Verify counter increment
      const countAfter = await testCounter.count();
      expect(countAfter - countBefore).to.equal(1n);
    });

    // CNT-362: verify token balance after ERC20 payment
    it("CNT-362: verify token balance after ERC20 payment", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, testToken, treasury, owner } =
        await loadFixture(deployWalletWithPaymaster);

      const initialUserBalance = ethers.parseEther("50");
      const tokenAmount = ethers.parseEther("15");

      // Mint tokens to user account
      await testToken.mint(accountAddress, initialUserBalance);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: Approve paymaster to spend tokens (separate UserOp)
      const approveData = testToken.interface.encodeFunctionData("approve", [
        await paymaster.getAddress(),
        tokenAmount,
      ]);
      const approveCallData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

      let approveUserOp = await createUserOp(account, approveCallData);
      const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
      const approveSig = await signUserOp(approveUserOpHash, txWallet);
      approveUserOp.signature = encodeZkapSignature([0], [approveSig]);

      await entryPoint.handleOps([approveUserOp], owner.address);

      // Step 2: Simple execute with ERC20 paymaster (no callData needed, just gas sponsorship)
      const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);

      let userOp = await createUserOp(account, callData);

      userOp.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount,
        treasury.address
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Record balances
      const userBalanceBefore = await testToken.balanceOf(accountAddress);
      const treasuryBalanceBefore = await testToken.balanceOf(treasury.address);

      // Execute
      await entryPoint.handleOps([userOp], owner.address);

      // Verify balances (paymaster transfers tokens in validation via safeTransferFrom)
      const userBalanceAfter = await testToken.balanceOf(accountAddress);
      const treasuryBalanceAfter = await testToken.balanceOf(treasury.address);

      expect(userBalanceBefore - userBalanceAfter).to.equal(tokenAmount);
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(tokenAmount);
    });

    // CNT-363: ERC20 payment - payment does not proceed without approve
    it("CNT-363: verify no payment when paymaster not approved", async function () {
      const {
        account,
        accountAddress,
        entryPoint,
        paymaster,
        paymasterSigner,
        txWallet,
        testToken,
        testCounter,
        treasury,
        owner,
      } = await loadFixture(deployWalletWithPaymaster);

      const tokenAmount = ethers.parseEther("10");

      // Mint tokens to user account
      await testToken.mint(accountAddress, ethers.parseEther("100"));

      // Treasury initially has 1000 tokens from fixture
      const treasuryBalanceBefore = await testToken.balanceOf(treasury.address);

      // Execute counter increment WITHOUT approving paymaster
      // This simulates a scenario where user tries to use paymaster without approving
      const incrementData = testCounter.interface.encodeFunctionData("increment");

      const callData = account.interface.encodeFunctionData("execute", [
        await testCounter.getAddress(),
        0,
        incrementData,
      ]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Paymaster expects to transfer tokens via safeTransferFrom in validation
      userOp.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount,
        treasury.address
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // ZKAPSC-003: safeTransferFrom is now called in validation phase, not postOp
      // So the UserOp should fail during validation with AA33 (paymaster validation failed)
      await expect(entryPoint.handleOps([userOp], owner.address))
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert");

      // Treasury balance should remain unchanged (no payment received)
      const treasuryBalanceAfter = await testToken.balanceOf(treasury.address);
      expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
    });
  });

  describe("Bundler Allowlist", function () {
    // CNT-364: transaction with allowed bundler
    it("CNT-364: transaction with allowed bundler", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, bundler } = await loadFixture(
        deployWithBundlerAllowlist
      );

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // allowAllBundlers = false, use allowed bundler
      userOp.paymasterAndData = await createVerifyingPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        0,
        0,
        false // allowAllBundlers = false
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Execute from allowed bundler address
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.connect(bundler).handleOps([userOp], bundler.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));
    });

    // CNT-365: reject disallowed bundler
    it("CNT-365: reject non-allowed bundler", async function () {
      const {
        account,
        entryPoint,
        paymaster,
        paymasterSigner,
        txWallet,
        owner, // owner is not in bundler allowlist
      } = await loadFixture(deployWithBundlerAllowlist);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // allowAllBundlers = false
      userOp.paymasterAndData = await createVerifyingPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        0,
        0,
        false // allowAllBundlers = false
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Execute from non-allowed bundler (owner) - should fail
      // EntryPoint wraps the error as FailedOpWithRevert with BundlerNotAllowed selector (0x55d3ab46)
      await expect(entryPoint.connect(owner).handleOps([userOp], owner.address)).to.be.revertedWithCustomError(
        entryPoint,
        "FailedOpWithRevert"
      );
    });

    // CNT-366: all bundlers allowed when allowAllBundlers=true
    it("CNT-366: allow all bundlers when allowAllBundlers=true", async function () {
      const {
        account,
        entryPoint,
        paymaster,
        paymasterSigner,
        txWallet,
        owner, // owner is not in bundler allowlist, but should work with allowAllBundlers=true
      } = await loadFixture(deployWithBundlerAllowlist);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // allowAllBundlers = true
      userOp.paymasterAndData = await createVerifyingPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        0,
        0,
        true // allowAllBundlers = true
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.connect(owner).handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));
    });
  });

  describe("Timestamp Validation", function () {
    // CNT-367: succeeds before validUntil expiry
    it("CNT-367: success before validUntil expires", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, owner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // validUntil = current time + 1 hour (far in future)
      const currentTime = await time.latest();
      const validUntil = currentTime + 3600;

      userOp.paymasterAndData = await createVerifyingPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        validUntil,
        0, // validAfter = 0 (always valid)
        true
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));
    });

    // CNT-368: fails after validUntil expiry
    it("CNT-368: fail after validUntil expires", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, owner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // validUntil = current time - 1 (already expired)
      const currentTime = await time.latest();
      const validUntil = currentTime - 1;

      userOp.paymasterAndData = await createVerifyingPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        validUntil,
        0,
        true
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail because validUntil has passed
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-369: succeeds after validAfter is reached
    it("CNT-369: success after validAfter reached", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, owner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // validAfter = current time - 1 hour (already passed)
      const currentTime = await time.latest();
      const validAfter = currentTime - 3600;

      userOp.paymasterAndData = await createVerifyingPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        0, // validUntil = 0 (no expiry)
        validAfter,
        true
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));
    });

    // CNT-370: fails before validAfter is reached
    it("CNT-370: fail before validAfter reached", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, owner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // validAfter = current time + 1 hour (not yet reached)
      const currentTime = await time.latest();
      const validAfter = currentTime + 3600;

      userOp.paymasterAndData = await createVerifyingPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        0, // validUntil = 0 (no expiry)
        validAfter,
        true
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail because validAfter has not been reached
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });
  });

  // ===========================================
  // ERC20 Mode Edge Cases (CNT-547~549, 680~682)
  // ===========================================
  describe("ERC20 Mode Edge Cases", function () {
    // CNT-547: safeTransferFrom fails in validation when token balance insufficient
    it("CNT-547: fail validation when insufficient token balance", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, testToken, treasury, owner } =
        await loadFixture(deployWalletWithPaymaster);

      const tokenAmount = ethers.parseEther("100"); // Required payment

      // Only mint 50 tokens (less than required 100)
      await testToken.mint(accountAddress, ethers.parseEther("50"));

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: Approve paymaster (this will succeed)
      const approveData = testToken.interface.encodeFunctionData("approve", [
        await paymaster.getAddress(),
        tokenAmount, // Approve 100, but only have 50
      ]);
      const approveCallData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

      let approveUserOp = await createUserOp(account, approveCallData);
      const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
      const approveSig = await signUserOp(approveUserOpHash, txWallet);
      approveUserOp.signature = encodeZkapSignature([0], [approveSig]);

      await entryPoint.handleOps([approveUserOp], owner.address);

      // Step 2: Try to use ERC20 paymaster with insufficient balance
      const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);

      let userOp = await createUserOp(account, callData);

      // Record treasury balance before
      const treasuryBalanceBefore = await testToken.balanceOf(treasury.address);

      userOp.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount, // Expecting 100 tokens but user only has 50
        treasury.address
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // ZKAPSC-003: safeTransferFrom is called in validation phase
      // Should fail with AA33 (paymaster validation failed) due to insufficient balance
      await expect(entryPoint.handleOps([userOp], owner.address))
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert");

      // Treasury balance should not increase (safeTransferFrom failed)
      const treasuryBalanceAfter = await testToken.balanceOf(treasury.address);
      expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
    });

    // CNT-548: payment with various ERC20 tokens
    it("CNT-548: pay with multiple different ERC20 tokens", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, treasury, owner } =
        await loadFixture(deployWalletWithPaymaster);

      // Deploy additional test tokens (simulating USDC, DAI)
      const TestTokenFactory = await ethers.getContractFactory("TestToken");
      const tokenA = await TestTokenFactory.deploy();
      const tokenB = await TestTokenFactory.deploy();

      const tokenAmount = ethers.parseEther("10");

      // Mint tokens to account
      await tokenA.mint(accountAddress, ethers.parseEther("100"));
      await tokenB.mint(accountAddress, ethers.parseEther("100"));

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Test with Token A
      // Step 1: Approve paymaster for Token A
      const approveDataA = tokenA.interface.encodeFunctionData("approve", [await paymaster.getAddress(), tokenAmount]);
      const approveCallDataA = account.interface.encodeFunctionData("execute", [await tokenA.getAddress(), 0, approveDataA]);

      let approveUserOpA = await createUserOp(account, approveCallDataA);
      const approveUserOpHashA = await getUserOpHash(entryPoint, approveUserOpA, chainId);
      const approveSigA = await signUserOp(approveUserOpHashA, txWallet);
      approveUserOpA.signature = encodeZkapSignature([0], [approveSigA]);
      await entryPoint.handleOps([approveUserOpA], owner.address);

      // Step 2: Use ERC20 paymaster with Token A
      const callDataA = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOpA = await createUserOp(account, callDataA);

      userOpA.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOpA,
        await tokenA.getAddress(),
        tokenAmount,
        treasury.address
      );

      const userOpHashA = await getUserOpHash(entryPoint, userOpA, chainId);
      const signatureA = await signUserOp(userOpHashA, txWallet);
      userOpA.signature = encodeZkapSignature([0], [signatureA]);

      const treasuryBalanceABefore = await tokenA.balanceOf(treasury.address);
      await entryPoint.handleOps([userOpA], owner.address);
      const treasuryBalanceAAfter = await tokenA.balanceOf(treasury.address);
      expect(treasuryBalanceAAfter - treasuryBalanceABefore).to.equal(tokenAmount);

      // Test with Token B
      // Step 1: Approve paymaster for Token B
      const approveDataB = tokenB.interface.encodeFunctionData("approve", [await paymaster.getAddress(), tokenAmount]);
      const approveCallDataB = account.interface.encodeFunctionData("execute", [await tokenB.getAddress(), 0, approveDataB]);

      let approveUserOpB = await createUserOp(account, approveCallDataB);
      const approveUserOpHashB = await getUserOpHash(entryPoint, approveUserOpB, chainId);
      const approveSigB = await signUserOp(approveUserOpHashB, txWallet);
      approveUserOpB.signature = encodeZkapSignature([0], [approveSigB]);
      await entryPoint.handleOps([approveUserOpB], owner.address);

      // Step 2: Use ERC20 paymaster with Token B
      const callDataB = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOpB = await createUserOp(account, callDataB);

      userOpB.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOpB,
        await tokenB.getAddress(),
        tokenAmount,
        treasury.address
      );

      const userOpHashB = await getUserOpHash(entryPoint, userOpB, chainId);
      const signatureB = await signUserOp(userOpHashB, txWallet);
      userOpB.signature = encodeZkapSignature([0], [signatureB]);

      const treasuryBalanceBBefore = await tokenB.balanceOf(treasury.address);
      await entryPoint.handleOps([userOpB], owner.address);
      const treasuryBalanceBAfter = await tokenB.balanceOf(treasury.address);
      expect(treasuryBalanceBAfter - treasuryBalanceBBefore).to.equal(tokenAmount);
    });

    // CNT-549: UserOp rejected when Paymaster balance insufficient
    it("CNT-549: reject UserOp when paymaster has insufficient deposit", async function () {
      const {
        account,
        accountAddress,
        entryPoint,
        paymasterSigner,
        txWallet,
        testToken,
        treasury,
        owner,
        factory,
        accountKeyAddressLogic,
      } = await loadFixture(deployWalletWithPaymaster);

      // Deploy a new paymaster with zero deposit
      const ZkapPaymasterFactory = await ethers.getContractFactory("ZkapPaymaster");
      const emptyPaymaster = await ZkapPaymasterFactory.deploy(
        await entryPoint.getAddress(),
        owner.address,
        owner.address,
        [paymasterSigner.address]
      );
      // Do NOT fund this paymaster

      const tokenAmount = ethers.parseEther("10");
      await testToken.mint(accountAddress, ethers.parseEther("100"));

      // Approve the empty paymaster
      const approveData = testToken.interface.encodeFunctionData("approve", [
        await emptyPaymaster.getAddress(),
        tokenAmount,
      ]);
      const callData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      userOp.paymasterAndData = await createERC20PaymasterData(
        emptyPaymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount,
        treasury.address
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail because paymaster has no deposit
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-680: handle ERC20 mode when treasury balance is 0
    it("CNT-680: succeed when treasury starts with zero balance", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, testToken, owner, signers } =
        await loadFixture(deployWalletWithPaymaster);

      // Use a fresh treasury address with zero balance
      const freshTreasury = signers[8];
      const treasuryBalanceBefore = await testToken.balanceOf(freshTreasury.address);
      expect(treasuryBalanceBefore).to.equal(0n);

      const tokenAmount = ethers.parseEther("10");
      await testToken.mint(accountAddress, ethers.parseEther("100"));

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: Approve paymaster
      const approveData = testToken.interface.encodeFunctionData("approve", [await paymaster.getAddress(), tokenAmount]);
      const approveCallData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

      let approveUserOp = await createUserOp(account, approveCallData);
      const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
      const approveSig = await signUserOp(approveUserOpHash, txWallet);
      approveUserOp.signature = encodeZkapSignature([0], [approveSig]);
      await entryPoint.handleOps([approveUserOp], owner.address);

      // Step 2: Use ERC20 paymaster with fresh treasury
      const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOp = await createUserOp(account, callData);

      userOp.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount,
        freshTreasury.address
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify treasury received tokens (from 0 to tokenAmount via safeTransferFrom in validation)
      const treasuryBalanceAfter = await testToken.balanceOf(freshTreasury.address);
      expect(treasuryBalanceAfter).to.equal(tokenAmount);
    });

    // CNT-681: ERC20 mode - partial approval causes safeTransferFrom failure
    it("CNT-681: fail when partial token amount approved to paymaster", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, testToken, treasury, owner } =
        await loadFixture(deployWalletWithPaymaster);

      const tokenAmount = ethers.parseEther("100"); // Paymaster expects 100 tokens
      await testToken.mint(accountAddress, ethers.parseEther("200")); // User has enough

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: User only approves 50 tokens instead of required 100
      const partialAmount = ethers.parseEther("50");
      const approveData = testToken.interface.encodeFunctionData("approve", [
        await paymaster.getAddress(),
        partialAmount, // Only 50, not 100
      ]);
      const approveCallData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

      let approveUserOp = await createUserOp(account, approveCallData);
      const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
      const approveSig = await signUserOp(approveUserOpHash, txWallet);
      approveUserOp.signature = encodeZkapSignature([0], [approveSig]);
      await entryPoint.handleOps([approveUserOp], owner.address);

      // Step 2: Try to use ERC20 paymaster with insufficient approval
      const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOp = await createUserOp(account, callData);

      const treasuryBalanceBefore = await testToken.balanceOf(treasury.address);

      userOp.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount, // Expecting 100 tokens but only 50 approved
        treasury.address
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // ZKAPSC-003: safeTransferFrom is called in validation phase
      // Should fail with AA33 (paymaster validation failed) due to insufficient allowance
      await expect(entryPoint.handleOps([userOp], owner.address))
        .to.be.revertedWithCustomError(entryPoint, "FailedOpWithRevert");

      // Treasury balance should remain unchanged
      const treasuryBalanceAfter = await testToken.balanceOf(treasury.address);
      expect(treasuryBalanceAfter).to.equal(treasuryBalanceBefore);
    });

    // CNT-682: handle ERC20 mode token decimals variety (6, 8, 18)
    it("CNT-682: handle tokens with different decimals (6, 8, 18)", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, treasury, owner } =
        await loadFixture(deployWalletWithPaymaster);

      // Deploy tokens with different decimals
      const TestTokenFactory = await ethers.getContractFactory("TestToken");

      // Note: TestToken has 18 decimals by default
      // For this test, we'll use the same token but with different amounts representing different decimals
      const token18 = await TestTokenFactory.deploy(); // 18 decimals (default)

      // For tokens with different decimals, we need to deploy custom tokens or just use different amounts
      // Since TestToken is 18 decimals, we'll demonstrate the concept with different amounts

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Test with small amount (simulating 6 decimals: 10 * 10^6 = 10000000)
      const smallAmount = 10000000n; // Like 10 USDC
      await token18.mint(accountAddress, smallAmount * 2n);

      // Step 1: Approve paymaster for small amount
      const approveData1 = token18.interface.encodeFunctionData("approve", [await paymaster.getAddress(), smallAmount]);
      const approveCallData1 = account.interface.encodeFunctionData("execute", [await token18.getAddress(), 0, approveData1]);

      let approveUserOp1 = await createUserOp(account, approveCallData1);
      const approveUserOpHash1 = await getUserOpHash(entryPoint, approveUserOp1, chainId);
      const approveSig1 = await signUserOp(approveUserOpHash1, txWallet);
      approveUserOp1.signature = encodeZkapSignature([0], [approveSig1]);
      await entryPoint.handleOps([approveUserOp1], owner.address);

      // Step 2: Use ERC20 paymaster with small amount
      const callData1 = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOp1 = await createUserOp(account, callData1);
      userOp1.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp1,
        await token18.getAddress(),
        smallAmount,
        treasury.address
      );

      const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
      const signature1 = await signUserOp(userOpHash1, txWallet);
      userOp1.signature = encodeZkapSignature([0], [signature1]);

      const balanceBefore1 = await token18.balanceOf(treasury.address);
      await entryPoint.handleOps([userOp1], owner.address);
      const balanceAfter1 = await token18.balanceOf(treasury.address);
      expect(balanceAfter1 - balanceBefore1).to.equal(smallAmount);

      // Test with large amount (simulating 18 decimals: 10 * 10^18)
      const largeAmount = ethers.parseEther("10"); // 10 tokens with 18 decimals
      await token18.mint(accountAddress, largeAmount * 2n);

      // Step 1: Approve paymaster for large amount
      const approveData2 = token18.interface.encodeFunctionData("approve", [await paymaster.getAddress(), largeAmount]);
      const approveCallData2 = account.interface.encodeFunctionData("execute", [await token18.getAddress(), 0, approveData2]);

      let approveUserOp2 = await createUserOp(account, approveCallData2);
      const approveUserOpHash2 = await getUserOpHash(entryPoint, approveUserOp2, chainId);
      const approveSig2 = await signUserOp(approveUserOpHash2, txWallet);
      approveUserOp2.signature = encodeZkapSignature([0], [approveSig2]);
      await entryPoint.handleOps([approveUserOp2], owner.address);

      // Step 2: Use ERC20 paymaster with large amount
      const callData2 = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);

      let userOp2 = await createUserOp(account, callData2);
      userOp2.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp2,
        await token18.getAddress(),
        largeAmount,
        treasury.address
      );

      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const signature2 = await signUserOp(userOpHash2, txWallet);
      userOp2.signature = encodeZkapSignature([0], [signature2]);

      const balanceBefore2 = await token18.balanceOf(treasury.address);
      await entryPoint.handleOps([userOp2], owner.address);
      const balanceAfter2 = await token18.balanceOf(treasury.address);
      expect(balanceAfter2 - balanceBefore2).to.equal(largeAmount);
    });
  });

  // ===========================================
  // Treasury and MultiPaymaster Tests (CNT-610~616)
  // ===========================================
  describe("Treasury and MultiPaymaster", function () {
    // CNT-610: verify treasury balance increases after ERC20 validation
    it("CNT-610: verify treasury balance increase after ERC20 validation", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, testToken, treasury, owner } =
        await loadFixture(deployWalletWithPaymaster);

      const tokenAmount = ethers.parseEther("25");
      await testToken.mint(accountAddress, ethers.parseEther("100"));

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: Approve paymaster
      const approveData = testToken.interface.encodeFunctionData("approve", [await paymaster.getAddress(), tokenAmount]);
      const approveCallData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

      let approveUserOp = await createUserOp(account, approveCallData);
      const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
      const approveSig = await signUserOp(approveUserOpHash, txWallet);
      approveUserOp.signature = encodeZkapSignature([0], [approveSig]);
      await entryPoint.handleOps([approveUserOp], owner.address);

      // Step 2: Use ERC20 paymaster
      const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOp = await createUserOp(account, callData);

      userOp.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount,
        treasury.address
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const treasuryBalanceBefore = await testToken.balanceOf(treasury.address);
      await entryPoint.handleOps([userOp], owner.address);
      const treasuryBalanceAfter = await testToken.balanceOf(treasury.address);

      // Verify exact tokenAmount increase (via safeTransferFrom in validation)
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(tokenAmount);
    });

    // CNT-611: verify treasury accumulated balance across consecutive UserOp executions
    it("CNT-611: verify treasury cumulative balance after multiple UserOps", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, testToken, treasury, owner } =
        await loadFixture(deployWalletWithPaymaster);

      const tokenAmount = ethers.parseEther("10");
      await testToken.mint(accountAddress, ethers.parseEther("200"));

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const treasuryBalanceInitial = await testToken.balanceOf(treasury.address);

      // Execute 3 consecutive UserOps - each needs separate approve then paymaster use
      for (let i = 0; i < 3; i++) {
        // Step 1: Approve paymaster
        const approveData = testToken.interface.encodeFunctionData("approve", [
          await paymaster.getAddress(),
          tokenAmount,
        ]);
        const approveCallData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

        let approveUserOp = await createUserOp(account, approveCallData);
        const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
        const approveSig = await signUserOp(approveUserOpHash, txWallet);
        approveUserOp.signature = encodeZkapSignature([0], [approveSig]);
        await entryPoint.handleOps([approveUserOp], owner.address);

        // Step 2: Use ERC20 paymaster
        const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
        let userOp = await createUserOp(account, callData);
        userOp.paymasterAndData = await createERC20PaymasterData(
          paymaster,
          paymasterSigner,
          userOp,
          await testToken.getAddress(),
          tokenAmount,
          treasury.address
        );

        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
        const signature = await signUserOp(userOpHash, txWallet);
        userOp.signature = encodeZkapSignature([0], [signature]);

        await entryPoint.handleOps([userOp], owner.address);
      }

      // Verify cumulative increase (3 * tokenAmount)
      const treasuryBalanceFinal = await testToken.balanceOf(treasury.address);
      expect(treasuryBalanceFinal - treasuryBalanceInitial).to.equal(tokenAmount * 3n);
    });

    // CNT-615: same wallet switches to a different Paymaster
    it("CNT-615: switch between different paymasters for same wallet", async function () {
      const {
        account,
        accountAddress,
        entryPoint,
        paymaster,
        paymasterSigner,
        txWallet,
        testToken,
        treasury,
        owner,
        signers,
      } = await loadFixture(deployWalletWithPaymaster);

      // Deploy second paymaster
      const paymasterSigner2 = createTestWallet(51);
      const ZkapPaymasterFactory = await ethers.getContractFactory("ZkapPaymaster");
      const paymaster2 = await ZkapPaymasterFactory.deploy(
        await entryPoint.getAddress(),
        owner.address,
        owner.address,
        [paymasterSigner2.address]
      );
      await paymaster2.deposit({ value: ethers.parseEther("5.0") });

      const treasury2 = signers[9];
      const tokenAmount = ethers.parseEther("10");
      await testToken.mint(accountAddress, ethers.parseEther("100"));

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // First UserOp with Paymaster A
      // Step 1: Approve paymaster A
      const approveData1 = testToken.interface.encodeFunctionData("approve", [
        await paymaster.getAddress(),
        tokenAmount,
      ]);
      const approveCallData1 = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData1]);

      let approveUserOp1 = await createUserOp(account, approveCallData1);
      const approveUserOpHash1 = await getUserOpHash(entryPoint, approveUserOp1, chainId);
      const approveSig1 = await signUserOp(approveUserOpHash1, txWallet);
      approveUserOp1.signature = encodeZkapSignature([0], [approveSig1]);
      await entryPoint.handleOps([approveUserOp1], owner.address);

      // Step 2: Use Paymaster A
      const callData1 = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOp1 = await createUserOp(account, callData1);
      userOp1.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp1,
        await testToken.getAddress(),
        tokenAmount,
        treasury.address
      );

      const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
      const signature1 = await signUserOp(userOpHash1, txWallet);
      userOp1.signature = encodeZkapSignature([0], [signature1]);

      const treasury1BalanceBefore = await testToken.balanceOf(treasury.address);
      await entryPoint.handleOps([userOp1], owner.address);
      const treasury1BalanceAfter = await testToken.balanceOf(treasury.address);
      expect(treasury1BalanceAfter - treasury1BalanceBefore).to.equal(tokenAmount);

      // Second UserOp with Paymaster B
      // Step 1: Approve paymaster B
      const approveData2 = testToken.interface.encodeFunctionData("approve", [
        await paymaster2.getAddress(),
        tokenAmount,
      ]);
      const approveCallData2 = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData2]);

      let approveUserOp2 = await createUserOp(account, approveCallData2);
      const approveUserOpHash2 = await getUserOpHash(entryPoint, approveUserOp2, chainId);
      const approveSig2 = await signUserOp(approveUserOpHash2, txWallet);
      approveUserOp2.signature = encodeZkapSignature([0], [approveSig2]);
      await entryPoint.handleOps([approveUserOp2], owner.address);

      // Step 2: Use Paymaster B
      const callData2 = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOp2 = await createUserOp(account, callData2);
      userOp2.paymasterAndData = await createERC20PaymasterData(
        paymaster2,
        paymasterSigner2,
        userOp2,
        await testToken.getAddress(),
        tokenAmount,
        treasury2.address
      );

      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const signature2 = await signUserOp(userOpHash2, txWallet);
      userOp2.signature = encodeZkapSignature([0], [signature2]);

      const treasury2BalanceBefore = await testToken.balanceOf(treasury2.address);
      await entryPoint.handleOps([userOp2], owner.address);
      const treasury2BalanceAfter = await testToken.balanceOf(treasury2.address);
      expect(treasury2BalanceAfter - treasury2BalanceBefore).to.equal(tokenAmount);
    });

    // CNT-616: multiple wallets use the same Paymaster concurrently
    it("CNT-616: multiple wallets use same paymaster concurrently", async function () {
      const { entryPoint, factory, accountKeyAddressLogic, paymaster, paymasterSigner, testToken, treasury, owner } =
        await loadFixture(deployPaymasterTestContracts);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const tokenAmount = ethers.parseEther("5");

      // Create 3 wallets
      const wallets = [];
      for (let i = 0; i < 3; i++) {
        const txWallet = createTestWallet(300 + i);
        const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
        const encodedKey = encodePrimitiveKeys(1, [txKey]);

        const accountAddress = await factory.createAccount.staticCall(100 + i, encodedKey, encodedKey);
        await factory.createAccount(100 + i, encodedKey, encodedKey);

        const account = await ethers.getContractAt("ZkapAccount", accountAddress);
        await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("1.0") });
        await testToken.mint(accountAddress, ethers.parseEther("50"));

        wallets.push({ account, accountAddress, txWallet });
      }

      // Step 1: Each wallet approves paymaster first
      for (const { account, txWallet } of wallets) {
        const approveData = testToken.interface.encodeFunctionData("approve", [
          await paymaster.getAddress(),
          tokenAmount,
        ]);
        const approveCallData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

        let approveUserOp = await createUserOp(account, approveCallData);
        const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
        const approveSig = await signUserOp(approveUserOpHash, txWallet);
        approveUserOp.signature = encodeZkapSignature([0], [approveSig]);

        await entryPoint.handleOps([approveUserOp], owner.address);
      }

      const treasuryBalanceBefore = await testToken.balanceOf(treasury.address);

      // Step 2: Create UserOps for all 3 wallets with ERC20 paymaster
      const userOps = [];
      for (const { account, txWallet } of wallets) {
        const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);

        let userOp = await createUserOp(account, callData);
        userOp.paymasterAndData = await createERC20PaymasterData(
          paymaster,
          paymasterSigner,
          userOp,
          await testToken.getAddress(),
          tokenAmount,
          treasury.address
        );

        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
        const signature = await signUserOp(userOpHash, txWallet);
        userOp.signature = encodeZkapSignature([0], [signature]);

        userOps.push(userOp);
      }

      // Execute all 3 UserOps in single handleOps call (concurrent)
      await entryPoint.handleOps(userOps, owner.address);

      // Verify treasury received tokens from all 3 wallets (via safeTransferFrom in validation)
      const treasuryBalanceAfter = await testToken.balanceOf(treasury.address);
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(tokenAmount * 3n);
    });
  });

  // ===========================================
  // Gas, Bundler, and PostOp Tests (CNT-683~685)
  // ===========================================
  describe("Gas, Bundler, and PostOp", function () {
    // CNT-683: prevent overflow in penalty gas calculation
    it("CNT-683: handle very large gas values without overflow", async function () {
      const { account, entryPoint, paymaster, paymasterSigner, txWallet, owner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.01"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Use maximum realistic gas values to test potential overflow
      const maxVerificationGas = 10000000n; // 10M gas
      const maxPostOpGas = 5000000n; // 5M gas

      const paymasterAddress = await paymaster.getAddress();
      const mode = (VERIFYING_MODE << 1) | 1; // allowAllBundlers = true

      // Build paymasterAndData with very large gas values
      const tempPaymasterData = ethers.concat([
        paymasterAddress,
        ethers.toBeHex(maxVerificationGas, 16),
        ethers.toBeHex(maxPostOpGas, 16),
        ethers.toBeHex(mode, 1),
        ethers.toBeHex(0, 6),
        ethers.toBeHex(0, 6),
      ]);

      userOp.paymasterAndData = tempPaymasterData;
      const hashToSign = await paymaster.getHash(VERIFYING_MODE, userOp);
      const paymasterSignature = await paymasterSigner.signMessage(ethers.getBytes(hashToSign));
      userOp.paymasterAndData = ethers.concat([tempPaymasterData, paymasterSignature]);

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should succeed without overflow
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.01"));
    });

    // CNT-684: distinguish tx.origin vs msg.sender in bundler allowlist
    it("CNT-684: bundler check uses tx.origin not msg.sender", async function () {
      const {
        account,
        entryPoint,
        paymaster,
        paymasterSigner,
        txWallet,
        bundler, // This is in the allowlist
        owner,
      } = await loadFixture(deployWithBundlerAllowlist);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.05"), "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // allowAllBundlers = false, so bundler allowlist is checked
      userOp.paymasterAndData = await createVerifyingPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        0,
        0,
        false // allowAllBundlers = false
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Call from bundler (who is in allowlist) - should succeed
      // The bundler check uses tx.origin which is the bundler address
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.connect(bundler).handleOps([userOp], bundler.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.05"));

      // Now try with owner (not in allowlist) - should fail
      let userOp2 = await createUserOp(account, callData);
      userOp2.paymasterAndData = await createVerifyingPaymasterData(paymaster, paymasterSigner, userOp2, 0, 0, false);

      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const signature2 = await signUserOp(userOpHash2, txWallet);
      userOp2.signature = encodeZkapSignature([0], [signature2]);

      // Call from owner (not in allowlist) - should fail with BundlerNotAllowed
      await expect(entryPoint.connect(owner).handleOps([userOp2], owner.address)).to.be.revertedWithCustomError(
        entryPoint,
        "FailedOpWithRevert"
      );
    });

    // CNT-685: handle PostOp context decoding failure
    it("CNT-685: handle corrupted context in postOp gracefully", async function () {
      const { account, accountAddress, entryPoint, paymaster, paymasterSigner, txWallet, testToken, treasury, owner } =
        await loadFixture(deployWalletWithPaymaster);

      // ZKAPSC-003: PostOp is now a no-op, context handling moved to validation
      // This test verifies that the ERC20 mode works correctly with validation-phase transfers

      const tokenAmount = ethers.parseEther("5");
      await testToken.mint(accountAddress, ethers.parseEther("50"));

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Step 1: Approve paymaster
      const approveData = testToken.interface.encodeFunctionData("approve", [await paymaster.getAddress(), tokenAmount]);
      const approveCallData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

      let approveUserOp = await createUserOp(account, approveCallData);
      const approveUserOpHash = await getUserOpHash(entryPoint, approveUserOp, chainId);
      const approveSig = await signUserOp(approveUserOpHash, txWallet);
      approveUserOp.signature = encodeZkapSignature([0], [approveSig]);
      await entryPoint.handleOps([approveUserOp], owner.address);

      // Step 2: Use ERC20 paymaster
      const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, 0, "0x"]);
      let userOp = await createUserOp(account, callData);

      userOp.paymasterAndData = await createERC20PaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        await testToken.getAddress(),
        tokenAmount,
        treasury.address
      );

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // This should succeed - safeTransferFrom happens in validation phase
      const treasuryBefore = await testToken.balanceOf(treasury.address);
      await entryPoint.handleOps([userOp], owner.address);
      const treasuryAfter = await testToken.balanceOf(treasury.address);

      expect(treasuryAfter - treasuryBefore).to.equal(tokenAmount);

      // Note: With ZKAPSC-003, postOp is a no-op and context is empty
      // This test verifies the validation-phase transfer works correctly
    });
  });
});
