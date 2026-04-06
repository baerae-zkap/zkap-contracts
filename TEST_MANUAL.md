# ZKAP Contracts Test Manual

## Test Overview

| Category | Location | Count | Dependencies | Command |
|----------|----------|-------|--------------|---------|
| Unit | `test/unit/` | 275 | None | `npm run test:unit` |
| E2E Core | `test/e2e/core/` | 180 | None | `npm run test:e2e` |
| Foundry | `test/foundry/` | 81 | `forge` | `npm run test:foundry` |
| E2E ZK | `test/e2e/zk/` | 69 | CRS/NAPI | `npm run test:e2e:zk` |
| E2E Manual | `test/e2e/manual/` | 9 | OAuth/Testnet | `npm run test:e2e:manual` |

```bash
# Run all tests (unit + foundry + e2e + e2e:zk)
npm test
```

---

## 1. Unit Tests

```bash
npm run test:unit
```

Runs on the Hardhat local network. No external dependencies.

**Includes:**
- `ZkapAccount.test.ts` — Full account contract tests
- `ZkapAccountFactory.test.ts` — Factory pattern tests
- `ZkapPaymaster.test.ts` — Paymaster tests
- `ZkapAccount.isValidSignature.test.ts` — EIP-1271 signature verification
- `AccountKey/` — AddressKey, Secp256r1, WebAuthn, ZkOAuthRS256, PoseidonMerkleTree

**Coverage:**
```bash
npm run test:coverage
```

---

## 2. E2E Tests (Core)

```bash
npm run test:e2e
```

Runs on the Hardhat local network. No ZK circuit required.

| Test File | Coverage |
|------------|---------|
| `WalletCreation.e2e.test.ts` | Wallet creation (single key, multisig, weighted) |
| `Transaction.e2e.test.ts` | ETH, ERC20, ERC721, contract call |
| `KeyUpdate.e2e.test.ts` | Key rotation, update |
| `Recovery.e2e.test.ts` | Account recovery flow |
| `EIP1271.e2e.test.ts` | EIP-1271 signature verification |
| `PaymasterIntegration.e2e.test.ts` | Paymaster gas sponsorship |
| `UUPSUpgrade.e2e.test.ts` | Proxy upgrade |
| `Reentrancy.e2e.test.ts` | Reentrancy defense |
| `ConcurrentAndDeploy.e2e.test.ts` | Concurrent operations |
| `GasBenchmark.e2e.test.ts` | Gas cost measurement |
| `UpdateTxKeyWebAuthnGas.e2e.test.ts` | WebAuthn key update gas |

---

## 3. Foundry Fuzz/Invariant Tests

```bash
npm run test:foundry

# Summary table
forge test --summary

# Run a specific test
forge test --match-path test/foundry/ZkapAccount.fuzz.t.sol
```

