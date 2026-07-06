"use client";

// Sign-up / cloud-save / leaderboard card for the OPS panel. Renders nothing
// when Supabase isn't configured — the game then plays with local saves only.

import { useEffect, useState } from "react";
import {
  cloudEnabled,
  fetchLeaderboard,
  pushLeaderboard,
  signInWithEmail,
  signOut,
  useSession,
  type LeaderboardRow,
} from "@/lib/cloud";
import { companyValue } from "@/lib/energy/game";
import type { GameApi } from "./use-game";

const HANDLE_KEY = "au-energy-handle";

function moneyShort(x: number): string {
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}b`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(0)}m`;
  return `$${Math.round(x / 1e3)}k`;
}

export default function AccountCard({ game }: { game: GameApi }) {
  const session = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [handle, setHandle] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem(HANDLE_KEY) ?? ""),
  );
  const [board, setBoard] = useState<LeaderboardRow[]>([]);

  // Publish score + refresh the board once a minute while signed in.
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const name = window.localStorage.getItem(HANDLE_KEY) ?? "anon";
      void pushLeaderboard(name, companyValue(game.state)).then(() =>
        fetchLeaderboard().then(setBoard),
      );
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!cloudEnabled()) return null;

  return (
    <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
      <div className="mb-1.5 text-[11px] tracking-widest text-[var(--ink-soft)]">
        ACCOUNT — CLOUD SAVE & LEADERBOARD
      </div>
      {!session ? (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="flex-1 rounded border bg-black/30 px-1.5 py-1 text-xs"
              style={{ borderColor: "var(--edge)" }}
            />
            <button
              onClick={() => {
                void signInWithEmail(email).then((err) =>
                  setStatus(err ?? "Check your email for the sign-in link."),
                );
              }}
              disabled={!email.includes("@")}
              className="rounded px-2 py-1 text-[11px] tracking-widest disabled:opacity-30"
              style={{ background: "var(--gen)", color: "#0b0d11" }}
            >
              SIGN UP
            </button>
          </div>
          {status && <div className="text-[11px] text-[var(--ink-soft)]">{status}</div>}
          <div className="text-[10px] leading-snug text-[var(--ink-soft)]">
            No password — we email you a magic link. Without an account your game saves in this
            browser only.
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[var(--ink-soft)]">
            <span className="truncate">{session.user.email} · saving to cloud ✓</span>
            <button onClick={() => void signOut()} className="hover:text-[#e2483d]">
              SIGN OUT
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[var(--ink-soft)]">leaderboard name</span>
            <input
              value={handle}
              maxLength={24}
              onChange={(e) => {
                setHandle(e.target.value);
                window.localStorage.setItem(HANDLE_KEY, e.target.value);
              }}
              className="flex-1 rounded border bg-black/30 px-1.5 py-0.5"
              style={{ borderColor: "var(--edge)" }}
            />
          </div>
          {board.length > 0 && (
            <div className="space-y-0.5 border-t pt-1.5" style={{ borderColor: "var(--edge)" }}>
              {board.map((row, i) => (
                <div
                  key={row.user_id}
                  className="flex justify-between text-[11px]"
                  style={{
                    color: row.user_id === session.user.id ? "var(--gen)" : "var(--ink-soft)",
                  }}
                >
                  <span className="truncate">
                    {i + 1}. {row.handle}
                  </span>
                  <span>{moneyShort(row.company_value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
