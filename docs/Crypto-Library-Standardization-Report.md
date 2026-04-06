# Crypto Library Standardization Report

> Security Audit Follow-up: Custom Cryptographic Library Replacement Analysis

**Date**: 2026-02-13
**Branch**: `fix/audit-issues`
**Reviewed by**: OpenAI Codex (gpt-5.3-codex), Claude Opus 4.6

---

## 1. Executive Summary

Following security audit recommendations, we replaced internally implemented cryptographic libraries with standard npm packages.

| Library | Action | Result |
|---------|--------|--------|
| **Secp256r1.sol** | Replaced with OZ P256 | **Complete** |
| **PoseidonHash.sol** | Attempted replacement with poseidon-solidity | **Not Possible** (round constant mismatch) |
| **WebAuthn (full)** | Evaluated standard library replacement | **Not Possible** (no suitable npm package) |
| **WebAuthn (P256 part)** | Replaced with OZ P256 | **Complete** |
| **RSA.sol** | N/A | Does not exist in project (handled internally by ZK circuit) |

---

## 2. Completed: Secp256r1 -> OpenZeppelin P256

### Changes
- `AccountKeySecp256r1.sol`: `Secp256r1.verify()` -> `P256.verify()`
- `AccountKeyWebAuthn.sol`: `Secp256r1.verify()` -> `P256.verify()`

### Deleted Files (~2,425 LOC)
| File | Lines |
|------|-------|
| `Secp256r1.sol` | 411 |
| `MyMath.sol` | 687 |
| `MySafeCast.sol` | 1,163 |
| `MyPanic.sol` | 55 |
| `MyErrors.sol` | 30 |
| `StringUtils.sol` | 79 |

### Verification
- Function signature identical: `verify(bytes32 hash, bytes32 r, bytes32 s, bytes32 x, bytes32 y) -> bool`
- Malleability protection (s <= N/2): OZ P256 enforces at `P256.sol:45, 202`
- RIP-7212 precompile: OZ P256 auto-detects at `P256.sol:61`, falls back to Solidity
- All tests pass: Hardhat unit (397), Foundry fuzz/invariant (81), E2E (57)

---

## 3. Not Possible: PoseidonHash Replacement

### Attempted
- **Target**: `poseidon-solidity` npm package (`PoseidonT3.hash([x, y])`)
- **Source**: Custom `PoseidonHashLib._hash(x, y)` (432 LOC)

### Failure Evidence
Equivalence test (`forge test --match-test testPoseidonEquivalence`) failed for ALL inputs:

```
PoseidonHashLib._hash(123, 456) = 6506351507978296836...
PoseidonT3.hash([123, 456])     = 19620391833206800292...

PoseidonHashLib._hash(0, 0) = 8885954456466675435...
PoseidonT3.hash([0, 0])     = 14744269619966411208...
```

### Root Cause Analysis (Codex)
Both implementations use BN254 scalar field, alpha=5, width=3, but differ in **round constants**.

| Parameter | Our Implementation | poseidon-solidity |
|-----------|-------------------|-------------------|
| Field | BN254 | BN254 |
| Alpha | 5 | 5 |
| Width (t) | 3 | 3 |
| Full rounds | 8 | 8 |
| Partial rounds | 57 | 57 |
| **Round constants** | **circomlibjs/iden3** | **Different variant** |

MDS matrix fingerprint (`7511745...`, `1037008...`, `1970517...`) confirms our implementation belongs to the **circomlibjs/iden3** parameter family.

### Why Replacement is Not Possible
1. The ZK circuit (arkworks/Groth16) uses the same Poseidon constants -> the on-chain hash must match the circuit hash exactly
2. No npm Solidity package with circomlibjs/iden3-compatible constants exists
3. Replacing the constants would invalidate all existing Merkle tree data and ZK proofs

### Mitigation
- Keep the existing implementation
- Document the circomlibjs generator version and constants file hash in code comments (provenance lock)
- Maintain differential tests against the ZK circuit (actual proof verification in E2E tests)

