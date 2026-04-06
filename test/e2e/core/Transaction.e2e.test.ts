/**
 * E2E Tests: Transaction
 *
 * CNT-340 ~ CNT-356: Transaction Tests
 * - Basic: ETH transfer, ERC20, ERC721, Contract calls
 * - Batch: Multiple transactions in one UserOp
 */

import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
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
} from "../../helpers/userOpHelper";

// Helper: Create test wallet
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Fixture: Deploy all contracts for transaction tests
async function deployTransactionTestContracts() {
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

  // 4. Deploy Test ERC20 Token
  const ERC20Factory = await ethers.getContractFactory("TestERC20");
  const testToken = await ERC20Factory.deploy("TestToken", "TT", ethers.parseEther("1000000"));
  await testToken.waitForDeployment();

  // 5. Deploy Test ERC721 NFT
  const ERC721Factory = await ethers.getContractFactory("TestERC721");
  const testNFT = await ERC721Factory.deploy("TestNFT", "TNFT");
  await testNFT.waitForDeployment();

  // 6. Deploy Test Counter Contract (for external calls)
  const CounterFactory = await ethers.getContractFactory("TestCounter");
  const testCounter = await CounterFactory.deploy();
  await testCounter.waitForDeployment();

  // 7. Deploy Test ERC1155 Multi-Token
  const ERC1155Factory = await ethers.getContractFactory("TestERC1155");
  const testERC1155 = await ERC1155Factory.deploy();
  await testERC1155.waitForDeployment();

  // Create test wallet
  const testWallet = createTestWallet(0);

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    testToken,
    testNFT,
    testCounter,
    testERC1155,
    owner,
    signers,
    testWallet,
  };
}

// Fixture: Deploy wallet with tokens
async function deployWalletWithTokens() {
  const base = await deployTransactionTestContracts();
  const { factory, accountKeyAddressLogic, testWallet, owner, testToken, testNFT, testERC1155, entryPoint } = base;

  // Create wallet
  const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);
  const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
  await factory.createAccount(1, encodedKey, encodedKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account with ETH
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  // Transfer ERC20 tokens to account
  await testToken.transfer(accountAddress, ethers.parseEther("1000"));

  // Mint NFT to account
  await testNFT.mint(accountAddress, 1);
  await testNFT.mint(accountAddress, 2);

  // Mint ERC1155 tokens to account
  await testERC1155.mint(accountAddress, 1, 100, "0x"); // tokenId=1, amount=100
  await testERC1155.mint(accountAddress, 2, 50, "0x"); // tokenId=2, amount=50
  await testERC1155.mint(accountAddress, 3, 25, "0x"); // tokenId=3, amount=25

  return { ...base, account, accountAddress };
}

