import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { generateWebAuthnKeyPair, signUserOpWebAuthn } from "../../helpers/userOpHelper";

// Test data
const testData = {
  x: "0xf09d29df18e80d385ecce95ee02ed86cab29b0578524646f0ff303c9135f50c7",
  y: "0xa43881fa52d7954549db50a02ffc6793809e57a0fad0cb3773eb39a6988a31c7",
  credentialPubkey: new Uint8Array(
    Buffer.from(
      "pQECAyYgASFYIPCdKd8Y6A04XszpXuAu2GyrKbBXhSRkbw_zA8kTX1DHIlggpDiB-lLXlUVJ21CgL_xnk4CeV6D60Ms3c-s5ppiKMcc",
      "base64url",
    ),
  ),
  credentialId: "test-credential-id",
  origin: "http://localhost:8000",
  rpIdHash: "0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763", // sha256 of "localhost"
};

// Helper function to decode public key from CBOR
function decodePublicKeyFromCBOR(credentialPubkey: Uint8Array): { x: string; y: string } {
  // Find marker pattern [0x58, 0x20] in the credential public key
  function findMarker(data: Uint8Array, start = 0): number {
    for (let i = start; i < data.length - 1; i++) {
      if (data[i] === 0x58 && data[i + 1] === 0x20) {
        return i;
      }
    }
    return -1;
  }

  const xMarkerIndex = findMarker(credentialPubkey);
  const xStart = xMarkerIndex + 2;
  const xBytes = credentialPubkey.slice(xStart, xStart + 32);

  const yMarkerIndex = findMarker(credentialPubkey, xStart);
  const yStart = yMarkerIndex + 2;
  const yBytes = credentialPubkey.slice(yStart, yStart + 32);

  return {
    x: "0x" + Buffer.from(xBytes).toString("hex"),
    y: "0x" + Buffer.from(yBytes).toString("hex"),
  };
}

function buildWebAuthnSig(
  clientDataStr: string,
  authenticatorData: Uint8Array | Buffer,
  derSignature: Uint8Array | Buffer,
): string {
  const typeKey = '"type":"';
  const challengeKey = '"challenge":"';
  const originKey = '"origin":"';

  const typeIndex = clientDataStr.indexOf(typeKey) + typeKey.length;
  const challengeIndex = clientDataStr.indexOf(challengeKey) + challengeKey.length;
  const originStart = clientDataStr.indexOf(originKey) + originKey.length;
  const originEnd = clientDataStr.indexOf('"', originStart);

  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
    [
      authenticatorData,
      Buffer.from(clientDataStr, "utf8"),
      derSignature,
      typeIndex,
      challengeIndex,
      originStart,
      originEnd - originStart,
    ],
  );
}

// Fixture function to deploy singleton contract
async function deployAccountKeyWebAuthn() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const nonOwner = signers[1];

  // Deploy singleton contract (no library linking required)
  const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
  const accountKey = await AccountKeyWebAuthnFactory.deploy();
  await accountKey.waitForDeployment();

  return { accountKey, owner, nonOwner };
}

// Fixture function to deploy singleton and register a key
async function deployAccountKeyWebAuthnWithRegisteredKey() {
  const { accountKey, owner, nonOwner } = await deployAccountKeyWebAuthn();

  // Decode public key from CBOR
  const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);

  // Encode key data and register
  const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32 x, bytes32 y, string credentialId)"],
    [[x, y, testData.credentialId]],
  );

  const rpIdHash = testData.rpIdHash;
  const origin = ethers.toUtf8Bytes(testData.origin);
  const requireUV = false; // UV verification not required (default)

  const initData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes32", "bytes", "bool"], [keyData, rpIdHash, origin, requireUV]);

  await accountKey.connect(owner).register(0, initData); // KeyPurpose.Master = 0

  return { accountKey, owner, nonOwner, keyId: 0n };
}

