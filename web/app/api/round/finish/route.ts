import { NextResponse } from "next/server";
import {
  FALSE_START_PENALTY_MS,
  MAX_REACTION_MS,
  MIN_REACTION_MS,
  TARGETS,
} from "@/lib/config";
import { openSession, readRound, signScore } from "@/lib/server";

export const dynamic = "force-dynamic";
// Vercel function limit; this route makes one on-chain read and one signature, no retries.
export const maxDuration = 30;

const MAX_FALSE_STARTS = 5;
const MAX_ROUND_DURATION_MS = 120_000;
const CLOCK_SLACK_MS = 400;

export async function POST(req: Request) {
  let body: { token?: string; reactions?: unknown; falseStarts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const session = body.token ? openSession(body.token) : null;
  if (!session) return NextResponse.json({ error: "Session is invalid." }, { status: 400 });

  const reactions = body.reactions;
  const falseStarts = body.falseStarts;
  if (
    !Array.isArray(reactions) ||
    reactions.length !== TARGETS ||
    !reactions.every((r) => typeof r === "number" && Number.isFinite(r)) ||
    typeof falseStarts !== "number" ||
    !Number.isInteger(falseStarts) ||
    falseStarts < 0
  ) {
    return NextResponse.json({ error: "Malformed result." }, { status: 400 });
  }
  const rs = reactions as number[];

  if (rs.some((r) => r < MIN_REACTION_MS || r > MAX_REACTION_MS)) {
    return NextResponse.json({ error: "A reaction was outside the human range." }, { status: 422 });
  }
  if (falseStarts > MAX_FALSE_STARTS) {
    return NextResponse.json({ error: "Too many false starts." }, { status: 422 });
  }

  // The round cannot finish faster than the waits plus the reactions that were reported,
  // measured on OUR clock, and cannot take unreasonably long.
  const elapsed = Date.now() - session.startedAt;
  const physicalMin =
    session.delays.reduce((a, b) => a + b, 0) + rs.reduce((a, b) => a + b, 0);
  if (elapsed + CLOCK_SLACK_MS < physicalMin) {
    return NextResponse.json({ error: "Result did not match the round timing." }, { status: 422 });
  }
  if (elapsed > MAX_ROUND_DURATION_MS) {
    return NextResponse.json({ error: "Round timed out. Start a new round." }, { status: 410 });
  }

  const roundId = BigInt(session.roundId);
  const round = await readRound(roundId).catch(() => null);
  if (!round || round.player.toLowerCase() !== session.player.toLowerCase() || round.submitted) {
    return NextResponse.json({ error: "Round is no longer open." }, { status: 409 });
  }

  const mean = rs.reduce((a, b) => a + b, 0) / TARGETS;
  const score = Math.min(5000, Math.round(mean + falseStarts * FALSE_START_PENALTY_MS));
  const signature = await signScore(roundId, session.player, score);
  return NextResponse.json({ score, signature });
}