describe("E2E: Transaction", function () {
  describe("Basic Transactions", function () {
    // CNT-340: ETH transfer transaction
    it("CNT-340: execute ETH transfer transaction", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("1.0");

      const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-341: ETH transfer with 0 amount
    it("CNT-341: execute 0 ETH transfer", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, 0, "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-342: ETH transfer of entire balance
    it("CNT-342: execute full balance ETH transfer", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, owner } = await loadFixture(deployTransactionTestContracts);

      // Create a new wallet with specific balance
      const testWallet = createTestWallet(100);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);
      const accountAddress = await factory.createAccount.staticCall(100, encodedKey, encodedKey);
      await factory.createAccount(100, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund with specific amount
      const fundAmount = ethers.parseEther("5.0");
      await owner.sendTransaction({ to: accountAddress, value: fundAmount });
      await account.addDeposit({ value: ethers.parseEther("1.0") });

      // Transfer most of the balance (leave some for gas)
      const recipient = ethers.Wallet.createRandom().address;
      const accountBalance = await ethers.provider.getBalance(accountAddress);
      const transferAmount = accountBalance - ethers.parseEther("0.1"); // Leave 0.1 ETH for potential gas

      const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-343: ERC20 token transfer
    it("CNT-343: execute ERC20 token transfer", async function () {
      const { account, entryPoint, testWallet, owner, testToken } = await loadFixture(deployWalletWithTokens);

      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("100");

      const tokenTransferData = testToken.interface.encodeFunctionData("transfer", [recipient, transferAmount]);

      const callData = account.interface.encodeFunctionData("execute", [
        await testToken.getAddress(),
        0,
        tokenTransferData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      const recipientBalance = await testToken.balanceOf(recipient);
      expect(recipientBalance).to.equal(transferAmount);
    });

    // CNT-344: ERC20 approve call
    it("CNT-344: execute ERC20 approve", async function () {
      const { account, accountAddress, entryPoint, testWallet, owner, testToken } = await loadFixture(
        deployWalletWithTokens
      );

      const spender = ethers.Wallet.createRandom().address;
      const approveAmount = ethers.parseEther("500");

      const approveData = testToken.interface.encodeFunctionData("approve", [spender, approveAmount]);

      const callData = account.interface.encodeFunctionData("execute", [await testToken.getAddress(), 0, approveData]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      const allowance = await testToken.allowance(accountAddress, spender);
      expect(allowance).to.equal(approveAmount);
    });

    // CNT-345: ERC20 transferFrom call
    it("CNT-345: execute ERC20 transferFrom", async function () {
      const { account, accountAddress, entryPoint, testWallet, owner, testToken } = await loadFixture(
        deployWalletWithTokens
      );

      // First, have owner approve the account to spend tokens
      const spendAmount = ethers.parseEther("100");
      await testToken.approve(accountAddress, spendAmount);

      const recipient = ethers.Wallet.createRandom().address;

      // Use transferFrom to move tokens from owner to recipient
      const transferFromData = testToken.interface.encodeFunctionData("transferFrom", [
        owner.address,
        recipient,
        spendAmount,
      ]);

      const callData = account.interface.encodeFunctionData("execute", [
        await testToken.getAddress(),
        0,
        transferFromData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      const recipientBalance = await testToken.balanceOf(recipient);
      expect(recipientBalance).to.equal(spendAmount);
    });

    // CNT-346: ERC721 NFT transfer
    it("CNT-346: execute ERC721 NFT transfer", async function () {
      const { account, accountAddress, entryPoint, testWallet, owner, testNFT } = await loadFixture(
        deployWalletWithTokens
      );

      const recipient = ethers.Wallet.createRandom().address;
      const tokenId = 1;

      // Verify ownership before
      expect(await testNFT.ownerOf(tokenId)).to.equal(accountAddress);

      const transferData = testNFT.interface.encodeFunctionData("transferFrom", [accountAddress, recipient, tokenId]);

      const callData = account.interface.encodeFunctionData("execute", [await testNFT.getAddress(), 0, transferData]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      expect(await testNFT.ownerOf(tokenId)).to.equal(recipient);
    });

    // CNT-347: ERC721 safeTransferFrom call
    it("CNT-347: execute ERC721 safeTransferFrom", async function () {
      const { account, accountAddress, entryPoint, testWallet, owner, testNFT } = await loadFixture(
        deployWalletWithTokens
      );

      const recipient = ethers.Wallet.createRandom().address;
      const tokenId = 2;

      expect(await testNFT.ownerOf(tokenId)).to.equal(accountAddress);

      const safeTransferData = testNFT.interface.encodeFunctionData("safeTransferFrom(address,address,uint256)", [
        accountAddress,
        recipient,
        tokenId,
      ]);

      const callData = account.interface.encodeFunctionData("execute", [
        await testNFT.getAddress(),
        0,
        safeTransferData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      expect(await testNFT.ownerOf(tokenId)).to.equal(recipient);
    });

    // CNT-348: external contract function call
    it("CNT-348: execute external contract function call", async function () {
      const { account, entryPoint, testWallet, owner, testCounter } = await loadFixture(deployWalletWithTokens);

      const incrementData = testCounter.interface.encodeFunctionData("increment");

      const callData = account.interface.encodeFunctionData("execute", [
        await testCounter.getAddress(),
        0,
        incrementData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const countBefore = await testCounter.count();
      await entryPoint.handleOps([userOp], owner.address);
      const countAfter = await testCounter.count();

      expect(countAfter - countBefore).to.equal(1n);
    });

    // CNT-349: external contract payable function call
    it("CNT-349: execute external contract payable function call", async function () {
      const { account, entryPoint, testWallet, owner, testCounter } = await loadFixture(deployWalletWithTokens);

      const depositAmount = ethers.parseEther("0.5");
      const depositData = testCounter.interface.encodeFunctionData("deposit");

      const callData = account.interface.encodeFunctionData("execute", [
        await testCounter.getAddress(),
        depositAmount,
        depositData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const counterBalanceBefore = await ethers.provider.getBalance(await testCounter.getAddress());
      await entryPoint.handleOps([userOp], owner.address);
      const counterBalanceAfter = await ethers.provider.getBalance(await testCounter.getAddress());

      expect(counterBalanceAfter - counterBalanceBefore).to.equal(depositAmount);
    });
  });

  describe("Batch Transactions", function () {
    // CNT-350: execute batch of 2 transactions
    it("CNT-350: execute batch with 2 transactions", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const recipient1 = ethers.Wallet.createRandom().address;
      const recipient2 = ethers.Wallet.createRandom().address;
      const amount1 = ethers.parseEther("0.5");
      const amount2 = ethers.parseEther("0.3");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [recipient1, recipient2],
        [amount1, amount2],
        ["0x", "0x"],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      expect(await ethers.provider.getBalance(recipient1)).to.equal(amount1);
      expect(await ethers.provider.getBalance(recipient2)).to.equal(amount2);
    });

    // CNT-351: execute batch of 5 transactions
    it("CNT-351: execute batch with 5 transactions", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const recipients = Array(5)
        .fill(null)
        .map(() => ethers.Wallet.createRandom().address);
      const amounts = recipients.map((_, i) => ethers.parseEther(`0.${i + 1}`));
      const datas = recipients.map(() => "0x");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [recipients, amounts, datas]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      for (let i = 0; i < recipients.length; i++) {
        expect(await ethers.provider.getBalance(recipients[i])).to.equal(amounts[i]);
      }
    });

    // CNT-352: execute batch of 10 transactions
    it("CNT-352: execute batch with 10 transactions", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const recipients = Array(10)
        .fill(null)
        .map(() => ethers.Wallet.createRandom().address);
      const amounts = recipients.map(() => ethers.parseEther("0.1"));
      const datas = recipients.map(() => "0x");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [recipients, amounts, datas]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      for (const recipient of recipients) {
        expect(await ethers.provider.getBalance(recipient)).to.equal(ethers.parseEther("0.1"));
      }
    });

    // CNT-353: execute mixed batch (ETH + ERC20)
    it("CNT-353: execute batch with ETH + ERC20 transfer", async function () {
      const { account, entryPoint, testWallet, owner, testToken } = await loadFixture(deployWalletWithTokens);

      const recipient1 = ethers.Wallet.createRandom().address;
      const recipient2 = ethers.Wallet.createRandom().address;
      const ethAmount = ethers.parseEther("0.5");
      const tokenAmount = ethers.parseEther("100");

      const tokenTransferData = testToken.interface.encodeFunctionData("transfer", [recipient2, tokenAmount]);

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [recipient1, await testToken.getAddress()],
        [ethAmount, 0],
        ["0x", tokenTransferData],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      expect(await ethers.provider.getBalance(recipient1)).to.equal(ethAmount);
      expect(await testToken.balanceOf(recipient2)).to.equal(tokenAmount);
    });

    // CNT-354: execute mixed batch (ETH + ERC20 + Call)
    it("CNT-354: execute batch with ETH + ERC20 + external call", async function () {
      const { account, entryPoint, testWallet, owner, testToken, testCounter } = await loadFixture(
        deployWalletWithTokens
      );

      const recipient1 = ethers.Wallet.createRandom().address;
      const recipient2 = ethers.Wallet.createRandom().address;
      const ethAmount = ethers.parseEther("0.3");
      const tokenAmount = ethers.parseEther("50");

      const tokenTransferData = testToken.interface.encodeFunctionData("transfer", [recipient2, tokenAmount]);
      const incrementData = testCounter.interface.encodeFunctionData("increment");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [recipient1, await testToken.getAddress(), await testCounter.getAddress()],
        [ethAmount, 0, 0],
        ["0x", tokenTransferData, incrementData],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const countBefore = await testCounter.count();
      await entryPoint.handleOps([userOp], owner.address);

      expect(await ethers.provider.getBalance(recipient1)).to.equal(ethAmount);
      expect(await testToken.balanceOf(recipient2)).to.equal(tokenAmount);
      expect(await testCounter.count()).to.equal(countBefore + 1n);
    });

    // CNT-355: entire batch rolls back when one item fails
    it("CNT-355: rollback entire batch when one transaction fails", async function () {
      const { account, accountAddress, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const recipient = ethers.Wallet.createRandom().address;
      const ethAmount = ethers.parseEther("0.5");

      // Create a contract call that will definitely fail
      // Call a non-existent address with value (will succeed but do nothing)
      // Then call a contract that reverts
      const RevertingContractFactory = await ethers.getContractFactory("TestCounter");
      const revertingContract = await RevertingContractFactory.deploy();

      // First set count to 0, then try to decrement (will revert)
      await revertingContract.setCount(0);

      const decrementData = revertingContract.interface.encodeFunctionData("decrement");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [recipient, await revertingContract.getAddress()],
        [ethAmount, 0],
        ["0x", decrementData], // This will revert: "cannot decrement below zero"
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Execute the UserOp
      await entryPoint.handleOps([userOp], owner.address);

      // The batch should have failed and rolled back
      // First transfer should NOT have happened (recipient should have 0 ETH)
      expect(await ethers.provider.getBalance(recipient)).to.equal(0n);
    });

    // CNT-356: execute empty batch (0 items)
    it("CNT-356: execute empty batch (0 transactions)", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [[], [], []]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });
  });

  describe("Edge Cases (Gas/Nonce)", function () {
    // CNT-433: fails when balance/deposit insufficient
    it("CNT-433: fail when insufficient balance and deposit", async function () {
      const { factory, entryPoint, accountKeyAddressLogic, owner } = await loadFixture(deployTransactionTestContracts);

      // Create a new wallet WITHOUT any ETH or deposit
      const testWallet = createTestWallet(500);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);
      const accountAddress = await factory.createAccount.staticCall(500, encodedKey, encodedKey);
      await factory.createAccount(500, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // DO NOT fund the account with any ETH!
      // DO NOT add EntryPoint deposit!

      // Try to execute a transaction
      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Should fail due to insufficient prefund (no balance, no deposit)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-434: execution fails with invalid nonce
    it("CNT-434: fail with invalid nonce", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      // Create UserOp with wrong nonce (use nonce 999 instead of 0)
      let userOp = await createUserOp(account, callData);
      userOp.nonce = 999n; // Wrong nonce!

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail due to invalid nonce
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-437: second execution fails when same nonce used twice
    it("CNT-437: fail second UserOp with same nonce (replay protection)", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const recipient1 = ethers.Wallet.createRandom().address;
      const recipient2 = ethers.Wallet.createRandom().address;

      // First UserOp with nonce 0
      const callData1 = account.interface.encodeFunctionData("execute", [recipient1, ethers.parseEther("0.1"), "0x"]);
      const userOp1 = await createSignedUserOp(account, entryPoint, callData1, testWallet, 0);

      // Execute first UserOp successfully
      await entryPoint.handleOps([userOp1], owner.address);
      expect(await ethers.provider.getBalance(recipient1)).to.equal(ethers.parseEther("0.1"));

      // Try to replay with same nonce (create new UserOp but force nonce 0)
      const callData2 = account.interface.encodeFunctionData("execute", [recipient2, ethers.parseEther("0.1"), "0x"]);
      let userOp2 = await createUserOp(account, callData2);
      userOp2.nonce = 0n; // Force same nonce as first UserOp!

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const signature2 = await signUserOp(userOpHash2, testWallet);
      userOp2.signature = encodeZkapSignature([0], [signature2]);

      // Should fail - nonce already used
      await expect(entryPoint.handleOps([userOp2], owner.address)).to.be.revertedWithCustomError(
        entryPoint,
        "FailedOp"
      );

      // recipient2 should NOT have received funds
      expect(await ethers.provider.getBalance(recipient2)).to.equal(0n);
    });
  });

  // CNT-595~596: ERC1155 Transactions
  describe("ERC1155 Transactions", function () {
    // CNT-595: execute ERC-1155 safeTransferFrom
    it("CNT-595: execute ERC-1155 safeTransferFrom", async function () {
      const { account, entryPoint, testWallet, owner, testERC1155, accountAddress } = await loadFixture(
        deployWalletWithTokens
      );

      const recipient = ethers.Wallet.createRandom().address;
      const tokenId = 1n;
      const amount = 10n;

      // Verify initial balance
      expect(await testERC1155.balanceOf(accountAddress, tokenId)).to.equal(100n);

      // Encode safeTransferFrom call
      const erc1155Interface = new ethers.Interface([
        "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)",
      ]);
      const transferCallData = erc1155Interface.encodeFunctionData("safeTransferFrom", [
        accountAddress,
        recipient,
        tokenId,
        amount,
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [
        await testERC1155.getAddress(),
        0,
        transferCallData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      // Verify transfer
      expect(await testERC1155.balanceOf(accountAddress, tokenId)).to.equal(90n);
      expect(await testERC1155.balanceOf(recipient, tokenId)).to.equal(amount);
    });

    // CNT-596: execute ERC-1155 safeBatchTransferFrom
    it("CNT-596: execute ERC-1155 safeBatchTransferFrom", async function () {
      const { account, entryPoint, testWallet, owner, testERC1155, accountAddress } = await loadFixture(
        deployWalletWithTokens
      );

      const recipient = ethers.Wallet.createRandom().address;
      const tokenIds = [1n, 2n, 3n];
      const amounts = [5n, 10n, 15n];

      // Verify initial balances
      expect(await testERC1155.balanceOf(accountAddress, 1n)).to.equal(100n);
      expect(await testERC1155.balanceOf(accountAddress, 2n)).to.equal(50n);
      expect(await testERC1155.balanceOf(accountAddress, 3n)).to.equal(25n);

      // Encode safeBatchTransferFrom call
      const erc1155Interface = new ethers.Interface([
        "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)",
      ]);
      const batchTransferCallData = erc1155Interface.encodeFunctionData("safeBatchTransferFrom", [
        accountAddress,
        recipient,
        tokenIds,
        amounts,
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [
        await testERC1155.getAddress(),
        0,
        batchTransferCallData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      // Verify batch transfer
      expect(await testERC1155.balanceOf(accountAddress, 1n)).to.equal(95n);
      expect(await testERC1155.balanceOf(accountAddress, 2n)).to.equal(40n);
      expect(await testERC1155.balanceOf(accountAddress, 3n)).to.equal(10n);

      expect(await testERC1155.balanceOf(recipient, 1n)).to.equal(5n);
      expect(await testERC1155.balanceOf(recipient, 2n)).to.equal(10n);
      expect(await testERC1155.balanceOf(recipient, 3n)).to.equal(15n);
    });
  });

  // CNT-597~598: Cross Account Operations
  describe("Cross Account Operations", function () {
    // Helper: Deploy two wallets
    async function deployTwoWallets() {
      const base = await deployTransactionTestContracts();
      const { factory, accountKeyAddressLogic, owner, entryPoint } = base;

      // Wallet A
      const walletA = createTestWallet(100);
      const encodedKeyA = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), walletA.address);
      const accountAddressA = await factory.createAccount.staticCall(100, encodedKeyA, encodedKeyA);
      await factory.createAccount(100, encodedKeyA, encodedKeyA);
      const accountA = await ethers.getContractAt("ZkapAccount", accountAddressA);

      // Wallet B
      const walletB = createTestWallet(200);
      const encodedKeyB = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), walletB.address);
      const accountAddressB = await factory.createAccount.staticCall(200, encodedKeyB, encodedKeyB);
      await factory.createAccount(200, encodedKeyB, encodedKeyB);
      const accountB = await ethers.getContractAt("ZkapAccount", accountAddressB);

      // Fund wallet A
      await owner.sendTransaction({ to: accountAddressA, value: ethers.parseEther("10.0") });
      await accountA.addDeposit({ value: ethers.parseEther("2.0") });

      return {
        ...base,
        accountA,
        accountAddressA,
        walletA,
        accountB,
        accountAddressB,
        walletB,
      };
    }

    // CNT-597: ETH transfer from wallet A to wallet B
    it("CNT-597: transfer ETH from wallet A to wallet B", async function () {
      const { accountA, accountAddressB, entryPoint, walletA, owner } = await loadFixture(deployTwoWallets);

      const transferAmount = ethers.parseEther("1.0");
      const initialBalanceB = await ethers.provider.getBalance(accountAddressB);

      // Wallet A sends ETH to Wallet B
      const callData = accountA.interface.encodeFunctionData("execute", [accountAddressB, transferAmount, "0x"]);

      const userOp = await createSignedUserOp(accountA, entryPoint, callData, walletA, 0);
      await entryPoint.handleOps([userOp], owner.address);

      // Verify wallet B received ETH
      const finalBalanceB = await ethers.provider.getBalance(accountAddressB);
      expect(finalBalanceB - initialBalanceB).to.equal(transferAmount);
    });

    // CNT-598: call addDeposit on wallet B from wallet A
    it("CNT-598: wallet A calls wallet B's addDeposit", async function () {
      const { accountA, accountB, accountAddressB, entryPoint, walletA, owner } = await loadFixture(deployTwoWallets);

      const depositAmount = ethers.parseEther("0.5");

      // Get wallet B's initial EntryPoint deposit
      const initialDeposit = await accountB.getDeposit();

      // Wallet A calls addDeposit on Wallet B (sending ETH with the call)
      const addDepositCallData = accountB.interface.encodeFunctionData("addDeposit");

      const callData = accountA.interface.encodeFunctionData("execute", [
        accountAddressB,
        depositAmount,
        addDepositCallData,
      ]);

      const userOp = await createSignedUserOp(accountA, entryPoint, callData, walletA, 0);
      await entryPoint.handleOps([userOp], owner.address);

      // Verify wallet B's EntryPoint deposit increased
      const finalDeposit = await accountB.getDeposit();
      expect(finalDeposit - initialDeposit).to.equal(depositAmount);
    });
  });

  // ===========================================
  // Paymaster Timestamp/Bundler Tests (CNT-544~546)
  // ===========================================
  describe("Paymaster Timestamp/Bundler", function () {
    // Constants
    const VERIFYING_MODE = 0;

    // Helper: Create paymaster signer
    function createPaymasterSigner() {
      return new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    }

    // Fixture: Deploy wallet with paymaster
    async function deployWalletWithPaymaster() {
      const base = await deployTransactionTestContracts();
      const { factory, accountKeyAddressLogic, testWallet, owner, signers, entryPoint } = base;

      const paymasterSigner = createPaymasterSigner();
      const bundler = signers[5];

      // Deploy ZkapPaymaster
      const ZkapPaymasterFactory = await ethers.getContractFactory("ZkapPaymaster");
      const paymaster = await ZkapPaymasterFactory.deploy(
        await entryPoint.getAddress(),
        owner.address,
        owner.address, // manager = owner
        [paymasterSigner.address]
      );
      await paymaster.waitForDeployment();

      // Fund paymaster
      await paymaster.deposit({ value: ethers.parseEther("5.0") });

      // Create wallet
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account with ETH (for non-paymaster operations)
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("1.0") });

      return { ...base, account, accountAddress, paymaster, paymasterSigner, bundler };
    }

    // Helper: Create paymasterAndData with timestamp
    async function createPaymasterData(
      paymaster: any,
      paymasterSigner: Wallet,
      userOp: any,
      validUntil: number,
      validAfter: number,
      allowAllBundlers: boolean = true
    ): Promise<string> {
      const mode = (VERIFYING_MODE << 1) | (allowAllBundlers ? 1 : 0);

      const tempPaymasterData = ethers.concat([
        await paymaster.getAddress(),
        ethers.toBeHex(100000n, 16), // validation gas
        ethers.toBeHex(50000n, 16), // postOp gas
        ethers.toBeHex(mode, 1),
        ethers.toBeHex(validUntil, 6),
        ethers.toBeHex(validAfter, 6),
      ]);

      // Set temporary paymasterAndData for hash calculation
      const userOpCopy = { ...userOp };
      userOpCopy.paymasterAndData = tempPaymasterData;

      const hashToSign = await paymaster.getHash(VERIFYING_MODE, userOpCopy);
      const signature = await paymasterSigner.signMessage(ethers.getBytes(hashToSign));

      return ethers.concat([tempPaymasterData, signature]);
    }

    // CNT-544: UserOp rejected after validUntil expiry
    it("CNT-544: reject UserOp when validUntil is expired", async function () {
      const { account, entryPoint, testWallet, owner, paymaster, paymasterSigner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.01"), "0x"]);

      let userOp = await createUserOp(account, callData);

      // Set validUntil to past (expired)
      const validUntil = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const validAfter = 0;

      userOp.paymasterAndData = await createPaymasterData(paymaster, paymasterSigner, userOp, validUntil, validAfter);

      // Sign the userOp
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail due to expired validUntil (time validation fails)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-545: UserOp rejected before validAfter
    it("CNT-545: reject UserOp when validAfter is in future", async function () {
      const { account, entryPoint, testWallet, owner, paymaster, paymasterSigner } = await loadFixture(
        deployWalletWithPaymaster
      );

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.01"), "0x"]);

      let userOp = await createUserOp(account, callData);

      // Set validAfter to future (not valid yet)
      const validUntil = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now
      const validAfter = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      userOp.paymasterAndData = await createPaymasterData(paymaster, paymasterSigner, userOp, validUntil, validAfter);

      // Sign the userOp
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail due to validAfter in future (time validation fails)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-546: reject disallowed bundler when allowAllBundlers=false
    it("CNT-546: reject UserOp when bundler is not in allowlist", async function () {
      const { account, entryPoint, testWallet, owner, paymaster, paymasterSigner, bundler } = await loadFixture(
        deployWalletWithPaymaster
      );

      // Add bundler to allowlist
      await paymaster.updateBundlerAllowlist([bundler.address], true);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.01"), "0x"]);

      let userOp = await createUserOp(account, callData);

      // Set allowAllBundlers=false
      const validUntil = Math.floor(Date.now() / 1000) + 3600;
      const validAfter = 0;

      userOp.paymasterAndData = await createPaymasterData(
        paymaster,
        paymasterSigner,
        userOp,
        validUntil,
        validAfter,
        false // allowAllBundlers=false
      );

      // Sign the userOp
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Submit from owner (not in bundler allowlist) - should fail
      // EntryPoint wraps the paymaster error as FailedOpWithRevert
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(
        entryPoint,
        "FailedOpWithRevert"
      );

      // Submit from allowed bundler - should succeed
      await entryPoint.connect(bundler).handleOps([userOp], bundler.address);
    });
  });

  // ===========================================
  // Deposit Flow Tests (CNT-553~554)
  // ===========================================
  describe("Deposit Flow", function () {
    // CNT-553: full deposit and withdrawal flow
    it("CNT-553: complete deposit and withdraw flow", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const accountAddress = await account.getAddress();
      const depositAmount = ethers.parseEther("1.0");
      const withdrawAmount = ethers.parseEther("0.5");
      const withdrawRecipient = ethers.Wallet.createRandom().address;

      // Step 1: Check initial deposit
      const initialDeposit = await account.getDeposit();

      // Step 2: Add deposit via UserOp
      const addDepositCallData = account.interface.encodeFunctionData("addDeposit");
      const depositCallData = account.interface.encodeFunctionData("execute", [
        accountAddress,
        depositAmount,
        addDepositCallData,
      ]);

      const depositUserOp = await createSignedUserOp(account, entryPoint, depositCallData, testWallet, 0);
      await entryPoint.handleOps([depositUserOp], owner.address);

      // Step 3: Verify deposit increased (some gas is consumed from deposit)
      const afterDepositBalance = await account.getDeposit();
      // Deposit increases by depositAmount minus gas used for the UserOp
      expect(afterDepositBalance).to.be.greaterThan(initialDeposit);

      // Step 4: Withdraw deposit via UserOp
      const withdrawCallData = account.interface.encodeFunctionData("withdrawDepositTo", [
        withdrawRecipient,
        withdrawAmount,
      ]);
      const withdrawUserOpCallData = account.interface.encodeFunctionData("execute", [
        accountAddress,
        0,
        withdrawCallData,
      ]);

      const withdrawUserOp = await createSignedUserOp(account, entryPoint, withdrawUserOpCallData, testWallet, 0);
      const recipientBalanceBefore = await ethers.provider.getBalance(withdrawRecipient);
      await entryPoint.handleOps([withdrawUserOp], owner.address);

      // Step 5: Verify withdrawal
      const finalDeposit = await account.getDeposit();
      const recipientBalanceAfter = await ethers.provider.getBalance(withdrawRecipient);

      // Deposit decreased (withdraw amount + gas for withdraw UserOp)
      expect(finalDeposit).to.be.lessThan(afterDepositBalance);
      // Recipient received exactly the withdraw amount
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(withdrawAmount);
    });

    // CNT-554: withdrawal attempt by non-owner fails
    it("CNT-554: fail unauthorized withdraw attempt", async function () {
      const { account, entryPoint, owner, signers } = await loadFixture(deployWalletWithTokens);

      const accountAddress = await account.getAddress();
      const withdrawAmount = ethers.parseEther("0.1");
      const withdrawRecipient = ethers.Wallet.createRandom().address;

      // Try to call withdrawDepositTo directly from a non-owner
      // This should fail because only the account itself can call this
      const nonOwner = signers[5];

      await expect(account.connect(nonOwner).withdrawDepositTo(withdrawRecipient, withdrawAmount)).to.be.reverted; // Should revert with onlyOwner or similar
    });
  });

  // ===========================================
  // Mixed Key Types Tests (CNT-555)
  // ===========================================
  describe("Mixed Key Types", function () {
    // Fixture: Deploy wallet with Address + WebAuthn keys
    async function deployMixedKeyWallet() {
      const base = await deployTransactionTestContracts();
      const { factory, accountKeyAddressLogic, owner, entryPoint } = base;

      // Deploy AccountKeyWebAuthn Logic (no library linking needed)
      const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
      const accountKeyWebAuthnLogic = await AccountKeyWebAuthnFactory.deploy();

      // Create Address key wallet
      const addressWallet = createTestWallet(200);

      // Generate WebAuthn key pair
      const webAuthnKeyPair = generateWebAuthnKeyPair();

      // Create Address key
      const addressKey = encodeAddressKey(
        addressWallet.address,
        await accountKeyAddressLogic.getAddress(),
        1 // weight=1
      );

      // Create WebAuthn key
      const webAuthnKey = encodeWebAuthnKey(
        webAuthnKeyPair.publicKey.x,
        webAuthnKeyPair.publicKey.y,
        webAuthnKeyPair.credentialId,
        webAuthnKeyPair.rpIdHash,
        webAuthnKeyPair.origin,
        await accountKeyWebAuthnLogic.getAddress(),
        1 // weight=1
      );

      // Encode as 2-of-2 multisig (threshold=2, total weight=2)
      const encodedKey = encodePrimitiveKeys(2, [addressKey, webAuthnKey]);

      // Create account
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      // Fund the account
      await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      return {
        ...base,
        account,
        accountAddress,
        addressWallet,
        webAuthnKeyPair,
        accountKeyWebAuthnLogic,
      };
    }

    // CNT-555: Address + WebAuthn mixed multisig key
    it("CNT-555: execute with mixed Address + WebAuthn multisig", async function () {
      const { account, entryPoint, addressWallet, webAuthnKeyPair, owner } = await loadFixture(deployMixedKeyWallet);

      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.5");

      const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      let userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with Address key (index 0)
      const addressSig = await signUserOp(userOpHash, addressWallet);

      // Sign with WebAuthn key (index 1)
      const webAuthnSig = signUserOpWebAuthn(userOpHash, webAuthnKeyPair);

      // Encode multisig signature (both keys)
      userOp.signature = encodeZkapSignature([0, 1], [addressSig, webAuthnSig]);

      // Execute
      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });
  });

  // ===========================================
  // SelfCall Tests (CNT-612~614)
  // ===========================================
  describe("SelfCall", function () {
    // CNT-612: call own addDeposit via execute
    it("CNT-612: call own addDeposit via execute", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const accountAddress = await account.getAddress();
      const depositAmount = ethers.parseEther("0.5");

      // Get initial deposit in EntryPoint
      const depositBefore = await account.getDeposit();

      // Create calldata: execute(address(this), value, addDeposit.selector)
      const addDepositData = account.interface.encodeFunctionData("addDeposit");
      const callData = account.interface.encodeFunctionData("execute", [accountAddress, depositAmount, addDepositData]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      // Verify EntryPoint deposit increased
      const depositAfter = await account.getDeposit();
      // Note: deposit increases by depositAmount minus gas consumed
      expect(depositAfter).to.be.greaterThan(depositBefore);
    });

    // CNT-613: mixed self and external calls in executeBatch
    it("CNT-613: executeBatch with mixed self and external calls", async function () {
      const { account, entryPoint, testWallet, owner, testCounter } = await loadFixture(deployWalletWithTokens);

      const accountAddress = await account.getAddress();
      const depositAmount = ethers.parseEther("0.3");
      const externalRecipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.2");

      // Get initial states
      const depositBefore = await account.getDeposit();
      const counterBefore = await testCounter.count();

      // Create batch calldata:
      // 1. Self call: addDeposit (with ETH value)
      // 2. External call: transfer ETH
      // 3. External call: increment counter
      const addDepositData = account.interface.encodeFunctionData("addDeposit");
      const incrementData = testCounter.interface.encodeFunctionData("increment");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [accountAddress, externalRecipient, await testCounter.getAddress()],
        [depositAmount, transferAmount, 0],
        [addDepositData, "0x", incrementData],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const recipientBalanceBefore = await ethers.provider.getBalance(externalRecipient);
      await entryPoint.handleOps([userOp], owner.address);
      const recipientBalanceAfter = await ethers.provider.getBalance(externalRecipient);

      // Verify all calls succeeded
      // 1. Deposit increased (minus gas)
      const depositAfter = await account.getDeposit();
      expect(depositAfter).to.be.greaterThan(depositBefore);

      // 2. External transfer succeeded
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(transferAmount);

      // 3. Counter incremented
      const counterAfter = await testCounter.count();
      expect(counterAfter - counterBefore).to.equal(1n);
    });

    // CNT-614: call own withdrawDepositTo via execute
    it("CNT-614: call own withdrawDepositTo via execute", async function () {
      const { account, entryPoint, testWallet, owner } = await loadFixture(deployWalletWithTokens);

      const accountAddress = await account.getAddress();
      const withdrawRecipient = ethers.Wallet.createRandom().address;
      const withdrawAmount = ethers.parseEther("0.3");

      // First add deposit
      const depositAmount = ethers.parseEther("1.0");
      const addDepositData = account.interface.encodeFunctionData("addDeposit");
      const addDepositCallData = account.interface.encodeFunctionData("execute", [
        accountAddress,
        depositAmount,
        addDepositData,
      ]);

      const addUserOp = await createSignedUserOp(account, entryPoint, addDepositCallData, testWallet, 0);
      await entryPoint.handleOps([addUserOp], owner.address);

      const depositAfterAdd = await account.getDeposit();

      // Now withdraw via execute
      const withdrawData = account.interface.encodeFunctionData("withdrawDepositTo", [
        withdrawRecipient,
        withdrawAmount,
      ]);
      const withdrawCallData = account.interface.encodeFunctionData("execute", [accountAddress, 0, withdrawData]);

      const withdrawUserOp = await createSignedUserOp(account, entryPoint, withdrawCallData, testWallet, 0);

      const recipientBalanceBefore = await ethers.provider.getBalance(withdrawRecipient);
      await entryPoint.handleOps([withdrawUserOp], owner.address);
      const recipientBalanceAfter = await ethers.provider.getBalance(withdrawRecipient);

      // Verify withdrawal succeeded
      const depositAfterWithdraw = await account.getDeposit();
      expect(depositAfterWithdraw).to.be.lessThan(depositAfterAdd);
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(withdrawAmount);
    });
  });
});
