import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { ZkapAccount, IEntryPoint } from "../../typechain-types";
import * as secp256r1 from "secp256r1";
import * as crypto from "crypto";

export interface PackedUserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: bigint;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}

/**
 * Create a basic UserOperation for testing
 */
export async function createUserOp(
  account: ZkapAccount,
  callData: string,
  nonce?: bigint,
): Promise<PackedUserOperation> {
  const accountAddress = await account.getAddress();
  const currentNonce = nonce ?? (await account.getNonce());

  // Pack gas limits: verificationGasLimit (16 bytes) + callGasLimit (16 bytes)
  const verificationGasLimit = 2000000n;
  const callGasLimit = 1000000n;
  const accountGasLimits = ethers.concat([ethers.toBeHex(verificationGasLimit, 16), ethers.toBeHex(callGasLimit, 16)]);

  // Pack gas fees: maxPriorityFeePerGas (16 bytes) + maxFeePerGas (16 bytes)
  const maxPriorityFeePerGas = 1000000000n; // 1 gwei
  const maxFeePerGas = 2000000000n; // 2 gwei
  const gasFees = ethers.concat([ethers.toBeHex(maxPriorityFeePerGas, 16), ethers.toBeHex(maxFeePerGas, 16)]);

  return {
    sender: accountAddress,
    nonce: currentNonce,
    initCode: "0x",
    callData: callData,
    accountGasLimits: accountGasLimits,
    preVerificationGas: 100000n,
    gasFees: gasFees,
    paymasterAndData: "0x",
    signature: "0x", // Will be filled later
  };
}

/**
 * Get UserOp hash (what needs to be signed)
 * Uses EntryPoint.getUserOpHash() directly for version-agnostic hash calculation
 */
export async function getUserOpHash(
  entryPoint: IEntryPoint,
  userOp: PackedUserOperation,
  chainId: bigint,
): Promise<string> {
  return await entryPoint.getUserOpHash(userOp);
}

/**
 * Sign UserOp with a wallet
 * ZKAPSC-007: userOpHash is already in EIP-712 format, so toEthSignedMessageHash is not needed
 * Use raw signature (instead of signMessage)
 */
export async function signUserOp(userOpHash: string, wallet: Wallet): Promise<string> {
  // Sign raw hash directly (no Ethereum prefix)
  const signature = wallet.signingKey.sign(userOpHash).serialized;
  return signature;
}

/**
 * Create signature for ZkapAccount (keyIndexList, keySignatureList)
 */
export function encodeZkapSignature(keyIndices: number[], signatures: string[]): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(["uint8[]", "bytes[]"], [keyIndices, signatures]);
}

/**
 * Helper: Create and sign a UserOp with single key
 */
export async function createSignedUserOp(
  account: ZkapAccount,
  entryPoint: IEntryPoint,
  callData: string,
  wallet: Wallet,
  keyIndex: number = 0,
): Promise<PackedUserOperation> {
  const userOp = await createUserOp(account, callData);
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const userOpHash = await getUserOpHash(entryPoint, userOp, chainId);

  // Sign with wallet
  const signature = await signUserOp(userOpHash, wallet);

  // Encode for ZkapAccount
  userOp.signature = encodeZkapSignature([keyIndex], [signature]);

  return userOp;
}

/**
 * Secp256r1 key pair interface
 */
export interface Secp256r1KeyPair {
  privateKey: Uint8Array;
  publicKey: { x: string; y: string };
}

/**
 * Generate a Secp256r1 (P-256) key pair
 */
