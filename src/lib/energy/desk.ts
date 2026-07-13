import { REGION_CAPACITY_MW } from "./scenario";
import type { LivePayload, RegionLive } from "./types";

// Synthetic trading desk for a flat-rate energy subscription book.
//
// Everything here is simulation: trades are paper positions marked against
// the live 5-minute spot price. Nothing connects to ASX Energy or AEMO
// settlement. The anchor is the retail book — customers pay a flat c/kWh —
// and the desk shows how spot exposure and the hedge book land against it.
//
// Product set (NEM OTC/ASX conventions, simplified):
//  - swap    bought fixed-for-floating: receive (spot − strike) on contracted MW
//  - cap     bought: receive max(spot − strike, 0), pay premium
//  - floor   SOLD: receive premium, pay max(strike − spot, 0)
//  - collar  bought cap + sold floor, one net premium (can be negative)
//  - lfs     load-following swap: volume tracks a % of the region's actual
//            (diurnally shaped) retail load — kills shape risk
//  - ppa     as-generated offtake: volume follows a wind/solar capacity
//            factor; pays (spot − strike + LGC value) on generated MWh
//
// swap/cap/floor/collar carry a settlement window: base (all hours), peak
// (weekdays 07:00–22:00 AEST — the NEM convention; windows are evaluated in
// AEST market time for WEM too), or off-peak (the complement).

export type TradeKind = "swap" | "cap" | "floor" | "collar" | "lfs" | "ppa";
export type TradeWindow = "base" | "peak" | "offpeak";
export type PpaSource = "wind" | "solar";

export interface Trade {
  id: string;
  kind: TradeKind;
  region: string;
  /** Contracted volume, MW. Nameplate for PPAs; ignored for lfs (see loadPct). */
  mw: number;
  /** Fixed price (swap/lfs/ppa), cap strike, floor strike, or collar cap strike, $/MWh. */
  strikeAUD: number;
  /**
   * Premium, $/MWh on active volume. Caps pay it, sold floors receive it,
   * collars carry the net of both legs (negative = premium received).
   */
  premiumAUD: number;
  /** Settlement window (swap/cap/floor/collar). Default base. */
  window?: TradeWindow;
  /** Collar only: strike of the sold floor leg, $/MWh. */
  floorStrikeAUD?: number;
  /** Load-following swap only: share of the region's retail load, 0-1. */
  loadPct?: number;
  /** PPA only: generation source whose profile sets the volume. */
  source?: PpaSource;
  /** PPA only: LGC value credited per generated MWh, $/MWh. */
  lgcAUD?: number;
  createdAt: string;
}

export interface Book {
  /** What subscribers pay, c/kWh flat. */
  flatRateCkwh: number;
  /** Network, metering, retail opex etc., c/kWh — everything except energy. */
  nonEnergyCkwh: number;
  /** Hedge coverage target, 0-1. */
  targetCoverage: number;
  /** Spot below this is a "cheap, lock it in" signal, $/MWh. */
  buySignalAUD: number;
  /** Customer load by region code, MW (average demand). */
  loadsMW: Record<string, number>;
}

export const DEFAULT_BOOK: Book = {
  flatRateCkwh: 35,
  nonEnergyCkwh: 16,
  targetCoverage: 0.9,
  buySignalAUD: 80,
  loadsMW: { NSW1: 10, QLD1: 6, VIC1: 6, SA1: 2, TAS1: 0, WEM: 3 },
};

// ---------------------------------------------------------------------------
// Market time, settlement windows, volume profiles

const AEST_MS = 10 * 3600_000; // NEM runs on fixed AEST, no daylight saving

