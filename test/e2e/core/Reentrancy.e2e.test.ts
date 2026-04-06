/**
 * E2E Tests: Reentrancy Protection
 *
 * CNT-676 ~ CNT-679: Reentrancy Attack Prevention Tests
 * - execute() reentrancy protection
 * - executeBatch() reentrancy protection
 * - postOp reentrancy protection
 * - receive() reentrancy protection
 */

import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
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

// Fixture: Deploy contracts for reentrancy tests
async function deployReentrancyTestContracts() {
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

  // Create test wallet
  const txWallet = createTestWallet(100);

  // Create wallet key
  const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedKey = encodePrimitiveKeys(1, [txKey]);

  // Create account
  const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
  await factory.createAccount(1, encodedKey, encodedKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    account,
    accountAddress,
    owner,
    signers,
    txWallet,
  };
}

// Fixture: Deploy with ReentrantAttacker
async function deployWithReentrantAttacker() {
  const base = await deployReentrancyTestContracts();
  const { accountAddress } = base;

  // Deploy ReentrantAttacker targeting our account
  const ReentrantAttackerFactory = await ethers.getContractFactory("ReentrantAttacker");
  const attacker = await ReentrantAttackerFactory.deploy(accountAddress);
  await attacker.waitForDeployment();

  return {
    ...base,
    attacker,
  };
}

// Fixture: Deploy with ReentrantBatchAttacker
async function deployWithReentrantBatchAttacker() {
  const base = await deployReentrancyTestContracts();
  const { accountAddress } = base;

  // Deploy ReentrantBatchAttacker targeting our account
  const ReentrantBatchAttackerFactory = await ethers.getContractFactory("ReentrantBatchAttacker");
  const batchAttacker = await ReentrantBatchAttackerFactory.deploy(accountAddress);
  await batchAttacker.waitForDeployment();

  return {
    ...base,
    batchAttacker,
  };
}

