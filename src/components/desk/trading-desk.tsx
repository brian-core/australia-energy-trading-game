"use client";

import { useEffect, useMemo, useState } from "react";
import {
  STRESS_SPOT_AUD,
  computePositions,
  evaluateAlerts,
  tradeMtmPerH,
  type Book,
  type Trade,
  type TradeKind,
} from "@/lib/energy/desk";
import { DESK_STORAGE_KEY, loadDeskState, type DeskState } from "@/lib/energy/desk-storage";
import { runBacktest } from "@/lib/energy/backtest";
import { buildForecast } from "@/lib/energy/forecast";
import type { HistoryPayload, PricePoint } from "@/lib/energy/history";
import { REGIONS } from "@/lib/energy/regions";
import type { SeriesPayload } from "@/lib/energy/series";
import type { WeatherPayload } from "@/lib/energy/weather";
import type { LivePayload } from "@/lib/energy/types";
import PriceChart from "../energy/price-chart";

// MERIDIAN DESK — the wholesale-desk face of the same engine that powers the
// game. No game mechanics: this is the retailer view. Positions, coverage,
// margin and alerts come from desk.ts; P&L from backtest.ts; the forward view
// from the LAB forecast model. The book is the SAME localStorage book the
// game's OPS desk uses, so paper trades placed here appear there and vice
// versa. Everything is paper — marked against the live 5-minute spot, with no
// ASX Energy or AEMO settlement connectivity.

const ACCENT = "#4d8dff";
const GOOD = "#35c285";
const BAD = "#f2555a";
const WARN = "#f0a93d";

function money(x: number): string {
  const sign = x < 0 ? "−" : "+";
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function short(code: string): string {
  return code.replace(/\d$/, "");
}

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border p-3"
      style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel)" }}
    >
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wide text-[var(--dk-ink)]">{title}</h2>
        {right && <span className="text-[9px] tracking-widest text-[var(--dk-muted)]">{right}</span>}
      </header>
      {children}
    </section>
  );
}

