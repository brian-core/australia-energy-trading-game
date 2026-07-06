"use client";

// LAB: weather ↔ grid analytics and the forward simulation ("time travel").
// All statistics are transparent fits over the last 7 days of real data —
// see lib/energy/forecast.ts. Forecasts can be snapshotted and are graded
// against reality as it arrives.

import { useEffect, useMemo, useState } from "react";
import { runBacktest } from "@/lib/energy/backtest";
import { loadDeskState } from "@/lib/energy/desk-storage";
import {
  buildForecast,
  loadSnapshots,
  saveSnapshots,
  scoreSnapshot,
  type ForecastResult,
  type LabSnapshot,
} from "@/lib/energy/forecast";
import type { HistoryPayload, PricePoint } from "@/lib/energy/history";
import { priceColor } from "@/lib/energy/pricing";
import type { MacroPayload } from "@/lib/energy/macro";
import type { SeriesPayload } from "@/lib/energy/series";
import type { WeatherPayload } from "@/lib/energy/weather";
import PriceChart from "./price-chart";

function fmt(v: number, digits = 0): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function corrColor(r: number): string {
  if (!Number.isFinite(r)) return "var(--ink-soft)";
  const a = Math.abs(r);
  if (a >= 0.6) return r > 0 ? "#48a87c" : "#e2483d";
  if (a >= 0.3) return "#f2c14e";
  return "var(--ink-soft)";
}

const REGION_CODES = ["NSW1", "QLD1", "VIC1", "SA1", "TAS1", "WEM"];

