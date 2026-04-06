import { ethers } from "hardhat";

/**
 * AccountKey encoding helper functions
 *
 * Singleton pattern: initData is pure ABI-encoded data without function selector
 * ZkapAccount.initialize() calls IAccountKey(logic).register(initData)
 */

export interface PrimitiveKeyData {
  keyType: number;
  logicAddress: string;
  initData: string;
  weight: number;
}

/**
 * Encode an Address-type AccountKey
 * AccountKeyAddress.register(bytes initData) where initData = abi.encode(address signer)
 */
export function encodeAddressKey(signerAddress: string, logicContract: string, weight: number = 1): PrimitiveKeyData {
  // Singleton pattern: pure ABI encoding without function selector
  const initData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signerAddress]);

  return {
    keyType: 1, // PrimitiveAccountKeyTypes.keyAddress
    logicAddress: logicContract,
    initData: initData,
    weight: weight,
  };
}

/**
 * Encode multiple PrimitiveKeys into a single encodedKey
 */
export function encodePrimitiveKeys(threshold: number, keys: PrimitiveKeyData[]): string {
  const logicList = keys.map((k) => k.logicAddress);
  const initDataList = keys.map((k) => k.initData);
  const weightList = keys.map((k) => k.weight);

  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address[]", "bytes[]", "uint8[]"],
    [threshold, logicList, initDataList, weightList],
  );
}

/**
 * Create a dummy encodedKey for testing
 */
export async function createDummyEncodedKey(
  accountKeyAddressLogic: string,
  signerAddress: string,
  threshold: number = 1,
): Promise<string> {
  const key = encodeAddressKey(signerAddress, accountKeyAddressLogic, 1);
  return encodePrimitiveKeys(threshold, [key]);
}

/**
 * Encode a Secp256r1 (P-256)-type AccountKey
 * AccountKeySecp256r1.register(bytes initData) where initData = abi.encode(Key)
 * Key = struct { bytes32 x, bytes32 y }
 */
export function encodeSecp256r1Key(
  publicKeyX: string,
  publicKeyY: string,
  logicContract: string,
  weight: number = 1,
): PrimitiveKeyData {
  // Singleton pattern: pure ABI encoding without function selector
  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32 x, bytes32 y)"],
    [{ x: publicKeyX, y: publicKeyY }],
  );

  return {
    keyType: 3, // PrimitiveAccountKeyTypes.keySecp256r1
    logicAddress: logicContract,
    initData: initData,
    weight: weight,
  };
}

/**
 * Encode a WebAuthn-type AccountKey
 * AccountKeyWebAuthn.register(bytes initData) where initData = abi.encode(bytes encoded, bytes32 rpIdHash, bytes origin, bool requireUV)
 * encoded = abi.encode(Key) where Key = { bytes32 x, bytes32 y, string credentialId }
 */
export function encodeWebAuthnKey(
  publicKeyX: string,
  publicKeyY: string,
  credentialId: string,
  rpIdHash: string,
  origin: string,
  logicContract: string,
  weight: number = 1,
  requireUV: boolean = false,
): PrimitiveKeyData {
  // Encode Key struct: { bytes32 x, bytes32 y, string credentialId }
  const keyEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32 x, bytes32 y, string credentialId)"],
    [{ x: publicKeyX, y: publicKeyY, credentialId: credentialId }],
  );

  // Singleton pattern: pure ABI encoding without function selector
  // register(bytes initData) where initData = abi.encode(bytes encoded, bytes32 rpIdHash, bytes origin, bool requireUV)
  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "bytes32", "bytes", "bool"],
    [keyEncoded, rpIdHash, ethers.toUtf8Bytes(origin), requireUV],
  );

  return {
    keyType: 4, // PrimitiveAccountKeyTypes.keyWebAuthn
    logicAddress: logicContract,
    initData: initData,
    weight: weight,
  };
}

/**
 * Encode a ZkOAuth RS256-type AccountKey
 * AccountKeyZkOAuthRS256Verifier.register(bytes initData)
 * where initData = abi.encode(bytes encoded, address directory)
 * encoded = abi.encode(uint256 n, uint256 k, uint256 hAudList, uint256[] anchor)
 */
export function encodeZkOAuthRS256Key(
  n: bigint | number,
  k: bigint | number,
  hAudList: bigint | string,
  anchor: (bigint | string)[],
  poseidonMerkleTreeDirectory: string,
  logicContract: string,
  weight: number = 1,
): PrimitiveKeyData {
  // Encode inner data: (n, k, hAudList, anchor[])
  const innerEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint256", "uint256[]"],
    [n, k, hAudList, anchor],
  );

  // Outer encoding for register(): (bytes encoded, address directory)
  const initData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "address"],
    [innerEncoded, poseidonMerkleTreeDirectory],
  );

  return {
    keyType: 6, // PrimitiveAccountKeyTypes.keyZkOAuthRS256
    logicAddress: logicContract,
    initData: initData,
    weight: weight,
  };
}
