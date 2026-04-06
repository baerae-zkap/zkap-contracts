import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ZkapAccount } from "../../../typechain-types";
import {
  encodeAddressKey,
  encodeWebAuthnKey,
  encodePrimitiveKeys,
} from "../../helpers/accountKeyHelper";
import {
  generateWebAuthnKeyPair,
  signUserOpWebAuthn,
  WebAuthnKeyPair,
} from "../../helpers/userOpHelper";

/**
 * EIP-1271 SignMessage E2E Test - Passkey (WebAuthn)
 *
 * isValidSignature verification for ZkapAccount using WebAuthn (Passkey) key
 */

const EIP1271_MAGIC_VALUE = "0x1626ba7e";
const EIP1271_INVALID_SIGNATURE = "0xffffffff";

// ERC-7739 constants (must match ZkapAccount.sol)
const DOMAIN_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes("EIP712Domain(uint256 chainId,address verifyingContract)"));
const PERSONAL_SIGN_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes("PersonalSign(bytes32 prefixed)"));

/**
 * ERC-7739 defensive rehashing — replicate ZkapAccount.isValidSignature logic
 * digest = keccak256("\x19\x01" || domainSeparator || keccak256(abi.encode(PERSONAL_SIGN_TYPEHASH, hash)))
 */
function computeErc7739Digest(hash: string, chainId: number, accountAddress: string): string {
  const domainSeparator = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256", "address"], [DOMAIN_TYPEHASH, chainId, accountAddress]),
  );
  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [PERSONAL_SIGN_TYPEHASH, hash]),
  );
  return ethers.keccak256(ethers.solidityPacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator, structHash]));
}

function encodeIsValidSignature(keyIndices: number[], perKeySignatures: string[]): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [keyIndices, perKeySignatures]);
}

