#!/bin/bash
set -e

# ==============================================================================
# Filename: setup-zk-build-mobile.sh
#
# Purpose:
#   1) Generate CRS / pk.key / Verifier using ZK_* parameters from zk-config.sh
#   2) Build zkMobile rustBridge (craby) (uses the same ZK_* env)
#   3) Build NAPI (Node) bindings
#   4) Deploy artifacts + install pk.key in zkMobile app (DEBUG) sandbox
#
# Principles:
#   - ZK parameters are managed (exported) exclusively in zk-config.sh
#   - Mobile sandbox key installation is performed only for DEBUG builds (run-as restriction)
# ==============================================================================

# ------------------------------------------------------------------------------
# 0. Load path and common configuration
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/zk-config.sh"

# ------------------------------------------------------------------------------
# 1. Project path configuration
# ------------------------------------------------------------------------------
ZKUP_DIR="${SCRIPT_DIR}/../zkup"
ARTIFACTS_DIR="./dist/baerae"
ABS_ARTIFACTS_DIR="${ZKUP_DIR}/dist/baerae"

if [ ! -d "${ZKUP_DIR}" ]; then
  echo "❌ Error: zkup directory not found: ${ZKUP_DIR}"
  exit 1
fi

# ------------------------------------------------------------------------------
# 2-1. Rust: Generate CRS / Proving Key / Verifier
# ------------------------------------------------------------------------------
echo ""
echo "🚀 [1/4] Starting Rust Setup (CRS & Verifier generation)..."

cd "${ZKUP_DIR}"

rm -rf dist
mkdir -p dist

cargo run --release \
  --features baerae,num-cs-logging \
  --bin generate_baerae_crs \
  -- "${ARTIFACTS_DIR}"

echo "✅ Rust Setup complete. Artifacts location: ${ABS_ARTIFACTS_DIR}"

# ------------------------------------------------------------------------------
# 2-2. zkMobile: Build rustBridge (craby)
# ------------------------------------------------------------------------------
echo ""
echo "🧩 [2/4] Starting zkMobile rustBridge (craby) build..."

ZK_MOBILE_DIR="${SCRIPT_DIR}/../zkMobile"
RUST_BRIDGE_DIR="${ZK_MOBILE_DIR}/packages/rustBridge"

if [ ! -d "${RUST_BRIDGE_DIR}" ]; then
  echo "   ⚠️  Warning: rustBridge directory not found: ${RUST_BRIDGE_DIR}"
else
  rm -rf "${RUST_BRIDGE_DIR}/target" \
        "${RUST_BRIDGE_DIR}/dist" \
        "${RUST_BRIDGE_DIR}/artifacts" \
        "${RUST_BRIDGE_DIR}/.craby" \
        "${RUST_BRIDGE_DIR}/ios"/*/build \
        "${RUST_BRIDGE_DIR}/android"/*/build 2>/dev/null || true

  echo "   [ENV] ZK params used for rustBridge build:"
  env | grep '^ZK_' | sort || true

  # yarn install must be run from the workspace root (zkMobile)
  cd "${ZK_MOBILE_DIR}"
  echo "   Running yarn install at zkMobile root..."
  yarn install

  # rustBridge build must be invoked via the workspace so Yarn recognizes it as a project
  ZK_MAX_JWT_B64_LEN="${ZK_MAX_JWT_B64_LEN}" \
  ZK_MAX_PAYLOAD_B64_LEN="${ZK_MAX_PAYLOAD_B64_LEN}" \
  ZK_MAX_AUD_LEN="${ZK_MAX_AUD_LEN}" \
  ZK_MAX_EXP_LEN="${ZK_MAX_EXP_LEN}" \
  ZK_MAX_ISS_LEN="${ZK_MAX_ISS_LEN}" \
  ZK_MAX_NONCE_LEN="${ZK_MAX_NONCE_LEN}" \
  ZK_MAX_SUB_LEN="${ZK_MAX_SUB_LEN}" \
  ZK_N="${ZK_N}" \
  ZK_K="${ZK_K}" \
  ZK_TREE_HEIGHT="${ZK_TREE_HEIGHT}" \
  ZK_NUM_AUDIENCE_LIMIT="${ZK_NUM_AUDIENCE_LIMIT}" \
  yarn workspace rustBridge build

  echo "✅ rustBridge build complete."
fi

# ------------------------------------------------------------------------------
# 2-3. NAPI: Build Node bindings package
# ------------------------------------------------------------------------------
echo ""
echo "📦 [3/4] Starting NAPI package build..."

cd "${ZKUP_DIR}/bindings/napi"

if [ ! -d "node_modules" ]; then
  echo "   Running npm install..."
  npm install
fi

npm run build:dist

echo "✅ NAPI build complete."

# ------------------------------------------------------------------------------
# 2-4. Deploy artifacts + install pk.key in zkMobile (DEBUG) sandbox
# ------------------------------------------------------------------------------
echo ""
echo "🚚 [4/4] Starting artifact copy and deployment..."

DEST_CRS="${SCRIPT_DIR}/zk-assets/crs"
DEST_NAPI="${SCRIPT_DIR}/zk-assets/napi"
DEST_CONTRACTS="${SCRIPT_DIR}/contracts/Utils"

mkdir -p "${DEST_CRS}"
mkdir -p "${DEST_NAPI}"
mkdir -p "${DEST_CONTRACTS}"

# 1) Deploy Proving Key + install in zkMobile sandbox
if [ -f "${ABS_ARTIFACTS_DIR}/pk.key" ]; then
  cp "${ABS_ARTIFACTS_DIR}/pk.key" "${DEST_CRS}/"
  echo "   [COPY] pk.key -> ${DEST_CRS}/"

  # zkMobile: DEBUG install + DocumentDirectoryPath/assets/pk.key installation
  ZK_MOBILE_SETUP_ALL="${SCRIPT_DIR}/../zkMobile/scripts/setup-zk-all.sh"
  if [ -f "${ZK_MOBILE_SETUP_ALL}" ]; then
    bash "${ZK_MOBILE_SETUP_ALL}" "${ABS_ARTIFACTS_DIR}/pk.key"
  else
    echo "   ⚠️  Warning: zkMobile setup script not found: ${ZK_MOBILE_SETUP_ALL}"
  fi
else
  echo "   ⚠️  Warning: pk.key was not generated."
fi

# 2) Deploy NAPI artifacts
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

# 3) Deploy Solidity Verifier
if [ -f "${ABS_ARTIFACTS_DIR}/Groth16Verifier.sol" ]; then
  cp "${ABS_ARTIFACTS_DIR}/Groth16Verifier.sol" \
     "${DEST_CONTRACTS}/Groth16Verifier.sol"
  echo "   [COPY] Groth16Verifier.sol -> ${DEST_CONTRACTS}/"
else
  echo "   ⚠️  Warning: Groth16Verifier.sol was not generated."
fi

echo ""
echo "=================================================="
echo "🎉 setup-zk-build-mobile.sh all tasks completed!"
echo "=================================================="
