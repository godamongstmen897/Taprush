import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { TARGETS } from "@/lib/config";
import { readRound, sealSession } from "@/lib/server";

export const dynamic = "force-dynamic";
// Vercel function limit. The retry below is capped well under this (see RETRY_BUDGET_MS).
export const maxDuration = 30;

const READ_TIMEOUT_MS = 4_000; // per on-chain read
const RETRY_BUDGET_MS = 18_000; // stop retrying after this; worst case ~18 s + one read < 30 s

function readWithTimeout(roundId: bigint) {
  return Promise.race([
    readRound(roundId),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
  ]).catch(() => null);
}

export async function POST(req: Request) {
  let body: { roundId?: string; player?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.roundId || !/^\d{1,18}$/.test(body.roundId) || !body.player || !isAddress(body.player)) {
    return NextResponse.json({ error: "roundId and player are required." }, { status: 400 });
  }

  const roundId = BigInt(body.roundId);
  // Public RPC nodes can lag a block behind the wallet's node, so a just-paid round may not be visible yet.
  // Read up to 6 times, 1.5 s apart, before giving up (bounded by RETRY_BUDGET_MS).
  const deadline = Date.now() + RETRY_BUDGET_MS;
  let round: Awaited<ReturnType<typeof readRound>> | null = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = await readWithTimeout(roundId);
    if (r && r.player.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
      round = r;
      break;
    }
    if (attempt === 6 || Date.now() + 1500 >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!round) {
    return NextResponse.json({ error: "Round not found on-chain yet. Wait a moment and retry." }, { status: 404 });
  }
  if (round.player.toLowerCase() !== body.player.toLowerCase()) {
    return NextResponse.json({ error: "This round belongs to another wallet." }, { status: 403 });
  }
  if (round.submitted) {
    return NextResponse.json({ error: "This round already has a score." }, { status: 409 });
  }

  // 1.2s to 3.5s before each GO, drawn from a CSPRNG.
  const delays = Array.from({ length: TARGETS }, () => randomInt(1200, 3500));
  const token = sealSession({
    roundId: roundId.toString(),
    player: round.player as Address,
    delays,
    startedAt: Date.now(),
  });
  return NextResponse.json({ delays, token });
}
