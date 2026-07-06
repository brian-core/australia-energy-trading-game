import type { PricePoint } from "./history";
import type { ScenarioTech } from "./scenario";
import { mulberry32 } from "./stats";

// Project-finance layer for the BUILD view's custom asset.
//
// Turns a stylised asset (tech, capacity, capture price from the merit-order
// model) into a developer-grade economic case: AEP with degradation, levelised
// cost (LCOE for generators / LCOS for storage), project NPV / IRR / payback,
// and a Monte-Carlo distribution of lifetime outcomes by bootstrapping future
// wholesale prices from the observed history.
//
// All figures are AUD, nominal unless noted. The model discounts development
// spend, capex at commissioning, escalated O&M, and end-of-life
// decommissioning against discounted lifetime energy. It is a first-order
// finance model, not a bankable valuation — labelled as such in the UI.

export interface FinanceInputs {
  tech: ScenarioTech;
  capacityMW: number;
  /** Net capacity factor (0-1). For storage, the discharge capacity factor. */
  capacityFactor: number;
  /** Overnight capital cost, $/MW. */
  capexPerMW: number;
  /** Development phase length, years (spend before commissioning). */
  devPhaseYears: number;
  /** Development spend per year during the development phase, $. */
  devCostPerYear: number;
  /** Calendar year the asset enters operation. */
  commissioningYear: number;
  /** Operating life, years. */
  operatingLifeYears: number;
  /** Operations & maintenance, $/MWh of delivered energy. */
  omPerMWh: number;
  /** Annual O&M cost escalation, fraction/yr (e.g. 0.03). */
  omEscalation: number;
  /** Output degradation, fraction/yr (e.g. 0.005). */
  degradation: number;
  /** Lump-sum decommissioning cost at end of life, $. */
  decommissioningCost: number;
  /** Discount rate / WACC, fraction (e.g. 0.07). */
  discountRate: number;
  /** Expected real price growth on top of inflation, fraction/yr. */
  priceGrowth: number;
  /** General inflation, fraction/yr — escalates the captured price. */
  inflation: number;
  /** Generation-weighted price the asset earns, $/MWh (from the sim). */
  captureAUD: number;
  /** MC-only: capex outturn risk σ as a fraction of capex. Sampled once per
   *  run, right-skewed (overruns run bigger than underruns). Ignored by the
   *  deterministic case. */
  capexSigma: number;
  /** MC-only: systematic capacity-factor estimate risk σ (resource/
   *  performance error, one draw per run applied to every year). */
  cfSigma: number;
}

export interface YearCashflow {
  year: number;
  phase: "development" | "operation" | "decommission";
  energyMWh: number;
  revenueAUD: number;
  omAUD: number;
  capexAUD: number;
  netAUD: number;
  discountedNetAUD: number;
}

export interface FinanceResult {
  /** Levelised cost of energy/storage, $/MWh. */
  lcoeAUD: number;
  /** Whether the levelised figure is LCOS (storage) or LCOE (generation). */
  levelisedKind: "LCOE" | "LCOS";
  /** First-year annual energy production, MWh. */
  aepYear1MWh: number;
  /** Lifetime delivered energy (with degradation), MWh. */
  lifetimeMWh: number;
  totalCapexAUD: number;
  /** Net present value at the input discount rate, $. */
  npvAUD: number;
  /** Internal rate of return, fraction (null if it never turns positive). */
  irr: number | null;
  /** Undiscounted simple payback, years from commissioning (null if never). */
  paybackYears: number | null;
  /** Undiscounted lifetime trading margin (revenue − opex − capex − dev), $. */
  lifetimeMarginAUD: number;
  cashflows: YearCashflow[];
}

const STORAGE_TECHS: ScenarioTech[] = ["battery", "phes"];

/** Indicative cost/performance defaults per technology (mid-2020s Australia,
 *  GenCost-style order of magnitude — editable in the UI). */
export const TECH_DEFAULTS: Record<
  ScenarioTech,
  Pick<
    FinanceInputs,
    | "capacityFactor"
    | "capexPerMW"
    | "operatingLifeYears"
    | "omPerMWh"
    | "degradation"
    | "devPhaseYears"
    | "capexSigma"
    | "cfSigma"
  >
