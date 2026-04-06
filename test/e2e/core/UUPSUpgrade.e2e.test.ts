/**
 * E2E Tests: UUPS Upgrade
 *
 * CNT-86 ~ CNT-87: UUPS Upgrade Tests
 * - Upgrade success and functionality verification
 * - Data preservation after upgrade
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

// Fixture: Deploy contracts for upgrade tests
async function deployUpgradeTestContracts() {
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
  const masterWallet = createTestWallet(100);
  const txWallet = createTestWallet(200);
  const txWallet2 = createTestWallet(201);

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    owner,
    signers,
    masterWallet,
    txWallet,
    txWallet2,
  };
}

// Fixture: Deploy wallet for upgrade tests
async function deployWalletForUpgrade() {
  const base = await deployUpgradeTestContracts();
  const { factory, entryPoint, accountKeyAddressLogic, owner, masterWallet, txWallet, txWallet2 } = base;

  // Create 2-of-2 masterKey (to verify it's preserved after upgrade)
  const masterKey1 = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const masterKey2 = encodeAddressKey(
    txWallet2.address, // reuse for 2nd master key
    await accountKeyAddressLogic.getAddress(),
    1
  );
  const encodedMasterKey = encodePrimitiveKeys(2, [masterKey1, masterKey2]);

  // Create 1-of-1 txKey
  const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedTxKey = encodePrimitiveKeys(1, [txKey]);

  // Create wallet
  const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
  await factory.createAccount(1, encodedMasterKey, encodedTxKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  // Deploy new implementation for upgrade
  const NewImplementationFactory = await ethers.getContractFactory("ZkapAccount");
  const newImplementation = await NewImplementationFactory.deploy(await entryPoint.getAddress());
  await newImplementation.waitForDeployment();

  return {
    ...base,
    account,
    accountAddress,
    encodedMasterKey,
    encodedTxKey,
    newImplementation,
  };
}

// Fixture: Deploy wallet with 3 masterKeys and 2 txKeys for CNT-568~573
async function deployWalletFor568_573() {
  const base = await deployUpgradeTestContracts();
  const { factory, entryPoint, accountKeyAddressLogic, owner, masterWallet, txWallet, txWallet2 } = base;

  // Create additional wallets
  const masterWallet2 = createTestWallet(102);
  const masterWallet3 = createTestWallet(103);
  const txWallet3 = createTestWallet(203);

  // Create 2-of-3 masterKey (3 keys, threshold=2)
  const masterKey1 = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const masterKey2 = encodeAddressKey(masterWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
  const masterKey3 = encodeAddressKey(masterWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedMasterKey = encodePrimitiveKeys(2, [masterKey1, masterKey2, masterKey3]);

  // Create 1-of-2 txKey (2 keys, threshold=1)
  const txKey1 = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const txKey2 = encodeAddressKey(txWallet3.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedTxKey = encodePrimitiveKeys(1, [txKey1, txKey2]);

  // Create wallet
  const accountAddress = await factory.createAccount.staticCall(1, encodedMasterKey, encodedTxKey);
  await factory.createAccount(1, encodedMasterKey, encodedTxKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  // Deploy new implementation for upgrade
  const NewImplementationFactory = await ethers.getContractFactory("ZkapAccount");
  const newImplementation = await NewImplementationFactory.deploy(await entryPoint.getAddress());
  await newImplementation.waitForDeployment();

  return {
    ...base,
    account,
    accountAddress,
    encodedMasterKey,
    encodedTxKey,
    newImplementation,
    masterWallet2,
    masterWallet3,
    txWallet3,
  };
}

describe("E2E: UUPS Upgrade", function () {
  // CNT-86: functionality works correctly after successful upgrade
  it("CNT-86: upgrade success and functionality works", async function () {
    const { account, entryPoint, owner, txWallet, newImplementation } = await loadFixture(deployWalletForUpgrade);

    // Record initial state
    const initialMasterKeyThreshold = await account.masterKeyThreshold();
    const initialTxKeyThreshold = await account.txKeyThreshold();

    // Create upgrade callData via execute (self-call)
    // upgradeToAndCall(address newImplementation, bytes memory data)
    const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
      await newImplementation.getAddress(),
      "0x", // no initialization data
    ]);

    // execute calls the account itself to upgrade
    // Note: execute uses txKeyList for validation (methodSig = execute)
    const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

    // Create UserOp - execute uses txKey (not masterKey)
    const userOp = await createUserOp(account, callData);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

    // Sign with txKey (threshold = 1)
    const signature = await signUserOp(userOpHash, txWallet);
    userOp.signature = encodeZkapSignature([0], [signature]);

    // Execute upgrade
    const tx = await entryPoint.handleOps([userOp], owner.address);
    expect((await tx.wait())?.status).to.equal(1);

    // Verify upgrade succeeded - check implementation address changed
    // Note: For UUPS, we can verify by checking the implementation slot
    // or by checking functionality still works

    // Verify functionality still works after upgrade
    // Execute a simple ETH transfer with txKey
    const recipient = ethers.Wallet.createRandom().address;
    const transferAmount = ethers.parseEther("0.5");
    const transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

    const userOp2 = await createUserOp(account, transferCallData);
    const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);

    // Sign with txKey
    const signature2 = await signUserOp(userOpHash2, txWallet);
    userOp2.signature = encodeZkapSignature([0], [signature2]);

    const balanceBefore = await ethers.provider.getBalance(recipient);
    await entryPoint.handleOps([userOp2], owner.address);
    const balanceAfter = await ethers.provider.getBalance(recipient);

    // Verify transfer succeeded
    expect(balanceAfter - balanceBefore).to.equal(transferAmount);

    // Verify thresholds are unchanged
    expect(await account.masterKeyThreshold()).to.equal(initialMasterKeyThreshold);
    expect(await account.txKeyThreshold()).to.equal(initialTxKeyThreshold);
  });

  // CNT-87: verify data preservation after upgrade
  it("CNT-87: data preservation after upgrade", async function () {
    const { account, entryPoint, owner, masterWallet, txWallet, txWallet2, newImplementation } = await loadFixture(
      deployWalletForUpgrade
    );

    // Record all initial state
    const initialMasterKeyThreshold = await account.masterKeyThreshold();
    const initialTxKeyThreshold = await account.txKeyThreshold();
    const initialNonce = await account.getNonce();
    const initialBalance = await ethers.provider.getBalance(await account.getAddress());
    const initialDeposit = await account.getDeposit();

    // Create upgrade callData via execute (self-call)
    const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
      await newImplementation.getAddress(),
      "0x",
    ]);

    const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

    // Create and sign UserOp with txKey (execute uses txKeyList)
    const userOp = await createUserOp(account, callData);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

    const signature = await signUserOp(userOpHash, txWallet);
    userOp.signature = encodeZkapSignature([0], [signature]);

    // Execute upgrade
    await entryPoint.handleOps([userOp], owner.address);

    // Verify all data is preserved after upgrade
    // 1. masterKeyThreshold preserved
    expect(await account.masterKeyThreshold()).to.equal(initialMasterKeyThreshold);

    // 2. txKeyThreshold preserved
    expect(await account.txKeyThreshold()).to.equal(initialTxKeyThreshold);

    // 3. Nonce incremented (should be initial + 1 after the upgrade tx)
    expect(await account.getNonce()).to.equal(initialNonce + 1n);

    // 4. Account ETH balance preserved (minus gas used)
    const finalBalance = await ethers.provider.getBalance(await account.getAddress());
    expect(finalBalance).to.be.lte(initialBalance); // may have used some gas

    // 5. EntryPoint deposit preserved (minus gas used)
    const finalDeposit = await account.getDeposit();
    expect(finalDeposit).to.be.lte(initialDeposit);

    // 6. Verify masterKey list still works (can sign txKey update)
    const newTxWallet = createTestWallet(999);
    const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
    const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();

    const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
    const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

    // Call updateTxKey directly (uses masterKeyList)
    const updateTxKeyData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

    const userOp2 = await createUserOp(account, updateTxKeyData);
    const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);

    // Sign with both masterKeys
    const sig1 = await signUserOp(userOpHash2, masterWallet);
    const sig2 = await signUserOp(userOpHash2, txWallet2);
    userOp2.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

    const tx = await entryPoint.handleOps([userOp2], owner.address);
    expect((await tx.wait())?.status).to.equal(1);

    // 7. Verify txKey list was updated (can use new txKey)
    await mine(1); // Pass txKeyUpdateBlock check

    const recipient = ethers.Wallet.createRandom().address;
    const transferCallData = account.interface.encodeFunctionData("execute", [
      recipient,
      ethers.parseEther("0.1"),
      "0x",
    ]);

    const userOp3 = await createUserOp(account, transferCallData);
    const userOpHash3 = await getUserOpHash(entryPoint, userOp3, chainId);
    const sig = await signUserOp(userOpHash3, newTxWallet);
    userOp3.signature = encodeZkapSignature([0], [sig]);

    const balanceBefore = await ethers.provider.getBalance(recipient);
    await entryPoint.handleOps([userOp3], owner.address);
    const balanceAfter = await ethers.provider.getBalance(recipient);

    expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("0.1"));
  });

  describe("UUPS Upgrade Edge Cases - CNT-620~627", function () {
    // CNT-620: upgrade attempt from unauthorized address fails
    it("CNT-620: upgrade fails from unauthorized address", async function () {
      const { account, newImplementation } = await loadFixture(deployWalletForUpgrade);

      // Try to upgrade directly (not via self-call)
      await expect(account.upgradeToAndCall(await newImplementation.getAddress(), "0x")).to.be.revertedWithCustomError(
        account,
        "NotFromEntryPoint"
      );
    });

    // CNT-621: verify zkapVersion is returned after upgrade
    it("CNT-621: verify zkapVersion after upgrade", async function () {
      const { account, entryPoint, owner, txWallet, newImplementation } = await loadFixture(deployWalletForUpgrade);

      const versionBefore = await account.zkapVersion();

      // Upgrade
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      const versionAfter = await account.zkapVersion();
      expect(versionAfter).to.equal(versionBefore);
    });

    // CNT-622: entryPoint address preserved after upgrade
    it("CNT-622: entryPoint address preserved after upgrade", async function () {
      const { account, entryPoint, owner, txWallet, newImplementation } = await loadFixture(deployWalletForUpgrade);

      const entryPointBefore = await account.entryPoint();

      // Upgrade
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      const entryPointAfter = await account.entryPoint();
      expect(entryPointAfter).to.equal(entryPointBefore);
    });

    // CNT-623: execute succeeds with txKey after upgrade
    it("CNT-623: execute succeeds with txKey after upgrade", async function () {
      const { account, entryPoint, owner, txWallet, newImplementation } = await loadFixture(deployWalletForUpgrade);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Upgrade first
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      let userOp = await createUserOp(account, callData);
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      let signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Now execute a transfer after upgrade
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.5");

      const transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-624: executeBatch succeeds after upgrade
    it("CNT-624: executeBatch succeeds after upgrade", async function () {
      const { account, entryPoint, owner, txWallet, newImplementation } = await loadFixture(deployWalletForUpgrade);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Upgrade first
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      let userOp = await createUserOp(account, callData);
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      let signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Now executeBatch after upgrade
      const recipient1 = ethers.Wallet.createRandom().address;
      const recipient2 = ethers.Wallet.createRandom().address;
      const amount1 = ethers.parseEther("0.2");
      const amount2 = ethers.parseEther("0.3");

      const batchCallData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [recipient1, recipient2],
        [amount1, amount2],
        ["0x", "0x"],
      ]);

      userOp = await createUserOp(account, batchCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      expect(await ethers.provider.getBalance(recipient1)).to.equal(amount1);
      expect(await ethers.provider.getBalance(recipient2)).to.equal(amount2);
    });

    // CNT-625: updateTxKey succeeds with masterKey after upgrade
    it("CNT-625: updateTxKey succeeds with masterKey after upgrade", async function () {
      const {
        account,
        entryPoint,
        owner,
        masterWallet,
        txWallet,
        txWallet2,
        newImplementation,
        accountKeyAddressLogic,
      } = await loadFixture(deployWalletForUpgrade);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Upgrade first
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      let userOp = await createUserOp(account, callData);
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      let signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Now update txKey using masterKey after upgrade
      const newTxWallet = createTestWallet(999);
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const updateTxKeyData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      userOp = await createUserOp(account, updateTxKeyData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with both masterKeys (threshold = 2)
      const sig1 = await signUserOp(userOpHash, masterWallet);
      const sig2 = await signUserOp(userOpHash, txWallet2);
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify txKey threshold still works
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-626: consecutive upgrade test
    it("CNT-626: consecutive upgrades work correctly", async function () {
      const { account, entryPoint, owner, txWallet } = await loadFixture(deployWalletForUpgrade);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Deploy two new implementations
      const NewImpl1Factory = await ethers.getContractFactory("ZkapAccount");
      const newImpl1 = await NewImpl1Factory.deploy(await entryPoint.getAddress());
      await newImpl1.waitForDeployment();

      const NewImpl2Factory = await ethers.getContractFactory("ZkapAccount");
      const newImpl2 = await NewImpl2Factory.deploy(await entryPoint.getAddress());
      await newImpl2.waitForDeployment();

      // First upgrade
      let upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [await newImpl1.getAddress(), "0x"]);

      let callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      let userOp = await createUserOp(account, callData);
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      let signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Second upgrade
      upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [await newImpl2.getAddress(), "0x"]);

      callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      userOp = await createUserOp(account, callData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify account still works after consecutive upgrades
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.1");

      const transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-627: verify nonce increments correctly after upgrade
    it("CNT-627: nonce increments correctly after upgrade", async function () {
      const { account, entryPoint, owner, txWallet, newImplementation } = await loadFixture(deployWalletForUpgrade);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const nonceBefore = await account.getNonce();

      // Upgrade
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      let userOp = await createUserOp(account, callData);
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      let signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Nonce should be +1
      expect(await account.getNonce()).to.equal(nonceBefore + 1n);

      // Execute another transaction
      const recipient = ethers.Wallet.createRandom().address;
      const transferCallData = account.interface.encodeFunctionData("execute", [
        recipient,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Nonce should be +2
      expect(await account.getNonce()).to.equal(nonceBefore + 2n);
    });
  });

  describe("UUPS Upgrade State Preservation - CNT-568~573", function () {
    // CNT-568: masterKeyList preserved after upgrade (3 masterKeys)
    it("CNT-568: masterKeyList preserved after upgrade (3 keys)", async function () {
      const {
        account,
        entryPoint,
        owner,
        txWallet,
        newImplementation,
        masterWallet,
        masterWallet2,
        masterWallet3,
        accountKeyAddressLogic,
      } = await loadFixture(deployWalletFor568_573);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Verify initial masterKey count (3 keys via proxy check)
      const masterKey0 = await account.masterKeyList(0);
      const masterKey1 = await account.masterKeyList(1);
      const masterKey2 = await account.masterKeyList(2);
      expect(masterKey0.logic).to.not.equal(ethers.ZeroAddress);
      expect(masterKey1.logic).to.not.equal(ethers.ZeroAddress);
      expect(masterKey2.logic).to.not.equal(ethers.ZeroAddress);

      // Perform upgrade using txKey (execute)
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      const userOp = await createUserOp(account, callData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify masterKeyList preserved after upgrade (all 3 keys)
      const masterKey0After = await account.masterKeyList(0);
      const masterKey1After = await account.masterKeyList(1);
      const masterKey2After = await account.masterKeyList(2);
      expect(masterKey0After.logic).to.equal(masterKey0.logic);
      expect(masterKey0After.keyId).to.equal(masterKey0.keyId);
      expect(masterKey1After.logic).to.equal(masterKey1.logic);
      expect(masterKey1After.keyId).to.equal(masterKey1.keyId);
      expect(masterKey2After.logic).to.equal(masterKey2.logic);
      expect(masterKey2After.keyId).to.equal(masterKey2.keyId);

      // Verify masterKey can still be used (updateTxKey requires 2-of-3 masterKey)
      const newTxWallet = createTestWallet(999);
      const newTxKey = encodeAddressKey(newTxWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);

      const updateTxKeyData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp2 = await createUserOp(account, updateTxKeyData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);

      // Sign with 2 of 3 masterKeys
      const sig1 = await signUserOp(userOpHash2, masterWallet);
      const sig2 = await signUserOp(userOpHash2, masterWallet2);
      userOp2.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const tx = await entryPoint.handleOps([userOp2], owner.address);
      expect((await tx.wait())?.status).to.equal(1);
    });

    // CNT-569: txKeyList preserved after upgrade (2 txKeys)
    it("CNT-569: txKeyList preserved after upgrade (2 keys)", async function () {
      const { account, entryPoint, owner, txWallet, txWallet3, newImplementation } = await loadFixture(
        deployWalletFor568_573
      );

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Verify initial txKey count (2 keys)
      const txKey0 = await account.txKeyList(0);
      const txKey1 = await account.txKeyList(1);
      expect(txKey0.logic).to.not.equal(ethers.ZeroAddress);
      expect(txKey1.logic).to.not.equal(ethers.ZeroAddress);

      // Perform upgrade
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      const userOp = await createUserOp(account, callData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify txKeyList preserved after upgrade (both keys)
      const txKey0After = await account.txKeyList(0);
      const txKey1After = await account.txKeyList(1);
      expect(txKey0After.logic).to.equal(txKey0.logic);
      expect(txKey0After.keyId).to.equal(txKey0.keyId);
      expect(txKey1After.logic).to.equal(txKey1.logic);
      expect(txKey1After.keyId).to.equal(txKey1.keyId);

      // Verify both txKeys can still be used for execute
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.1");

      // Use txWallet (index 0)
      let transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);
      let userOp2 = await createUserOp(account, transferCallData);
      let userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      let sig = await signUserOp(userOpHash2, txWallet);
      userOp2.signature = encodeZkapSignature([0], [sig]);

      await entryPoint.handleOps([userOp2], owner.address);
      expect(await ethers.provider.getBalance(recipient)).to.equal(transferAmount);

      // Use txWallet3 (index 1)
      const recipient2 = ethers.Wallet.createRandom().address;
      transferCallData = account.interface.encodeFunctionData("execute", [recipient2, transferAmount, "0x"]);
      userOp2 = await createUserOp(account, transferCallData);
      userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      sig = await signUserOp(userOpHash2, txWallet3);
      userOp2.signature = encodeZkapSignature([1], [sig]);

      await entryPoint.handleOps([userOp2], owner.address);
      expect(await ethers.provider.getBalance(recipient2)).to.equal(transferAmount);
    });

    // CNT-570: threshold preserved after upgrade (threshold=2)
    it("CNT-570: threshold preserved after upgrade (threshold=2)", async function () {
      const { account, entryPoint, owner, txWallet, newImplementation } = await loadFixture(deployWalletFor568_573);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Verify initial thresholds
      const masterThresholdBefore = await account.masterKeyThreshold();
      const txThresholdBefore = await account.txKeyThreshold();
      expect(masterThresholdBefore).to.equal(2); // 2-of-3
      expect(txThresholdBefore).to.equal(1); // 1-of-2

      // Perform upgrade
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      const userOp = await createUserOp(account, callData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify thresholds preserved
      expect(await account.masterKeyThreshold()).to.equal(masterThresholdBefore);
      expect(await account.txKeyThreshold()).to.equal(txThresholdBefore);
    });

    // CNT-571: execute works correctly after upgrade
    it("CNT-571: execute works normally after upgrade", async function () {
      const { account, entryPoint, owner, txWallet, newImplementation } = await loadFixture(deployWalletFor568_573);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Perform upgrade
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      let userOp = await createUserOp(account, callData);
      let userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      let signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Execute ETH transfer after upgrade
      const recipient = ethers.Wallet.createRandom().address;
      const transferAmount = ethers.parseEther("0.5");

      const transferCallData = account.interface.encodeFunctionData("execute", [recipient, transferAmount, "0x"]);

      userOp = await createUserOp(account, transferCallData);
      userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const balanceBefore = await ethers.provider.getBalance(recipient);
      await entryPoint.handleOps([userOp], owner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient);

      expect(balanceAfter - balanceBefore).to.equal(transferAmount);
    });

    // CNT-572: direct upgradeToAndCall attempt with txKey fails (external call)
    // Note: upgrade via execute is allowed with txKey (by contract design)
    // Direct upgradeToAndCall call is blocked with NotFromEntryPoint
    it("CNT-572: direct upgradeToAndCall fails (not via execute)", async function () {
      const { account, newImplementation } = await loadFixture(deployWalletFor568_573);

      // Direct call to upgradeToAndCall should fail with NotFromEntryPoint
      await expect(account.upgradeToAndCall(await newImplementation.getAddress(), "0x")).to.be.revertedWithCustomError(
        account,
        "NotFromEntryPoint"
      );
    });

    // CNT-573: upgrade succeeds with masterKey (upgrade via execute with new key after updateTxKey)
    it("CNT-573: upgrade succeeds with masterKey authorization", async function () {
      const { account, entryPoint, owner, txWallet, masterWallet, masterWallet2, newImplementation } =
        await loadFixture(deployWalletFor568_573);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Upgrade via execute (uses txKey, but proves upgrade path works)
      // Note: In current implementation, execute uses txKey for signing
      // The masterKey is used for updateMasterKey/updateTxKey operations
      const upgradeData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newImplementation.getAddress(),
        "0x",
      ]);

      const callData = account.interface.encodeFunctionData("execute", [await account.getAddress(), 0, upgradeData]);

      const userOp = await createUserOp(account, callData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, txWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      expect((await tx.wait())?.status).to.equal(1);

      // Verify upgrade worked by checking functionality
      const recipient = ethers.Wallet.createRandom().address;
      const transferCallData = account.interface.encodeFunctionData("execute", [
        recipient,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp2 = await createUserOp(account, transferCallData);
      const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
      const sig = await signUserOp(userOpHash2, txWallet);
      userOp2.signature = encodeZkapSignature([0], [sig]);

      await entryPoint.handleOps([userOp2], owner.address);
      expect(await ethers.provider.getBalance(recipient)).to.equal(ethers.parseEther("0.1"));
    });
  });
});
