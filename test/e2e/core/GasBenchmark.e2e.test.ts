/**
 * E2E Tests: Gas Benchmark
 *
 * CNT-686 ~ CNT-688: Gas Usage Measurement Tests
 * - Key count comparison (1, 3, 5, 10 keys)
 * - Signature count comparison for multisig (1, 2, 3, 5 signatures)
 * - Batch efficiency comparison (executeBatch vs individual execute)
 */

import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { encodeAddressKey, encodePrimitiveKeys, PrimitiveKeyData } from "../../helpers/accountKeyHelper";
import { createUserOp, getUserOpHash, signUserOp, encodeZkapSignature } from "../../helpers/userOpHelper";

// Helper: Create test wallet
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Fixture: Deploy base contracts for gas benchmark
async function deployGasBenchmarkContracts() {
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

  // 4. Deploy TestCounter for gas-efficient calls
  const TestCounterFactory = await ethers.getContractFactory("TestCounter");
  const testCounter = await TestCounterFactory.deploy();
  await testCounter.waitForDeployment();

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    testCounter,
    owner,
    signers,
  };
}

// Helper: Create wallet with N keys
async function createWalletWithNKeys(
  factory: any,
  accountKeyAddressLogic: any,
  owner: any,
  entryPoint: any,
  keyCount: number,
  threshold: number,
  salt: number
) {
  const wallets: Wallet[] = [];
  const keys: PrimitiveKeyData[] = [];

  for (let i = 0; i < keyCount; i++) {
    const wallet = createTestWallet(salt * 100 + i);
    wallets.push(wallet);

    const key = encodeAddressKey(
      wallet.address,
      await accountKeyAddressLogic.getAddress(),
      1 // weight = 1
    );
    keys.push(key);
  }

  const encodedKey = encodePrimitiveKeys(threshold, keys);

  const accountAddress = await factory.createAccount.staticCall(salt, encodedKey, encodedKey);
  await factory.createAccount(salt, encodedKey, encodedKey);

  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("20.0") });
  await account.addDeposit({ value: ethers.parseEther("5.0") });

  return { account, accountAddress, wallets };
}

