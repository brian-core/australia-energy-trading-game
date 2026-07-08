"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {

  STRESS_SPOT_AUD,
  computePositions,
  evaluateAlerts,
  tradeMtmPerH,
  type Book,
  type DeskAlert,
  type Trade,
  type TradeKind,
} from "@/lib/energy/desk";
import { runBacktest } from "@/lib/energy/backtest";
import type { HistoryPayload, HistoryWindow } from "@/lib/energy/history";
import { priceColor } from "@/lib/energy/pricing";
import { simulateSpot } from "@/lib/energy/spotsim";
import type { Facility, LivePayload } from "@/lib/energy/types";
import PriceChart from "./price-chart";

import { DESK_STORAGE_KEY, loadDeskState, type DeskState } from "@/lib/energy/desk-storage";

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
    <label className="flex items-center justify-between gap-2 text-[11px] text-[var(--ink-soft)]">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded border bg-black/30 px-1.5 py-0.5 text-right text-xs text-[var(--ink)]"
        style={{ borderColor: "var(--edge)", width }}
      />
    </label>
  );
}

/** Structural 12-month spot simulation — the retail-lens view of price risk.
 *  Unit-level outage Markov over the registered fleet drives quarter-long
 *  price regimes; outputs are distributions of quarterly averages and the
 *  book's 12-month margin. See lib/energy/spotsim.ts for the method. */