---

## 4. Not Possible: Full WebAuthn Replacement

### Our Implementation Scope
`AccountKeyWebAuthn.sol` (263 LOC):
- WebAuthn `type` field check (`"webauthn.get"`)
- `challenge` verification (Base64URL decode -> msgHash comparison)
- `origin` verification (keccak256 comparison) **<- most libs skip this**
- `rpId` verification (authData first 32 bytes) **<- most libs skip this**
- UP/UV flag checks
- DER signature parsing
- P256 signature verification -> **Now using OZ P256**

### Candidate Library Evaluation (as of 2026-02-13)

| Library | npm Available | Audited | origin/rpId Check | Status |
|---------|:---:|:---:|:---:|--------|
| `webauthn-sol` (Coinbase/Base) | No (Foundry-only) | Yes | **No** | Not usable |
| `@smoo.th/webauthn` | Yes (GitHub Packages) | **No** | Partial | Not recommended |
| `daimo-eth/p256-verifier` | No (Foundry-only) | Yes | N/A (P256 only) | Already replaced with OZ |
| `solady` WebAuthn | Yes | Yes | **No** (by design) | Missing origin/rpId |

### Why Full Replacement is Not Possible
1. No audited WebAuthn Solidity library installable via npm exists
2. All candidate libraries lack on-chain origin/rpId verification (required by our project)
3. Replacing only P256 verify with OZ while keeping custom WebAuthn policy logic is the **industry standard pattern** (confirmed by Codex)

### Additional Security Recommendations (Low Priority)
1. Add `authData.length >= 37` guard (prevents OOB panic before accessing authData[32])
2. Strengthen ASN.1 tag (`0x30`, `0x02`) and sequence length consistency validation in DER parser

---

## 5. Test Fix: CNT-618

During the ZKAPSC-009 refactor (block_timestamp -> jwt_exp per-proof approach), `CNT-618: proof timestamp boundary value test` was incompletely ported and required a fix.

### Root Cause
- Old version: `generateZkProof({ exp: expBoundary })` — exp could be injected directly
- New version: `generateZkProof({...})` — exp parameter removed, JWT's actual exp is bound by the circuit
- Test mistook `expBoundary = currentBlockTime + 100` for jwt_exp -> could never reach the actual jwt_exp (`Date.now()/1000 + 3600`)

### Fix
```typescript
// Before (broken)
const expBoundary = Number(currentBlockTime) + 100;
await time.increaseTo(expBoundary + 1); // far short of jwt_exp

// After (fixed)
const actualJwtExp = Number(proofBoundary.sharedInputs[4]); // extract actual jwt_exp from proof
await time.increaseTo(actualJwtExp - 1); // one before boundary -> success
await time.increaseTo(actualJwtExp);     // at boundary -> InvalidJwtExpiry revert
```

---

## 6. Verification Summary

| Test Suite | Result |
|------------|--------|
| `npx hardhat compile` | OK (3 files compiled) |
| Hardhat Unit Tests (397) | All pass |
| Foundry Fuzz/Invariant (81) | All pass |
| E2E ZkOAuth (57) | All pass (including fixed CNT-618) |

---

## 7. Changed Files

```
 contracts/AccountKey/Primitive/PKI/Secp256r1/AccountKeySecp256r1.sol  (import + verify call)
 contracts/AccountKey/Primitive/WebAuthn/AccountKeyWebAuthn.sol        (import + verify call)
 test/e2e/ZkOAuth.e2e.test.ts                                         (CNT-618 fix)
 contracts/AccountKey/Primitive/PKI/Secp256r1/Secp256r1.sol            (DELETED)
 contracts/Utils/MyMath.sol                                            (DELETED)
 contracts/Utils/MySafeCast.sol                                        (DELETED)
 contracts/Utils/MyPanic.sol                                           (DELETED)
 contracts/Utils/MyErrors.sol                                          (DELETED)
 contracts/Utils/StringUtils.sol                                       (DELETED)
```