export function generateSecp256r1KeyPair(): Secp256r1KeyPair {
  // Generate private key
  const privateKey = new Uint8Array(crypto.randomBytes(32));

  // Get public key from private key (uncompressed format: 0x04 + x + y)
  const privKeyBuf = Buffer.from(privateKey.buffer, privateKey.byteOffset, privateKey.byteLength);
  const pubKey = secp256r1.publicKeyCreate(privKeyBuf, false);

  // Extract x and y coordinates (pubKey is already a Buffer)
  const xBytes = pubKey.subarray(1, 33);
  const yBytes = pubKey.subarray(33, 65);

  return {
    privateKey,
    publicKey: {
      x: "0x" + xBytes.toString("hex"),
      y: "0x" + yBytes.toString("hex"),
    },
  };
}

/**
 * Generate a Secp256r1 signature
 * ZKAPSC-007: userOpHash is already in EIP-712 format, so toEthSignedMessageHash is not needed
 * Sign raw userOpHash directly
 */
export function signUserOpSecp256r1(userOpHash: string, privateKey: Uint8Array): string {
  // Sign raw userOpHash directly (no Ethereum prefix)
  const msgHashBytes = Buffer.from(userOpHash.slice(2), "hex");

  // Sign with secp256r1
  const privKeyBuf = Buffer.from(privateKey.buffer, privateKey.byteOffset, privateKey.byteLength);
  const signResult = secp256r1.sign(msgHashBytes, privKeyBuf);

  // Encode as (r, s) - 64 bytes total
  const sig = signResult.signature;
  const r = "0x" + sig.subarray(0, 32).toString("hex");
  const s = "0x" + sig.subarray(32, 64).toString("hex");

  // Return ABI encoded signature for AccountKeySecp256r1
  return ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [r, s]);
}

/**
 * WebAuthn key pair interface
 */
export interface WebAuthnKeyPair {
  privateKey: Uint8Array;
  publicKey: { x: string; y: string };
  credentialId: string;
  rpIdHash: string;
  origin: string;
}

/**
 * Generate a WebAuthn key pair for testing (secp256r1/P-256)
 */
export function generateWebAuthnKeyPair(): WebAuthnKeyPair {
  const keyPair = generateSecp256r1KeyPair();
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    credentialId: "test-credential-id-" + Date.now(),
    rpIdHash: "0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763", // sha256("localhost")
    origin: "http://localhost:5173",
  };
}

/**
 * Generate a DER-encoded ECDSA signature (for WebAuthn)
 */
function toDERSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
  // Remove leading zeros but keep at least one byte
  const trimLeadingZeros = (buf: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) i++;
    return buf.slice(i);
  };

  let rTrimmed = trimLeadingZeros(r);
  let sTrimmed = trimLeadingZeros(s);

  // Add leading zero if high bit is set (to avoid being interpreted as negative)
  if (rTrimmed[0] & 0x80) {
    const newR = new Uint8Array(rTrimmed.length + 1);
    newR[0] = 0x00;
    newR.set(rTrimmed, 1);
    rTrimmed = newR;
  }
  if (sTrimmed[0] & 0x80) {
    const newS = new Uint8Array(sTrimmed.length + 1);
    newS[0] = 0x00;
    newS.set(sTrimmed, 1);
    sTrimmed = newS;
  }

  // DER encoding: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  const rLen = rTrimmed.length;
  const sLen = sTrimmed.length;
  const totalLen = 2 + rLen + 2 + sLen;

  const result = new Uint8Array(2 + totalLen);
  let offset = 0;
  result[offset++] = 0x30;
  result[offset++] = totalLen;
  result[offset++] = 0x02;
  result[offset++] = rLen;
  result.set(rTrimmed, offset);
  offset += rLen;
  result[offset++] = 0x02;
  result[offset++] = sLen;
  result.set(sTrimmed, offset);

  return result;
}

/**
 * WebAuthn signature generation options
 */
export interface WebAuthnSignOptions {
  /** Override origin for testing InvalidOrigin */
  overrideOrigin?: string;
  /** Override rpIdHash for testing InvalidRpId */
  overrideRpIdHash?: string;
  /** Use high S-value for testing malleable signature protection */
  useHighS?: boolean;
}

