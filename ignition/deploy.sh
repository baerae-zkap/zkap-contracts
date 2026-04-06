#!/bin/bash
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

cd $SCRIPT_DIR/../

rm -rf ./ignition/deployments/chain-*
npx hardhat ignition deploy --network localnet ./ignition/modules/zkap.ts