#!/bin/bash
set -e

# ==============================================================================
# Filename: setup-zk-build.sh
# Description:
#   - Generate Rust CRS / Verifier
#   - Build NAPI package
#   - Deploy artifacts under zkap-contracts
#
# Design principles:
#   - ZK parameter management is handled exclusively in zk-config.sh
#   - This script is responsible only for "build + deploy"
# ==============================================================================

# ------------------------------------------------------------------------------
# 0. Load path and common configuration
# ------------------------------------------------------------------------------

# Directory where this script is located (zkap-contracts root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ZK common configuration (export environment variables)
source "${SCRIPT_DIR}/zk-config.sh"

# ------------------------------------------------------------------------------
# 1. Path configuration
# ------------------------------------------------------------------------------

# zkup project root (sibling directory of zkap-contracts)
ZKUP_DIR="${SCRIPT_DIR}/../zkup"

# Location where generated artifacts will be collected (zkup/dist/baerae)
ARTIFACTS_DIR="./dist/baerae"
ABS_ARTIFACTS_DIR="${ZKUP_DIR}/dist/baerae"

# Path validation
if [ ! -d "${ZKUP_DIR}" ]; then
  echo "❌ Error: zkup directory not found: ${ZKUP_DIR}"
  exit 1
fi

# ------------------------------------------------------------------------------
# 2. Execution Section
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# 2-1. Rust: Generate CRS and Verifier
# ------------------------------------------------------------------------------
echo ""
echo "🚀 [1/3] Starting Rust Setup (CRS & Verifier generation)..."

cd "${ZKUP_DIR}"

# Clean existing dist folder (start from a clean state)
rm -rf dist
mkdir -p dist

# Generate CRS
# - build.rs uses environment variables exported from zk-config.sh
cargo run --release \
  --features baerae,num-cs-logging \
  --bin generate_baerae_crs \
  -- "${ARTIFACTS_DIR}"

echo "✅ Rust Setup complete. Artifacts location: ${ABS_ARTIFACTS_DIR}"

# ------------------------------------------------------------------------------
# 2-2. NAPI: Build Node package
# ------------------------------------------------------------------------------
echo ""
echo "📦 [2/3] Starting NAPI package build..."

cd "${ZKUP_DIR}/bindings/napi"

# Install dependencies if not present
if [ ! -d "node_modules" ]; then
  echo "   Running npm install..."
  npm install
fi

# Run build (output goes to zkup/dist/baerae)
npm run build:dist

echo "✅ NAPI build complete."

# ------------------------------------------------------------------------------
# 2-3. Copy and deploy files
# ------------------------------------------------------------------------------
echo ""
echo "🚚 [3/3] Starting artifact copy and deployment..."

# Destination directories
DEST_CRS="${SCRIPT_DIR}/zk-assets/crs"
DEST_NAPI="${SCRIPT_DIR}/zk-assets/napi"
DEST_CONTRACTS="${SCRIPT_DIR}/contracts/Utils"

mkdir -p "${DEST_CRS}"
mkdir -p "${DEST_NAPI}"
mkdir -p "${DEST_CONTRACTS}"

# 1) Proving Key
if [ -f "${ABS_ARTIFACTS_DIR}/pk.key" ]; then
  cp "${ABS_ARTIFACTS_DIR}/pk.key" "${DEST_CRS}/"
  echo "   [COPY] pk.key -> ${DEST_CRS}/"
else
  echo "   ⚠️  Warning: pk.key was not generated."
fi

# 2) NAPI files (.node, js, d.ts)
if ls "${ABS_ARTIFACTS_DIR}"/*.node 1> /dev/null 2>&1; then
  if [ -f "${ABS_ARTIFACTS_DIR}/index.js" ]; then
    cp "${ABS_ARTIFACTS_DIR}/index.js" "${DEST_NAPI}/"
  fi
  if [ -f "${ABS_ARTIFACTS_DIR}/index.d.ts" ]; then
    cp "${ABS_ARTIFACTS_DIR}/index.d.ts" "${DEST_NAPI}/"
  fi

  cp "${ABS_ARTIFACTS_DIR}"/*.node "${DEST_NAPI}/"
  echo "   [COPY] NAPI files (.node [+ optional js/d.ts]) -> ${DEST_NAPI}/"
else
  echo "   ⚠️  Warning: NAPI build output (.node) not found."
fi

# 3) Solidity Verifier
if [ -f "${ABS_ARTIFACTS_DIR}/Groth16Verifier.sol" ]; then
  cp "${ABS_ARTIFACTS_DIR}/Groth16Verifier.sol" \
     "${DEST_CONTRACTS}/Groth16Verifier.sol"
  echo "   [COPY] Groth16Verifier.sol -> ${DEST_CONTRACTS}/"
else
  echo "   ⚠️  Warning: Groth16Verifier.sol was not generated."
fi

echo ""
echo "=================================================="
echo "🎉 All tasks completed!"
echo "=================================================="
