/**
 * ZK circuit input formatting utilities.
 *
 * These are pure functions for preparing inputs to Groth16 ZK circuits:
 * - padAndStrToFieldsBN254: pads a string and splits into BN254 field elements
 * - formattingModulorN: converts RSA modulus to little-endian uint256 chunks
 *
 * Originally from @baerae/zkap-aa SDK utils/crypto. Inlined here to remove
 * the SDK dependency from the contracts repo.
 */
import { ethers } from "ethers";

const BN254_FR =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MODULUS_BIT_SIZE = 254;
const LIMB_WIDTH = Math.floor((MODULUS_BIT_SIZE - 1) / 8); // = 31

function calculateMaxClaimLen(
  userMaxClaimLen: number,
  modulusBitSize: number = MODULUS_BIT_SIZE
): number {
  const limbWidth = Math.floor((modulusBitSize - 1) / 8);
  const nLimbs = Math.ceil(userMaxClaimLen / limbWidth);
  return nLimbs * limbWidth;
}

function padStr(s: string, targetLen: number, padChar: number): string {
  if (s.length < targetLen) {
    s += String.fromCharCode(padChar).repeat(targetLen - s.length);
  }
  return s;
}

function beBytesToBigInt(bytes: Uint8Array): bigint {
  let x = 0n;
  for (let i = 0; i < bytes.length; i++) x = (x << 8n) + BigInt(bytes[i]);
  return x;
}

function strToFieldsBN254(s: string): bigint[] {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length % LIMB_WIDTH !== 0) {
    throw new Error(
      `Input length (${bytes.length}) must be a multiple of ${LIMB_WIDTH}.`
    );
  }
  const out: bigint[] = [];
  for (let i = 0; i < bytes.length; i += LIMB_WIDTH) {
    const chunk = bytes.subarray(i, i + LIMB_WIDTH);
    const n = beBytesToBigInt(chunk) % BN254_FR;
    out.push(n);
  }
  return out;
}

function padAndStrToFieldsBN254(
  s: string,
  userMaxClaimLen: number,
  padChar: number
): bigint[] {
  const maxClaimLen = calculateMaxClaimLen(userMaxClaimLen);
  s = padStr(s, maxClaimLen, padChar);
  return strToFieldsBN254(s);
}

/**
 * Performs the same logic as Solidity's formattingModulorN function.
 * Reverses the byte array, splits it into 8-byte chunks, and converts
 * to an array of uint256 (bigint) values in little-endian order.
 */
function formattingModulorN(n: string | Uint8Array): string[] {
  const bytes = ethers.getBytes(n);
  if (bytes.length % 8 !== 0) {
    throw new Error("Input length must be a multiple of 8");
  }
  const reversedBytes = bytes.slice().reverse();
  const chunks = reversedBytes.length / 8;
  const result: string[] = [];
  for (let i = 0; i < chunks; i++) {
    const chunk = reversedBytes.slice(i * 8, (i + 1) * 8);
    let value = 0n;
    for (let j = 0; j < 8; j++) {
      value |= BigInt(chunk[j]) << (8n * BigInt(j));
    }
    result.push(ethers.toBeHex(value));
  }
  return result;
}

export default {
  formattingModulorN,
  padAndStrToFieldsBN254,
};