function SpotSimCard({ live, book }: { live: LivePayload; book: Book }) {
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [hist90, setHist90] = useState<HistoryPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [f, h] = await Promise.all([
          fetch("/api/energy/facilities").then((r) => r.json() as Promise<{ facilities: Facility[] }>),
          fetch("/api/energy/history?window=90d").then((r) => r.json() as Promise<HistoryPayload>),
        ]);
        if (!cancelled) {
          setFacilities(f.facilities);
          setHist90(h);
        }
      } catch {
        // card stays in loading state; the rest of the desk works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sim = useMemo(() => {
    if (!facilities || !hist90) return null;
    const regions = live.regions
      .filter((r) => r.demandMW > 0)
      .map((r) => {
        const pts = hist90.regions[r.code] ?? [];
        const avg = pts.length ? pts.reduce((sum, pnt) => sum + pnt[1], 0) / pts.length : (r.priceAUD ?? 90);
        return { code: r.code, demandAvgMW: r.demandMW, priceAnchorAUD: Math.max(avg, 20) };
      });
    return simulateSpot(facilities, regions, {
      runs: 300,
      book: { loadsMW: book.loadsMW, flatCkwh: book.flatRateCkwh, nonEnergyCkwh: book.nonEnergyCkwh },
    });
  }, [facilities, hist90, live, book]);

  const money = (x: number) => `${x < 0 ? "−" : ""}$${(Math.abs(x) / 1e6).toFixed(1)}m`;

  return (
    <div className="mt-3 rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
      <div className="mb-1.5 text-[11px] tracking-widest text-[var(--ink-soft)]">
        SPOT SIM — NEXT 12 MONTHS · STRUCTURAL OUTAGE MODEL{sim ? ` · ${sim.runs} RUNS` : ""}
      </div>
      {!sim ? (
        <div className="text-[11px] text-[var(--ink-soft)]">loading fleet register + 90d prices…</div>
      ) : (
        <>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] tracking-wider text-[var(--ink-soft)]">
                <th className="pb-1">RGN</th>
                <th className="text-right">FLEET</th>
                <th className="text-right">YR AVG P50</th>
                <th className="text-right">P90</th>
                <th className="text-right">WORST-Q P90</th>
                <th className="text-right">P(Q&gt;$150)</th>
                <th className="text-right">P(Q&gt;$300)</th>
              </tr>
            </thead>
            <tbody>
              {sim.regions.map((r) => {
                const worstQ = Math.max(...r.quarters.map((q) => q.p90));
                return (
                  <tr key={r.code}>
                    <td className="py-0.5">{r.code.replace(/\d$/, "")}</td>
                    <td className="text-right text-[var(--ink-soft)]">{r.thermalUnits}u</td>
                    <td className="text-right">${r.annual.p50.toFixed(0)}</td>
                    <td className="text-right">${r.annual.p90.toFixed(0)}</td>
                    <td className="text-right" style={{ color: worstQ > 200 ? "#e2483d" : worstQ > 130 ? "#f2c14e" : "inherit" }}>
                      ${worstQ.toFixed(0)}
                    </td>
                    <td className="text-right">{Math.round(r.probQuarterOver150 * 100)}%</td>
                    <td className="text-right" style={{ color: r.probQuarterOver300 > 0.05 ? "#e2483d" : "inherit" }}>
                      {Math.round(r.probQuarterOver300 * 100)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sim.book && (
            <div className="mt-2 space-y-0.5 border-t pt-1.5 text-[11px]" style={{ borderColor: "var(--edge)" }}>
              <div className="flex justify-between">
                <span className="text-[var(--ink-soft)]">book margin, 12 months (P10 / P50 / P90)</span>
                <span>
                  <span style={{ color: sim.book.annualMarginP10 < 0 ? "#e2483d" : "var(--gen)" }}>{money(sim.book.annualMarginP10)}</span>
                  {" / "}
                  {money(sim.book.annualMarginP50)}
                  {" / "}
                  {money(sim.book.annualMarginP90)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--ink-soft)]">P(at least one negative quarter)</span>
                <span style={{ color: sim.book.probNegativeQuarter > 0.2 ? "#e2483d" : sim.book.probNegativeQuarter > 0.05 ? "#f2c14e" : "var(--gen)" }}>
                  {Math.round(sim.book.probNegativeQuarter * 100)}%
                </span>
              </div>
            </div>
          )}
          <div className="mt-1.5 text-[9px] leading-snug text-[var(--ink-soft)]">
            method: {sim.method}. outage rates are reference values; price anchor is live. quarters within a run
            share the same outage/weather draw, so book risk carries real correlation.
          </div>
        </>
      )}
    </div>
  );
}

export default function DeskPanel({ live }: { live: LivePayload }) {
  const [state, setState] = useState<DeskState>(loadDeskState);
  const [alerts, setAlerts] = useState<DeskAlert[]>([]);
  const [notify, setNotify] = useState(false);
  const seenAlertKeys = useRef<Set<string>>(new Set());

  // Trade ticket
  const [ticket, setTicket] = useState<{ region: string; kind: TradeKind; mw: number; strike: number; premium: number }>(
    { region: "NSW1", kind: "swap", mw: 5, strike: 80, premium: 12 },
  );

  // Backtest over historic prices
  const [btWindow, setBtWindow] = useState<HistoryWindow>("7d");
  const [histories, setHistories] = useState<Partial<Record<HistoryWindow, HistoryPayload>>>({});
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    if (histories[btWindow]) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/energy/history?window=${btWindow}`);
        if (!res.ok) throw new Error(String(res.status));
        const payload = (await res.json()) as HistoryPayload;
        if (!cancelled) {
          setHistories((h) => ({ ...h, [payload.window]: payload }));
          setHistoryError(false);
        }
      } catch {
        if (!cancelled) setHistoryError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [btWindow, histories]);

  const history = histories[btWindow];
  const backtest = useMemo(
    () => (history ? runBacktest(history, state.book, state.trades) : null),
    [history, state.book, state.trades],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(DESK_STORAGE_KEY, JSON.stringify(state));
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
    <div className="space-y-3 font-[family-name:var(--f-mono)] text-xs">
      <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">
        SYNTHETIC DESK — PAPER TRADES ONLY, MARKED AGAINST LIVE 5-MIN SPOT
      </div>

      {/* Portfolio summary */}
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-base" style={{ color: view.marginPerH >= 0 ? "var(--gen)" : "#e2483d" }}>
              {money(view.marginPerH)}/h
            </div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">MARGIN NOW</div>
          </div>
          <div>
            <div className="text-base">{money(view.marginPerDay)}</div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">PER DAY</div>
          </div>
          <div>
            <div className="text-base">{Math.round(view.coverage * 100)}%</div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">HEDGED</div>
          </div>
        </div>
        <div className="mt-1.5 text-[11px] text-[var(--ink-soft)]">
          revenue {money(view.revenuePerH)}/h · energy cost {money(view.energyCostPerH)}/h · net retail $
          {netRetailAUD.toFixed(0)}/MWh
        </div>
        <div className="mt-1 text-[11px]" style={{ color: view.stressMarginPerH >= 0 ? "var(--gen)" : "#e2483d" }}>
          stress @ ${STRESS_SPOT_AUD.toLocaleString()}: {money(view.stressMarginPerH)}/h
        </div>
      </div>

      {/* Book settings */}
      <details className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }} open>
        <summary className="cursor-pointer text-[11px] tracking-widest text-[var(--ink-soft)]">
          BOOK — FLAT-RATE SUBSCRIPTION
        </summary>
        <div className="mt-2 space-y-1.5">
          <NumberField label="flat rate (c/kWh)" value={state.book.flatRateCkwh} step={0.5} onChange={(v) => setBook({ flatRateCkwh: v })} />
          <NumberField label="non-energy cost (c/kWh)" value={state.book.nonEnergyCkwh} step={0.5} onChange={(v) => setBook({ nonEnergyCkwh: v })} />
          <NumberField label="coverage target (%)" value={Math.round(state.book.targetCoverage * 100)} onChange={(v) => setBook({ targetCoverage: Math.max(0, v) / 100 })} />
          <NumberField label="buy signal ($/MWh)" value={state.book.buySignalAUD} step={5} onChange={(v) => setBook({ buySignalAUD: v })} />
          <div className="pt-1 text-[11px] tracking-widest text-[var(--ink-soft)]">CUSTOMER LOAD (MW)</div>
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
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 text-[11px] tracking-widest text-[var(--ink-soft)]">POSITIONS</div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[10px] tracking-wider text-[var(--ink-soft)]">
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
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 text-[11px] tracking-widest text-[var(--ink-soft)]">NEW PAPER TRADE</div>
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
            className="rounded px-2 py-0.5 text-[11px] tracking-widest"
            style={{ background: "var(--gen)", color: "#0b0d11" }}
          >
            BOOK
          </button>
        </div>
      </div>

      {/* Blotter */}
      {state.trades.length > 0 && (
        <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
          <div className="mb-1.5 text-[11px] tracking-widest text-[var(--ink-soft)]">
            BLOTTER · MTM AT CURRENT SPOT
          </div>
          <div className="space-y-1">
            {state.trades.map((t) => {
              const mtm = tradeMtmPerH(t, spotByRegion.get(t.region) ?? null);
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 text-[11px]">
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

      {/* Backtest */}
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] tracking-widest text-[var(--ink-soft)]">
            BACKTEST — BOOK & TRADES AS-IF HELD
          </span>
          <div className="flex overflow-hidden rounded border" style={{ borderColor: "var(--edge)" }}>
            {(["7d", "90d"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setBtWindow(w)}
                className="px-1.5 py-0.5 text-[10px] tracking-widest uppercase"
                style={
                  btWindow === w
                    ? { background: "var(--gen)", color: "#0b0d11" }
                    : { color: "var(--ink-soft)" }
                }
              >
                {w}
              </button>
            ))}
          </div>
        </div>
        {!backtest ? (
          <div className="text-[11px] text-[var(--ink-soft)]">
            {historyError ? "history feed unavailable" : "loading price history…"}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-base" style={{ color: backtest.marginAUD >= 0 ? "var(--gen)" : "#e2483d" }}>
                  {money(backtest.marginAUD)}
                </div>
                <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">MARGIN {btWindow.toUpperCase()}</div>
              </div>
              <div>
                <div className="text-base">
                  {backtest.marginPerMWh >= 0 ? "$" : "−$"}
                  {Math.abs(backtest.marginPerMWh).toFixed(0)}
                </div>
                <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">PER MWH</div>
              </div>
              <div>
                <div className="text-base">{Math.round(backtest.underwaterShare * 100)}%</div>
                <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">TIME UNDERWATER</div>
              </div>
            </div>
            <div className="mt-2">
              <PriceChart
                points={backtest.curve}
                color={backtest.marginAUD >= 0 ? "#2c8c8a" : "#e2483d"}
                fillToZero
              />
            </div>
            <div className="mt-1 space-y-0.5 text-[11px] text-[var(--ink-soft)]">
              {backtest.regions.map((r) => (
                <div key={r.code} className="flex justify-between">
                  <span>
                    {r.code.replace(/\d$/, "")} avg ${Math.round(r.avgPriceAUD)} (${Math.round(r.minPriceAUD)}…$
                    {Math.round(r.maxPriceAUD)})
                  </span>
                  <span style={{ color: r.marginAUD >= 0 ? "var(--gen)" : "#e2483d" }}>{money(r.marginAUD)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-[10px] leading-snug text-[var(--ink-soft)]">
              cumulative margin, {btWindow === "7d" ? "30-min" : "daily VWA"} prices
              {btWindow === "90d" && " — daily averaging understates cap payouts in short spikes"}
              {backtest.demo && " · SYNTHETIC HISTORY (feeds unreachable)"}
            </div>
          </>
        )}
      </div>

      {/* Signals */}
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] tracking-widest text-[var(--ink-soft)]">SIGNALS</span>
          <button
            onClick={requestNotify}
            className="rounded border px-1.5 py-0.5 text-[10px] tracking-widest text-[var(--ink-soft)]"
            style={{ borderColor: "var(--edge)" }}
          >
            {notify ? "NOTIFYING ✓" : "ENABLE BROWSER ALERTS"}
          </button>
        </div>
        {alerts.length === 0 ? (
          <div className="text-[11px] text-[var(--ink-soft)]">
            No signals yet — they fire when spot crosses your buy threshold, coverage gaps open
            during spikes, prices go negative, or a region serves at a loss.
          </div>
        ) : (
          <div className="max-h-48 space-y-1.5 overflow-y-auto hud-scroll">
            {alerts.map((a) => (
              <div key={a.key + a.at} className="flex gap-1.5 text-[11px] leading-snug">
                <span style={{ color: SEVERITY_COLOR[a.severity] }}>
                  {a.severity === "buy" ? "▲" : a.severity === "warn" ? "⚠" : "ℹ"}
                </span>
                <span>{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <SpotSimCard live={live} book={state.book} />
    </div>
  );
}