export default function LabPanel() {
  const [series, setSeries] = useState<SeriesPayload | null>(null);
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [macro, setMacro] = useState<MacroPayload | null>(null);
  const [error, setError] = useState(false);
  const [region, setRegion] = useState("NSW1");
  const [horizon, setHorizon] = useState<24 | 48 | 72>(48);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [snaps, setSnaps] = useState<LabSnapshot[]>(() =>
    typeof window === "undefined" ? [] : loadSnapshots(),
  );
  // Clock captured once per mount/refresh so render stays pure.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const clock = setInterval(() => setNowMs(Date.now()), 60_000);
    let cancelled = false;
    void (async () => {
      try {
        const [s, w, m] = await Promise.all([
          fetch("/api/energy/series").then((r) => r.json() as Promise<SeriesPayload>),
          fetch("/api/energy/weather").then((r) => r.json() as Promise<WeatherPayload>),
          fetch("/api/energy/macro").then((r) => r.json() as Promise<MacroPayload>).catch(() => null),
        ]);
        if (!cancelled) {
          setSeries(s);
          setWeather(w);
          setMacro(m);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(clock);
    };
  }, []);

  const forecast: ForecastResult | null = useMemo(
    () => (series && weather ? buildForecast(series, weather, horizon) : null),
    [series, weather, horizon],
  );
  const rf = forecast?.regions[region];
  const fit = rf?.fit;
  const cursorIdx = rf ? Math.min(cursor, rf.t.length - 1) : 0;

  // Time-travel playback.
  useEffect(() => {
    if (!playing || !rf) return;
    const id = setInterval(() => {
      setCursor((c) => (c + 1 >= rf.t.length ? 0 : c + 1));
    }, 120);
    return () => clearInterval(id);
  }, [playing, rf]);


  // Desk-on-forecast: your current book + trades held across the simulated window.
  const deskOnForecast = useMemo(() => {
    if (!forecast) return null;
    const desk = loadDeskState();
    const regions: Record<string, PricePoint[]> = {};
    for (const [code, f] of Object.entries(forecast.regions)) {
      regions[code] = f.t.map((ts, i) => [ts, f.priceHat[i]] as PricePoint);
    }
    const payload: HistoryPayload = { window: "7d", intervalHours: 0.5, demo: true, regions };
    return runBacktest(payload, desk.book, desk.trades);
  }, [forecast]);

  const takeSnapshot = () => {
    if (!forecast) return;
    const snap: LabSnapshot = {
      id: `${Date.now()}`,
      createdAt: forecast.createdAt,
      horizonH: forecast.horizonH,
      regions: Object.fromEntries(
        Object.entries(forecast.regions).map(([code, f]) => [
          code,
          {
            t: f.t,
            priceHat: f.priceHat,
            demandHat: f.demandHat,
            windHat: f.windHat,
            solarHat: f.solarHat,
            // Keep the MC fan so the snapshot can be calibration-scored.
            ...(f.mc ? { priceP10: f.mc.p10, priceP90: f.mc.p90 } : {}),
          },
        ]),
      ),
    };
    const next = [...snaps, snap];
    setSnaps(next);
    saveSnapshots(next);
  };

  const chartPoints = useMemo<PricePoint[]>(
    () => (rf ? rf.t.map((ts, i) => [ts, rf.priceHat[i]]) : []),
    [rf],
  );
  // Monte-Carlo fan (P10-P90 outer, P25-P75 inner) when the history supports
  // it; the fitted ±1σ band otherwise.
  const chartBands = useMemo(() => {
    if (!rf) return undefined;
    const track = (v: number[]) => rf.t.map((ts, i) => [ts, v[i]] as PricePoint);
    if (rf.mc) {
      return [
        { lo: track(rf.mc.p10), hi: track(rf.mc.p90), opacity: 0.1 },
        { lo: track(rf.mc.p25), hi: track(rf.mc.p75), opacity: 0.18 },
      ];
    }
    return [{ lo: track(rf.priceLo), hi: track(rf.priceHi) }];
  }, [rf]);

  if (error) return <div className="text-[11px] text-[var(--ink-soft)]">lab feeds unavailable</div>;
  if (!series || !weather || !rf || !fit)
    return <div className="text-[11px] text-[var(--ink-soft)]">fitting models to the last 7 days…</div>;

  const wNow = weather.regions[region];
  const nowI = Math.max(wNow.nowIdx - 1, 0);
  const cur = {
    ts: rf.t[cursorIdx],
    price: rf.priceHat[cursorIdx],
    demand: rf.demandHat[cursorIdx],
    wind: rf.windHat[cursorIdx],
    solar: rf.solarHat[cursorIdx],
    temp: rf.tempC[cursorIdx],
    windMs: rf.windMs[cursorIdx],
  };

  return (
    <div className="space-y-3 font-[family-name:var(--f-mono)] text-xs">
      <div className="text-[10px] leading-snug tracking-widest text-[var(--ink-soft)]">
        LAB — WEATHER↔GRID STATISTICS AND A FORWARD SIMULATION. TRANSPARENT FITS, NOT AI.
        {(series.demo || weather.demo) && " · SYNTHETIC FEEDS"}
      </div>

      <div className="flex flex-wrap gap-1">
        {REGION_CODES.map((c) => (
          <button
            key={c}
            onClick={() => setRegion(c)}
            className="rounded border px-1.5 py-0.5 text-[10px] tracking-wider"
            style={
              c === region
                ? { background: "var(--gen)", color: "#0b0d11", borderColor: "var(--gen)" }
                : { color: "var(--ink-soft)", borderColor: "var(--edge)" }
            }
          >
            {c.replace(/\d$/, "")}
          </button>
        ))}
      </div>

      {/* Weather now */}
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1 text-[11px] tracking-widest text-[var(--ink-soft)]">WEATHER NOW</div>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <div className="text-base">{fmt(wNow.capital.tempC[nowI], 1)}°C</div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">CAPITAL TEMP</div>
          </div>
          <div>
            <div className="text-base">{fmt(wNow.belt.windMs[nowI], 1)} m/s</div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">BELT WIND 100M</div>
          </div>
          <div>
            <div className="text-base">{fmt(wNow.belt.radWm2[nowI])} W/m²</div>
            <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">SOLAR RADIATION</div>
          </div>
        </div>
      </div>

      {/* Correlations + fits */}
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 text-[11px] tracking-widest text-[var(--ink-soft)]">
          7-DAY CORRELATIONS (PEARSON r, SPIKE-TRIMMED)
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          {(
            [
              ["price ↔ demand", fit.corr.priceDemand],
              ["price ↔ temp", fit.corr.priceTemp],
              ["price ↔ wind", fit.corr.priceWind],
              ["price ↔ solar rad", fit.corr.priceSolar],
              ["demand ↔ temp", fit.corr.demandTemp],
              ["wind gen ↔ wind", fit.corr.windGenWind],
              ["solar gen ↔ rad", fit.corr.solarGenRad],
            ] as const
          ).map(([label, r]) => (
            <div key={label} className="flex justify-between">
              <span className="text-[var(--ink-soft)]">{label}</span>
              <span style={{ color: corrColor(r) }}>{fmt(r, 2)}</span>
            </div>
          ))}
          <div className="flex justify-between">
            <span className="text-[var(--ink-soft)]">price σ</span>
            <span>${fmt(fit.sigma.price)}</span>
          </div>
        </div>
        <div className="mt-2 border-t pt-1.5 text-[10px] leading-relaxed text-[var(--ink-soft)]" style={{ borderColor: "var(--edge)" }}>
          fitted models: price ~ {fit.priceModel.basis === "utilisation" ? "thermal utilisation" : fit.priceModel.basis === "residual" ? "residual demand" : "hour-of-day profile (regressions weak this week)"}
          {" "}(R² {fmt(fit.priceModel.r2, 2)}) · demand R² {fmt(fit.demandModel.r2, 2)} (+
          {fmt(fit.demandModel.coolPerDeg)} MW/°C cooling) · wind R² {fmt(fit.windModel.r2, 2)} ·
          solar R² {fmt(fit.solarModel.r2, 2)}
        </div>
      </div>

      {/* Outage watch */}
      {fit.outage.peak7dMW > 250 && (
        <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] tracking-widest text-[var(--ink-soft)]">
              OUTAGE WATCH — THERMAL FLEET
            </span>
            {fit.outage.impliedOutMW > fit.outage.peak7dMW * 0.08 ? (
              <span className="rounded px-1.5 py-0.5 text-[10px] tracking-widest" style={{ background: "#e2483d", color: "#0b0d11" }}>
                CAPACITY DOWN
              </span>
            ) : (
              <span className="text-[10px] tracking-widest" style={{ color: "var(--gen)" }}>NORMAL</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <div className="text-base">{(fit.outage.availNowMW / 1000).toFixed(1)} GW</div>
              <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">AVAILABLE NOW</div>
            </div>
            <div>
              <div className="text-base">{(fit.outage.peak7dMW / 1000).toFixed(1)} GW</div>
              <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">7-DAY PEAK</div>
            </div>
            <div>
              <div className="text-base" style={{ color: fit.outage.impliedOutMW > fit.outage.peak7dMW * 0.08 ? "#e2483d" : "var(--ink)" }}>
                {fit.outage.impliedOutMW} MW
              </div>
              <div className="text-[10px] tracking-widest text-[var(--ink-soft)]">IMPLIED OFFLINE</div>
            </div>
          </div>
          <div className="mt-1.5 text-[10px] leading-snug text-[var(--ink-soft)]">
            availability = rolling 48h max of coal+gas output. Lost capacity feeds straight into
            the price model{fit.priceModel.basis === "utilisation" ? " (active)" : ""} — today&apos;s trip raises the whole forward curve.
          </div>
        </div>
      )}

      {/* Macro context */}
      {macro && (
        <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
          <div className="mb-1 text-[11px] tracking-widest text-[var(--ink-soft)]">MACRO CONTEXT</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[var(--ink-soft)]">AUD/USD {macro.fx.live ? "· live" : "· ref"}</span>
              <span>{macro.fx.audUsd.toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ink-soft)]">AUD/EUR</span>
              <span>{macro.fx.audEur.toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ink-soft)]">CPI yoy {macro.cpi.live ? "· ABS" : "· ref"}</span>
              <span>{macro.cpi.yoyPct.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ink-soft)]">coal (NEWC) · ref</span>
              <span>US${macro.fuels.newcastleCoalUsdT}/t</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ink-soft)]">gas (east coast) · ref</span>
              <span>A${macro.fuels.eastCoastGasAudGj}/GJ</span>
            </div>
            {macro.fx.trend.length > 3 && (
              <div className="flex justify-between">
                <span className="text-[var(--ink-soft)]">AUD/USD 90d</span>
                <span style={{ color: macro.fx.trend[macro.fx.trend.length - 1][1] >= macro.fx.trend[0][1] ? "var(--gen)" : "#e2483d" }}>
                  {(((macro.fx.trend[macro.fx.trend.length - 1][1] / macro.fx.trend[0][1]) - 1) * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
          <div className="mt-1.5 text-[10px] leading-snug text-[var(--ink-soft)]">
            fuel costs and FX set the price level over weeks (they shift coal/gas marginal cost in
            AUD); weather and outages drive the 72h curve. Reference values are maintained, not
            live — labelled accordingly.
          </div>
        </div>
      )}

      {/* Time travel */}
      <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] tracking-widest text-[var(--ink-soft)]">
            TIME TRAVEL — PRICE FORECAST {rf.mc ? `· MC ×${rf.mc.runs} P10–P90` : "±1σ"}
          </span>
          <div className="flex overflow-hidden rounded border" style={{ borderColor: "var(--edge)" }}>
            {([24, 48, 72] as const).map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className="px-1.5 py-0.5 text-[10px] tracking-widest"
                style={
                  horizon === h
                    ? { background: "var(--gen)", color: "#0b0d11" }
                    : { color: "var(--ink-soft)" }
                }
              >
                {h}H
              </button>
            ))}
          </div>
        </div>
        <PriceChart points={chartPoints} bands={chartBands} color={priceColor(cur.price)} />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded px-2 py-0.5 text-[11px] tracking-widest"
            style={{ background: "var(--gen)", color: "#0b0d11" }}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={rf.t.length - 1}
            value={cursorIdx}
            onChange={(e) => setCursor(Number(e.target.value))}
            className="flex-1"
          />
        </div>
        <div className="mt-1.5 text-[11px] text-[var(--ink-soft)]">
          <span className="text-[var(--ink)]">
            {new Date(cur.ts).toLocaleString("en-AU", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>{" "}
          · spot <span style={{ color: priceColor(cur.price) }}>${fmt(cur.price)}</span>
          {rf.mc && (
            <>
              {" "}
              <span className="text-[10px]">
                (P10 ${fmt(rf.mc.p10[cursorIdx])} – P90 ${fmt(rf.mc.p90[cursorIdx])})
              </span>
            </>
          )}{" "}
          · load {fmt(cur.demand / 1000, 1)} GW · wind {fmt(cur.wind)} MW · solar {fmt(cur.solar)} MW ·{" "}
          {fmt(cur.temp, 1)}°C / {fmt(cur.windMs, 1)} m/s
        </div>
        {deskOnForecast && (
          <div className="mt-1.5 border-t pt-1.5 text-[11px]" style={{ borderColor: "var(--edge)" }}>
            <span className="text-[var(--ink-soft)]">your DESK book over this window: </span>
            <span style={{ color: deskOnForecast.marginAUD >= 0 ? "var(--gen)" : "#e2483d" }}>
              {deskOnForecast.marginAUD >= 0 ? "+" : "−"}$
              {Math.abs(deskOnForecast.marginAUD / 1000).toFixed(1)}k
            </span>
            <span className="text-[var(--ink-soft)]">
              {" "}
              simulated margin · {Math.round(deskOnForecast.underwaterShare * 100)}% underwater
            </span>
          </div>
        )}
        <div className="mt-1.5 flex items-center justify-between">
          <button
            onClick={takeSnapshot}
            className="rounded border px-2 py-0.5 text-[10px] tracking-widest text-[var(--ink-soft)]"
            style={{ borderColor: "var(--edge)" }}
          >
            ◉ SNAPSHOT THIS FORECAST
          </button>
          <span className="text-[10px] text-[var(--ink-soft)]">graded as reality catches up</span>
        </div>
      </div>

      {/* Variance scorecard */}
      {snaps.length > 0 && (
        <div className="rounded-lg border p-3.5" style={{ borderColor: "var(--edge)" }}>
          <div className="mb-1.5 text-[11px] tracking-widest text-[var(--ink-soft)]">
            SCORECARD — SYNTHESISED VS WHAT ACTUALLY HAPPENED ({region.replace(/\d$/, "")})
          </div>
          <div className="space-y-2.5">
            {[...snaps].reverse().map((snap) => {
              const score = scoreSnapshot(snap, series, region, nowMs);
              const age = (nowMs - snap.createdAt) / 3600_000;
              return (
                <div key={snap.id} className="text-[11px]">
                  <div className="flex justify-between text-[var(--ink-soft)]">
                    <span>
                      {new Date(snap.createdAt).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{" "}
                      · {snap.horizonH}h
                    </span>
                    <span className="flex items-center gap-2">
                      <span>{score ? `${Math.round(score.coverage * 100)}% elapsed` : "—"}</span>
                      <button
                        onClick={() => {
                          const next = snaps.filter((x) => x.id !== snap.id);
                          setSnaps(next);
                          saveSnapshots(next);
                        }}
                        className="hover:text-[#e2483d]"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {score && score.coverage > 0.04 && score.rows[0].n > 2 ? (
                    <table className="mt-1 w-full">
                      <thead>
                        <tr className="text-left text-[10px] tracking-wider text-[var(--ink-soft)]">
                          <th>VAR</th>
                          <th className="text-right">MAE</th>
                          <th className="text-right">RMSE</th>
                          <th className="text-right">BIAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {score.rows.map((row) => (
                          <tr key={row.variable}>
                            <td className="text-[var(--ink-soft)]">{row.variable}</td>
                            <td className="text-right">{fmt(row.mae)}</td>
                            <td className="text-right">{fmt(row.rmse)}</td>
                            <td className="text-right" style={{ color: Math.abs(row.bias) > row.mae * 0.6 ? "#f2c14e" : "var(--ink-soft)" }}>
                              {row.bias > 0 ? "+" : ""}
                              {fmt(row.bias)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {score.fan && (
                        <tfoot>
                          <tr>
                            <td colSpan={4} className="pt-0.5 text-[10px] text-[var(--ink-soft)]">
                              fan calibration: price inside P10–P90{" "}
                              <span
                                style={{
                                  color:
                                    score.fan.hitRate >= 0.6 && score.fan.hitRate <= 0.95
                                      ? "var(--gen)"
                                      : "#f2c14e",
                                }}
                              >
                                {Math.round(score.fan.hitRate * 100)}%
                              </span>{" "}
                              of {score.fan.n} steps · target ~80%
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  ) : (
                    <div className="mt-0.5 text-[10px] text-[var(--ink-soft)]">
                      too young to grade — check back in {fmt(Math.max(1 - age, 0.02) * 60 + 30)} min
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 border-t pt-1.5 text-[10px] leading-snug text-[var(--ink-soft)]" style={{ borderColor: "var(--edge)" }}>
            MAE/RMSE in native units ($/MWh, MW) over the elapsed part of each forecast. Bias &gt; 0
            = the simulation ran hot.
          </div>
        </div>
      )}
    </div>
  );
}
