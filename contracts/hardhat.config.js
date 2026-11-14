require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the solc 0.8.24 JS build from npm (same compiler, bundled in node_modules).
// This lets the project compile in environments that cannot reach binaries.soliditylang.org.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.24") {
    const compilerPath = require.resolve("solc/soljson.js");
    return {
      compilerPath,
      isSolcJs: true,
      version: "0.8.24",
      longVersion: require("solc").version().replace(".Emscripten.clang", ""),
    };
  }
  return runSuper();
});

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    hardhat: { chainId: Number(process.env.LOCAL_CHAIN_ID || 31337) },
    celoSepolia: {
      url: "https://forno.celo-sepolia.celo-testnet.org",
      chainId: 11142220,
      accounts,
    },
    celo: {
      url: "https://forno.celo.org",
      chainId: 42220,
      accounts,
    },
  },
  // Etherscan API V2: one etherscan.io key works for every supported chain.
  // A single string apiKey switches hardhat-verify to V2; it appends ?chainid=<id> to each request itself.
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.CELOSCAN_API_KEY || "",
    customChains: [
      {
        network: "celo",
        chainId: 42220,
        urls: { apiURL: "https://api.etherscan.io/v2/api", browserURL: "https://celoscan.io" },
      },
      {
        network: "celoSepolia",
        chainId: 11142220,
        urls: { apiURL: "https://api.etherscan.io/v2/api", browserURL: "https://sepolia.celoscan.io" },
      },
    ],
  },
};