**Requirements:** [Foundry](https://book.getfoundry.sh/getting-started/installation)

| Test File | Type | Coverage |
|------------|------|---------|
| `AccountKey.fuzz.t.sol` | fuzz | Full AccountKey |
| `ZkapAccount.fuzz.t.sol` | fuzz | Execute, initialize, deposit |
| `ZkapAccount.blockcheck.fuzz.t.sol` | fuzz | Block-based key restriction |
| `ZkapAccount.multisig.fuzz.t.sol` | fuzz | Multisig threshold, weight |
| `ZkapAccount.invariant.t.sol` | invariant | ETH receive, entryPoint |
| `ZkapAccountFactory.fuzz.t.sol` | fuzz | Account creation, address calculation |
| `ZkapPaymaster.fuzz.t.sol` | fuzz | Signer, stake, allowlist |
| `ZkapPaymaster.extended.fuzz.t.sol` | fuzz | Batch allowlist, deposit |
| `ZkapPaymaster.invariant.t.sol` | invariant | Admin role, deposit |

Config: `foundry.toml` (fuzz runs: 1000, invariant runs: 256)

---

## 4. E2E Tests (ZK)

### Setup

```bash
# Download CRS/NAPI (first time only)
bash setup-zk-download.sh
```

This script downloads binaries for 3 ZK configurations from Google Drive:
- `zk-assets/n1k1/` — N=1, K=1
- `zk-assets/n3k3/` — N=3, K=3
- `zk-assets/n6k3/` — N=6, K=3

Each directory contains `crs/pk.key`, `napi/` bindings, and `Groth16Verifier.sol`.

### Run

```bash
# Run all ZK tests
npm run test:e2e:zk

# Run individually
source ./zk-config.sh
npx hardhat test test/e2e/zk/ZkOAuth.N3K3.e2e.test.ts
```

### ZK Test List

| Test File | N,K | Coverage |
|------------|-----|---------|
| `ZkOAuth.e2e.test.ts` | 6,3 | Full ZK OAuth flow (CNT-309~689) |
| `ZkOAuth.N3K3.e2e.test.ts` | 3,3 | 3-of-3 ZK OAuth authentication |
| `ZkOAuth.N1K1.e2e.test.ts` | 1,1 | 1-of-1 ZK OAuth authentication |
| `CreateWalletZkOAuthMasterKeyGas.e2e.test.ts` | 3,3 | ZK masterKey wallet creation gas |
| `ZkOAuthBenchmark.e2e.test.ts` | 6,3 | Proof generation time / verification gas benchmark |

### Build CRS Locally (Optional)

To build locally instead of downloading, the `../zkup` project is required:

```bash
# Build N=3, K=3
ZK_N=3 ZK_K=3 bash setup-zk-build.sh

# Build N=1, K=1
ZK_N=1 ZK_K=1 bash setup-zk-build.sh
```

---

## 5. E2E Manual Tests

```bash
npm run test:e2e:manual
```

`test/e2e/manual/` contains tests that require manual execution.
Real OAuth login, external testnets, or browser interaction is required.

### OAuth Tests

| File | Social Login | Description |
|------|-----------|------|
| `OAuthGoogleLocal.e2e.test.ts` | Google (browser) | Local Google OAuth + ZK proof |
| `OAuthSingleGoogle.e2e.test.ts` | Google (browser) | Google single-account wallet creation |
| `OAuthSingleKakao.e2e.test.ts` | Kakao (browser) | Kakao single-account wallet creation |
| `OAuthMultiGoogleAccounts.e2e.test.ts` | Google x3 (browser) | Google multi-account |
| `OAuthMultiGoogleKakao.e2e.test.ts` | Google+Kakao (browser) | Multi-provider mixed |
| `OAuthGooglePasskey.e2e.test.ts` | Google (browser) | Google OAuth + WebAuthn Passkey |
| `SignMessagePasskey.e2e.test.ts` | None | WebAuthn Passkey signature verification |

### Testnet Tests

| File | Network | Description |
|------|---------|------|
| `TestnetBaseSepolia.e2e.test.ts` | Base Sepolia (84532) | Base Sepolia deployment verification |
| `TestnetKairos.e2e.test.ts` | Kairos (1001) | Kaia Kairos deployment verification |

**Testnet execution:**
```bash
npx hardhat test test/e2e/manual/TestnetKairos.e2e.test.ts --network kairos
npx hardhat test test/e2e/manual/TestnetBaseSepolia.e2e.test.ts --network baseSepolia
```

**Environment variables:** `PRIVATE_KEY` and `PAYMASTER_PRIVATE_KEY` required in `.env` or hardhat vars

---

## Helper Files

`test/helpers/` contains shared utilities. Not executed directly.

| File | Purpose |
|------|------|
| `accountKeyHelper.ts` | Key encoding utilities |
| `userOpHelper.ts` | UserOp creation/signing |
| `crypto.ts` | SDK crypto wrapper |
| `idTokenSimulator.ts` | Google/Kakao ID token simulator |
| `google.ts` | Google JWT decoding |
| `kakao.ts` | Kakao OAuth helper |
| `CommonAccountKeyDeployment.ts` | AccountKey deployment fixture |
| `ZkapRelatedContractDeployment.ts` | ZKAP contract deployment fixture |
