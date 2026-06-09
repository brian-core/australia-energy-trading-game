"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BOOK,
  STRESS_SPOT_AUD,
  computePositions,
  evaluateAlerts,
  tradeMtmPerH,
  type Book,
  type DeskAlert,
  type Trade,
  type TradeKind,
} from "@/lib/energy/desk";
import { priceColor } from "@/lib/energy/pricing";
import type { LivePayload } from "@/lib/energy/types";

const STORAGE_KEY = "au-energy-desk-v1";

interface DeskState {
  book: Book;
  trades: Trade[];
}

function loadState(): DeskState {
  if (typeof window === "undefined") return { book: DEFAULT_BOOK, trades: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { book: DEFAULT_BOOK, trades: [] };
    const parsed = JSON.parse(raw) as Partial<DeskState>;
    return {
      book: { ...DEFAULT_BOOK, ...parsed.book, loadsMW: { ...DEFAULT_BOOK.loadsMW, ...parsed.book?.loadsMW } },
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
    };
  } catch {
    return { book: DEFAULT_BOOK, trades: [] };
  }
}

function money(x: number): string {
  const sign = x < 0 ? "−" : "";
  const abs = Math.abs(x);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

const SEVERITY_COLOR: Record<DeskAlert["severity"], string> = {
  buy: "#48a87c",
  warn: "#e2483d",
  info: "#3f8fd2",
};

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  width = 64,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  width?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[10px] text-[var(--ink-soft)]">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded border bg-black/30 px-1.5 py-0.5 text-right text-[11px] text-[var(--ink)]"
        style={{ borderColor: "var(--edge)", width }}
      />
    </label>
  );
}

