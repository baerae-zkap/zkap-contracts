import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("ZkapAccount - isValidSignature (EIP-1271)", function () {
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

  async function deployFixture() {
    const [owner] = await ethers.getSigners();

    // Create test wallets with explicit private keys for signature testing
    const signer1 = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
    const signer2 = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890124");
    const signer3 = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890125");

    // Deploy EntryPoint contract
    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const entryPoint = await EntryPoint.deploy();
    await entryPoint.waitForDeployment();

    // Deploy AccountKeyAddress logic contract
    const AccountKeyAddress = await ethers.getContractFactory("AccountKeyAddress");
    const accountKeyAddressLogic = await AccountKeyAddress.deploy();
    await accountKeyAddressLogic.waitForDeployment();

    // Deploy and initialize ZkapAccount
    const ZkapAccount = await ethers.getContractFactory("ZkapAccount");
    const zkapAccountLogic = await ZkapAccount.deploy(entryPoint.target);
    await zkapAccountLogic.waitForDeployment();

    // Deploy ZkapAccount proxy for testing
    // Set masterKey and txKey to signer1 (threshold=1, weight=1)
    const masterKeyInitData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);
    const txKeyInitData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);

    // encodedMasterKey: (threshold, logicAddressList, initDataList, weightList)
    const encodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "address[]", "bytes[]", "uint8[]"],
      [1, [accountKeyAddressLogic.target], [masterKeyInitData], [1]],
    );

    // encodedTxKey: (threshold, logicAddressList, initDataList, weightList)
    const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "address[]", "bytes[]", "uint8[]"],
      [1, [accountKeyAddressLogic.target], [txKeyInitData], [1]],
    );

    // Deploy via ZkapAccountFactory
    const ZkapAccountFactory = await ethers.getContractFactory("ZkapAccountFactory");
    const zkapAccountFactory = await ZkapAccountFactory.deploy(entryPoint.target);
    await zkapAccountFactory.waitForDeployment();

    const salt = 12345n;
    const tx = await zkapAccountFactory.createAccount(salt, encodedMasterKey, encodedTxKey);
    await tx.wait();

    const accountAddress = await zkapAccountFactory.calcAccountAddress(salt, encodedMasterKey, encodedTxKey);

    const zkapAccount = await ethers.getContractAt("ZkapAccount", accountAddress);

    return {
      zkapAccount,
      entryPoint,
      accountKeyAddressLogic,
      owner,
      signer1,
      signer2,
      signer3,
    };
  }

  async function deployMultiSigFixture() {
    const [owner] = await ethers.getSigners();

    // Create test wallets with explicit private keys for signature testing
    const signer1 = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
    const signer2 = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890124");
    const signer3 = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890125");

    // Deploy EntryPoint contract
    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const entryPoint = await EntryPoint.deploy();
    await entryPoint.waitForDeployment();

    // Deploy AccountKeyAddress logic contract
    const AccountKeyAddress = await ethers.getContractFactory("AccountKeyAddress");
    const accountKeyAddressLogic = await AccountKeyAddress.deploy();
    await accountKeyAddressLogic.waitForDeployment();

    // Configure multi-sig txKey (threshold=2, 3 signers, each weight=1)
    const txKeyInitData1 = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);
    const txKeyInitData2 = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer2.address]);
    const txKeyInitData3 = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer3.address]);

    // Configure masterKey (threshold=1, signer1)
    const masterKeyInitData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);

    const encodedMasterKey = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "address[]", "bytes[]", "uint8[]"],
      [1, [accountKeyAddressLogic.target], [masterKeyInitData], [1]],
    );

    // txKey: threshold=2, 3 signers, weights=[1,1,1]
    const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "address[]", "bytes[]", "uint8[]"],
      [
        2,
        [accountKeyAddressLogic.target, accountKeyAddressLogic.target, accountKeyAddressLogic.target],
        [txKeyInitData1, txKeyInitData2, txKeyInitData3],
        [1, 1, 1],
      ],
    );

    // Deploy via ZkapAccountFactory
    const ZkapAccountFactory = await ethers.getContractFactory("ZkapAccountFactory");
    const zkapAccountFactory = await ZkapAccountFactory.deploy(entryPoint.target);
    await zkapAccountFactory.waitForDeployment();

    const salt = 54321n;
    const tx = await zkapAccountFactory.createAccount(salt, encodedMasterKey, encodedTxKey);
    await tx.wait();

    const accountAddress = await zkapAccountFactory.calcAccountAddress(salt, encodedMasterKey, encodedTxKey);

    const zkapAccount = await ethers.getContractAt("ZkapAccount", accountAddress);

    return {
      zkapAccount,
      entryPoint,
      accountKeyAddressLogic,
      owner,
      signer1,
      signer2,
      signer3,
    };
  }

  describe("Basic Signature Validation", function () {
    it("Should return magic value for valid signature", async function () {
      const { zkapAccount, signer1 } = await loadFixture(deployFixture);

      // Generate test hash (assumed to already have EIP-191 prefix applied)
      const message = "Hello, World!";
      const messageHash = ethers.hashMessage(message);

      // ERC-7739: Compute the rehashed digest that contract will validate
      const accountAddress = await zkapAccount.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(messageHash, accountAddress, chainId);

      // Sign the rehashed digest directly (raw ECDSA signature)
      const sig = ethers.Signature.from(signer1.signingKey.sign(digest));
      const signature = sig.serialized;

      // Encode signature in (keyIndexList, keySignatureList) format
      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });

    it("Should return invalid for wrong signer", async function () {
      const { zkapAccount, signer2 } = await loadFixture(deployFixture);

      const message = "Hello, World!";
      const messageHash = ethers.hashMessage(message);

      // Sign with signer2 (txKey is configured as signer1)
      const signature = await signer2.signMessage(message);

      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    it("Should return invalid for wrong message", async function () {
      const { zkapAccount, signer1 } = await loadFixture(deployFixture);

      const message1 = "Hello, World!";
      const message2 = "Different Message";
      const messageHash = ethers.hashMessage(message1);

      // Sign with a different message
      const signature = await signer1.signMessage(message2);

      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    it("Should return invalid for mismatched array lengths", async function () {
      const { zkapAccount, signer1 } = await loadFixture(deployFixture);

      const message = "Hello, World!";
      const messageHash = ethers.hashMessage(message);
      const signature = await signer1.signMessage(message);

      // keyIndexList and keySignatureList have different lengths
      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [[0, 1], [signature]], // 2 indices, 1 signature
      );

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    it("Should return invalid for out of bounds key index", async function () {
      const { zkapAccount, signer1 } = await loadFixture(deployFixture);

      const message = "Hello, World!";
      const messageHash = ethers.hashMessage(message);
      const signature = await signer1.signMessage(message);

      // Non-existent key index
      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[99], [signature]]);

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    it("Should return invalid for duplicate key index", async function () {
      const { zkapAccount, signer1 } = await loadFixture(deployFixture);

      const message = "Hello, World!";
      const messageHash = ethers.hashMessage(message);
      const signature = await signer1.signMessage(message);

      // Duplicate key index
      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [
          [0, 0],
          [signature, signature],
        ],
      );

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });
  });

  describe("Multi-Signature Validation", function () {
    it("Should return magic value when threshold is met", async function () {
      const { zkapAccount, signer1, signer2 } = await loadFixture(deployMultiSigFixture);

      const message = "Hello, Multi-Sig!";
      const messageHash = ethers.hashMessage(message);

      // ERC-7739: Compute the rehashed digest
      const accountAddress = await zkapAccount.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(messageHash, accountAddress, chainId);

      // 2 signers sign the rehashed digest directly (threshold=2)
      const sig1 = ethers.Signature.from(signer1.signingKey.sign(digest));
      const signature1 = sig1.serialized;

      const sig2 = ethers.Signature.from(signer2.signingKey.sign(digest));
      const signature2 = sig2.serialized;

      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [
          [0, 1],
          [signature1, signature2],
        ],
      );

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });

    it("Should return invalid when threshold is not met", async function () {
      const { zkapAccount, signer1 } = await loadFixture(deployMultiSigFixture);

      const message = "Hello, Multi-Sig!";
      const messageHash = ethers.hashMessage(message);

      // Only 1 signer (threshold=2)
      const signature1 = await signer1.signMessage(message);

      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature1]]);

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    it("Should work with any combination of signers meeting threshold", async function () {
      const { zkapAccount, signer2, signer3 } = await loadFixture(deployMultiSigFixture);

      const message = "Hello, Multi-Sig!";
      const messageHash = ethers.hashMessage(message);

      // ERC-7739: Compute the rehashed digest
      const accountAddress = await zkapAccount.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(messageHash, accountAddress, chainId);

      // signer2 and signer3 sign the rehashed digest directly (without signer1)
      const sig2 = ethers.Signature.from(signer2.signingKey.sign(digest));
      const signature2 = sig2.serialized;

      const sig3 = ethers.Signature.from(signer3.signingKey.sign(digest));
      const signature3 = sig3.serialized;

      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8[]", "bytes[]"],
        [
          [1, 2],
          [signature2, signature3],
        ],
      );

      const result = await zkapAccount.isValidSignature(messageHash, encodedSignature);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });
  });

  describe("EIP-712 TypedData Validation", function () {
    it("Should validate EIP-712 typed data signature", async function () {
      const { zkapAccount, signer1 } = await loadFixture(deployFixture);

      // Define EIP-712 domain and types
      const domain = {
        name: "TestApp",
        version: "1",
        chainId: 31337, // hardhat network
        verifyingContract: await zkapAccount.getAddress(),
      };

      const types = {
        Mail: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "contents", type: "string" },
        ],
      };

      const value = {
        from: signer1.address,
        to: "0x0000000000000000000000000000000000000001",
        contents: "Hello!",
      };

      // Compute EIP-712 hash
      const typedDataHash = ethers.TypedDataEncoder.hash(domain, types, value);

      // ERC-7739: Compute the rehashed digest
      const accountAddress = await zkapAccount.getAddress();
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const digest = computeERC7739Digest(typedDataHash, accountAddress, chainId);

      // Sign the rehashed digest directly (not the original typedDataHash)
      const sig = ethers.Signature.from(signer1.signingKey.sign(digest));
      const signature = sig.serialized;

      const encodedSignature = ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [[0], [signature]]);

      const result = await zkapAccount.isValidSignature(typedDataHash, encodedSignature);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });
  });
});
