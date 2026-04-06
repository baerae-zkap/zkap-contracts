import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { createDummyEncodedKey } from "../helpers/accountKeyHelper";

// Fixture: Deploy ZkapAccountFactory with all dependencies
async function deployZkapAccountFactory() {
  // Signers
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const user1 = signers[1];
  const user2 = signers[2];

  // 1. Deploy EntryPoint (SimpleEntryPoint for testing)
  const EntryPointFactory = await ethers.getContractFactory("SimpleEntryPoint");
  const entryPoint = await EntryPointFactory.deploy();
  await entryPoint.waitForDeployment();

  // 2. Deploy AccountKeyAddress Logic (for testing)
  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();
  await accountKeyAddressLogic.waitForDeployment();

  // 3. Deploy ZkapAccountFactory
  const FactoryContract = await ethers.getContractFactory("ZkapAccountFactory");
  const factory = await FactoryContract.deploy(await entryPoint.getAddress());
  await factory.waitForDeployment();

  return { factory, entryPoint, accountKeyAddressLogic, owner, user1, user2 };
}

describe("ZkapAccountFactory", async function () {
  describe("Deployment", async function () {
    // CNT-88: ZkapAccountFactory deployment success
    it("Should deploy ZkapAccountFactory successfully", async function () {
      const { factory } = await loadFixture(deployZkapAccountFactory);
      expect(await factory.getAddress()).to.be.properAddress;
    });

    // CNT-89: ACCOUNT_IMPLEMENTATION address setup
    it("Should set accountImplementation correctly", async function () {
      const { factory } = await loadFixture(deployZkapAccountFactory);
      const implementation = await factory.ACCOUNT_IMPLEMENTATION();
      expect(implementation).to.be.properAddress;
      expect(implementation).to.not.equal(ethers.ZeroAddress);
    });

    // CNT-90: verify entryPoint configuration of accountImplementation
    it("Should initialize accountImplementation with correct entryPoint", async function () {
      const { factory, entryPoint } = await loadFixture(deployZkapAccountFactory);
      const implementationAddress = await factory.ACCOUNT_IMPLEMENTATION();
      const implementation = await ethers.getContractAt("ZkapAccount", implementationAddress);

      const implEntryPoint = await implementation.entryPoint();
      expect(implEntryPoint).to.equal(await entryPoint.getAddress());
    });

    // CNT-91: revert when deploying with zero address EntryPoint
    it("revert when deploying with zero EntryPoint address", async function () {
      const FactoryContract = await ethers.getContractFactory("ZkapAccountFactory");
      await expect(FactoryContract.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        FactoryContract,
        "InvalidEntryPointAddress",
      );
    });
  });

  describe("createAccount", async function () {
    // CNT-92: create new account successfully and return address
    it("create a new account successfully and return address", async function () {
      const { factory, accountKeyAddressLogic } = await loadFixture(deployZkapAccountFactory);
      const signers = await ethers.getSigners();
      const testUser1 = signers[1];

      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testUser1.address);

      // Verify return value
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      expect(accountAddress).to.be.properAddress;
      expect(accountAddress).to.not.equal(ethers.ZeroAddress);

      // Verify transaction execution
      const tx = await factory.createAccount(1, encodedKey, encodedKey);
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;
    });

    // CNT-93: revert when threshold = 0
    it("revert when creating account with zero threshold", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);

      // Get ZkapAccount implementation for error checking
      const accountImplementation = await ethers.getContractAt("ZkapAccount", await factory.ACCOUNT_IMPLEMENTATION());

      // Create an encoded key with threshold = 0
      const zeroThresholdKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          0, // threshold = 0 (invalid)
          [await accountKeyAddressLogic.getAddress()],
          [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user1.address])],
          [1], // weight
        ],
      );

      const validKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      // masterKey threshold = 0 (error comes from ZkapAccount.initialize)
      await expect(factory.createAccount(1, zeroThresholdKey, validKey)).to.be.revertedWithCustomError(
        accountImplementation,
        "MasterKeyThresholdMustBePositive",
      );

      // txKey threshold = 0
      await expect(factory.createAccount(1, validKey, zeroThresholdKey)).to.be.revertedWithCustomError(
        accountImplementation,
        "TxKeyThresholdMustBePositive",
      );
    });

    // CNT-94: verify account initialization
    it("initialize the created account", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const account = await ethers.getContractAt("ZkapAccount", accountAddress);

      const masterKeyThreshold = await account.masterKeyThreshold();
      const txKeyThreshold = await account.txKeyThreshold();

      expect(masterKeyThreshold).to.equal(1);
      expect(txKeyThreshold).to.equal(1);
    });

    // CNT-95: create different accounts with different salts
    it("create account with different salts", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const account1Address = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      const account2Address = await factory.createAccount.staticCall(2, encodedKey, encodedKey);

      expect(account1Address).to.not.equal(account2Address);
    });
  });

  describe("calcAccountAddress", async function () {
    // CNT-100: address calculation succeeds
    it("calculate account address correctly", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const calculatedAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);

      expect(calculatedAddress).to.be.properAddress;
      expect(calculatedAddress).to.not.equal(ethers.ZeroAddress);
    });

    // CNT-101: calculated address == actual created address
    it("match actual created account address", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const calculatedAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);
      const actualAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);

      expect(actualAddress).to.equal(calculatedAddress);
    });

    // CNT-102: calculate different addresses for different salts
    it("return different addresses for different salts", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const address1 = await factory.calcAccountAddress(1, encodedKey, encodedKey);
      const address2 = await factory.calcAccountAddress(2, encodedKey, encodedKey);

      expect(address1).to.not.equal(address2);
    });

    // CNT-103: calculate different addresses for different keys
    it("return different addresses for different keys", async function () {
      const { factory, accountKeyAddressLogic, user1, user2 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey1 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);
      const encodedKey2 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      const address1 = await factory.calcAccountAddress(1, encodedKey1, encodedKey1);
      const address2 = await factory.calcAccountAddress(1, encodedKey2, encodedKey2);

      expect(address1).to.not.equal(address2);
    });

    // CNT-104: deterministic address calculation (same inputs = same output)
    it("be deterministic (same inputs = same output)", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const address1 = await factory.calcAccountAddress(1, encodedKey, encodedKey);
      const address2 = await factory.calcAccountAddress(1, encodedKey, encodedKey);

      expect(address1).to.equal(address2);
    });
  });

  describe("CREATE2 determinism", async function () {
    // CNT-105: create account at pre-calculated address
    it("create account at pre-calculated address", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const calculatedAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      const code = await ethers.provider.getCode(calculatedAddress);
      expect(code).to.not.equal("0x");
    });
  });

  describe("Edge Cases - Additional CNT Tests", async function () {
    // CNT-483: attempt to create duplicate account with same salt
    it("revert when creating duplicate account with same salt", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      // Create the first account
      await factory.createAccount(1, encodedKey, encodedKey);

      // Try to create the same account again (same salt) - should revert
      // CREATE2 will fail when trying to deploy to an existing address
      await expect(factory.createAccount(1, encodedKey, encodedKey)).to.be.reverted;
    });

    // CNT-484: create account with zero salt
    it("create account with zero salt", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      // Create account with salt = 0
      const accountAddress = await factory.createAccount.staticCall(0, encodedKey, encodedKey);
      await factory.createAccount(0, encodedKey, encodedKey);

      // Verify the account was created
      expect(accountAddress).to.be.properAddress;
      expect(accountAddress).to.not.equal(ethers.ZeroAddress);

      const code = await ethers.provider.getCode(accountAddress);
      expect(code).to.not.equal("0x");

      // Verify the account is initialized
      const account = await ethers.getContractAt("ZkapAccount", accountAddress);
      const masterKeyThreshold = await account.masterKeyThreshold();
      const txKeyThreshold = await account.txKeyThreshold();
      expect(masterKeyThreshold).to.equal(1);
      expect(txKeyThreshold).to.equal(1);
    });

    // CNT-484: accounts created with zero salt vs non-zero salt must have different addresses
    it("create different accounts with zero salt vs non-zero salt", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const zeroSaltAddress = await factory.calcAccountAddress(0, encodedKey, encodedKey);
      const oneSaltAddress = await factory.calcAccountAddress(1, encodedKey, encodedKey);

      expect(zeroSaltAddress).to.not.equal(oneSaltAddress);
    });

    // CNT-485: create accounts with same keyData but different salts (multiple accounts)
    it("create multiple accounts with same keyData but different salts", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      // Create multiple accounts with different salts
      const account1Address = await factory.createAccount.staticCall(100, encodedKey, encodedKey);
      await factory.createAccount(100, encodedKey, encodedKey);

      const account2Address = await factory.createAccount.staticCall(200, encodedKey, encodedKey);
      await factory.createAccount(200, encodedKey, encodedKey);

      const account3Address = await factory.createAccount.staticCall(300, encodedKey, encodedKey);
      await factory.createAccount(300, encodedKey, encodedKey);

      // All addresses should be different
      expect(account1Address).to.not.equal(account2Address);
      expect(account2Address).to.not.equal(account3Address);
      expect(account1Address).to.not.equal(account3Address);

      // All accounts should be deployed
      const code1 = await ethers.provider.getCode(account1Address);
      const code2 = await ethers.provider.getCode(account2Address);
      const code3 = await ethers.provider.getCode(account3Address);

      expect(code1).to.not.equal("0x");
      expect(code2).to.not.equal("0x");
      expect(code3).to.not.equal("0x");
    });

    // CNT-515: revert when weight < threshold
    it("revert when creating account with weight sum less than threshold", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);

      // Get ZkapAccount implementation for error checking
      const accountImplementation = await ethers.getContractAt("ZkapAccount", await factory.ACCOUNT_IMPLEMENTATION());

      // Create an encoded key with weight sum (1) < threshold (2)
      const insufficientWeightKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          2, // threshold = 2
          [await accountKeyAddressLogic.getAddress()],
          [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user1.address])],
          [1], // weight = 1 (insufficient)
        ],
      );

      const validKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      // masterKey weight < threshold (error comes from ZkapAccount.initialize)
      await expect(factory.createAccount(1, insufficientWeightKey, validKey)).to.be.revertedWithCustomError(
        accountImplementation,
        "InsufficientMasterKeyWeight",
      );

      // txKey weight < threshold
      await expect(factory.createAccount(1, validKey, insufficientWeightKey)).to.be.revertedWithCustomError(
        accountImplementation,
        "InsufficientTxKeyWeight",
      );
    });
  });

  describe("Factory Duplicate and Gas Optimization - CNT-561~562", async function () {
    // CNT-561: revert when createAccount is called twice with same parameters in Factory
    it("CNT-561: revert on duplicate createAccount call with same parameters", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      // First createAccount succeeds
      const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
      await factory.createAccount(1, encodedKey, encodedKey);

      // Verify account was created
      const code = await ethers.provider.getCode(accountAddress);
      expect(code).to.not.equal("0x");

      // Second createAccount with same parameters should revert (CREATE2 fails on existing address)
      await expect(factory.createAccount(1, encodedKey, encodedKey)).to.be.reverted;
    });

    // CNT-562: measure and verify Factory createAccount gas cost
    it("CNT-562: measure and verify gas cost for createAccount", async function () {
      const { factory, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      // Create account and measure gas
      const tx = await factory.createAccount(1, encodedKey, encodedKey);
      const receipt = await tx.wait();

      // Gas should be reasonable (less than 2M gas for basic account creation)
      // This verifies gas optimization is working
      expect(receipt?.gasUsed).to.be.lt(2000000n);

      // Log gas for reference
      console.log(`      Gas used for createAccount: ${receipt?.gasUsed}`);
    });

    // CNT-562 additional: gas comparison between calcAccountAddress and createAccount
    it("CNT-562: calcAccountAddress is much cheaper than createAccount", async function () {
      const { factory, accountKeyAddressLogic, user1, user2 } = await loadFixture(deployZkapAccountFactory);
      const encodedKey1 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);
      const encodedKey2 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      // calcAccountAddress is view function (no gas on-chain, just estimate)
      const calcGasEstimate = await factory.calcAccountAddress.estimateGas(1, encodedKey1, encodedKey1);

      // createAccount gas
      const createTx = await factory.createAccount(2, encodedKey2, encodedKey2);
      const createReceipt = await createTx.wait();

      // calcAccountAddress should use much less gas than createAccount
      expect(calcGasEstimate).to.be.lt(createReceipt?.gasUsed || 0n);

      console.log(`      calcAccountAddress gas estimate: ${calcGasEstimate}`);
      console.log(`      createAccount gas used: ${createReceipt?.gasUsed}`);
    });

    // CNT-562 additional: verify consistent gas usage across multiple consecutive account creations
    it("CNT-562: consistent gas usage across multiple account creations", async function () {
      const { factory, accountKeyAddressLogic, owner } = await loadFixture(deployZkapAccountFactory);

      const gasUsages: bigint[] = [];

      // Create 5 accounts with different salts
      for (let i = 10; i < 15; i++) {
        const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), owner.address);
        const tx = await factory.createAccount(i, encodedKey, encodedKey);
        const receipt = await tx.wait();
        gasUsages.push(receipt?.gasUsed || 0n);
      }

      // Gas usage should be consistent (within 10% of average)
      const avgGas = gasUsages.reduce((a, b) => a + b, 0n) / BigInt(gasUsages.length);
      const tolerance = avgGas / 10n; // 10% tolerance

      for (const gas of gasUsages) {
        const diff = gas > avgGas ? gas - avgGas : avgGas - gas;
        expect(diff).to.be.lte(tolerance);
      }

      console.log(`      Average gas per createAccount: ${avgGas}`);
    });
  });
});
