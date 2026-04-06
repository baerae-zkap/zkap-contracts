/**
 * E2E Tests: Concurrent Operations and Wallet Deployment
 *
 * CNT-424 ~ CNT-429, CNT-526~527: Concurrent Operations and Wallet Deployment Tests
 * - Concurrent UserOp submissions with different/same nonce
 * - Fast sequential transactions
 * - Wallet deployment scenarios (counterfactual, first tx deploy, duplicate deploy)
 */

import { loadFixture, mine } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { encodeAddressKey, encodePrimitiveKeys } from "../../helpers/accountKeyHelper";
import {
  createUserOp,
  getUserOpHash,
  signUserOp,
  encodeZkapSignature,
  createSignedUserOp,
} from "../../helpers/userOpHelper";

// Helper: Create test wallet
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Fixture: Deploy contracts for concurrent and deploy tests
async function deployConcurrentTestContracts() {
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
  const testWallet1 = createTestWallet(100);
  const testWallet2 = createTestWallet(200);

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    owner,
    signers,
    testWallet1,
    testWallet2,
  };
}

// Fixture: Deploy wallet for concurrent operations
async function deployWalletForConcurrent() {
  const base = await deployConcurrentTestContracts();
  const { factory, entryPoint, accountKeyAddressLogic, owner, testWallet1 } = base;

  // Create 1-of-1 wallet
  const key = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedKey = encodePrimitiveKeys(1, [key]);

  const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
  await factory.createAccount(1, encodedKey, encodedKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return { ...base, account, accountAddress, encodedKey };
}

describe("E2E: Concurrent Operations", function () {
  // CNT-424: submit two UserOps concurrently with different nonces
  it("CNT-424: submit two UserOps with different nonces in same handleOps", async function () {
    const { account, entryPoint, owner, testWallet1 } = await loadFixture(deployWalletForConcurrent);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const recipient1 = ethers.Wallet.createRandom().address;
    const recipient2 = ethers.Wallet.createRandom().address;

    // Create two UserOps with different nonces
    const callData1 = account.interface.encodeFunctionData("execute", [recipient1, ethers.parseEther("0.1"), "0x"]);
    const callData2 = account.interface.encodeFunctionData("execute", [recipient2, ethers.parseEther("0.2"), "0x"]);

    const nonce = await account.getNonce();

    // UserOp 1 with nonce
    const userOp1 = await createUserOp(account, callData1);
    userOp1.nonce = nonce;
    const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
    const sig1 = await signUserOp(userOpHash1, testWallet1);
    userOp1.signature = encodeZkapSignature([0], [sig1]);

    // UserOp 2 with nonce + 1
    const userOp2 = await createUserOp(account, callData2);
    userOp2.nonce = nonce + 1n;
    const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
    const sig2 = await signUserOp(userOpHash2, testWallet1);
    userOp2.signature = encodeZkapSignature([0], [sig2]);

    const balance1Before = await ethers.provider.getBalance(recipient1);
    const balance2Before = await ethers.provider.getBalance(recipient2);

    // Submit both UserOps in the same handleOps call
    const tx = await entryPoint.handleOps([userOp1, userOp2], owner.address);
    expect((await tx.wait())?.status).to.equal(1);

    const balance1After = await ethers.provider.getBalance(recipient1);
    const balance2After = await ethers.provider.getBalance(recipient2);

    expect(balance1After - balance1Before).to.equal(ethers.parseEther("0.1"));
    expect(balance2After - balance2Before).to.equal(ethers.parseEther("0.2"));
  });

  // CNT-425: submit two UserOps concurrently with same nonce collision
  it("CNT-425: submit two UserOps with same nonce causes failure", async function () {
    const { account, entryPoint, owner, testWallet1 } = await loadFixture(deployWalletForConcurrent);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const recipient1 = ethers.Wallet.createRandom().address;
    const recipient2 = ethers.Wallet.createRandom().address;

    const callData1 = account.interface.encodeFunctionData("execute", [recipient1, ethers.parseEther("0.1"), "0x"]);
    const callData2 = account.interface.encodeFunctionData("execute", [recipient2, ethers.parseEther("0.2"), "0x"]);

    const nonce = await account.getNonce();

    // Both UserOps with same nonce
    const userOp1 = await createUserOp(account, callData1);
    userOp1.nonce = nonce;
    const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
    const sig1 = await signUserOp(userOpHash1, testWallet1);
    userOp1.signature = encodeZkapSignature([0], [sig1]);

    const userOp2 = await createUserOp(account, callData2);
    userOp2.nonce = nonce; // Same nonce!
    const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
    const sig2 = await signUserOp(userOpHash2, testWallet1);
    userOp2.signature = encodeZkapSignature([0], [sig2]);

    // Second UserOp should fail due to nonce conflict
    await expect(entryPoint.handleOps([userOp1, userOp2], owner.address)).to.be.revertedWithCustomError(
      entryPoint,
      "FailedOp"
    );
  });

  // CNT-426: fast sequential transactions with incrementing nonces
  it("CNT-426: fast sequential transactions with incrementing nonces", async function () {
    const { account, entryPoint, owner, testWallet1 } = await loadFixture(deployWalletForConcurrent);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const recipients: string[] = [];
    const userOps: any[] = [];

    // Create 5 UserOps with incrementing nonces
    const baseNonce = await account.getNonce();
    for (let i = 0; i < 5; i++) {
      const recipient = ethers.Wallet.createRandom().address;
      recipients.push(recipient);

      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      userOp.nonce = baseNonce + BigInt(i);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const sig = await signUserOp(userOpHash, testWallet1);
      userOp.signature = encodeZkapSignature([0], [sig]);
      userOps.push(userOp);
    }

    // Record balances before
    const balancesBefore = await Promise.all(recipients.map((r) => ethers.provider.getBalance(r)));

    // Submit all 5 UserOps at once
    const tx = await entryPoint.handleOps(userOps, owner.address);
    expect((await tx.wait())?.status).to.equal(1);

    // Verify all transfers succeeded
    const balancesAfter = await Promise.all(recipients.map((r) => ethers.provider.getBalance(r)));

    for (let i = 0; i < 5; i++) {
      expect(balancesAfter[i] - balancesBefore[i]).to.equal(ethers.parseEther("0.1"));
    }
  });
});

describe("E2E: Wallet Deployment", function () {
  // CNT-427: calculate address without deploying wallet, then send ETH
  it("CNT-427: send ETH to counterfactual wallet address before deployment", async function () {
    const { factory, accountKeyAddressLogic, owner, testWallet1 } = await loadFixture(deployConcurrentTestContracts);

    // Create encoded key
    const key = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
    const encodedKey = encodePrimitiveKeys(1, [key]);

    // Calculate counterfactual address without deploying
    const accountAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);

    // Verify wallet is not deployed yet
    const codeBefore = await ethers.provider.getCode(accountAddress);
    expect(codeBefore).to.equal("0x");

    // Send ETH to the counterfactual address
    const sendAmount = ethers.parseEther("1.0");
    await owner.sendTransaction({ to: accountAddress, value: sendAmount });

    // Verify ETH was received
    const balance = await ethers.provider.getBalance(accountAddress);
    expect(balance).to.equal(sendAmount);

    // Wallet still not deployed
    const codeAfter = await ethers.provider.getCode(accountAddress);
    expect(codeAfter).to.equal("0x");
  });

  // CNT-428: deploy wallet and execute on first transaction
  it("CNT-428: deploy wallet and execute in first transaction", async function () {
    const { factory, entryPoint, accountKeyAddressLogic, owner, testWallet1 } = await loadFixture(
      deployConcurrentTestContracts
    );

    // Create encoded key
    const key = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
    const encodedKey = encodePrimitiveKeys(1, [key]);

    // Calculate counterfactual address
    const accountAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);

    // Pre-fund the counterfactual address
    await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });

    // Verify wallet is not deployed yet
    const codeBefore = await ethers.provider.getCode(accountAddress);
    expect(codeBefore).to.equal("0x");

    // Create initCode for factory.createAccount
    const initCode = ethers.concat([
      await factory.getAddress(),
      factory.interface.encodeFunctionData("createAccount", [1, encodedKey, encodedKey]),
    ]);

    // Create callData for execute
    const recipient = ethers.Wallet.createRandom().address;
    const account = await ethers.getContractAt("ZkapAccount", accountAddress);
    const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.5"), "0x"]);

    // Create UserOp with initCode and callData - increase gas limits for deployment
    const userOp = {
      sender: accountAddress,
      nonce: 0n,
      initCode: initCode,
      callData: callData,
      accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [2000000n, 500000n]),
      preVerificationGas: 200000n,
      gasFees: ethers.solidityPacked(["uint128", "uint128"], [1n, 1n]),
      paymasterAndData: "0x",
      signature: "0x",
    };

    // Sign the UserOp
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
    const sig = await signUserOp(userOpHash, testWallet1);
    userOp.signature = encodeZkapSignature([0], [sig]);

    // Add deposit to EntryPoint for the account
    await entryPoint.depositTo(accountAddress, { value: ethers.parseEther("2.0") });

    const balanceBefore = await ethers.provider.getBalance(recipient);

    // Execute - this should deploy the wallet and execute the transfer
    const tx = await entryPoint.handleOps([userOp], owner.address);
    expect((await tx.wait())?.status).to.equal(1);

    // Verify wallet is now deployed
    const codeAfter = await ethers.provider.getCode(accountAddress);
    expect(codeAfter).to.not.equal("0x");

    // Verify transfer happened
    const balanceAfter = await ethers.provider.getBalance(recipient);
    expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.5"));
  });

  // CNT-429: attempt duplicate deployment to already-deployed wallet
  it("CNT-429: duplicate deployment attempt with same parameters reverts", async function () {
    const { factory, accountKeyAddressLogic, testWallet1 } = await loadFixture(deployConcurrentTestContracts);

    // Create encoded key
    const key = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
    const encodedKey = encodePrimitiveKeys(1, [key]);

    // Deploy wallet first time
    const accountAddress1 = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
    await factory.createAccount(1, encodedKey, encodedKey);

    // Verify wallet is deployed
    const code = await ethers.provider.getCode(accountAddress1);
    expect(code).to.not.equal("0x");

    // calcAccountAddress should return the same address
    const calculatedAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);
    expect(calculatedAddress).to.equal(accountAddress1);

    // Trying to deploy again with same salt should revert (Create2 cannot deploy to same address)
    await expect(factory.createAccount(1, encodedKey, encodedKey)).to.be.reverted;
  });

  // CNT-526: deploy wallet and run executeBatch concurrently (token operations)
  it("CNT-526: deploy wallet and execute batch with token operations", async function () {
    const { factory, entryPoint, accountKeyAddressLogic, owner, testWallet1 } = await loadFixture(
      deployConcurrentTestContracts
    );

    // Deploy test token
    const ERC20Factory = await ethers.getContractFactory("TestERC20");
    const testToken = await ERC20Factory.deploy("TestToken", "TT", ethers.parseEther("1000000"));
    await testToken.waitForDeployment();

    // Create encoded key
    const key = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
    const encodedKey = encodePrimitiveKeys(1, [key]);

    // Calculate counterfactual address
    const accountAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);

    // Pre-fund the counterfactual address with ETH and tokens
    await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("5.0") });
    await testToken.transfer(accountAddress, ethers.parseEther("1000"));

    // Create initCode
    const initCode = ethers.concat([
      await factory.getAddress(),
      factory.interface.encodeFunctionData("createAccount", [1, encodedKey, encodedKey]),
    ]);

    // Create batch callData: approve + transfer
    const spender = ethers.Wallet.createRandom().address;
    const recipient = ethers.Wallet.createRandom().address;
    const approveAmount = ethers.parseEther("500");
    const transferAmount = ethers.parseEther("100");

    const approveData = testToken.interface.encodeFunctionData("approve", [spender, approveAmount]);
    const transferData = testToken.interface.encodeFunctionData("transfer", [recipient, transferAmount]);

    const account = await ethers.getContractAt("ZkapAccount", accountAddress);
    const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
      [await testToken.getAddress(), await testToken.getAddress()],
      [0n, 0n],
      [approveData, transferData],
    ]);

    // Create UserOp with initCode and callData
    const userOp = {
      sender: accountAddress,
      nonce: 0n,
      initCode: initCode,
      callData: callData,
      accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [2000000n, 500000n]),
      preVerificationGas: 200000n,
      gasFees: ethers.solidityPacked(["uint128", "uint128"], [1n, 1n]),
      paymasterAndData: "0x",
      signature: "0x",
    };

    // Sign the UserOp
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
    const sig = await signUserOp(userOpHash, testWallet1);
    userOp.signature = encodeZkapSignature([0], [sig]);

    // Add deposit to EntryPoint
    await entryPoint.depositTo(accountAddress, { value: ethers.parseEther("2.0") });

    // Execute
    const tx = await entryPoint.handleOps([userOp], owner.address);
    expect((await tx.wait())?.status).to.equal(1);

    // Verify wallet is deployed
    expect(await ethers.provider.getCode(accountAddress)).to.not.equal("0x");

    // Verify token approve worked
    expect(await testToken.allowance(accountAddress, spender)).to.equal(approveAmount);

    // Verify token transfer worked
    expect(await testToken.balanceOf(recipient)).to.equal(transferAmount);
  });

  // CNT-527: deploy wallet and run executeBatch concurrently (ETH + token mixed)
  it("CNT-527: deploy wallet and execute batch with ETH + token mixed", async function () {
    const { factory, entryPoint, accountKeyAddressLogic, owner, testWallet1 } = await loadFixture(
      deployConcurrentTestContracts
    );

    // Deploy test token
    const ERC20Factory = await ethers.getContractFactory("TestERC20");
    const testToken = await ERC20Factory.deploy("TestToken", "TT", ethers.parseEther("1000000"));
    await testToken.waitForDeployment();

    // Create encoded key
    const key = encodeAddressKey(testWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
    const encodedKey = encodePrimitiveKeys(1, [key]);

    // Calculate counterfactual address
    const accountAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);

    // Pre-fund the counterfactual address with ETH and tokens
    await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
    await testToken.transfer(accountAddress, ethers.parseEther("1000"));

    // Create initCode
    const initCode = ethers.concat([
      await factory.getAddress(),
      factory.interface.encodeFunctionData("createAccount", [1, encodedKey, encodedKey]),
    ]);

    // Create batch callData: token approve + token transfer + ETH transfer
    const spender = ethers.Wallet.createRandom().address;
    const tokenRecipient = ethers.Wallet.createRandom().address;
    const ethRecipient = ethers.Wallet.createRandom().address;
    const approveAmount = ethers.parseEther("500");
    const tokenTransferAmount = ethers.parseEther("100");
    const ethTransferAmount = ethers.parseEther("1.0");

    const approveData = testToken.interface.encodeFunctionData("approve", [spender, approveAmount]);
    const transferData = testToken.interface.encodeFunctionData("transfer", [tokenRecipient, tokenTransferAmount]);

    const account = await ethers.getContractAt("ZkapAccount", accountAddress);
    const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
      [await testToken.getAddress(), await testToken.getAddress(), ethRecipient],
      [0n, 0n, ethTransferAmount],
      [approveData, transferData, "0x"],
    ]);

    // Create UserOp with initCode and callData
    const userOp = {
      sender: accountAddress,
      nonce: 0n,
      initCode: initCode,
      callData: callData,
      accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [2000000n, 500000n]),
      preVerificationGas: 200000n,
      gasFees: ethers.solidityPacked(["uint128", "uint128"], [1n, 1n]),
      paymasterAndData: "0x",
      signature: "0x",
    };

    // Sign the UserOp
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
    const sig = await signUserOp(userOpHash, testWallet1);
    userOp.signature = encodeZkapSignature([0], [sig]);

    // Add deposit to EntryPoint
    await entryPoint.depositTo(accountAddress, { value: ethers.parseEther("2.0") });

    const ethBalanceBefore = await ethers.provider.getBalance(ethRecipient);

    // Execute
    const tx = await entryPoint.handleOps([userOp], owner.address);
    expect((await tx.wait())?.status).to.equal(1);

    // Verify wallet is deployed
    expect(await ethers.provider.getCode(accountAddress)).to.not.equal("0x");

    // Verify token approve worked
    expect(await testToken.allowance(accountAddress, spender)).to.equal(approveAmount);

    // Verify token transfer worked
    expect(await testToken.balanceOf(tokenRecipient)).to.equal(tokenTransferAmount);

    // Verify ETH transfer worked
    const ethBalanceAfter = await ethers.provider.getBalance(ethRecipient);
    expect(ethBalanceAfter - ethBalanceBefore).to.equal(ethTransferAmount);
  });
});