describe("EIP-1271 SignMessage with Passkey (WebAuthn)", function () {
  async function deployFixture() {
    const [deployer] = await ethers.getSigners();

    const entryPoint = await (await ethers.getContractFactory("EntryPoint")).deploy();
    const accountKeyAddressLogic = await (await ethers.getContractFactory("AccountKeyAddress")).deploy();
    const accountKeyWebAuthnLogic = await (await ethers.getContractFactory("AccountKeyWebAuthn")).deploy();
    const factory = await (await ethers.getContractFactory("ZkapAccountFactory")).deploy(entryPoint.target);

    const webAuthnKeyPair = generateWebAuthnKeyPair();

    return { factory, accountKeyAddressLogic, accountKeyWebAuthnLogic, deployer, webAuthnKeyPair };
  }

  async function createAccountWithWebAuthnTxKey(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
    keyPair?: WebAuthnKeyPair,
  ): Promise<{ zkapAccount: ZkapAccount; webAuthnKeyPair: WebAuthnKeyPair }> {
    const { factory, accountKeyAddressLogic, accountKeyWebAuthnLogic, deployer } = fixture;
    const kp = keyPair ?? fixture.webAuthnKeyPair;

    const masterKey = encodePrimitiveKeys(1, [
      encodeAddressKey(deployer.address, await accountKeyAddressLogic.getAddress()),
    ]);

    const txKey = encodePrimitiveKeys(1, [
      encodeWebAuthnKey(
        kp.publicKey.x,
        kp.publicKey.y,
        kp.credentialId,
        kp.rpIdHash,
        kp.origin,
        await accountKeyWebAuthnLogic.getAddress(),
      ),
    ]);

    const salt = BigInt(Math.floor(Math.random() * 1000000));
    await factory.createAccount(salt, masterKey, txKey);
    const accountAddress = await factory.calcAccountAddress(salt, masterKey, txKey);
    const zkapAccount = (await ethers.getContractAt("ZkapAccount", accountAddress)) as ZkapAccount;

    return { zkapAccount, webAuthnKeyPair: kp };
  }

  describe("WebAuthn Single Signer", function () {
    it("should validate personal_sign message with Passkey", async function () {
      const fixture = await loadFixture(deployFixture);
      const { zkapAccount, webAuthnKeyPair } = await createAccountWithWebAuthnTxKey(fixture);
      const accountAddress = await zkapAccount.getAddress();

      const messageHash = ethers.hashMessage("Welcome to ZKAP Wallet with Passkey!");
      const digest = computeErc7739Digest(messageHash, 8216, accountAddress);
      const webAuthnSig = signUserOpWebAuthn(digest, webAuthnKeyPair);
      const encoded = encodeIsValidSignature([0], [webAuthnSig]);

      const result = await zkapAccount.isValidSignature(messageHash, encoded);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });

    it("should reject signature with wrong private key", async function () {
      const fixture = await loadFixture(deployFixture);
      const { zkapAccount } = await createAccountWithWebAuthnTxKey(fixture);
      const accountAddress = await zkapAccount.getAddress();

      const wrongKeyPair = generateWebAuthnKeyPair();
      const messageHash = ethers.hashMessage("Test message");
      const digest = computeErc7739Digest(messageHash, 8216, accountAddress);
      const wrongSig = signUserOpWebAuthn(digest, wrongKeyPair);
      const encoded = encodeIsValidSignature([0], [wrongSig]);

      const result = await zkapAccount.isValidSignature(messageHash, encoded);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });

    it("should reject signature with wrong challenge", async function () {
      const fixture = await loadFixture(deployFixture);
      const { zkapAccount, webAuthnKeyPair } = await createAccountWithWebAuthnTxKey(fixture);
      const accountAddress = await zkapAccount.getAddress();

      const messageHash1 = ethers.hashMessage("Message 1");
      const messageHash2 = ethers.hashMessage("Message 2");

      // sign with message2 digest but attempt verification with message1 hash
      const digest2 = computeErc7739Digest(messageHash2, 8216, accountAddress);
      const sig = signUserOpWebAuthn(digest2, webAuthnKeyPair);
      const encoded = encodeIsValidSignature([0], [sig]);

      await expect(zkapAccount.isValidSignature(messageHash1, encoded)).to.be.revertedWithCustomError(
        await ethers.getContractAt("AccountKeyWebAuthn", await zkapAccount.getAddress()),
        "InvalidChallenge",
      );
    });

    it("should validate EIP-712 typed data signature", async function () {
      const fixture = await loadFixture(deployFixture);
      const { zkapAccount, webAuthnKeyPair } = await createAccountWithWebAuthnTxKey(fixture);
      const accountAddress = await zkapAccount.getAddress();

      const typedDataHash = ethers.TypedDataEncoder.hash(
        { name: "ZKAP Passkey DApp", version: "1", chainId: 8216, verifyingContract: accountAddress },
        { Action: [{ name: "user", type: "address" }, { name: "action", type: "string" }, { name: "nonce", type: "uint256" }] },
        { user: accountAddress, action: "Approve transaction", nonce: BigInt(1) },
      );

      const digest = computeErc7739Digest(typedDataHash, 8216, accountAddress);
      const sig = signUserOpWebAuthn(digest, webAuthnKeyPair);
      const encoded = encodeIsValidSignature([0], [sig]);

      const result = await zkapAccount.isValidSignature(typedDataHash, encoded);
      expect(result).to.equal(EIP1271_MAGIC_VALUE);
    });
  });

  describe("WebAuthn Edge Cases", function () {
    it("should reject invalid rpIdHash", async function () {
      const fixture = await loadFixture(deployFixture);
      const { zkapAccount, webAuthnKeyPair } = await createAccountWithWebAuthnTxKey(fixture);
      const accountAddress = await zkapAccount.getAddress();

      const messageHash = ethers.hashMessage("Test message");
      const digest = computeErc7739Digest(messageHash, 8216, accountAddress);
      const sig = signUserOpWebAuthn(digest, webAuthnKeyPair, {
        overrideRpIdHash: "0x" + "00".repeat(32),
      });
      const encoded = encodeIsValidSignature([0], [sig]);

      await expect(zkapAccount.isValidSignature(messageHash, encoded)).to.be.revertedWithCustomError(
        await ethers.getContractAt("AccountKeyWebAuthn", accountAddress),
        "InvalidRpId",
      );
    });

    it("should reject invalid origin", async function () {
      const fixture = await loadFixture(deployFixture);
      const { zkapAccount, webAuthnKeyPair } = await createAccountWithWebAuthnTxKey(fixture);
      const accountAddress = await zkapAccount.getAddress();

      const messageHash = ethers.hashMessage("Test message");
      const digest = computeErc7739Digest(messageHash, 8216, accountAddress);
      const sig = signUserOpWebAuthn(digest, webAuthnKeyPair, {
        overrideOrigin: "http://evil.com",
      });
      const encoded = encodeIsValidSignature([0], [sig]);

      await expect(zkapAccount.isValidSignature(messageHash, encoded)).to.be.revertedWithCustomError(
        await ethers.getContractAt("AccountKeyWebAuthn", accountAddress),
        "InvalidOrigin",
      );
    });

    it("should reject out of bounds key index", async function () {
      const fixture = await loadFixture(deployFixture);
      const { zkapAccount, webAuthnKeyPair } = await createAccountWithWebAuthnTxKey(fixture);
      const accountAddress = await zkapAccount.getAddress();

      const messageHash = ethers.hashMessage("Test message");
      const digest = computeErc7739Digest(messageHash, 8216, accountAddress);
      const sig = signUserOpWebAuthn(digest, webAuthnKeyPair);
      const encoded = encodeIsValidSignature([99], [sig]);

      const result = await zkapAccount.isValidSignature(messageHash, encoded);
      expect(result).to.equal(EIP1271_INVALID_SIGNATURE);
    });
  });
});