describe("AccountKeyWebAuthn", async function () {
  describe("Deployment", async function () {
    // CNT-196: singleton contract deployment success
    it("Should deploy singleton contract successfully", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyWebAuthn);
      expect(await accountKey.getAddress()).to.be.properAddress;
    });
  });

  describe("Registration", async function () {
    // CNT-198: register WebAuthn key via register()
    it("register WebAuthn key", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);
      const keyData = await accountKey.getKeyData(0, owner.address, 0n);

      const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
      expect(keyData.x).to.equal(x);
      expect(keyData.y).to.equal(y);
      expect(keyData.credentialId).to.equal(testData.credentialId);
    });

    // CNT-199: verify origin configuration
    it("register with correct origin", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);
      const keyData = await accountKey.getKeyData(0, owner.address, 0n);
      const expectedOriginHash = ethers.keccak256(ethers.toUtf8Bytes(testData.origin));
      expect(keyData.allowedOriginHash).to.equal(expectedOriginHash);
    });

    // CNT-200: verify rpId configuration
    it("register with correct rpId", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);
      const keyData = await accountKey.getKeyData(0, owner.address, 0n);
      expect(keyData.allowedRpIdHash).to.equal(testData.rpIdHash);
    });

    // CNT-203: emit AccountKeyWebAuthnRegistered event
    it("emit AccountKeyWebAuthnRegistered event", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthn);
      const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[x, y, testData.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
      );

      await expect(accountKey.connect(owner).register(0, initData))
        .to.emit(accountKey, "AccountKeyWebAuthnRegistered")
        .withArgs(owner.address, 0n, [x, y, testData.credentialId]);
    });

    // CNT-162: multiple accounts can each register keys independently
    it("allow different accounts to register keys", async function () {
      const { accountKey, owner, nonOwner } = await loadFixture(deployAccountKeyWebAuthn);

      const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
      const keyData1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[x, y, testData.credentialId]],
      );

      const initData1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData1, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
      );
      await accountKey.connect(owner).register(0, initData1);

      const keyData2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[x, y, "different-credential-id"]],
      );

      const initData2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData2, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
      );
      await accountKey.connect(nonOwner).register(0, initData2);

      const ownerKeyData = await accountKey.getKeyData(0, owner.address, 0n);
      const nonOwnerKeyData = await accountKey.getKeyData(0, nonOwner.address, 0n);

      expect(ownerKeyData.credentialId).to.equal(testData.credentialId);
      expect(nonOwnerKeyData.credentialId).to.equal("different-credential-id");
    });
  });

  describe("keyType", async function () {
    // CNT-205: keyType = 4
    it("return KeyType.keyWebAuthn (4)", async function () {
      const { accountKey } = await loadFixture(deployAccountKeyWebAuthn);
      expect(await accountKey.keyType()).to.equal(4);
    });
  });

  describe("validate", async function () {
    // CNT-207: valid WebAuthn signature verification
    it("validate with correct WebAuthn signature", async function () {
      // Generate a fresh secp256r1 key pair for end-to-end validation
      const webAuthnKeyPair = generateWebAuthnKeyPair();

      const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
      const realAccountKey = await AccountKeyWebAuthnFactory.deploy();
      await realAccountKey.waitForDeployment();

      // Encode key data using generated key pair
      const realKeyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[webAuthnKeyPair.publicKey.x, webAuthnKeyPair.publicKey.y, webAuthnKeyPair.credentialId]],
      );

      const realOrigin = ethers.toUtf8Bytes(webAuthnKeyPair.origin);
      const realRpIdHash = webAuthnKeyPair.rpIdHash;

      // Register key
      const realInitData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [realKeyData, realRpIdHash, realOrigin, false],
      );

      const [owner] = await ethers.getSigners();
      await realAccountKey.connect(owner).register(0, realInitData);

      // Sign a message hash with the generated key pair (raw bytes base64url encoding)
      const msgHash = "0xa91d1e6281b545fc560e9fd97a18e41239c79ea47f13d0dd1e7c77c39f45bf0a";
      const sig = signUserOpWebAuthn(msgHash, webAuthnKeyPair);

      // This should succeed with programmatically signed data!
      const isValid = await realAccountKey.connect(owner).validate(0, 0n, sig, msgHash);
      expect(isValid).to.be.true;
    });

    // CNT-208: revert with invalid challenge
    it("revert with invalid challenge", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      // Create a clientJSON with a different challenge than what we pass to validate
      const actualChallenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const differentChallenge = "0x" + "11".repeat(32);

      // Encode the actualChallenge as hex string in base64url (as WebAuthn does)
      const challengeBase64url = Buffer.from(actualChallenge.replace(/^0x/, ""), "hex").toString("base64url");

      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const signature = Buffer.from(
        "MEQCIG_CiY0opI1Xht3jh9z8oSVHyNzGrJh6o3_NIWVSW8EoAiAYCJOfGQzcPvc6-2WoIV99dVi5Tm5f-SMwDRgGy3A4HA",
        "base64url",
      );

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, signature);

      // Pass a different challenge - should revert with InvalidChallenge
      await expect(accountKey.connect(owner).validate(0, keyId, sig, differentChallenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidChallenge",
      );
    });

    // CNT-209: revert with invalid origin
    it("revert with invalid origin", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const wrongOrigin = "http://evil.com";
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: wrongOrigin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const signature = Buffer.from(
        "MEQCIG_CiY0opI1Xht3jh9z8oSVHyNzGrJh6o3_NIWVSW8EoAiAYCJOfGQzcPvc6-2WoIV99dVi5Tm5f-SMwDRgGy3A4HA",
        "base64url",
      );

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, signature);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidOrigin",
      );
    });

    // CNT-210: revert with invalid rpId
    it("revert with invalid rpId", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);

      // Use wrong authenticatorData with different rpIdHash (first 32 bytes are rpIdHash)
      const wrongRpIdHash = "0x" + "00".repeat(32);
      const wrongAuthData = Buffer.from(wrongRpIdHash.slice(2) + "1d00000000", "hex");
      const signature = Buffer.from(
        "MEQCIG_CiY0opI1Xht3jh9z8oSVHyNzGrJh6o3_NIWVSW8EoAiAYCJOfGQzcPvc6-2WoIV99dVi5Tm5f-SMwDRgGy3A4HA",
        "base64url",
      );

      const sig = buildWebAuthnSig(clientDataStr, wrongAuthData, signature);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidRpId",
      );
    });

    // CNT-211: return false when called by non-registrant
    it("return false when called by non-registrant account", async function () {
      const { accountKey, nonOwner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const signature = Buffer.from(
        "MEQCIG_CiY0opI1Xht3jh9z8oSVHyNzGrJh6o3_NIWVSW8EoAiAYCJOfGQzcPvc6-2WoIV99dVi5Tm5f-SMwDRgGy3A4HA",
        "base64url",
      );

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, signature);

      // nonOwner didn't register this key, so validate returns false
      expect(await accountKey.connect(nonOwner).validate(0, keyId, sig, challenge)).to.equal(false);
    });

    // LOWS-WebAuthn: revert with high-S signature causing InvalidSValue
    it("revert with high-S WebAuthn signature (InvalidSValue)", async function () {
      // Loop until finding a key pair without a leading zero in r (DER rLength must be 32 or 33)
      const msgHash = "0xa91d1e6281b545fc560e9fd97a18e41239c79ea47f13d0dd1e7c77c39f45bf0a";

      // Generate WebAuthn signature with a fixed key pair (guaranteeing no leading zero in r)
      let webAuthnKeyPair = generateWebAuthnKeyPair();
      let sig: string | null = null;
      for (let i = 0; i < 100; i++) {
        webAuthnKeyPair = generateWebAuthnKeyPair();
        const candidateSig = signUserOpWebAuthn(msgHash, webAuthnKeyPair, { useHighS: true });
        // ABI decode 7-param format to check DER signature rLength
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
          candidateSig,
        );
        // decoded[2] is a hex string ("0x...") - convert to Buffer
        const derHex = decoded[2] as string;
        const derBytes = Buffer.from(derHex.slice(2), "hex");
        // DER[3] = rLength, must be 32 or 33
        if (derBytes.length >= 4 && derBytes[3] >= 32 && derBytes[3] <= 33 && derBytes.length <= 72) {
          sig = candidateSig;
          break;
        }
      }
      if (sig === null) {
        throw new Error("Failed to generate valid high-S DER signature after 100 attempts");
      }

      const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
      const accountKey = await AccountKeyWebAuthnFactory.deploy();
      await accountKey.waitForDeployment();

      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[webAuthnKeyPair.publicKey.x, webAuthnKeyPair.publicKey.y, webAuthnKeyPair.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, webAuthnKeyPair.rpIdHash, ethers.toUtf8Bytes(webAuthnKeyPair.origin), false],
      );

      const [owner] = await ethers.getSigners();
      await accountKey.connect(owner).register(0, initData);

      await expect(accountKey.connect(owner).validate(0, 0n, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidSValue",
      );
    });
  });

  describe("View functions", async function () {
    // CNT-222: return complete key data via getKeyData
    it("return complete key data via getKeyData", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);
      const keyData = await accountKey.getKeyData(0, owner.address, 0n);

      const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
      expect(keyData.x).to.equal(x);
      expect(keyData.y).to.equal(y);
      expect(keyData.credentialId).to.equal(testData.credentialId);
      expect(keyData.allowedOriginHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(testData.origin)));
      expect(keyData.allowedRpIdHash).to.equal(testData.rpIdHash);
    });
  });

  describe("Transaction Key Tests (purpose=1)", async function () {
    // Test register with KeyPurpose.Tx
    it("register with KeyPurpose.Tx (purpose=1)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthn);
      const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[x, y, testData.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
      );

      await accountKey.connect(owner).register(1, initData); // KeyPurpose.Tx = 1

      const registeredKeyData = await accountKey.getKeyData(1, owner.address, 0n);
      expect(registeredKeyData.x).to.equal(x);
      expect(registeredKeyData.y).to.equal(y);
      expect(registeredKeyData.credentialId).to.equal(testData.credentialId);
    });

    // Test validate with KeyPurpose.Tx
    it("validate with KeyPurpose.Tx (purpose=1)", async function () {
      const webAuthnKeyPair = generateWebAuthnKeyPair();

      const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
      const accountKey = await AccountKeyWebAuthnFactory.deploy();
      await accountKey.waitForDeployment();

      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[webAuthnKeyPair.publicKey.x, webAuthnKeyPair.publicKey.y, webAuthnKeyPair.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, webAuthnKeyPair.rpIdHash, ethers.toUtf8Bytes(webAuthnKeyPair.origin), false],
      );

      const [owner] = await ethers.getSigners();
      await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)

      const msgHash = "0xa91d1e6281b545fc560e9fd97a18e41239c79ea47f13d0dd1e7c77c39f45bf0a";
      const sig = signUserOpWebAuthn(msgHash, webAuthnKeyPair);

      const isValid = await accountKey.connect(owner).validate(1, 0n, sig, msgHash);
      expect(isValid).to.be.true;
    });

    // Test resetKeys with KeyPurpose.Tx
    it("resetKeys with KeyPurpose.Tx (purpose=1)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthn);
      const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[x, y, testData.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
      );

      await accountKey.connect(owner).register(1, initData); // purpose=1 (Tx)

      // Verify key exists
      const keyDataBefore = await accountKey.getKeyData(1, owner.address, 0n);
      expect(keyDataBefore.credentialId).to.equal(testData.credentialId);

      // Reset keys (msg.sender = owner)
      await accountKey.connect(owner).resetKeys(1);

      // Verify key is cleared (empty data)
      const keyDataAfter = await accountKey.getKeyData(1, owner.address, 0n);
      expect(keyDataAfter.x).to.equal(ethers.ZeroHash);
      expect(keyDataAfter.y).to.equal(ethers.ZeroHash);
      expect(keyDataAfter.credentialId).to.equal("");
    });
  });

  describe("MAX_KEYS_PER_ACCOUNT limit", async function () {
    it("revert when registering more than MAX_KEYS_PER_ACCOUNT (5 keys)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthn);

      // Register 5 keys (should succeed)
      for (let i = 0; i < 5; i++) {
        const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
        const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(bytes32 x, bytes32 y, string credentialId)"],
          [[x, y, `credential-${i}`]],
        );

        const initData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes", "bytes32", "bytes", "bool"],
          [keyData, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
        );
        await accountKey.connect(owner).register(0, initData);
      }

      // Try to register 6th key (should revert)
      const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[x, y, "credential-6"]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
      );
      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "MaxKeysExceeded",
      );
    });
  });

  describe("resetKeys validation", async function () {
    it("validate returns false after resetKeys", async function () {
      const webAuthnKeyPair = generateWebAuthnKeyPair();

      const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
      const accountKey = await AccountKeyWebAuthnFactory.deploy();
      await accountKey.waitForDeployment();

      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[webAuthnKeyPair.publicKey.x, webAuthnKeyPair.publicKey.y, webAuthnKeyPair.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, webAuthnKeyPair.rpIdHash, ethers.toUtf8Bytes(webAuthnKeyPair.origin), false],
      );

      const [owner] = await ethers.getSigners();
      await accountKey.connect(owner).register(0, initData);

      const msgHash = "0xa91d1e6281b545fc560e9fd97a18e41239c79ea47f13d0dd1e7c77c39f45bf0a";
      const sig = signUserOpWebAuthn(msgHash, webAuthnKeyPair);

      // Verify signature works before reset
      expect(await accountKey.connect(owner).validate(0, 0n, sig, msgHash)).to.be.true;

      // Reset keys (msg.sender = owner)
      await accountKey.connect(owner).resetKeys(0);

      // Verify signature fails after reset (key data is empty)
      expect(await accountKey.connect(owner).validate(0, 0n, sig, msgHash)).to.be.false;
    });

    it("getKeyData returns empty data for out-of-bounds keyId", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      // keyId=999 is out of bounds
      const keyData = await accountKey.getKeyData(0, owner.address, 999n);
      expect(keyData.x).to.equal(ethers.ZeroHash);
      expect(keyData.y).to.equal(ethers.ZeroHash);
      expect(keyData.credentialId).to.equal("");
    });
  });

  describe("WebAuthn-specific edge cases", async function () {
    // Test DER signature with r/s exactly 32 bytes (not 33)
    it("validate DER signature with r and s exactly 32 bytes", async function () {
      const webAuthnKeyPair = generateWebAuthnKeyPair();

      const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn");
      const accountKey = await AccountKeyWebAuthnFactory.deploy();
      await accountKey.waitForDeployment();

      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[webAuthnKeyPair.publicKey.x, webAuthnKeyPair.publicKey.y, webAuthnKeyPair.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, webAuthnKeyPair.rpIdHash, ethers.toUtf8Bytes(webAuthnKeyPair.origin), false],
      );

      const [owner] = await ethers.getSigners();
      await accountKey.connect(owner).register(0, initData);

      const msgHash = "0xa91d1e6281b545fc560e9fd97a18e41239c79ea47f13d0dd1e7c77c39f45bf0a";
      const sig = signUserOpWebAuthn(msgHash, webAuthnKeyPair);

      // This will test the DER parsing logic including the case where r/s are exactly 32 bytes
      const isValid = await accountKey.connect(owner).validate(0, 0n, sig, msgHash);
      expect(isValid).to.be.true;
    });

    // Test authData with UP flag = 0
    it("revert when authData has UP flag = 0 (user not present)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);

      // Create authenticatorData with UP flag = 0 (flags byte = 0x1c instead of 0x1d)
      const authenticatorDataNoUP = Buffer.from(testData.rpIdHash.slice(2) + "1c00000000", "hex");

      const signature = Buffer.from(
        "MEQCIG_CiY0opI1Xht3jh9z8oSVHyNzGrJh6o3_NIWVSW8EoAiAYCJOfGQzcPvc6-2WoIV99dVi5Tm5f-SMwDRgGy3A4HA",
        "base64url",
      );

      const sig = buildWebAuthnSig(clientDataStr, authenticatorDataNoUP, signature);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "UserPresenceRequired",
      );
    });
  });

  describe("Branch coverage tests", async function () {
    // Branch coverage: register with x=0, y valid
    it("revert when registering with x=0 (y valid)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthn);

      const invalidKey = {
        x: ethers.ZeroHash,
        y: ethers.hexlify(ethers.randomBytes(32)),
      };

      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[invalidKey.x, invalidKey.y, testData.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
      );

      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidKeyData",
      );
    });

    // Branch coverage: register with x valid, y=0
    it("revert when registering with y=0 (x valid)", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthn);

      const invalidKey = {
        x: ethers.hexlify(ethers.randomBytes(32)),
        y: ethers.ZeroHash,
      };

      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[invalidKey.x, invalidKey.y, testData.credentialId]],
      );

      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), false],
      );

      await expect(accountKey.connect(owner).register(0, initData)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidKeyData",
      );
    });

    // Branch coverage: clientJSON type != "webauthn.get"
    it("revert when clientJSON type is not webauthn.get", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.create", // Wrong type
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const signature = Buffer.from(
        "MEQCIG_CiY0opI1Xht3jh9z8oSVHyNzGrJh6o3_NIWVSW8EoAiAYCJOfGQzcPvc6-2WoIV99dVi5Tm5f-SMwDRgGy3A4HA",
        "base64url",
      );

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, signature);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidWebAuthnType",
      );
    });

    // Branch coverage: requireUV=true with UV flag=0
    it("revert when requireUV=true but UV flag is not set", async function () {
      const { accountKey, owner } = await loadFixture(deployAccountKeyWebAuthn);

      const { x, y } = decodePublicKeyFromCBOR(testData.credentialPubkey);
      const keyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(bytes32 x, bytes32 y, string credentialId)"],
        [[x, y, testData.credentialId]],
      );

      // Register with requireUV=true
      const initData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes32", "bytes", "bool"],
        [keyData, testData.rpIdHash, ethers.toUtf8Bytes(testData.origin), true], // requireUV=true
      );

      await accountKey.connect(owner).register(0, initData);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);

      // Create authenticatorData with UV flag = 0 (flags byte = 0x01 - only UP set)
      const authenticatorDataNoUV = Buffer.from(testData.rpIdHash.slice(2) + "0100000000", "hex");

      const signature = Buffer.from(
        "MEQCIG_CiY0opI1Xht3jh9z8oSVHyNzGrJh6o3_NIWVSW8EoAiAYCJOfGQzcPvc6-2WoIV99dVi5Tm5f-SMwDRgGy3A4HA",
        "base64url",
      );

      const sig = buildWebAuthnSig(clientDataStr, authenticatorDataNoUV, signature);

      await expect(accountKey.connect(owner).validate(0, 0n, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "UserVerificationRequired",
      );
    });
  });

  describe("Edge cases", async function () {
    // CNT-212: revert with malformed signature
    it("revert with malformed signature", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const malformedSig = Buffer.from("1234", "hex");

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, malformedSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.reverted;
    });

    // CNT-213: revert with signature that is too short
    it("revert with signature too short", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // Only 7 bytes - less than minimum 8
      const shortSig = Buffer.from("30050201010201", "hex");

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, shortSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "SignatureTooShort",
      );
    });

    // CNT-214: revert with signature that is too long
    it("revert with signature too long", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // 73 bytes - more than maximum 72
      const longSig = Buffer.alloc(73, 0x30);

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, longSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "SignatureTooLong",
      );
    });

    // CNT-215: revert with invalid r length
    it("revert with invalid r length", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // DER signature with r length = 31 (invalid, must be 32-33)
      const invalidRLengthSig = Buffer.from("3044021f" + "00".repeat(31) + "0220" + "00".repeat(32), "hex");

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, invalidRLengthSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidRLength",
      );
    });

    // CNT-216: revert with invalid s length
    it("revert with invalid s length", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // DER signature with valid r (32 bytes) but invalid s length = 31
      const invalidSLengthSig = Buffer.from("30440220" + "00".repeat(32) + "021f" + "00".repeat(31), "hex");

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, invalidSLengthSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidSLength",
      );
    });

    // CNT-217: revert when r length > 33
    it("revert with r length > 33", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // DER signature with r length = 34 (invalid, must be 32-33)
      const invalidRLengthSig = Buffer.from("30460222" + "00".repeat(34) + "0220" + "00".repeat(32), "hex");

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, invalidRLengthSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidRLength",
      );
    });

    // CNT-218: revert when s length > 33
    it("revert with s length > 33", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // DER signature with valid r (32 bytes) but s length = 34 (invalid)
      const invalidSLengthSig = Buffer.from("30460220" + "00".repeat(32) + "0222" + "00".repeat(34), "hex");

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, invalidSLengthSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidSLength",
      );
    });

    // CNT-219: revert with signature truncated at s length
    it("revert with signature truncated at s length", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const truncatedSig = Buffer.from("30230220" + "00".repeat(32) + "02", "hex");

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, truncatedSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "SignatureTruncatedAtSLength",
      );
    });

    // CNT-220: revert with signature truncated at s value
    it("revert with signature truncated at s value", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const truncatedSig = Buffer.from("30430220" + "00".repeat(32) + "0220" + "00".repeat(31), "hex");

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, truncatedSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "SignatureTruncatedAtSValue",
      );
    });

    // CNT-639: DER signature format boundary test (8 and 72 bytes)
    it("CNT-639: DER signature boundary test (8 and 72 bytes)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");

      // Test minimum boundary: 8 bytes
      const minBoundarySig = Buffer.from("3006020100020100", "hex");
      const sigMin = buildWebAuthnSig(clientDataStr, authenticatorData, minBoundarySig);

      try {
        await accountKey.connect(owner).validate(0, keyId, sigMin, challenge);
      } catch (e: any) {
        expect(e.message).to.not.include("SignatureTooShort");
      }

      // Test maximum boundary: 72 bytes
      const maxBoundarySig = Buffer.alloc(72, 0x30);
      maxBoundarySig[0] = 0x30;
      maxBoundarySig[1] = 0x46;
      maxBoundarySig[2] = 0x02;
      maxBoundarySig[3] = 0x21;
      maxBoundarySig[37] = 0x02;
      maxBoundarySig[38] = 0x21;

      const sigMax = buildWebAuthnSig(clientDataStr, authenticatorData, maxBoundarySig);

      try {
        await accountKey.connect(owner).validate(0, keyId, sigMax, challenge);
      } catch (e: any) {
        expect(e.message).to.not.include("SignatureTooLong");
      }

      // Test out of boundary: 7 bytes
      const tooShortSig = Buffer.from("30050201000201", "hex");
      const sigTooShort = buildWebAuthnSig(clientDataStr, authenticatorData, tooShortSig);
      await expect(accountKey.connect(owner).validate(0, keyId, sigTooShort, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "SignatureTooShort",
      );

      // Test out of boundary: 73 bytes
      const tooLongSig = Buffer.alloc(73, 0x30);
      const sigTooLong = buildWebAuthnSig(clientDataStr, authenticatorData, tooLongSig);
      await expect(accountKey.connect(owner).validate(0, keyId, sigTooLong, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "SignatureTooLong",
      );
    });

    // CNT-501: clientDataJSON challenge mismatch
    it("CNT-501: revert when clientDataJSON challenge does not match msgHash", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const actualMsgHash = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const differentMsgHash = "0x1111111111111111111111111111111111111111111111111111111111111111";

      const challengeBase64url = Buffer.from(actualMsgHash.replace(/^0x/, ""), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      const authenticatorData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const signature = Buffer.from(
        "MEQCIG_CiY0opI1Xht3jh9z8oSVHyNzGrJh6o3_NIWVSW8EoAiAYCJOfGQzcPvc6-2WoIV99dVi5Tm5f-SMwDRgGy3A4HA",
        "base64url",
      );

      const sig = buildWebAuthnSig(clientDataStr, authenticatorData, signature);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, differentMsgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidChallenge",
      );
    });
  });

  describe("Branch coverage - validate bounds checks", async function () {
    // BC-W01: authData less than 37 bytes → AuthDataTooShort
    it("revert with authData shorter than 37 bytes (AuthDataTooShort)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(challenge.slice(2), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);

      // authData with only 36 bytes (< 37 minimum)
      const shortAuthData = Buffer.alloc(36, 0x00);
      Buffer.from(testData.rpIdHash.slice(2), "hex").copy(shortAuthData, 0); // rpIdHash 32 bytes
      shortAuthData[32] = 0x1d; // UP+UV flags

      const dummySig = Buffer.from("30440220" + "11".repeat(32) + "0220" + "22".repeat(32), "hex");
      const sig = buildWebAuthnSig(clientDataStr, shortAuthData, dummySig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "AuthDataTooShort",
      );
    });

    // BC-W02: typeIndex < 8 → InvalidWebAuthnType (bounds check)
    it("revert when typeIndex < 8 (typeKey bounds check, InvalidWebAuthnType)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const authData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const clientJsonBuf = Buffer.from('{"type":"webauthn.get"}', "utf8");
      const dummySig = Buffer.from("30440220" + "11".repeat(32) + "0220" + "22".repeat(32), "hex");
      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";

      // typeIndex = 5 < 8 (length of '"type":"')
      const sig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
        [authData, clientJsonBuf, dummySig, 5n, 0n, 0n, 0n],
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidWebAuthnType",
      );
    });

    // BC-W03: typeKey prefix mismatch (_bytesEqualAt length overflow path)
    it("revert when clientJSON is too short for typeKey prefix (_bytesEqualAt overflow, InvalidWebAuthnType)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const authData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // clientJson only 7 bytes (< typeKey.length=8) → _bytesEqualAt startIdx+len > data.length → return false
      const shortClientJson = Buffer.from("short!!", "utf8"); // exactly 7 bytes
      const dummySig = Buffer.from("30440220" + "11".repeat(32) + "0220" + "22".repeat(32), "hex");
      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";

      // typeIndex = 8 >= 8 (bounds check passes), but _bytesEqualAt(clientJson, 0, '"type":"') overflows
      const sig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
        [authData, shortClientJson, dummySig, 8n, 0n, 0n, 0n],
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidWebAuthnType",
      );
    });

    // BC-W04: challengeIndex < 13 → InvalidChallenge (bounds check)
    it("revert when challengeIndex < 13 (challengeKey bounds check, InvalidChallenge)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const authData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // clientJson with correct type format: '"type":"webauthn.get"...'
      // typeIndex=8: clientJson[0:8]='  "type":"', clientJson[8:20]="webauthn.get" ✓
      const clientJsonBuf = Buffer.from('"type":"webauthn.get","other":"data"', "utf8");
      const dummySig = Buffer.from("30440220" + "11".repeat(32) + "0220" + "22".repeat(32), "hex");
      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";

      // typeIndex=8 (type check passes), challengeIndex=5 < 13 → InvalidChallenge
      const sig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
        [authData, clientJsonBuf, dummySig, 8n, 5n, 0n, 0n],
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidChallenge",
      );
    });

    // BC-W05: challengeKey prefix mismatch → InvalidChallenge
    it("revert when clientJSON does not have challenge prefix before challengeIndex (InvalidChallenge)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const authData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      // type check passes: clientJson[0:8]='"type":"', clientJson[8:20]="webauthn.get"
      // challengeIndex=35: clientJson[22:35] should be '"challenge":"' but is 'XXXXXXXXXXXXX'
      // '"type":"webauthn.get"' = 21 chars, then 'XXXXXXXXXXXXX' (13 X's) at [21:34], then challenge at [35]
      const clientJsonBuf = Buffer.from('"type":"webauthn.get"' + "X".repeat(13) + "challengevalue", "utf8");
      const dummySig = Buffer.from("30440220" + "11".repeat(32) + "0220" + "22".repeat(32), "hex");
      const challenge = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";

      // typeIndex=8 (type check passes), challengeIndex=35 >= 13 (bounds OK),
      // but clientJson[22:35]="XXXXXXXXXXXXX" ≠ '"challenge":"' → InvalidChallenge
      const sig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
        [authData, clientJsonBuf, dummySig, 8n, 35n, 0n, 0n],
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, challenge)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidChallenge",
      );
    });

    // BC-W06: originIndex < 10 → InvalidOrigin (bounds check)
    it("revert when originIndex < 10 (originKey bounds check, InvalidOrigin)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const authData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const dummySig = Buffer.from("30440220" + "11".repeat(32) + "0220" + "22".repeat(32), "hex");
      const msgHash = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      // challengeBase64url of msgHash (43 chars)
      const challengeBase64url = Buffer.from(msgHash.slice(2), "hex").toString("base64url");

      // clientJson with correct type + correct challenge
      // '"type":"' (8) + 'webauthn.get' (12) + '",' (2) + '"challenge":"' (13) = 35 → challengeIndex=35
      const minClientJson = `"type":"webauthn.get","challenge":"${challengeBase64url}"`;
      const clientJsonBuf = Buffer.from(minClientJson, "utf8");

      // typeIndex=8, challengeIndex=35 (both checks pass), originIndex=5 < 10 → InvalidOrigin
      const sig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
        [authData, clientJsonBuf, dummySig, 8n, 35n, 5n, 20n],
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidOrigin",
      );
    });

    // BC-W07: originIndex + originLength > clientJson.length → InvalidOrigin (overflow check)
    it("revert when originIndex + originLength exceeds clientJSON length (InvalidOrigin)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const authData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const dummySig = Buffer.from("30440220" + "11".repeat(32) + "0220" + "22".repeat(32), "hex");
      const msgHash = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(msgHash.slice(2), "hex").toString("base64url");

      // Full clientJson with type + challenge + origin
      // type(8)+webauthn.get(12)+",(2)+challenge(13+43)+","(2)+origin(10)+http://localhost:8000(22)
      // positions: type[0:8], webauthn.get[8:20], ","challenge":"[20:35], challenge_val[35:78], ","origin":"[78:90], origin_val[90:112]
      const fullClientJson = `"type":"webauthn.get","challenge":"${challengeBase64url}","origin":"${testData.origin}"`;
      const clientJsonBuf = Buffer.from(fullClientJson, "utf8");

      // typeIndex=8, challengeIndex=35, originIndex=90 (>= 10 OK)
      // originLength=10000: 90+10000 >> clientJson.length (~113) → InvalidOrigin
      const sig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
        [authData, clientJsonBuf, dummySig, 8n, 35n, 90n, 10000n],
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidOrigin",
      );
    });

    // BC-W08: s = SECP256R1_N in DER signature → InvalidSValue (s >= N, first check)
    it("revert with DER signature where s equals SECP256R1_N (first InvalidSValue check: s >= N)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const msgHash = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(msgHash.slice(2), "hex").toString("base64url");
      const clientData = {
        type: "webauthn.get",
        challenge: challengeBase64url,
        origin: testData.origin,
        crossOrigin: false,
      };
      const clientDataStr = JSON.stringify(clientData);
      // authData: rpIdHash(32) + flags(1) + signCount(4) = 37 bytes
      const authData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");

      // Craft DER signature with s = SECP256R1_N
      // N = FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
      // N starts with 0xFF (high bit) → DER requires leading 0x00 → sLength=33
      // DER: 30 45 02 20 [r=32bytes] 02 21 00 [N=32bytes] = 71 bytes total
      const SECP256R1_N_HEX = "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551";
      const r_HEX = "11".repeat(32);
      const derSigHex = "3045" + "0220" + r_HEX + "0221" + "00" + SECP256R1_N_HEX;
      const derSig = Buffer.from(derSigHex, "hex"); // 71 bytes

      const sig = buildWebAuthnSig(clientDataStr, authData, derSig);

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidSValue",
      );
    });

    // BC-W09: origin prefix mismatch → InvalidOrigin (line 238, branch 30[0])
    it("revert when origin prefix is wrong before originIndex (InvalidOrigin)", async function () {
      const { accountKey, owner, keyId } = await loadFixture(deployAccountKeyWebAuthnWithRegisteredKey);

      const authData = Buffer.from(testData.rpIdHash.slice(2) + "1d00000000", "hex");
      const msgHash = "0xbd578981c49537999af3b3093948964ab9974c1e7bce8b227534674087c47f70";
      const challengeBase64url = Buffer.from(msgHash.slice(2), "hex").toString("base64url");

      // Build clientJson where:
      // [0:8]='"type":"', [8:20]='webauthn.get' → type check passes ✓
      // [22:35]='"challenge":"', [35:78]=challengeBase64url → challenge check passes ✓
      // originIndex=90 >= 10 → bounds check passes ✓
      // 90+19=109 <= clientJson.length=109 → overflow check passes ✓
      // [80:90]='"WRONGPREF' ≠ '"origin":"' → prefix check FAILS → InvalidOrigin ✗
      const originValue = "https://example.com"; // 19 chars
      const clientJsonStr =
        '"type":"webauthn.get","challenge":"' + challengeBase64url + '","WRONGPREF' + originValue;
      const clientJsonBuf = Buffer.from(clientJsonStr, "utf8");
      const dummySig = Buffer.from("30440220" + "11".repeat(32) + "0220" + "22".repeat(32), "hex");

      // typeIndex=8, challengeIndex=35, originIndex=90, originLength=19
      const sig = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
        [authData, clientJsonBuf, dummySig, 8n, 35n, 90n, BigInt(originValue.length)],
      );

      await expect(accountKey.connect(owner).validate(0, keyId, sig, msgHash)).to.be.revertedWithCustomError(
        accountKey,
        "InvalidOrigin",
      );
    });
  });
});
