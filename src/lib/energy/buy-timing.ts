import { isPeakHour } from "./desk";
import type { PricePoint } from "./history";
import { oeFetch } from "./sources";

// Prior-quarter procurement analytics: pull a full calendar quarter of hourly
// spot prices per region from the v4 market API (which caps 1h queries at 32
// days, so quarters are fetched in monthly chunks) and reduce them to the
// shapes a wholesale desk uses to time buying — hour-of-day × day-of-week
// average price surface, the cheapest contiguous window, peak/off-peak/base
// averages and negative-price frequency.

export interface QuarterInfo {
  /** e.g. "2026-Q1" */
  id: string;
  /** e.g. "Q1 2026" */
  label: string;
  year: number;
  quarter: number;
}

export interface QuarterPayload {
  quarter: QuarterInfo;
  intervalHours: 1;
  /** True when nothing could be fetched. */
  empty: boolean;
  regions: Record<string, PricePoint[]>;
}

/** Most recent fully-completed calendar quarters, newest first. */
export function recentQuarters(n = 4, now = new Date()): QuarterInfo[] {
  const out: QuarterInfo[] = [];
  let year = now.getUTCFullYear();
  let quarter = Math.floor(now.getUTCMonth() / 3) + 1; // current (incomplete)
  for (let i = 0; i < n; i++) {
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
    out.push({ id: `${year}-Q${quarter}`, label: `Q${quarter} ${year}`, year, quarter });
  }
  return out;
}

export function parseQuarterId(id: string): QuarterInfo | null {
  const m = id.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  return { id, label: `Q${quarter} ${year}`, year, quarter };
}

/** Naive network-time month boundaries covering the quarter (4 fenceposts). */
function monthBounds(q: QuarterInfo): string[] {
  const bounds: string[] = [];
  for (let i = 0; i <= 3; i++) {
    const m = (q.quarter - 1) * 3 + i; // 0-based month index
    const year = q.year + Math.floor(m / 12);
    const month = (m % 12) + 1;
    bounds.push(`${year}-${String(month).padStart(2, "0")}-01T00:00:00`);
  }
  return bounds;
}

/** Hourly spot prices per region for a full quarter (both networks). */
export async function fetchQuarterPrices(q: QuarterInfo): Promise<QuarterPayload> {
  const bounds = monthBounds(q);
  const regions: Record<string, PricePoint[]> = {};

  for (const network of ["NEM", "WEM"] as const) {
    for (let i = 0; i < 3; i++) {
      try {
        const env = await oeFetch(
          `/market/network/${network}`,
          {
            metrics: "price",
            interval: "1h",
            primary_grouping: "network_region",
            date_start: bounds[i],
            date_end: bounds[i + 1],
          },
          21600, // finished quarters are immutable — cache hard
        );
        const block = env.data.find((b) => b.metric === "price");
        for (const r of block?.results ?? []) {
          const code = r.columns.region ?? network;
          const arr = (regions[code] ??= []);
          for (const [ts, v] of r.data) {
            const ms = Date.parse(ts);
            if (Number.isFinite(ms) && typeof v === "number" && Number.isFinite(v)) arr.push([ms, v]);
          }
        }
      } catch {
        // missing chunk — analytics degrade gracefully on partial data
      }
    }
  }
  for (const code of Object.keys(regions)) regions[code].sort((a, b) => a[0] - b[0]);
  return {
    quarter: q,
    intervalHours: 1,
    empty: Object.values(regions).every((r) => r.length === 0),
    regions,
  };
}

// ---------------------------------------------------------------------------
// Analytics (pure — runs client-side on the fetched quarter)

export interface BuyWindow {
  /** AEST start hour of the cheapest contiguous window. */
  startHod: number;
  hours: number;
  avgAUD: number;
  /** Discount vs the base average, 0-1. */
  vsBase: number;
}

export interface BuyTimingStats {
  count: number;
  /** [dow 0=Mon..6=Sun][hod 0..23] average price (NaN when no samples). */
  grid: number[][];
  /** Hour-of-day profile across all days. */
  hodAvg: number[];
  hodP25: number[];
  hodP75: number[];
  baseAvg: number;
  peakAvg: number;
  offpeakAvg: number;
  /** Share of hours settling negative, 0-1. */
  negShare: number;
  /** Cheapest / most expensive contiguous windows on the average day. */
  cheapest: BuyWindow;
  dearest: { hod: number; avgAUD: number };
  /** Cell values at/below this are in the cheapest 15% (heatmap markers). */
  cheapCellCutoff: number;
  /** p95 of cell averages — colour-scale clamp so spikes don't wash it out. */
  cellP95: number;
}

const AEST_MS = 10 * 3600_000;

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(Math.floor(q * sorted.length), sorted.length - 1)];
}

export function analyzeBuyTiming(points: PricePoint[], windowH = 4): BuyTimingStats | null {
  if (points.length < 24 * 14) return null; // need a meaningful sample

  const sums = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const counts = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const byHod: number[][] = Array.from({ length: 24 }, () => []);
  let peakSum = 0;
  let peakN = 0;
  let offSum = 0;
  let offN = 0;
  let neg = 0;

  for (const [ts, v] of points) {
    const d = new Date(ts + AEST_MS);
    const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    const hod = d.getUTCHours();
    sums[dow][hod] += v;
    counts[dow][hod] += 1;
    byHod[hod].push(v);
    if (isPeakHour(ts)) {
      peakSum += v;
      peakN += 1;
    } else {
      offSum += v;
      offN += 1;
    }
    if (v < 0) neg += 1;
  }

  const grid = sums.map((row, d) => row.map((s, h) => (counts[d][h] > 0 ? s / counts[d][h] : NaN)));
  const hodAvg = byHod.map((a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN));
  const hodP25: number[] = [];
  const hodP75: number[] = [];
  for (const a of byHod) {
    const sorted = [...a].sort((x, y) => x - y);
    hodP25.push(quantileSorted(sorted, 0.25));
    hodP75.push(quantileSorted(sorted, 0.75));
  }

  const baseAvg = points.reduce((s, [, v]) => s + v, 0) / points.length;

  // Cheapest contiguous window on the average day (wrap-around allowed).
  let best = { startHod: 0, avg: Infinity };
  let worst = { hod: 0, avg: -Infinity };
  for (let h = 0; h < 24; h++) {
    let s = 0;
    for (let k = 0; k < windowH; k++) s += hodAvg[(h + k) % 24];
    const avg = s / windowH;
    if (avg < best.avg) best = { startHod: h, avg };
    if (hodAvg[h] > worst.avg) worst = { hod: h, avg: hodAvg[h] };
  }

  const cells = grid.flat().filter(Number.isFinite).sort((a, b) => a - b);

  return {
    count: points.length,
    grid,
    hodAvg,
    hodP25,
    hodP75,
    baseAvg,
    peakAvg: peakN ? peakSum / peakN : NaN,
    offpeakAvg: offN ? offSum / offN : NaN,
    negShare: neg / points.length,
    cheapest: {
      startHod: best.startHod,
      hours: windowH,
      avgAUD: best.avg,
      vsBase: baseAvg > 0 ? 1 - best.avg / baseAvg : 0,
    },
    dearest: { hod: worst.hod, avgAUD: worst.avg },
    cheapCellCutoff: quantileSorted(cells, 0.15),
    cellP95: quantileSorted(cells, 0.95),
  };
}
