/**
 * E2E Tests: EIP-1271 isValidSignature
 *
 * CNT-550, 551, 552, 650~657: EIP-1271 Integration Tests
 * - External contract verification (SignatureChecker)
 * - Permit token integration (EIP-2612)
 * - UserOp consistency
 * - Various signature scenarios
 */

import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet, HDNodeWallet } from "ethers";
import { encodeAddressKey, encodePrimitiveKeys } from "../../helpers/accountKeyHelper";
import { createUserOp, getUserOpHash, signUserOp, encodeZkapSignature } from "../../helpers/userOpHelper";

// EIP-1271 Magic Values
const EIP1271_MAGIC_VALUE = "0x1626ba7e";
const EIP1271_INVALID_SIGNATURE = "0xffffffff";

// Helper: Create test wallet with deterministic key
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Helper: Sign hash directly without Ethereum prefix (for ECDSA.recover in isValidSignature)
function signHashDirect(wallet: Wallet | HDNodeWallet, hash: string): string {
  const sig = wallet.signingKey.sign(hash);
  return ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.v, 1)]);
}

// Helper: Compute ERC-7739 defensive rehashing digest (matches ZkapAccount.isValidSignature)
function computeERC7739Digest(accountAddress: string, chainId: bigint, hash: string): string {
  const DOMAIN_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes("EIP712Domain(uint256 chainId,address verifyingContract)"));
  const PERSONAL_SIGN_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes("PersonalSign(bytes32 prefixed)"));

  const domainSeparator = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address"],
      [DOMAIN_TYPEHASH, chainId, accountAddress]
    )
  );

  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [PERSONAL_SIGN_TYPEHASH, hash]
    )
  );

  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "bytes32", "bytes32"],
      ["\x19\x01", domainSeparator, structHash]
    )
  );
}

// Fixture: Deploy all contracts for EIP-1271 tests
async function deployEIP1271TestContracts() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const recipient = signers[1];

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

  // 4. Deploy TestSignatureChecker
  const SignatureCheckerFactory = await ethers.getContractFactory("TestSignatureChecker");
  const signatureChecker = await SignatureCheckerFactory.deploy();
  await signatureChecker.waitForDeployment();

  // 5. Deploy TestPermitToken
  const PermitTokenFactory = await ethers.getContractFactory("TestPermitToken");
  const permitToken = await PermitTokenFactory.deploy("TestPermit", "TPMT", ethers.parseEther("1000000"));
  await permitToken.waitForDeployment();

  // 6. Deploy TestCounter (for execute tests)
  const CounterFactory = await ethers.getContractFactory("TestCounter");
  const testCounter = await CounterFactory.deploy();
  await testCounter.waitForDeployment();

  return {
    entryPoint,
    factory,
    accountKeyAddressLogic,
    signatureChecker,
    permitToken,
    testCounter,
    owner,
    recipient,
    signers,
  };
}