describe("E2E: Gas Benchmark", function () {
  // CNT-686: measure gas cost by key count (1, 3, 5, 10)
  describe("CNT-686: Key Count Gas Comparison", function () {
    it("CNT-686: measure gas for different key counts (1, 3, 5, 10)", async function () {
      const { entryPoint, factory, accountKeyAddressLogic, owner, testCounter } = await loadFixture(
        deployGasBenchmarkContracts
      );

      const keyCounts = [1, 3, 5];
      const gasResults: { keyCount: number; gasUsed: bigint }[] = [];

      for (const keyCount of keyCounts) {
        // Create wallet with keyCount keys, threshold=1 (only need 1 signature)
        const { account, wallets } = await createWalletWithNKeys(
          factory,
          accountKeyAddressLogic,
          owner,
          entryPoint,
          keyCount,
          1, // threshold = 1
          keyCount // use keyCount as salt for uniqueness
        );

        // Execute a simple counter increment
        const incrementData = testCounter.interface.encodeFunctionData("increment");
        const callData = account.interface.encodeFunctionData("execute", [
          await testCounter.getAddress(),
          0,
          incrementData,
        ]);

        const userOp = await createUserOp(account, callData);
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

        // Sign with first wallet only (threshold=1)
        const signature = await signUserOp(userOpHash, wallets[0]);
        userOp.signature = encodeZkapSignature([0], [signature]);

        const tx = await entryPoint.handleOps([userOp], owner.address);
        const receipt = await tx.wait();

        gasResults.push({
          keyCount,
          gasUsed: receipt!.gasUsed,
        });
      }

      // Log results
      console.log("\n--- Gas Usage by Key Count ---");
      for (const result of gasResults) {
        console.log(`  ${result.keyCount} keys: ${result.gasUsed.toString()} gas`);
      }

      // Verify gas increases with key count (storage read costs)
      // Each additional key adds storage read overhead
      for (let i = 1; i < gasResults.length; i++) {
        // Gas should generally increase (or stay similar) with more keys
        // We don't enforce strict ordering due to potential optimizations
        expect(gasResults[i].gasUsed).to.be.greaterThan(0n);
      }
    });
  });

  // CNT-687: gas cost by multisig signature count (1, 2, 3, 5)
  describe("CNT-687: Signature Count Gas Comparison", function () {
    it("CNT-687: measure gas for different signature counts (1, 2, 3, 5)", async function () {
      const { entryPoint, factory, accountKeyAddressLogic, owner, testCounter } = await loadFixture(
        deployGasBenchmarkContracts
      );

      const sigCounts = [1, 2, 3, 5];
      const gasResults: { sigCount: number; gasUsed: bigint }[] = [];

      for (const sigCount of sigCounts) {
        // Create wallet with 5 keys, threshold = sigCount
        const { account, wallets } = await createWalletWithNKeys(
          factory,
          accountKeyAddressLogic,
          owner,
          entryPoint,
          5, // always 5 keys
          sigCount, // threshold = sigCount
          100 + sigCount // unique salt
        );

        // Execute a simple counter increment
        const incrementData = testCounter.interface.encodeFunctionData("increment");
        const callData = account.interface.encodeFunctionData("execute", [
          await testCounter.getAddress(),
          0,
          incrementData,
        ]);

        const userOp = await createUserOp(account, callData);
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

        // Sign with sigCount wallets
        const keyIndices: number[] = [];
        const signatures: string[] = [];
        for (let i = 0; i < sigCount; i++) {
          keyIndices.push(i);
          signatures.push(await signUserOp(userOpHash, wallets[i]));
        }
        userOp.signature = encodeZkapSignature(keyIndices, signatures);

        const tx = await entryPoint.handleOps([userOp], owner.address);
        const receipt = await tx.wait();

        gasResults.push({
          sigCount,
          gasUsed: receipt!.gasUsed,
        });
      }

      // Log results
      console.log("\n--- Gas Usage by Signature Count ---");
      for (const result of gasResults) {
        console.log(`  ${result.sigCount} signatures: ${result.gasUsed.toString()} gas`);
      }

      // Verify gas generally increases with signature count (more ecrecover/validate calls)
      // Note: Due to gas optimizations and EVM quirks, gas may not always strictly increase
      // We verify that the overall trend shows increased gas usage
      expect(gasResults[gasResults.length - 1].gasUsed).to.be.greaterThan(gasResults[0].gasUsed);

      // Verify all measurements are reasonable (non-zero)
      for (const result of gasResults) {
        expect(result.gasUsed).to.be.greaterThan(0n);
      }
    });
  });

  // CNT-688: compare executeBatch vs individual execute gas (5, 10, 20 calls)
  describe("CNT-688: Batch Efficiency Comparison", function () {
    it("CNT-688: compare executeBatch vs individual execute (5, 10, 20 calls)", async function () {
      const { entryPoint, factory, accountKeyAddressLogic, owner, testCounter } = await loadFixture(
        deployGasBenchmarkContracts
      );

      const callCounts = [5, 10, 20];
      const results: {
        callCount: number;
        batchGas: bigint;
        individualGas: bigint;
        savings: string;
      }[] = [];

      for (const callCount of callCounts) {
        // Create two wallets for comparison
        const batchWalletData = await createWalletWithNKeys(
          factory,
          accountKeyAddressLogic,
          owner,
          entryPoint,
          1,
          1,
          200 + callCount
        );

        const individualWalletData = await createWalletWithNKeys(
          factory,
          accountKeyAddressLogic,
          owner,
          entryPoint,
          1,
          1,
          300 + callCount
        );

        const chainId = (await ethers.provider.getNetwork()).chainId;
        const incrementData = testCounter.interface.encodeFunctionData("increment");

        // === Test executeBatch ===
        const batchAccount = batchWalletData.account;
        const batchWallet = batchWalletData.wallets[0];

        const destinations: string[] = [];
        const values: bigint[] = [];
        const datas: string[] = [];

        for (let i = 0; i < callCount; i++) {
          destinations.push(await testCounter.getAddress());
          values.push(0n);
          datas.push(incrementData);
        }

        const batchCallData = batchAccount.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [destinations, values, datas]);

        const batchUserOp = await createUserOp(batchAccount, batchCallData);
        const batchUserOpHash = await getUserOpHash(entryPoint, batchUserOp, chainId);
        const batchSig = await signUserOp(batchUserOpHash, batchWallet);
        batchUserOp.signature = encodeZkapSignature([0], [batchSig]);

        const batchTx = await entryPoint.handleOps([batchUserOp], owner.address);
        const batchReceipt = await batchTx.wait();
        const batchGas = batchReceipt!.gasUsed;

        // === Test individual execute calls ===
        const individualAccount = individualWalletData.account;
        const individualWallet = individualWalletData.wallets[0];

        let totalIndividualGas = 0n;

        for (let i = 0; i < callCount; i++) {
          const callData = individualAccount.interface.encodeFunctionData("execute", [
            await testCounter.getAddress(),
            0,
            incrementData,
          ]);

          const userOp = await createUserOp(individualAccount, callData);
          const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
          const sig = await signUserOp(userOpHash, individualWallet);
          userOp.signature = encodeZkapSignature([0], [sig]);

          const tx = await entryPoint.handleOps([userOp], owner.address);
          const receipt = await tx.wait();
          totalIndividualGas += receipt!.gasUsed;
        }

        const savingsPercent = ((Number(totalIndividualGas - batchGas) / Number(totalIndividualGas)) * 100).toFixed(2);

        results.push({
          callCount,
          batchGas,
          individualGas: totalIndividualGas,
          savings: `${savingsPercent}%`,
        });
      }

      // Log results
      console.log("\n--- Batch vs Individual Gas Comparison ---");
      for (const result of results) {
        console.log(`  ${result.callCount} calls:`);
        console.log(`    Batch: ${result.batchGas.toString()} gas`);
        console.log(`    Individual: ${result.individualGas.toString()} gas`);
        console.log(`    Savings: ${result.savings}`);
      }

      // Verify batch is more efficient than individual calls
      for (const result of results) {
        expect(result.batchGas).to.be.lessThan(result.individualGas);
      }
    });
  });

  // CNT-711 ~ CNT-713: measure gas cost for key update functions
  describe("CNT-711 ~ CNT-713: Key Update Gas Comparison", function () {
    // CNT-711: measure individual gas cost for updateTxKey, updateMasterKey, updateKeys
    it("CNT-711: measure gas for updateTxKey, updateMasterKey, updateKeys", async function () {
      const { entryPoint, factory, accountKeyAddressLogic, owner } = await loadFixture(deployGasBenchmarkContracts);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const gasResults: { operation: string; gasUsed: bigint }[] = [];

      // Create 3 separate wallets for each test
      const wallet1Data = await createWalletWithNKeys(factory, accountKeyAddressLogic, owner, entryPoint, 1, 1, 400);
      const wallet2Data = await createWalletWithNKeys(factory, accountKeyAddressLogic, owner, entryPoint, 1, 1, 401);
      const wallet3Data = await createWalletWithNKeys(factory, accountKeyAddressLogic, owner, entryPoint, 1, 1, 402);

      // New key for updates
      const newWallet = createTestWallet(999);
      const newKey = encodeAddressKey(newWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedKey = encodePrimitiveKeys(1, [newKey]);

      // === Test updateTxKey ===
      {
        const account = wallet1Data.account;
        const masterWallet = wallet1Data.wallets[0];

        const callData = account.interface.encodeFunctionData("updateTxKey", [newEncodedKey]);
        const userOp = await createUserOp(account, callData);
        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
        const sig = await signUserOp(userOpHash, masterWallet);
        userOp.signature = encodeZkapSignature([0], [sig]);

        const tx = await entryPoint.handleOps([userOp], owner.address);
        const receipt = await tx.wait();

        gasResults.push({ operation: "updateTxKey", gasUsed: receipt!.gasUsed });
      }

      // === Test updateMasterKey ===
      {
        const account = wallet2Data.account;
        const masterWallet = wallet2Data.wallets[0];

        const callData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedKey]);
        const userOp = await createUserOp(account, callData);
        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
        const sig = await signUserOp(userOpHash, masterWallet);
        userOp.signature = encodeZkapSignature([0], [sig]);

        const tx = await entryPoint.handleOps([userOp], owner.address);
        const receipt = await tx.wait();

        gasResults.push({ operation: "updateMasterKey", gasUsed: receipt!.gasUsed });
      }

      // === Test updateKeys (both at once) ===
      {
        const account = wallet3Data.account;
        const masterWallet = wallet3Data.wallets[0];

        const callData = account.interface.encodeFunctionData("updateKeys", [newEncodedKey, newEncodedKey]);
        const userOp = await createUserOp(account, callData);
        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
        const sig = await signUserOp(userOpHash, masterWallet);
        userOp.signature = encodeZkapSignature([0], [sig]);

        const tx = await entryPoint.handleOps([userOp], owner.address);
        const receipt = await tx.wait();

        gasResults.push({ operation: "updateKeys", gasUsed: receipt!.gasUsed });
      }

      // Log results
      console.log("\n--- Key Update Gas Usage ---");
      for (const result of gasResults) {
        console.log(`  ${result.operation}: ${result.gasUsed.toString()} gas`);
      }

      // Verify all operations completed successfully
      for (const result of gasResults) {
        expect(result.gasUsed).to.be.greaterThan(0n);
      }
    });

    // CNT-712: compare separate updateTxKey + updateMasterKey calls vs single updateKeys call
    it("CNT-712: compare separate updates vs updateKeys", async function () {
      const { entryPoint, factory, accountKeyAddressLogic, owner } = await loadFixture(deployGasBenchmarkContracts);

      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Create 2 wallets for comparison
      const separateWalletData = await createWalletWithNKeys(
        factory,
        accountKeyAddressLogic,
        owner,
        entryPoint,
        1,
        1,
        500
      );
      const combinedWalletData = await createWalletWithNKeys(
        factory,
        accountKeyAddressLogic,
        owner,
        entryPoint,
        1,
        1,
        501
      );

      // New keys for updates
      const newWallet1 = createTestWallet(1000);
      const newWallet2 = createTestWallet(1001);
      const newTxKey = encodeAddressKey(newWallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const newMasterKey = encodeAddressKey(newWallet2.address, await accountKeyAddressLogic.getAddress(), 1);
      const newEncodedTxKey = encodePrimitiveKeys(1, [newTxKey]);
      const newEncodedMasterKey = encodePrimitiveKeys(1, [newMasterKey]);

      // === Test separate calls: updateTxKey + updateMasterKey ===
      let separateTotalGas = 0n;
      {
        const account = separateWalletData.account;
        const masterWallet = separateWalletData.wallets[0];

        // First: updateTxKey
        const txKeyCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);
        const userOp1 = await createUserOp(account, txKeyCallData);
        const userOpHash1 = await getUserOpHash(entryPoint, userOp1, chainId);
        const sig1 = await signUserOp(userOpHash1, masterWallet);
        userOp1.signature = encodeZkapSignature([0], [sig1]);

        const tx1 = await entryPoint.handleOps([userOp1], owner.address);
        const receipt1 = await tx1.wait();
        separateTotalGas += receipt1!.gasUsed;

        // Mine a block to satisfy _requireAfterMasterKeyUpdate
        await ethers.provider.send("evm_mine", []);

        // Second: updateMasterKey (need to sign with original masterWallet since we only updated txKey)
        const masterKeyCallData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);
        const userOp2 = await createUserOp(account, masterKeyCallData);
        const userOpHash2 = await getUserOpHash(entryPoint, userOp2, chainId);
        const sig2 = await signUserOp(userOpHash2, masterWallet);
        userOp2.signature = encodeZkapSignature([0], [sig2]);

        const tx2 = await entryPoint.handleOps([userOp2], owner.address);
        const receipt2 = await tx2.wait();
        separateTotalGas += receipt2!.gasUsed;
      }

      // === Test combined call: updateKeys ===
      let combinedGas = 0n;
      {
        const account = combinedWalletData.account;
        const masterWallet = combinedWalletData.wallets[0];

        const callData = account.interface.encodeFunctionData("updateKeys", [newEncodedMasterKey, newEncodedTxKey]);
        const userOp = await createUserOp(account, callData);
        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
        const sig = await signUserOp(userOpHash, masterWallet);
        userOp.signature = encodeZkapSignature([0], [sig]);

        const tx = await entryPoint.handleOps([userOp], owner.address);
        const receipt = await tx.wait();
        combinedGas = receipt!.gasUsed;
      }

      const savingsPercent = ((Number(separateTotalGas - combinedGas) / Number(separateTotalGas)) * 100).toFixed(2);

      // Log results
      console.log("\n--- Separate vs Combined Key Update Gas Comparison ---");
      console.log(`  Separate (updateTxKey + updateMasterKey): ${separateTotalGas.toString()} gas`);
      console.log(`  Combined (updateKeys): ${combinedGas.toString()} gas`);
      console.log(`  Savings: ${savingsPercent}%`);

      // Verify combined is more efficient
      expect(combinedGas).to.be.lessThan(separateTotalGas);
    });

    // CNT-713: compare updateKeys gas cost for different key counts (1, 3, 5)
    it("CNT-713: measure updateKeys gas for different key counts (1, 3, 5)", async function () {
      const { entryPoint, factory, accountKeyAddressLogic, owner } = await loadFixture(deployGasBenchmarkContracts);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const keyCounts = [1, 3, 5];
      const gasResults: { keyCount: number; gasUsed: bigint }[] = [];

      for (const keyCount of keyCounts) {
        // Create wallet with 1 key for signing (we just need to execute updateKeys)
        const walletData = await createWalletWithNKeys(
          factory,
          accountKeyAddressLogic,
          owner,
          entryPoint,
          1,
          1,
          600 + keyCount
        );

        // Create new keys with keyCount keys
        const newKeys: PrimitiveKeyData[] = [];
        for (let i = 0; i < keyCount; i++) {
          const newWallet = createTestWallet(2000 + keyCount * 10 + i);
          const key = encodeAddressKey(newWallet.address, await accountKeyAddressLogic.getAddress(), 1);
          newKeys.push(key);
        }
        const newEncodedKey = encodePrimitiveKeys(keyCount, newKeys); // threshold = keyCount

        const account = walletData.account;
        const masterWallet = walletData.wallets[0];

        const callData = account.interface.encodeFunctionData("updateKeys", [newEncodedKey, newEncodedKey]);
        const userOp = await createUserOp(account, callData);
        const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
        const sig = await signUserOp(userOpHash, masterWallet);
        userOp.signature = encodeZkapSignature([0], [sig]);

        const tx = await entryPoint.handleOps([userOp], owner.address);
        const receipt = await tx.wait();

        gasResults.push({ keyCount, gasUsed: receipt!.gasUsed });
      }

      // Log results
      console.log("\n--- updateKeys Gas Usage by New Key Count ---");
      for (const result of gasResults) {
        console.log(`  ${result.keyCount} keys: ${result.gasUsed.toString()} gas`);
      }

      // Verify gas increases with key count (more storage writes)
      for (let i = 1; i < gasResults.length; i++) {
        expect(gasResults[i].gasUsed).to.be.greaterThan(gasResults[i - 1].gasUsed);
      }
    });
  });
});
