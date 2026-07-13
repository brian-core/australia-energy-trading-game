"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PricePoint } from "@/lib/energy/history";

// Time-true price chart for the desk's forward view: historical actuals
// (line or OHLC candles) and the LAB forecast (P50 + P10-P90 band) share one
// continuous time axis, split by a "now" divider. Rendered at native pixel
// size via ResizeObserver so axes and text stay crisp at any panel width.

export interface ForecastSeries {
  t: number[];
  hat: number[];
  lo: number[];
  hi: number[];
}

export type ChartMode = "line" | "candles";

interface Candle {
  t: number; // bucket midpoint
  o: number;
  h: number;
  l: number;
  c: number;
}

const ACCENT = "#4d8dff";
const GOOD = "#35c285";
const BAD = "#f2555a";
const INK_MUTED = "var(--dk-muted, #667081)";
const GRID = "var(--dk-edge, rgba(255,255,255,0.09))";
const AEST_MS = 10 * 3600_000;

const PAD = { left: 46, right: 14, top: 10, bottom: 24 };

function buildCandles(pts: PricePoint[], bucketMs: number): Candle[] {
  const out: Candle[] = [];
  let cur: { t0: number; vals: number[] } | null = null;
  for (const [ts, v] of pts) {
    if (!Number.isFinite(v)) continue;
    const t0 = Math.floor(ts / bucketMs) * bucketMs;
    if (!cur || cur.t0 !== t0) {
      if (cur && cur.vals.length) out.push(toCandle(cur, bucketMs));
      cur = { t0, vals: [] };
    }
    cur.vals.push(v);
  }
  if (cur && cur.vals.length) out.push(toCandle(cur, bucketMs));
  return out;
}

function toCandle(b: { t0: number; vals: number[] }, bucketMs: number): Candle {
  return {
    t: b.t0 + bucketMs / 2,
    o: b.vals[0],
    c: b.vals[b.vals.length - 1],
    h: Math.max(...b.vals),
    l: Math.min(...b.vals),
  };
}

