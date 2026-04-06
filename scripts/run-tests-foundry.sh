#!/bin/bash
# Run Foundry fuzz and invariant tests
set -e

echo "=========================================="
echo "Running Foundry fuzz/invariant tests"
echo "=========================================="

# Check prerequisites
if ! command -v forge &> /dev/null; then
  echo "ERROR: forge not found"
  echo "Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 1
fi

forge test --summary

echo ""
echo "=========================================="
echo "Foundry tests passed!"
echo "=========================================="