export default function DeskPanel({ live }: { live: LivePayload }) {
  const [state, setState] = useState<DeskState>(loadState);
  const [alerts, setAlerts] = useState<DeskAlert[]>([]);
  const [notify, setNotify] = useState(false);
  const seenAlertKeys = useRef<Set<string>>(new Set());

  // Trade ticket
  const [ticket, setTicket] = useState<{ region: string; kind: TradeKind; mw: number; strike: number; premium: number }>(
    { region: "NSW1", kind: "swap", mw: 5, strike: 80, premium: 12 },
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full/blocked — simulation continues in memory
    }
  }, [state]);

  const view = useMemo(
    () => computePositions(live, state.book, state.trades),
    [live, state.book, state.trades],
  );

  // Re-evaluate signals whenever fresh data lands; notify once per condition.
  useEffect(() => {
    const current = evaluateAlerts(view, state.book);
    setAlerts((prev) => {
      const fresh = current.filter((a) => !seenAlertKeys.current.has(a.key));
      for (const a of fresh) {
        seenAlertKeys.current.add(a.key);
        if (notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Energy desk signal", { body: a.message });
        }
      }
      return [...fresh, ...prev].slice(0, 40);
    });
  }, [view, state.book, notify]);

  const setBook = useCallback((patch: Partial<Book>) => {
    setState((s) => ({ ...s, book: { ...s.book, ...patch } }));
  }, []);

  const addTrade = useCallback(() => {
    if (ticket.mw <= 0) return;
    const trade: Trade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: ticket.kind,
      region: ticket.region,
      mw: ticket.mw,
      strikeAUD: ticket.strike,
      premiumAUD: ticket.kind === "cap" ? ticket.premium : 0,
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ ...s, trades: [trade, ...s.trades] }));
  }, [ticket]);

  const removeTrade = useCallback((id: string) => {
    setState((s) => ({ ...s, trades: s.trades.filter((t) => t.id !== id) }));
  }, []);

  const requestNotify = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotify(perm === "granted");
  }, []);

  const spotByRegion = useMemo(
    () => new Map(live.regions.map((r) => [r.code, r.priceAUD])),
    [live],
  );
  const netRetailAUD = (state.book.flatRateCkwh - state.book.nonEnergyCkwh) * 10;

  return (
    <div className="space-y-3 font-[family-name:var(--f-mono)] text-[11px]">
      <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">
        SYNTHETIC DESK — PAPER TRADES ONLY, MARKED AGAINST LIVE 5-MIN SPOT
      </div>

      {/* Portfolio summary */}
      <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-sm" style={{ color: view.marginPerH >= 0 ? "var(--gen)" : "#e2483d" }}>
              {money(view.marginPerH)}/h
            </div>
            <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">MARGIN NOW</div>
          </div>
          <div>
            <div className="text-sm">{money(view.marginPerDay)}</div>
            <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">PER DAY</div>
          </div>
          <div>
            <div className="text-sm">{Math.round(view.coverage * 100)}%</div>
            <div className="text-[9px] tracking-widest text-[var(--ink-soft)]">HEDGED</div>
          </div>
        </div>
        <div className="mt-1.5 text-[10px] text-[var(--ink-soft)]">
          revenue {money(view.revenuePerH)}/h · energy cost {money(view.energyCostPerH)}/h · net retail $
          {netRetailAUD.toFixed(0)}/MWh
        </div>
        <div className="mt-1 text-[10px]" style={{ color: view.stressMarginPerH >= 0 ? "var(--gen)" : "#e2483d" }}>
          stress @ ${STRESS_SPOT_AUD.toLocaleString()}: {money(view.stressMarginPerH)}/h
        </div>
      </div>

      {/* Book settings */}
      <details className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }} open>
        <summary className="cursor-pointer text-[10px] tracking-widest text-[var(--ink-soft)]">
          BOOK — FLAT-RATE SUBSCRIPTION
        </summary>
        <div className="mt-2 space-y-1.5">
          <NumberField label="flat rate (c/kWh)" value={state.book.flatRateCkwh} step={0.5} onChange={(v) => setBook({ flatRateCkwh: v })} />
          <NumberField label="non-energy cost (c/kWh)" value={state.book.nonEnergyCkwh} step={0.5} onChange={(v) => setBook({ nonEnergyCkwh: v })} />
          <NumberField label="coverage target (%)" value={Math.round(state.book.targetCoverage * 100)} onChange={(v) => setBook({ targetCoverage: Math.max(0, v) / 100 })} />
          <NumberField label="buy signal ($/MWh)" value={state.book.buySignalAUD} step={5} onChange={(v) => setBook({ buySignalAUD: v })} />
          <div className="pt-1 text-[10px] tracking-widest text-[var(--ink-soft)]">CUSTOMER LOAD (MW)</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {live.regions.map((r) => (
              <NumberField
                key={r.code}
                label={r.code.replace(/\d$/, "")}
                value={state.book.loadsMW[r.code] ?? 0}
                step={0.5}
                width={56}
                onChange={(v) =>
                  setBook({ loadsMW: { ...state.book.loadsMW, [r.code]: Math.max(0, v) } })
                }
              />
            ))}
          </div>
        </div>
      </details>

      {/* Positions */}
      <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">POSITIONS</div>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-left text-[9px] tracking-wider text-[var(--ink-soft)]">
              <th>RGN</th>
              <th className="text-right">LOAD</th>
              <th className="text-right">SPOT</th>
              <th className="text-right">HEDGE</th>
              <th className="text-right">MARGIN/H</th>
            </tr>
          </thead>
          <tbody>
            {view.regions
              .filter((r) => r.loadMW > 0)
              .map((r) => (
                <tr key={r.code}>
                  <td>{r.code.replace(/\d$/, "")}</td>
                  <td className="text-right">{r.loadMW}</td>
                  <td className="text-right" style={{ color: priceColor(r.spotAUD) }}>
                    {r.spotAUD != null ? `$${r.spotAUD.toFixed(0)}` : "—"}
                  </td>
                  <td className="text-right" style={{ color: r.coverage >= state.book.targetCoverage ? "var(--gen)" : "#f2c14e" }}>
                    {Math.round(r.coverage * 100)}%
                  </td>
                  <td className="text-right" style={{ color: r.marginPerH >= 0 ? "var(--gen)" : "#e2483d" }}>
                    {money(r.marginPerH)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Trade ticket */}
      <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">NEW PAPER TRADE</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={ticket.region}
            onChange={(e) => setTicket({ ...ticket, region: e.target.value })}
            className="rounded border bg-black/30 px-1 py-0.5"
            style={{ borderColor: "var(--edge)" }}
          >
            {live.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code.replace(/\d$/, "")}
              </option>
            ))}
          </select>
          <select
            value={ticket.kind}
            onChange={(e) => setTicket({ ...ticket, kind: e.target.value as TradeKind })}
            className="rounded border bg-black/30 px-1 py-0.5"
            style={{ borderColor: "var(--edge)" }}
          >
            <option value="swap">swap</option>
            <option value="cap">cap</option>
          </select>
          <input
            type="number"
            value={ticket.mw}
            min={0}
            step={0.5}
            onChange={(e) => setTicket({ ...ticket, mw: Number(e.target.value) || 0 })}
            className="w-14 rounded border bg-black/30 px-1 py-0.5 text-right"
            style={{ borderColor: "var(--edge)" }}
            title="MW"
          />
          <span className="text-[var(--ink-soft)]">MW @</span>
          <input
            type="number"
            value={ticket.strike}
            step={5}
            onChange={(e) => setTicket({ ...ticket, strike: Number(e.target.value) || 0 })}
            className="w-16 rounded border bg-black/30 px-1 py-0.5 text-right"
            style={{ borderColor: "var(--edge)" }}
            title="strike $/MWh"
          />
          {ticket.kind === "cap" && (
            <>
              <span className="text-[var(--ink-soft)]">prem</span>
              <input
                type="number"
                value={ticket.premium}
                step={1}
                onChange={(e) => setTicket({ ...ticket, premium: Number(e.target.value) || 0 })}
                className="w-12 rounded border bg-black/30 px-1 py-0.5 text-right"
                style={{ borderColor: "var(--edge)" }}
                title="premium $/MWh"
              />
            </>
          )}
          <button
            onClick={addTrade}
            className="rounded px-2 py-0.5 text-[10px] tracking-widest"
            style={{ background: "var(--gen)", color: "#0b0d11" }}
          >
            BOOK
          </button>
        </div>
      </div>

      {/* Blotter */}
      {state.trades.length > 0 && (
        <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
          <div className="mb-1.5 text-[10px] tracking-widest text-[var(--ink-soft)]">
            BLOTTER · MTM AT CURRENT SPOT
          </div>
          <div className="space-y-1">
            {state.trades.map((t) => {
              const mtm = tradeMtmPerH(t, spotByRegion.get(t.region) ?? null);
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 text-[10px]">
                  <span>
                    {t.kind.toUpperCase()} {t.region.replace(/\d$/, "")} {t.mw}MW @ ${t.strikeAUD}
                    {t.kind === "cap" ? ` (prem $${t.premiumAUD})` : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <span style={{ color: mtm == null ? "var(--ink-soft)" : mtm >= 0 ? "var(--gen)" : "#e2483d" }}>
                      {mtm == null ? "—" : `${money(mtm)}/h`}
                    </span>
                    <button
                      onClick={() => removeTrade(t.id)}
                      className="text-[var(--ink-soft)] hover:text-[#e2483d]"
                      title="unwind"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Signals */}
      <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] tracking-widest text-[var(--ink-soft)]">SIGNALS</span>
          <button
            onClick={requestNotify}
            className="rounded border px-1.5 py-0.5 text-[9px] tracking-widest text-[var(--ink-soft)]"
            style={{ borderColor: "var(--edge)" }}
          >
            {notify ? "NOTIFYING ✓" : "ENABLE BROWSER ALERTS"}
          </button>
        </div>
        {alerts.length === 0 ? (
          <div className="text-[10px] text-[var(--ink-soft)]">
            No signals yet — they fire when spot crosses your buy threshold, coverage gaps open
            during spikes, prices go negative, or a region serves at a loss.
          </div>
        ) : (
          <div className="max-h-48 space-y-1.5 overflow-y-auto hud-scroll">
            {alerts.map((a) => (
              <div key={a.key + a.at} className="flex gap-1.5 text-[10px] leading-snug">
                <span style={{ color: SEVERITY_COLOR[a.severity] }}>
                  {a.severity === "buy" ? "▲" : a.severity === "warn" ? "⚠" : "ℹ"}
                </span>
                <span>{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
