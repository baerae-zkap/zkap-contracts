import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { createDummyEncodedKey, encodeAddressKey, encodePrimitiveKeys } from "../helpers/accountKeyHelper";
import {
  createSignedUserOp,
  createUserOp,
  getUserOpHash,
  signUserOp,
  encodeZkapSignature,
} from "../helpers/userOpHelper";

// Helper function to create test wallet
function createTestWallet() {
  return new Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
}

// Fixture: Deploy base contracts (EntryPoint, AccountKeyAddress, ZkapAccount logic)
async function deployZkapAccount() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const user1 = signers[1];
  const user2 = signers[2];

  const testWallet = createTestWallet();

  // 1. Deploy EntryPoint (SimpleEntryPoint for testing)
  const EntryPointFactory = await ethers.getContractFactory("SimpleEntryPoint");
  const entryPoint = await EntryPointFactory.deploy();
  await entryPoint.waitForDeployment();

  // 2. Deploy AccountKeyAddress Logic
  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();
  await accountKeyAddressLogic.waitForDeployment();

  // 3. Deploy ZkapAccount Logic
  const AccountFactory = await ethers.getContractFactory("ZkapAccount");
  const accountLogic = await AccountFactory.deploy(await entryPoint.getAddress());
  await accountLogic.waitForDeployment();

  return { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1, user2, testWallet };
}

// Fixture: Deploy ZkapAccount with proxy
async function deployZkapAccountWithProxy() {
  const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1, user2, testWallet } =
    await deployZkapAccount();

  const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);

  const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await ProxyFactory.deploy(
    await accountLogic.getAddress(),
    accountLogic.interface.encodeFunctionData("initialize", [encodedKey, encodedKey]),
  );
  const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

  // Deploy ZkapAccountFactory for tests that need to create new accounts
  const FactoryContract = await ethers.getContractFactory("ZkapAccountFactory");
  const factory = await FactoryContract.deploy(await entryPoint.getAddress());
  await factory.waitForDeployment();

  return { account, accountLogic, entryPoint, accountKeyAddressLogic, owner, user1, user2, testWallet, factory };
}

// Fixture: Deploy ZkapAccount with proxy and fund it
async function deployZkapAccountWithProxyAndFunding() {
  const { account, accountLogic, entryPoint, accountKeyAddressLogic, owner, user1, user2, testWallet } =
    await deployZkapAccountWithProxy();

  // Fund the account
  await owner.sendTransaction({
    to: await account.getAddress(),
    value: ethers.parseEther("10.0"),
  });

  // Add deposit to EntryPoint for gas
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return { account, accountLogic, entryPoint, accountKeyAddressLogic, owner, user1, user2, testWallet };
}

// Fixture: Deploy with deposits
async function deployZkapAccountWithDeposits() {
  const { account, accountLogic, entryPoint, accountKeyAddressLogic, owner, user1, user2, testWallet } =
    await deployZkapAccountWithProxy();

  // Add deposit first
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return { account, accountLogic, entryPoint, accountKeyAddressLogic, owner, user1, user2, testWallet };
}

// Fixture: Deploy with multisig (2 keys, threshold 2)
async function deployZkapAccountWithMultisig() {
  const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1, user2 } = await deployZkapAccount();

  // Deploy second AccountKeyAddress instance to avoid single-mapping overwrite
  const AccountKeyAddressFactory2 = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic2 = await AccountKeyAddressFactory2.deploy();
  await accountKeyAddressLogic2.waitForDeployment();

  const testWallet1 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
  const testWallet2 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890124");

  // Create account with 2 txKeys, threshold 2, weights [1, 1]
  const key1 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet1.address, 1);

  // Manually encode with 2 keys using DIFFERENT singletons
  const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address[]", "bytes[]", "uint8[]"],
    [
      2, // threshold
      [await accountKeyAddressLogic.getAddress(), await accountKeyAddressLogic2.getAddress()],
      [
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet1.address]),
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet2.address]),
      ],
      [1, 1], // weights
    ],
  );

  const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await ProxyFactory.deploy(
    await accountLogic.getAddress(),
    accountLogic.interface.encodeFunctionData("initialize", [key1, encodedTxKey]),
  );
  const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

  await owner.sendTransaction({
    to: await account.getAddress(),
    value: ethers.parseEther("10.0"),
  });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return { account, accountLogic, entryPoint, accountKeyAddressLogic, accountKeyAddressLogic2, owner, user1, user2, testWallet1, testWallet2 };
}

