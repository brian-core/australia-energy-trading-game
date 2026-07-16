"use client";

import { useEffect, useRef, useState } from "react";

// AI desk analyst chat: a full-height right drawer with tabbed conversations.
// Each question ships with a fresh snapshot of what the desk is currently
// showing (built by the parent), so the analyst comments on the numbers
// actually on screen. Replies stream token-by-token from /api/desk/chat and
// keep streaming into their own tab even if the user switches tabs.

const ACCENT = "#4d8dff";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface Chat {
  id: string;
  msgs: Msg[];
}

const STARTERS = [
  "What's going on in the market right now?",
  "How is my book positioned — where am I exposed?",
  "Explain the stress test number.",
  "Which of my open trades are working?",
];

export default function DeskChat({ snapshot }: { snapshot: () => unknown }) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<Chat[]>([{ id: "c1", msgs: [] }]);
  const [activeId, setActiveId] = useState("c1");
  const [draft, setDraft] = useState("");
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null); // `${chatId}:${msgIdx}`
  const scrollRef = useRef<HTMLDivElement>(null);
  const aborts = useRef(new Map<string, AbortController>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextChatNo = useRef(2);

  const active = chats.find((c) => c.id === activeId) ?? chats[0];
  const busy = busyIds.has(active.id);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active.msgs, activeId, open]);

  useEffect(() => {
    const map = aborts.current;
    return () => {
      map.forEach((c) => c.abort());
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const setBusyFor = (chatId: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(chatId);
      else next.delete(chatId);
      return next;
    });

  const patchChat = (chatId: string, fn: (msgs: Msg[]) => Msg[]) =>
    setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, msgs: fn(c.msgs) } : c)));

  const newChat = () => {
    const id = `c${nextChatNo.current++}`;
    setChats((cs) => [...cs, { id, msgs: [] }]);
    setActiveId(id);
  };

  const closeChat = (chatId: string) => {
    aborts.current.get(chatId)?.abort();
    aborts.current.delete(chatId);
    setBusyFor(chatId, false);
    setChats((cs) => {
      const remaining = cs.filter((c) => c.id !== chatId);
      const next = remaining.length > 0 ? remaining : [{ id: `c${nextChatNo.current++}`, msgs: [] }];
      if (chatId === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard blocked (permissions/insecure context) — leave silently
    }
  };

  const send = async (text: string) => {
    const q = text.trim();
    const chatId = active.id;
    if (!q || busyIds.has(chatId)) return;
    setDraft("");
    setBusyFor(chatId, true);
    const history = [...active.msgs, { role: "user" as const, content: q }];
    patchChat(chatId, () => [...history, { role: "assistant", content: "" }]);

    const append = (chunk: string) =>
      patchChat(chatId, (msgs) => {
        const out = [...msgs];
        out[out.length - 1] = {
          role: "assistant",
          content: out[out.length - 1].content + chunk,
        };
        return out;
      });

    const ctrl = new AbortController();
    aborts.current.set(chatId, ctrl);
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
      setBusyFor(chatId, false);
      aborts.current.delete(chatId);
    }
  };

  const tabTitle = (c: Chat, i: number) => {
    const first = c.msgs.find((m) => m.role === "user")?.content;
    return first ? (first.length > 20 ? `${first.slice(0, 20)}…` : first) : `CHAT ${i + 1}`;
  };

  return (
    <>
      {/* floating toggle (hidden while the drawer is open) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label="Open desk analyst chat"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full px-4 py-2.5 text-[11px] font-bold tracking-widest text-white shadow-lg"
          style={{ background: `linear-gradient(140deg, ${ACCENT}, #8b5cf6)` }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
          </svg>
          ANALYST
        </button>
      )}

      {/* full-height right drawer */}
      {open && (
        <div
          className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l shadow-2xl sm:w-[420px]"
          style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel)" }}
          role="dialog"
          aria-label="Desk analyst"
        >
          <header
            className="flex items-center justify-between border-b px-3.5 py-3"
            style={{ borderColor: "var(--dk-edge)" }}
          >
            <div>
              <div className="text-[11px] font-semibold tracking-widest">DESK ANALYST</div>
              <div className="text-[9px] tracking-widest text-[var(--dk-muted)]">
                AI COMMENTARY · READS YOUR CURRENT SCREEN
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest"
                style={{ background: "var(--dk-panel-2)", color: ACCENT }}
              >
                CLAUDE
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close analyst"
                className="grid h-7 w-7 place-items-center rounded-lg border text-[13px] text-[var(--dk-ink-2)] hover:text-[var(--dk-ink)]"
                style={{ borderColor: "var(--dk-edge)" }}
              >
                ✕
              </button>
            </div>
          </header>

          {/* chat tabs */}
          <div
            className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5"
            style={{ borderColor: "var(--dk-edge)" }}
            role="tablist"
            aria-label="Conversations"
          >
            {chats.map((c, i) => {
              const isActive = c.id === active.id;
              return (
                <div
                  key={c.id}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  onClick={() => setActiveId(c.id)}
                  onKeyDown={(e) => e.key === "Enter" && setActiveId(c.id)}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[9.5px] font-semibold tracking-wider"
                  style={
                    isActive
                      ? { borderColor: ACCENT, color: "var(--dk-ink)", background: "var(--dk-panel-2)" }
                      : { borderColor: "var(--dk-edge)", color: "var(--dk-ink-2)" }
                  }
                >
                  {busyIds.has(c.id) && (
                    <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
                  )}
                  <span className="max-w-[120px] truncate">{tabTitle(c, i)}</span>
                  {chats.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeChat(c.id);
                      }}
                      aria-label="Close chat"
                      className="-mr-0.5 rounded px-0.5 text-[11px] leading-none text-[var(--dk-muted)] hover:text-[var(--dk-ink)]"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={newChat}
              aria-label="New chat"
              title="New chat"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[13px] leading-none text-[var(--dk-ink-2)] hover:text-[var(--dk-ink)]"
              style={{ borderColor: "var(--dk-edge)" }}
            >
              +
            </button>
          </div>

          <div ref={scrollRef} className="min-h-[180px] flex-1 space-y-3 overflow-y-auto p-3.5">
            {active.msgs.length === 0 && (
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
            {active.msgs.map((m, i) => {
              const key = `${active.id}:${i}`;
              const streaming = busy && i === active.msgs.length - 1;
              return (
                <div key={key} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}>
                  <div
                    className="max-w-[90%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed"
                    style={
                      m.role === "user"
                        ? { background: ACCENT, color: "#fff" }
                        : { background: "var(--dk-panel-2)", color: "var(--dk-ink)" }
                    }
                  >
                    {m.content || (streaming ? "…" : "")}
                  </div>
                  {m.role === "assistant" && m.content && !streaming && (
                    <button
                      onClick={() => copy(key, m.content)}
                      className="mt-1 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-widest text-[var(--dk-muted)] hover:text-[var(--dk-ink)]"
                      style={copied === key ? { color: "#35c285" } : undefined}
                    >
                      {copied === key ? "✓ COPIED" : "COPY"}
                    </button>
                  )}
                </div>
              );
            })}
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
