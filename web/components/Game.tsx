"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, ContractFunctionRevertedError, parseAbi, parseEventLogs } from "viem";
import { chain, explorerTx, GAME_ADDRESS, GD_ADDRESS, isTestnet, TARGETS } from "@/lib/config";
import { erc20Abi, gameAbi } from "@/lib/abi";
import { friendlyError, gd } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

type Phase =
  | "idle"
  | "approving"
  | "paying"
  | "preparing"
  | "wait"
  | "go"
  | "between"
  | "scoring"
  | "submitting"
  | "done";

type Props = { onScored: () => void };

const BETWEEN_MS = 700;
const LOST_MSG =
  "Round lost: the app went to the background mid-round, so this round was cancelled. Its entry fee is spent.";

const BUSY_LABEL: Partial<Record<Phase, string>> = {
  approving: "Approve G$ in your wallet…",
  paying: "Confirm the entry fee…",
  preparing: "Getting your round ready…",
  scoring: "Checking your round…",
  submitting: "Confirm saving your score…",
};

// Errors startRound can revert with (TapRush + OpenZeppelin), so a simulation failure decodes to a name.
const startErrorsAbi = parseAbi([
  "error EnforcedPause()",
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address token)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
]);
const startRoundAbi = [...gameAbi, ...startErrorsAbi];

const REVERT_TEXT: Record<string, string> = {
  ERC20InsufficientAllowance: "The game is not approved to take the entry fee yet. Tap the button again to approve it.",
  ERC20InsufficientBalance: "Not enough G$ for the entry fee.",
  EnforcedPause: "The game is paused right now. Try again later.",
  SafeERC20FailedOperation: "The G$ token refused the entry-fee transfer.",
  ReentrancyGuardReentrantCall: "The game is busy. Try again in a moment.",
};

/** Name of the custom error inside a viem simulation error, if any. */
function revertName(e: unknown): string | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? r.reason ?? undefined : undefined;
}

// ---------------------------------------------------------------- paid round memory (survives a reload)
type PaidRound = { roundId: string; player: string; started: boolean };
const PAID_KEY = "taprush.paidRound";
const SAVED_MSG = "Your entry fee was paid and your round is saved. Tap “Resume round” to play it.";