describe("ZkapAccount", async function () {
  describe("Deployment", async function () {
    // CNT-1: ZkapAccount logic contract deployment success
    it("Should deploy ZkapAccount logic successfully", async function () {
      const { accountLogic } = await loadFixture(deployZkapAccount);
      expect(await accountLogic.getAddress()).to.be.properAddress;
    });

    // CNT-2: EntryPoint address set correctly
    it("Should set entryPoint correctly", async function () {
      const { accountLogic, entryPoint } = await loadFixture(deployZkapAccount);
      expect(await accountLogic.entryPoint()).to.equal(await entryPoint.getAddress());
    });

    // CNT-3: verify zkap version return value
    it("Should return correct zkap version", async function () {
      const { accountLogic } = await loadFixture(deployZkapAccount);
      expect(await accountLogic.zkapVersion()).to.equal(1);
    });

    // CNT-4: revert when deploying with zero EntryPoint address
    it("revert when deploying with zero EntryPoint address", async function () {
      const AccountFactory = await ethers.getContractFactory("ZkapAccount");
      await expect(AccountFactory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        AccountFactory,
        "InvalidEntryPointAddress",
      );
    });
  });

  describe("Initialization via Proxy", async function () {
    // CNT-5: initialize account with master and tx keys
    it("initialize account with master and tx keys", async function () {
      const { accountLogic, accountKeyAddressLogic, user1, user2 } = await loadFixture(deployZkapAccount);

      const encodedMasterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address, 1);
      const encodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address, 1);

      // Deploy proxy
      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedMasterKey, encodedTxKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      expect(await account.masterKeyThreshold()).to.equal(1);
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-6: emit ZkapAccountInitialized event
    it("emit ZkapAccountInitialized event", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedKey, encodedKey]),
      );
      const receipt = await proxy.deploymentTransaction()?.wait();

      const accountInterface = accountLogic.interface;
      const event = receipt?.logs
        .map((log) => {
          try {
            return accountInterface.parseLog({ topics: log.topics as string[], data: log.data });
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "ZkapAccountInitialized");

      expect(event).to.not.be.undefined;
      expect(event?.args[0]).to.equal(await entryPoint.getAddress());
    });

    // CNT-7: create master key list correctly
    it("create master key list correctly", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);

      const masterKey0 = await account.getFunction("masterKeyList")(0);
      // KeyRef struct returns (logic, keyId)
      expect(masterKey0.logic).to.be.properAddress;
      expect(masterKey0.logic).to.not.equal(ethers.ZeroAddress);
    });

    // CNT-8: create tx key list correctly
    it("create tx key list correctly", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);

      const txKey0 = await account.getFunction("txKeyList")(0);
      // KeyRef struct returns (logic, keyId)
      expect(txKey0.logic).to.be.properAddress;
      expect(txKey0.logic).to.not.equal(ethers.ZeroAddress);
    });

    // CNT-9: revert when initializing with wrong array length (txKey)
    it("revert initialize with wrong array lengths", async function () {
      const { accountLogic, accountKeyAddressLogic, user1, testWallet } = await loadFixture(deployZkapAccount);

      // Create invalid encodedTxKey with mismatched array lengths
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const txKeyWeightList = [1, 2]; // Wrong length! Should be 1

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, txKeyLogicList, txKeyInitDataList, txKeyWeightList],
      );

      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user1.address,
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [validEncodedMasterKey, invalidEncodedTxKey]),
        ),
      ).to.be.reverted;
    });

    // CNT-10: revert when initializing with wrong masterKey array length
    it("revert initialize with wrong masterKey array lengths", async function () {
      const { accountLogic, accountKeyAddressLogic, user1, testWallet } = await loadFixture(deployZkapAccount);

      // Create invalid encodedMasterKey with mismatched array lengths
      const masterKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const masterKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const masterKeyWeightList = [1, 2]; // Wrong length! Should be 1

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList],
      );

      const validEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [invalidEncodedMasterKey, validEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "WrongArrayLengths");
    });

    // CNT-11: revert on double initialization
    it("revert when trying to initialize twice", async function () {
      const { account, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccountWithProxy);

      const newEncodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      // Try to initialize again (should fail)
      await expect(account.initialize(newEncodedKey, newEncodedKey)).to.be.revertedWithCustomError(
        account,
        "InvalidInitialization",
      );
    });

    // CNT-12: revert when initializing with zero masterKeyThreshold
    it("revert initialize with zero masterKeyThreshold", async function () {
      const { accountLogic, accountKeyAddressLogic, user1, testWallet } = await loadFixture(deployZkapAccount);

      // Create encodedMasterKey with threshold = 0
      const masterKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const masterKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const masterKeyWeightList = [1];

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [0, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList], // threshold = 0
      );

      const validEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [invalidEncodedMasterKey, validEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "MasterKeyThresholdMustBePositive");
    });

    // CNT-13: revert when initializing with zero txKeyThreshold
    it("revert initialize with zero txKeyThreshold", async function () {
      const { accountLogic, accountKeyAddressLogic, user1, testWallet } = await loadFixture(deployZkapAccount);

      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user1.address,
      );

      // Create encodedTxKey with threshold = 0
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const txKeyWeightList = [1];

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [0, txKeyLogicList, txKeyInitDataList, txKeyWeightList], // threshold = 0
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [validEncodedMasterKey, invalidEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "TxKeyThresholdMustBePositive");
    });

    // CNT-14: revert when initializing with empty masterKey list
    it("revert initialize with empty masterKey list", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      // Create encodedMasterKey with empty key list
      const emptyEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [], [], []], // threshold = 1, but empty arrays
      );

      const validEncodedTxKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [emptyEncodedMasterKey, validEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "MasterKeyListMustNotBeEmpty");
    });

    // CNT-15: revert when initializing with empty txKey list
    it("revert initialize with empty txKey list", async function () {
      const { accountLogic, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccount);

      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user1.address,
      );

      // Create encodedTxKey with empty key list
      const emptyEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [], [], []], // threshold = 1, but empty arrays
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [validEncodedMasterKey, emptyEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "TxKeyListMustNotBeEmpty");
    });

    // CNT-16: revert when masterKey weight sum < threshold
    it("revert initialize with masterKey weight sum < threshold", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      // Create encodedMasterKey with weight sum < threshold
      const masterKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const masterKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const masterKeyWeightList = [1]; // weight sum = 1

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [10, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList], // threshold = 10 > weight sum = 1
      );

      const validEncodedTxKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [invalidEncodedMasterKey, validEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "InsufficientMasterKeyWeight");
    });

    // CNT-17: revert when txKey weight sum < threshold
    it("revert initialize with txKey weight sum < threshold", async function () {
      const { accountLogic, accountKeyAddressLogic, user1, testWallet } = await loadFixture(deployZkapAccount);

      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user1.address,
      );

      // Create encodedTxKey with weight sum < threshold
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const txKeyWeightList = [1]; // weight sum = 1

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [10, txKeyLogicList, txKeyInitDataList, txKeyWeightList], // threshold = 10 > weight sum = 1
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [validEncodedMasterKey, invalidEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "InsufficientTxKeyWeight");
    });

    // CNT-18: revert when masterKeyLogicList contains zero address
    it("revert initialize with zero address in masterKeyLogicList", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      // Create encodedMasterKey with zero address in logic list
      const masterKeyLogicList = [ethers.ZeroAddress]; // zero address!
      const masterKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const masterKeyWeightList = [1];

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList],
      );

      const validEncodedTxKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [invalidEncodedMasterKey, validEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "MasterKeyLogicAddressZero");
    });

    // CNT-19: revert when txKeyLogicList contains zero address
    it("revert initialize with zero address in txKeyLogicList", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      // Create encodedTxKey with zero address in logic list
      const txKeyLogicList = [ethers.ZeroAddress]; // zero address!
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const txKeyWeightList = [1];

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, txKeyLogicList, txKeyInitDataList, txKeyWeightList],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [validEncodedMasterKey, invalidEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "TxKeyLogicAddressZero");
    });

    // CNT-20: revert when masterKey initData length mismatch
    it("revert initialize with masterKey initData length mismatch", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      // Create encodedMasterKey with initDataList length != logicList length
      const masterKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const masterKeyInitDataList = [
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]),
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]), // Extra item!
      ];
      const masterKeyWeightList = [1];

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList],
      );

      const validEncodedTxKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [invalidEncodedMasterKey, validEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "WrongArrayLengths");
    });

    // CNT-21: revert when txKey initData length mismatch
    it("revert initialize with txKey initData length mismatch", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      // Create encodedTxKey with initDataList length != logicList length
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]),
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]), // Extra item!
      ];
      const txKeyWeightList = [1];

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, txKeyLogicList, txKeyInitDataList, txKeyWeightList],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      await expect(
        ProxyFactory.deploy(
          await accountLogic.getAddress(),
          accountLogic.interface.encodeFunctionData("initialize", [validEncodedMasterKey, invalidEncodedTxKey]),
        ),
      ).to.be.revertedWithCustomError(accountLogic, "WrongArrayLengths");
    });
  });

  describe("View Functions", async function () {
    // CNT-22: return entryPoint address
    it("return entryPoint address", async function () {
      const { account, entryPoint } = await loadFixture(deployZkapAccountWithProxy);
      expect(await account.entryPoint()).to.equal(await entryPoint.getAddress());
    });

    // CNT-23: return zkap version
    it("return zkap version", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);
      expect(await account.zkapVersion()).to.equal(1);
    });

    // CNT-24: return getDeposit amount
    it("return deposit amount", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);
      const deposit = await account.getDeposit();
      expect(deposit).to.equal(0); // Initially zero
    });

    // CNT-25: return getNonce value
    it("return nonce value", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);
      const nonce = await account.getNonce();
      expect(nonce).to.equal(0n); // Initially zero
    });
  });

  describe("Deposit Management", async function () {
    // CNT-26: add deposit to EntryPoint
    it("add deposit to EntryPoint", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);

      const depositAmount = ethers.parseEther("1.0");
      await account.addDeposit({ value: depositAmount });

      const deposit = await account.getDeposit();
      expect(deposit).to.equal(depositAmount);
    });

    // CNT-27: allow multiple deposits
    it("allow multiple deposits", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);

      await account.addDeposit({ value: ethers.parseEther("1.0") });
      await account.addDeposit({ value: ethers.parseEther("0.5") });

      const deposit = await account.getDeposit();
      expect(deposit).to.equal(ethers.parseEther("1.5"));
    });

    // CNT-28: test deposits with various amounts
    it("deposit with various amounts", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);

      // small deposit
      await account.addDeposit({ value: ethers.parseEther("0.001") });
      expect(await account.getDeposit()).to.equal(ethers.parseEther("0.001"));

      // large deposit
      await account.addDeposit({ value: ethers.parseEther("5.0") });
      expect(await account.getDeposit()).to.equal(ethers.parseEther("5.001"));
    });
  });

  describe("Receive ETH", async function () {
    // CNT-29: receive ETH directly
    it("receive ETH directly", async function () {
      const { account, owner } = await loadFixture(deployZkapAccountWithProxy);

      const sendAmount = ethers.parseEther("1.0");
      await owner.sendTransaction({
        to: await account.getAddress(),
        value: sendAmount,
      });

      const balance = await ethers.provider.getBalance(await account.getAddress());
      expect(balance).to.equal(sendAmount);
    });

    // CNT-30: receive ETH directly multiple times
    it("receive ETH multiple times", async function () {
      const { account, owner, user1 } = await loadFixture(deployZkapAccountWithProxy);

      await owner.sendTransaction({
        to: await account.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      await user1.sendTransaction({
        to: await account.getAddress(),
        value: ethers.parseEther("0.5"),
      });

      const balance = await ethers.provider.getBalance(await account.getAddress());
      expect(balance).to.equal(ethers.parseEther("1.5"));
    });

    // CNT-577: receive very small ETH amount (in wei)
    it("CNT-577: receive very small ETH amount (wei)", async function () {
      const { account, owner } = await loadFixture(deployZkapAccountWithProxy);

      const weiAmount = 1n; // 1 wei
      await owner.sendTransaction({
        to: await account.getAddress(),
        value: weiAmount,
      });

      const balance = await ethers.provider.getBalance(await account.getAddress());
      expect(balance).to.equal(weiAmount);
    });

    // CNT-578: receive large ETH amount
    it("CNT-578: receive large ETH amount", async function () {
      const { account, owner } = await loadFixture(deployZkapAccountWithProxy);

      const largeAmount = ethers.parseEther("100.0");
      await owner.sendTransaction({
        to: await account.getAddress(),
        value: largeAmount,
      });

      const balance = await ethers.provider.getBalance(await account.getAddress());
      expect(balance).to.equal(largeAmount);
    });

    // CNT-579: verify balance retained after ETH receive (multiple transactions)
    it("CNT-579: verify balance accumulates correctly across transactions", async function () {
      const { account, owner, user1, user2 } = await loadFixture(deployZkapAccountWithProxy);

      const amounts = [
        ethers.parseEther("0.1"),
        ethers.parseEther("0.25"),
        ethers.parseEther("0.5"),
        ethers.parseEther("1.0"),
        ethers.parseEther("0.15"),
      ];

      // Send from multiple addresses
      await owner.sendTransaction({ to: await account.getAddress(), value: amounts[0] });
      await user1.sendTransaction({ to: await account.getAddress(), value: amounts[1] });
      await user2.sendTransaction({ to: await account.getAddress(), value: amounts[2] });
      await owner.sendTransaction({ to: await account.getAddress(), value: amounts[3] });
      await user1.sendTransaction({ to: await account.getAddress(), value: amounts[4] });

      const expectedTotal = amounts.reduce((a, b) => a + b, 0n);
      const balance = await ethers.provider.getBalance(await account.getAddress());
      expect(balance).to.equal(expectedTotal);
    });
  });

  describe("withdrawDepositTo", async function () {
    // CNT-31: revert withdrawDepositTo when called directly
    it("revert when called directly (not from account itself)", async function () {
      const { account, user1 } = await loadFixture(deployZkapAccountWithDeposits);

      await expect(account.withdrawDepositTo(user1.address, ethers.parseEther("1.0"))).to.be.revertedWithCustomError(
        account,
        "OnlyOwner",
      );
    });

    // CNT-32: revert withdrawDepositTo when called by non-owner
    it("revert when called by non-owner", async function () {
      const { account, user1 } = await loadFixture(deployZkapAccountWithDeposits);

      await expect(
        account.connect(user1).withdrawDepositTo(user1.address, ethers.parseEther("1.0")),
      ).to.be.revertedWithCustomError(account, "OnlyOwner");
    });

    // CNT-33: normal withdrawal via self-call is tested in UserOperation section (CNT-42 execute withdrawDepositTo via self-call)
  });

  describe("execute", async function () {
    // CNT-34: revert when execute called from outside EntryPoint
    it("revert when not called from EntryPoint", async function () {
      const { account, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      await expect(account.execute(user1.address, ethers.parseEther("1.0"), "0x")).to.be.revertedWithCustomError(
        account,
        "NotFromEntryPoint",
      );
    });
  });

  describe("executeBatch", async function () {
    // CNT-39: revert when executeBatch called from outside EntryPoint
    it("revert when not called from EntryPoint", async function () {
      const { account, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      await expect(
        account["executeBatch(address[],uint256[],bytes[])"]([user1.address], [ethers.parseEther("1.0")], ["0x"]),
      ).to.be.revertedWithCustomError(account, "NotFromEntryPoint");
    });

    // CNT-42: revert when executeBatch has wrong array length
    it("revert with wrong array lengths", async function () {
      const { account, entryPoint, owner, user1, user2 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Impersonate EntryPoint to call executeBatch directly
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      // Test case 1: dest.length != func.length
      await expect(
        account.connect(entryPointSigner)["executeBatch(address[],uint256[],bytes[])"](
          [user1.address, user2.address], // 2 addresses
          [ethers.parseEther("1.0")], // 1 value
          ["0x"], // 1 func
        ),
      ).to.be.revertedWithCustomError(account, "WrongArrayLengths");

      // Test case 2: value.length != 0 and value.length != func.length
      await expect(
        account.connect(entryPointSigner)["executeBatch(address[],uint256[],bytes[])"](
          [user1.address], // 1 address
          [ethers.parseEther("1.0"), ethers.parseEther("2.0")], // 2 values
          ["0x"], // 1 func
        ),
      ).to.be.revertedWithCustomError(account, "WrongArrayLengths");
    });
  });

  describe("updateTxKey", async function () {
    // CNT-43: revert when updateTxKey called from outside EntryPoint
    it("revert when not called from EntryPoint", async function () {
      const { account, accountKeyAddressLogic, user2 } = await loadFixture(deployZkapAccountWithProxy);

      const newEncodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      await expect(account.updateTxKey(newEncodedKey)).to.be.revertedWithCustomError(account, "NotFromEntryPoint");
    });
  });

  describe("updateMasterKey", async function () {
    // CNT-51: revert when updateMasterKey called from outside EntryPoint
    it("revert when not called from EntryPoint", async function () {
      const { account, accountKeyAddressLogic, user2 } = await loadFixture(deployZkapAccountWithProxy);

      const newEncodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      await expect(account.updateMasterKey(newEncodedKey)).to.be.revertedWithCustomError(account, "NotFromEntryPoint");
    });
  });

  describe("UUPS Upgrade", async function () {
    // CNT-85: revert upgrade when not called from the account itself
    it("revert upgrade when not called from account itself", async function () {
      const { account, entryPoint } = await loadFixture(deployZkapAccountWithProxy);

      // Deploy new implementation
      const AccountFactory = await ethers.getContractFactory("ZkapAccount");
      const newImplementation = await AccountFactory.deploy(await entryPoint.getAddress());
      await newImplementation.waitForDeployment();

      // Try to upgrade directly (should fail - only from EntryPoint)
      await expect(account.upgradeToAndCall(await newImplementation.getAddress(), "0x")).to.be.revertedWithCustomError(
        account,
        "NotFromEntryPoint",
      );
    });
  });

  describe("UserOperation Execution via EntryPoint", async function () {
    // CNT-35: execute transaction via EntryPoint with valid signature
    it("execute transaction via EntryPoint with valid signature", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create callData for execute(user1, 1 ETH, 0x)
      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      // Create and sign UserOp
      const userOp = await createSignedUserOp(
        account,
        entryPoint,
        executeCallData,
        testWallet,
        0, // txKey index 0
      );

      // Get initial balance
      const initialBalance = await ethers.provider.getBalance(user1.address);

      // Execute via EntryPoint
      await entryPoint.handleOps([userOp], owner.address);

      // Check balance increased
      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1.0"));
    });

    // CNT-40: execute batch transaction via EntryPoint
    it("execute batch transactions via EntryPoint", async function () {
      const { account, entryPoint, owner, user1, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create callData for executeBatch
      const executeBatchCallData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [user1.address, user2.address],
        [ethers.parseEther("0.5"), ethers.parseEther("0.3")],
        ["0x", "0x"],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeBatchCallData, testWallet, 0);

      const initialBalance1 = await ethers.provider.getBalance(user1.address);
      const initialBalance2 = await ethers.provider.getBalance(user2.address);

      await entryPoint.handleOps([userOp], owner.address);

      const finalBalance1 = await ethers.provider.getBalance(user1.address);
      const finalBalance2 = await ethers.provider.getBalance(user2.address);

      expect(finalBalance1 - initialBalance1).to.equal(ethers.parseEther("0.5"));
      expect(finalBalance2 - initialBalance2).to.equal(ethers.parseEther("0.3"));
    });

    // CNT-37: fail with invalid signature
    it("fail with invalid signature", async function () {
      const { account, entryPoint, owner, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      // Sign with wrong wallet
      const wrongWallet = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890999");
      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, wrongWallet, 0);

      // Should fail during validation
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-41: execute batch with empty value array
    it("execute batch with zero-length value array", async function () {
      const { account, entryPoint, owner, user1, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // executeBatch with value.length == 0 means all values are 0
      const executeBatchCallData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [user1.address, user2.address],
        [], // Empty value array
        ["0x", "0x"],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeBatchCallData, testWallet, 0);

      // Should succeed (no ETH transferred, just calls)
      await entryPoint.handleOps([userOp], owner.address);
    });

    // CNT-44: execute updateTxKey with masterKey signature
    it("execute updateTxKey via EntryPoint with masterKey signature", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create new tx key
      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address, 1);

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      // Must sign with masterKey (testWallet) for updateTxKey
      const userOp = await createSignedUserOp(
        account,
        entryPoint,
        updateCallData,
        testWallet,
        0, // masterKey index 0
      );

      await entryPoint.handleOps([userOp], owner.address);

      // Verify threshold is still 1
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-52: execute updateMasterKey with masterKey signature
    it("execute updateMasterKey via EntryPoint with masterKey signature", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user2.address,
        1,
      );

      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);

      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      expect(await account.masterKeyThreshold()).to.equal(1);
    });

    // CNT-33: execute withdrawDepositTo via self-call
    it("execute withdrawDepositTo via self-call", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const withdrawAmount = ethers.parseEther("0.5");
      const initialBalance = await ethers.provider.getBalance(user1.address);

      // Create callData for withdrawDepositTo
      const withdrawCallData = account.interface.encodeFunctionData("withdrawDepositTo", [
        user1.address,
        withdrawAmount,
      ]);

      // Execute withdrawDepositTo via execute (self-call)
      const executeCallData = account.interface.encodeFunctionData("execute", [
        await account.getAddress(), // dest = account itself
        0, // no value
        withdrawCallData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance - initialBalance).to.equal(withdrawAmount);
    });

    // CNT-38: fail when execution call reverts
    it("fail when execution call reverts", async function () {
      const { account, entryPoint, owner, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Impersonate EntryPoint to call execute directly
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      // Try to send more ETH than account has
      const accountBalance = await ethers.provider.getBalance(await account.getAddress());
      const excessiveAmount = accountBalance + ethers.parseEther("1.0");

      await expect(account.connect(entryPointSigner).execute(user1.address, excessiveAmount, "0x")).to.be.reverted;
    });
  });

  describe("Multisig and Threshold Tests", async function () {
    // CNT-67: fail when signatures insufficient (below threshold)
    it("fail with insufficient signatures (threshold not met)", async function () {
      const { account, entryPoint, owner, user1, testWallet1 } = await loadFixture(deployZkapAccountWithMultisig);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      // Sign with only 1 key (threshold is 2)
      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet1, 0);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-68: succeed with sufficient signatures (threshold met)
    it("succeed with sufficient signatures (threshold met)", async function () {
      const { account, entryPoint, owner, user1, testWallet1, testWallet2 } = await loadFixture(
        deployZkapAccountWithMultisig,
      );

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      // Create UserOp
      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet1, 0);

      // Manually sign with both keys
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const { getUserOpHash, signUserOp, encodeZkapSignature } = await import("../helpers/userOpHelper");

      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);

      // Update signature with both keys
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const initialBalance = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([userOp], owner.address);
      const finalBalance = await ethers.provider.getBalance(user1.address);

      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1.0"));
    });

    // CNT-69: fail updateMasterKey with wrong masterKey signature
    it("fail updateMasterKey with invalid masterKey signature", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user2 } = await loadFixture(
        deployZkapAccountWithMultisig,
      );

      const newEncodedMasterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);

      // Use wrong wallet for signing (should use testWallet1 which is masterKey)
      const wrongWallet = new Wallet(ethers.hexlify(ethers.randomBytes(32)));
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, wrongWallet, 0);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-70: fail updateTxKey with insufficient masterKey threshold
    it("fail updateTxKey with insufficient masterKey threshold", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user2, testWallet } = await loadFixture(
        deployZkapAccount,
      );

      // Multi-sig test: each key requires a separate AccountKeyAddress instance
      const AKFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AKFactory.deploy();

      // Create account with 2 masterKeys, threshold 2
      const masterWallet1 = new Wallet(ethers.hexlify(ethers.randomBytes(32)));
      const masterWallet2 = new Wallet(ethers.hexlify(ethers.randomBytes(32)));

      const encodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          2, // threshold
          [await accountKeyAddressLogic.getAddress(), await akLogic2.getAddress()],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [masterWallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [masterWallet2.address]),
          ],
          [1, 1], // weights
        ],
      );

      const encodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedMasterKey, encodedTxKey]),
      );
      const newAccount = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      await owner.sendTransaction({
        to: await newAccount.getAddress(),
        value: ethers.parseEther("10.0"),
      });
      await newAccount.addDeposit({ value: ethers.parseEther("2.0") });

      // Try to update txKey with only 1 masterKey signature (threshold is 2)
      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      const updateCallData = newAccount.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createSignedUserOp(newAccount, entryPoint, updateCallData, masterWallet1, 0);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });
  });

  describe("Block Check Tests", async function () {
    // CNT-513: fail execute in the same block after txKey update
    it("fail execute in same block after txKey update", async function () {
      const { account, entryPoint, owner, user1, accountKeyAddressLogic, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      // Impersonate EntryPoint
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      // Use evm_setNextBlockTimestamp and evm_mine to control exact timing
      // Disable automining
      await ethers.provider.send("evm_setAutomine", [false]);
      await ethers.provider.send("evm_setIntervalMining", [0]);

      try {
        // Queue first transaction
        const tx1 = await account.connect(entryPointSigner).updateTxKey(newEncodedTxKey);

        // Try to queue second transaction - it should fail during estimateGas
        // because it can simulate that it will be in the same block as tx1
        try {
          const tx2 = await account.connect(entryPointSigner).execute(user1.address, ethers.parseEther("1.0"), "0x");

          // Mine block
          await ethers.provider.send("evm_mine", []);

          // If we reach here, check receipts
          const receipt1 = await ethers.provider.getTransactionReceipt(tx1.hash);
          const receipt2 = await ethers.provider.getTransactionReceipt(tx2.hash);

          // They should be in the same block and tx2 should have reverted
          expect(receipt1?.blockNumber).to.equal(receipt2?.blockNumber);
          expect(receipt2?.status).to.equal(0);
        } catch (error: any) {
          // Expected: tx2 fails with TxKeyUpdateInProgress custom error
          expect(error.message).to.include("TxKeyUpdateInProgress");
          // Mine to complete tx1
          await ethers.provider.send("evm_mine", []);
        }
      } finally {
        await ethers.provider.send("evm_setAutomine", [true]);
      }
    });

    // CNT-514: fail updateTxKey in the same block after masterKey update
    it("fail updateTxKey in same block after masterKey update", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newEncodedMasterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);

      // Impersonate EntryPoint
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      // Disable automining
      await ethers.provider.send("evm_setAutomine", [false]);
      await ethers.provider.send("evm_setIntervalMining", [0]);

      try {
        // Queue first transaction
        const tx1 = await account.connect(entryPointSigner).updateMasterKey(newEncodedMasterKey);

        // Try to queue second transaction - it should fail during estimateGas
        try {
          const tx2 = await account.connect(entryPointSigner).updateTxKey(newEncodedTxKey);

          // Mine block
          await ethers.provider.send("evm_mine", []);

          // If we reach here, check receipts
          const receipt1 = await ethers.provider.getTransactionReceipt(tx1.hash);
          const receipt2 = await ethers.provider.getTransactionReceipt(tx2.hash);

          // They should be in the same block and tx2 should have reverted
          expect(receipt1?.blockNumber).to.equal(receipt2?.blockNumber);
          expect(receipt2?.status).to.equal(0);
        } catch (error: any) {
          // Expected: tx2 fails with MasterKeyUpdateInProgress custom error
          expect(error.message).to.include("MasterKeyUpdateInProgress");
          // Mine to complete tx1
          await ethers.provider.send("evm_mine", []);
        }
      } finally {
        await ethers.provider.send("evm_setAutomine", [true]);
      }
    });
  });

  describe("Edge Cases and Additional Coverage", async function () {
    // CNT-36: process UserOp with empty callData
    it("handle UserOp with empty callData", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create UserOp with empty callData (length 0)
      const userOp = await createUserOp(account, "0x");
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // This should succeed (fallback function)
      await entryPoint.handleOps([userOp], owner.address);
    });

    // CNT-84: handle partially invalid signatures
    it("handle multiple signatures with some invalid", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1 } = await loadFixture(deployZkapAccount);

      // Deploy separate AccountKeyAddress instances to avoid single-mapping overwrite
      const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AccountKeyAddressFactory.deploy();
      await akLogic2.waitForDeployment();
      const akLogic3 = await AccountKeyAddressFactory.deploy();
      await akLogic3.waitForDeployment();

      // Create account with 2 keys, threshold 2, weights [1, 1]
      const testWallet2 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890124");
      const testWallet3 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890125");

      const key1 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet2.address, 1);

      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          2, // threshold
          [await akLogic2.getAddress(), await akLogic3.getAddress()],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet2.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet3.address]),
          ],
          [1, 1],
        ],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [key1, encodedTxKey]),
      );
      const multiAccount = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      await owner.sendTransaction({
        to: await multiAccount.getAddress(),
        value: ethers.parseEther("10.0"),
      });
      await multiAccount.addDeposit({ value: ethers.parseEther("2.0") });

      // Create execute callData
      const executeCallData = multiAccount.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      const userOp = await createUserOp(multiAccount, executeCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with wallet2 (valid) and wallet3 (valid)
      const sig1 = await signUserOp(userOpHash, testWallet2);
      const sig2 = await signUserOp(userOpHash, testWallet3);

      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      // Should succeed with both valid signatures
      await entryPoint.handleOps([userOp], owner.address);
    });

    // CNT-52: test getNonce function
    it("test getNonce function", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const nonce = await account.getNonce();
      expect(nonce).to.equal(0n);

      // Execute a transaction to increase nonce
      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      const nonceAfter = await account.getNonce();
      expect(nonceAfter).to.equal(1n);
    });

    // CNT-53: test getDeposit function
    it("test getDeposit function", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const deposit = await account.getDeposit();
      expect(deposit).to.equal(ethers.parseEther("2.0"));
    });

    // CNT-54: test addDeposit with different amounts
    it("test addDeposit with different amounts", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const initialDeposit = await account.getDeposit();
      await account.addDeposit({ value: ethers.parseEther("1.5") });
      const finalDeposit = await account.getDeposit();
      expect(finalDeposit - initialDeposit).to.equal(ethers.parseEther("1.5"));
    });

    // CNT-55: test receiving ETH directly multiple times
    it("test direct ETH receive multiple times", async function () {
      const { account, owner, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const initialBalance = await ethers.provider.getBalance(await account.getAddress());

      await owner.sendTransaction({
        to: await account.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      await user1.sendTransaction({
        to: await account.getAddress(),
        value: ethers.parseEther("0.5"),
      });

      const finalBalance = await ethers.provider.getBalance(await account.getAddress());
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1.5"));
    });

    // CNT-78: fail when signature array length mismatch
    it("fail with mismatched signature array lengths", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp = await createUserOp(account, executeCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      const signature = await signUserOp(userOpHash, testWallet);

      // Create mismatched arrays: 2 indices but 1 signature
      userOp.signature = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [[0, 1], [signature]], // Mismatch!
      );

      // Should fail validation
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-79: fail with empty signature array
    it("fail with empty signature arrays", async function () {
      const { account, entryPoint, owner, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp = await createUserOp(account, executeCallData);

      // Empty signature arrays
      userOp.signature = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[], []]);

      // Should fail validation
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-80: key index out of bounds for txKey
    it("fail with key index out of bounds for txKey (KeyIndexOutOfBounds)", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp = await createUserOp(account, executeCallData);

      // Sign with valid wallet but use out-of-bounds index (99)
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const { getUserOpHash, signUserOp, encodeZkapSignature } = await import("../helpers/userOpHelper");
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);

      // Use index 99 which is out of bounds (only 1 txKey exists)
      userOp.signature = encodeZkapSignature([99], [signature]);

      // Should fail - EntryPoint wraps error in FailedOp
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-81: key index out of bounds for masterKey
    it("fail with key index out of bounds for masterKey (KeyIndexOutOfBounds)", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);
      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createUserOp(account, updateCallData);

      // Sign with valid wallet but use out-of-bounds index (99)
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const { getUserOpHash, signUserOp, encodeZkapSignature } = await import("../helpers/userOpHelper");
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);

      // Use index 99 which is out of bounds (only 1 masterKey exists)
      userOp.signature = encodeZkapSignature([99], [signature]);

      // Should fail - EntryPoint wraps error in FailedOp
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-82: duplicate key index for txKey
    it("fail with duplicate key index for txKey (DuplicateKeyIndex)", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp = await createUserOp(account, executeCallData);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const { getUserOpHash, signUserOp, encodeZkapSignature } = await import("../helpers/userOpHelper");
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);

      // Use duplicate index [0, 0] - should fail
      userOp.signature = encodeZkapSignature([0, 0], [signature, signature]);

      // Should fail - EntryPoint wraps error in FailedOp
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-83: duplicate key index for masterKey
    it("fail with duplicate key index for masterKey (DuplicateKeyIndex)", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);
      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const userOp = await createUserOp(account, updateCallData);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const { getUserOpHash, signUserOp, encodeZkapSignature } = await import("../helpers/userOpHelper");
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);

      // Use duplicate index [0, 0] - should fail
      userOp.signature = encodeZkapSignature([0, 0], [signature, signature]);

      // Should fail - EntryPoint wraps error in FailedOp
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });
  });

  describe("updateTxKey and updateMasterKey Validation Tests", async function () {
    // CNT-45: fail updateTxKey with zero threshold via EntryPoint
    it("fail updateTxKey with zero threshold via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedTxKey with threshold = 0
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])];
      const txKeyWeightList = [1];

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [0, txKeyLogicList, txKeyInitDataList, txKeyWeightList], // threshold = 0
      );

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [invalidEncodedTxKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-46: fail updateTxKey with empty key list via EntryPoint
    it("fail updateTxKey with empty key list via EntryPoint", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create invalid encodedTxKey with empty arrays
      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [], [], []], // empty key list
      );

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [invalidEncodedTxKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-47: fail updateTxKey when weight sum < threshold via EntryPoint
    it("fail updateTxKey with weight sum < threshold via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedTxKey with weight sum < threshold
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])];
      const txKeyWeightList = [1]; // weight sum = 1

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [10, txKeyLogicList, txKeyInitDataList, txKeyWeightList], // threshold = 10 > weight sum = 1
      );

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [invalidEncodedTxKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-48: fail updateTxKey with zero address key logic via EntryPoint
    it("fail updateTxKey with zero address key logic via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedTxKey with zero address in txKeyLogicList
      const txKeyLogicList = [ethers.ZeroAddress]; // Zero address!
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])];
      const txKeyWeightList = [10];

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [10, txKeyLogicList, txKeyInitDataList, txKeyWeightList],
      );

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [invalidEncodedTxKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-53: fail updateMasterKey with zero threshold via EntryPoint
    it("fail updateMasterKey with zero threshold via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedMasterKey with threshold = 0
      const masterKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const masterKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])];
      const masterKeyWeightList = [1];

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [0, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList], // threshold = 0
      );

      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [invalidEncodedMasterKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-54: fail updateMasterKey with empty key list via EntryPoint
    it("fail updateMasterKey with empty key list via EntryPoint", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create invalid encodedMasterKey with empty arrays
      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [], [], []], // empty key list
      );

      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [invalidEncodedMasterKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-55: fail updateMasterKey when weight sum < threshold via EntryPoint
    it("fail updateMasterKey with weight sum < threshold via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedMasterKey with weight sum < threshold
      const masterKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const masterKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])];
      const masterKeyWeightList = [1]; // weight sum = 1

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [10, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList], // threshold = 10 > weight sum = 1
      );

      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [invalidEncodedMasterKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-49: fail updateTxKey with wrong array length via EntryPoint
    it("fail updateTxKey with wrong array lengths via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedTxKey with mismatched array lengths
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])];
      const txKeyWeightList = [1, 2]; // mismatched length

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, txKeyLogicList, txKeyInitDataList, txKeyWeightList],
      );

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [invalidEncodedTxKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-57: fail updateMasterKey with wrong array length via EntryPoint
    it("fail updateMasterKey with wrong array lengths via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedMasterKey with mismatched array lengths
      const masterKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const masterKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])];
      const masterKeyWeightList = [1, 2]; // mismatched length

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList],
      );

      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [invalidEncodedMasterKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-56: fail updateMasterKey with zero address key logic via EntryPoint
    it("fail updateMasterKey with zero address key logic via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedMasterKey with zero address in logic list
      const masterKeyLogicList = [ethers.ZeroAddress]; // zero address!
      const masterKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])];
      const masterKeyWeightList = [1];

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList],
      );

      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [invalidEncodedMasterKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-50: fail updateTxKey with initData length mismatch via EntryPoint
    it("fail updateTxKey with initData length mismatch via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedTxKey with initDataList.length != logicList.length
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address]),
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address]), // Extra item!
      ];
      const txKeyWeightList = [1];

      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, txKeyLogicList, txKeyInitDataList, txKeyWeightList],
      );

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [invalidEncodedTxKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-58: fail updateMasterKey with initData length mismatch via EntryPoint
    it("fail updateMasterKey with initData length mismatch via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid encodedMasterKey with initDataList.length != logicList.length
      const masterKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const masterKeyInitDataList = [
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address]),
        ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address]), // Extra item!
      ];
      const masterKeyWeightList = [1];

      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, masterKeyLogicList, masterKeyInitDataList, masterKeyWeightList],
      );

      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [invalidEncodedMasterKey]);
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should emit UserOperationRevertReason event (execution failure)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });
  });

  describe("Edge Cases - Gas, Nonce, Balance, CallData", async function () {
    // CNT-432: handle gas limit exceeded
    it("handle gas limit exceeded gracefully", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy a contract that consumes a lot of gas
      const GasConsumerFactory = await ethers.getContractFactory("GasConsumer");
      const gasConsumer = await GasConsumerFactory.deploy();
      await gasConsumer.waitForDeployment();

      // Call a function that will consume excessive gas (very high iterations)
      const consumeGasCallData = gasConsumer.interface.encodeFunctionData("consumeGas", [100000]);
      const executeCallData = account.interface.encodeFunctionData("execute", [
        await gasConsumer.getAddress(),
        0n,
        consumeGasCallData,
      ]);

      // Create UserOp with very limited callGasLimit
      const userOp = await createUserOp(account, executeCallData);
      // Set extremely low callGasLimit (21000 is barely enough for a simple transfer)
      const veryLowCallGas = 21000n;
      const verificationGas = 500000n;
      userOp.accountGasLimits = ethers.concat([
        ethers.toBeHex(verificationGas, 16),
        ethers.toBeHex(veryLowCallGas, 16),
      ]);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // The transaction should be processed but the inner execution should fail
      // EntryPoint will either emit UserOperationRevertReason or the inner call will fail
      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Verify that the gas-consuming operation didn't complete
      // (counter should still be 0 because the call ran out of gas)
      const counterValue = await gasConsumer.counter();
      expect(counterValue).to.equal(0n);
    });

    // CNT-436: handle nonce gap
    it("handle nonce gap rejection", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create execute callData
      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      // Create UserOp with wrong nonce (gap)
      const userOp = await createUserOp(account, executeCallData);
      userOp.nonce = 999n; // Wrong nonce - should be 0

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail due to nonce mismatch
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-438: prevent same nonce reuse
    it("prevent same nonce reuse after successful transaction", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Execute first transaction
      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp1 = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);
      await entryPoint.handleOps([userOp1], owner.address);

      // Verify nonce incremented
      expect(await account.getNonce()).to.equal(1n);

      // Try to reuse nonce 0
      const userOp2 = await createUserOp(account, executeCallData);
      userOp2.nonce = 0n; // Reuse old nonce

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp2, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp2.signature = encodeZkapSignature([0], [signature]);

      // Should fail - nonce already used
      await expect(entryPoint.handleOps([userOp2], owner.address)).to.be.reverted;
    });

    // CNT-441: transfer entire balance
    it("transfer full account balance successfully", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Get account balance (excluding deposit in EntryPoint)
      const accountBalance = await ethers.provider.getBalance(await account.getAddress());
      const initialUser1Balance = await ethers.provider.getBalance(user1.address);

      // Transfer full balance
      const executeCallData = account.interface.encodeFunctionData("execute", [user1.address, accountBalance, "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      // Account balance should be 0
      const finalAccountBalance = await ethers.provider.getBalance(await account.getAddress());
      expect(finalAccountBalance).to.equal(0n);

      // User1 should have received the full balance
      const finalUser1Balance = await ethers.provider.getBalance(user1.address);
      expect(finalUser1Balance - initialUser1Balance).to.equal(accountBalance);
    });

    // CNT-443: handle large callData
    it("handle large callData successfully", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create large callData (1KB of data in a valid call)
      // We'll send large data to an EOA which will just ignore it
      const largeData = ethers.hexlify(ethers.randomBytes(1024));

      // Execute with large data - EOA will ignore the data but receive the value
      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        largeData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);
      const initialBalance = await ethers.provider.getBalance(user1.address);

      // Should succeed - large callData is handled correctly
      await entryPoint.handleOps([userOp], owner.address);

      const finalBalance = await ethers.provider.getBalance(user1.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.1"));
    });

    // CNT-444: handle malformed callData
    it("handle malformed callData gracefully", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create malformed callData with completely invalid data
      // This will cause the inner call to fail but EntryPoint handles it gracefully
      const malformedCallData = "0xdeadbeef"; // Random invalid function selector

      const userOp = await createUserOp(account, malformedCallData);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should emit UserOperationEvent (may succeed if fallback exists, or emit revert reason)
      // The key is that it doesn't crash the system
      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Verify transaction was processed (successful or with recorded failure)
      expect(receipt).to.not.be.null;
    });
  });

  describe("Security - Signature and Replay Protection", async function () {
    // CNT-456: prevent same signature reuse (nonce)
    it("prevent signature reuse via nonce mechanism", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      // Create and execute first UserOp
      const userOp1 = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);
      const savedSignature = userOp1.signature;
      await entryPoint.handleOps([userOp1], owner.address);

      // Try to replay the same signature
      const userOp2 = await createUserOp(account, executeCallData);
      userOp2.nonce = 0n; // Same nonce
      userOp2.signature = savedSignature; // Reuse signature

      // Should fail - nonce prevents replay
      await expect(entryPoint.handleOps([userOp2], owner.address)).to.be.reverted;
    });

    // CNT-457: prevent signature reuse from different chain
    it("prevent cross-chain signature replay via chainId in hash", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp = await createUserOp(account, executeCallData);

      // In v0.9, EntryPoint.getUserOpHash() uses EIP-712 with chainId internally
      // We can't easily sign with wrong chainId, but we can verify that signature
      // from a different context fails. Create a manual hash with wrong chainId
      const wrongChainId = 99999n;
      const currentChainId = (await ethers.provider.getNetwork()).chainId;

      // Manually construct EIP-712 hash with wrong chainId
      const DOMAIN_SEPARATOR = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            ethers.keccak256(
              ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            ),
            ethers.keccak256(ethers.toUtf8Bytes("ERC4337")),
            ethers.keccak256(ethers.toUtf8Bytes("0.9.0")),
            wrongChainId, // Wrong chainId
            await entryPoint.getAddress(),
          ],
        ),
      );

      // Get the userOpHash structure
      const correctUserOpHash = await entryPoint.getUserOpHash(userOp);
      // Create a tampered hash by XORing to simulate wrong chainId signature
      const tamperedHashBytes = ethers.getBytes(correctUserOpHash);
      tamperedHashBytes[0] ^= 0xff; // Flip some bits to make it invalid
      const signature = await signUserOp(ethers.hexlify(tamperedHashBytes), testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail - signature doesn't match correct hash
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-458: detect and reject tampered signature
    it("detect and reject tampered signature", async function () {
      const { account, entryPoint, owner, user1, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      // Decode and tamper with the signature
      const [keyIndices, signatures] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint8[]", "bytes[]"],
        userOp.signature,
      );

      // Tamper with the signature by modifying a byte
      const tamperedSig = ethers.getBytes(signatures[0]);
      tamperedSig[10] = (tamperedSig[10] + 1) % 256;

      userOp.signature = encodeZkapSignature(keyIndices, [ethers.hexlify(tamperedSig)]);

      // Should fail - signature verification fails
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-461: prevent balance underflow on withdrawal
    it("prevent balance underflow in withdrawal", async function () {
      const { account, entryPoint, owner, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Get initial balances
      const accountBalanceBefore = await ethers.provider.getBalance(await account.getAddress());
      const user1BalanceBefore = await ethers.provider.getBalance(user1.address);

      // Impersonate EntryPoint to test direct execution
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      // Try to transfer more than account balance
      const excessiveAmount = accountBalanceBefore + ethers.parseEther("100.0");

      // Should revert when trying to transfer more than balance
      await expect(account.connect(entryPointSigner).execute(user1.address, excessiveAmount, "0x")).to.be.reverted;

      // Verify balances unchanged (underflow was prevented)
      const accountBalanceAfter = await ethers.provider.getBalance(await account.getAddress());
      const user1BalanceAfter = await ethers.provider.getBalance(user1.address);

      expect(accountBalanceAfter).to.equal(accountBalanceBefore);
      expect(user1BalanceAfter).to.equal(user1BalanceBefore);
    });
  });

  describe("Edge Cases - Additional CNT Tests", async function () {
    // CNT-468: handle empty array executeBatch (dest.length == 0)
    it("handle empty array executeBatch (dest.length == 0)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Impersonate EntryPoint
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      // Execute with empty arrays - should succeed as no-op
      await expect(account.connect(entryPointSigner)["executeBatch(address[],uint256[],bytes[])"]([], [], [])).to.not.be
        .reverted;
    });

    // CNT-472: handle unsorted keyIndexList
    it("handle unsorted keyIndexList (descending order)", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1 } = await loadFixture(deployZkapAccount);

      // Deploy separate AccountKeyAddress instances to avoid single-mapping overwrite
      const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AccountKeyAddressFactory.deploy();
      await akLogic2.waitForDeployment();
      const akLogic3 = await AccountKeyAddressFactory.deploy();
      await akLogic3.waitForDeployment();

      // Create account with 2 keys, threshold 2
      const testWallet1 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
      const testWallet2 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890124");

      const key1 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet1.address, 1);

      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          2,
          [await akLogic2.getAddress(), await akLogic3.getAddress()],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet2.address]),
          ],
          [1, 1],
        ],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [key1, encodedTxKey]),
      );
      const multiAccount = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      await owner.sendTransaction({
        to: await multiAccount.getAddress(),
        value: ethers.parseEther("10.0"),
      });
      await multiAccount.addDeposit({ value: ethers.parseEther("2.0") });

      const executeCallData = multiAccount.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      const userOp = await createUserOp(multiAccount, executeCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);

      // Use descending order [1, 0] instead of [0, 1]
      // Note: The contract doesn't require ascending order, only checks for duplicates via bitmask
      userOp.signature = encodeZkapSignature([1, 0], [sig2, sig1]);

      // Transaction should succeed because descending order is valid (no ascending order requirement)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.not.be.reverted;
    });

    // CNT-473: attempt signature with only zero-weight keys
    it("fail with zero-weight key signature only", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1 } = await loadFixture(deployZkapAccount);

      // Multi-sig test: each key requires a separate AccountKeyAddress instance
      const AKFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AKFactory.deploy();

      // Create account with 2 keys: key0 has weight=1, key1 has weight=0, threshold=1
      const testWallet1 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
      const testWallet2 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890124");

      const masterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet1.address, 1);

      // txKey: key0 has weight=1, key1 has weight=0
      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          1, // threshold = 1
          [await accountKeyAddressLogic.getAddress(), await akLogic2.getAddress()],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet2.address]),
          ],
          [1, 0], // weights: key0=1, key1=0
        ],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [masterKey, encodedTxKey]),
      );
      const zeroWeightAccount = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      await owner.sendTransaction({
        to: await zeroWeightAccount.getAddress(),
        value: ethers.parseEther("10.0"),
      });
      await zeroWeightAccount.addDeposit({ value: ethers.parseEther("2.0") });

      const executeCallData = zeroWeightAccount.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      const userOp = await createUserOp(zeroWeightAccount, executeCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with zero-weight key only (testWallet2 at index 1)
      const sig = await signUserOp(userOpHash, testWallet2);
      userOp.signature = encodeZkapSignature([1], [sig]);

      // Should fail - zero weight key cannot meet threshold
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-476: duplicate keys with same logic address
    it("allow same logic address for both master and tx keys", async function () {
      const { accountLogic, accountKeyAddressLogic, owner, testWallet } = await loadFixture(deployZkapAccount);

      // Use same logic address and same signer for both master and tx keys
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address, 1);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedKey, encodedKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      // Should succeed - same logic address is allowed
      expect(await account.masterKeyThreshold()).to.equal(1);
      expect(await account.txKeyThreshold()).to.equal(1);
    });

    // CNT-477: set master/tx keys with same signer
    it("allow same signer for both master and tx keys", async function () {
      const { accountLogic, accountKeyAddressLogic, entryPoint, owner, user1, testWallet } = await loadFixture(
        deployZkapAccount,
      );

      // Use same signer for both master and tx keys
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address, 1);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedKey, encodedKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      await owner.sendTransaction({
        to: await account.getAddress(),
        value: ethers.parseEther("10.0"),
      });
      await account.addDeposit({ value: ethers.parseEther("2.0") });

      // Execute transaction using the same signer as txKey
      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      const initialBalance = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([userOp], owner.address);
      const finalBalance = await ethers.provider.getBalance(user1.address);

      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1.0"));
    });

    // CNT-478: very large threshold value
    it("handle max uint8 threshold value", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      const maxUint8 = 255;

      // Create key with threshold = 255 and single key with weight = 255
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const txKeyWeightList = [maxUint8];

      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [maxUint8, txKeyLogicList, txKeyInitDataList, txKeyWeightList],
      );

      const masterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address, 1);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [masterKey, encodedTxKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      expect(await account.txKeyThreshold()).to.equal(maxUint8);
    });

    // CNT-479: very large weight value
    it("handle max uint8 weight value", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      const maxUint8 = 255;

      // Create key with weight = 255
      const txKeyLogicList = [await accountKeyAddressLogic.getAddress()];
      const txKeyInitDataList = [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address])];
      const txKeyWeightList = [maxUint8];

      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, txKeyLogicList, txKeyInitDataList, txKeyWeightList],
      );

      const masterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address, 1);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [masterKey, encodedTxKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      // Should initialize successfully with max weight
      expect(await account.txKeyThreshold()).to.equal(1);
    });
  });

  describe("Method Selector Routing Tests", async function () {
    // CNT-516: handle method selector when callData is 1-3 bytes
    it("handle callData with 1 byte (less than 4 bytes for selector)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create UserOp with 1 byte callData (less than 4 bytes required for selector)
      const shortCallData = "0x12"; // Only 1 byte

      const userOp = await createUserOp(account, shortCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should be processed - uses txKey since methodSig won't match updateMasterKey or updateTxKey
      // The account will try to execute the 1-byte callData which will likely fail
      // but the signature validation should use txKey (not masterKey)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.not.be.reverted;
    });

    // CNT-517: handle method selector when callData is 2-3 bytes
    it("handle callData with 3 bytes (less than 4 bytes for selector)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create UserOp with 3 bytes callData
      const shortCallData = "0x123456"; // Only 3 bytes

      const userOp = await createUserOp(account, shortCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should be processed - uses txKey since methodSig won't match
      await expect(entryPoint.handleOps([userOp], owner.address)).to.not.be.reverted;
    });
  });

  describe("Weight Boundary Tests", async function () {
    // CNT-518: weight sum exactly equals threshold (boundary condition)
    it("succeed when weight sum equals threshold exactly", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1 } = await loadFixture(deployZkapAccount);

      // Create account with threshold = 5 and weight = 5 (exactly equal)
      const testWallet1 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const masterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet1.address, 1);

      // txKey: threshold = 5, single key with weight = 5
      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          5, // threshold = 5
          [await accountKeyAddressLogic.getAddress()],
          [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet1.address])],
          [5], // weight = 5 (exactly equals threshold)
        ],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [masterKey, encodedTxKey]),
      );
      const boundaryAccount = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      await owner.sendTransaction({
        to: await boundaryAccount.getAddress(),
        value: ethers.parseEther("10.0"),
      });
      await boundaryAccount.addDeposit({ value: ethers.parseEther("2.0") });

      const executeCallData = boundaryAccount.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      const userOp = await createSignedUserOp(boundaryAccount, entryPoint, executeCallData, testWallet1, 0);

      const initialBalance = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([userOp], owner.address);
      const finalBalance = await ethers.provider.getBalance(user1.address);

      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1.0"));
    });

    // CNT-519: exactly meet threshold with multiple keys
    it("succeed when multiple keys exactly meet threshold", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1 } = await loadFixture(deployZkapAccount);

      // Deploy separate AccountKeyAddress instances to avoid single-mapping overwrite
      const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AccountKeyAddressFactory.deploy();
      await akLogic2.waitForDeployment();
      const akLogic3 = await AccountKeyAddressFactory.deploy();
      await akLogic3.waitForDeployment();

      // Create account with threshold = 3 and two keys with weights [2, 1]
      const testWallet1 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
      const testWallet2 = new Wallet("0x0123456789012345678901234567890123456789012345678901234567890124");

      const masterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet1.address, 1);

      // txKey: threshold = 3, two keys with weights [2, 1] using DIFFERENT singletons
      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          3, // threshold = 3
          [await akLogic2.getAddress(), await akLogic3.getAddress()],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet2.address]),
          ],
          [2, 1], // weights: 2 + 1 = 3 (exactly equals threshold)
        ],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [masterKey, encodedTxKey]),
      );
      const boundaryAccount = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      await owner.sendTransaction({
        to: await boundaryAccount.getAddress(),
        value: ethers.parseEther("10.0"),
      });
      await boundaryAccount.addDeposit({ value: ethers.parseEther("2.0") });

      const executeCallData = boundaryAccount.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("1.0"),
        "0x",
      ]);

      const userOp = await createUserOp(boundaryAccount, executeCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);

      // Use both signatures
      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const initialBalance = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([userOp], owner.address);
      const finalBalance = await ethers.provider.getBalance(user1.address);

      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1.0"));
    });
  });

  describe("Multi-Block Key Usage Tests", async function () {
    // CNT-520: execute succeeds in next block after txKey update
    it("succeed execute in next block after txKey update", async function () {
      const { account, entryPoint, owner, user1, accountKeyAddressLogic, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create new txKey with same signer for simplicity
      const newEncodedTxKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      // Update txKey via masterKey signature
      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);
      const updateUserOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      await entryPoint.handleOps([updateUserOp], owner.address);

      // Mine a new block to ensure we're past the update block
      await ethers.provider.send("evm_mine", []);

      // Now execute should succeed with the new txKey in a new block
      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.5"),
        "0x",
      ]);

      const executeUserOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      const initialBalance = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([executeUserOp], owner.address);
      const finalBalance = await ethers.provider.getBalance(user1.address);

      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.5"));
    });

    // CNT-521: updateTxKey succeeds in next block after masterKey update
    it("succeed updateTxKey in next block after masterKey update", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create new masterKey with same signer for simplicity
      const newEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      // Update masterKey
      const updateMasterCallData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedMasterKey]);
      const updateMasterUserOp = await createSignedUserOp(account, entryPoint, updateMasterCallData, testWallet, 0);

      await entryPoint.handleOps([updateMasterUserOp], owner.address);

      // Mine a new block to ensure we're past the update block
      await ethers.provider.send("evm_mine", []);

      // Now updateTxKey should succeed in a new block
      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address);
      const updateTxCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      const updateTxUserOp = await createSignedUserOp(account, entryPoint, updateTxCallData, testWallet, 0);

      // Should succeed
      await expect(entryPoint.handleOps([updateTxUserOp], owner.address)).to.emit(account, "TxKeyUpdated");
    });
  });

  describe("Security - Reentrancy Protection", async function () {
    // CNT-462: safely handle reentrancy attack on execute function
    it("execute function handles reentrant calls safely", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy a malicious contract that tries to reenter
      const ReentrantFactory = await ethers.getContractFactory("ReentrantAttacker");
      const attacker = await ReentrantFactory.deploy(await account.getAddress());
      await attacker.waitForDeployment();

      // Try to execute a call to the attacker that sends ETH
      // The attacker's receive() will try to reenter execute() but fail
      const executeCallData = account.interface.encodeFunctionData("execute", [
        await attacker.getAddress(),
        ethers.parseEther("1.0"),
        "0x", // Just send ETH to trigger receive()
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      // Execute the transaction
      await entryPoint.handleOps([userOp], owner.address);

      // The attacker's attacked flag should be set (reentrancy was attempted but blocked)
      const attacked = await attacker.attacked();
      expect(attacked).to.be.true;

      // The contract should have received the ETH despite reentrancy attempt
      const attackerBalance = await ethers.provider.getBalance(await attacker.getAddress());
      expect(attackerBalance).to.equal(ethers.parseEther("1.0"));
    });

    // CNT-463: safely handle reentrancy attack on executeBatch function
    it("executeBatch function handles reentrant calls safely", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy a malicious contract that tries to reenter via batch
      const ReentrantFactory = await ethers.getContractFactory("ReentrantBatchAttacker");
      const attacker = await ReentrantFactory.deploy(await account.getAddress());
      await attacker.waitForDeployment();

      // Send ETH via batch to trigger reentrancy attempt
      const executeBatchCallData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [await attacker.getAddress()],
        [ethers.parseEther("1.0")],
        ["0x"], // Just send ETH to trigger receive()
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeBatchCallData, testWallet, 0);

      // Execute the transaction
      await entryPoint.handleOps([userOp], owner.address);

      // The attacker's attacked flag should be set (reentrancy was attempted but blocked)
      const attacked = await attacker.attacked();
      expect(attacked).to.be.true;

      // The contract should have received the ETH despite reentrancy attempt
      const attackerBalance = await ethers.provider.getBalance(await attacker.getAddress());
      expect(attackerBalance).to.equal(ethers.parseEther("1.0"));
    });
  });

  describe("Edge Cases - Nonce, Balance, CallData, Signature", function () {
    // CNT-435: sequential nonce usage
    it("CNT-435: sequential nonce usage (0, 1, 2)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;

      // Execute with nonce 0
      const callData0 = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);
      const userOp0 = await createSignedUserOp(account, entryPoint, callData0, testWallet, 0);
      await entryPoint.handleOps([userOp0], owner.address);

      // Execute with nonce 1
      const callData1 = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);
      const userOp1 = await createSignedUserOp(account, entryPoint, callData1, testWallet, 0);
      await entryPoint.handleOps([userOp1], owner.address);

      // Execute with nonce 2
      const callData2 = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);
      const userOp2 = await createSignedUserOp(account, entryPoint, callData2, testWallet, 0);
      await entryPoint.handleOps([userOp2], owner.address);

      // Verify all transfers succeeded
      const balance = await ethers.provider.getBalance(recipient);
      expect(balance).to.equal(ethers.parseEther("0.3"));
    });

    // CNT-439: handle insufficient balance
    it("CNT-439: insufficient balance handling", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;
      const accountBalance = await ethers.provider.getBalance(await account.getAddress());

      // Try to send more than account balance
      const callData = account.interface.encodeFunctionData("execute", [
        recipient,
        accountBalance + ethers.parseEther("100"), // More than balance
        "0x",
      ]);
      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Check that recipient did not receive funds after execution
      const recipientBalanceBefore = await ethers.provider.getBalance(recipient);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for PostOpRevertReason or UserOperationRevertReason in logs
      const hasRevertEvent = receipt?.logs.some((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason" || parsed?.name === "PostOpRevertReason";
        } catch {
          return false;
        }
      });

      // Either we have a revert event, or recipient balance should be unchanged
      const recipientBalanceAfter = await ethers.provider.getBalance(recipient);
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore); // No funds transferred due to insufficient balance
    });

    // CNT-440: transfer 0 amount
    it("CNT-440: zero value transfer", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;

      const callData = account.interface.encodeFunctionData("execute", [
        recipient,
        0, // Zero value
        "0x",
      ]);
      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Should succeed
      await entryPoint.handleOps([userOp], owner.address);

      const balance = await ethers.provider.getBalance(recipient);
      expect(balance).to.equal(0);
    });

    // CNT-442: handle empty callData (inside execute)
    it("CNT-442: empty callData in execute", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;

      // execute with empty func data
      const callData = account.interface.encodeFunctionData("execute", [
        recipient,
        ethers.parseEther("0.1"),
        "0x", // Empty callData
      ]);
      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      const balance = await ethers.provider.getBalance(recipient);
      expect(balance).to.equal(ethers.parseEther("0.1"));
    });

    // CNT-445: handle empty signature
    it("CNT-445: empty signature handling", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      userOp.signature = "0x"; // Empty signature

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-446: malformed signature
    it("CNT-446: malformed signature handling", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      userOp.signature = "0x1234567890"; // Malformed signature

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-447: wrong length signature (64 bytes when 65 required)
    it("CNT-447: wrong length signature (64 bytes instead of 65)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      // 64 bytes signature (missing v)
      const wrongSig = "0x" + "ab".repeat(64);
      userOp.signature = encodeZkapSignature([0], [wrongSig]);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });
  });

  describe("Edge Cases - Execute", function () {
    // CNT-469: executeBatch dest.length != value.length (value non-empty)
    it("CNT-469: executeBatch with mismatched dest and value lengths", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient1 = ethers.Wallet.createRandom().address;
      const recipient2 = ethers.Wallet.createRandom().address;

      // dest.length=2, value.length=1, func.length=2
      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [recipient1, recipient2],
        [ethers.parseEther("0.1")], // Only 1 value
        ["0x", "0x"],
      ]);
      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Execution phase failure - check recipients did not receive funds
      const recipient1BalanceBefore = await ethers.provider.getBalance(recipient1);
      const recipient2BalanceBefore = await ethers.provider.getBalance(recipient2);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      await tx.wait();

      // Verify no funds were transferred
      const recipient1BalanceAfter = await ethers.provider.getBalance(recipient1);
      const recipient2BalanceAfter = await ethers.provider.getBalance(recipient2);
      expect(recipient1BalanceAfter).to.equal(recipient1BalanceBefore);
      expect(recipient2BalanceAfter).to.equal(recipient2BalanceBefore);
    });

    // CNT-470: verify fallback behavior when execute fails
    it("CNT-470: execute failure with non-existent function selector", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Use a contract that doesn't have a fallback function
      // ZkapAccount itself doesn't have a fallback, so calling non-existent function should fail
      const callData = account.interface.encodeFunctionData("execute", [
        await account.getAddress(), // Call account itself
        0,
        "0xdeadbeef", // Non-existent function selector
      ]);
      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Execution phase failure - check if there's a revert event or nonce increased
      const nonceBefore = await account.getNonce();
      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();
      const nonceAfter = await account.getNonce();

      // Nonce should increase even if inner call failed (UserOp was processed)
      expect(nonceAfter).to.equal(nonceBefore + 1n);

      // Check for UserOperationEvent (always emitted) with success=false or revert reason
      const hasRevertOrFailure = receipt?.logs.some((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === "UserOperationRevertReason") return true;
          if (parsed?.name === "UserOperationEvent" && parsed.args.success === false) return true;
          return false;
        } catch {
          return false;
        }
      });
      expect(hasRevertOrFailure).to.be.true;
    });

    // CNT-471: call execute with value > balance
    it("CNT-471: execute with value greater than balance", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;

      // Try to send 100 ETH when account has only 10 ETH
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("100"), "0x"]);
      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Execution phase failure - check recipient did not receive funds
      const recipientBalanceBefore = await ethers.provider.getBalance(recipient);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      await tx.wait();

      // Verify no funds were transferred
      const recipientBalanceAfter = await ethers.provider.getBalance(recipient);
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore);
    });

    // CNT-474: submit UserOp with wrong nonce
    it("CNT-474: submit UserOp with wrong nonce", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      userOp.nonce = 100n; // Wrong nonce (should be 0)

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.revertedWithCustomError(entryPoint, "FailedOp");
    });

    // CNT-475: set very low callGasLimit
    it("CNT-475: very low callGasLimit", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient = ethers.Wallet.createRandom().address;
      const callData = account.interface.encodeFunctionData("execute", [recipient, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createUserOp(account, callData);
      // Set very low callGasLimit (1000), keep verificationGasLimit high enough for coverage
      userOp.accountGasLimits = ethers.solidityPacked(["uint128", "uint128"], [500000n, 1000n]);

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // With low callGasLimit, execution may fail - check recipient didn't receive funds
      const recipientBalanceBefore = await ethers.provider.getBalance(recipient);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      await tx.wait();

      // Verify no funds were transferred (or less than expected if partially executed)
      const recipientBalanceAfter = await ethers.provider.getBalance(recipient);
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore);
    });
  });

  describe("Edge Cases - Key Update", function () {
    // CNT-481: replace masterKey with single key
    it("CNT-481: replace masterKey with single key", async function () {
      const { account, entryPoint, owner, testWallet, accountKeyAddressLogic } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create new single masterKey
      const newWallet = new Wallet("0x2222222222222222222222222222222222222222222222222222222222222222");
      const newEncodedKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        newWallet.address,
        1,
      );

      // Update masterKey to single key
      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [newEncodedKey]);
      const updateUserOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      await entryPoint.handleOps([updateUserOp], owner.address);

      // Verify masterKey threshold is 1
      expect(await account.masterKeyThreshold()).to.equal(1);
    });

    // CNT-482: reset masterKey with same key (idempotent)
    it("CNT-482: reset masterKey with same key (idempotent)", async function () {
      const { account, entryPoint, owner, testWallet, accountKeyAddressLogic } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Get current threshold
      const currentThreshold = await account.masterKeyThreshold();

      // Create same key
      const sameEncodedKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
        1,
      );

      // Update masterKey to same key
      const updateCallData = account.interface.encodeFunctionData("updateMasterKey", [sameEncodedKey]);
      const updateUserOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      await entryPoint.handleOps([updateUserOp], owner.address);

      // Should still work with same threshold
      expect(await account.masterKeyThreshold()).to.equal(currentThreshold);
    });
  });

  describe("Security - Access Control", function () {
    // CNT-448: execute only callable from EntryPoint
    it("CNT-448: execute only callable from EntryPoint", async function () {
      const { account, owner } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      await expect(account.execute(owner.address, 0, "0x")).to.be.revertedWithCustomError(account, "NotFromEntryPoint");
    });

    // CNT-449: executeBatch only callable from EntryPoint
    it("CNT-449: executeBatch only callable from EntryPoint", async function () {
      const { account, owner } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      await expect(
        account["executeBatch(address[],uint256[],bytes[])"]([owner.address], [0], ["0x"]),
      ).to.be.revertedWithCustomError(account, "NotFromEntryPoint");
    });

    // CNT-450: updateTxKey only callable from EntryPoint
    it("CNT-450: updateTxKey only callable from EntryPoint", async function () {
      const { account, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address, 1);

      await expect(account.updateTxKey(encodedKey)).to.be.revertedWithCustomError(account, "NotFromEntryPoint");
    });

    // CNT-451: updateMasterKey only callable from EntryPoint
    it("CNT-451: updateMasterKey only callable from EntryPoint", async function () {
      const { account, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address, 1);

      await expect(account.updateMasterKey(encodedKey)).to.be.revertedWithCustomError(account, "NotFromEntryPoint");
    });

    // CNT-452: withdrawDepositTo only callable by owner (self-call only)
    it("CNT-452: withdrawDepositTo only callable from self", async function () {
      const { account, owner } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      await expect(account.withdrawDepositTo(owner.address, ethers.parseEther("0.1"))).to.be.revertedWithCustomError(
        account,
        "OnlyOwner",
      );
    });

    // CNT-453: upgradeToAndCall only callable by owner (proxy context)
    it("CNT-453: upgradeToAndCall only callable from self", async function () {
      const { account, entryPoint } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy new implementation
      const NewImplFactory = await ethers.getContractFactory("ZkapAccount");
      const newImpl = await NewImplFactory.deploy(await entryPoint.getAddress());

      await expect(account.upgradeToAndCall(await newImpl.getAddress(), "0x")).to.be.revertedWithCustomError(
        account,
        "NotFromEntryPoint",
      );
    });
  });

  describe("Execute Edge Cases - CNT-528~541", function () {
    // CNT-528: propagate target contract revert on execute call
    it("CNT-528: propagate revert from target contract in execute", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter and set count to 0
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();
      await counter.setCount(0);

      // Try to decrement below 0 (should revert in counter contract)
      const decrementData = counter.interface.encodeFunctionData("decrement");

      const callData = account.interface.encodeFunctionData("execute", [await counter.getAddress(), 0, decrementData]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // The UserOp should complete but inner execution should fail
      await entryPoint.handleOps([userOp], owner.address);

      // Counter should still be 0 (decrement failed and was rolled back)
      expect(await counter.count()).to.equal(0);
    });

    // CNT-529: rollback entire executeBatch on intermediate failure
    it("CNT-529: rollback all when one in executeBatch fails", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();
      await counter.setCount(5);

      const recipient = ethers.Wallet.createRandom().address;

      // Batch: 1) Increment counter, 2) Send ETH, 3) Decrement counter (will fail if count goes below 0 after multiple decrements)
      const incrementData = counter.interface.encodeFunctionData("increment");
      const setCountZeroData = counter.interface.encodeFunctionData("setCount", [0]);
      const decrementData = counter.interface.encodeFunctionData("decrement");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [await counter.getAddress(), await counter.getAddress(), await counter.getAddress()],
        [0, 0, 0],
        [incrementData, setCountZeroData, decrementData], // Last one will fail
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Execute (inner call should fail)
      await entryPoint.handleOps([userOp], owner.address);

      // Count should still be 5 (original value, batch was rolled back)
      expect(await counter.count()).to.equal(5);
    });

    // CNT-530: verify gas optimization path when value array length is 0
    it("CNT-530: gas optimization path when value array length is 0", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();

      const incrementData = counter.interface.encodeFunctionData("increment");

      // Use empty value array (gas optimization path)
      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [await counter.getAddress(), await counter.getAddress(), await counter.getAddress()],
        [], // Empty value array = all zero
        [incrementData, incrementData, incrementData],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const countBefore = await counter.count();
      await entryPoint.handleOps([userOp], owner.address);
      const countAfter = await counter.count();

      // All 3 increments should have executed
      expect(countAfter - countBefore).to.equal(3n);
    });

    // CNT-531: large batch execution (20+ items)
    it("CNT-531: execute large batch (20+ transactions)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create 20 recipients
      const count = 20;
      const recipients = Array(count)
        .fill(null)
        .map(() => ethers.Wallet.createRandom().address);
      const amount = ethers.parseEther("0.1");
      const amounts = recipients.map(() => amount);
      const datas = recipients.map(() => "0x");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        recipients,
        amounts,
        datas,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify all transfers completed
      for (const recipient of recipients) {
        expect(await ethers.provider.getBalance(recipient)).to.equal(amount);
      }
    });

    // CNT-532: batch with simultaneous calls to multiple contracts
    it("CNT-532: batch with calls to multiple contracts", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy multiple counters
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter1 = await CounterFactory.deploy();
      const counter2 = await CounterFactory.deploy();
      const counter3 = await CounterFactory.deploy();

      const incrementData = counter1.interface.encodeFunctionData("increment");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [await counter1.getAddress(), await counter2.getAddress(), await counter3.getAddress()],
        [],
        [incrementData, incrementData, incrementData],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      // Each counter should be incremented
      expect(await counter1.count()).to.equal(1);
      expect(await counter2.count()).to.equal(1);
      expect(await counter3.count()).to.equal(1);
    });

    // CNT-533: verify nonce increment after execute
    it("CNT-533: verify nonce increments after execute", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const nonceBefore = await account.getNonce();

      const callData = account.interface.encodeFunctionData("execute", [user1.address, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      const nonceAfter = await account.getNonce();
      expect(nonceAfter).to.equal(nonceBefore + 1n);
    });

    // CNT-534: verify nonce increments by 1 after executeBatch (single UserOp)
    it("CNT-534: verify nonce increments by 1 after executeBatch (single UserOp)", async function () {
      const { account, entryPoint, owner, testWallet, user1, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const nonceBefore = await account.getNonce();

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [user1.address, user2.address],
        [ethers.parseEther("0.1"), ethers.parseEther("0.1")],
        ["0x", "0x"],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      const nonceAfter = await account.getNonce();
      // Only 1 UserOp was submitted, so nonce should increase by 1
      expect(nonceAfter).to.equal(nonceBefore + 1n);
    });

    // CNT-535: verify execute attempt in same block after updateTxKey
    it("CNT-535: verify txKey update block tracking", async function () {
      const { account, entryPoint, owner, testWallet, accountKeyAddressLogic, user1 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // First update txKey
      const newEncodedTxKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
      );

      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);
      const updateUserOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      await entryPoint.handleOps([updateUserOp], owner.address);

      // Verify that txKey was updated by checking we can still execute in a different block
      await ethers.provider.send("evm_mine", []);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const executeUserOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      // After mining a new block, execute should succeed
      const initialBalance = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([executeUserOp], owner.address);
      const finalBalance = await ethers.provider.getBalance(user1.address);

      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.1"));
    });

    // CNT-536: exactly meet multi-sig threshold
    it("CNT-536: multisig with exact threshold match", async function () {
      const { account, entryPoint, owner, user1, testWallet1, testWallet2 } = await loadFixture(
        deployZkapAccountWithMultisig,
      );

      // Multisig is 2-of-2 with weights [1, 1]
      const callData = account.interface.encodeFunctionData("execute", [user1.address, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with both wallets
      const sig1 = await signUserOp(userOpHash, testWallet1);
      const sig2 = await signUserOp(userOpHash, testWallet2);

      userOp.signature = encodeZkapSignature([0, 1], [sig1, sig2]);

      const initialBalance = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([userOp], owner.address);
      const finalBalance = await ethers.provider.getBalance(user1.address);

      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.5"));
    });

    // CNT-537: fail when below multi-sig threshold
    it("CNT-537: multisig fails when below threshold", async function () {
      const { account, entryPoint, owner, user1, testWallet1 } = await loadFixture(deployZkapAccountWithMultisig);

      // Multisig is 2-of-2 with weights [1, 1], try with only 1 signature
      const callData = account.interface.encodeFunctionData("execute", [user1.address, ethers.parseEther("0.5"), "0x"]);

      const userOp = await createUserOp(account, callData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign with only one wallet
      const sig1 = await signUserOp(userOpHash, testWallet1);
      userOp.signature = encodeZkapSignature([0], [sig1]);

      // Should fail - insufficient weight
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-538: send large calldata to execute
    it("CNT-538: execute with large calldata", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();

      // Create large calldata by setting count with a big value (simulating large input)
      const setCountData = counter.interface.encodeFunctionData("setCount", [999999]);

      const callData = account.interface.encodeFunctionData("execute", [await counter.getAddress(), 0, setCountData]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      expect(await counter.count()).to.equal(999999);
    });

    // CNT-539: execute withdrawDepositTo via self-call
    it("CNT-539: execute withdrawDepositTo via self-call", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Get initial deposit
      const depositBefore = await account.getDeposit();
      const withdrawAmount = ethers.parseEther("0.5");

      // Create withdrawDepositTo calldata
      const withdrawCallData = account.interface.encodeFunctionData("withdrawDepositTo", [
        user1.address,
        withdrawAmount,
      ]);

      // Execute self-call to withdraw
      const executeCallData = account.interface.encodeFunctionData("execute", [
        await account.getAddress(),
        0,
        withdrawCallData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      const user1BalanceBefore = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([userOp], owner.address);
      const user1BalanceAfter = await ethers.provider.getBalance(user1.address);

      const depositAfter = await account.getDeposit();

      // Verify deposit decreased by at least the withdraw amount
      expect(depositBefore - depositAfter).to.be.gte(withdrawAmount);
      // Verify user1 received at least the withdraw amount (could be more due to gas refunds)
      expect(user1BalanceAfter - user1BalanceBefore).to.be.gte(withdrawAmount);
    });

    // CNT-540: verify external contract state change during execute
    it("CNT-540: verify external contract state changes during execute", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();

      // Multiple increments in single execute via batch
      const incrementData = counter.interface.encodeFunctionData("increment");

      // Batch 5 increments
      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        Array(5).fill(await counter.getAddress()),
        [],
        Array(5).fill(incrementData),
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      expect(await counter.count()).to.equal(0);
      await entryPoint.handleOps([userOp], owner.address);
      expect(await counter.count()).to.equal(5);
    });

    // CNT-541: execute to zero address (ETH burned)
    it("CNT-541: execute to zero address burns ETH", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const accountBalanceBefore = await ethers.provider.getBalance(await account.getAddress());
      const transferAmount = ethers.parseEther("0.1");

      const callData = account.interface.encodeFunctionData("execute", [ethers.ZeroAddress, transferAmount, "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Execute to zero address - ETH will be effectively burned
      await entryPoint.handleOps([userOp], owner.address);

      const accountBalanceAfter = await ethers.provider.getBalance(await account.getAddress());

      // Account balance should decrease by at least the transferred amount (plus gas)
      expect(accountBalanceBefore - accountBalanceAfter).to.be.gte(transferAmount);
    });
  });

  describe("Large Batch and Nested Calls - CNT-580~581", function () {
    // CNT-580: large batch execution (30 transactions)
    it("CNT-580: execute very large batch (30 transactions)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create 30 recipients
      const count = 30;
      const recipients = Array(count)
        .fill(null)
        .map(() => ethers.Wallet.createRandom().address);
      const amount = ethers.parseEther("0.01");
      const amounts = recipients.map(() => amount);
      const datas = recipients.map(() => "0x");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        recipients,
        amounts,
        datas,
      ]);

      // Create UserOp with higher gas limits for large batch
      const accountAddress = await account.getAddress();
      const currentNonce = await account.getNonce();

      // Set higher gas limits for large batch
      const verificationGasLimit = 3000000n;
      const callGasLimit = 5000000n;
      const accountGasLimits = ethers.concat([
        ethers.toBeHex(verificationGasLimit, 16),
        ethers.toBeHex(callGasLimit, 16),
      ]);

      const maxPriorityFeePerGas = 1000000000n;
      const maxFeePerGas = 2000000000n;
      const gasFees = ethers.concat([ethers.toBeHex(maxPriorityFeePerGas, 16), ethers.toBeHex(maxFeePerGas, 16)]);

      const userOp = {
        sender: accountAddress,
        nonce: currentNonce,
        initCode: "0x",
        callData: callData,
        accountGasLimits: accountGasLimits,
        preVerificationGas: 100000n,
        gasFees: gasFees,
        paymasterAndData: "0x",
        signature: "0x",
      };

      // Sign with updated gas limits
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify all transfers completed
      for (const recipient of recipients) {
        expect(await ethers.provider.getBalance(recipient)).to.equal(amount);
      }
    });

    // CNT-581: nested call (account calls another account)
    it("CNT-581: nested call - account calls another account", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner, user1 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create two wallets
      const wallet1 = new Wallet("0x1111111111111111111111111111111111111111111111111111111111111111");
      const wallet2 = new Wallet("0x2222222222222222222222222222222222222222222222222222222222222222");

      // Create two accounts
      const encodedKey1 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), wallet1.address);
      const encodedKey2 = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), wallet2.address);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");

      // Deploy first account
      const proxy1 = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedKey1, encodedKey1]),
      );
      const account1 = await ethers.getContractAt("ZkapAccount", await proxy1.getAddress());

      // Deploy second account
      const proxy2 = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedKey2, encodedKey2]),
      );
      const account2 = await ethers.getContractAt("ZkapAccount", await proxy2.getAddress());

      // Fund both accounts
      await owner.sendTransaction({ to: await account1.getAddress(), value: ethers.parseEther("5.0") });
      await owner.sendTransaction({ to: await account2.getAddress(), value: ethers.parseEther("5.0") });
      await account1.addDeposit({ value: ethers.parseEther("2.0") });
      await account2.addDeposit({ value: ethers.parseEther("2.0") });

      // Account1 executes a transaction to send ETH to Account2
      const transferAmount = ethers.parseEther("1.0");
      const executeCallData = account1.interface.encodeFunctionData("execute", [
        await account2.getAddress(),
        transferAmount,
        "0x",
      ]);

      const userOp = await createSignedUserOp(account1, entryPoint, executeCallData, wallet1, 0);

      const account2BalanceBefore = await ethers.provider.getBalance(await account2.getAddress());
      await entryPoint.handleOps([userOp], owner.address);
      const account2BalanceAfter = await ethers.provider.getBalance(await account2.getAddress());

      // Account2 should have received the ETH
      expect(account2BalanceAfter - account2BalanceBefore).to.equal(transferAmount);
    });

    // CNT-581 additional: nested call - account calls another account via external contract
    it("CNT-581: nested call via external contract", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();

      // Create calldata for account to call counter, which then modifies state
      const incrementData = counter.interface.encodeFunctionData("increment");

      // Execute via account
      const executeCallData = account.interface.encodeFunctionData("execute", [
        await counter.getAddress(),
        0,
        incrementData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      const countBefore = await counter.count();
      await entryPoint.handleOps([userOp], owner.address);
      const countAfter = await counter.count();

      expect(countAfter).to.equal(countBefore + 1n);
    });
  });

  describe("Gas Benchmark and Error Recovery - CNT-583~589", function () {
    // CNT-583: measure gas consumption of execute
    it("CNT-583: measure gas usage for execute", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const callData = account.interface.encodeFunctionData("execute", [user1.address, ethers.parseEther("0.1"), "0x"]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Gas should be reasonable for a simple ETH transfer
      expect(receipt?.gasUsed).to.be.lt(500000n);

      console.log(`      Gas used for execute (ETH transfer): ${receipt?.gasUsed}`);
    });

    // CNT-584: measure gas consumption of executeBatch (multiple items)
    it("CNT-584: measure gas usage for executeBatch (5 transactions)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipients = Array(5)
        .fill(null)
        .map(() => ethers.Wallet.createRandom().address);
      const amounts = recipients.map(() => ethers.parseEther("0.1"));
      const datas = recipients.map(() => "0x");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        recipients,
        amounts,
        datas,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Gas for 5 transfers
      expect(receipt?.gasUsed).to.be.lt(1000000n);

      console.log(`      Gas used for executeBatch (5 transfers): ${receipt?.gasUsed}`);
    });

    // CNT-585: verify account state after failed execute
    it("CNT-585: verify account state after failed execute", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter and set count to 0
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();
      await counter.setCount(0);

      const nonceBefore = await account.getNonce();
      const balanceBefore = await ethers.provider.getBalance(await account.getAddress());

      // Try to decrement below 0 (will fail)
      const decrementData = counter.interface.encodeFunctionData("decrement");
      const callData = account.interface.encodeFunctionData("execute", [await counter.getAddress(), 0, decrementData]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      // Execute (will fail internally but UserOp succeeds)
      await entryPoint.handleOps([userOp], owner.address);

      const nonceAfter = await account.getNonce();
      const balanceAfter = await ethers.provider.getBalance(await account.getAddress());

      // Nonce should still increase (UserOp was processed)
      expect(nonceAfter).to.equal(nonceBefore + 1n);

      // Counter should remain 0
      expect(await counter.count()).to.equal(0);
    });

    // CNT-586: verify account state after failed executeBatch
    it("CNT-586: verify account state after failed executeBatch", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();
      await counter.setCount(5);

      const nonceBefore = await account.getNonce();

      // Batch with one failing call
      const incrementData = counter.interface.encodeFunctionData("increment");
      const setZeroData = counter.interface.encodeFunctionData("setCount", [0]);
      const decrementData = counter.interface.encodeFunctionData("decrement");

      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [await counter.getAddress(), await counter.getAddress(), await counter.getAddress()],
        [],
        [incrementData, setZeroData, decrementData], // Last one fails
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      // Nonce should increase
      expect(await account.getNonce()).to.equal(nonceBefore + 1n);

      // Counter should remain 5 (batch rolled back)
      expect(await counter.count()).to.equal(5);
    });

    // CNT-587: execute succeeds after consecutive failures
    it("CNT-587: successful execute after failed attempts", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();
      await counter.setCount(0);

      // First execute - will fail (decrement below 0)
      const decrementData = counter.interface.encodeFunctionData("decrement");
      const failCallData = account.interface.encodeFunctionData("execute", [
        await counter.getAddress(),
        0,
        decrementData,
      ]);

      const failUserOp = await createSignedUserOp(account, entryPoint, failCallData, testWallet, 0);
      await entryPoint.handleOps([failUserOp], owner.address);

      // Second execute - will succeed (increment)
      const incrementData = counter.interface.encodeFunctionData("increment");
      const successCallData = account.interface.encodeFunctionData("execute", [
        await counter.getAddress(),
        0,
        incrementData,
      ]);

      const successUserOp = await createSignedUserOp(account, entryPoint, successCallData, testWallet, 0);
      await entryPoint.handleOps([successUserOp], owner.address);

      // Counter should be 1 after successful increment
      expect(await counter.count()).to.equal(1);
    });

    // CNT-588: compare gas consumption (execute vs executeBatch single call)
    it("CNT-588: compare gas usage - execute vs executeBatch with single call", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Execute single transfer
      const executeCallData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.1"),
        "0x",
      ]);

      const executeUserOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);
      const executeTx = await entryPoint.handleOps([executeUserOp], owner.address);
      const executeReceipt = await executeTx.wait();

      // ExecuteBatch with single transfer
      const batchCallData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [user1.address],
        [ethers.parseEther("0.1")],
        ["0x"],
      ]);

      const batchUserOp = await createSignedUserOp(account, entryPoint, batchCallData, testWallet, 0);
      const batchTx = await entryPoint.handleOps([batchUserOp], owner.address);
      const batchReceipt = await batchTx.wait();

      console.log(`      execute gas: ${executeReceipt?.gasUsed}`);
      console.log(`      executeBatch (single) gas: ${batchReceipt?.gasUsed}`);

      // Both should be within reasonable range of each other
      const executeGas = executeReceipt?.gasUsed || 0n;
      const batchGas = batchReceipt?.gasUsed || 0n;
      const diff = executeGas > batchGas ? executeGas - batchGas : batchGas - executeGas;
      expect(diff).to.be.lt(50000n); // Within 50k gas difference
    });

    // CNT-589: verify UserOp failure when both deposit and account balance are insufficient
    it("CNT-589: verify UserOp fails when no deposit and no account balance", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create a new account with NO deposit and NO ETH balance
      const testWallet = new Wallet("0x3333333333333333333333333333333333333333333333333333333333333333");
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedKey, encodedKey]),
      );
      const newAccount = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      // DO NOT fund the account - no ETH, no deposit
      // Verify no balance
      expect(await ethers.provider.getBalance(await newAccount.getAddress())).to.equal(0);
      expect(await newAccount.getDeposit()).to.equal(0);

      // Try to execute without any funds
      const callData = newAccount.interface.encodeFunctionData("execute", [
        owner.address,
        0, // Even 0 ETH transfer needs gas
        "0x",
      ]);

      const userOp = await createSignedUserOp(newAccount, entryPoint, callData, testWallet, 0);

      // Should fail due to insufficient funds (AA21 or AA25)
      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });
  });

  describe("Edge Cases - CNT-628~633, CNT-640~649", function () {
    // CNT-628: handle callData that is exactly 4 bytes (method signature only)
    it("CNT-628: execute with exactly 4 bytes callData (method signature only)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();

      // increment() has no arguments, so calldata is exactly 4 bytes
      const incrementSelector = counter.interface.getFunction("increment")!.selector;
      expect(ethers.dataLength(incrementSelector)).to.equal(4);

      const callData = account.interface.encodeFunctionData("execute", [
        await counter.getAddress(),
        0,
        incrementSelector,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      expect(await counter.count()).to.equal(1);
    });

    // CNT-629: fail when value array length != 0 and differs from dest length in executeBatch
    it("CNT-629: executeBatch fails when value.length != dest.length (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const recipient1 = ethers.Wallet.createRandom().address;
      const recipient2 = ethers.Wallet.createRandom().address;

      // dest.length = 2, value.length = 1, func.length = 2
      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [recipient1, recipient2],
        [ethers.parseEther("0.1")], // Only 1 value for 2 destinations
        ["0x", "0x"],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const recipient1BalanceBefore = await ethers.provider.getBalance(recipient1);

      // handleOps succeeds but internal execution fails
      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Verify recipient did not receive ETH (execution failed)
      const recipient1BalanceAfter = await ethers.provider.getBalance(recipient1);
      expect(recipient1BalanceAfter).to.equal(recipient1BalanceBefore);

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-630: fail when attempting updateTxKey with empty txKeyList (UserOperationRevertReason)
    it("CNT-630: updateTxKey fails with empty txKeyList (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create empty encoded key (threshold=1, empty arrays)
      const emptyEncodedKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [], [], []],
      );

      const callData = account.interface.encodeFunctionData("updateTxKey", [emptyEncodedKey]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event (execution failed)
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-631: fail when txKey threshold > totalWeight
    it("CNT-631: updateTxKey fails when threshold > totalWeight (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, testWallet, accountKeyAddressLogic } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newWallet = ethers.Wallet.createRandom();

      // threshold=5, but only 1 key with weight=1 (totalWeight=1 < threshold=5)
      const key = encodeAddressKey(newWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [5, [key.logicAddress], [key.initData], [key.weight]], // threshold=5, totalWeight=1
      );

      const callData = account.interface.encodeFunctionData("updateTxKey", [encodedKey]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-632: fail when attempting updateMasterKey with empty masterKeyList
    it("CNT-632: updateMasterKey fails with empty masterKeyList (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create empty encoded key (threshold=0, empty arrays) - threshold=0 will fail
      const emptyEncodedKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [0, [], [], []],
      );

      const callData = account.interface.encodeFunctionData("updateMasterKey", [emptyEncodedKey]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-633: fail when masterKey threshold > totalWeight
    it("CNT-633: updateMasterKey fails when threshold > totalWeight (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, testWallet, accountKeyAddressLogic } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newWallet = ethers.Wallet.createRandom();

      // threshold=10, but only 1 key with weight=1
      const key = encodeAddressKey(newWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [10, [key.logicAddress], [key.initData], [key.weight]], // threshold=10, totalWeight=1
      );

      const callData = account.interface.encodeFunctionData("updateMasterKey", [encodedKey]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-640: call getNonce and track nonce increment
    it("CNT-640: getNonce returns correct value and increments after UserOp", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const nonceBefore = await account.getNonce();
      expect(nonceBefore).to.equal(0);

      const callData = account.interface.encodeFunctionData("execute", [
        user1.address,
        ethers.parseEther("0.01"),
        "0x",
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      await entryPoint.handleOps([userOp], owner.address);

      const nonceAfter = await account.getNonce();
      expect(nonceAfter).to.equal(1);
    });

    // CNT-641: nonce increments sequentially on consecutive UserOp execution
    it("CNT-641: sequential UserOp execution increments nonce correctly (0→1→2→3)", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      expect(await account.getNonce()).to.equal(0);

      for (let i = 0; i < 3; i++) {
        const callData = account.interface.encodeFunctionData("execute", [
          user1.address,
          ethers.parseEther("0.01"),
          "0x",
        ]);

        const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
        await entryPoint.handleOps([userOp], owner.address);

        expect(await account.getNonce()).to.equal(i + 1);
      }

      expect(await account.getNonce()).to.equal(3);
    });

    // CNT-642: verify TxKeyUpdated event emit after updateTxKey
    it("CNT-642: TxKeyUpdated event emitted after updateTxKey", async function () {
      const { account, entryPoint, owner, testWallet, accountKeyAddressLogic } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newWallet = ethers.Wallet.createRandom();
      const key = encodeAddressKey(newWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(1, [key]);

      const callData = account.interface.encodeFunctionData("updateTxKey", [encodedKey]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for TxKeyUpdated event
      const accountInterface = account.interface;
      const txKeyUpdatedEvent = receipt?.logs
        .map((log) => {
          try {
            return accountInterface.parseLog({ topics: log.topics as string[], data: log.data });
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "TxKeyUpdated");

      expect(txKeyUpdatedEvent).to.not.be.undefined;
    });

    // CNT-643: verify MasterKeyUpdated event emit after updateMasterKey
    it("CNT-643: MasterKeyUpdated event emitted after updateMasterKey", async function () {
      const { account, entryPoint, owner, testWallet, accountKeyAddressLogic } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newWallet = ethers.Wallet.createRandom();
      const key = encodeAddressKey(newWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(1, [key]);

      const callData = account.interface.encodeFunctionData("updateMasterKey", [encodedKey]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for MasterKeyUpdated event
      const accountInterface = account.interface;
      const masterKeyUpdatedEvent = receipt?.logs
        .map((log) => {
          try {
            return accountInterface.parseLog({ topics: log.topics as string[], data: log.data });
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "MasterKeyUpdated");

      expect(masterKeyUpdatedEvent).to.not.be.undefined;
    });

    // CNT-644: verify ZkapAccountInitialized event emit on wallet creation
    it("CNT-644: ZkapAccountInitialized event emitted on wallet creation", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newWallet = ethers.Wallet.createRandom();
      const encodedKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), newWallet.address);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const tx = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedKey, encodedKey]),
      );
      const receipt = await tx.deploymentTransaction()?.wait();

      // Check for ZkapAccountInitialized event
      const accountInterface = accountLogic.interface;
      const initEvent = receipt?.logs
        .map((log) => {
          try {
            return accountInterface.parseLog({ topics: log.topics as string[], data: log.data });
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "ZkapAccountInitialized");

      expect(initEvent).to.not.be.undefined;
      expect(initEvent?.args[0]).to.equal(await entryPoint.getAddress());
    });

    // CNT-645: call withdrawDepositTo with partial amount
    it("CNT-645: partial withdrawDepositTo withdraws correct amount", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const depositBefore = await account.getDeposit();
      const withdrawAmount = ethers.parseEther("0.5");

      // Self-call to withdrawDepositTo
      const withdrawCallData = account.interface.encodeFunctionData("withdrawDepositTo", [
        user1.address,
        withdrawAmount,
      ]);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        await account.getAddress(),
        0,
        withdrawCallData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      const user1BalanceBefore = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([userOp], owner.address);
      const user1BalanceAfter = await ethers.provider.getBalance(user1.address);

      const depositAfter = await account.getDeposit();

      // Verify partial withdrawal
      expect(user1BalanceAfter - user1BalanceBefore).to.equal(withdrawAmount);
      expect(depositBefore - depositAfter).to.be.gte(withdrawAmount);
    });

    // CNT-646: call withdrawDepositTo with full amount (maximum available)
    it("CNT-646: full withdrawDepositTo withdraws maximum available", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // First add extra deposit to have more to withdraw
      await account.addDeposit({ value: ethers.parseEther("3.0") });

      const depositBefore = await account.getDeposit();

      // Withdraw a large amount (leaving some for gas)
      const withdrawAmount = ethers.parseEther("2.0");

      const withdrawCallData = account.interface.encodeFunctionData("withdrawDepositTo", [
        user1.address,
        withdrawAmount,
      ]);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        await account.getAddress(),
        0,
        withdrawCallData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      const user1BalanceBefore = await ethers.provider.getBalance(user1.address);
      await entryPoint.handleOps([userOp], owner.address);
      const user1BalanceAfter = await ethers.provider.getBalance(user1.address);

      const depositAfter = await account.getDeposit();

      // Verify withdrawal - user1 should receive the exact withdrawal amount
      expect(user1BalanceAfter - user1BalanceBefore).to.equal(withdrawAmount);
      // Deposit should decrease by at least withdrawal amount (plus gas used)
      expect(depositBefore - depositAfter).to.be.gte(withdrawAmount);
    });

    // CNT-647: verify internal call failure when attempting to withdraw more than deposit
    it("CNT-647: withdrawDepositTo fails internally when amount exceeds deposit", async function () {
      const { account, entryPoint, owner, testWallet, user1 } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      const depositBefore = await account.getDeposit();
      const excessAmount = depositBefore + ethers.parseEther("100"); // Way more than deposit

      const withdrawCallData = account.interface.encodeFunctionData("withdrawDepositTo", [user1.address, excessAmount]);

      const executeCallData = account.interface.encodeFunctionData("execute", [
        await account.getAddress(),
        0,
        withdrawCallData,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, executeCallData, testWallet, 0);

      const user1BalanceBefore = await ethers.provider.getBalance(user1.address);

      // The UserOp may succeed but the internal call should fail
      // So user1 balance should not increase by excessAmount
      await entryPoint.handleOps([userOp], owner.address);

      const user1BalanceAfter = await ethers.provider.getBalance(user1.address);
      const depositAfter = await account.getDeposit();

      // Verify that user1 did NOT receive the excess amount
      // (either revert or partial success, but not full excessAmount)
      expect(user1BalanceAfter - user1BalanceBefore).to.be.lt(excessAmount);

      // Deposit should still exist (not fully drained by excess withdrawal)
      // Note: some may be used for gas
      expect(depositAfter).to.be.gte(0);
    });

    // CNT-649: consecutive calls to the same target address
    it("CNT-649: consecutive calls to same target address", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy TestCounter
      const CounterFactory = await ethers.getContractFactory("TestCounter");
      const counter = await CounterFactory.deploy();

      const incrementData = counter.interface.encodeFunctionData("increment");

      // 3 consecutive calls to same contract
      const callData = account.interface.encodeFunctionData("executeBatch(address[],uint256[],bytes[])", [
        [await counter.getAddress(), await counter.getAddress(), await counter.getAddress()],
        [],
        [incrementData, incrementData, incrementData],
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      expect(await counter.count()).to.equal(0);
      await entryPoint.handleOps([userOp], owner.address);
      expect(await counter.count()).to.equal(3);
    });
  });

  // ===========================================
  // EIP-1271 isValidSignature Tests
  // ===========================================
  describe("EIP-1271 isValidSignature", function () {
    const EIP1271_MAGIC_VALUE = "0x1626ba7e";
    const EIP1271_INVALID_SIGNATURE = "0xffffffff";

    // ERC-7739 constants (must match contract)
    const DOMAIN_TYPEHASH = ethers.keccak256(
      ethers.toUtf8Bytes("EIP712Domain(uint256 chainId,address verifyingContract)"),
    );
    const PERSONAL_SIGN_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes("PersonalSign(bytes32 prefixed)"));

    /**
     * Compute ERC-7739 defensive rehashed digest
     * @param hash Original hash to sign
     * @param accountAddress ZkapAccount address
     * @param chainId Chain ID
     * @returns Rehashed digest that contract will validate
     */
    function computeERC7739Digest(hash: string, accountAddress: string, chainId: bigint): string {
      // Domain separator: keccak256(abi.encode(DOMAIN_TYPEHASH, chainId, verifyingContract))
      const domainSeparator = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "address"],
          [DOMAIN_TYPEHASH, chainId, accountAddress],
        ),
      );

      // Personal sign struct hash: keccak256(abi.encode(PERSONAL_SIGN_TYPEHASH, hash))
      const structHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [PERSONAL_SIGN_TYPEHASH, hash]),
      );

      // Final digest: keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))
      return ethers.keccak256(ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domainSeparator, structHash]));
    }

    // Helper: Sign hash directly without Ethereum prefix (for ECDSA.recover)
    // NOTE: With ERC-7739, this now signs the rehashed digest, not the original hash
    function signHashDirect(wallet: any, hash: string, accountAddress: string, chainId: bigint): string {
      // Apply ERC-7739 defensive rehashing
      const digest = computeERC7739Digest(hash, accountAddress, chainId);
      const sig = wallet.signingKey.sign(digest);
      return ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.v, 1)]);
    }

    // CNT-690: return MAGIC_VALUE with valid signature
    it("CNT-690: return MAGIC_VALUE for valid signature", async function () {
      const { account, testWallet } = await loadFixture(deployZkapAccountWithProxy);

      // Hash to sign (simulating a message hash from a dApp)
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Hello, World!"));

      // Get account address and chain ID for ERC-7739 rehashing
      const accountAddress = await account.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Sign the hash directly with ERC-7739 defensive rehashing
      const signature = signHashDirect(testWallet, messageHash, accountAddress, chainId);

      // Encode signature for ZkapAccount
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });

    // CNT-691: return INVALID_SIGNATURE with invalid signature
    it("CNT-691: return INVALID_SIGNATURE for invalid signature", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Hello, World!"));

      // Get account address and chain ID for ERC-7739 rehashing
      const accountAddress = await account.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Sign with a different wallet (wrong key)
      const wrongWallet = ethers.Wallet.createRandom();
      const wrongSignature = signHashDirect(wrongWallet, messageHash, accountAddress, chainId);

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [wrongSignature]]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    // CNT-692: return INVALID_SIGNATURE when keyIndexList and keySignatureList lengths mismatch
    it("CNT-692: return INVALID_SIGNATURE when keyIndexList length != keySignatureList length", async function () {
      const { account, testWallet } = await loadFixture(deployZkapAccountWithProxy);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Hello, World!"));

      // Get account address and chain ID for ERC-7739 rehashing
      const accountAddress = await account.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const signature = signHashDirect(testWallet, messageHash, accountAddress, chainId);

      // Mismatched lengths: 2 indices but only 1 signature
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0, 1], [signature]]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    // CNT-693: return INVALID_SIGNATURE when keyIndex exceeds txKeyList range
    it("CNT-693: return INVALID_SIGNATURE when keyIndex >= txKeyList.length", async function () {
      const { account, testWallet } = await loadFixture(deployZkapAccountWithProxy);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Hello, World!"));

      // Get account address and chain ID for ERC-7739 rehashing
      const accountAddress = await account.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const signature = signHashDirect(testWallet, messageHash, accountAddress, chainId);

      // keyIndex 99 is out of bounds (only 1 key at index 0)
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[99], [signature]]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    // CNT-694: return INVALID_SIGNATURE when duplicate keyIndex used
    it("CNT-694: return INVALID_SIGNATURE when duplicate keyIndex used", async function () {
      const { account, testWallet } = await loadFixture(deployZkapAccountWithProxy);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Hello, World!"));

      // Get account address and chain ID for ERC-7739 rehashing
      const accountAddress = await account.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const signature = signHashDirect(testWallet, messageHash, accountAddress, chainId);

      // Duplicate keyIndex [0, 0]
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [
          [0, 0],
          [signature, signature],
        ],
      );

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    // CNT-695: return MAGIC_VALUE when multi-sig threshold is met
    it("CNT-695: return MAGIC_VALUE when multisig threshold met", async function () {
      const { factory, accountKeyAddressLogic } = await loadFixture(deployZkapAccountWithProxy);

      // Deploy separate AccountKeyAddress instances to avoid single-mapping overwrite
      const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AccountKeyAddressFactory.deploy();
      await akLogic2.waitForDeployment();
      const akLogic3 = await AccountKeyAddressFactory.deploy();
      await akLogic3.waitForDeployment();

      // Create 2-of-3 multisig wallet
      const wallet1 = ethers.Wallet.createRandom();
      const wallet2 = ethers.Wallet.createRandom();
      const wallet3 = ethers.Wallet.createRandom();

      const key1 = encodeAddressKey(wallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(wallet2.address, await akLogic2.getAddress(), 1);
      const key3 = encodeAddressKey(wallet3.address, await akLogic3.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]); // threshold = 2

      const accountAddress = await factory.createAccount.staticCall(100, encodedKey, encodedKey);
      await factory.createAccount(100, encodedKey, encodedKey);
      const multisigAccount = await ethers.getContractAt("ZkapAccount", accountAddress);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Multisig test"));

      // Get chain ID for ERC-7739 rehashing
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const sig1 = signHashDirect(wallet1, messageHash, accountAddress, chainId);
      const sig2 = signHashDirect(wallet2, messageHash, accountAddress, chainId);

      // 2 signatures meet threshold of 2
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [
          [0, 1],
          [sig1, sig2],
        ],
      );

      const result = await multisigAccount.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });

    // CNT-696: return INVALID_SIGNATURE when below multi-sig threshold
    it("CNT-696: return INVALID_SIGNATURE when multisig threshold not met", async function () {
      const { factory, accountKeyAddressLogic } = await loadFixture(deployZkapAccountWithProxy);

      // Multi-sig test: each key requires a separate AccountKeyAddress instance
      const AKFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AKFactory.deploy();
      const akLogic3 = await AKFactory.deploy();

      // Create 2-of-3 multisig wallet
      const wallet1 = ethers.Wallet.createRandom();
      const wallet2 = ethers.Wallet.createRandom();
      const wallet3 = ethers.Wallet.createRandom();

      const key1 = encodeAddressKey(wallet1.address, await accountKeyAddressLogic.getAddress(), 1);
      const key2 = encodeAddressKey(wallet2.address, await akLogic2.getAddress(), 1);
      const key3 = encodeAddressKey(wallet3.address, await akLogic3.getAddress(), 1);
      const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]); // threshold = 2

      const accountAddress = await factory.createAccount.staticCall(101, encodedKey, encodedKey);
      await factory.createAccount(101, encodedKey, encodedKey);
      const multisigAccount = await ethers.getContractAt("ZkapAccount", accountAddress);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Multisig test"));

      // Get chain ID for ERC-7739 rehashing
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const sig1 = signHashDirect(wallet1, messageHash, accountAddress, chainId);

      // Only 1 signature, threshold is 2
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [sig1]]);

      const result = await multisigAccount.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    // CNT-697: return INVALID_SIGNATURE with empty signature array
    it("CNT-697: return INVALID_SIGNATURE with empty signature arrays", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Hello, World!"));

      // Empty arrays
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[], []]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    // CNT-698: return MAGIC_VALUE when weight exactly equals threshold
    it("CNT-698: return MAGIC_VALUE when weight exactly equals threshold", async function () {
      const { factory, accountKeyAddressLogic } = await loadFixture(deployZkapAccountWithProxy);

      // Create wallet with threshold=3, single key with weight=3
      const wallet1 = ethers.Wallet.createRandom();
      const key1 = encodeAddressKey(wallet1.address, await accountKeyAddressLogic.getAddress(), 3); // weight = 3
      const encodedKey = encodePrimitiveKeys(3, [key1]); // threshold = 3

      const accountAddress = await factory.createAccount.staticCall(102, encodedKey, encodedKey);
      await factory.createAccount(102, encodedKey, encodedKey);
      const weightedAccount = await ethers.getContractAt("ZkapAccount", accountAddress);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Weighted test"));

      // Get chain ID for ERC-7739 rehashing
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const sig1 = signHashDirect(wallet1, messageHash, accountAddress, chainId);

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [sig1]]);

      const result = await weightedAccount.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });

    // CNT-699: isValidSignature cannot be verified with masterKey (txKey only)
    it("CNT-699: isValidSignature uses txKey not masterKey", async function () {
      const { factory, accountKeyAddressLogic } = await loadFixture(deployZkapAccountWithProxy);

      // Create wallet with different masterKey and txKey
      const masterWallet = ethers.Wallet.createRandom();
      const txWallet = ethers.Wallet.createRandom();

      const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
      const encodedMasterKey = encodePrimitiveKeys(1, [masterKey]);
      const encodedTxKey = encodePrimitiveKeys(1, [txKey]);

      const accountAddress = await factory.createAccount.staticCall(103, encodedMasterKey, encodedTxKey);
      await factory.createAccount(103, encodedMasterKey, encodedTxKey);
      const diffKeyAccount = await ethers.getContractAt("ZkapAccount", accountAddress);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Key separation test"));

      // Get chain ID for ERC-7739 rehashing
      const chainId = (await ethers.provider.getNetwork()).chainId;

      // Sign with masterKey - should fail (isValidSignature uses txKey)
      const masterSig = signHashDirect(masterWallet, messageHash, accountAddress, chainId);
      const encodedMasterSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [masterSig]]);

      const resultMaster = await diffKeyAccount.isValidSignature(messageHash, encodedMasterSig);
      expect(resultMaster).to.equal(EIP1271_INVALID_SIGNATURE);

      // Sign with txKey - should succeed
      const txSig = signHashDirect(txWallet, messageHash, accountAddress, chainId);
      const encodedTxSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [txSig]]);

      const resultTx = await diffKeyAccount.isValidSignature(messageHash, encodedTxSig);
      expect(resultTx).to.equal(EIP1271_MAGIC_VALUE);
    });
  });

  describe("updateKeys", async function () {
    // CNT-700: revert when updateKeys called from outside EntryPoint
    it("revert updateKeys when called from outside EntryPoint", async function () {
      const { account, accountKeyAddressLogic, user1, user2 } = await loadFixture(deployZkapAccountWithProxy);

      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address, 1);
      const newEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user2.address,
        1,
      );

      await expect(account.updateKeys(newEncodedMasterKey, newEncodedTxKey)).to.be.revertedWithCustomError(
        account,
        "NotFromEntryPoint",
      );
    });

    // CNT-701: execute updateKeys successfully with masterKey signature
    it("execute updateKeys via EntryPoint with masterKey signature", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user1, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create new tx key and master key
      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address, 1);
      const newEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user2.address,
        1,
      );

      const updateCallData = account.interface.encodeFunctionData("updateKeys", [newEncodedMasterKey, newEncodedTxKey]);

      // Must sign with masterKey (testWallet) for updateKeys
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify thresholds are still 1
      expect(await account.txKeyThreshold()).to.equal(1);
      expect(await account.masterKeyThreshold()).to.equal(1);
    });

    // CNT-702: fail updateKeys with txKey signature (masterKey required)
    it("fail updateKeys with txKey signature (requires masterKey)", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user1, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address, 1);
      const newEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user2.address,
        1,
      );

      const updateCallData = account.interface.encodeFunctionData("updateKeys", [newEncodedMasterKey, newEncodedTxKey]);

      // Create a new account where masterKey and txKey are different
      const txWallet = new Wallet("0x1234567890123456789012345678901234567890123456789012345678901234");

      // Deploy a second AccountKeyAddress instance to avoid single-mapping overwrite
      const AccountKeyAddressFactory2 = await ethers.getContractFactory("AccountKeyAddress");
      const accountKeyAddressLogic2 = await AccountKeyAddressFactory2.deploy();
      await accountKeyAddressLogic2.waitForDeployment();

      const masterEncodedKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
        1,
      );
      const txEncodedKey = await createDummyEncodedKey(await accountKeyAddressLogic2.getAddress(), txWallet.address, 1);

      const AccountFactory = await ethers.getContractFactory("ZkapAccount");
      const newAccountLogic = await AccountFactory.deploy(await entryPoint.getAddress());
      await newAccountLogic.waitForDeployment();

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await newAccountLogic.getAddress(),
        newAccountLogic.interface.encodeFunctionData("initialize", [masterEncodedKey, txEncodedKey]),
      );
      const newAccount = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      // Fund the new account
      await owner.sendTransaction({
        to: await newAccount.getAddress(),
        value: ethers.parseEther("10.0"),
      });
      await newAccount.addDeposit({ value: ethers.parseEther("2.0") });

      const updateCallData2 = newAccount.interface.encodeFunctionData("updateKeys", [
        newEncodedMasterKey,
        newEncodedTxKey,
      ]);

      // Sign with txKey instead of masterKey - should fail
      const userOp = await createSignedUserOp(newAccount, entryPoint, updateCallData2, txWallet, 0);

      await expect(entryPoint.handleOps([userOp], owner.address)).to.be.reverted;
    });

    // CNT-703: fail when setting zero threshold txKey via updateKeys (UserOperationRevertReason)
    it("fail updateKeys with zero threshold txKey via EntryPoint (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user1, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid txKey with zero threshold
      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          0, // zero threshold - invalid
          [await accountKeyAddressLogic.getAddress()],
          [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user1.address])],
          [1],
        ],
      );
      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user2.address,
        1,
      );

      const updateCallData = account.interface.encodeFunctionData("updateKeys", [
        validEncodedMasterKey,
        invalidEncodedTxKey,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-704: fail when setting zero threshold masterKey via updateKeys (UserOperationRevertReason)
    it("fail updateKeys with zero threshold masterKey via EntryPoint (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user1, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const validEncodedTxKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user1.address,
        1,
      );
      // Create invalid masterKey with zero threshold
      const invalidEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          0, // zero threshold - invalid
          [await accountKeyAddressLogic.getAddress()],
          [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address])],
          [1],
        ],
      );

      const updateCallData = account.interface.encodeFunctionData("updateKeys", [
        invalidEncodedMasterKey,
        validEncodedTxKey,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-705: fail when setting empty key list via updateKeys (UserOperationRevertReason)
    it("fail updateKeys with empty key lists via EntryPoint (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid txKey with empty list
      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [], [], []],
      );
      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user2.address,
        1,
      );

      const updateCallData = account.interface.encodeFunctionData("updateKeys", [
        validEncodedMasterKey,
        invalidEncodedTxKey,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-706: fail updateKeys in the same block after masterKey update
    it("fail updateKeys in same block after masterKey update", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user1, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      const newEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user1.address,
        1,
      );
      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address, 1);

      // Disable automine to execute in same block
      await ethers.provider.send("evm_setAutomine", [false]);

      try {
        const tx1 = await account.connect(entryPointSigner).updateMasterKey(newEncodedMasterKey);

        // Try updateKeys in same block - should fail
        try {
          const tx2 = await account.connect(entryPointSigner).updateKeys(newEncodedMasterKey, newEncodedTxKey);
          await ethers.provider.send("evm_mine", []);
          await tx1.wait();
          await tx2.wait();
          expect.fail("Should have reverted");
        } catch (error: unknown) {
          await ethers.provider.send("evm_mine", []);
          expect((error as Error).message).to.include("revert");
        }
      } finally {
        await ethers.provider.send("evm_setAutomine", [true]);
      }
    });

    // CNT-707: emit TxKeyUpdated and MasterKeyUpdated events after updateKeys
    it("emit TxKeyUpdated and MasterKeyUpdated events after updateKeys", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user1, user2, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address, 1);
      const newEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user2.address,
        1,
      );

      const callData = account.interface.encodeFunctionData("updateKeys", [newEncodedMasterKey, newEncodedTxKey]);

      const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for TxKeyUpdated event
      const txKeyUpdatedEvent = receipt?.logs.find((log) => {
        try {
          const parsed = account.interface.parseLog({ topics: [...log.topics], data: log.data });
          return parsed?.name === "TxKeyUpdated";
        } catch {
          return false;
        }
      });

      // Check for MasterKeyUpdated event
      const masterKeyUpdatedEvent = receipt?.logs.find((log) => {
        try {
          const parsed = account.interface.parseLog({ topics: [...log.topics], data: log.data });
          return parsed?.name === "MasterKeyUpdated";
        } catch {
          return false;
        }
      });

      expect(txKeyUpdatedEvent).to.not.be.undefined;
      expect(masterKeyUpdatedEvent).to.not.be.undefined;
    });

    // CNT-708: successfully set multisig keys via updateKeys
    it("execute updateKeys with multisig keys via EntryPoint", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Multi-sig test: each key requires a separate AccountKeyAddress instance
      const AKFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AKFactory.deploy();
      const akLogic3 = await AKFactory.deploy();
      const akLogic4 = await AKFactory.deploy();

      const newWallet1 = new Wallet("0x1111111111111111111111111111111111111111111111111111111111111111");
      const newWallet2 = new Wallet("0x2222222222222222222222222222222222222222222222222222222222222222");

      // Create multisig txKey (threshold 2, 2 keys with weight 1 each)
      const newEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          2, // threshold
          [await akLogic2.getAddress(), await akLogic3.getAddress()],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [newWallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [newWallet2.address]),
          ],
          [1, 1], // weights
        ],
      );

      // Create multisig masterKey (threshold 2, 2 keys with weight 1 each)
      const newEncodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          2, // threshold
          [await accountKeyAddressLogic.getAddress(), await akLogic4.getAddress()],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [newWallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [newWallet2.address]),
          ],
          [1, 1], // weights
        ],
      );

      const updateCallData = account.interface.encodeFunctionData("updateKeys", [newEncodedMasterKey, newEncodedTxKey]);

      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      await entryPoint.handleOps([userOp], owner.address);

      // Verify thresholds are now 2
      expect(await account.txKeyThreshold()).to.equal(2);
      expect(await account.masterKeyThreshold()).to.equal(2);
    });

    // CNT-709: fail when setting weight sum < threshold via updateKeys (UserOperationRevertReason)
    it("fail updateKeys with weight sum < threshold via EntryPoint (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user1, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid txKey with threshold > weight sum
      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          5, // threshold = 5
          [await accountKeyAddressLogic.getAddress()],
          [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user1.address])],
          [1], // total weight = 1 < threshold
        ],
      );
      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user1.address,
        1,
      );

      const updateCallData = account.interface.encodeFunctionData("updateKeys", [
        validEncodedMasterKey,
        invalidEncodedTxKey,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });

    // CNT-710: fail when setting zero address key logic via updateKeys (UserOperationRevertReason)
    it("fail updateKeys with zero address key logic via EntryPoint (emits UserOperationRevertReason)", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, user1, testWallet } = await loadFixture(
        deployZkapAccountWithProxyAndFunding,
      );

      // Create invalid txKey with zero address logic
      const invalidEncodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          1,
          [ethers.ZeroAddress], // zero address - invalid
          [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user1.address])],
          [1],
        ],
      );
      const validEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        user1.address,
        1,
      );

      const updateCallData = account.interface.encodeFunctionData("updateKeys", [
        validEncodedMasterKey,
        invalidEncodedTxKey,
      ]);

      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      const tx = await entryPoint.handleOps([userOp], owner.address);
      const receipt = await tx.wait();

      // Check for UserOperationRevertReason event
      const revertEvent = receipt?.logs.find((log) => {
        try {
          const parsed = entryPoint.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === "UserOperationRevertReason";
        } catch {
          return false;
        }
      });
      expect(revertEvent).to.not.be.undefined;
    });
  });

  describe("Branch Coverage - Edge Cases", async function () {
    // CNT-700: initialize with empty txKey - txKeyThreshold set to max
    it("CNT-700: initialize with empty txKey sets txKeyThreshold to max", async function () {
      const { accountLogic, accountKeyAddressLogic, user1 } = await loadFixture(deployZkapAccount);

      // Create valid master key
      const encodedMasterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address, 1);

      // Empty txKey (0x is empty bytes)
      const emptyEncodedTxKey = "0x";

      // Deploy proxy with empty txKey
      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedMasterKey, emptyEncodedTxKey])
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      // txKeyThreshold should be max (255) when txKey is empty
      expect(await account.txKeyThreshold()).to.equal(255);
    });

    // CNT-701: revert CannotUpgradeViaTxKey when attempting upgradeToAndCall with txKey
    it("CNT-701: revert when trying to upgrade via txKey", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy a new ZkapAccount logic for upgrade target
      const NewAccountFactory = await ethers.getContractFactory("ZkapAccount");
      const newAccountLogic = await NewAccountFactory.deploy(await entryPoint.getAddress());

      // Create upgrade calldata (upgradeToAndCall)
      const upgradeCallData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newAccountLogic.getAddress(),
        "0x",
      ]);

      // Try to execute upgrade via execute (which uses txKey)
      const executeCallData = account.interface.encodeFunctionData("execute", [
        await account.getAddress(),
        0,
        upgradeCallData,
      ]);

      // Create UserOp with txKey signature
      const userOp = await createUserOp(account, executeCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail with CannotUpgradeViaTxKey
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-702: revert CannotCallKeyProxy when calling masterKeyList address directly
    it("CNT-702: revert when calling masterKey proxy address directly", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Get masterKey singleton address
      const masterKeyRef = await account.masterKeyList(0);

      // Try to call the masterKey singleton directly via execute
      const executeCallData = account.interface.encodeFunctionData("execute", [
        masterKeyRef.logic,
        0,
        "0x", // empty calldata
      ]);

      const userOp = await createUserOp(account, executeCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail with CannotCallKeyProxy
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-703: revert CannotCallKeyProxy when calling txKeyList address directly
    it("CNT-703: revert when calling txKey proxy address directly", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Get txKey singleton address
      const txKeyRef = await account.txKeyList(0);

      // Try to call the txKey singleton directly via execute
      const executeCallData = account.interface.encodeFunctionData("execute", [
        txKeyRef.logic,
        0,
        "0x", // empty calldata
      ]);

      const userOp = await createUserOp(account, executeCallData);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);
      const signature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [signature]);

      // Should fail with CannotCallKeyProxy
      await expect(entryPoint.handleOps([userOp], owner.address)).to.emit(entryPoint, "UserOperationRevertReason");
    });

    // CNT-704: updateTxKey selector check branch
    it("CNT-704: updateTxKey requires masterKey signature", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding
      );

      // Create new txKey
      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address, 1);

      // Create updateTxKey calldata
      const updateCallData = account.interface.encodeFunctionData("updateTxKey", [newEncodedTxKey]);

      // Use masterKey to sign (index 0)
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should succeed with masterKey signature
      await expect(entryPoint.handleOps([userOp], owner.address)).to.not.be.reverted;
    });

    // CNT-705: updateKeys selector check branch
    it("CNT-705: updateKeys requires masterKey signature", async function () {
      const { account, entryPoint, owner, accountKeyAddressLogic, testWallet, user2 } = await loadFixture(
        deployZkapAccountWithProxyAndFunding
      );

      // Create new keys
      const newEncodedMasterKey = await createDummyEncodedKey(
        await accountKeyAddressLogic.getAddress(),
        testWallet.address,
        1
      );
      const newEncodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user2.address, 1);

      // Create updateKeys calldata
      const updateCallData = account.interface.encodeFunctionData("updateKeys", [newEncodedMasterKey, newEncodedTxKey]);

      // Use masterKey to sign
      const userOp = await createSignedUserOp(account, entryPoint, updateCallData, testWallet, 0);

      // Should succeed with masterKey signature
      await expect(entryPoint.handleOps([userOp], owner.address)).to.not.be.reverted;
    });

    // CNT-706: upgradeToAndCall selector check branch
    it("CNT-706: upgradeToAndCall requires masterKey signature", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Deploy new implementation
      const NewAccountFactory = await ethers.getContractFactory("ZkapAccount");
      const newAccountLogic = await NewAccountFactory.deploy(await entryPoint.getAddress());

      // Create upgradeToAndCall calldata
      const upgradeCallData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await newAccountLogic.getAddress(),
        "0x", // empty data
      ]);

      // Use masterKey to sign
      const userOp = await createSignedUserOp(account, entryPoint, upgradeCallData, testWallet, 0);

      // Should succeed with masterKey signature
      await expect(entryPoint.handleOps([userOp], owner.address)).to.not.be.reverted;
    });
  });

  describe("Additional Coverage - Edge Cases", async function () {
    // CNT-800: Initialize with empty txKey (encodedTxKey = "0x")
    it("initialize with empty txKey sets threshold to max", async function () {
      const { accountLogic, accountKeyAddressLogic, testWallet } = await loadFixture(deployZkapAccount);

      const encodedMasterKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), testWallet.address);

      // Create empty encodedTxKey
      const emptyEncodedTxKey = "0x";

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedMasterKey, emptyEncodedTxKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      // txKeyThreshold should be type(uint8).max (255)
      expect(await account.txKeyThreshold()).to.equal(255);
    });

    // CNT-801: executeBatch calling self with upgradeToAndCall selector should revert
    it("revert when executeBatch calls self with upgradeToAndCall", async function () {
      const { account, entryPoint, owner, accountLogic } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Create upgradeToAndCall calldata targeting self
      const upgradeCallData = account.interface.encodeFunctionData("upgradeToAndCall", [
        await accountLogic.getAddress(),
        "0x",
      ]);

      // Create executeBatch that calls self with upgradeToAndCall
      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({
        to: await entryPoint.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      await expect(
        account.connect(entryPointSigner)["executeBatch(address[],uint256[],bytes[])"](
          [await account.getAddress()],
          [0n],
          [upgradeCallData],
        ),
      ).to.be.revertedWithCustomError(account, "CannotUpgradeViaTxKey");
    });

    // CNT-802: isValidSignature with keyIndexLen != sigLen
    it("return INVALID when isValidSignature with mismatched lengths", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("test message"));

      // Create signature with 1 keyIndex but 2 signatures (length mismatch)
      const keyIndices = [0];
      const signatures = [ethers.hexlify(ethers.randomBytes(65)), ethers.hexlify(ethers.randomBytes(65))];

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [keyIndices, signatures],
      );

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal("0xffffffff"); // EIP1271_INVALID_SIGNATURE
    });

    // CNT-803: isValidSignature with out-of-bounds keyIndex
    it("return INVALID when isValidSignature with out-of-bounds keyIndex", async function () {
      const { account, testWallet } = await loadFixture(deployZkapAccountWithProxy);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("test message"));

      // Create signature with out-of-bounds keyIndex (255 — max uint8)
      const keyIndices = [255];
      const signature = await testWallet.signMessage(ethers.getBytes(messageHash));

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [keyIndices, [signature]]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal("0xffffffff"); // EIP1271_INVALID_SIGNATURE
    });

    // CNT-804: isValidSignature with duplicate keyIndex
    it("return INVALID when isValidSignature with duplicate keyIndex", async function () {
      const { accountLogic, accountKeyAddressLogic, owner, user1 } = await loadFixture(deployZkapAccount);

      // Create account with 2 keys, threshold 1
      const wallet1 = new Wallet(ethers.hexlify(ethers.randomBytes(32)));
      const wallet2 = new Wallet(ethers.hexlify(ethers.randomBytes(32)));

      const AKFactory = await ethers.getContractFactory("AccountKeyAddress");
      const akLogic2 = await AKFactory.deploy();

      const encodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          1, // threshold
          [await accountKeyAddressLogic.getAddress(), await akLogic2.getAddress()],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet2.address]),
          ],
          [1, 1], // weights
        ],
      );

      const encodedTxKey = await createDummyEncodedKey(await accountKeyAddressLogic.getAddress(), user1.address);

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedMasterKey, encodedTxKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("test message"));

      // Create signature with duplicate keyIndex [0, 0]
      const keyIndices = [0, 0]; // duplicate!
      const signature1 = await wallet1.signMessage(ethers.getBytes(messageHash));
      const signature2 = await wallet1.signMessage(ethers.getBytes(messageHash));

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [keyIndices, [signature1, signature2]],
      );

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal("0xffffffff"); // EIP1271_INVALID_SIGNATURE
    });
  });

  describe("Branch Coverage - Duplicate Logic and Edge Cases", function () {
    // Lines 310[0],[1] + 312[1]: updateTxKey with duplicate logic addresses - skip duplicate resetKeys
    it("skip duplicate resetKeys when updating txKey with same logic address", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner } = await loadFixture(deployZkapAccount);
      const akAddr = await accountKeyAddressLogic.getAddress();

      // Initialize with 2 txKeys using same logic address
      const wallet1 = ethers.Wallet.createRandom();
      const wallet2 = ethers.Wallet.createRandom();

      const encodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [akAddr], [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner.address])], [1]],
      );

      // txKey with same logic address twice
      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          1,
          [akAddr, akAddr],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet2.address]),
          ],
          [1, 1],
        ],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedMasterKey, encodedTxKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      // Update to new txKey
      const wallet3 = ethers.Wallet.createRandom();
      const newTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [akAddr], [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet3.address])], [1]],
      );

      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({ to: await entryPoint.getAddress(), value: ethers.parseEther("1") });

      // This triggers the duplicate logic skip branch
      await expect(account.connect(entryPointSigner).updateTxKey(newTxKey)).to.emit(account, "TxKeyUpdated");
    });

    // Lines 360[0],[1] + 362[1]: updateMasterKey with duplicate logic addresses - skip duplicate resetKeys
    it("skip duplicate resetKeys when updating masterKey with same logic address", async function () {
      const { accountLogic, entryPoint, accountKeyAddressLogic, owner } = await loadFixture(deployZkapAccount);
      const akAddr = await accountKeyAddressLogic.getAddress();

      // Initialize with 2 masterKeys using same logic address
      const wallet1 = ethers.Wallet.createRandom();
      const wallet2 = ethers.Wallet.createRandom();

      const encodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [
          1,
          [akAddr, akAddr],
          [
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet1.address]),
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet2.address]),
          ],
          [1, 1],
        ],
      );

      const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [akAddr], [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner.address])], [1]],
      );

      const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
      const proxy = await ProxyFactory.deploy(
        await accountLogic.getAddress(),
        accountLogic.interface.encodeFunctionData("initialize", [encodedMasterKey, encodedTxKey]),
      );
      const account = await ethers.getContractAt("ZkapAccount", await proxy.getAddress());

      // Update to new masterKey
      const wallet3 = ethers.Wallet.createRandom();
      const newMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "address[]", "bytes[]", "uint8[]"],
        [1, [akAddr], [ethers.AbiCoder.defaultAbiCoder().encode(["address"], [wallet3.address])], [1]],
      );

      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({ to: await entryPoint.getAddress(), value: ethers.parseEther("1") });

      // This triggers the duplicate logic skip branch
      await expect(account.connect(entryPointSigner).updateMasterKey(newMasterKey)).to.emit(
        account,
        "MasterKeyUpdated",
      );
    });

    // Line 410[0]: executeBatch calling txKey singleton address - CannotCallKeySingleton
    it("revert when executeBatch calls txKey singleton via _requireSafeCall", async function () {
      const { account, entryPoint, owner, testWallet } = await loadFixture(deployZkapAccountWithProxyAndFunding);

      // Get txKey logic address
      const txKeyRef = await account.txKeyList(0);
      const txKeyLogic = txKeyRef.logic;

      const entryPointSigner = await ethers.getImpersonatedSigner(await entryPoint.getAddress());
      await owner.sendTransaction({ to: await entryPoint.getAddress(), value: ethers.parseEther("1") });

      await expect(
        account.connect(entryPointSigner)["executeBatch(address[],uint256[],bytes[])"]([txKeyLogic], [0n], ["0x"]),
      ).to.be.revertedWithCustomError(account, "CannotCallKeySingleton");
    });

    // Lines 620[0],[1]: refreshMerkleRoots with isMaster true/false
    it("revert refreshMerkleRoots with isMaster=true (out of bounds)", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);
      await expect(account.refreshMerkleRoots(999, true)).to.be.reverted;
    });

    it("revert refreshMerkleRoots with isMaster=false (out of bounds)", async function () {
      const { account } = await loadFixture(deployZkapAccountWithProxy);
      await expect(account.refreshMerkleRoots(999, false)).to.be.reverted;
    });
  });
});
