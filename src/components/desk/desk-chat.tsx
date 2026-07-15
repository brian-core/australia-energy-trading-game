"use client";

import { useEffect, useRef, useState } from "react";

// AI desk analyst chat: a floating drawer over the desk. Each question ships
// with a fresh snapshot of what the desk is currently showing (built by the
// parent), so the analyst comments on the numbers actually on screen. The
// reply streams token-by-token from /api/desk/chat.

const ACCENT = "#4d8dff";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "What's going on in the market right now?",
  "How is my book positioned — where am I exposed?",
  "Explain the stress test number.",
  "Which of my open trades are working?",
];

export default function DeskChat({ snapshot }: { snapshot: () => unknown }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setDraft("");
    setBusy(true);
    const history = [...msgs, { role: "user" as const, content: q }];
    setMsgs([...history, { role: "assistant", content: "" }]);

    const append = (chunk: string) =>
      setMsgs((m) => {
        const out = [...m];
        out[out.length - 1] = {
          role: "assistant",
          content: out[out.length - 1].content + chunk,
        };
        return out;
      });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/desk/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context: snapshot() }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        append(err?.error ?? `analyst unavailable (HTTP ${res.status})`);
      } else if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          append(decoder.decode(value, { stream: true }));
        }
      }
    } catch {
      append("analyst unavailable — connection dropped.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <>
      {/* floating toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Desk analyst chat"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full px-4 py-2.5 text-[11px] font-bold tracking-widest text-white shadow-lg"
        style={{ background: `linear-gradient(140deg, ${ACCENT}, #8b5cf6)` }}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
        </svg>
        {open ? "CLOSE" : "ANALYST"}
      </button>

      {/* drawer */}
      {open && (
        <div
          className="fixed bottom-16 right-2 z-40 flex max-h-[70vh] w-[min(400px,calc(100vw-16px))] flex-col rounded-xl border shadow-2xl"
          style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel)" }}
          role="dialog"
          aria-label="Desk analyst"
        >
          <header
            className="flex items-center justify-between border-b px-3.5 py-2.5"
            style={{ borderColor: "var(--dk-edge)" }}
          >
            <div>
              <div className="text-[11px] font-semibold tracking-widest">DESK ANALYST</div>
              <div className="text-[9px] tracking-widest text-[var(--dk-muted)]">
                AI COMMENTARY · READS YOUR CURRENT SCREEN
              </div>
            </div>
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest"
              style={{ background: "var(--dk-panel-2)", color: ACCENT }}
            >
              CLAUDE
            </span>
          </header>

          <div ref={scrollRef} className="min-h-[180px] flex-1 space-y-3 overflow-y-auto p-3.5">
            {msgs.length === 0 && (
              <div className="space-y-2">
                <p className="text-[10.5px] leading-relaxed text-[var(--dk-muted)]">
                  Ask about anything on the desk — spot moves, your positions, the forecast,
                  the risk numbers. Each question includes a snapshot of what you&apos;re
                  looking at right now.
                </p>
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full rounded-lg border px-2.5 py-1.5 text-left text-[10.5px] text-[var(--dk-ink-2)] hover:text-[var(--dk-ink)]"
                    style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel-2)" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className="max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed"
                  style={
                    m.role === "user"
                      ? { background: ACCENT, color: "#fff" }
                      : { background: "var(--dk-panel-2)", color: "var(--dk-ink)" }
                  }
                >
                  {m.content || (busy && i === msgs.length - 1 ? "…" : "")}
                </div>
              </div>
            ))}
          </div>

          <form
            className="flex items-center gap-2 border-t p-2.5"
            style={{ borderColor: "var(--dk-edge)" }}
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={busy ? "analyst is typing…" : "ask the desk analyst…"}
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border bg-black/30 px-2.5 py-2 text-[11px] outline-none focus:border-[#4d8dff]"
              style={{ borderColor: "var(--dk-edge)", color: "var(--dk-ink)" }}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-lg px-3 py-2 text-[10px] font-bold tracking-widest text-white disabled:opacity-40"
              style={{ background: ACCENT }}
            >
              SEND
            </button>
          </form>
          <p className="px-3.5 pb-2 text-[8.5px] leading-snug text-[var(--dk-muted)]">
            AI commentary on a paper desk — verify numbers before acting. Not financial advice.
          </p>
        </div>
      )}
    </>
  );
}
