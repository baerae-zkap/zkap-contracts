#!/bin/bash
# Run ZK e2e tests (requires NAPI bindings + CRS files)
set -e

echo "=========================================="
echo "Running ZK e2e tests"
echo "=========================================="

# Check prerequisites
if [ ! -f "zk-assets/napi/index.js" ]; then
  echo "ERROR: NAPI bindings not found at zk-assets/napi/"
  echo "Run ./setup-zk-build.sh first (requires ../zkup project)"
  exit 1
fi

if [ ! -f "zk-assets/crs/pk.key" ]; then
  echo "ERROR: CRS files not found at zk-assets/crs/"
  echo "Run ./setup-zk-build.sh first (requires ../zkup project)"
  exit 1
fi

# Load ZK config
source ./zk-config.sh
echo "Using ZK_N=$ZK_N, ZK_K=$ZK_K"
echo ""

npx hardhat test \
  test/e2e/ZkOAuth.e2e.test.ts \
  test/e2e/ZkOAuth.N3K3.e2e.test.ts \
  test/e2e/ZkpVerification.e2e.test.ts \
  test/e2e/CreateWalletZkOAuthMasterKeyGas.e2e.test.ts

echo ""
echo "=========================================="
echo "ZK e2e tests passed!"
echo "=========================================="
echo ""
echo "NOTE: To run N1K1 tests, rebuild CRS with K=1:"
echo "  ./setup-zk-build.sh 1 896"
echo "  npx hardhat test test/e2e/ZkOAuth.N1K1.e2e.test.ts"
