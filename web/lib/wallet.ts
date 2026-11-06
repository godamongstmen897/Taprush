"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";

type InjectedFlags = { isMiniPay?: boolean };

export function detectMiniPay(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as unknown as { ethereum?: InjectedFlags }).ethereum?.isMiniPay;
}

export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Wallet environment and a connect action for the injected wallet (MetaMask, Valora, MiniPay, ...). */
export function useWallet() {
  const mounted = useMounted();
  const { connect, connectors, isPending, error } = useConnect();
  const miniPay = mounted && detectMiniPay();
  const hasWallet = mounted && "ethereum" in window;
  const connectInjected = () => connect({ connector: connectors[0] });
  return { mounted, miniPay, hasWallet, connectInjected, isPending, error };
}

/** Inside MiniPay, connect the injected wallet once on load. No message signature is requested. */
export function useMiniPayAutoConnect() {
  const { isConnected, status } = useAccount();
  const { connect, connectors } = useConnect();
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || isConnected || status === "connecting" || status === "reconnecting") return;
    if (!detectMiniPay() || !connectors[0]) return;
    tried.current = true;
    connect({ connector: connectors[0] });
  }, [isConnected, status, connect, connectors]);
}
