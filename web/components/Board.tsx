"use client";

import { useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { explorerAddr, GAME_ADDRESS } from "@/lib/config";
import { gameAbi } from "@/lib/abi";
import { gd, short } from "@/lib/format";
import { REFRESH, useWeek } from "@/lib/week";

const ZERO = "0x0000000000000000000000000000000000000000";

export function Board({ refreshKey }: { refreshKey: number }) {
  const { address } = useAccount();
  const { week, w } = useWeek();
  const q = { refetchInterval: REFRESH } as const;
  const on = week !== undefined;

  const { data: top, refetch: refetchTop } = useReadContract({
    address: GAME_ADDRESS, abi: gameAbi, functionName: "getTop", args: [w], query: { ...q, enabled: on },
  });
  const { data: pot } = useReadContract({
    address: GAME_ADDRESS, abi: gameAbi, functionName: "pot", args: [w], query: { ...q, enabled: on },
  });
  const { data: players } = useReadContract({ address: GAME_ADDRESS, abi: gameAbi, functionName: "uniquePlayers", query: q });
  const { data: rounds } = useReadContract({ address: GAME_ADDRESS, abi: gameAbi, functionName: "totalRounds", query: q });
  const { data: mine, refetch: refetchMine } = useReadContract({
    address: GAME_ADDRESS, abi: gameAbi, functionName: "bestScore", args: [w, address ?? ZERO],
    query: { ...q, enabled: on && !!address },
  });

  // refresh as soon as the player's own score lands (polling covers everyone else)
  useEffect(() => {
    if (refreshKey > 0) {
      void refetchTop();
      void refetchMine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const names = top?.[0] ?? [];
  const scores = top?.[1] ?? [];
  const isMe = (p: string) => !!address && p.toLowerCase() === address.toLowerCase();
  const myIdx = names.findIndex(isMe);
  const myBest = mine && mine > 0 ? mine : undefined;

  return (
    <>
      <dl className="strip">
        <div className="prize">
          <dt>Prize pool, week {w + 1}</dt>
          <dd>{gd(pot)} <small>G$</small></dd>
        </div>
        <div><dt>Players</dt><dd>{players?.toString() ?? "…"}</dd></div>
        <div><dt>Rounds played</dt><dd>{rounds?.toString() ?? "…"}</dd></div>
      </dl>

      <h2>Fastest this week</h2>
      <ol className="rows" aria-label="Top 10 this week">
        {names.length === 0 && <li className="empty">No scores yet. The first round sets the pace.</li>}
        {names.map((p, i) => (
          <li key={p} className={`${isMe(p) ? "me" : ""} ${i < 3 ? "podium" : ""}`}>
            <span className="rank">{i + 1}</span>
            <span className="who">
              <a className="addr" href={explorerAddr(p)} target="_blank" rel="noreferrer">{short(p)}</a>
              {isMe(p) && <span className="you">You</span>}
            </span>
            <span className="ms">{scores[i]}<small>ms</small></span>
          </li>
        ))}
      </ol>

      {myBest !== undefined && (
        <div className="mine" aria-label="Your best score this week">
          <span className="rank">{myIdx >= 0 ? myIdx + 1 : "–"}</span>
          <span className="who">You{myIdx < 0 && <small> · not in top 10</small>}</span>
          <span className="ms">{myBest}<small>ms</small></span>
        </div>
      )}
    </>
  );
}
