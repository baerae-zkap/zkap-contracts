#!/bin/bash
# Run all tests that work without external setup (unit + contracts + non-ZK e2e)
set -e

echo "=========================================="
echo "Running local tests (no external setup)"
echo "=========================================="

echo ""
echo "[1/4] Unit tests..."
npx hardhat test test/unit/**/*.ts

echo ""
echo "[2/4] Contract tests..."
npx hardhat test \
  test/contracts/ZkapAccount.isValidSignature.test.ts

echo ""
echo "[3/4] Foundry fuzz/invariant tests..."
if command -v forge &> /dev/null; then
  forge test --summary
else
  echo "SKIP: forge not installed (install: curl -L https://foundry.paradigm.xyz | bash && foundryup)"
fi

echo ""
echo "[4/4] E2E tests (non-ZK)..."
npx hardhat test \
  test/e2e/WalletCreation.e2e.test.ts \
  test/e2e/Transaction.e2e.test.ts \
  test/e2e/KeyUpdate.e2e.test.ts \
  test/e2e/Recovery.e2e.test.ts \
  test/e2e/EIP1271.e2e.test.ts \
  test/e2e/PaymasterIntegration.e2e.test.ts \
  test/e2e/UUPSUpgrade.e2e.test.ts \
  test/e2e/Reentrancy.e2e.test.ts \
  test/e2e/ConcurrentAndDeploy.e2e.test.ts \
  test/e2e/GasBenchmark.e2e.test.ts \
  test/e2e/UpdateTxKeyWebAuthnGas.e2e.test.ts

echo ""
echo "=========================================="
echo "All local tests passed!"
echo "=========================================="