/** d3-style tick step: snaps range/count to 1/2/5 × 10^k by error threshold. */
function niceStep(range: number, count = 5): number {
  const raw = Math.max(range, 1e-9) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const err = raw / mag;
  return mag * (err >= 7.07 ? 10 : err >= 3.16 ? 5 : err >= 1.41 ? 2 : 1);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function xTickLabel(ts: number): string {
  const d = new Date(ts + AEST_MS);
  return `${DOW[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

export default function DeskChart({
  actual,
  forecast,
  mode,
  height = 280,
}: {
  actual: PricePoint[];
  forecast: ForecastSeries | null;
  mode: ChartMode;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [hover, setHover] = useState<number | null>(null); // hovered timestamp

  const model = useMemo(() => {
    const fc =
      forecast && forecast.t.length > 1
        ? forecast.t
            .map((ts, i) => ({ ts, hat: forecast.hat[i], lo: forecast.lo[i], hi: forecast.hi[i] }))
            .filter((p) => Number.isFinite(p.hat))
        : [];
    const act = actual.filter(([, v]) => Number.isFinite(v));
    if (act.length < 2 && fc.length < 2) return null;

    const candles = mode === "candles" ? buildCandles(act, 2 * 3600_000) : [];

    const tMin = Math.min(act[0]?.[0] ?? Infinity, fc[0]?.ts ?? Infinity);
    const tMax = Math.max(act[act.length - 1]?.[0] ?? -Infinity, fc[fc.length - 1]?.ts ?? -Infinity);
    const values = [
      ...act.map((p) => p[1]),
      ...fc.flatMap((p) => [p.hat, Number.isFinite(p.lo) ? p.lo : p.hat, Number.isFinite(p.hi) ? p.hi : p.hat]),
    ];
    let vMin = Math.min(...values);
    let vMax = Math.max(...values);
    const headroom = (vMax - vMin || 10) * 0.08;
    vMin -= headroom;
    vMax += headroom;
    if (vMin > 0 && vMin < (vMax - vMin) * 0.3) vMin = 0; // anchor near-zero charts at $0

    const step = niceStep(vMax - vMin);
    const yTicks: number[] = [];
    for (let v = Math.ceil(vMin / step) * step; v <= vMax; v += step) yTicks.push(v);

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const x = (ts: number) => PAD.left + ((ts - tMin) / (tMax - tMin || 1)) * plotW;
    const y = (v: number) => PAD.top + (1 - (v - vMin) / (vMax - vMin || 1)) * plotH;

    // 12-hourly ticks on AEST 00:00/12:00 boundaries.
    const twelveH = 12 * 3600_000;
    const first = Math.ceil((tMin + AEST_MS) / twelveH) * twelveH - AEST_MS;
    const xTicks: number[] = [];
    for (let ts = first; ts <= tMax; ts += twelveH) xTicks.push(ts);

    const line = (pts: Array<[number, number]>) =>
      pts.map(([ts, v], i) => `${i === 0 ? "M" : "L"}${x(ts).toFixed(1)},${y(v).toFixed(1)}`).join("");

    const actPath = mode === "line" ? line(act) : "";
    const fcPath = line(fc.map((p) => [p.ts, p.hat]));
    const bandPts = fc.filter((p) => Number.isFinite(p.lo) && Number.isFinite(p.hi));
    const bandPath =
      bandPts.length > 1
        ? `${line(bandPts.map((p) => [p.ts, p.hi]))}${[...bandPts]
            .reverse()
            .map((p) => `L${x(p.ts).toFixed(1)},${y(p.lo).toFixed(1)}`)
            .join("")}Z`
        : "";

    const nowTs = fc[0]?.ts ?? null;
    const candleW = candles.length > 0 ? Math.max((x(tMin + 2 * 3600_000) - x(tMin)) - 2, 2) : 0;

    return { act, fc, candles, tMin, tMax, x, y, yTicks, xTicks, actPath, fcPath, bandPath, nowTs, candleW, plotH };
  }, [actual, forecast, mode, width, height]);

  if (!model) {
    return (
      <div ref={wrapRef} className="grid place-items-center text-[10.5px] text-[var(--dk-muted)]" style={{ height }}>
        no chart data
      </div>
    );
  }

  const { act, fc, candles, x, y, yTicks, xTicks, actPath, fcPath, bandPath, nowTs, candleW, tMin, tMax } = model;

  // Hover readout: nearest sample on whichever side of "now" the cursor is.
  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const ts = tMin + ((ev.clientX - rect.left - PAD.left) / (width - PAD.left - PAD.right)) * (tMax - tMin);
    setHover(Math.min(Math.max(ts, tMin), tMax));
  };

  let tip: { x: number; y: number; lines: string[] } | null = null;
  if (hover != null) {
    if (nowTs != null && hover >= nowTs && fc.length) {
      let best = fc[0];
      for (const p of fc) if (Math.abs(p.ts - hover) < Math.abs(best.ts - hover)) best = p;
      tip = {
        x: x(best.ts),
        y: y(best.hat),
        lines: [
          `${xTickLabel(best.ts)} AEST · forecast`,
          `P50  $${best.hat.toFixed(0)}`,
          Number.isFinite(best.lo) && Number.isFinite(best.hi) ? `P10–P90  $${best.lo.toFixed(0)} – $${best.hi.toFixed(0)}` : "",
        ].filter(Boolean),
      };
    } else if (mode === "candles" && candles.length) {
      let best = candles[0];
      for (const c of candles) if (Math.abs(c.t - hover) < Math.abs(best.t - hover)) best = c;
      tip = {
        x: x(best.t),
        y: y(best.c),
        lines: [
          `${xTickLabel(best.t - 3600_000)} AEST · 2h candle`,
          `O $${best.o.toFixed(0)}  C $${best.c.toFixed(0)}`,
          `H $${best.h.toFixed(0)}  L $${best.l.toFixed(0)}`,
        ],
      };
    } else if (act.length) {
      let best = act[0];
      for (const p of act) if (Math.abs(p[0] - hover) < Math.abs(best[0] - hover)) best = p;
      tip = {
        x: x(best[0]),
        y: y(best[1]),
        lines: [`${xTickLabel(best[0])} AEST · actual`, `spot  $${best[1].toFixed(1)}`],
      };
    }
  }

  return (
    <div ref={wrapRef} className="relative" style={{ height }}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Price history and forecast">
        {/* y grid + labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 7} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED} className="font-[family-name:var(--f-mono)]">
              ${Math.round(v)}
            </text>
          </g>
        ))}
        {/* x ticks */}
        {xTicks.map((ts) => (
          <g key={ts}>
            <line x1={x(ts)} x2={x(ts)} y1={height - PAD.bottom} y2={height - PAD.bottom + 4} stroke={GRID} strokeWidth={1} />
            <text x={x(ts)} y={height - 8} textAnchor="middle" fontSize={9.5} fill={INK_MUTED} className="font-[family-name:var(--f-mono)]">
              {xTickLabel(ts)}
            </text>
          </g>
        ))}
        {/* now divider */}
        {nowTs != null && (
          <g>
            <line x1={x(nowTs)} x2={x(nowTs)} y1={PAD.top} y2={height - PAD.bottom} stroke={INK_MUTED} strokeWidth={1} strokeDasharray="3 4" />
            <text x={x(nowTs) + 4} y={PAD.top + 9} fontSize={9} fill={INK_MUTED}>
              now
            </text>
          </g>
        )}
        {/* forecast band + P50 */}
        {bandPath && <path d={bandPath} fill={ACCENT} opacity={0.16} />}
        {fcPath && <path d={fcPath} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" />}
        {fc.length > 0 && (
          <circle cx={x(fc[fc.length - 1].ts)} cy={y(fc[fc.length - 1].hat)} r={3.5} fill={ACCENT} />
        )}
        {/* actuals */}
        {mode === "line" && actPath && (
          <path d={actPath} fill="none" stroke="rgba(232,236,242,0.55)" strokeWidth={1.3} strokeLinejoin="round" />
        )}
        {mode === "candles" &&
          candles.map((c) => {
            const up = c.c >= c.o;
            const color = up ? GOOD : BAD;
            const bodyTop = y(Math.max(c.o, c.c));
            const bodyH = Math.max(Math.abs(y(c.o) - y(c.c)), 1.5);
            return (
              <g key={c.t}>
                <line x1={x(c.t)} x2={x(c.t)} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
                <rect x={x(c.t) - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} rx={1} opacity={0.9} />
              </g>
            );
          })}
        {/* hover crosshair */}
        {tip && (
          <g>
            <line x1={tip.x} x2={tip.x} y1={PAD.top} y2={height - PAD.bottom} stroke={ACCENT} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
            <circle cx={tip.x} cy={tip.y} r={3.5} fill="none" stroke={ACCENT} strokeWidth={1.5} />
          </g>
        )}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border px-2.5 py-1.5 text-[10px] leading-relaxed"
          style={{
            left: Math.min(Math.max(tip.x + 10, 0), width - 150),
            top: Math.max(tip.y - 14, 0),
            background: "var(--dk-panel-2, #161c27)",
            borderColor: "var(--dk-edge, rgba(255,255,255,0.14))",
          }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i === 0 ? "text-[var(--dk-muted)]" : "font-[family-name:var(--f-mono)]"}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