function aestHour(ts: number): number {
  const d = new Date(ts + AEST_MS);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function aestBusinessDay(ts: number): boolean {
  const dow = new Date(ts + AEST_MS).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** ASX/NEM peak convention: weekdays 07:00–22:00 AEST. */
export function isPeakHour(ts: number): boolean {
  const h = aestHour(ts);
  return aestBusinessDay(ts) && h >= 7 && h < 22;
}

function windowActive(window: TradeWindow | undefined, ts: number): boolean {
  if (!window || window === "base") return true;
  return window === "peak" ? isPeakHour(ts) : !isPeakHour(ts);
}

/** Share of calendar hours each window covers (peak: 15h × 5d of 168h). */
export const WINDOW_SHARE: Record<TradeWindow, number> = {
  base: 1,
  peak: 75 / 168,
  offpeak: 93 / 168,
};

/**
 * Normalised diurnal shape of a mixed retail load (mean exactly 1): morning
 * shoulder, deeper evening peak, overnight trough. Flat-MW book loads are
 * multiplied by this so shape risk exists for windows/LFS to hedge.
 */
const LOAD_SHAPE: number[] = (() => {
  const raw = Array.from({ length: 48 }, (_, i) => {
    const h = i / 2;
    return (
      0.78 +
      0.14 * Math.exp(-((h - 8) ** 2) / 7) +
      0.4 * Math.exp(-((h - 18.5) ** 2) / 9)
    );
  });
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
  return raw.map((v) => v / mean);
})();

export function retailLoadShape(ts: number): number {
  return LOAD_SHAPE[Math.min(47, Math.floor(aestHour(ts) * 2))];
}

/**
 * Deterministic stylised capacity factor for as-generated PPAs when no real
 * generation data is in reach: solar follows the sun, wind a slow pseudo-
 * random cycle seeded by region.
 */
export function syntheticCf(source: PpaSource, ts: number, region: string): number {
  const h = aestHour(ts);
  if (source === "solar") {
    const s = Math.sin((Math.PI * (h - 6)) / 13);
    return s > 0 ? Math.pow(s, 1.4) * 0.75 : 0;
  }
  const seed = region.charCodeAt(0) + (region.charCodeAt(1) ?? 0);
  const t = ts / 3600_000;
  const cf = 0.38 + 0.22 * Math.sin(t / 9.7 + seed) + 0.12 * Math.sin(t / 2.9 + seed * 1.7);
  return Math.min(Math.max(cf, 0.03), 0.92);
}

/** Long-run expected capacity factors used for coverage accounting. */
const PPA_EXPECTED_CF: Record<PpaSource, number> = { wind: 0.38, solar: 0.27 };

// ---------------------------------------------------------------------------
// Mark context + payoff engine

export interface MarkCtx {
  ts: number;
  /** Retailer's average load in the region, MW (drives lfs volume). */
  loadMW: number;
  /** Capacity factors for as-generated PPA volume, 0-1. */
  cfWind: number;
  cfSolar: number;
}

export function defaultCtx(region: string, loadMW = 0, ts = Date.now()): MarkCtx {
  return {
    ts,
    loadMW,
    cfWind: syntheticCf("wind", ts, region),
    cfSolar: syntheticCf("solar", ts, region),
  };
}

/** Mark context from the live payload: real regional cf, synthetic fallback. */
export function liveMarkCtx(region: RegionLive | null, loadMW: number, ts = Date.now()): MarkCtx {
  if (!region) return defaultCtx("XX", loadMW, ts);
  const caps = REGION_CAPACITY_MW[region.code];
  const gen = (tech: string) => region.fuelMix.find((s) => s.tech === tech)?.mw ?? 0;
  const cf = (mw: number, cap?: number, fallback?: number) =>
    cap && cap > 0 ? Math.min(mw / cap, 1) : fallback ?? 0;
  return {
    ts,
    loadMW,
    cfWind: cf(gen("wind"), caps?.wind, syntheticCf("wind", ts, region.code)),
    cfSolar: cf(gen("solar"), caps?.solar, syntheticCf("solar", ts, region.code)),
  };
}

/** Contract volume live this instant, MW (0 outside the trade's window). */
export function tradeVolumeMW(t: Trade, ctx: MarkCtx): number {
  switch (t.kind) {
    case "swap":
    case "cap":
    case "floor":
    case "collar":
      return windowActive(t.window, ctx.ts) ? t.mw : 0;
    case "lfs":
      return (t.loadPct ?? 0) * ctx.loadMW * retailLoadShape(ctx.ts);
    case "ppa":
      return t.mw * (t.source === "solar" ? ctx.cfSolar : ctx.cfWind);
  }
}

/** Cash the trade pays the desk this instant, $/h (negative = desk pays). */
export function tradePayoffPerH(t: Trade, spot: number, ctx: MarkCtx): number {
  const vol = tradeVolumeMW(t, ctx);
  if (vol <= 0) return 0;
  switch (t.kind) {
    case "swap":
    case "lfs":
      return (spot - t.strikeAUD) * vol;
    case "cap":
      return (Math.max(spot - t.strikeAUD, 0) - t.premiumAUD) * vol;
    case "floor":
      // Sold: premium in, payout when spot settles under the strike.
      return (t.premiumAUD - Math.max(t.strikeAUD - spot, 0)) * vol;
    case "collar":
      // Bought cap (strikeAUD) + sold floor (floorStrikeAUD), net premium.
      return (
        (Math.max(spot - t.strikeAUD, 0) -
          Math.max((t.floorStrikeAUD ?? 0) - spot, 0) -
          t.premiumAUD) *
        vol
      );
    case "ppa":
      // Pay the strike for as-generated energy worth spot, plus LGC value.
      return (spot - t.strikeAUD + (t.lgcAUD ?? 0)) * vol;
  }
}

/**
 * Time-averaged MW of price protection the trade gives the load, for the
 * coverage %: windowed products count their window share, lfs its load share,
 * PPAs their expected capacity factor. Sold floors protect nothing.
 */
export function tradeCoverMW(t: Trade, loadMW: number): number {
  switch (t.kind) {
    case "swap":
    case "cap":
    case "collar":
      return t.mw * WINDOW_SHARE[t.window ?? "base"];
    case "floor":
      return 0;
    case "lfs":
      return (t.loadPct ?? 0) * loadMW;
    case "ppa":
      return t.mw * PPA_EXPECTED_CF[t.source ?? "wind"];
  }
}

/** True for products that fix a price (vs option-style protection). */
function isPriceFixing(kind: TradeKind): boolean {
  return kind === "swap" || kind === "lfs" || kind === "ppa";
}

// ---------------------------------------------------------------------------
// Portfolio view

export interface RegionPosition {
  code: string;
  name: string;
  loadMW: number;
  spotAUD: number | null;
  /** Time-averaged price-fixing cover (swaps + lfs + expected PPA), MW. */
  swapMW: number;
  /** Time-averaged option-style cover (caps + collars), MW. */
  capMW: number;
  /** (swapMW + capMW) / loadMW, uncapped so over-hedging is visible. */
  coverage: number;
  unhedgedMW: number;
  /** $/h at current spot. */
  revenuePerH: number;
  energyCostPerH: number;
  marginPerH: number;
  /** Effective energy cost of serving the load, $/MWh. */
  effCostAUD: number | null;
  /** Margin per MWh served, after non-energy costs. */
  marginPerMWh: number | null;
  /** Margin $/h if spot spiked to the stress price. */
  stressMarginPerH: number;
}

export interface PortfolioView {
  regions: RegionPosition[];
  revenuePerH: number;
  energyCostPerH: number;
  marginPerH: number;
  marginPerDay: number;
  stressMarginPerH: number;
  totalLoadMW: number;
  coverage: number;
}

/** AEMO market price cap is ~$17,500; $10,000 is a plausible bad spike. */
export const STRESS_SPOT_AUD = 10000;

function regionEnergyCostPerH(
  spot: number,
  loadMW: number,
  trades: Trade[],
  ctx: MarkCtx,
): number {
  // Buy the (diurnally shaped) load at spot, then settle hedges financially.
  let cost = spot * loadMW * retailLoadShape(ctx.ts);
  for (const t of trades) cost -= tradePayoffPerH(t, spot, ctx);
  return cost;
}

export function computePositions(
  live: LivePayload,
  book: Book,
  trades: Trade[],
): PortfolioView {
  const now = Date.now();
  const regions = live.regions.map((region: RegionLive): RegionPosition => {
    const loadMW = book.loadsMW[region.code] ?? 0;
    const regionTrades = trades.filter((t) => t.region === region.code);
    const ctx = liveMarkCtx(region, loadMW, now);
    const swapMW = regionTrades
      .filter((t) => isPriceFixing(t.kind))
      .reduce((s, t) => s + tradeCoverMW(t, loadMW), 0);
    const capMW = regionTrades
      .filter((t) => !isPriceFixing(t.kind))
      .reduce((s, t) => s + tradeCoverMW(t, loadMW), 0);
    const spot = region.priceAUD;
    const shape = retailLoadShape(now);

    const revenueAUDperMWh = (book.flatRateCkwh - book.nonEnergyCkwh) * 10;
    const servedMW = loadMW * shape;
    const revenuePerH = revenueAUDperMWh * servedMW;
    const energyCostPerH =
      spot != null && loadMW > 0 ? regionEnergyCostPerH(spot, loadMW, regionTrades, ctx) : 0;
    const stressCostPerH =
      loadMW > 0 ? regionEnergyCostPerH(STRESS_SPOT_AUD, loadMW, regionTrades, ctx) : 0;
    const marginPerH = loadMW > 0 && spot != null ? revenuePerH - energyCostPerH : 0;

    return {
      code: region.code,
      name: region.name,
      loadMW,
      spotAUD: spot,
      swapMW,
      capMW,
      coverage: loadMW > 0 ? (swapMW + capMW) / loadMW : 0,
      unhedgedMW: Math.max(loadMW - swapMW - capMW, 0),
      revenuePerH,
      energyCostPerH,
      marginPerH,
      effCostAUD: loadMW > 0 && spot != null ? energyCostPerH / servedMW : null,
      marginPerMWh: loadMW > 0 && spot != null ? marginPerH / servedMW : null,
      stressMarginPerH: loadMW > 0 ? revenuePerH - stressCostPerH : 0,
    };
  });

  const active = regions.filter((r) => r.loadMW > 0 && r.spotAUD != null);
  const totalLoadMW = regions.reduce((s, r) => s + r.loadMW, 0);
  const hedgedMW = regions.reduce((s, r) => s + Math.min(r.swapMW + r.capMW, r.loadMW), 0);
  const revenuePerH = active.reduce((s, r) => s + r.revenuePerH, 0);
  const energyCostPerH = active.reduce((s, r) => s + r.energyCostPerH, 0);
  const marginPerH = revenuePerH - energyCostPerH;

  return {
    regions,
    revenuePerH,
    energyCostPerH,
    marginPerH,
    marginPerDay: marginPerH * 24,
    stressMarginPerH: regions.reduce((s, r) => s + r.stressMarginPerH, 0),
    totalLoadMW,
    coverage: totalLoadMW > 0 ? hedgedMW / totalLoadMW : 0,
  };
}

/** Instantaneous mark-to-market of one trade at current spot, $/h. */
export function tradeMtmPerH(
  trade: Trade,
  spot: number | null,
  ctx?: Partial<MarkCtx>,
): number | null {
  if (spot == null) return null;
  const full = { ...defaultCtx(trade.region), ...ctx };
  return tradePayoffPerH(trade, spot, full);
}

// ---------------------------------------------------------------------------
// Signal engine

export type AlertSeverity = "buy" | "warn" | "info";

export interface DeskAlert {
  /** Stable key for the condition so repeats don't re-notify every poll. */
  key: string;
  severity: AlertSeverity;
  region: string;
  message: string;
  at: string;
}

export function evaluateAlerts(view: PortfolioView, book: Book): DeskAlert[] {
  const alerts: DeskAlert[] = [];
  const now = new Date().toISOString();

  for (const r of view.regions) {
    if (r.loadMW <= 0 || r.spotAUD == null) continue;
    const short = r.name;
    const gapMW = Math.max(book.targetCoverage * r.loadMW - r.swapMW - r.capMW, 0);

    if (r.spotAUD < 0) {
      alerts.push({
        key: `${r.code}:negative`,
        severity: "info",
        region: r.code,
        at: now,
        message: `${short}: spot is NEGATIVE ($${r.spotAUD.toFixed(0)}/MWh) — unhedged load is being paid to consume; hold off locking swaps at panic prices.`,
      });
    } else if (r.spotAUD <= book.buySignalAUD && gapMW > 0.05) {
      alerts.push({
        key: `${r.code}:buy:${Math.round(gapMW * 10)}`,
        severity: "buy",
        region: r.code,
        at: now,
        message: `${short}: spot $${r.spotAUD.toFixed(0)}/MWh is at/below your $${book.buySignalAUD} buy signal and coverage is ${Math.round(r.coverage * 100)}% (target ${Math.round(book.targetCoverage * 100)}%). Consider a swap ≈ ${gapMW.toFixed(1)} MW near $${Math.round(r.spotAUD + 10)}/MWh.`,
      });
    }

    if (r.spotAUD > 300 && r.unhedgedMW > 0.05) {
      alerts.push({
        key: `${r.code}:spike`,
        severity: "warn",
        region: r.code,
        at: now,
        message: `${short}: spot $${r.spotAUD.toFixed(0)}/MWh with ${r.unhedgedMW.toFixed(1)} MW unhedged — bleeding ≈ $${Math.round((r.spotAUD - (book.flatRateCkwh - book.nonEnergyCkwh) * 10) * r.unhedgedMW).toLocaleString()}/h. Caps would stop this.`,
      });
    }

    if (r.marginPerH < 0 && r.spotAUD <= 300) {
      alerts.push({
        key: `${r.code}:negmargin`,
        severity: "warn",
        region: r.code,
        at: now,
        message: `${short}: serving at a loss right now (${Math.round(r.marginPerH).toLocaleString()} $/h) — effective cost $${r.effCostAUD?.toFixed(0)}/MWh vs net retail $${((book.flatRateCkwh - book.nonEnergyCkwh) * 10).toFixed(0)}/MWh.`,
      });
    }
  }

  // Portfolio-level stress check: would a $10k spike wipe you out?
  if (view.totalLoadMW > 0 && view.stressMarginPerH < -50_000) {
    alerts.push({
      key: `portfolio:stress`,
      severity: "warn",
      region: "ALL",
      at: now,
      message: `Stress test: a $${STRESS_SPOT_AUD.toLocaleString()}/MWh spike would cost ≈ $${Math.round(-view.stressMarginPerH).toLocaleString()}/h at current hedge levels. Caps close this tail.`,
    });
  }

  return alerts;
}
