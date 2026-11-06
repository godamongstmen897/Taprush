"use client";

import { useCallback, useRef, useState } from "react";
import { Game } from "@/components/Game";
import { Board } from "@/components/Board";
import { Prizes } from "@/components/Prizes";
import { WalletChip } from "@/components/WalletButton";
import { countdown } from "@/lib/format";
import { useMiniPayAutoConnect } from "@/lib/wallet";
import { useNow, useWeek } from "@/lib/week";

type Tab = "play" | "board" | "prizes";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "play",
    label: "Play",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3.5" fill="currentColor" /></svg>,
  },
  {
    id: "board",
    label: "Board",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V11h4v9M10 20V5h4v15M16 20v-6h4v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>,
  },
  {
    id: "prizes",
    label: "Prizes",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0V4zM12 14v4M8 20h8M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>,
  },
];

function WeekClock() {
  const { w, end } = useWeek();
  const now = useNow();
  const left = end !== undefined ? Number(end) - now : undefined;
  return (
    <span className="when">
      Week {w + 1} · {left === undefined ? "…" : left > 0 ? <>ends in <b>{countdown(left)}</b></> : "ended"}
    </span>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("play");
  const [refreshKey, setRefreshKey] = useState(0);
  const onScored = useCallback(() => setRefreshKey((k) => k + 1), []);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useMiniPayAutoConnect();

  function onTabKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="app">
      <header className="top">
        <div>
          <div className="brand">TapRush</div>
          <WeekClock />
        </div>
        <WalletChip />
      </header>

      {/* All panels stay mounted; inactive ones are hidden so a round in progress is never reset. */}
      <main className="screens">
        <div id="panel-play" role="tabpanel" aria-labelledby="tab-play" className="screen" hidden={tab !== "play"}>
          <Game onScored={onScored} />
        </div>
        <div id="panel-board" role="tabpanel" aria-labelledby="tab-board" className="screen scroll" hidden={tab !== "board"}>
          <Board refreshKey={refreshKey} />
        </div>
        <div id="panel-prizes" role="tabpanel" aria-labelledby="tab-prizes" className="screen scroll" hidden={tab !== "prizes"}>
          <Prizes />
        </div>
      </main>

      <nav className="tabbar" role="tablist" aria-label="Sections">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[i] = el; }}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            className="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
