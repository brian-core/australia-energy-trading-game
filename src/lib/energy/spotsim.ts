// Structural 12-month spot-price simulator — the long-horizon answer to
// "historical + randomness". Instead of bootstrapping past prices, it
// simulates the PHYSICAL drivers at daily resolution and lets price emerge:
//
//   1. FLEET AVAILABILITY — every registered coal/gas station is split into
//      realistic unit blocks; each unit runs a daily Markov chain: forced
//      trips (fuel-specific rates), lognormal repair times, a small
//      catastrophic tail (the Callide scenario: months, not days), and a
//      staggered planned-maintenance block in the shoulder season.
//   2. DEMAND — seasonal shape per region (summer-peaking QLD/SA, dual-peak
//      NSW/VIC, winter TAS), weekday/weekend, heatwave shocks.
//   3. VRE — wind+solar capacity from the registry with a seasonal + AR(1)
//      daily capacity-factor path.
//   4. PRICE — a convex utilisation→price curve anchored so that a normal
//      year reproduces the region's recent 90-day average price. When a big
//      unit trips, utilisation jumps and the price REGIME shifts for the
//      whole repair — a spiky quarter, not a spiky half-hour.
//
// Outage rates/repair times are labelled reference values (no public
// unit-level outage feed exists keyless); the price anchor is live data.
// Deterministic seeds — reproducible. Retail-lens outputs: distributions of
// quarterly average prices and the desk book's 12-month margin.

import { mulberry32 } from "./stats";
import type { Facility } from "./types";

export interface RegionSimInput {
  code: string;
  /** Annual-average operational demand anchor, MW (from live). */
  demandAvgMW: number;
  /** Recent average spot anchor, $/MWh (from 90d history). */
  priceAnchorAUD: number;
}

export interface SpotSimOptions {
  runs?: number;
  seed?: number;
  /** Retail book: flat-rate margin stress. */
  book?: { loadsMW: Record<string, number>; flatCkwh: number; nonEnergyCkwh: number };
}

export interface RegionSimResult {
  code: string;
  /** Per quarter (next 4): [P50, P90, P99] of the quarterly average, $/MWh. */
  quarters: Array<{ p50: number; p90: number; p99: number }>;
  annual: { p10: number; p50: number; p90: number };
  /** Probability any quarter's average exceeds the threshold. */
  probQuarterOver150: number;
  probQuarterOver300: number;
  /** Fleet context for the UI. */
  thermalUnits: number;
  thermalMW: number;
  vreMW: number;
}

export interface SpotSimResult {
  regions: RegionSimResult[];
  book: {
    annualMarginP10: number;
    annualMarginP50: number;
    annualMarginP90: number;
    probNegativeQuarter: number;
  } | null;
  runs: number;
  method: string;
}

// Reference outage parameters by fuel class (labelled reference — AEMO-style
// forced-outage-rate territory, editable in code not UI for v1).
const UNIT_PARAMS = {
  coal: { unitMW: 350, tripPerDay: 0.005, repairMeanD: 7, repairSigma: 0.9, catPerYear: 0.015, catMinD: 90, catMaxD: 360, plannedD: 28 },
  gas: { unitMW: 180, tripPerDay: 0.003, repairMeanD: 3, repairSigma: 0.8, catPerYear: 0.005, catMinD: 45, catMaxD: 150, plannedD: 14 },
} as const;

// Seasonal demand/VRE character per region class.
const REGION_SHAPE: Record<string, { summerAmp: number; winterAmp: number; windPeakDay: number; importMW: number }> = {
  NSW1: { summerAmp: 0.1, winterAmp: 0.08, windPeakDay: 240, importMW: 2500 },
  QLD1: { summerAmp: 0.14, winterAmp: 0.03, windPeakDay: 240, importMW: 1200 },
  VIC1: { summerAmp: 0.09, winterAmp: 0.09, windPeakDay: 240, importMW: 2800 },
  SA1: { summerAmp: 0.16, winterAmp: 0.05, windPeakDay: 240, importMW: 1300 },
  TAS1: { summerAmp: 0.02, winterAmp: 0.14, windPeakDay: 240, importMW: 500 },
  WEM: { summerAmp: 0.14, winterAmp: 0.04, windPeakDay: 240, importMW: 0 },
};

interface Unit {
  mw: number;
  fuel: keyof typeof UNIT_PARAMS;
  plannedStart: number; // day of year the planned block begins
}

/** The registry often ships facilities without a region code — derive it
 *  from coordinates (state-boundary approximation, screening-grade). */
export function facilityRegion(f: Facility): string {
  if (f.region) return f.region;
  if (f.lng < 129) return "WEM";
  if (f.lng < 141) return "SA1";
  if (f.lat < -39.5) return "TAS1";
  if (f.lat > -29) return "QLD1";
  if (f.lat < -35.7) return "VIC1";
  return "NSW1";
}

