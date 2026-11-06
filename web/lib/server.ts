import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, GAME_ADDRESS, RPC_URL } from "./config";
import { gameAbi } from "./abi";

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET missing or too short");
  return s;
}

export type Session = {
  roundId: string; // decimal string (bigint is not JSON-safe)
  player: Address;
  delays: number[]; // ms before each GO signal
  startedAt: number; // server clock, ms
};

const b64 = (b: Buffer) => b.toString("base64url");

/** Stateless signed session so the server needs no database. */
export function sealSession(s: Session): string {
  const body = b64(Buffer.from(JSON.stringify(s)));
  const mac = b64(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${mac}`;
}

export function openSession(token: string): Session | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
  } catch {
    return null;
  }
}

/** Read the on-chain round so we only ever sign for a real, paid, unscored round. */
export async function readRound(roundId: bigint) {
  const [player, week, submitted] = await publicClient.readContract({
    address: GAME_ADDRESS,
    abi: gameAbi,
    functionName: "rounds",
    args: [roundId],
  });
  return { player: player as Address, week, submitted };
}

/** Signature matches TapRush.submitScore's digest exactly. */
export async function signScore(roundId: bigint, player: Address, score: number): Promise<Hex> {
  const pk = process.env.VERIFIER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("VERIFIER_PRIVATE_KEY missing");
  const account = privateKeyToAccount(pk);
  const inner = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint32" },
      ],
      [BigInt(chain.id), GAME_ADDRESS, roundId, player, score]
    )
  );
  return account.signMessage({ message: { raw: inner } });
}