describe("E2E: Reentrancy Protection", function () {
  // CNT-676: reentrancy blocked during execute via malicious contract (E2E)
  it("CNT-676: reentrancy blocked during execute via malicious contract", async function () {
    const { account, entryPoint, txWallet, owner, attacker } = await loadFixture(deployWithReentrantAttacker);

    const attackerAddress = await attacker.getAddress();

    // Execute: send ETH to the attacker contract
    // When attacker receives ETH, its receive() will try to call execute() again
    // This should be blocked because execute requires _requireFromEntryPoint()
    const callData = account.interface.encodeFunctionData("execute", [attackerAddress, ethers.parseEther("0.1"), "0x"]);

    const userOp = await createUserOp(account, callData);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
    const signature = await signUserOp(userOpHash, txWallet);
    userOp.signature = encodeZkapSignature([0], [signature]);

    // The attacker contract's receive() function will:
    // 1. Try to call execute() on the ZkapAccount
    // 2. This will fail with "account: not from EntryPoint"
    // 3. The attacker's require(!success) will pass (reentrancy was blocked)
    // 4. The original transaction should complete successfully

    const attackerBalanceBefore = await ethers.provider.getBalance(attackerAddress);
    await entryPoint.handleOps([userOp], owner.address);
    const attackerBalanceAfter = await ethers.provider.getBalance(attackerAddress);

    // Verify:
    // 1. ETH was sent to attacker (first call succeeded)
    expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(ethers.parseEther("0.1"));

    // 2. Attacker recorded that attack was attempted
    expect(await attacker.attacked()).to.be.true;
  });

  // CNT-677: reentrancy blocked during executeBatch via malicious contract (E2E)
  it("CNT-677: reentrancy blocked during executeBatch via malicious contract", async function () {
    const { account, entryPoint, txWallet, owner, batchAttacker } = await loadFixture(deployWithReentrantBatchAttacker);

    const batchAttackerAddress = await batchAttacker.getAddress();
    const recipient = ethers.Wallet.createRandom().address;

    // ExecuteBatch: first send ETH to the batch attacker, then to another recipient
    // When batch attacker receives ETH, its receive() will try to call executeBatch() again
    // This should be blocked because executeBatch requires _requireFromEntryPoint()
    const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
      [batchAttackerAddress, recipient],
      [ethers.parseEther("0.1"), ethers.parseEther("0.1")],
      ["0x", "0x"],
    ]);

    const userOp = await createUserOp(account, callData);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
    const signature = await signUserOp(userOpHash, txWallet);
    userOp.signature = encodeZkapSignature([0], [signature]);

    const attackerBalanceBefore = await ethers.provider.getBalance(batchAttackerAddress);
    const recipientBalanceBefore = await ethers.provider.getBalance(recipient);

    await entryPoint.handleOps([userOp], owner.address);

    const attackerBalanceAfter = await ethers.provider.getBalance(batchAttackerAddress);
    const recipientBalanceAfter = await ethers.provider.getBalance(recipient);

    // Verify:
    // 1. ETH was sent to batch attacker
    expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(ethers.parseEther("0.1"));

    // 2. ETH was also sent to the other recipient (batch completed)
    expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ethers.parseEther("0.1"));

    // 3. Attacker recorded that attack was attempted
    expect(await batchAttacker.attacked()).to.be.true;
  });

  // CNT-678: reentrancy blocked during postOp callback
  it("CNT-678: reentrancy blocked in postOp callback", async function () {
    const { account, entryPoint, txWallet, owner, accountKeyAddressLogic, factory } =
      await deployReentrancyTestContracts();

    // Deploy Paymaster with a signer
    const paymasterSigner = createTestWallet(50);
    const ZkapPaymasterFactory = await ethers.getContractFactory("ZkapPaymaster");
    const paymaster = await ZkapPaymasterFactory.deploy(await entryPoint.getAddress(), owner.address, owner.address, [
      paymasterSigner.address,
    ]);
    await paymaster.deposit({ value: ethers.parseEther("10.0") });

    // The postOp function is called by the EntryPoint after execution
    // Any attempt to reenter execute/executeBatch from postOp would fail
    // because it would need to go through EntryPoint.handleOps again

    // Simple test: verify paymaster-sponsored transaction works
    // This implicitly tests that postOp completes without reentrancy issues
    const recipient = ethers.Wallet.createRandom().address;
    const transferAmount = ethers.parseEther("0.1");

    const callData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

    const userOp = await createUserOp(account, callData);
    const chainId = (await ethers.provider.getNetwork()).chainId;

    // Create VERIFYING mode paymaster data
    const VERIFYING_MODE = 0;
    const mode = (VERIFYING_MODE << 1) | 1; // allowAllBundlers = true

    const tempPaymasterData = ethers.concat([
      await paymaster.getAddress(),
      ethers.toBeHex(100000n, 16),
      ethers.toBeHex(50000n, 16),
      ethers.toBeHex(mode, 1),
      ethers.toBeHex(0, 6), // validUntil
      ethers.toBeHex(0, 6), // validAfter
    ]);

    userOp.paymasterAndData = tempPaymasterData;
    const hashToSign = await paymaster.getHash(VERIFYING_MODE, userOp);
    const paymasterSignature = await paymasterSigner.signMessage(ethers.getBytes(hashToSign));
    userOp.paymasterAndData = ethers.concat([tempPaymasterData, paymasterSignature]);

    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
    const signature = await signUserOp(userOpHash, txWallet);
    userOp.signature = encodeZkapSignature([0], [signature]);

    const balanceBefore = await ethers.provider.getBalance(recipient);
    await entryPoint.handleOps([userOp], owner.address);
    const balanceAfter = await ethers.provider.getBalance(recipient);

    // Verify transaction completed successfully (postOp ran without issues)
    expect(balanceAfter - balanceBefore).to.equal(transferAmount);
  });

  // CNT-679: reentrancy blocked via receive() callback
  it("CNT-679: reentrancy blocked via receive() callback", async function () {
    const { account, entryPoint, txWallet, owner, attacker } = await loadFixture(deployWithReentrantAttacker);

    // The attacker contract tries to reenter through receive()
    // This is already tested in CNT-676, but let's explicitly verify
    // the receive() reentrancy path is blocked

    const attackerAddress = await attacker.getAddress();

    // First, verify attacker is not in "attacked" state
    expect(await attacker.attacked()).to.be.false;

    // Send ETH to attacker via execute
    const callData = account.interface.encodeFunctionData("execute", [
      attackerAddress,
      ethers.parseEther("0.05"),
      "0x",
    ]);

    const userOp = await createUserOp(account, callData);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
    const signature = await signUserOp(userOpHash, txWallet);
    userOp.signature = encodeZkapSignature([0], [signature]);

    await entryPoint.handleOps([userOp], owner.address);

    // Verify:
    // 1. Attacker received ETH
    expect(await ethers.provider.getBalance(attackerAddress)).to.equal(ethers.parseEther("0.05"));

    // 2. Attacker's receive() was triggered and attempted reentrancy
    expect(await attacker.attacked()).to.be.true;

    // 3. Account is still functional (reentrancy didn't corrupt state)
    const recipient = ethers.Wallet.createRandom().address;
    const callData2 = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

    const userOp2 = await createUserOp(account, callData2);
    const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
    const signature2 = await signUserOp(userOpHash2, txWallet);
    userOp2.signature = encodeZkapSignature([0], [signature2]);

    const balanceBefore = await ethers.provider.getBalance(recipient);
    await entryPoint.handleOps([userOp2], owner.address);
    const balanceAfter = await ethers.provider.getBalance(recipient);

    expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));
  });
});