> = {
  // capexSigma/cfSigma: delivery risk differs by tech — modular solar/battery
  // builds outturn tighter than civil-works-heavy pumped hydro.
  solar: { capacityFactor: 0.27, capexPerMW: 1_100_000, operatingLifeYears: 30, omPerMWh: 8, degradation: 0.005, devPhaseYears: 2, capexSigma: 0.06, cfSigma: 0.05 },
  wind: { capacityFactor: 0.38, capexPerMW: 2_000_000, operatingLifeYears: 30, omPerMWh: 15, degradation: 0.003, devPhaseYears: 2, capexSigma: 0.09, cfSigma: 0.07 },
  battery: { capacityFactor: 0.18, capexPerMW: 2_400_000, operatingLifeYears: 15, omPerMWh: 10, degradation: 0.02, devPhaseYears: 1, capexSigma: 0.07, cfSigma: 0.04 },
  phes: { capacityFactor: 0.22, capexPerMW: 3_500_000, operatingLifeYears: 50, omPerMWh: 6, degradation: 0.001, devPhaseYears: 4, capexSigma: 0.2, cfSigma: 0.05 },
  gas: { capacityFactor: 0.12, capexPerMW: 1_300_000, operatingLifeYears: 25, omPerMWh: 12, degradation: 0.002, devPhaseYears: 2, capexSigma: 0.1, cfSigma: 0.05 },
};

/** Build a full set of finance inputs from a tech + capacity + capture price,
 *  filling unset fields from the tech defaults and macro context. */
export function defaultFinanceInputs(
  tech: ScenarioTech,
  capacityMW: number,
  captureAUD: number,
  macro?: { discountRate?: number; inflation?: number },
): FinanceInputs {
  const d = TECH_DEFAULTS[tech];
  return {
    tech,
    capacityMW,
    capacityFactor: d.capacityFactor,
    capexPerMW: d.capexPerMW,
    devPhaseYears: d.devPhaseYears,
    devCostPerYear: d.capexPerMW * capacityMW * 0.01,
    commissioningYear: new Date().getUTCFullYear() + d.devPhaseYears,
    operatingLifeYears: d.operatingLifeYears,
    omPerMWh: d.omPerMWh,
    omEscalation: macro?.inflation ?? 0.03,
    degradation: d.degradation,
    decommissioningCost: d.capexPerMW * capacityMW * 0.05,
    discountRate: macro?.discountRate ?? 0.07,
    priceGrowth: 0,
    inflation: macro?.inflation ?? 0.03,
    captureAUD,
    capexSigma: d.capexSigma,
    cfSigma: d.cfSigma,
  };
}

/** Net present value of a cashflow array (index 0 = today, year 0). */
function npv(rate: number, flows: number[]): number {
  return flows.reduce((sum, f, t) => sum + f / Math.pow(1 + rate, t), 0);
}

/** Bisect for a root of f in [lo, hi] given f(lo) and f(hi) bracket zero. */
function bisect(f: (r: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  let fa = f(a);
  for (let i = 0; i < 80; i++) {
    const mid = (a + b) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < 1) return mid;
    if (fa * fmid < 0) b = mid;
    else {
      a = mid;
      fa = fmid;
    }
  }
  return (a + b) / 2;
}

/**
 * Internal rate of return: the discount rate at which NPV crosses from positive
 * to negative. We scan upward (the terminal decommissioning outflow makes NPV
 * non-monotonic, so a single fixed bracket can miss the root) and bisect the
 * first downward crossing. Null when the project never turns positive.
 */
function irr(flows: number[]): number | null {
  const f = (r: number) => npv(r, flows);
  let prevR = -0.9;
  let prev = f(prevR);
  for (let r = -0.88; r <= 3.0001; r += 0.01) {
    const cur = f(r);
    if (prev > 0 && cur <= 0) return bisect(f, prevR, r);
    prev = cur;
    prevR = r;
  }
  return null;
}

/**
 * Deterministic project economics. Returns levelised cost, NPV, IRR, payback
 * and the year-by-year cashflow ledger.
 */
