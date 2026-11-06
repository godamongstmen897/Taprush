import { parseAbi } from "viem";

export const gameAbi = parseAbi([
  "function entryFee() view returns (uint256)",
  "function currentWeek() view returns (uint32)",
  "function weekEnd(uint32 week) view returns (uint256)",
  "function pot(uint32) view returns (uint256)",
  "function getTop(uint32 week) view returns (address[] players, uint32[] scores)",
  "function rounds(uint256) view returns (address player, uint32 week, bool submitted)",
  "function finalized(uint32) view returns (bool)",
  "function prizeOf(uint32 week, address player) view returns (uint256)",
  "function bestScore(uint32, address) view returns (uint32)",
  "function uniquePlayers() view returns (uint256)",
  "function totalRounds() view returns (uint256)",
  "function totalGdSpent() view returns (uint256)",
  "function startRound() returns (uint256)",
  "function submitScore(uint256 roundId, uint32 score, bytes signature)",
  "function finalizeWeek(uint32 week)",
  "function claimPrize(uint32 week)",
  "event RoundStarted(uint256 indexed roundId, address indexed player, uint32 indexed week)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function faucet()",
]);
