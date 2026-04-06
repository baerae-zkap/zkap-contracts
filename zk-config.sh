#!/bin/bash
set -euo pipefail

# ==============================================================================
# Filename: zk-config.sh
# Purpose:
#   - Manage (export) the environment variables read by ZkapConfig (build.rs)
#     as a "single source of truth"
#   - Optionally print the currently applied values to the terminal (--print/--print-env)
#
# Usage:
#   1) Check (print) current configuration values only
#      ./zk-config.sh --print
#
#   2) Run with custom values (override via environment variables)
#      ZK_K=4 ZK_NUM_AUDIENCE_LIMIT=8 ./zk-config.sh --print
#
#      or
#      export ZK_K=4
#      export ZK_NUM_AUDIENCE_LIMIT=8
#      ./zk-config.sh --print
#
#   3) Note: this script exports only to the "current process".
#      - Running as `./zk-config.sh` exports only within that process
#        and does not propagate to the parent shell.
#      - To propagate to the parent shell as well, use `source`:
#          source ./zk-config.sh
#          source ./zk-config.sh --print
#
# Note:
#   - This file only performs export/printing.
#   - Changing ZK parameters (ZK_K, ZK_NUM_AUDIENCE_LIMIT, etc.) requires
#     regenerating all of: CRS / aud hash / leaf hash.
# ==============================================================================
# ------------------------------
# [JWT Constraints Defaults]
# ------------------------------
: "${ZK_MAX_JWT_B64_LEN:=1024}"
: "${ZK_MAX_PAYLOAD_B64_LEN:=896}"
: "${ZK_MAX_AUD_LEN:=155}"
: "${ZK_MAX_EXP_LEN:=20}"
: "${ZK_MAX_ISS_LEN:=93}"
: "${ZK_MAX_NONCE_LEN:=93}"
: "${ZK_MAX_SUB_LEN:=93}"

# ------------------------------
# [Logic Constraints Defaults]
# ------------------------------
: "${ZK_N:=3}"
: "${ZK_K:=3}"
: "${ZK_TREE_HEIGHT:=16}"

# ------------------------------
# [Audience Limit]
# ------------------------------
: "${ZK_NUM_AUDIENCE_LIMIT:=5}"

# ------------------------------
# Export for build.rs / Rust bins
# ------------------------------
export ZK_MAX_JWT_B64_LEN
export ZK_MAX_PAYLOAD_B64_LEN
export ZK_MAX_AUD_LEN
export ZK_MAX_EXP_LEN
export ZK_MAX_ISS_LEN
export ZK_MAX_NONCE_LEN
export ZK_MAX_SUB_LEN
export ZK_N
export ZK_K
export ZK_TREE_HEIGHT
export ZK_NUM_AUDIENCE_LIMIT

# ==============================================================================
# Print helpers (optional)
# ==============================================================================
__zk_config_print() {
  echo "=========================================="
  echo "✅ ZK Config (exported environment values)"
  echo "=========================================="
  printf "ZK_MAX_JWT_B64_LEN=%s\n" "${ZK_MAX_JWT_B64_LEN}"
  printf "ZK_MAX_PAYLOAD_B64_LEN=%s\n" "${ZK_MAX_PAYLOAD_B64_LEN}"
  printf "ZK_MAX_AUD_LEN=%s\n" "${ZK_MAX_AUD_LEN}"
  printf "ZK_MAX_EXP_LEN=%s\n" "${ZK_MAX_EXP_LEN}"
  printf "ZK_MAX_ISS_LEN=%s\n" "${ZK_MAX_ISS_LEN}"
  printf "ZK_MAX_NONCE_LEN=%s\n" "${ZK_MAX_NONCE_LEN}"
  printf "ZK_MAX_SUB_LEN=%s\n" "${ZK_MAX_SUB_LEN}"
  echo "------------------------------------------"
  printf "ZK_N=%s\n" "${ZK_N}"
  printf "ZK_K=%s\n" "${ZK_K}"
  printf "ZK_TREE_HEIGHT=%s\n" "${ZK_TREE_HEIGHT}"
  echo "------------------------------------------"
  printf "ZK_NUM_AUDIENCE_LIMIT=%s\n" "${ZK_NUM_AUDIENCE_LIMIT}"
  echo "=========================================="
}

# Option handling:
# - supports `source zk-config.sh --print` form
# - supports `./zk-config.sh --print` form as well
if [[ "${1:-}" == "--print" || "${1:-}" == "--print-env" ]]; then
  __zk_config_print
fi