export function runFinance(input: FinanceInputs): FinanceResult {
  const {
    capacityMW,
    capacityFactor,
    capexPerMW,
    devPhaseYears,
    devCostPerYear,
    operatingLifeYears,
    omPerMWh,
    omEscalation,
    degradation,
    decommissioningCost,
    discountRate,
    priceGrowth,
    inflation,
    captureAUD,
    tech,
  } = input;

  const totalCapex = capexPerMW * capacityMW;
  const aepYear1 = capacityMW * capacityFactor * 8760;
  const isStorage = STORAGE_TECHS.includes(tech);

  const cashflows: YearCashflow[] = [];
  // Index t = years from today (development start). Build the full ledger.
  // Development phase: spend devCostPerYear at t = 0..devPhaseYears-1.
  for (let t = 0; t < devPhaseYears; t++) {
    const net = -devCostPerYear;
    cashflows.push({
      year: input.commissioningYear - devPhaseYears + t,
      phase: "development",
      energyMWh: 0,
      revenueAUD: 0,
      omAUD: 0,
      capexAUD: 0,
      netAUD: net,
      discountedNetAUD: net / Math.pow(1 + discountRate, t),
    });
  }
  // Capex lands at commissioning (t = devPhaseYears).
  // Operation years k = 1..life at t = devPhaseYears + k - 1 ... we charge capex
  // at the first operating timestep for simplicity (t = devPhaseYears).
  for (let k = 1; k <= operatingLifeYears; k++) {
    const t = devPhaseYears + (k - 1);
    const energy = aepYear1 * Math.pow(1 - degradation, k - 1);
    const priceEsc = Math.pow(1 + inflation + priceGrowth, k - 1);
    const revenue = captureAUD * energy * priceEsc;
    const om = omPerMWh * energy * Math.pow(1 + omEscalation, k - 1);
    const capex = k === 1 ? totalCapex : 0;
    const net = revenue - om - capex;
    cashflows.push({
      year: input.commissioningYear + (k - 1),
      phase: "operation",
      energyMWh: energy,
      revenueAUD: revenue,
      omAUD: om,
      capexAUD: capex,
      netAUD: net,
      discountedNetAUD: net / Math.pow(1 + discountRate, t),
    });
  }
  // Decommissioning at end of life.
  {
    const t = devPhaseYears + operatingLifeYears;
    const net = -decommissioningCost;
    cashflows.push({
      year: input.commissioningYear + operatingLifeYears,
      phase: "decommission",
      energyMWh: 0,
      revenueAUD: 0,
      omAUD: 0,
      capexAUD: 0,
      netAUD: net,
      discountedNetAUD: net / Math.pow(1 + discountRate, t),
    });
  }

  // Levelised cost: PV(all costs) / PV(energy), both at the discount rate.
  let pvCost = 0;
  let pvEnergy = 0;
  let lifetimeMWh = 0;
  let lifetimeMargin = 0;
  cashflows.forEach((cf, idx) => {
    const t = idx; // ledger is dense year-by-year from today
    const disc = Math.pow(1 + discountRate, t);
    pvCost += (cf.omAUD + cf.capexAUD) / disc;
    if (cf.phase === "development") pvCost += -cf.netAUD / disc; // dev spend
    if (cf.phase === "decommission") pvCost += -cf.netAUD / disc;
    pvEnergy += cf.energyMWh / disc;
    lifetimeMWh += cf.energyMWh;
    lifetimeMargin += cf.netAUD;
  });
  const lcoe = pvEnergy > 0 ? pvCost / pvEnergy : 0;

  const flows = cashflows.map((c) => c.netAUD);
  const npvAUD = npv(discountRate, flows);
  const irrValue = irr(flows);

  // Undiscounted payback from commissioning.
  let cumulative = 0;
  let paybackYears: number | null = null;
  for (const cf of cashflows) {
    cumulative += cf.netAUD;
    if (cumulative >= 0 && cf.phase === "operation") {
      paybackYears = cf.year - input.commissioningYear + 1;
      break;
    }
  }

  return {
    lcoeAUD: lcoe,
    levelisedKind: isStorage ? "LCOS" : "LCOE",
    aepYear1MWh: aepYear1,
    lifetimeMWh,
    totalCapexAUD: totalCapex,
    npvAUD,
    irr: irrValue,
    paybackYears,
    lifetimeMarginAUD: lifetimeMargin,
    cashflows,
  };
}

// ---------------------------------------------------------------------------
// Monte-Carlo lifetime simulation (price risk bootstrapped from history)

export interface MonteCarloResult {
  runs: number;
  npvP10: number;
  npvP50: number;
  npvP90: number;
  irrP10: number | null;
  irrP50: number | null;
  irrP90: number | null;
  /** Probability NPV > 0 across runs, 0-1. */
  probPositive: number;
  /** Histogram of NPV outcomes ($) for a sparkline. */
  npvSamples: number[];
  /** Per operating year: realised nominal capture price quantiles, $/MWh —
   *  the same sampled paths that drive the NPV distribution. */
  priceP10: number[];
  priceP50: number[];
  priceP90: number[];
}

/** Daily mean prices from a history price series (groups by UTC day). */
function dailyMeans(prices: PricePoint[]): number[] {
  const byDay = new Map<number, { sum: number; n: number }>();
  for (const [ts, p] of prices) {
    const day = Math.floor(ts / 86400_000);
    const acc = byDay.get(day) ?? { sum: 0, n: 0 };
    acc.sum += p;
    acc.n += 1;
    byDay.set(day, acc);
  }
  return [...byDay.values()].map((d) => d.sum / d.n).filter((v) => Number.isFinite(v));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(q * sorted.length), sorted.length - 1);
  return sorted[idx];
}

