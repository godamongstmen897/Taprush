"use client";

import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { GAME_ADDRESS } from "@/lib/config";
import { gameAbi } from "@/lib/abi";

export const REFRESH = 15_000;

/** Current week number and its end time. Shared by the header, Board and Prizes (wagmi de-duplicates the reads). */
export function useWeek() {
  const { data: week } = useReadContract({
    address: GAME_ADDRESS, abi: gameAbi, functionName: "currentWeek", query: { refetchInterval: REFRESH },
  });
  const w = week ?? 0;
  const { data: end } = useReadContract({
    address: GAME_ADDRESS, abi: gameAbi, functionName: "weekEnd", args: [w],
    query: { refetchInterval: REFRESH, enabled: week !== undefined },
  });
  return { week, w, end };
}

/** Unix seconds, re-rendered every `everyMs`. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