function buildFleet(facilities: Facility[], code: string): Unit[] {
  const units: Unit[] = [];
  let stagger = 0;
  for (const f of facilities) {
    if (facilityRegion(f) !== code) continue;
    const fuel = f.fuel === "coal" ? "coal" : f.fuel === "gas" || f.fuel === "distillate" ? "gas" : null;
    if (!fuel) continue;
    const p = UNIT_PARAMS[fuel];
    const n = Math.max(1, Math.round(f.capacityMW / p.unitMW));
    for (let i = 0; i < n; i++) {
      // Planned maintenance staggered through autumn/spring (days 60-150, 240-330).
      const windowStart = stagger % 2 === 0 ? 60 : 240;
      units.push({ mw: f.capacityMW / n, fuel, plannedStart: windowStart + ((stagger * 17) % 90) });
      stagger++;
    }
  }
  return units;
}

/** One simulated year of daily thermal availability for a fleet. */
function simulateAvailability(units: Unit[], rng: () => number): Float64Array {
  const avail = new Float64Array(365);
  const fleetMW = units.reduce((s, u) => s + u.mw, 0);
  avail.fill(fleetMW);
  for (const u of units) {
    const p = UNIT_PARAMS[u.fuel];
    // Planned block.
    for (let d = u.plannedStart; d < u.plannedStart + p.plannedD && d < 365; d++) avail[d] -= u.mw;
    // Forced outages.
    let d = 0;
    while (d < 365) {
      if (rng() < p.tripPerDay) {
        let dur: number;
        if (rng() < p.catPerYear / (365 * p.tripPerDay)) {
          // Catastrophic failure — months offline (the quarter-killer).
          dur = p.catMinD + rng() * (p.catMaxD - p.catMinD);
        } else {
          const z = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
          dur = Math.exp(Math.log(p.repairMeanD) + p.repairSigma * z);
        }
        for (let k = d; k < Math.min(365, d + dur); k++) avail[k] -= u.mw;
        d += Math.ceil(dur) + 1;
      } else {
        d++;
      }
    }
  }
  return avail;
}

/** Daily demand path: seasonal + weekday + heatwave shocks. Day 0 = Jan 1. */
function demandPath(base: number, shape: (typeof REGION_SHAPE)[string], rng: () => number): Float64Array {
  const out = new Float64Array(365);
  for (let d = 0; d < 365; d++) {
    const summer = Math.exp(-(((d + 15) % 365 <= 60 ? (d + 15) % 365 : 365 - ((d + 15) % 365)) ** 2) / 1800); // peak mid-Jan
    const winter = Math.exp(-((d - 190) ** 2) / 1800); // peak mid-Jul
    let v = base * (1 + shape.summerAmp * summer + shape.winterAmp * winter);
    if (d % 7 >= 5) v *= 0.94; // weekend
    if (summer > 0.5 && rng() < 0.04) v *= 1.15 + 0.15 * rng(); // heatwave day
    v *= 1 + 0.04 * (rng() - 0.5); // daily noise
    out[d] = v;
  }
  return out;
}

/** Daily VRE output path: seasonal CF + AR(1) noise on wind+solar capacity. */
function vrePath(vreMW: number, shape: (typeof REGION_SHAPE)[string], rng: () => number): Float64Array {
  const out = new Float64Array(365);
  let ar = 0;
  for (let d = 0; d < 365; d++) {
    const season = 1 + 0.2 * Math.cos(((d - shape.windPeakDay) / 365) * 2 * Math.PI);
    ar = 0.7 * ar + 0.3 * (rng() * 2 - 1);
    const cf = Math.min(Math.max(0.32 * season * (1 + 0.8 * ar), 0.04), 0.85);
    out[d] = vreMW * cf;
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(Math.floor(q * sorted.length), sorted.length - 1)];
}

