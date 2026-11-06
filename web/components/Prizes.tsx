"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { chain, explorerAddr, GAME_ADDRESS, GD_ADDRESS, isTestnet } from "@/lib/config";
import { gameAbi } from "@/lib/abi";
import { friendlyError, gd, short } from "@/lib/format";
import { REFRESH, useWeek } from "@/lib/week";

const ZERO = "0x0000000000000000000000000000000000000000";
const SHARES = ["50%", "30%", "20%"];

export function Prizes() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { w } = useWeek();
  const prev = w > 0 ? w - 1 : undefined;
  const q = { refetchInterval: REFRESH } as const;

  const { data: fee } = useReadContract({ address: GAME_ADDRESS, abi: gameAbi, functionName: "entryFee" });
  // last week: finalize (anyone) then claim (winners)
  const { data: prevFinal, refetch: refetchPrevFinal } = useReadContract({
    address: GAME_ADDRESS, abi: gameAbi, functionName: "finalized", args: [prev ?? 0], query: { ...q, enabled: prev !== undefined },
  });
  const { data: prize, refetch: refetchPrize } = useReadContract({
    address: GAME_ADDRESS, abi: gameAbi, functionName: "prizeOf", args: [prev ?? 0, address ?? ZERO],
    query: { ...q, enabled: prev !== undefined && !!address },
  });
  const { data: prevTop } = useReadContract({
    address: GAME_ADDRESS, abi: gameAbi, functionName: "getTop", args: [prev ?? 0], query: { ...q, enabled: prev !== undefined },
  });

  async function send(fn: "finalizeWeek" | "claimPrize") {
    if (prev === undefined || !publicClient) return;
    setBusy(true);
    setMsg(null);
    try {
      const hash = await writeContractAsync({ address: GAME_ADDRESS, abi: gameAbi, functionName: fn, args: [prev], chainId: chain.id });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(
          fn === "claimPrize" ? "Claiming the prize failed on-chain. Nothing was sent." : "Closing last week failed on-chain."
        );
      }
      await Promise.all([refetchPrevFinal(), refetchPrize()]);
      setMsg(fn === "claimPrize" ? "Prize sent to your wallet." : "Last week is closed. Winners can claim now.");
    } catch (e) {
      setMsg(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const winners = (prevTop?.[0] ?? []).slice(0, 3);
  const winnerScores = prevTop?.[1] ?? [];

  return (
    <>
      <h2>Last week</h2>
      {prev === undefined ? (
        <p className="note">This is the first week. Prizes open when it ends.</p>
      ) : winners.length === 0 ? (
        <p className="note">Nobody scored last week.</p>
      ) : (
        <>
          <ol className="rows" aria-label="Last week's winners">
            {winners.map((p, i) => (
              <li key={p} className={`podium ${address && p.toLowerCase() === address.toLowerCase() ? "me" : ""}`}>
                <span className="rank">{i + 1}</span>
                <span className="who">
                  <a className="addr" href={explorerAddr(p)} target="_blank" rel="noreferrer">{short(p)}</a>
                  <small> · {SHARES[i]} of pool</small>
                </span>
                <span className="ms">{winnerScores[i]}<small>ms</small></span>
              </li>
            ))}
          </ol>
          <div className="claim">
            {!prevFinal ? (
              <>
                <p className="note">The week is over. Anyone can close it so winners can claim.</p>
                <button className="btn solid main" disabled={busy} onClick={() => send("finalizeWeek")}>
                  {busy ? "Confirm in your wallet…" : "Close last week"}
                </button>
              </>
            ) : prize && prize > 0n ? (
              <>
                <p className="won">You won <b>{gd(prize, 2)}</b> G$</p>
                <button className="btn solid main" disabled={busy} onClick={() => send("claimPrize")}>
                  {busy ? "Confirm in your wallet…" : "Claim prize"}
                </button>
              </>
            ) : (
              <p className="note">Closed. Winners can claim their prize here.</p>
            )}
            {msg && <p className="note" role="status">{msg}</p>}
          </div>
        </>
      )}

      <h2>How it works</h2>
      <p className="lead">
        Each round costs {fee !== undefined ? `${gd(fee)} G$` : "a small G$ fee"}: 95% goes into this week&apos;s prize
        pool and 5% keeps the game running. Tap the pad five times, each time it turns green; your average reaction time
        is your score, a false start adds 50 ms, and your best score of the week counts. When the week ends, the three
        fastest players split the pool 50 / 30 / 20 and claim it here, and any unclaimed share rolls into next week.
      </p>

      <p className="foot">
        Game <a href={explorerAddr(GAME_ADDRESS)} target="_blank" rel="noreferrer">{short(GAME_ADDRESS)}</a>
        {" · "}G$ <a href={explorerAddr(GD_ADDRESS)} target="_blank" rel="noreferrer">{short(GD_ADDRESS)}</a>
        {isTestnet && " · test network with a mock G$ token"}
      </p>
    </>
  );
}
