"use client";

import { useEffect, useMemo, useState } from "react";
import {
  analyzeBuyTiming,
  recentQuarters,
  type QuarterInfo,
  type QuarterPayload,
} from "@/lib/energy/buy-timing";

// BUY TIMING — prior-quarter procurement analytics. Hour-of-day × day-of-week
// average price surface, the average-day profile with IQR band, and the
// cheapest contiguous buying window, computed client-side from the hourly
// quarter feed (/api/energy/quarter).

const ACCENT = "#4d8dff";
const GOOD = "#35c285";
const BAD = "#f2555a";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function h24(h: number): string {
  return `${String(h % 24).padStart(2, "0")}:00`;
}

/** Dark→accent ramp for the price surface (t clamped 0-1). */
function cellColor(t: number): string {
  const c = Math.min(Math.max(t, 0), 1);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * c);
  return `rgb(${mix(21, 77)}, ${mix(32, 141)}, ${mix(53, 255)})`;
}

function Heatmap({
  grid,
  cheapCutoff,
  p95,
}: {
  grid: number[][];
  cheapCutoff: number;
  p95: number;
}) {
  const W = 600;
  const H = 205;
  const x0 = 34;
  const y0 = 16;
  const cw = (W - x0 - 2) / 24;
  const ch = (H - y0 - 4) / 7;
  const vals = grid.flat().filter(Number.isFinite);
  const vMin = Math.min(...vals);
  const span = Math.max(p95 - vMin, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Average price by hour and weekday">
      {[0, 6, 12, 18].map((h) => (
        <text key={h} x={x0 + h * cw + cw / 2} y={11} textAnchor="middle" fontSize={9.5} fill="var(--dk-muted, #667081)" className="font-[family-name:var(--f-mono)]">
          {h24(h)}
        </text>
      ))}
      {grid.map((row, d) => (
        <g key={d}>
          <text x={x0 - 6} y={y0 + d * ch + ch / 2 + 3.5} textAnchor="end" fontSize={9.5} fill="var(--dk-muted, #667081)">
            {DOW[d]}
          </text>
          {row.map((v, h) => {
            if (!Number.isFinite(v)) return null;
            const cheap = v <= cheapCutoff;
            return (
              <g key={h}>
                <rect x={x0 + h * cw + 0.5} y={y0 + d * ch + 0.5} width={cw - 1} height={ch - 1} rx={2} fill={cellColor((v - vMin) / span)}>
                  <title>{`${DOW[d]} ${h24(h)} — avg $${v.toFixed(0)}/MWh${cheap ? " · cheapest 15%" : ""}`}</title>
                </rect>
                {cheap && <circle cx={x0 + h * cw + cw / 2} cy={y0 + d * ch + ch / 2} r={2.2} fill={GOOD} pointerEvents="none" />}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

function DayProfile({
  hodAvg,
  p25,
  p75,
  cheapStart,
  cheapHours,
}: {
  hodAvg: number[];
  p25: number[];
  p75: number[];
  cheapStart: number;
  cheapHours: number;
}) {
  const W = 600;
  const H = 150;
  const x0 = 34;
  const y1 = H - 18;
  const vals = [...hodAvg, ...p25, ...p75].filter(Number.isFinite);
  const vMin = Math.min(...vals, 0);
  const vMax = Math.max(...vals);
  const x = (h: number) => x0 + (h / 23) * (W - x0 - 6);
  const y = (v: number) => 8 + (1 - (v - vMin) / (vMax - vMin || 1)) * (y1 - 16);
  const line = (arr: number[]) =>
    arr.map((v, h) => `${h === 0 ? "M" : "L"}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const band = `${line(p75)}${p25
    .map((v, h) => ({ v, h }))
    .reverse()
    .map(({ v, h }) => `L${x(h).toFixed(1)},${y(v).toFixed(1)}`)
    .join("")}Z`;
  // Cheapest-window shading (may wrap midnight → two rectangles).
  const spans: Array<[number, number]> = [];
  const end = cheapStart + cheapHours;
  if (end <= 24) spans.push([cheapStart, end]);
  else {
    spans.push([cheapStart, 24]);
    spans.push([0, end - 24]);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Average day price profile">
      {spans.map(([a, b], i) => (
        <rect key={i} x={x(a)} y={8} width={Math.max(x(Math.min(b, 23)) - x(a), 4)} height={y1 - 16} fill={GOOD} opacity={0.1} />
      ))}
      {[vMin, (vMin + vMax) / 2, vMax].map((v, i) => (
        <g key={i}>
          <line x1={x0} x2={W - 6} y1={y(v)} y2={y(v)} stroke="var(--dk-edge, rgba(255,255,255,0.09))" strokeWidth={1} />
          <text x={x0 - 5} y={y(v) + 3.5} textAnchor="end" fontSize={9.5} fill="var(--dk-muted, #667081)" className="font-[family-name:var(--f-mono)]">
            ${Math.round(v)}
          </text>
        </g>
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={x(h)} y={H - 5} textAnchor="middle" fontSize={9.5} fill="var(--dk-muted, #667081)" className="font-[family-name:var(--f-mono)]">
          {h24(h)}
        </text>
      ))}
      <path d={band} fill={ACCENT} opacity={0.15} />
      <path d={line(hodAvg)} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

export default function BuyTimingPanel({ region }: { region: string }) {
  const quarters = useMemo(() => recentQuarters(4), []);
  const [quarterId, setQuarterId] = useState(quarters[0].id);
  const [windowH, setWindowH] = useState(4);
  const [data, setData] = useState<Record<string, QuarterPayload>>({});

  useEffect(() => {
    if (data[quarterId]) return;
    let dead = false;
    (async () => {
      let payload: QuarterPayload;
      try {
        const res = await fetch(`/api/energy/quarter?q=${quarterId}`);
        payload = (await res.json()) as QuarterPayload;
      } catch {
        // sentinel so the panel shows "unavailable" instead of loading forever
        const q = quarters.find((x: QuarterInfo) => x.id === quarterId)!;
        payload = { quarter: q, intervalHours: 1, empty: true, regions: {} };
      }
      if (!dead) setData((d) => ({ ...d, [quarterId]: payload }));
    })();
    return () => {
      dead = true;
    };
  }, [quarterId, data, quarters]);

  const payload = data[quarterId];
  const loading = !payload;
  const stats = useMemo(() => {
    const pts = payload?.regions[region];
    return pts ? analyzeBuyTiming(pts, windowH) : null;
  }, [payload, region, windowH]);

  const quarterLabel = quarters.find((q: QuarterInfo) => q.id === quarterId)?.label ?? quarterId;

  return (
    <section className="rounded-xl border p-3" style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel)" }}>
      <header className="mb-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <h2 className="text-[11px] font-semibold tracking-wide">
          BUY TIMING — {region.replace(/\d$/, "")} · {quarterLabel.toUpperCase()} ACTUALS
        </h2>
        <span className="inline-flex flex-wrap items-center gap-2 text-[9px] tracking-widest text-[var(--dk-muted)]">
          <span className="inline-flex gap-0.5 rounded-md border p-0.5" style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel-2)" }} role="group" aria-label="Quarter">
            {quarters.map((q: QuarterInfo) => (
              <button
                key={q.id}
                onClick={() => setQuarterId(q.id)}
                aria-pressed={quarterId === q.id}
                className="rounded px-2 py-0.5 text-[9px] font-semibold tracking-widest"
                style={quarterId === q.id ? { background: ACCENT, color: "#fff" } : { color: "var(--dk-ink-2)" }}
              >
                {q.label.replace(" 20", " ’")}
              </button>
            ))}
          </span>
          <span className="inline-flex gap-0.5 rounded-md border p-0.5" style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel-2)" }} role="group" aria-label="Window length">
            {[2, 4, 6].map((h) => (
              <button
                key={h}
                onClick={() => setWindowH(h)}
                aria-pressed={windowH === h}
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-widest"
                style={windowH === h ? { background: ACCENT, color: "#fff" } : { color: "var(--dk-ink-2)" }}
              >
                {h}H
              </button>
            ))}
          </span>
        </span>
      </header>

      {!stats ? (
        <div className="grid h-40 place-items-center text-[10.5px] text-[var(--dk-muted)]">
          {loading ? `loading ${quarterLabel} hourly actuals…` : payload?.empty ? "quarter data unavailable from the market API" : "insufficient data for this region/quarter"}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
          <div className="min-w-0 space-y-3">
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-[9.5px] text-[var(--dk-muted)]">
                <span>AVG $/MWH BY HOUR × WEEKDAY (AEST)</span>
                <span>
                  dark = cheap · bright = expensive · <span style={{ color: GOOD }}>●</span> cheapest 15%
                </span>
              </div>
              <Heatmap grid={stats.grid} cheapCutoff={stats.cheapCellCutoff} p95={stats.cellP95} />
            </div>
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-[9.5px] text-[var(--dk-muted)]">
                <span>AVERAGE DAY · P25–P75 BAND</span>
                <span style={{ color: GOOD }}>shaded = cheapest {windowH}h window</span>
              </div>
              <DayProfile
                hodAvg={stats.hodAvg}
                p25={stats.hodP25}
                p75={stats.hodP75}
                cheapStart={stats.cheapest.startHod}
                cheapHours={stats.cheapest.hours}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: "BASE AVG", v: `$${stats.baseAvg.toFixed(0)}`, c: "var(--dk-ink)" },
                { l: "PEAK AVG", v: `$${stats.peakAvg.toFixed(0)}`, c: BAD },
                { l: "OFF-PEAK AVG", v: `$${stats.offpeakAvg.toFixed(0)}`, c: GOOD },
              ].map((k) => (
                <div key={k.l} className="rounded-lg border p-2" style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel-2)" }}>
                  <div className="text-[8.5px] tracking-widest text-[var(--dk-muted)]">{k.l}</div>
                  <div className="mt-0.5 font-[family-name:var(--f-mono)] text-[15px] font-semibold" style={{ color: k.c }}>
                    {k.v}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border p-2.5" style={{ borderColor: "var(--dk-edge)", background: "var(--dk-panel-2)" }}>
              <div className="text-[8.5px] tracking-widest text-[var(--dk-muted)]">CHEAPEST {windowH}H WINDOW</div>
              <div className="mt-1 font-[family-name:var(--f-mono)] text-[17px] font-semibold" style={{ color: GOOD }}>
                {h24(stats.cheapest.startHod)}–{h24(stats.cheapest.startHod + stats.cheapest.hours)} AEST
              </div>
              <div className="mt-0.5 text-[10.5px] text-[var(--dk-ink-2)]">
                avg <span className="font-[family-name:var(--f-mono)]">${stats.cheapest.avgAUD.toFixed(0)}/MWh</span> ·{" "}
                {Math.round(stats.cheapest.vsBase * 100)}% below base
              </div>
            </div>

            <div className="space-y-1.5 text-[10.5px]">
              <div className="flex justify-between text-[var(--dk-ink-2)]">
                <span>dearest hour</span>
                <span className="font-[family-name:var(--f-mono)]" style={{ color: BAD }}>
                  {h24(stats.dearest.hod)} · ${stats.dearest.avgAUD.toFixed(0)}
                </span>
              </div>
              <div className="flex justify-between text-[var(--dk-ink-2)]">
                <span>peak / off-peak spread</span>
                <span className="font-[family-name:var(--f-mono)]">${(stats.peakAvg - stats.offpeakAvg).toFixed(0)}/MWh</span>
              </div>
              <div className="flex justify-between text-[var(--dk-ink-2)]">
                <span>negative-price hours</span>
                <span className="font-[family-name:var(--f-mono)]" style={{ color: stats.negShare > 0.05 ? GOOD : "var(--dk-ink)" }}>
                  {(stats.negShare * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between text-[var(--dk-ink-2)]">
                <span>sample</span>
                <span className="font-[family-name:var(--f-mono)]">{stats.count.toLocaleString()} hourly settlements</span>
              </div>
            </div>

            <p className="text-[10px] leading-relaxed text-[var(--dk-muted)]">
              Bias discretionary buying into the {h24(stats.cheapest.startHod)}–{h24(stats.cheapest.startHod + stats.cheapest.hours)}{" "}
              window and avoid locking volume through the {h24(Math.max(stats.dearest.hod - 1, 0))}–{h24(stats.dearest.hod + 2)} peak.
              Past quarter shape, not a forecast — structural change (outages, new capacity) shifts it.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