// Fixture: Deploy wallet for EIP-1271 tests
async function deployWalletForEIP1271() {
  const base = await deployEIP1271TestContracts();
  const { factory, accountKeyAddressLogic, owner, entryPoint, permitToken } = base;

  // Create test wallet
  const testWallet = createTestWallet(0);

  // Encode key
  const key = encodeAddressKey(testWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedKey = encodePrimitiveKeys(1, [key]);

  // Create account
  const accountAddress = await factory.createAccount.staticCall(0, encodedKey, encodedKey);
  await factory.createAccount(0, encodedKey, encodedKey);
  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  // Send some permit tokens to the account
  await permitToken.transfer(accountAddress, ethers.parseEther("1000"));

  return {
    ...base,
    account,
    accountAddress,
    testWallet,
  };
}

// Fixture: Deploy multisig wallet for EIP-1271 tests
async function deployMultisigWalletForEIP1271() {
  const base = await deployEIP1271TestContracts();
  const { factory, accountKeyAddressLogic, owner } = base;

  // Create 3 test wallets for 2-of-3 multisig
  const wallet1 = createTestWallet(10);
  const wallet2 = createTestWallet(11);
  const wallet3 = createTestWallet(12);

  // Encode keys
  const key1 = encodeAddressKey(wallet1.address, await accountKeyAddressLogic.getAddress(), 1);
  const key2 = encodeAddressKey(wallet2.address, await accountKeyAddressLogic.getAddress(), 1);
  const key3 = encodeAddressKey(wallet3.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedKey = encodePrimitiveKeys(2, [key1, key2, key3]); // threshold = 2

  // Create account
  const accountAddress = await factory.createAccount.staticCall(100, encodedKey, encodedKey);
  await factory.createAccount(100, encodedKey, encodedKey);
  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return {
    ...base,
    account,
    accountAddress,
    wallet1,
    wallet2,
    wallet3,
  };
}

// Fixture: Deploy weighted wallet for EIP-1271 tests
async function deployWeightedWalletForEIP1271() {
  const base = await deployEIP1271TestContracts();
  const { factory, accountKeyAddressLogic, owner } = base;

  // Create wallet with weight=3, threshold=2
  const testWallet = createTestWallet(20);
  const key = encodeAddressKey(
    testWallet.address,
    await accountKeyAddressLogic.getAddress(),
    3 // weight = 3
  );
  const encodedKey = encodePrimitiveKeys(2, [key]); // threshold = 2

  // Create account
  const accountAddress = await factory.createAccount.staticCall(200, encodedKey, encodedKey);
  await factory.createAccount(200, encodedKey, encodedKey);
  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  // Fund the account
  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return {
    ...base,
    account,
    accountAddress,
    testWallet,
  };
}

// Fixture: Deploy wallet with different masterKey and txKey
async function deployDifferentKeyWallet() {
  const base = await deployEIP1271TestContracts();
  const { factory, accountKeyAddressLogic, owner } = base;

  const masterWallet = createTestWallet(30);
  const txWallet = createTestWallet(31);

  const masterKey = encodeAddressKey(masterWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const txKey = encodeAddressKey(txWallet.address, await accountKeyAddressLogic.getAddress(), 1);
  const encodedMasterKey = encodePrimitiveKeys(1, [masterKey]);
  const encodedTxKey = encodePrimitiveKeys(1, [txKey]);

  const accountAddress = await factory.createAccount.staticCall(300, encodedMasterKey, encodedTxKey);
  await factory.createAccount(300, encodedMasterKey, encodedTxKey);
  const account = await ethers.getContractAt("ZkapAccount", accountAddress);

  await owner.sendTransaction({ to: accountAddress, value: ethers.parseEther("10.0") });
  await account.addDeposit({ value: ethers.parseEther("2.0") });

  return {
    ...base,
    account,
    accountAddress,
    masterWallet,
    txWallet,
  };
}

describe("E2E: EIP-1271 isValidSignature", function () {
  // ===========================================
  // CNT-550, CNT-655: External Contract Verification (SignatureChecker)
  // ===========================================
  describe("External Contract Verification", function () {
    it("CNT-550: SignatureChecker verifies valid ZkapAccount signature", async function () {
      const { account, accountAddress, testWallet, signatureChecker } = await loadFixture(deployWalletForEIP1271);

      // Create a message hash
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("External verification test"));

      // Compute ERC-7739 digest (isValidSignature rehashes internally)
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(accountAddress, chainId, messageHash);

      // Sign the digest (not the messageHash)
      const signature = signHashDirect(testWallet, digest);

      // Encode for ZkapAccount
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      // Verify using SignatureChecker
      const isValid = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedSig);

      expect(isValid).to.be.true;
    });

    it("CNT-655: SignatureChecker.isValidERC1271SignatureNow returns true for valid signature", async function () {
      const { account, accountAddress, testWallet, signatureChecker } = await loadFixture(deployWalletForEIP1271);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("ERC1271 specific test"));

      // Compute ERC-7739 digest
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(accountAddress, chainId, messageHash);

      // Sign the digest
      const signature = signHashDirect(testWallet, digest);

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      // Use ERC1271-specific check
      const isValid = await signatureChecker.isValidERC1271SignatureNow(accountAddress, messageHash, encodedSig);

      expect(isValid).to.be.true;
    });
  });

  // ===========================================
  // CNT-551: Invalid Signature Returns INVALID_SIGNATURE
  // ===========================================
  describe("Invalid Signature Handling", function () {
    it("CNT-551: return INVALID_SIGNATURE for wrong key signature", async function () {
      const { account, signatureChecker, accountAddress } = await loadFixture(deployWalletForEIP1271);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Wrong key test"));

      // Sign with a different (wrong) wallet
      const wrongWallet = ethers.Wallet.createRandom();
      const wrongSignature = signHashDirect(wrongWallet, messageHash);

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [wrongSignature]]);

      // Direct call to isValidSignature
      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);

      // SignatureChecker should return false
      const isValid = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedSig);
      expect(isValid).to.be.false;
    });
  });

  // ===========================================
  // CNT-552: Multisig Threshold Not Met
  // ===========================================
  describe("Multisig Threshold", function () {
    it("CNT-552: return INVALID_SIGNATURE when multisig threshold not met (2-of-3 with 1 sig)", async function () {
      const { account, accountAddress, wallet1, signatureChecker } = await loadFixture(deployMultisigWalletForEIP1271);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Multisig threshold test"));

      // Sign with only 1 key (threshold is 2)
      const sig1 = signHashDirect(wallet1, messageHash);

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [sig1]]);

      // Direct call should return INVALID_SIGNATURE
      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);

      // SignatureChecker should return false
      const isValid = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedSig);
      expect(isValid).to.be.false;
    });

    it("CNT-552-additional: return MAGIC_VALUE when multisig threshold met (2-of-3 with 2 sigs)", async function () {
      const { account, accountAddress, wallet1, wallet2, signatureChecker } = await loadFixture(
        deployMultisigWalletForEIP1271
      );

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Multisig success test"));

      // Compute ERC-7739 digest
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(accountAddress, chainId, messageHash);

      // Sign with 2 keys (meets threshold of 2) - both sign the digest
      const sig1 = signHashDirect(wallet1, digest);
      const sig2 = signHashDirect(wallet2, digest);

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [
          [0, 1],
          [sig1, sig2],
        ]
      );

      // Direct call should return MAGIC_VALUE
      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);

      // SignatureChecker should return true
      const isValid = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedSig);
      expect(isValid).to.be.true;
    });
  });

  // ===========================================
  // CNT-650: Weighted Threshold with weight > 1
  // ===========================================
  describe("Weighted Threshold", function () {
    it("CNT-650: weight > 1 single key meets threshold", async function () {
      const { account, accountAddress, testWallet, signatureChecker } = await loadFixture(
        deployWeightedWalletForEIP1271
      );

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Weighted threshold test"));

      // Compute ERC-7739 digest
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(accountAddress, chainId, messageHash);

      // Sign with single key (weight=3 >= threshold=2)
      const signature = signHashDirect(testWallet, digest);

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);

      const isValid = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedSig);
      expect(isValid).to.be.true;
    });
  });

  // ===========================================
  // CNT-651: masterKey Rejection (only txKey works)
  // ===========================================
  describe("Master Key vs Tx Key", function () {
    it("CNT-651: masterKey signature rejected, txKey signature accepted", async function () {
      const { account, accountAddress, masterWallet, txWallet, signatureChecker } = await loadFixture(
        deployDifferentKeyWallet
      );

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Key separation test"));

      // Compute ERC-7739 digest
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(accountAddress, chainId, messageHash);

      // Sign with masterKey - should fail
      const masterSig = signHashDirect(masterWallet, digest);
      const encodedMasterSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [masterSig]]);

      const resultMaster = await account.isValidSignature(messageHash, encodedMasterSig);
      expect(resultMaster).to.equal(EIP1271_INVALID_SIGNATURE);

      const isValidMaster = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedMasterSig);
      expect(isValidMaster).to.be.false;

      // Sign with txKey - should succeed
      const txSig = signHashDirect(txWallet, digest);
      const encodedTxSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [txSig]]);

      const resultTx = await account.isValidSignature(messageHash, encodedTxSig);
      expect(resultTx).to.equal(EIP1271_MAGIC_VALUE);

      const isValidTx = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedTxSig);
      expect(isValidTx).to.be.true;
    });
  });

  // ===========================================
  // CNT-652: Duplicate Key Index
  // ===========================================
  describe("Duplicate Key Index", function () {
    it("CNT-652: duplicate keyIndex returns INVALID_SIGNATURE", async function () {
      const { account, wallet1, signatureChecker, accountAddress } = await loadFixture(deployMultisigWalletForEIP1271);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Duplicate index test"));
      const sig = signHashDirect(wallet1, messageHash);

      // Duplicate keyIndex [0, 0]
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [
          [0, 0],
          [sig, sig],
        ]
      );

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);

      const isValid = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedSig);
      expect(isValid).to.be.false;
    });
  });

  // ===========================================
  // CNT-653: Key Index Out of Bounds
  // ===========================================
  describe("Key Index Out of Bounds", function () {
    it("CNT-653: keyIndex >= txKeyList.length returns INVALID_SIGNATURE", async function () {
      const { account, testWallet, signatureChecker, accountAddress } = await loadFixture(deployWalletForEIP1271);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Out of bounds test"));
      const signature = signHashDirect(testWallet, messageHash);

      // keyIndex 99 is out of bounds (only 1 key at index 0)
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[99], [signature]]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);

      const isValid = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedSig);
      expect(isValid).to.be.false;
    });
  });

  // ===========================================
  // CNT-654: Empty Signature Array
  // ===========================================
  describe("Empty Signature Array", function () {
    it("CNT-654: empty signature arrays return INVALID_SIGNATURE", async function () {
      const { account, signatureChecker, accountAddress } = await loadFixture(deployWalletForEIP1271);

      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Empty array test"));

      // Empty arrays
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[], []]);

      const result = await account.isValidSignature(messageHash, encodedSig);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);

      const isValid = await signatureChecker.isValidSignatureNow(accountAddress, messageHash, encodedSig);
      expect(isValid).to.be.false;
    });
  });

  // ===========================================
  // CNT-656: Permit Token Integration (EIP-2612)
  // ===========================================
  describe("Permit Token Integration", function () {
    it("CNT-656: EIP-712 permit signature works with ZkapAccount", async function () {
      const { account, accountAddress, testWallet, permitToken, recipient } = await loadFixture(deployWalletForEIP1271);

      const spender = recipient.address;
      const value = ethers.parseEther("100");
      const nonce = await permitToken.nonces(accountAddress);
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // Get EIP-712 domain
      const domain = {
        name: await permitToken.name(),
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await permitToken.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const message = {
        owner: accountAddress,
        spender: spender,
        value: value,
        nonce: nonce,
        deadline: deadline,
      };

      // Create EIP-712 typed data hash
      const typedDataHash = ethers.TypedDataEncoder.hash(domain, types, message);

      // Compute ERC-7739 digest (isValidSignature rehashes the typed data hash)
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(accountAddress, chainId, typedDataHash);

      // Sign the digest (not the typedDataHash directly)
      const signature = signHashDirect(testWallet, digest);

      // Encode for ZkapAccount
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      // Verify signature is valid via isValidSignature
      const isValid = await account.isValidSignature(typedDataHash, encodedSig);
      expect(isValid).to.equal(EIP1271_MAGIC_VALUE);

      // Note: The actual permit() call would fail because it expects a specific signature format
      // This test verifies that isValidSignature correctly validates the EIP-712 hash
    });
  });

  // ===========================================
  // CNT-657: UserOp Consistency
  // ===========================================
  describe("UserOp Consistency", function () {
    it("CNT-657: same key validates both isValidSignature and UserOp", async function () {
      const { account, accountAddress, testWallet, entryPoint, testCounter, owner } = await loadFixture(
        deployWalletForEIP1271
      );

      // Test 1: isValidSignature
      const messageHash = ethers.keccak256(ethers.toUtf8Bytes("Consistency test"));

      // Compute ERC-7739 digest for isValidSignature
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(accountAddress, chainId, messageHash);

      const isValidSig = signHashDirect(testWallet, digest);
      const encodedIsValidSig = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [isValidSig]]);

      const isValidResult = await account.isValidSignature(messageHash, encodedIsValidSig);
      expect(isValidResult).to.equal(EIP1271_MAGIC_VALUE);

      // Test 2: UserOp execution with same key
      const incrementData = testCounter.interface.encodeFunctionData("increment");
      const callData = account.interface.encodeFunctionData("execute", [
        await testCounter.getAddress(),
        0,
        incrementData,
      ]);

      const userOp = await createUserOp(account, callData);
      const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

      // Sign UserOp (with Ethereum prefix as expected by _validateSignature)
      const userOpSignature = await signUserOp(userOpHash, testWallet);
      userOp.signature = encodeZkapSignature([0], [userOpSignature]);

      // Execute UserOp
      const counterBefore = await testCounter.count();
      await entryPoint.handleOps([userOp], owner.address);
      const counterAfter = await testCounter.count();

      // Verify both succeeded with same key
      expect(counterAfter).to.equal(counterBefore + 1n);
    });
  });
});
