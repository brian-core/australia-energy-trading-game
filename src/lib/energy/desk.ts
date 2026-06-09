import type { LivePayload, RegionLive } from "./types";

// Synthetic trading desk for a flat-rate energy subscription book.
//
// Everything here is simulation: trades are paper positions marked against
// the live 5-minute spot price. Nothing connects to ASX Energy or AEMO
// settlement. The anchor is the retail book — customers pay a flat c/kWh —
// and the desk shows how spot exposure, swaps and caps land against it.

export type TradeKind = "swap" | "cap";

export interface Trade {
  id: string;
  kind: TradeKind;
  region: string;
  /** Contracted volume. */
  mw: number;
  /** Swap fixed price, or cap strike, $/MWh. */
  strikeAUD: number;
  /** Cap premium, $/MWh on contracted volume (caps only). */
  premiumAUD: number;
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

export interface RegionPosition {
  code: string;
  name: string;
  loadMW: number;
  spotAUD: number | null;
  swapMW: number;
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
): number {
  // Buy the whole load at spot, then settle hedges financially:
  //  - swap: counterparty pays us (spot - strike) on contracted MW
  //  - cap: pays max(spot - strike, 0) on contracted MW, costs premium
  let cost = spot * loadMW;
  for (const t of trades) {
    if (t.kind === "swap") {
      cost -= (spot - t.strikeAUD) * t.mw;
    } else {
      cost -= Math.max(spot - t.strikeAUD, 0) * t.mw - t.premiumAUD * t.mw;
    }
  }
  return cost;
}

export function computePositions(
  live: LivePayload,
  book: Book,
  trades: Trade[],
): PortfolioView {
  const regions = live.regions.map((region: RegionLive): RegionPosition => {
    const loadMW = book.loadsMW[region.code] ?? 0;
    const regionTrades = trades.filter((t) => t.region === region.code);
    const swapMW = regionTrades.filter((t) => t.kind === "swap").reduce((s, t) => s + t.mw, 0);
    const capMW = regionTrades.filter((t) => t.kind === "cap").reduce((s, t) => s + t.mw, 0);
    const spot = region.priceAUD;

    const revenueAUDperMWh = (book.flatRateCkwh - book.nonEnergyCkwh) * 10;
    const revenuePerH = revenueAUDperMWh * loadMW;
    const energyCostPerH =
      spot != null && loadMW > 0 ? regionEnergyCostPerH(spot, loadMW, regionTrades) : 0;
    const stressCostPerH =
      loadMW > 0 ? regionEnergyCostPerH(STRESS_SPOT_AUD, loadMW, regionTrades) : 0;
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
      effCostAUD: loadMW > 0 && spot != null ? energyCostPerH / loadMW : null,
      marginPerMWh: loadMW > 0 && spot != null ? marginPerH / loadMW : null,
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
export function tradeMtmPerH(trade: Trade, spot: number | null): number | null {
  if (spot == null) return null;
  if (trade.kind === "swap") return (spot - trade.strikeAUD) * trade.mw;
  return (Math.max(spot - trade.strikeAUD, 0) - trade.premiumAUD) * trade.mw;
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
