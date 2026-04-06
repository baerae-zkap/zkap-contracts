import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import * as secp256r1 from "secp256r1";
import * as crypto from "crypto";

async function deployAccountKeySecp256r1() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const nonOwner = signers[1];

  // Generate a secp256r1 key pair
  const privateKey = crypto.randomBytes(32);
  const pubKey = secp256r1.publicKeyCreate(privateKey, false); // false = uncompressed

  // Public key is 65 bytes: 0x04 + x (32 bytes) + y (32 bytes)
  const xBytes = pubKey.slice(1, 33);
  const yBytes = pubKey.slice(33, 65);

  const publicKey = {
    x: "0x" + xBytes.toString("hex"),
    y: "0x" + yBytes.toString("hex"),
  };

  // Deploy singleton contract
  const AccountKeySecp256r1Factory = await ethers.getContractFactory("AccountKeySecp256r1");
  const accountKey = await AccountKeySecp256r1Factory.deploy();
  await accountKey.waitForDeployment();

  return { accountKey, owner, nonOwner, privateKey, publicKey };
}

async function deployAccountKeySecp256r1WithRegisteredKey() {
  const { accountKey, owner, nonOwner, privateKey, publicKey } = await deployAccountKeySecp256r1();

  // Register a key for owner
  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32 x, bytes32 y)"],
    [{ x: publicKey.x, y: publicKey.y }],
  );
  await accountKey.connect(owner).register(0, initData);

  return { accountKey, owner, nonOwner, privateKey, publicKey, keyId: 0n };
}

async function generateSignature(privateKey: Buffer, message: string) {
  const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
  const msgHashBytes = Buffer.from(msgHash.slice(2), "hex");
  const signResult = secp256r1.sign(msgHashBytes, privateKey);

  const r = "0x" + signResult.signature.slice(0, 32).toString("hex");
  const s = "0x" + signResult.signature.slice(32, 64).toString("hex");

  const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [r, s]);

  return { encodedSig, msgHash };
}

