# ZKAP Account Abstraction Wallet Contracts

![CI](https://github.com/baerae-zkap/zkap-contracts/workflows/CI/badge.svg)
[![Coverage](https://img.shields.io/badge/coverage-96%25-brightgreen)](https://github.com/baerae-zkap/zkap-contracts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ERC-4337 Account Abstraction wallet contracts with ZK-proof-based OAuth authentication.

## Architecture

```
ZkapAccount (ERC-4337 Wallet)
├── ZkapAccountFactory          — Deterministic wallet deployment (proxy pattern)
├── AccountKey                  — Ownership verification via registered keys
│   ├── AccountKeyAddress       — ECDSA (secp256k1) signer verification
│   ├── AccountKeySecp256r1     — P-256 / passkey signature verification
│   ├── AccountKeyWebAuthn      — WebAuthn assertion verification
│   └── AccountKeyZkOAuth*      — ZK-SNARK OAuth RS256 verification (Groth16)
│       ├── Verifier (N=1,K=1)  — Single-slot, single-threshold
│       ├── Verifier1 (N=3,K=3) — Multi-slot test config
│       └── Verifier3 (N=6,K=3) — Production config
├── PoseidonMerkleTreeDirectory — On-chain Merkle tree for ZK commitment management
├── ZkapTimelockController      — Governance with time-delayed Merkle tree updates
└── ZkapPaymaster               — ERC-4337 paymaster for gas sponsorship
```

### Key Types

| Type | Contract | Use Case |
|------|----------|----------|
| Address (ECDSA) | `AccountKeyAddress` | Traditional EOA signer |
| Secp256r1 | `AccountKeySecp256r1` | Passkeys, secure enclave |
| WebAuthn | `AccountKeyWebAuthn` | Browser-based authentication |
| ZK OAuth RS256 | `AccountKeyZkOAuthRS256Verifier*` | Privacy-preserving OAuth (Google, Kakao) via Groth16 proofs |

Each wallet supports multisig with configurable key weights and thresholds per purpose (master key / transaction key).

---

## Quick Start

### Prerequisites

- Node.js >= 18
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`)
- Rust toolchain (only needed for building ZK circuits from source)

### Install & Compile

```bash
git clone https://github.com/baerae-zkap/zkap-contracts.git
cd zkap-contracts
cp .env.example .env
npm install
npx hardhat compile
```

### Download ZK Assets

ZK tests require pre-built CRS and NAPI binaries. Download them from Google Drive:

```bash
# Download all configurations (n1k1, n3k3, n6k3)
bash setup-zk-download.sh

# Download a specific configuration only
bash setup-zk-download.sh n3k3
```

Directory structure after download:
```
zk-assets/
  n1k1/   # N=1, K=1 (CRS, NAPI, Groth16Verifier)
  n3k3/   # N=3, K=3
  n6k3/   # N=6, K=3 (production default)
```

> **Note:** ZK NAPI binaries are currently **macOS ARM64 only** (`napi.darwin-arm64.node`). Linux/Windows contributors can run all tests except `test:e2e:zk`.

> To build ZK circuits from source, run `ZK_N=3 ZK_K=3 bash setup-zk-build.sh` (requires the `../zkup` project).

---

## Testing

### Commands

| Command | Description | Dependencies |
|---------|-------------|--------------|
| `npm run test:unit` | Unit tests (275) | None |
| `npm run test:foundry` | Foundry fuzz/invariant tests (81) | `forge` |
| `npm run test:e2e` | E2E tests, non-ZK (180) | None |
| `npm run test:e2e:zk` | E2E tests, ZK (69) | ZK assets (macOS ARM64) |
| `npm run test:ci` | CI suite (unit + foundry + e2e) | `forge` |
| `npm run test` | Full suite (CI + ZK) | All above |
| `npm run test:coverage` | Unit test coverage report | None |

### Run Tests

```bash
# Download ZK assets (first time only)
bash setup-zk-download.sh

# Run full test suite
npm test

# Run CI-compatible tests (no ZK dependency)
npm run test:ci
```

### Test Directory Structure

```
test/
  unit/              # Unit tests (Hardhat local network)
  e2e/
    core/            # E2E tests, non-ZK (Hardhat local network)
    zk/              # E2E tests, ZK (requires CRS/NAPI assets)
  foundry/           # Foundry fuzz/invariant tests
  helpers/           # Shared helpers and deployment fixtures
  fixtures/          # Test data
```

---

## ZK Circuit Configurations

Each ZK test uses CRS, NAPI, and Groth16Verifier matched to its N,K configuration:

| Config | N (slots) | K (threshold) | Test File |
|--------|-----------|---------------|-----------|
| n1k1 | 1 | 1 | `ZkOAuth.N1K1.e2e.test.ts` |
| n3k3 | 3 | 3 | `ZkOAuth.N3K3.e2e.test.ts`, `CreateWalletZkOAuthMasterKeyGas.e2e.test.ts` |
| n6k3 | 6 | 3 | `ZkOAuth.e2e.test.ts`, `ZkOAuthBenchmark.e2e.test.ts` |

`Groth16Verifier.sol` (N=6, K=3) is the production default. `Groth16VerifierN1K1.sol` and `Groth16VerifierN3K3.sol` are for testing only.

---

## Scripts

| Script | Description |
|--------|-------------|
| `setup-zk-download.sh` | Download pre-built CRS/NAPI from Google Drive |
| `setup-zk-build.sh` | Build ZK circuits from source (requires `../zkup`) |
| `setup-zk-build-mobile.sh` | Build ZK circuits + zkMobile rustBridge |
| `zk-config.sh` | ZK parameter environment variables |
| `generate-hash-aud.sh` | Generate audience hash |
| `generate-hash-leaf.sh` | Generate leaf hash |

---

## Deployment

```bash
npx hardhat run scripts/deploy.ts --network <network>
```

Supported networks are configured in `hardhat.config.ts`. Set `DEPLOYER_PRIVATE_KEY` in your `.env` file before deploying.

---

## License

This project is licensed under the [MIT License](LICENSE), with exceptions:

- **Groth16 verifier contracts** (`contracts/Utils/Groth16Verifier*.sol`) are licensed under GPL-3.0 (generated by circom/snarkjs tooling)
- **BN128 cryptographic libraries** (`contracts/Utils/Bn128*.sol`, `Operations.sol`, `Groth16AltBN128.sol`) are licensed under LGPL-3.0+

Per-file `SPDX-License-Identifier` headers are authoritative. See [LICENSE](LICENSE) for details.

---

## Security

If you discover a security vulnerability, please follow our [Security Policy](SECURITY.md). **Do not** open a public GitHub issue.

> **Disclaimer:** These contracts are provided as-is. While the codebase has been tested extensively (96% coverage), users should conduct their own security review before using in production. Smart contracts are inherently risky and may contain undiscovered vulnerabilities.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, development workflow, and PR guidelines.
