import { formatUnits } from "viem";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** G$ has 18 decimals. Show whole units with thousands separators. */
export function gd(v: bigint | undefined, maxFrac = 0): string {
  if (v === undefined) return "…";
  const n = Number(formatUnits(v, 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

export function countdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "ended";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied|rejected the request/i.test(msg)) return "You cancelled the wallet prompt.";
  if (/insufficient funds/i.test(msg)) return "Not enough balance for the network fee.";
  if (/transfer amount exceeds balance|exceeds balance/i.test(msg)) return "Not enough G$ for the entry fee.";
  return msg.split("\n")[0].slice(0, 180);
}
