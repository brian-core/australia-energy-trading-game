import {
  defaultCtx,
  retailLoadShape,
  tradePayoffPerH,
  type Book,
  type MarkCtx,
  type Trade,
} from "./desk";
import type { HistoryPayload, PricePoint } from "./history";
import { REGION_CAPACITY_MW } from "./scenario";
import type { SeriesPayload } from "./series";

// Backtest the current book + paper trades over a historic price window.
// "As-if" semantics: today's load, flat rate and open trades are assumed to
// have been in place for the whole window. Load is diurnally shaped (see
// desk.ts retailLoadShape); windowed products settle only in their hours.
// 30-min data prices cap convexity properly; the 90d daily series averages
// within the day, which understates cap payouts and window effects during
// short spikes — treat the long window as indicative.
//
// When a SeriesPayload is provided, PPA volumes use the region's actual
// historic wind/solar capacity factors; otherwise a stylised profile.

export interface BacktestRegion {
  code: string;
  hours: number;
  energyMWh: number;
  revenueAUD: number;
  energyCostAUD: number;
  marginAUD: number;
  marginPerMWh: number;
  /** Net settlement of price-fixing products (swaps, lfs, PPAs). */
  swapNetAUD: number;
  /** Net settlement of option-style products (caps, floors, collars). */
  capNetAUD: number;
  underwaterShare: number;
  avgPriceAUD: number;
  minPriceAUD: number;
  maxPriceAUD: number;
}

export interface BacktestResult {
  window: string;
  demo: boolean;
  regions: BacktestRegion[];
  revenueAUD: number;
  energyCostAUD: number;
  marginAUD: number;
  marginPerMWh: number;
  energyMWh: number;
  underwaterShare: number;
  /** Cumulative portfolio margin over time, downsampled for charting. */
  curve: PricePoint[];
}

const PRICE_FIXING = new Set(["swap", "lfs", "ppa"]);

/** Nearest-sample capacity-factor lookup from the 7-day series, or null. */
function cfLookup(
  series: SeriesPayload | undefined,
  code: string,
): ((ts: number) => { wind: number | null; solar: number | null }) | null {
  const region = series?.regions[code];
  const caps = REGION_CAPACITY_MW[code];
  if (!region || !caps) return null;
  const { startMs, windMW, solarMW } = region;
  const stepMs = region.intervalH * 3600_000;
  const at = (arr: number[], ts: number, capMW?: number): number | null => {
    if (!capMW || capMW <= 0) return null;
    const i = Math.round((ts - startMs) / stepMs);
    const v = arr[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    return Math.min(Math.max(v / capMW, 0), 1);
  };
  return (ts: number) => ({ wind: at(windMW, ts, caps.wind), solar: at(solarMW, ts, caps.solar) });
}

function intervalMargin(
  price: number,
  loadMW: number,
  trades: Trade[],
  netRetailAUD: number,
  ctx: MarkCtx,
): { margin: number; swapNet: number; capNet: number; servedMW: number } {
  let swapNet = 0;
  let capNet = 0;
  for (const t of trades) {
    const pay = tradePayoffPerH(t, price, ctx);
    if (PRICE_FIXING.has(t.kind)) swapNet += pay;
    else capNet += pay;
  }
  const servedMW = loadMW * retailLoadShape(ctx.ts);
  return { margin: (netRetailAUD - price) * servedMW + swapNet + capNet, swapNet, capNet, servedMW };
}

export function runBacktest(
  history: HistoryPayload,
  book: Book,
  trades: Trade[],
  series?: SeriesPayload,
): BacktestResult {
  const netRetailAUD = (book.flatRateCkwh - book.nonEnergyCkwh) * 10;
  const dt = history.intervalHours;
  const regions: BacktestRegion[] = [];
  const portfolioByTs = new Map<number, number>();

  for (const [code, points] of Object.entries(history.regions)) {
    const loadMW = book.loadsMW[code] ?? 0;
    if (loadMW <= 0 || points.length === 0) continue;
    const regionTrades = trades.filter((t) => t.region === code);
    const lookupCf = cfLookup(series, code);

    let revenue = 0;
    let margin = 0;
    let swapNet = 0;
    let capNet = 0;
    let energyMWh = 0;
    let underwater = 0;
    let priceSum = 0;
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const [ts, price] of points) {
      const base = defaultCtx(code, loadMW, ts);
      const real = lookupCf?.(ts);
      const ctx: MarkCtx = {
        ...base,
        cfWind: real?.wind ?? base.cfWind,
        cfSolar: real?.solar ?? base.cfSolar,
      };
      const m = intervalMargin(price, loadMW, regionTrades, netRetailAUD, ctx);
      revenue += netRetailAUD * m.servedMW * dt;
      energyMWh += m.servedMW * dt;
      margin += m.margin * dt;
      swapNet += m.swapNet * dt;
      capNet += m.capNet * dt;
      if (m.margin < 0) underwater++;
      priceSum += price;
      minPrice = Math.min(minPrice, price);
      maxPrice = Math.max(maxPrice, price);
      portfolioByTs.set(ts, (portfolioByTs.get(ts) ?? 0) + m.margin * dt);
    }

    const hours = points.length * dt;
    regions.push({
      code,
      hours,
      energyMWh,
      revenueAUD: revenue,
      energyCostAUD: revenue - margin,
      marginAUD: margin,
      marginPerMWh: energyMWh > 0 ? margin / energyMWh : 0,
      swapNetAUD: swapNet,
      capNetAUD: capNet,
      underwaterShare: points.length > 0 ? underwater / points.length : 0,
      avgPriceAUD: points.length > 0 ? priceSum / points.length : 0,
      minPriceAUD: minPrice,
      maxPriceAUD: maxPrice,
    });
  }

  const revenueAUD = regions.reduce((s, r) => s + r.revenueAUD, 0);
  const marginAUD = regions.reduce((s, r) => s + r.marginAUD, 0);
  const energyMWh = regions.reduce((s, r) => s + r.energyMWh, 0);

  // Cumulative curve across regions, downsampled to ~200 points.
  const sorted = [...portfolioByTs.entries()].sort((a, b) => a[0] - b[0]);
  let cum = 0;
  const full: PricePoint[] = sorted.map(([ts, m]) => {
    cum += m;
    return [ts, cum];
  });
  const stride = Math.max(1, Math.ceil(full.length / 200));
  const curve = full.filter((_, i) => i % stride === 0 || i === full.length - 1);

  const intervals = sorted.length;
  const underwaterIntervals = sorted.filter(([, m]) => m < 0).length;

  return {
    window: history.window,
    demo: history.demo,
    regions,
    revenueAUD,
    energyCostAUD: revenueAUD - marginAUD,
    marginAUD,
    marginPerMWh: energyMWh > 0 ? marginAUD / energyMWh : 0,
    energyMWh,
    underwaterShare: intervals > 0 ? underwaterIntervals / intervals : 0,
    curve,
  };
}
