require("@nomicfoundation/hardhat-toolbox");
const path = require("path");

// Load .env from contracts directory or root directory if present
try {
  require("dotenv").config({ path: path.resolve(__dirname, ".env") });
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
} catch (e) {
  if (process.loadEnvFile) {
    try { process.loadEnvFile(path.resolve(__dirname, ".env")); } catch (_) {}
    try { process.loadEnvFile(path.resolve(__dirname, "../.env")); } catch (_) {}
  }
}

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`] : [],
      chainId: 11155111,
    },
  },
};