function loadPaid(): PaidRound | null {
  try {
    const raw = sessionStorage.getItem(PAID_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PaidRound>;
    if (typeof p.roundId !== "string" || !/^\d{1,18}$/.test(p.roundId) || typeof p.player !== "string") return null;
    return { roundId: p.roundId, player: p.player, started: !!p.started };
  } catch {
    return null;
  }
}

function savePaid(p: PaidRound | null) {
  try {
    if (p) sessionStorage.setItem(PAID_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PAID_KEY);
  } catch {
    /* storage unavailable (private mode etc.): resume still works until reload */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Short haptic tick, only where the browser supports it. */
function buzz(ms: number) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

export function Game({ onScored }: Props) {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useWriteContract();
  const wallet = useWallet();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<number[]>([]);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [falseStarts, setFalseStarts] = useState(0);
  const [tooSoon, setTooSoon] = useState(false);
  const [result, setResult] = useState<{ score: number; tx: string } | null>(null);
  const [paid, setPaidState] = useState<PaidRound | null>(null);

  // mutable game state kept out of React state so taps are never stale
  const phaseRef = useRef<Phase>("idle");
  const delaysRef = useRef<number[]>([]);
  const idxRef = useRef(0);
  const goAtRef = useRef(0);
  const reactionsRef = useRef<number[]>([]);
  const falseRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef("");
  const roundIdRef = useRef<bigint>(0n);
  const pendingRef = useRef<{ score: number; signature: `0x${string}` } | null>(null);

  const setP = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => clearTimer(), []);

  const wrongChain = isConnected && chainId !== chain.id;

  const setPaid = (p: PaidRound | null) => {
    setPaidState(p);
    savePaid(p);
  };
  // A paid round whose play session never started, owned by the connected wallet: offer "Resume round".
  const resumable =
    paid && !paid.started && address && paid.player.toLowerCase() === address.toLowerCase() ? paid : null;

  const { data: fee } = useReadContract({ address: GAME_ADDRESS, abi: gameAbi, functionName: "entryFee" });
  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: GD_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  // Kept only for refetch; the pay flow reads the allowance fresh from the chain (see start()).
  const { refetch: refetchAllowance } = useReadContract({
    address: GD_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, GAME_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  const busy = ["approving", "paying", "preparing", "scoring", "submitting"].includes(phase);
  const playing = phase === "wait" || phase === "go" || phase === "between";

  const wait = useCallback(async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error("No network connection.");
    return publicClient.waitForTransactionReceipt({ hash });
  }, [publicClient]);

  /** Wait for a transaction and throw `failMsg` if it was mined but reverted. */
  const confirm = useCallback(async (hash: `0x${string}`, failMsg: string) => {
    const receipt = await wait(hash);
    if (receipt.status !== "success") throw new Error(failMsg);
    return receipt;
  }, [wait]);

  // ---------------------------------------------------------------- background = round lost
  const loseRound = useCallback(() => {
    clearTimer();
    tokenRef.current = "";
    setTooSoon(false);
    setError(LOST_MSG);
    setP("done");
  }, []);

  // ---------------------------------------------------------------- the five targets
  const armTarget = useCallback(() => {
    if (document.visibilityState === "hidden") {
      loseRound();
      return;
    }
    setP("wait");
    setLastMs(null);
    const delay = delaysRef.current[idxRef.current];
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      goAtRef.current = performance.now();
      setP("go");
    }, delay);
  }, [loseRound]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      const p = phaseRef.current;
      // Only while taps remain; once all five are in, the round is complete and gets scored.
      if ((p === "wait" || p === "go" || p === "between") && idxRef.current < TARGETS) loseRound();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loseRound]);

  const finishRound = useCallback(async () => {
    setP("scoring");
    try {
      const res = await fetch("/api/round/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: tokenRef.current,
          reactions: reactionsRef.current,
          falseStarts: falseRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The server rejected this round.");
      pendingRef.current = { score: data.score, signature: data.signature };
      await submitPending();
    } catch (e) {
      setError(`${friendlyError(e)} This round was paid for, so it cannot be replayed.`);
      setP("done");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScored, confirm, writeContractAsync]);

  /** Post the server-signed score on-chain. Safe to call again if the wallet step failed. */
  async function submitPending() {
    const pending = pendingRef.current;
    if (!pending) return;
    setError(null);
    setP("submitting");
    try {
      const hash = await writeContractAsync({
        address: GAME_ADDRESS,
        abi: gameAbi,
        functionName: "submitScore",
        args: [roundIdRef.current, pending.score, pending.signature],
        chainId: chain.id,
      });
      await confirm(hash, "Saving your score failed on-chain.");
      pendingRef.current = null;
      setPaid(null); // scored: forget the paid round
      setResult({ score: pending.score, tx: hash });
      setP("done");
      onScored();
    } catch (e) {
      setError(`${friendlyError(e)} Your score (${pending.score} ms) is signed and waiting: tap “Save score”.`);
      setP("done");
    }
  }

  const onTap = useCallback(() => {
    const p = phaseRef.current;
    if (p === "wait") {
      // false start: penalise and re-arm the same target
      clearTimer();
      falseRef.current += 1;
      setFalseStarts(falseRef.current);
      buzz(80);
      setTooSoon(true);
      setTimeout(() => setTooSoon(false), 700);
      armTarget();
      return;
    }
    if (p === "go") {
      const ms = Math.round(performance.now() - goAtRef.current);
      buzz(30);
      reactionsRef.current = [...reactionsRef.current, ms];
      setReactions(reactionsRef.current);
      setLastMs(ms);
      idxRef.current += 1;
      setP("between");
      timerRef.current = setTimeout(
        idxRef.current >= TARGETS ? () => void finishRound() : armTarget,
        BETWEEN_MS
      );
    }
  }, [armTarget, finishRound]);

  // ---------------------------------------------------------------- start a paid round (never charges)
  function resetRound() {
    setResult(null);
    pendingRef.current = null;
    setReactions([]);
    reactionsRef.current = [];
    falseRef.current = 0;
    setFalseStarts(0);
    setLastMs(null);
    idxRef.current = 0;
  }

  /** Ask the server for a play session. Retries a 404 (round not visible on its RPC node yet). */
  async function requestStart(roundId: string, player: string): Promise<{ delays: number[]; token: string }> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch("/api/round/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundId, player }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      if (res.status === 404 && attempt < 3) {
        await sleep(2000);
        continue;
      }
      const err = new Error(data.error ?? "Could not start the round.") as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
  }

  /** Start play for an already-paid round. On failure the round stays saved for "Resume round". */
  async function beginRound(p: PaidRound) {
    if (!address) return;
    resetRound();
    setError(null);
    roundIdRef.current = BigInt(p.roundId);
    setP("preparing");
    try {
      const data = await requestStart(p.roundId, address);
      delaysRef.current = data.delays;
      tokenRef.current = data.token;
      setPaid({ ...p, started: true });
      armTarget();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403 || status === 409) {
        // not this wallet's round, or already scored: nothing to resume
        setPaid(null);
        setError(friendlyError(e));
      }
      setP("idle");
    }
  }

  // After a reload, offer "Resume round" only if the saved round is on-chain, this wallet's, and unscored.
  useEffect(() => {
    if (!address || !publicClient) return;
    const saved = loadPaid();
    if (!saved || saved.started || saved.player.toLowerCase() !== address.toLowerCase()) return;
    let cancelled = false;
    publicClient
      .readContract({ address: GAME_ADDRESS, abi: gameAbi, functionName: "rounds", args: [BigInt(saved.roundId)] })
      .then(([player, , submitted]) => {
        if (cancelled) return;
        if (player.toLowerCase() === address.toLowerCase() && !submitted) setPaidState(saved);
        else if (submitted || !/^0x0{40}$/i.test(player)) savePaid(null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  // ---------------------------------------------------------------- pay, then play
  async function start() {
    if (!address || !fee) return;
    if (resumable) return beginRound(resumable); // never charge again for a round that is already paid
    setError(null);
    resetRound();
    try {
      if (!publicClient) throw new Error("No network connection.");

      // Fresh read every round: startRound spends the whole approval, so a cached value would be stale.
      const currentAllowance = await publicClient.readContract({
        address: GD_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, GAME_ADDRESS],
      });
      const justApproved = currentAllowance < fee;
      if (justApproved) {
        setP("approving");
        // Approve exactly the fee for this round, never an unlimited allowance.
        const approveHash = await writeContractAsync({
          address: GD_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [GAME_ADDRESS, fee],
          chainId: chain.id,
        });
        await confirm(approveHash, "The G$ approval failed on-chain. Nothing was charged.");
        void refetchAllowance();
      }

      setP("paying");
      // Dry-run first so a revert shows a readable reason instead of a failed fee estimate in the wallet.
      // Right after an approval the public RPC can lag a block, so retry an allowance error briefly.
      for (let attempt = 1; ; attempt++) {
        try {
          await publicClient.simulateContract({
            account: address,
            address: GAME_ADDRESS,
            abi: startRoundAbi,
            functionName: "startRound",
          });
          break;
        } catch (e) {
          const name = revertName(e);
          if (justApproved && name === "ERC20InsufficientAllowance" && attempt < 5) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          if (name) throw new Error(REVERT_TEXT[name] ?? `The game rejected this round (${name}). Nothing was charged.`);
          throw e;
        }
      }

      const payHash = await writeContractAsync({
        address: GAME_ADDRESS,
        abi: gameAbi,
        functionName: "startRound",
        chainId: chain.id,
      });
      const receipt = await confirm(payHash, "The entry-fee transaction failed on-chain. Nothing was recorded.");
      void refetchAllowance();
      const logs = parseEventLogs({ abi: gameAbi, eventName: "RoundStarted", logs: receipt.logs });
      const mine = logs.find((l) => l.args.player.toLowerCase() === address.toLowerCase());
      if (!mine) throw new Error("Payment confirmed but the round was not found.");
      roundIdRef.current = mine.args.roundId;
      refetchBalance();

      // The fee is paid: remember the round first, so a failed start can be resumed without paying again.
      const paidRound: PaidRound = { roundId: mine.args.roundId.toString(), player: address, started: false };
      setPaid(paidRound);
      await beginRound(paidRound);
    } catch (e) {
      setError(friendlyError(e));
      setP("idle");
    }
  }

  async function faucet() {
    setError(null);
    try {
      const h = await writeContractAsync({ address: GD_ADDRESS, abi: erc20Abi, functionName: "faucet", chainId: chain.id });
      await confirm(h, "The test G$ request failed on-chain.");
      refetchBalance();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const enough = balance !== undefined && fee !== undefined && balance >= fee;
  const avg = reactions.length ? Math.round(reactions.reduce((a, b) => a + b, 0) / reactions.length) : null;
  const ready = isConnected && !wrongChain;

  // ---------------------------------------------------------------- pad copy
  let big: React.ReactNode = "";
  let sub = "";
  if (phase === "idle" && resumable) {
    big = "Ready";
    sub = "Your round is paid. Tap “Resume round” to play it.";
  } else if (phase === "idle" && !result) {
    big = "Tap";
    sub = "Pay the entry fee, then tap when the pad turns green.";
  } else if (phase === "approving") {
    big = "…";
    sub = "Approve the G$ entry fee in your wallet.";
  } else if (phase === "paying") {
    big = "…";
    sub = "Confirm the entry fee in your wallet.";
  } else if (phase === "preparing") {
    big = "…";
    sub = "Getting your round ready.";
  } else if (phase === "wait") {
    big = tooSoon ? "Too soon" : "Wait";
    sub = tooSoon ? `+50 ms penalty. ${falseStarts} so far.` : "Tap only when it turns green.";
  } else if (phase === "go") {
    big = "TAP";
    sub = "";
  } else if (phase === "between") {
    big = lastMs ?? "";
    sub = lastMs !== null ? "ms" : "";
  } else if (phase === "scoring" || phase === "submitting") {
    big = "…";
    sub = phase === "scoring" ? "Checking your round." : "Confirm saving your score in your wallet.";
  } else if (phase === "done") {
    big = result ? result.score : "–";
    sub = result ? "ms average. Saved on-chain." : "Score not saved.";
  }

  const padClass = phase === "wait" ? "pad wait" : phase === "go" ? "pad go" : "pad";

  // ---------------------------------------------------------------- one line of status above the main button
  let status: React.ReactNode = null;
  let tone: "err" | "ok" | "" = "";
  if (error) {
    status = error;
    tone = "err";
  } else if (resumable && ready && !busy && !playing) {
    status = SAVED_MSG;
  } else if (!isConnected && wallet.error) {
    status = wallet.error.message.split("\n")[0];
    tone = "err";
  } else if (result && phase === "done") {
    status = (
      <>
        Score {result.score} ms saved on-chain.{" "}
        <a href={explorerTx(result.tx)} target="_blank" rel="noreferrer">View transaction</a>
      </>
    );
    tone = "ok";
  } else if (ready && balance !== undefined && fee !== undefined && !enough && !playing && !busy) {
    status = `You need ${gd(fee)} G$ to play. ${
      isTestnet ? "Tap “Get test G$”." : "Claim your daily G$ at goodwallet.xyz or buy some on Ubeswap."
    }`;
    tone = "err";
  } else if (playing && avg !== null) {
    status = `Average so far: ${avg} ms`;
  } else if (wallet.mounted && !isConnected && !wallet.hasWallet) {
    status = "No wallet found. Open this page in MiniPay, Valora, or a browser with MetaMask.";
  } else {
    status = "Lower is better. Each false start adds 50 ms.";
  }

  // ---------------------------------------------------------------- the single thumb-zone action
  let label: string;
  let action: (() => void) | undefined;
  let actionDisabled = false;
  if (!wallet.mounted) {
    label = "Connect wallet";
    actionDisabled = true;
  } else if (!isConnected) {
    if (wallet.miniPay) {
      label = "Connecting to MiniPay…";
      actionDisabled = true;
    } else {
      label = wallet.isPending ? "Connecting…" : "Connect wallet";
      action = wallet.connectInjected;
      actionDisabled = wallet.isPending || !wallet.hasWallet;
    }
  } else if (wrongChain) {
    label = `Switch to ${chain.name}`;
    action = () => switchChain({ chainId: chain.id });
  } else if (busy) {
    label = BUSY_LABEL[phase] ?? "…";
    actionDisabled = true;
  } else if (playing) {
    label = "Round in progress";
    actionDisabled = true;
  } else if (pendingRef.current) {
    label = "Save score";
    action = submitPending;
  } else if (resumable) {
    // Already paid: the retry must never be "Pay … and play".
    label = "Resume round";
    action = () => void beginRound(resumable);
  } else if (phase === "done" || result) {
    label = "Play again";
    action = start;
    actionDisabled = !fee || !enough;
  } else {
    label = `Pay ${fee ? gd(fee) : "…"} G$ and play`;
    action = start;
    actionDisabled = !fee || !enough;
  }

  return (
    <section className="play" aria-label="Game">
      <button
        type="button"
        className={padClass}
        onPointerDown={playing ? onTap : undefined}
        onKeyDown={(e) => {
          if (playing && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            onTap();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-live="polite"
        aria-label={playing ? "Reaction pad. Tap when it turns green." : "Reaction pad"}
        disabled={!playing && phase !== "done" && phase !== "idle"}
      >
        <span className="big">{big}</span>
        {sub && <span className="sub">{sub}</span>}
        {(playing || phase === "done") && (
          <span className="dots" aria-label={`${reactions.length} of ${TARGETS} taps done`}>
            {Array.from({ length: TARGETS }).map((_, i) => (
              <i key={i} className={i < reactions.length ? "on" : ""} />
            ))}
          </span>
        )}
      </button>

      <div className="dock">
        <div className="meta">
          {ready && (
            <span>
              Balance <b>{gd(balance)}</b> G$
            </span>
          )}
          <span>
            Entry <b>{fee !== undefined ? gd(fee) : "…"}</b> G$
          </span>
          <span className="spacer" />
          {ready && pendingRef.current && !busy && !playing && (
            <button className="btn small" onClick={start} disabled={!fee || !enough}>New round</button>
          )}
          {ready && isTestnet && (
            <button className="btn small" onClick={faucet} disabled={busy || playing}>Get test G$</button>
          )}
        </div>

        <p className={`status ${tone}`} role={tone === "err" ? "alert" : "status"}>{status}</p>

        <button className="btn solid main" onClick={action} disabled={actionDisabled}>
          {label}
        </button>
      </div>
    </section>
  );
}
