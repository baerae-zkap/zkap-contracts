#!/bin/bash
set -euo pipefail

# ==============================================================================
# Filename: generate-hash-leaf.sh
# Purpose:
#   - Execute the "leaf" feature of zkup/circuit/src/bin/generate_hash.rs
#   - Source zk-config.sh to use the same ZkapConfig as setup-zk-build.sh
#
# Usage:
#   ./generate-hash-leaf.sh --iss "\"iss1\", \"iss2\"" --pk "pk1, pk2"
#   ./generate-hash-leaf.sh --iss "\"iss1\", \"iss2\"" --pk "pk1, pk2" --out "./zk-assets/crs/leaf_output.json"
#
# Example:
#   ./generate-hash-leaf.sh \
#     --iss "\"https://accounts.google.com\", \"https://kauth.kakao.com\"" \
#     --pk "...., ...."
#
# Note:
#   - --iss is a string including quotes, so wrap the entire value in double quotes.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/zk-config.sh"

ZKUP_DIR="${SCRIPT_DIR}/../zkup"
if [ ! -d "${ZKUP_DIR}" ]; then
  echo "❌ zkup directory not found: ${ZKUP_DIR}"
  exit 1
fi

# Default output
OUT_PATH_DEFAULT="${SCRIPT_DIR}/zk-assets/crs/leaf_output.json"

ISS=""
PK=""
OUT_PATH="${OUT_PATH_DEFAULT}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --iss)
      ISS="${2:-}"
      shift 2
      ;;
    --pk)
      PK="${2:-}"
      shift 2
      ;;
    --out)
      OUT_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --iss '\"iss1\", \"iss2\"' --pk 'pk1, pk2' [--out out.json]"
      exit 0
      ;;
    *)
      echo "❌ Unknown argument: $1"
      echo "Usage: $0 --iss '\"iss1\", \"iss2\"' --pk 'pk1, pk2' [--out out.json]"
      exit 1
      ;;
  esac
done

if [ -z "${ISS}" ]; then
  echo "❌ --iss is required."
  echo "Example: $0 --iss '\"iss1\", \"iss2\"' --pk 'pk1, pk2'"
  exit 1
fi

if [ -z "${PK}" ]; then
  echo "❌ --pk is required."
  echo "Example: $0 --iss '\"iss1\", \"iss2\"' --pk 'pk1, pk2'"
  exit 1
fi

mkdir -p "$(dirname "${OUT_PATH}")"

cd "${ZKUP_DIR}"

cargo run --release --bin generate_hash -- leaf --iss "${ISS}" --pk "${PK}" --out "${OUT_PATH}"

echo "✅ leaf generation complete: ${OUT_PATH}"