// secp256r1 curve order N (for high S-value calculation)
const SECP256R1_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

/**
 * Generate a WebAuthn signature
 * ZKAPSC-007: userOpHash is already in EIP-712 format, so toEthSignedMessageHash is not needed
 * Use raw userOpHash as the challenge
 */
export function signUserOpWebAuthn(
  userOpHash: string,
  keyPair: WebAuthnKeyPair,
  options?: WebAuthnSignOptions,
): string {
  // Challenge is the raw bytes of userOpHash, base64url encoded (no hex string conversion needed)
  const challengeBase64url = Buffer.from(userOpHash.replace(/^0x/, ""), "hex").toString("base64url");

  // Use override values if provided (for testing InvalidOrigin/InvalidRpId)
  const effectiveOrigin = options?.overrideOrigin ?? keyPair.origin;
  const effectiveRpIdHash = options?.overrideRpIdHash ?? keyPair.rpIdHash;

  // Create clientDataJSON
  const clientData = {
    type: "webauthn.get",
    challenge: challengeBase64url,
    origin: effectiveOrigin,
    crossOrigin: false,
  };
  const clientJSON = new Uint8Array(Buffer.from(JSON.stringify(clientData), "utf8"));

  // Create authenticatorData: rpIdHash (32 bytes) + flags (1 byte, 0x1d = UP+UV) + signCount (4 bytes, 0)
  const rpIdHashBytes = new Uint8Array(Buffer.from(effectiveRpIdHash.slice(2), "hex"));
  const authenticatorData = new Uint8Array([
    ...rpIdHashBytes,
    0x1d, // flags: UP (0x01) + UV (0x04) + AT (0x40) = 0x1d
    0x00,
    0x00,
    0x00,
    0x00, // signCount
  ]);

  // Create message to sign: sha256(authenticatorData || sha256(clientDataJSON))
  const clientDataHash = new Uint8Array(crypto.createHash("sha256").update(clientJSON).digest());
  const signedData = new Uint8Array([...authenticatorData, ...clientDataHash]);
  const messageToSign = crypto.createHash("sha256").update(signedData).digest();

  // Sign with secp256r1
  const privKeyBuf = Buffer.from(
    keyPair.privateKey.buffer,
    keyPair.privateKey.byteOffset,
    keyPair.privateKey.byteLength,
  );
  const signResult = secp256r1.sign(messageToSign, privKeyBuf);

  // Convert to DER format
  const sig = signResult.signature;
  const rBuf = new Uint8Array(sig.subarray(0, 32));
  let sBuf = new Uint8Array(sig.subarray(32, 64));

  // If useHighS option is enabled, convert s to high S-value (N - s)
  if (options?.useHighS) {
    const sValue = BigInt("0x" + Buffer.from(sBuf.buffer, sBuf.byteOffset, sBuf.byteLength).toString("hex"));
    const highS = SECP256R1_N - sValue;
    const highSHex = highS.toString(16).padStart(64, "0");
    sBuf = new Uint8Array(Buffer.from(highSHex, "hex"));
  }

  const derSignature = toDERSignature(rBuf, sBuf);

  // Calculate indices for the 7-param format
  const clientDataStr = JSON.stringify(clientData);
  const typeKey = '"type":"';
  const challengeKey = '"challenge":"';
  const originKey = '"origin":"';

  const typeIndex = clientDataStr.indexOf(typeKey) + typeKey.length;
  const challengeIndex = clientDataStr.indexOf(challengeKey) + challengeKey.length;
  const originStart = clientDataStr.indexOf(originKey) + originKey.length;
  const originEnd = clientDataStr.indexOf('"', originStart);

  // Encode for AccountKeyWebAuthn: 7-param format
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
    [
      authenticatorData,
      clientJSON,
      derSignature,
      typeIndex,
      challengeIndex,
      originStart,
      originEnd - originStart,
    ],
  );
}
