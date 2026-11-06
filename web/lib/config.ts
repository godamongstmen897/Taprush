import { defineChain, type Address } from "viem";
import { celo } from "viem/chains";

export const celoSepolia = defineChain({
  id: 11142220,
  name: "Celo Sepolia",
  nativeCurrency: { name: "Celo", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo-sepolia.celo-testnet.org"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://celo-sepolia.blockscout.com" } },
  testnet: true,
});

const which = process.env.NEXT_PUBLIC_CHAIN === "celo" ? "celo" : "celoSepolia";

export const chain = which === "celo" ? celo : celoSepolia;

// Optional dedicated RPC (recommended in production; public Forno endpoints are rate limited).
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || undefined;
export const isTestnet = which !== "celo";

export const GAME_ADDRESS = (process.env.NEXT_PUBLIC_GAME_ADDRESS ?? "0x0000000000000000000000000000000000000000") as Address;
export const GD_ADDRESS = (process.env.NEXT_PUBLIC_GD_ADDRESS ?? "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A") as Address;

export const explorerTx = (hash: string) => `${chain.blockExplorers?.default.url}/tx/${hash}`;
export const explorerAddr = (a: string) => `${chain.blockExplorers?.default.url}/address/${a}`;

// Game rules shared by client and server.
export const TARGETS = 5;
export const MIN_REACTION_MS = 100;
export const MAX_REACTION_MS = 2000;
export const FALSE_START_PENALTY_MS = 50;
