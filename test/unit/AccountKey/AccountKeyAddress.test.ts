import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { AccountKeyAddress } from "../../../typechain-types";

async function deployAccountKeyAddress() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const signer1 = signers[1];
  const signer2 = signers[2];
  const other = signers[3];

  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKey = await AccountKeyAddressFactory.deploy();
  await accountKey.waitForDeployment();

  return { accountKey, owner, signer1, signer2, other };
}

async function deployAccountKeyAddressWithRegisteredKey() {
  const { accountKey, owner, signer1, signer2, other } = await deployAccountKeyAddress();

  // Register a key for owner
  const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);
  await accountKey.connect(owner).register(0, initData);

  return { accountKey, owner, signer1, signer2, other, keyId: 0n };
}

describe("AccountKeyAddress", async function () {
  describe("Deployment", async function () {
    // CNT-155: AccountKeyAddress singleton contract deployment success
    it("Should deploy singleton contract", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      expect(await accountKey.getAddress()).to.be.properAddress;
    });
  });

  describe("Registration", async function () {
    // CNT-158: register signer address via register()
    it("register signer address", async function () {
      const { accountKey, owner, signer1 } = await loadFixture(deployAccountKeyAddressWithRegisteredKey);
      expect(await accountKey.getSigner(0, owner.address, 0n)).to.equal(signer1.address);
    });

    // CNT-160: emit AccountKeyAddressRegistered event
    it("emit AccountKeyAddressRegistered event", async function () {
      const { accountKey, owner, signer1 } = await loadFixture(deployAccountKeyAddress);
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);

      await expect(accountKey.connect(owner).register(0, initData))
        .to.emit(accountKey, "AccountKeyAddressRegistered")
        .withArgs(owner.address, 0n, signer1.address);
    });

    // CNT-162: multiple accounts can each register keys independently
    it("allow different accounts to register keys", async function () {
      const { accountKey, owner, signer1, other, signer2 } = await loadFixture(deployAccountKeyAddress);

      const initData1 = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);
      await accountKey.connect(owner).register(0, initData1);

      const initData2 = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer2.address]);
      await accountKey.connect(other).register(0, initData2);

      expect(await accountKey.getSigner(0, owner.address, 0n)).to.equal(signer1.address);
      expect(await accountKey.getSigner(0, other.address, 0n)).to.equal(signer2.address);
    });

    // Re-registering from the same account adds to a new slot (multi-slot)
    it("register second key in next slot from same account", async function () {
      const { accountKey, owner, signer1, signer2 } = await loadFixture(deployAccountKeyAddress);

      const initData1 = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);
      await accountKey.connect(owner).register(0, initData1);

      const initData2 = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer2.address]);
      await accountKey.connect(owner).register(0, initData2);

      // Multi-slot: each register() call is stored in a separate slot
      expect(await accountKey.getSigner(0, owner.address, 0n)).to.equal(signer1.address);
      expect(await accountKey.getSigner(0, owner.address, 1n)).to.equal(signer2.address);
    });
  });

  describe("keyType", async function () {
    // CNT-166: keyType returns 1 (keyAddress)
    it("return keyType = 1 (keyAddress)", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      expect(await accountKey.keyType()).to.equal(1);
    });
  });

  describe("validate", async function () {
    // CNT-169: valid signature verification succeeds
    it("validate with correct signature", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.register(0, initData);

      const message = "Test message";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      expect(await accountKey.validate(0, 0n, sig.serialized, msgHash)).to.equal(true);
    });

    // CNT-170: reject invalid signature
    it("reject incorrect signature", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
      const testWallet2 = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890124");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.register(0, initData);

      const msgHash = ethers.keccak256(ethers.toUtf8Bytes("Test message"));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet2.signingKey.sign(messageHashBytes));

      expect(await accountKey.validate(0, 0n, sig.serialized, msgHash)).to.equal(false);
    });

    // CNT-171: reject signature for a different message
    it("reject signature for different message", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.register(0, initData);

      const msgHash = ethers.keccak256(ethers.toUtf8Bytes("Test message"));
      const differentMsgHash = ethers.keccak256(ethers.toUtf8Bytes("Different message"));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      expect(await accountKey.validate(0, 0n, sig.serialized, differentMsgHash)).to.equal(false);
    });

    // CNT-172: validate called from different account has no key data (returns false)
    it("return false when called by non-registrant account", async function () {
      const { accountKey, other } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.register(0, initData);

      const msgHash = ethers.keccak256(ethers.toUtf8Bytes("Test"));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      // other account didn't register this key, so validate returns false
      expect(await accountKey.connect(other).validate(0, 0n, sig.serialized, msgHash)).to.equal(false);
    });

    // Multi-slot: out-of-bounds keyId returns false
    it("return false for out-of-bounds keyId", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyAddress);

      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.connect(owner).register(0, initData);

      const message = "Test";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      // keyId=999 is out of the registered slot range → false
      expect(await accountKey.connect(owner).validate(0, 999n, sig.serialized, msgHash)).to.equal(false);
      // keyId=0 is valid
      expect(await accountKey.connect(owner).validate(0, 0n, sig.serialized, msgHash)).to.equal(true);
    });
  });

  describe("Transaction Key Tests (purpose=1)", async function () {
    // Test register with KeyPurpose.Tx
    it("register with KeyPurpose.Tx (purpose=1)", async function () {
      const { accountKey, owner, signer1 } = await loadFixture(deployAccountKeyAddress);
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);
      await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)
      expect(await accountKey.getSigner(1, owner.address, 0n)).to.equal(signer1.address);
    });

    // Test validate with KeyPurpose.Tx
    it("validate with KeyPurpose.Tx (purpose=1)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)

      const message = "Test message";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      expect(await accountKey.connect(owner).validate(1, 0n, sig.serialized, msgHash)).to.equal(true);
    });

    // Test resetKeys with KeyPurpose.Tx
    it("resetKeys with KeyPurpose.Tx (purpose=1)", async function () {
      const { accountKey, owner, signer1 } = await loadFixture(deployAccountKeyAddress);

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);
      await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)

      // Verify key exists
      expect(await accountKey.getSigner(1, owner.address, 0n)).to.equal(signer1.address);

      // Reset keys (msg.sender = owner)
      await accountKey.connect(owner).resetKeys(1);

      // Verify key is cleared
      expect(await accountKey.getSigner(1, owner.address, 0n)).to.equal(ethers.ZeroAddress);
    });
  });

  describe("MAX_KEYS_PER_ACCOUNT limit", async function () {
    it("revert when registering more than MAX_KEYS_PER_ACCOUNT (5 keys)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyAddress);
      const signers = await ethers.getSigners();

      // Register 5 keys (should succeed)
      for (let i = 0; i < 5; i++) {
        const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signers[i + 1].address]);
        await accountKey.connect(owner).register(0, initData);
      }

      // Try to register 6th key (should revert)
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signers[6].address]);
      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "MaxKeysExceeded",
      );
    });
  });

  describe("resetKeys validation", async function () {
    it("validate returns false after resetKeys", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.connect(owner).register(0, initData);

      const message = "Test message";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      // Verify signature works before reset
      expect(await accountKey.connect(owner).validate(0, 0n, sig.serialized, msgHash)).to.equal(true);

      // Reset keys (msg.sender = owner)
      await accountKey.connect(owner).resetKeys(0);

      // Verify signature fails after reset (stored signer is address(0))
      expect(await accountKey.connect(owner).validate(0, 0n, sig.serialized, msgHash)).to.equal(false);
    });

    it("getKey returns address(0) for out-of-bounds keyId", async function () {
      const { accountKey, owner, signer1 } = await loadFixture(deployAccountKeyAddress);

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]);
      await accountKey.connect(owner).register(0, initData);

      // keyId=999 is out of bounds
      expect(await accountKey.getSigner(0, owner.address, 999n)).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Edge cases", async function () {
    // CNT-163: revert with zero address signer
    it("revert with zero address as signer", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ethers.ZeroAddress]);
      await expect(accountKey.register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "SignerCannotBeZeroAddress",
      );
    });

    // CNT-174: revert with empty signature
    it("revert with empty signature", async function () {
      const { accountKey, keyId } = await loadFixture(deployAccountKeyAddressWithRegisteredKey);
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes("Test"));
      await expect(accountKey.validate(0, keyId, "0x", msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "ECDSAInvalidSignatureLength",
      );
    });

    // CNT-175: revert with malformed signature
    it("revert with malformed signature", async function () {
      const { accountKey, keyId } = await loadFixture(deployAccountKeyAddressWithRegisteredKey);
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes("Test"));
      await expect(accountKey.validate(0, keyId, "0x1234", msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "ECDSAInvalidSignatureLength",
      );
    });

    // CNT-498: malformed signature (length less than 64 bytes)
    it("CNT-498: revert with signature length less than 64 bytes", async function () {
      const { accountKey, keyId } = await loadFixture(deployAccountKeyAddressWithRegisteredKey);
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes("Test message"));
      const shortSig = "0x" + "ab".repeat(63);
      await expect(accountKey.validate(0, keyId, shortSig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "ECDSAInvalidSignatureLength",
      );
    });

    // CNT-499: revert with zero address signer (duplicate of CNT-163)
    it("CNT-499: revert when registering with zero address signer", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ethers.ZeroAddress]);
      await expect(accountKey.register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "SignerCannotBeZeroAddress",
      );
    });

    // Additional: signature with invalid recovery value (v)
    it("reject signature with invalid v value", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.register(0, initData);

      const message = "Test message";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      // Create signature with invalid v value (v=30)
      const invalidSig = ethers.concat([sig.r, sig.s, "0x1e"]);

      await expect(accountKey.validate(0, 0n, invalidSig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "ECDSAInvalidSignature",
      );
    });

    // Branch coverage: line 82 - stored == address(0) after storage corruption
    it("return false when stored signer is address(0) via storage manipulation", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.connect(owner).register(0, initData);

      // Verify registration works
      expect(await accountKey.getSigner(0, owner.address, 0n)).to.equal(testWallet.address);

      // Calculate storage slot for _masterSignerSlots[owner].signers[0]
      // _masterSignerSlots is the first mapping (slot 0)
      // mapping base = keccak256(abi.encode(owner, 0))
      const contractAddr = await accountKey.getAddress();
      const baseSlot = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [owner.address, 0])
      );
      // signers[0] is at baseSlot + 0 (first element of the struct)

      // Set signers[0] to address(0) while count remains 1
      await ethers.provider.send("hardhat_setStorageAt", [
        contractAddr,
        baseSlot,
        ethers.zeroPadValue("0x00", 32),
      ]);

      // Now count=1, keyId=0 passes the count check, but stored=address(0)
      const message = "Test message";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      // This hits line 82: if (stored == address(0)) return false
      expect(await accountKey.connect(owner).validate(0, 0n, sig.serialized, msgHash)).to.equal(false);
    });

    // Additional: signature malleability check (high S value)
    it("reject signature with high S value (malleability protection)", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyAddress);
      const testWallet = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [testWallet.address]);
      await accountKey.register(0, initData);

      const message = "Test message for malleability";
      const msgHash = ethers.keccak256(ethers.toUtf8Bytes(message));
      const messageHashBytes = ethers.getBytes(msgHash);
      const sig = ethers.Signature.from(testWallet.signingKey.sign(messageHashBytes));

      // Normal signature should be valid
      expect(await accountKey.validate(0, 0n, sig.serialized, msgHash)).to.be.true;

      const curveN = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
      const sValue = BigInt(sig.s);
      const highS = curveN - sValue;

      const highSSig = ethers.concat([sig.r, ethers.toBeHex(highS, 32), ethers.toBeHex(sig.v === 27 ? 28 : 27, 1)]);

      await expect(accountKey.validate(0, 0n, highSSig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "ECDSAInvalidSignatureS",
      );
    });
  });
});
