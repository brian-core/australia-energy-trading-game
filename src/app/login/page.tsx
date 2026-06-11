"use client";

// Dedicated sign-up / sign-in page. Passwordless: enter an email, get a magic
// link, land back here signed in. Degrades gracefully when Supabase isn't
// configured (guest play is always available).

import Link from "next/link";
import { useState } from "react";
import { cloudEnabled, signInWithEmail, signOut, useSession } from "@/lib/cloud";

export default function LoginPage() {
  const session = useSession();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main
      className="flex min-h-dvh items-center justify-center px-6"
      style={{ background: "var(--bg)", color: "var(--ink)" }}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-6"
        style={{ background: "var(--panel)", borderColor: "var(--edge)" }}
      >
        <Link
          href="/"
          className="font-[family-name:var(--f-mono)] text-[10px] tracking-widest text-[var(--ink-soft)]"
        >
          ← ENERGY PLANET
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Sign up / sign in</h1>

        {!cloudEnabled() ? (
          <div className="mt-3 space-y-3 text-sm text-[var(--ink-soft)]">
            <p>
              Accounts aren&apos;t switched on for this deployment yet, but the game is fully
              playable as a guest — progress saves in your browser.
            </p>
            <Link
              href="/play"
              className="inline-block rounded-lg px-4 py-2 font-[family-name:var(--f-mono)] text-xs tracking-widest"
              style={{ background: "var(--gen)", color: "#0b0d11" }}
            >
              ▶ PLAY AS GUEST
            </Link>
          </div>
        ) : session ? (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-[var(--ink-soft)]">
              Signed in as <span className="text-[var(--ink)]">{session.user.email}</span>. Cloud
              saves and the leaderboard are on.
            </p>
            <div className="flex gap-2">
              <Link
                href="/play"
                className="rounded-lg px-4 py-2 font-[family-name:var(--f-mono)] text-xs tracking-widest"
                style={{ background: "var(--gen)", color: "#0b0d11" }}
              >
                ▶ CONTINUE TO GAME
              </Link>
              <button
                onClick={() => void signOut()}
                className="rounded-lg border px-4 py-2 font-[family-name:var(--f-mono)] text-xs tracking-widest text-[var(--ink-soft)]"
                style={{ borderColor: "var(--edge)" }}
              >
                SIGN OUT
              </button>
            </div>
          </div>
        ) : sent ? (
          <div className="mt-3 space-y-2 text-sm text-[var(--ink-soft)]">
            <p>
              Check <span className="text-[var(--ink)]">{email}</span> — we sent you a sign-in
              link. Click it and you&apos;ll land back here, signed in.
            </p>
            <button onClick={() => setSent(false)} className="text-xs underline">
              use a different email
            </button>
          </div>
        ) : (
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void signInWithEmail(email).then((err) => {
                if (err) setError(err);
                else {
                  setError(null);
                  setSent(true);
                }
              });
            }}
          >
            <p className="text-sm text-[var(--ink-soft)]">
              No password — we email you a magic link. An account gets you cloud saves across
              devices and a place on the leaderboard.
            </p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full rounded-lg border bg-black/30 px-3 py-2 text-sm"
              style={{ borderColor: "var(--edge)" }}
            />
            {error && <p className="text-xs text-[#e2483d]">{error}</p>}
            <button
              type="submit"
              className="w-full rounded-lg px-4 py-2 font-[family-name:var(--f-mono)] text-xs tracking-widest"
              style={{ background: "var(--gen)", color: "#0b0d11" }}
            >
              EMAIL ME A SIGN-IN LINK
            </button>
            <p className="text-center text-xs text-[var(--ink-soft)]">
              or{" "}
              <Link href="/play" className="underline">
                play as a guest
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
