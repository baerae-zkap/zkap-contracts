#!/bin/bash
set -euo pipefail

# ==============================================================================
# Filename: generate-hash-aud.sh
# Purpose:
#   - Execute the "aud" feature of zkup/circuit/src/bin/generate_hash.rs
#   - Source zk-config.sh to use the same ZkapConfig as setup-zk-build.sh
#
# Usage:
#   ./generate-hash-aud.sh --values "\"aud1\", \"aud2\""
#   ./generate-hash-aud.sh --values "\"aud1\", \"aud2\"" --out "./zk-assets/crs/aud_output.json"
#
# Example:
#   ./generate-hash-aud.sh --values "\"....apps.googleusercontent.com\", \"....\""
#
# Note:
#   - The values argument is a "string including quotes", so always wrap the entire value in double quotes.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/zk-config.sh"

ZKUP_DIR="${SCRIPT_DIR}/../zkup"
if [ ! -d "${ZKUP_DIR}" ]; then
  echo "❌ zkup directory not found: ${ZKUP_DIR}"
  exit 1
fi

# Default output
OUT_PATH_DEFAULT="${SCRIPT_DIR}/zk-assets/crs/aud_output.json"

# Argument parsing (simple/safe)
VALUES=""
OUT_PATH="${OUT_PATH_DEFAULT}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --values)
      VALUES="${2:-}"
      shift 2
      ;;
    --out)
      OUT_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --values '\"aud1\", \"aud2\"' [--out out.json]"
      exit 0
      ;;
    *)
      echo "❌ Unknown argument: $1"
      echo "Usage: $0 --values '\"aud1\", \"aud2\"' [--out out.json]"
      exit 1
      ;;
  esac
done

if [ -z "${VALUES}" ]; then
  echo "❌ --values is required."
  echo "Example: $0 --values '\"aud1\", \"aud2\"'"
  exit 1
fi

mkdir -p "$(dirname "${OUT_PATH}")"

cd "${ZKUP_DIR}"


cargo run --release --bin generate_hash -- aud --values "${VALUES}" --out "${OUT_PATH}"

echo "✅ aud hash generation complete: ${OUT_PATH}"
