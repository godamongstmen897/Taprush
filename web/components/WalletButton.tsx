"use client";

import { useAccount, useDisconnect } from "wagmi";
import { short } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

/** Compact wallet chip for the header. Inside MiniPay it is display-only (no connect or disconnect). */
export function WalletChip() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { mounted, miniPay, hasWallet, connectInjected, isPending } = useWallet();

  if (!mounted) return <span className="chip ghost" aria-hidden="true" />;

  if (isConnected && address) {
    const inner = (
      <>
        <i className="live" aria-hidden="true" />
        <span className="addr">{short(address)}</span>
      </>
    );
    if (miniPay) return <span className="chip" title={address}>{inner}</span>;
    return (
      <button className="chip" onClick={() => disconnect()} aria-label={`Wallet ${short(address)}. Tap to disconnect.`}>
        {inner}
      </button>
    );
  }

  if (miniPay) return <span className="chip">Connecting…</span>;

  return (
    <button className="chip solid" disabled={isPending || !hasWallet} onClick={connectInjected}>
      {isPending ? "Connecting…" : "Connect"}
    </button>
  );
}