describe("AccountKeySecp256r1", async function () {
  describe("Deployment", async function () {
    // CNT-181: AccountKeySecp256r1 singleton contract deployment success
    it("Should deploy singleton contract", async function () {
      const { accountKey } = await loadFixture(deployAccountKeySecp256r1);
      expect(await accountKey.getAddress()).to.be.properAddress;
    });
  });

  describe("Registration", async function () {
    // CNT-183: verify key registration
    it("register key", async function () {
      const { accountKey, owner, publicKey, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);
      const [x, y] = await accountKey.getKey(0, owner.address, keyId);
      expect(ethers.toBeHex(x, 32)).to.equal(publicKey.x);
      expect(ethers.toBeHex(y, 32)).to.equal(publicKey.y);
    });

    // CNT-186: emit AccountKeySecp256r1Registered event
    it("emit AccountKeySecp256r1Registered event", async function () {
      const { accountKey, owner, publicKey } = await loadFixture(deployAccountKeySecp256r1);

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );

      await expect(accountKey.connect(owner).register(0, initData))
        .to.emit(accountKey, "AccountKeySecp256r1Registered")
        .withArgs(owner.address, 0n, [publicKey.x, publicKey.y]);
    });

    // Multiple accounts can each register keys independently
    it("allow different accounts to register keys", async function () {
      const { accountKey, owner, nonOwner, publicKey } = await loadFixture(deployAccountKeySecp256r1);

      // Generate another key pair for nonOwner
      const privateKey2 = crypto.randomBytes(32);
      const pubKey2 = secp256r1.publicKeyCreate(privateKey2, false);
      const publicKey2 = {
        x: "0x" + pubKey2.slice(1, 33).toString("hex"),
        y: "0x" + pubKey2.slice(33, 65).toString("hex"),
      };

      const initData1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );
      await accountKey.connect(owner).register(0, initData1);

      const initData2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey2.x, y: publicKey2.y }],
      );
      await accountKey.connect(nonOwner).register(0, initData2);

      const [x1, y1] = await accountKey.getKey(0, owner.address, 0n);
      const [x2, y2] = await accountKey.getKey(0, nonOwner.address, 0n);

      expect(ethers.toBeHex(x1, 32)).to.equal(publicKey.x);
      expect(ethers.toBeHex(x2, 32)).to.equal(publicKey2.x);
    });

    // Re-registering from the same account adds to a new slot (multi-slot)
    it("register second key in next slot from same account", async function () {
      const { accountKey, owner, publicKey } = await loadFixture(deployAccountKeySecp256r1);

      // Generate another key pair
      const privateKey2 = crypto.randomBytes(32);
      const pubKey2 = secp256r1.publicKeyCreate(privateKey2, false);
      const publicKey2 = {
        x: "0x" + pubKey2.slice(1, 33).toString("hex"),
        y: "0x" + pubKey2.slice(33, 65).toString("hex"),
      };

      const initData1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );
      await accountKey.connect(owner).register(0, initData1);

      const initData2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey2.x, y: publicKey2.y }],
      );
      await accountKey.connect(owner).register(0, initData2);

      // Multi-slot: first key at keyId=0, second key at keyId=1
      const [x0] = await accountKey.getKey(0, owner.address, 0n);
      expect(ethers.toBeHex(x0, 32)).to.equal(publicKey.x);
      const [x1] = await accountKey.getKey(0, owner.address, 1n);
      expect(ethers.toBeHex(x1, 32)).to.equal(publicKey2.x);
    });
  });

  describe("keyType", async function () {
    // CNT-188: keyType = 3
    it("return KeyType.keySecp256r1 (3)", async function () {
      const { accountKey } = await loadFixture(deployAccountKeySecp256r1);
      expect(await accountKey.keyType()).to.equal(3);
    });
  });

  describe("validate", async function () {
    // CNT-190: valid signature verification succeeds
    it("validate correct signature", async function () {
      const { accountKey, owner, privateKey, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message = "Hello, Secp256r1!";
      const { encodedSig, msgHash } = await generateSignature(privateKey, message);

      const isValid = await accountKey.connect(owner).validate(0, keyId, encodedSig, msgHash);
      expect(isValid).to.be.true;
    });

    // CNT-191: reject invalid signature
    it("reject incorrect signature", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message = "Hello, Secp256r1!";
      const wrongPrivateKey = crypto.randomBytes(32);
      const { encodedSig, msgHash } = await generateSignature(wrongPrivateKey, message);

      const isValid = await accountKey.connect(owner).validate(0, keyId, encodedSig, msgHash);
      expect(isValid).to.be.false;
    });

    // CNT-192: reject signature for a different message
    it("reject signature for different message", async function () {
      const { accountKey, owner, privateKey, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message1 = "Hello, Secp256r1!";
      const message2 = "Different message";
      const { encodedSig } = await generateSignature(privateKey, message1);
      const msgHash2 = ethers.keccak256(ethers.toUtf8Bytes(message2));

      const isValid = await accountKey.connect(owner).validate(0, keyId, encodedSig, msgHash2);
      expect(isValid).to.be.false;
    });

    // CNT-193: validate called from different account has no key data (returns false)
    it("return false when called by non-registrant account", async function () {
      const { accountKey, nonOwner, privateKey, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message = "Hello, Secp256r1!";
      const { encodedSig, msgHash } = await generateSignature(privateKey, message);

      // nonOwner didn't register this key, so validate returns false
      const isValid = await accountKey.connect(nonOwner).validate(0, keyId, encodedSig, msgHash);
      expect(isValid).to.be.false;
    });

    // Multi-slot: out-of-bounds keyId returns false
    it("return false for out-of-bounds keyId", async function () {
      const { accountKey, owner, privateKey } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message = "Hello, Secp256r1!";
      const { encodedSig, msgHash } = await generateSignature(privateKey, message);

      // keyId=999 is out of the registered slot range → false
      const isValid = await accountKey.connect(owner).validate(0, 999n, encodedSig, msgHash);
      expect(isValid).to.be.false;
    });

    // CNT-194: revert with signature that is too short
    it("revert with malformed signature (too short)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message = "Hello, Secp256r1!";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));

      // Malformed signature (too short - less than 64 bytes)
      const malformedSig = "0x" + "00".repeat(32);

      await expect(accountKey.connect(owner).validate(0, keyId, malformedSig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidSignatureLength",
      );
    });

    // CNT-195: revert with signature that is too long
    it("revert with malformed signature (too long)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message = "Hello, Secp256r1!";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));

      // Malformed signature (too long - more than 64 bytes)
      const malformedSig = "0x" + "00".repeat(65);

      await expect(accountKey.connect(owner).validate(0, keyId, malformedSig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidSignatureLength",
      );
    });
  });

  describe("Transaction Key Tests (purpose=1)", async function () {
    // Test register with KeyPurpose.Tx
    it("register with KeyPurpose.Tx (purpose=1)", async function () {
      const { accountKey, owner, publicKey } = await loadFixture(deployAccountKeySecp256r1);
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );
      await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)

      const [x, y] = await accountKey.getKey(1, owner.address, 0n);
      expect(ethers.toBeHex(x, 32)).to.equal(publicKey.x);
      expect(ethers.toBeHex(y, 32)).to.equal(publicKey.y);
    });

    // Test validate with KeyPurpose.Tx
    it("validate with KeyPurpose.Tx (purpose=1)", async function () {
      const { accountKey, owner, privateKey } = await loadFixture(deployAccountKeySecp256r1);

      const pubKey = secp256r1.publicKeyCreate(privateKey, false);
      const publicKey = {
        x: "0x" + pubKey.slice(1, 33).toString("hex"),
        y: "0x" + pubKey.slice(33, 65).toString("hex"),
      };

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );
      await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)

      const message = "Test message";
      const { encodedSig, msgHash } = await generateSignature(privateKey, message);

      const isValid = await accountKey.connect(owner).validate(1, 0n, encodedSig, msgHash);
      expect(isValid).to.be.true;
    });

    // Test resetKeys with KeyPurpose.Tx
    it("resetKeys with KeyPurpose.Tx (purpose=1)", async function () {
      const { accountKey, owner, publicKey } = await loadFixture(deployAccountKeySecp256r1);

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );
      await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)

      // Verify key exists
      const [x, y] = await accountKey.getKey(1, owner.address, 0n);
      expect(ethers.toBeHex(x, 32)).to.equal(publicKey.x);

      // Reset keys (msg.sender = owner)
      await accountKey.connect(owner).resetKeys(1);

      // Verify key is cleared (0, 0)
      const [x2, y2] = await accountKey.getKey(1, owner.address, 0n);
      expect(x2).to.equal(0n);
      expect(y2).to.equal(0n);
    });
  });

  describe("MAX_KEYS_PER_ACCOUNT limit", async function () {
    it("revert when registering more than MAX_KEYS_PER_ACCOUNT (5 keys)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeySecp256r1);

      // Register 5 keys (should succeed)
      for (let i = 0; i < 5; i++) {
        const privateKey = crypto.randomBytes(32);
        const pubKey = secp256r1.publicKeyCreate(privateKey, false);
        const publicKey = {
          x: "0x" + pubKey.slice(1, 33).toString("hex"),
          y: "0x" + pubKey.slice(33, 65).toString("hex"),
        };

        const initData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(bytes32 x, bytes32 y)"],
          [{ x: publicKey.x, y: publicKey.y }],
        );
        await accountKey.connect(owner).register(0, initData);
      }

      // Try to register 6th key (should revert)
      const privateKey = crypto.randomBytes(32);
      const pubKey = secp256r1.publicKeyCreate(privateKey, false);
      const publicKey = {
        x: "0x" + pubKey.slice(1, 33).toString("hex"),
        y: "0x" + pubKey.slice(33, 65).toString("hex"),
      };

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );
      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "MaxKeysExceeded",
      );
    });
  });

  describe("resetKeys validation", async function () {
    it("validate returns false after resetKeys", async function () {
      const { accountKey, owner, privateKey, publicKey } = await loadFixture(deployAccountKeySecp256r1);

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );
      await accountKey.connect(owner).register(0, initData);

      const message = "Test message";
      const { encodedSig, msgHash } = await generateSignature(privateKey, message);

      // Verify signature works before reset
      expect(await accountKey.connect(owner).validate(0, 0n, encodedSig, msgHash)).to.be.true;

      // Reset keys (msg.sender = owner)
      await accountKey.connect(owner).resetKeys(0);

      // Verify signature fails after reset (stored key is (0, 0))
      expect(await accountKey.connect(owner).validate(0, 0n, encodedSig, msgHash)).to.be.false;
    });

    it("getKey returns (0, 0) for out-of-bounds keyId", async function () {
      const { accountKey, owner, publicKey } = await loadFixture(deployAccountKeySecp256r1);

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: publicKey.x, y: publicKey.y }],
      );
      await accountKey.connect(owner).register(0, initData);

      // keyId=999 is out of bounds
      const [x, y] = await accountKey.getKey(0, owner.address, 999n);
      expect(x).to.equal(0n);
      expect(y).to.equal(0n);
    });
  });

  describe("Edge Cases - Additional CNT Tests", async function () {
    // CNT-500: invalid public key coordinates (zero coordinates)
    it("revert when registering with zero public key coordinates", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeySecp256r1);

      // Use zero coordinates for public key
      const zeroPublicKey = {
        x: "0x" + "00".repeat(32),
        y: "0x" + "00".repeat(32),
      };

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: zeroPublicKey.x, y: zeroPublicKey.y }],
      );

      // Register should revert with InvalidKeyData when coordinates are zero
      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidKeyData",
      );
    });

    // Branch coverage: x valid, y=0
    it("revert when registering with y=0 (x valid)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeySecp256r1);

      const invalidKey = {
        x: ethers.hexlify(ethers.randomBytes(32)),
        y: ethers.ZeroHash,
      };

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: invalidKey.x, y: invalidKey.y }],
      );

      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidKeyData",
      );
    });

    // CNT-500: invalid public key coordinates (point not on curve - arbitrary invalid point)
    it("reject signature with invalid curve point coordinates", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeySecp256r1);

      // Use invalid curve point (random bytes that are not a valid point on secp256r1)
      const invalidPublicKey = {
        x: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        y: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      };

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y)"],
        [{ x: invalidPublicKey.x, y: invalidPublicKey.y }],
      );
      await accountKey.connect(owner).register(0, initData);

      // Generate a valid signature format
      const message = "Test message";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const dummyR = "0x" + "11".repeat(32);
      const dummyS = "0x" + "22".repeat(32);
      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [dummyR, dummyS]);

      // Signature should fail to validate with invalid public key
      const isValid = await accountKey.connect(owner).validate(0, 0n, encodedSig, msgHash);
      expect(isValid).to.be.false;
    });

    // CNT-638: revert when signature length is not 64 bytes
    it("CNT-638: revert when signature length is not 64 bytes", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message = "Test message";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));

      // Test various invalid signature lengths (not 64 bytes)
      const invalidLengths = [0, 32, 63, 65, 128];

      for (const len of invalidLengths) {
        const invalidSig = "0x" + "ab".repeat(len);
        await expect(accountKey.connect(owner).validate(0, keyId, invalidSig, msgHash)).to.be.revertedWithCustomError(
          accountKey,
          "InvalidSignatureLength",
        );
      }
    });

    // LOWS-001: revert high-S signature (malleable signature protection)
    it("revert with high-S signature value (InvalidSValue)", async function () {
      const { accountKey, owner, privateKey, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const message = "Hello, Secp256r1!";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const msgHashBytes = Buffer.from(msgHash.slice(2), "hex");

      // secp256r1 curve order N
      const SECP256R1_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

      // Sign the message
      const privKeyBuf = Buffer.from(privateKey.buffer, privateKey.byteOffset, privateKey.byteLength);
      const signResult = secp256r1.sign(msgHashBytes, privKeyBuf);

      const r = signResult.signature.slice(0, 32);
      const s = signResult.signature.slice(32, 64);

      // Compute high-S: N - s
      const sValue = BigInt("0x" + Buffer.from(s).toString("hex"));
      const highS = SECP256R1_N - sValue;
      const highSHex = highS.toString(16).padStart(64, "0");

      const rHex = "0x" + Buffer.from(r).toString("hex");
      const highSBytes32 = "0x" + highSHex;

      const highSSig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32"],
        [rHex, highSBytes32],
      );

      await expect(accountKey.connect(owner).validate(0, keyId, highSSig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidSValue",
      );
    });

    // Branch coverage: s == N → first InvalidSValue check (s >= N)
    it("revert when s equals SECP256R1_N (first check: s >= N)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeySecp256r1WithRegisteredKey);

      const SECP256R1_N = "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551";
      const r = "0x" + "11".repeat(32);
      const s = SECP256R1_N;

      const encodedSig = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [r, s]);
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes("Test message for s=N"));

      await expect(accountKey.connect(owner).validate(0, keyId, encodedSig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidSValue",
      );
    });
  });
});