function Spark({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const W = 120;
  const H = 28;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const pts = points
    .map((v, i) => {
      const x = 2 + (i / (points.length - 1)) * (W - 4);
      const y = H - 3 - ((v - lo) / span) * (H - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const [lx, ly] = pts.split(" ").pop()!.split(",");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2.2} fill={color} />
    </svg>
  );
}

function Meter({ label, right, pct, color }: { label: string; right: string; pct: number; color: string }) {
  return (
    <div className="py-1">
      <div className="mb-1 flex justify-between text-[10.5px]">
        <span className="text-[var(--dk-ink-2)]">{label}</span>
        <span className="font-[family-name:var(--f-mono)]" style={{ color }}>
          {right}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--dk-track)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function TradingDesk() {
  const [live, setLive] = useState<LivePayload | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [series, setSeries] = useState<SeriesPayload | null>(null);
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  // Rendered client-only (ssr:false), so the lazy initializer reads the same
  // localStorage book the game's OPS desk writes.
  const [state, setState] = useState<DeskState>(loadDeskState);
  const [fwdRegion, setFwdRegion] = useState("NSW1");
  const [clock, setClock] = useState("");
  const [showBook, setShowBook] = useState(false);
  const [ticket, setTicket] = useState<{ kind: TradeKind; region: string; mw: number; strike: number; premium: number }>({
    kind: "swap",
    region: "NSW1",
    mw: 5,
    strike: 100,
    premium: 12,
  });

  // Persist the shared book/trades on every change (same key as the game).
  useEffect(() => {
    try {
      window.localStorage.setItem(DESK_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage blocked — desk continues in memory
    }
  }, [state]);

  // Live spot: poll every 30s. History: every 5 min. Forecast inputs: every 10 min.
  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/energy/live");
        if (!dead) setLive((await res.json()) as LivePayload);
      } catch {
        /* keep last */
      }
    };
    pull();
    const t = setInterval(pull, 30_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/energy/history?window=7d");
        if (!dead) setHistory((await res.json()) as HistoryPayload);
      } catch {
        /* keep last */
      }
    };
    pull();
    const t = setInterval(pull, 300_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const [s, w] = await Promise.all([
          fetch("/api/energy/series").then((r) => r.json() as Promise<SeriesPayload>),
          fetch("/api/energy/weather").then((r) => r.json() as Promise<WeatherPayload>),
        ]);
        if (!dead) {
          setSeries(s);
          setWeather(w);
        }
      } catch {
        /* forward panel shows placeholder */
      }
    };
    pull();
    const t = setInterval(pull, 600_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  // NEM operates on fixed AEST (UTC+10), no daylight saving.
  useEffect(() => {
    const tick = () => {
      const d = new Date(Date.now() + 10 * 3600_000);
      setClock(d.toISOString().slice(11, 19));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const view = useMemo(
    () => (live ? computePositions(live, state.book, state.trades) : null),
    [live, state.book, state.trades],
  );
  const alerts = useMemo(() => (view ? evaluateAlerts(view, state.book) : []), [view, state.book]);
  const backtest = useMemo(
    () => (history ? runBacktest(history, state.book, state.trades) : null),
    [history, state.book, state.trades],
  );
  const forecast = useMemo(
    () => (series && weather ? buildForecast(series, weather, 48) : null),
    [series, weather],
  );

  // Daily margin buckets from the cumulative backtest curve → worst day.
  const daily = useMemo(() => {
    if (!backtest || backtest.curve.length < 2) return null;
    const byDay = new Map<number, number>();
    let prev = 0;
    for (const [ts, cum] of backtest.curve) {
      const day = Math.floor((ts + 10 * 3600_000) / 86400_000);
      byDay.set(day, (byDay.get(day) ?? 0) + (cum - prev));
      prev = cum;
    }
    const vals = [...byDay.values()].sort((a, b) => a - b);
    return { worst: vals[0], best: vals[vals.length - 1], days: vals.length };
  }, [backtest]);

  const fwd = forecast?.regions[fwdRegion];
  const fwdSeries = useMemo(() => {
    if (!fwd) return null;
    const pts = (v: number[]): PricePoint[] => fwd.t.map((ts, i) => [ts, v[i]] as PricePoint);
    return { hat: pts(fwd.priceHat), lo: pts(fwd.priceLo), hi: pts(fwd.priceHi) };
  }, [fwd]);
  const recentActual = useMemo(() => {
    const pts = history?.regions[fwdRegion];
    return pts ? pts.slice(-96) : undefined;
  }, [history, fwdRegion]);

  const feedChip = live
    ? live.demo
      ? { label: "DEMO FEED", color: WARN }
      : live.sources.openelectricity !== "ok" || live.sources.aemo !== "ok"
        ? { label: "PARTIAL FEED", color: WARN }
        : { label: "DISPATCH LIVE", color: GOOD }
    : { label: "CONNECTING", color: "var(--dk-muted)" };

  const bookTrade = () => {
    if (ticket.mw <= 0 || ticket.strike <= 0) return;
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
  };
  const dropTrade = (id: string) => setState((s) => ({ ...s, trades: s.trades.filter((t) => t.id !== id) }));
  const setBook = (patch: Partial<Book>) => setState((s) => ({ ...s, book: { ...s.book, ...patch } }));
  const setLoad = (code: string, mw: number) =>
    setState((s) => ({ ...s, book: { ...s.book, loadsMW: { ...s.book.loadsMW, [code]: mw } } }));

  const inputCls =
    "w-full rounded border bg-black/30 px-1.5 py-1 text-right font-[family-name:var(--f-mono)] text-[11px]";

  const maxAbsPos = view
    ? Math.max(...view.regions.map((r) => Math.abs(r.swapMW + r.capMW - r.loadMW)), 1)
    : 1;

  return (
    <div
      // The game locks body scrolling (full-screen map), so the desk scrolls
      // inside its own full-height container.
      className="h-screen overflow-y-auto overscroll-contain font-[family-name:var(--f-sans)] text-[12px]"
      style={
        {
          background: "var(--dk-bg)",
          color: "var(--dk-ink)",
          "--dk-bg": "#0a0e14",
          "--dk-panel": "#11161f",
          "--dk-panel-2": "#161c27",
          "--dk-edge": "rgba(255,255,255,0.09)",
          "--dk-ink": "#e8ecf2",
          "--dk-ink-2": "#9aa4b2",
          "--dk-muted": "#667081",
          "--dk-track": "rgba(255,255,255,0.07)",
        } as React.CSSProperties
      }
    >
      <div className="mx-auto max-w-[1280px] px-3 pb-10 pt-3 sm:px-5">
        {/* command bar */}
        <div
          className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel)" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="grid h-8 w-8 place-items-center rounded-lg"
              style={{ background: `linear-gradient(140deg, ${ACCENT}, #8b5cf6)` }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="#fff" />
              </svg>
            </div>
            <div>
              <div className="text-[14px] font-semibold tracking-wide">MERIDIAN DESK</div>
              <div className="text-[9.5px] tracking-widest text-[var(--dk-muted)]">
                WHOLESALE · NEM + WEM · PAPER
              </div>
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={{ color: feedChip.color, background: "var(--dk-panel-2)" }}
          >
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: feedChip.color }} />
            {feedChip.label}
          </span>
          <div className="flex-1" />
          <div className="text-right">
            <div className="font-[family-name:var(--f-mono)] text-[15px] font-semibold">{clock}</div>
            <div className="text-[9.5px] tracking-widest text-[var(--dk-muted)]">AEST · MARKET TIME</div>
          </div>
          {view && (
            <div className="border-l pl-5 text-right" style={{ borderColor: "var(--dk-edge)" }}>
              <div className="text-[9.5px] tracking-widest text-[var(--dk-muted)]">BOOK MARGIN</div>
              <div
                className="font-[family-name:var(--f-mono)] text-[19px] font-semibold"
                style={{ color: view.marginPerDay >= 0 ? GOOD : BAD }}
              >
                {money(view.marginPerDay)}/d
              </div>
              <div className="text-[10px] text-[var(--dk-ink-2)]">
                {money(view.marginPerH)}/h · cover {Math.round(view.coverage * 100)}%
              </div>
            </div>
          )}
        </div>

        {/* spot board */}
        <div className="mb-1.5 px-1 text-[9.5px] tracking-widest text-[var(--dk-muted)]">
          REGIONAL SPOT · $/MWH · 5-MIN DISPATCH
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {(live?.regions ?? []).map((r) => {
            const pts = history?.regions[r.code];
            const spark = pts ? pts.slice(-48).map((p) => p[1]) : [];
            const ago = pts && pts.length > 2 ? pts[pts.length - 3][1] : null;
            const delta = r.priceAUD != null && ago != null ? r.priceAUD - ago : null;
            const dir = delta == null || Math.abs(delta) < 1 ? 0 : delta > 0 ? 1 : -1;
            const dirColor = dir > 0 ? GOOD : dir < 0 ? BAD : "var(--dk-muted)";
            return (
              <button
                key={r.code}
                onClick={() => setFwdRegion(r.code)}
                className="rounded-xl border p-2.5 text-left transition-colors"
                style={{
                  borderColor: fwdRegion === r.code ? ACCENT : "var(--dk-edge)",
                  background: "var(--dk-panel)",
                }}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10.5px] font-bold tracking-wider">{short(r.code)}</span>
                  {delta != null && (
                    <span
                      className="rounded px-1 py-px font-[family-name:var(--f-mono)] text-[9.5px] font-semibold"
                      style={{ color: dirColor, background: "var(--dk-panel-2)" }}
                    >
                      {dir > 0 ? "▲" : dir < 0 ? "▼" : "▬"} {delta >= 0 ? "+" : ""}
                      {delta.toFixed(0)}
                    </span>
                  )}
                </div>
                <div className="font-[family-name:var(--f-mono)] text-[19px] font-semibold tracking-tight">
                  {r.priceAUD != null ? r.priceAUD.toFixed(2) : "—"}
                </div>
                <Spark points={spark} color={dirColor === "var(--dk-muted)" ? "#667081" : dirColor} />
                <div className="mt-1 flex justify-between text-[9.5px] text-[var(--dk-muted)]">
                  <span className="font-[family-name:var(--f-mono)]">{r.demandMW.toLocaleString()} MW</span>
                  <span>demand</span>
                </div>
              </button>
            );
          })}
          {!live &&
            REGIONS.map((r) => (
              <div
                key={r.code}
                className="h-[104px] animate-pulse rounded-xl border"
                style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel)" }}
              />
            ))}
        </div>

        {/* forward + position rail */}
        <div className="mb-3 grid gap-3 lg:grid-cols-[1.8fr_1fr]">
          <Panel
            title={`FORWARD VIEW — ${short(fwdRegion)} · LAB MODEL, NEXT 48H`}
            right={fwd ? `fit r² ${fwd.fit.priceModel.r2.toFixed(2)} · P10–P90` : "fitting…"}
          >
            {fwdSeries ? (
              <>
                <PriceChart
                  points={fwdSeries.hat}
                  bands={[{ lo: fwdSeries.lo, hi: fwdSeries.hi }]}
                  secondary={recentActual}
                  height={190}
                  color={ACCENT}
                />
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--dk-ink-2)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-[3px] w-3 rounded" style={{ background: ACCENT }} />
                    P50 forecast
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-3 rounded opacity-30" style={{ background: ACCENT }} />
                    P10–P90
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-[3px] w-3 rounded bg-white/30" />
                    last 48h actual
                  </span>
                  {series?.demo && <span style={{ color: WARN }}>SYNTHETIC SERIES</span>}
                  {fwd && fwd.fit.outage.impliedOutMW > 200 && (
                    <span style={{ color: WARN }}>
                      ~{Math.round(fwd.fit.outage.impliedOutMW).toLocaleString()} MW thermal implied out
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="grid h-[190px] place-items-center text-[10.5px] text-[var(--dk-muted)]">
                fitting price model from 7-day series + weather…
              </div>
            )}
          </Panel>

          <div className="grid gap-3">
            <Panel title="NET OPEN POSITION" right="HEDGED − LOAD · MW">
              {view ? (
                <>
                  {view.regions
                    .filter((r) => r.loadMW > 0 || r.swapMW + r.capMW > 0)
                    .map((r) => {
                      const net = r.swapMW + r.capMW - r.loadMW;
                      const w = (Math.abs(net) / maxAbsPos) * 50;
                      const isLong = net >= 0;
                      return (
                        <div key={r.code} className="grid grid-cols-[38px_1fr_58px] items-center gap-2 py-1">
                          <span className="text-[10.5px] font-semibold">{short(r.code)}</span>
                          <div className="relative h-3.5">
                            <span
                              className="absolute bottom-[-2px] left-1/2 top-[-2px] w-px"
                              style={{ background: "var(--dk-edge)" }}
                            />
                            <span
                              className="absolute top-0.5 h-2.5 rounded-sm"
                              style={{
                                left: isLong ? "50%" : `${50 - w}%`,
                                width: `${w}%`,
                                background: isLong ? GOOD : BAD,
                              }}
                            />
                          </div>
                          <span
                            className="text-right font-[family-name:var(--f-mono)] text-[11px] font-semibold"
                            style={{ color: isLong ? GOOD : BAD }}
                          >
                            {isLong ? "+" : "−"}
                            {Math.abs(net).toFixed(1)}
                          </span>
                        </div>
                      );
                    })}
                  <div
                    className="mt-1.5 flex justify-between border-t pt-2 text-[10.5px]"
                    style={{ borderColor: "var(--dk-edge)" }}
                  >
                    <span className="text-[var(--dk-ink-2)]">short = unhedged customer load</span>
                    <span className="font-[family-name:var(--f-mono)]">{view.totalLoadMW.toFixed(0)} MW book</span>
                  </div>
                </>
              ) : (
                <div className="text-[10.5px] text-[var(--dk-muted)]">waiting for live feed…</div>
              )}
            </Panel>

            <Panel title="HEDGE COVER" right={`TARGET ${Math.round(state.book.targetCoverage * 100)}%`}>
              {view?.regions
                .filter((r) => r.loadMW > 0)
                .map((r) => {
                  const pct = Math.min(r.coverage * 100, 130);
                  const light = r.coverage < state.book.targetCoverage;
                  return (
                    <Meter
                      key={r.code}
                      label={short(r.code)}
                      right={`${Math.round(r.coverage * 100)}%${light ? " · light" : ""}`}
                      pct={pct}
                      color={light ? WARN : ACCENT}
                    />
                  );
                })}
            </Panel>
          </div>
        </div>

        {/* P&L · risk · alerts */}
        <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Panel title="TRADING P&L — BACKTEST 7D" right="AS-IF · CURRENT BOOK">
            {backtest ? (
              <>
                <div className="mb-2 grid grid-cols-3 gap-2">
                  {[
                    { l: "MARGIN 7D", v: money(backtest.marginAUD), c: backtest.marginAUD >= 0 ? GOOD : BAD },
                    {
                      l: "$/MWH SERVED",
                      v: `${backtest.marginPerMWh >= 0 ? "+" : "−"}$${Math.abs(backtest.marginPerMWh).toFixed(1)}`,
                      c: backtest.marginPerMWh >= 0 ? GOOD : BAD,
                    },
                    {
                      l: "UNDERWATER",
                      v: `${Math.round(backtest.underwaterShare * 100)}%`,
                      c: backtest.underwaterShare > 0.35 ? WARN : "var(--dk-ink)",
                    },
                  ].map((k) => (
                    <div key={k.l} className="rounded-lg border p-2" style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel-2)" }}>
                      <div className="text-[8.5px] tracking-widest text-[var(--dk-muted)]">{k.l}</div>
                      <div className="mt-0.5 font-[family-name:var(--f-mono)] text-[15px] font-semibold" style={{ color: k.c }}>
                        {k.v}
                      </div>
                    </div>
                  ))}
                </div>
                <PriceChart points={backtest.curve} height={64} color={backtest.marginAUD >= 0 ? GOOD : BAD} fillToZero />
                <div className="mt-1 text-[9.5px] text-[var(--dk-muted)]">
                  cumulative margin, current book held across the window
                  {backtest.demo && " · SYNTHETIC HISTORY"}
                </div>
              </>
            ) : (
              <div className="text-[10.5px] text-[var(--dk-muted)]">loading price history…</div>
            )}
          </Panel>

          <Panel title="RISK" right="PAPER LIMITS">
            {view && (
              <>
                <Meter
                  label="Hedge cover vs target"
                  right={`${Math.round(view.coverage * 100)} / ${Math.round(state.book.targetCoverage * 100)}%`}
                  pct={(view.coverage / state.book.targetCoverage) * 100}
                  color={view.coverage >= state.book.targetCoverage ? GOOD : WARN}
                />
                <Meter
                  label={`Stress: $${STRESS_SPOT_AUD / 1000}k/MWh spike`}
                  right={`${money(view.stressMarginPerH)}/h`}
                  pct={Math.min((Math.abs(view.stressMarginPerH) / 100_000) * 100, 100)}
                  color={view.stressMarginPerH >= -20_000 ? GOOD : view.stressMarginPerH >= -80_000 ? WARN : BAD}
                />
                {daily && (
                  <Meter
                    label={`Worst day (last ${daily.days}d, backtest)`}
                    right={`${money(daily.worst)}/d`}
                    pct={Math.min((Math.abs(daily.worst) / Math.max(Math.abs(daily.best), 1)) * 100, 100)}
                    color={daily.worst >= 0 ? GOOD : BAD}
                  />
                )}
                <div className="mt-1.5 text-[9.5px] leading-relaxed text-[var(--dk-muted)]">
                  Stress assumes the spike hits every region simultaneously with today&apos;s hedges — the
                  tail caps are meant to close.
                </div>
              </>
            )}
          </Panel>

          <Panel title="SIGNALS" right={`${alerts.length} ACTIVE`}>
            {alerts.length === 0 && (
              <div className="text-[10.5px] text-[var(--dk-muted)]">
                no active signals — spot within bands, coverage on target
              </div>
            )}
            <div className="max-h-56 space-y-0 overflow-y-auto">
              {alerts.map((a) => {
                const c = a.severity === "buy" ? GOOD : a.severity === "warn" ? WARN : ACCENT;
                return (
                  <div
                    key={a.key}
                    className="grid grid-cols-[18px_1fr] gap-2 border-t py-2 first:border-t-0"
                    style={{ borderColor: "var(--dk-edge)" }}
                  >
                    <span
                      className="mt-px grid h-[18px] w-[18px] place-items-center rounded text-[10px] font-extrabold"
                      style={{ color: c, background: "var(--dk-panel-2)" }}
                    >
                      {a.severity === "buy" ? "↓" : a.severity === "warn" ? "!" : "i"}
                    </span>
                    <span className="text-[10.5px] leading-snug text-[var(--dk-ink-2)]">{a.message}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* blotter + ticket */}
        <Panel title="BLOTTER — OPEN PAPER POSITIONS" right={`${state.trades.length} OPEN`}>
          <div
            className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border p-2.5"
            style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel-2)" }}
          >
            <label className="flex flex-col gap-1 text-[9px] tracking-widest text-[var(--dk-muted)]">
              PRODUCT
              <select
                value={ticket.kind}
                onChange={(e) => setTicket({ ...ticket, kind: e.target.value as TradeKind })}
                className="rounded border bg-black/30 px-1.5 py-1 text-[11px]"
                style={{ borderColor: "var(--dk-edge)" }}
              >
                <option value="swap">swap (fixed)</option>
                <option value="cap">cap</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[9px] tracking-widest text-[var(--dk-muted)]">
              REGION
              <select
                value={ticket.region}
                onChange={(e) => setTicket({ ...ticket, region: e.target.value })}
                className="rounded border bg-black/30 px-1.5 py-1 text-[11px]"
                style={{ borderColor: "var(--dk-edge)" }}
              >
                {REGIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {short(r.code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-16 flex-col gap-1 text-[9px] tracking-widest text-[var(--dk-muted)]">
              MW
              <input type="number" min={0} step={1} value={ticket.mw} onChange={(e) => setTicket({ ...ticket, mw: Number(e.target.value) || 0 })} className={inputCls} style={{ borderColor: "var(--dk-edge)" }} />
            </label>
            <label className="flex w-20 flex-col gap-1 text-[9px] tracking-widest text-[var(--dk-muted)]">
              {ticket.kind === "swap" ? "FIXED $/MWH" : "STRIKE $/MWH"}
              <input type="number" min={0} step={5} value={ticket.strike} onChange={(e) => setTicket({ ...ticket, strike: Number(e.target.value) || 0 })} className={inputCls} style={{ borderColor: "var(--dk-edge)" }} />
            </label>
            {ticket.kind === "cap" && (
              <label className="flex w-20 flex-col gap-1 text-[9px] tracking-widest text-[var(--dk-muted)]">
                PREMIUM $/MWH
                <input type="number" min={0} step={1} value={ticket.premium} onChange={(e) => setTicket({ ...ticket, premium: Number(e.target.value) || 0 })} className={inputCls} style={{ borderColor: "var(--dk-edge)" }} />
              </label>
            )}
            <button
              onClick={bookTrade}
              className="rounded-lg px-3.5 py-1.5 text-[11px] font-bold tracking-wider text-white"
              style={{ background: ACCENT }}
            >
              BOOK
            </button>
            <span className="text-[9.5px] text-[var(--dk-muted)]">
              paper only — settles against live 5-min spot
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[11px]">
              <thead>
                <tr className="text-left text-[9px] tracking-widest text-[var(--dk-muted)]">
                  {["BOOKED", "PRODUCT", "REGION", "MW", "STRIKE", "MTM $/H", ""].map((h, i) => (
                    <th key={h + i} className={`border-b py-1.5 pr-3 font-semibold ${i >= 3 && i <= 5 ? "text-right" : ""}`} style={{ borderColor: "var(--dk-edge)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-[family-name:var(--f-mono)]">
                {state.trades.map((t) => {
                  const spot = live?.regions.find((r) => r.code === t.region)?.priceAUD ?? null;
                  const mtm = tradeMtmPerH(t, spot);
                  return (
                    <tr key={t.id} className="hover:bg-white/[0.03]">
                      <td className="border-b py-2 pr-3 text-[var(--dk-muted)]" style={{ borderColor: "var(--dk-edge)" }}>
                        {t.createdAt.slice(5, 16).replace("T", " ")}
                      </td>
                      <td className="border-b py-2 pr-3" style={{ borderColor: "var(--dk-edge)" }}>
                        {t.kind === "swap" ? "SWAP" : `CAP (+$${t.premiumAUD})`}
                      </td>
                      <td className="border-b py-2 pr-3" style={{ borderColor: "var(--dk-edge)" }}>
                        {short(t.region)}
                      </td>
                      <td className="border-b py-2 pr-3 text-right" style={{ borderColor: "var(--dk-edge)" }}>
                        {t.mw}
                      </td>
                      <td className="border-b py-2 pr-3 text-right" style={{ borderColor: "var(--dk-edge)" }}>
                        ${t.strikeAUD}
                      </td>
                      <td className="border-b py-2 pr-3 text-right font-semibold" style={{ borderColor: "var(--dk-edge)", color: mtm == null ? "var(--dk-muted)" : mtm >= 0 ? GOOD : BAD }}>
                        {mtm == null ? "—" : money(mtm)}
                      </td>
                      <td className="border-b py-2 text-right" style={{ borderColor: "var(--dk-edge)" }}>
                        <button onClick={() => dropTrade(t.id)} className="text-[10px] tracking-wider text-[var(--dk-muted)] hover:text-[var(--dk-ink)]">
                          CLOSE
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {state.trades.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-[10.5px] text-[var(--dk-muted)]">
                      no open positions — book a swap or cap above
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* book settings */}
        <div className="mt-3">
          <Panel
            title="RETAIL BOOK"
            right={
              <button onClick={() => setShowBook((s) => !s)} className="tracking-widest text-[var(--dk-ink-2)] hover:text-[var(--dk-ink)]">
                {showBook ? "COLLAPSE −" : "CONFIGURE +"}
              </button>
            }
          >
            <div className="text-[10.5px] text-[var(--dk-ink-2)]">
              {view ? (
                <>
                  Serving <span className="font-[family-name:var(--f-mono)]">{view.totalLoadMW.toFixed(0)} MW</span> of
                  flat-rate load at{" "}
                  <span className="font-[family-name:var(--f-mono)]">{state.book.flatRateCkwh}c/kWh</span> (
                  <span className="font-[family-name:var(--f-mono)]">
                    ${((state.book.flatRateCkwh - state.book.nonEnergyCkwh) * 10).toFixed(0)}/MWh
                  </span>{" "}
                  net of non-energy costs). This book is shared with the game&apos;s OPS desk.
                </>
              ) : (
                "loading…"
              )}
            </div>
            {showBook && (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {[
                  { l: "FLAT RATE c/kWh", v: state.book.flatRateCkwh, f: (v: number) => setBook({ flatRateCkwh: v }) },
                  { l: "NON-ENERGY c/kWh", v: state.book.nonEnergyCkwh, f: (v: number) => setBook({ nonEnergyCkwh: v }) },
                  { l: "TARGET COVER %", v: Math.round(state.book.targetCoverage * 100), f: (v: number) => setBook({ targetCoverage: v / 100 }) },
                  { l: "BUY SIGNAL $/MWh", v: state.book.buySignalAUD, f: (v: number) => setBook({ buySignalAUD: v }) },
                ].map((x) => (
                  <label key={x.l} className="flex flex-col gap-1 text-[9px] tracking-widest text-[var(--dk-muted)]">
                    {x.l}
                    <input type="number" value={x.v} onChange={(e) => x.f(Number(e.target.value) || 0)} className={inputCls} style={{ borderColor: "var(--dk-edge)" }} />
                  </label>
                ))}
                {REGIONS.map((r) => (
                  <label key={r.code} className="flex flex-col gap-1 text-[9px] tracking-widest text-[var(--dk-muted)]">
                    LOAD {short(r.code)} · MW
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={state.book.loadsMW[r.code] ?? 0}
                      onChange={(e) => setLoad(r.code, Number(e.target.value) || 0)}
                      className={inputCls}
                      style={{ borderColor: "var(--dk-edge)" }}
                    />
                  </label>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <p className="mt-5 text-center text-[9.5px] leading-relaxed text-[var(--dk-muted)]">
          MERIDIAN DESK runs the Energy Planet simulation engine against live AEMO / OpenElectricity data.
          All positions are paper, marked to the live 5-minute spot — no ASX Energy or AEMO settlement
          connectivity. Forward view is the LAB statistical model, not a traded curve. Not financial advice.
        </p>
      </div>
    </div>
  );
}
