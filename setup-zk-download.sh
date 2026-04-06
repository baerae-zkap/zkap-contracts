#!/bin/bash
set -eo pipefail

# ==============================================================================
# setup-zk-download.sh
# Downloads CRS/NAPI binaries from Google Drive and places them in zk-assets/.
#
# Usage:
#   bash setup-zk-download.sh          # download all
#   bash setup-zk-download.sh n3k3     # download a specific configuration only
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZK_ASSETS_DIR="${SCRIPT_DIR}/zk-assets"

# Google Drive file IDs (extracted from share links)
get_file_id() {
  case "$1" in
    n1k1) echo "1c8UhhmK4vZSjmrLbp3-Li-B1-OlioMQx" ;;
    n3k3) echo "1hprGf5lN_8tXwVJXoUVNULEcRN_s0UHt" ;;
    n6k3) echo "1GBM83_s0mR__V_5hkW4EkUz7mSB2Jjqb" ;;
    *) echo "" ;;
  esac
}

# Groth16Verifier target filename
get_verifier_name() {
  case "$1" in
    n1k1) echo "Groth16VerifierN1K1.sol" ;;
    n3k3) echo "Groth16VerifierN3K3.sol" ;;
    n6k3) echo "Groth16Verifier.sol" ;;
  esac
}

ALL_CONFIGS="n1k1 n3k3 n6k3"

# Google Drive large file download function
download_from_gdrive() {
  local file_id="$1"
  local output="$2"

  echo "   Downloading: ${output}..."

  # Bypass virus scan warning with confirm=t for direct download
  curl -L -o "${output}" \
    "https://drive.usercontent.google.com/download?id=${file_id}&export=download&confirm=t"
}

# Download and extract a specific configuration
download_config() {
  local config="$1"
  local file_id
  file_id=$(get_file_id "$config")

  if [ -z "${file_id}" ]; then
    echo "❌ Unknown configuration: ${config} (available: ${ALL_CONFIGS})"
    return 1
  fi

  local tar_file="${ZK_ASSETS_DIR}/${config}.tar.gz"

  # Skip if already exists
  if [ -d "${ZK_ASSETS_DIR}/${config}" ]; then
    echo "⏭️  ${config}: already exists. (re-download: rm -rf zk-assets/${config})"
    return 0
  fi

  mkdir -p "${ZK_ASSETS_DIR}"
  download_from_gdrive "${file_id}" "${tar_file}"

  echo "   Extracting: ${config}..."
  tar xzf "${tar_file}" -C "${ZK_ASSETS_DIR}/"
  rm -f "${tar_file}"

  # Copy Groth16Verifier.sol to contracts/Utils/
  local verifier_src="${ZK_ASSETS_DIR}/${config}/Groth16Verifier.sol"
  if [ -f "${verifier_src}" ]; then
    local contracts_dir="${SCRIPT_DIR}/contracts/Utils"
    mkdir -p "${contracts_dir}"
    local dest_name
    dest_name=$(get_verifier_name "$config")
    cp "${verifier_src}" "${contracts_dir}/${dest_name}"
    echo "   [COPY] Groth16Verifier.sol → contracts/Utils/${dest_name}"
  fi

  echo "✅ ${config} download complete"
}

# ==============================================================================
# Execution
# ==============================================================================

echo ""
echo "🔽 Starting ZK Assets download..."
echo ""

if [ $# -gt 0 ]; then
  for config in "$@"; do
    download_config "$config"
  done
else
  for config in ${ALL_CONFIGS}; do
    download_config "$config"
  done
fi

echo ""
echo "=================================================="
echo "🎉 Download complete!"
echo "=================================================="
