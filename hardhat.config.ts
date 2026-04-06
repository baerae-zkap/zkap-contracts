import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "solidity-coverage";
import dotenv from "dotenv";
dotenv.config();

const optimizedCompilerSettings = {
  version: "0.8.28",
  settings: {
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: 1000000 },
    viaIR: true,
  },
};

const config: HardhatUserConfig & { solcover?: any } = {
  networks: {
    localnet: {
      chainId: 8216,
      url: "http://localhost:8545",
      gas: 10000000,
      accounts: [
        process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001",
        process.env.TEST_SIGNER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000002",
      ],
    },
    hardhat: {
      chainId: 8216,
      blockGasLimit: 50_000_000, // ZK verifier contracts require ~30M gas for deployment
      // Uses Hardhat's default 20 test accounts (each 10000 ETH)
    },
    kairos: {
      url: "https://public-en-kairos.node.kaia.io",
      chainId: 1001,
      gas: 10000000,
      accounts: [
        process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
    sepolia: {
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      gas: 10000000,
      accounts: [
        process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
    hoodi: {
      url: "https://ethereum-hoodi-rpc.publicnode.com",
      chainId: 560048,
      gas: 10000000,
      accounts: [
        process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      gas: 10000000,
      accounts: [
        process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
    arbitrumSepolia: {
      url: "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      gas: 10000000,
      accounts: [
        process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001",
      ],
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.8.34",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 1000000 },
          viaIR: true,
        },
      },
    ],
    overrides: {
      "@account-abstraction/contracts/core/EntryPoint.sol": optimizedCompilerSettings,
    },
  },
  mocha: {
    timeout: 10000,
    reporter: process.env.CI ? 'min' : 'spec',
  },
};

export default config;