/**
 * Monte-Carlo NPV/IRR over three risk drivers the deterministic case ignores:
 *  - price: each operating year's average level bootstrapped from the
 *    historical daily-price distribution (weather years, fuel cycles);
 *  - capex: one right-skewed outturn multiplier per run (overruns run
 *    bigger than underruns), σ = input.capexSigma;
 *  - capacity factor: one systematic resource/performance multiplier per run
 *    applied to every year, σ = input.cfSigma.
 */
export function runMonteCarlo(
  input: FinanceInputs,
  history: PricePoint[],
  runs = 600,
  seed = 0x1234abcd,
): MonteCarloResult | null {
  const days = dailyMeans(history);
  if (days.length < 5) return null;
  const baseLevel = days.reduce((s, v) => s + v, 0) / days.length;
  if (baseLevel <= 0) return null;

  // Drawing K days per year preserves inter-annual spread (fewer draws → more
  // variance). Cap K so a long history doesn't collapse to its mean.
  const K = Math.min(days.length, 24);
  const rng = mulberry32(seed);
  // Standard normal via Box-Muller on the seeded PRNG.
  const randn = () =>
    Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
  const npvSamples: number[] = [];
  const irrSamples: number[] = [];
  // Realised nominal capture price per operating year, across runs — the
  // price paths behind the NPV distribution, kept for the fan chart.
  const priceByYear: number[][] = Array.from({ length: input.operatingLifeYears }, () => []);

  for (let r = 0; r < runs; r++) {
    // Per-run systematic draws: capex outturn (right-skewed — a $1 overrun is
    // likelier/larger than a $1 underrun) and capacity-factor estimate error.
    const zc = randn();
    const capexMult = Math.min(Math.max(1 + input.capexSigma * (zc > 0 ? 1.5 * zc : zc), 0.7), 2.2);
    const cfMult = Math.min(Math.max(1 + input.cfSigma * randn(), 0.7), 1.2);

    // One sampled annual price multiplier per operating year.
    const flows: number[] = [];
    for (let t = 0; t < input.devPhaseYears; t++) flows.push(-input.devCostPerYear);

    const aepYear1 = input.capacityMW * input.capacityFactor * 8760 * cfMult;
    const totalCapex = input.capexPerMW * input.capacityMW * capexMult;
    for (let k = 1; k <= input.operatingLifeYears; k++) {
      let s = 0;
      for (let j = 0; j < K; j++) s += days[Math.floor(rng() * days.length)];
      const annualLevel = s / K;
      const mult = annualLevel / baseLevel;
      const energy = aepYear1 * Math.pow(1 - input.degradation, k - 1);
      const priceEsc = Math.pow(1 + input.inflation + input.priceGrowth, k - 1);
      priceByYear[k - 1].push(input.captureAUD * mult * priceEsc);
      const revenue = input.captureAUD * mult * energy * priceEsc;
      const om = input.omPerMWh * energy * Math.pow(1 + input.omEscalation, k - 1);
      const capex = k === 1 ? totalCapex : 0;
      flows.push(revenue - om - capex);
    }
    flows.push(-input.decommissioningCost);

    npvSamples.push(npv(input.discountRate, flows));
    const ir = irr(flows);
    if (ir != null) irrSamples.push(ir);
  }

  const sortedNpv = [...npvSamples].sort((a, b) => a - b);
  const sortedIrr = [...irrSamples].sort((a, b) => a - b);
  const positive = npvSamples.filter((v) => v > 0).length;
  const priceQ = (q: number) =>
    priceByYear.map((samples) => quantile([...samples].sort((a, b) => a - b), q));

  return {
    runs,
    npvP10: quantile(sortedNpv, 0.1),
    npvP50: quantile(sortedNpv, 0.5),
    npvP90: quantile(sortedNpv, 0.9),
    irrP10: sortedIrr.length ? quantile(sortedIrr, 0.1) : null,
    irrP50: sortedIrr.length ? quantile(sortedIrr, 0.5) : null,
    irrP90: sortedIrr.length ? quantile(sortedIrr, 0.9) : null,
    probPositive: npvSamples.length ? positive / npvSamples.length : 0,
    npvSamples,
    priceP10: priceQ(0.1),
    priceP50: priceQ(0.5),
    priceP90: priceQ(0.9),
  };
}