export function simulateSpot(
  facilities: Facility[],
  regions: RegionSimInput[],
  opts: SpotSimOptions = {},
): SpotSimResult {
  const runs = opts.runs ?? 300;
  const rng = mulberry32((opts.seed ?? 0x5b07517e) >>> 0);
  const K = 3.0; // price-curve convexity (reference)
  const CAP = 2000; // daily-mean effective ceiling
  const FLOOR = -30;

  const out: RegionSimResult[] = [];
  // Per-run annual averages per region, for the book stress.
  const annualByRegion: Record<string, number[]> = {};
  const quarterlyByRegion: Record<string, number[][]> = {};

  for (const r of regions) {
    const shape = REGION_SHAPE[r.code] ?? REGION_SHAPE.NSW1;
    const units = buildFleet(facilities, r.code);
    const fleetMW = units.reduce((s, u) => s + u.mw, 0);
    const vreMW = facilities
      .filter((f) => facilityRegion(f) === r.code && (f.fuel === "wind" || f.fuel === "solar" || f.fuel === "hydro"))
      .reduce((s, f) => s + (f.fuel === "hydro" ? f.capacityMW * 0.45 : f.capacityMW), 0);

    // Calibrate u0 on a no-noise, planned-only reference year, then a pilot
    // pass corrects for convexity (Jensen pushes the simulated mean above the
    // anchor) so a MEDIAN simulated year reproduces the recent 90d average.
    const refAvail = fleetMW * 0.93 + shape.importMW;
    const u0 = Math.max(0.1, (r.demandAvgMW - vreMW * 0.32) / refAvail);

    const priceOfDay = (anchor: number, u: number): number => {
      if (u < 0.12) return FLOOR + (u / 0.12) * (anchor * 0.5 - FLOOR);
      return Math.min(anchor * Math.exp((K * (u - u0)) / Math.max(u0, 0.05)), CAP);
    };

    const runYear = (anchor: number, rrng: () => number): { q: number[]; a: number } => {
      const avail = simulateAvailability(units, rrng);
      const demand = demandPath(r.demandAvgMW, shape, rrng);
      const vre = vrePath(vreMW, shape, rrng);
      const qSum = [0, 0, 0, 0];
      let aSum = 0;
      for (let d = 0; d < 365; d++) {
        const supply = avail[d] + shape.importMW;
        const uD = Math.max(demand[d] - vre[d], 0) / Math.max(supply, 1);
        const pD = priceOfDay(anchor, uD);
        qSum[Math.min(Math.floor(d / 91.25), 3)] += pD;
        aSum += pD;
      }
      return { q: qSum.map((v) => v / 91.25), a: aSum / 365 };
    };

    // Pilot: 40 runs at the raw anchor -> scale so median annual == anchor.
    const pilotRng = mulberry32(0x9a11b007 ^ (r.code.charCodeAt(0) << 8));
    const pilot: number[] = [];
    for (let i = 0; i < 40; i++) pilot.push(runYear(r.priceAnchorAUD, pilotRng).a);
    pilot.sort((x, y) => x - y);
    const anchor = (r.priceAnchorAUD * r.priceAnchorAUD) / Math.max(quantile(pilot, 0.5), 1);

    const quarterly: number[][] = [[], [], [], []];
    const annual: number[] = [];

    for (let run = 0; run < runs; run++) {
      const year = runYear(anchor, rng);
      for (let q = 0; q < 4; q++) quarterly[q].push(year.q[q]);
      annual.push(year.a);
    }

    // Keep RAW per-run values (joint distribution); sort copies for quantiles.
    const qSorted = quarterly.map((qs) => [...qs].sort((a, b) => a - b));
    const annualSorted = [...annual].sort((a, b) => a - b);
    const probAnyQuarterOver = (t: number) => {
      let hits = 0;
      for (let run = 0; run < runs; run++) {
        if (quarterly.some((qs) => qs[run] > t)) hits++;
      }
      return hits / runs;
    };

    annualByRegion[r.code] = annual;
    quarterlyByRegion[r.code] = quarterly;

    out.push({
      code: r.code,
      quarters: qSorted.map((qs) => ({ p50: quantile(qs, 0.5), p90: quantile(qs, 0.9), p99: quantile(qs, 0.99) })),
      annual: { p10: quantile(annualSorted, 0.1), p50: quantile(annualSorted, 0.5), p90: quantile(annualSorted, 0.9) },
      probQuarterOver150: probAnyQuarterOver(150),
      probQuarterOver300: probAnyQuarterOver(300),
      thermalUnits: units.length,
      thermalMW: Math.round(fleetMW),
      vreMW: Math.round(vreMW),
    });
  }

  // Book stress: flat-rate retail margin across the simulated year, using the
  // RAW per-run quarterly prices so cross-region and cross-quarter correlation
  // within a run (same outage/weather draw) is preserved.
  let book: SpotSimResult["book"] = null;
  if (opts.book) {
    const { loadsMW, flatCkwh, nonEnergyCkwh } = opts.book;
    const marginPerMWhBase = flatCkwh * 10 - nonEnergyCkwh * 10;
    const margins: number[] = [];
    let negQuarterRuns = 0;
    for (let run = 0; run < runs; run++) {
      let annualMargin = 0;
      let hasNegQ = false;
      for (let q = 0; q < 4; q++) {
        let qMargin = 0;
        for (const r of out) {
          const load = loadsMW[r.code] ?? 0;
          if (load <= 0) continue;
          const qPrice = quarterlyByRegion[r.code][q][run];
          qMargin += load * 2190 * (marginPerMWhBase - qPrice);
        }
        if (qMargin < 0) hasNegQ = true;
        annualMargin += qMargin;
      }
      if (hasNegQ) negQuarterRuns++;
      margins.push(annualMargin);
    }
    margins.sort((a, b) => a - b);
    book = {
      annualMarginP10: quantile(margins, 0.1),
      annualMarginP50: quantile(margins, 0.5),
      annualMarginP90: quantile(margins, 0.9),
      probNegativeQuarter: negQuarterRuns / runs,
    };
  }
  void annualByRegion;

  return {
    regions: out,
    book,
    runs,
    method:
      "unit-level Markov outages over the registered fleet (reference rates incl catastrophic tail) -> daily availability; seasonal demand + heatwaves; AR(1) VRE; price = calibrated convex utilisation curve anchored to the last 90d average",
  };
}
