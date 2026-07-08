// Feasibility engine for North Sea platform repurposing.
//
// Three options appraised per platform, on shared price/wind Monte-Carlo
// paths so the comparison is honest:
//   A. DECOMMISSION NOW  — the baseline liability, spread over 3 years.
//   B. COMPUTE + LDES    — AI data centre (IT MW) powered by a tied offshore
//      wind PPA with an iron-air storage deck bridging lulls; residual power
//      bought (and surplus sold) at GB spot. Deferred decom at end of the
//      second life.
//   C. H2 ELECTROLYSIS   — the literature comparator (PosHYdon/Aberdeen):
//      tied wind → PEM electrolysis → £/kg offtake via reused pipeline.
//
// The energy balance runs hourly over one representative year built from the
// last 7 days of GB shapes (Elexon), seasonally modulated — a labelled
// approximation, good for feasibility-grade screening, not dispatch.
// All £ figures nominal GBP; NPVs at the study discount rate.

import type { PricePoint } from "./history";
import { mulberry32 } from "./stats";
import type { Platform } from "./northsea";

export interface ConceptInputs {
  // Compute payload
  computeMW: number; // IT load
  pue: number; // offshore seawater cooling: ~1.05-1.15
  leaseKGBPPerMWyr: number; // revenue, £k per IT-MW-year (lease basis)
  utilisation: number; // steady-state share of IT capacity leased
  // Storage deck (iron-air LDES)
  storageGWh: number;
  storagePowerMW: number;
  storageRte: number; // round-trip efficiency (~0.45-0.5)
  // Power supply
  tiedWindMW: number; // PPA'd share of adjacent wind
  ppaStrikeGBP: number; // £/MWh, take-or-pay on tied-wind generation
  // Platform & structural
  secondLifeYears: number;
  conversionCapexGBPm: number; // marine/structural conversion base
  remediationMeanGBPm: number; // structural remediation, MC fat right tail
  computeCapexGBPmPerMW: number; // offshore-ised IT module, per IT MW
  storageCapexGBPmPerGWh: number;
  hvdcFixedGBPmPerMW: number; // converter pair
  hvdcVarGBPPerMWkm: number; // cable, per MW-km
  windDistanceKm: number;
  fibreCapexGBPmPer100km: number;
  fibreDistanceKm: number;
  opexKGBPPerMWyr: number; // marine O&M premium per IT MW-yr (crewing, logistics)
  // H2 comparator
  h2ElectrolyserMW: number;
  h2PriceGBPkg: number;
  h2KwhPerKg: number; // ~52.5 kWh/kg PEM incl BoP
  h2CapexGBPmPerMW: number;
  // Interruptible compute (v2 concept): the workload absorbs wind
  // variability — checkpoint & power down in lulls. No LDES deck, no HVDC
  // (33-66kV AC array cable), no take-or-pay: energy is bought only when
  // consumed, at a curtailment-flavoured strike. Fibre goes home through the
  // platform's own flooded export pipeline where one survives.
  intRevenueGBPPerMWhIT: number; // £ per delivered IT-MWh (merchant interruptible AI hosting)
  intStrikeGBP: number; // £/MWh for energy actually consumed
  intMinLoadShare: number; // below this share of full load, checkpoint & shut down
  intComputeCapexGBPmPerMW: number; // lighter spec than Tier-III (redundancy engineered out)
  intOpexKGBPPerMWyr: number;
  intConversionGBPm: number; // lighter marine scope than the v1 heavy conversion
  bessCapexGBPm: number; // 3-4 deck BESS containers: ride-through + hotel load
  acCableGBPmPerKm: number; // 33-66kV array cable to the adjacent lease
  fibrePullGBPm: number; // fibre floated/pigged through the retired export line
  // Decom baseline
  decomCostGBPm: number;
  // Macro
  discountRate: number;
  inflation: number;
}

/** Per-tech tonnage estimates (t) for the topside weight budget check. */
export const WEIGHT_T_PER = {
  computeMW: 100, // IT module incl cooling/power electronics (estimate)
  storageGWh: 10_000, // iron-air is heavy — ~100 Wh/kg system (estimate)
  electrolyserMW: 150, // PEM stack + BoP module (estimate)
};

/** Topside tonnage of a concept option — each payload is an alternative,
 *  checked against the weight budget separately. The interruptible variant
 *  carries only compute modules + a few BESS containers (~60 t). */
export function conceptWeightTonnes(c: ConceptInputs, option: "compute" | "h2" | "interruptible"): number {
  if (option === "compute") return c.computeMW * WEIGHT_T_PER.computeMW + c.storageGWh * WEIGHT_T_PER.storageGWh;
  if (option === "h2") return c.h2ElectrolyserMW * WEIGHT_T_PER.electrolyserMW;
  return c.computeMW * WEIGHT_T_PER.computeMW + 60;
}

/** Sensible starting concept for a platform: sized to its weight budget and
 *  adjacent wind, macro-seeded discount rate. Everything user-editable. */
export function defaultConcept(
  p: Platform,
  windDistanceKm: number,
  fibreDistanceKm: number,
  macro?: { discountRate?: number; inflation?: number },
): ConceptInputs {
  // Spend ~60% of the topside budget on compute, ~30% on storage.
  const budget = p.topsideTonnes;
  const computeMW = Math.max(10, Math.round((budget * 0.6) / WEIGHT_T_PER.computeMW / 10) * 10);
  const storageGWh = Math.max(0.2, Math.round(((budget * 0.3) / WEIGHT_T_PER.storageGWh) * 10) / 10);
  const decom = defaultDecomCostGBPm(p);
  return {
    computeMW,
    pue: 1.1,
    // All-in AI hosting (power included), ~$160/kW-month equivalent — the
    // host buys the power, so the lease must be the all-in rate, not a
    // powered-shell rate.
    leaseKGBPPerMWyr: 1500,
    utilisation: 0.85,
    storageGWh,
    storagePowerMW: Math.round(computeMW * 1.2),
    storageRte: 0.48,
    tiedWindMW: Math.round(computeMW * 1.5),
    ppaStrikeGBP: 55,
    secondLifeYears: 20,
    conversionCapexGBPm: Math.round(decom * 0.6),
    remediationMeanGBPm: remediationMean(p),
    computeCapexGBPmPerMW: 7,
    storageCapexGBPmPerGWh: 35,
    hvdcFixedGBPmPerMW: 0.5,
    hvdcVarGBPPerMWkm: 3_000,
    windDistanceKm,
    fibreCapexGBPmPer100km: 6,
    fibreDistanceKm,
    opexKGBPPerMWyr: 180,
    h2ElectrolyserMW: Math.round(computeMW * 1.0),
    h2PriceGBPkg: 6.08, // Aberdeen/NDC break-even anchor
    h2KwhPerKg: 52.5,
    h2CapexGBPmPerMW: 1.2,
    intRevenueGBPPerMWhIT: 170,
    intStrikeGBP: 35,
    intMinLoadShare: 0.15,
    intComputeCapexGBPmPerMW: 5,
    intOpexKGBPPerMWyr: 120,
    intConversionGBPm: Math.round(decom * 0.35),
    bessCapexGBPm: 5,
    acCableGBPmPerKm: 0.8,
    fibrePullGBPm: 6,
    decomCostGBPm: decom,
    discountRate: macro?.discountRate ?? 0.085,
    inflation: macro?.inflation ?? 0.028,
  };
}

/** Reference decom cost by platform class (UKCS £59bn programme scale). */
export function defaultDecomCostGBPm(p: Platform): number {
  const base = p.type === "gravity-concrete" ? 400 : p.type === "semi-sub" ? 150 : 220;
  return Math.round(base * Math.min(Math.max(p.topsideTonnes / 15_000, 0.4), 3));
}

/** Older, fixed-steel structures carry a heavier remediation expectation. */
function remediationMean(p: Platform): number {
  const age = new Date().getUTCFullYear() - p.installedYear;
  const typeFactor = p.type === "semi-sub" ? 0.6 : p.type === "gravity-concrete" ? 0.8 : 1;
  return Math.round(30 + age * 1.6 * typeFactor);
}

// --- Representative year ------------------------------------------------------

export interface YearShapes {
  /** Hourly spot (£/MWh) and wind capacity-factor (0-1) for 8760 h. */
  spot: Float64Array;
  windCf: Float64Array;
  demo: boolean;
}

/** Tile the last-7-day GB shapes into a year with a winter/summer modulation.
 *  Labelled approximation: feasibility screening, not dispatch. */
export function buildYearShapes(spot7d: PricePoint[], windOffshore7d: PricePoint[], demo: boolean): YearShapes {
  const H = 8760;
  const spot = new Float64Array(H);
  const windCf = new Float64Array(H);
  // Hourly means of the 7-day series.
  const hourly = (pts: PricePoint[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const a = pts[i]?.[1];
      const b = pts[i + 1]?.[1] ?? a;
      if (Number.isFinite(a)) out.push((a + (Number.isFinite(b) ? b : a)) / 2);
    }
    return out.length ? out : [60];
  };
  const sp = hourly(spot7d);
  const wd = hourly(windOffshore7d);
  const wMax = Math.max(...wd, 1);
  for (let h = 0; h < H; h++) {
    // Seasonal factors: GB winter = higher prices and higher wind.
    const season = Math.cos(((h / H) * 2 - 0.08) * Math.PI * 2); // ~1 in winter
    spot[h] = Math.max(-40, sp[h % sp.length] * (1 + 0.22 * season));
    windCf[h] = Math.min(Math.max((wd[h % wd.length] / wMax) * (0.55 + 0.18 * season) * 1.35, 0), 1);
  }
  return { spot, windCf, demo };
}

// --- Energy balance -----------------------------------------------------------

interface BalanceResult {
  windGenMWh: number;
  deficitCostGBP: number; // bought at spot
  surplusRevenueGBP: number; // sold at spot
  servedShare: number; // share of IT-hours fully served (info only)
}

/** Hourly greedy dispatch: tied wind serves the load; surplus charges the
 *  deck then sells at spot; deficit discharges the deck then buys at spot. */
function runBalance(c: ConceptInputs, shapes: YearShapes, priceMult: number, windMult: number): BalanceResult {
  const loadMW = c.computeMW * c.pue * c.utilisation;
  const effIn = Math.sqrt(c.storageRte);
  const effOut = Math.sqrt(c.storageRte);
  let soc = c.storageGWh * 500; // MWh, start half-full
  const socMax = c.storageGWh * 1000;
  let windGen = 0;
  let deficitCost = 0;
  let surplusRev = 0;
  let servedH = 0;
  for (let h = 0; h < 8760; h++) {
    const price = shapes.spot[h] * priceMult;
    const wind = c.tiedWindMW * Math.min(shapes.windCf[h] * windMult, 1);
    windGen += wind;
    let net = wind - loadMW;
    if (net >= 0) {
      const charge = Math.min(net, c.storagePowerMW, (socMax - soc) / effIn);
      soc += charge * effIn;
      net -= charge;
      if (net > 0) surplusRev += net * price;
      servedH++;
    } else {
      const need = -net;
      const discharge = Math.min(need, c.storagePowerMW, soc * effOut);
      soc -= discharge / effOut;
      const resid = need - discharge;
      if (resid > 0.01) deficitCost += resid * price;
      else servedH++;
    }
  }
  return { windGenMWh: windGen, deficitCostGBP: deficitCost, surplusRevenueGBP: surplusRev, servedShare: servedH / 8760 };
}

// --- Interruptible compute (v2) -------------------------------------------------

interface IntBalance {
  deliveredITMWh: number;
  consumedMWh: number;
  /** Delivered IT energy as a share of nameplate IT energy — the effective
   *  utilisation the interruptible model achieves on these wind shapes. */
  deliveredShare: number;
}

/** Hourly: the cluster modulates to whatever the tied wind can carry; below
 *  the min-load threshold it checkpoints and powers down (BESS carries hotel
 *  load — small enough to ignore in the energy balance). No take-or-pay:
 *  only consumed energy is bought. Surplus wind stays with the farm. */
function runInterruptibleBalance(c: ConceptInputs, shapes: YearShapes, windMult: number): IntBalance {
  const loadMax = c.computeMW * c.pue;
  let delivered = 0;
  let consumed = 0;
  for (let h = 0; h < 8760; h++) {
    const wind = c.tiedWindMW * Math.min(shapes.windCf[h] * windMult, 1);
    const supply = Math.min(wind, loadMax);
    if (supply >= loadMax * c.intMinLoadShare) {
      delivered += supply / c.pue;
      consumed += supply;
    }
  }
  return {
    deliveredITMWh: delivered,
    consumedMWh: consumed,
    deliveredShare: delivered / (c.computeMW * 8760),
  };
}

function intCapexGBPm(c: ConceptInputs): number {
  const fibre = c.fibrePullGBPm; // own-pipeline pull; UI swaps in subsea lay when no line survives
  return (
    c.intConversionGBPm +
    c.computeMW * c.intComputeCapexGBPmPerMW +
    c.bessCapexGBPm +
    c.windDistanceKm * c.acCableGBPmPerKm +
    fibre
  );
}

/** Cashflows (£m/yr) for the interruptible option, one MC draw. */
function interruptibleFlows(c: ConceptInputs, bal: IntBalance, remediation: number, rateMult: number): number[] {
  const capex = intCapexGBPm(c) + remediation;
  const flows: number[] = [-capex / 2, -capex / 2];
  for (let k = 1; k <= c.secondLifeYears; k++) {
    const esc = Math.pow(1 + c.inflation, k - 1);
    const revenue = (bal.deliveredITMWh * c.intRevenueGBPPerMWhIT * rateMult * esc) / 1e6;
    const power = (bal.consumedMWh * c.intStrikeGBP * esc) / 1e6;
    const opex = (c.computeMW * c.intOpexKGBPPerMWyr * 1000 * esc) / 1e6;
    flows.push(revenue - power - opex);
  }
  flows.push(-c.decomCostGBPm * Math.pow(1 + c.inflation, c.secondLifeYears + 1));
  return flows;
}

// --- Appraisal ----------------------------------------------------------------

export interface OptionAppraisal {
  npvGBPm: number;
  npvP10GBPm: number;
  npvP90GBPm: number;
  capexGBPm: number;
  /** Year-1 annual figures for the table. */
  revenueGBPmYr: number;
  costGBPmYr: number;
}

export interface FeasibilityResult {
  decomNow: OptionAppraisal;
  compute: OptionAppraisal & { servedShare: number; probBeatsDecom: number; breakEvenLeaseKGBP: number };
  h2: OptionAppraisal & { annualKt: number; probBeatsDecom: number };
  /** The v2 primary: interruptible compute, AC-tied, own-pipeline fibre. */
  interruptible: OptionAppraisal & {
    deliveredShare: number;
    probBeatsDecom: number;
    /** £/MWh-IT at which the option's NPV equals decom-now. */
    breakEvenRateGBPMWh: number;
  };
  runs: number;
}

function npv(rate: number, flows: number[]): number {
  return flows.reduce((s, f, t) => s + f / Math.pow(1 + rate, t), 0);
}

function quantileSorted(v: number[], q: number): number {
  if (!v.length) return 0;
  return v[Math.min(Math.floor(q * v.length), v.length - 1)];
}

/** Decom-now: liability spread over 3 years (real, escalated). All £m. */
function decomNowFlows(c: ConceptInputs): number[] {
  return [0, 1, 2].map((t) => (-c.decomCostGBPm / 3) * Math.pow(1 + c.inflation, t));
}

function computeCapexGBPm(c: ConceptInputs): number {
  return (
    c.conversionCapexGBPm +
    c.computeMW * c.computeCapexGBPmPerMW +
    c.storageGWh * c.storageCapexGBPmPerGWh +
    (c.tiedWindMW * c.hvdcFixedGBPmPerMW * 1e6 + c.tiedWindMW * c.hvdcVarGBPPerMWkm * c.windDistanceKm) / 1e6 +
    (c.fibreCapexGBPmPer100km * c.fibreDistanceKm) / 100
  );
}

function h2CapexGBPm(c: ConceptInputs): number {
  return (
    c.conversionCapexGBPm +
    c.h2ElectrolyserMW * c.h2CapexGBPmPerMW +
    (c.tiedWindMW * c.hvdcFixedGBPmPerMW * 1e6 + c.tiedWindMW * c.hvdcVarGBPPerMWkm * c.windDistanceKm) / 1e6
  );
}

/** Cashflows (£m/yr) for the compute option, one MC draw. */
function computeFlows(c: ConceptInputs, bal: BalanceResult, remediation: number): number[] {
  const flows: number[] = [];
  // Year 0-1: conversion + remediation + payload capex (half each year).
  const capex = computeCapexGBPm(c) + remediation;
  flows.push(-capex / 2, -capex / 2);
  for (let k = 1; k <= c.secondLifeYears; k++) {
    const esc = Math.pow(1 + c.inflation, k - 1);
    const revenue = (c.computeMW * c.utilisation * c.leaseKGBPPerMWyr * 1000 * esc + bal.surplusRevenueGBP * esc) / 1e6;
    const power = (bal.windGenMWh * c.ppaStrikeGBP * esc + bal.deficitCostGBP * esc) / 1e6;
    const opex = (c.computeMW * c.opexKGBPPerMWyr * 1000 * esc) / 1e6;
    flows.push(revenue - power - opex);
  }
  // Deferred decom at end of second life.
  flows.push(-c.decomCostGBPm * Math.pow(1 + c.inflation, c.secondLifeYears + 1));
  return flows;
}

/** Cashflows (£m/yr) for the H2 option, one MC draw. */
function h2Flows(c: ConceptInputs, shapes: YearShapes, windMult: number, remediation: number, h2Price: number): { flows: number[]; kt: number } {
  // Electrolyser runs on tied wind up to its rating.
  let mwh = 0;
  let windGen = 0;
  for (let h = 0; h < 8760; h++) {
    const wind = c.tiedWindMW * Math.min(shapes.windCf[h] * windMult, 1);
    windGen += wind;
    mwh += Math.min(wind, c.h2ElectrolyserMW);
  }
  const kgYr = (mwh * 1000) / c.h2KwhPerKg;
  const capex = h2CapexGBPm(c) + remediation;
  const flows: number[] = [-capex / 2, -capex / 2];
  for (let k = 1; k <= c.secondLifeYears; k++) {
    const esc = Math.pow(1 + c.inflation, k - 1);
    const revenue = (kgYr * h2Price * esc) / 1e6;
    const power = (windGen * c.ppaStrikeGBP * esc) / 1e6;
    const opex = capex * 0.03 * esc;
    flows.push(revenue - power - opex);
  }
  flows.push(-c.decomCostGBPm * Math.pow(1 + c.inflation, c.secondLifeYears + 1));
  return { flows, kt: kgYr / 1e6 };
}

/**
 * Full appraisal: deterministic central case plus Monte Carlo over
 *  - annual price level (lognormal-ish multiplier, σ≈18%),
 *  - wind year (σ≈6%),
 *  - structural remediation (fat right tail: mean × lognormal, σ≈0.6),
 *  - H2 price (σ≈20%).
 */
export function runFeasibility(c: ConceptInputs, shapes: YearShapes, runs = 200, seed = 0x0507ea11): FeasibilityResult {
  const rng = mulberry32(seed >>> 0);
  const randn = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());

  const decomFlows = decomNowFlows(c);
  const decomNpv = npv(c.discountRate, decomFlows);

  // Central case.
  const balC = runBalance(c, shapes, 1, 1);
  const compC = computeFlows(c, balC, c.remediationMeanGBPm);
  const h2C = h2Flows(c, shapes, 1, c.remediationMeanGBPm, c.h2PriceGBPkg);
  const intBalC = runInterruptibleBalance(c, shapes, 1);
  const intC = interruptibleFlows(c, intBalC, c.remediationMeanGBPm, 1);

  const compNpvs: number[] = [];
  const h2Npvs: number[] = [];
  const intNpvs: number[] = [];
  for (let r = 0; r < runs; r++) {
    const priceMult = Math.exp(0.18 * randn() - 0.0162);
    const windMult = 1 + 0.06 * randn();
    const remediation = c.remediationMeanGBPm * Math.exp(0.6 * randn() - 0.18);
    const h2Price = c.h2PriceGBPkg * Math.exp(0.2 * randn() - 0.02);
    // Interruptible revenue is a merchant rate — mild lognormal (σ≈12%).
    const rateMult = Math.exp(0.12 * randn() - 0.0072);
    const bal = runBalance(c, shapes, priceMult, windMult);
    compNpvs.push(npv(c.discountRate, computeFlows(c, bal, remediation)));
    h2Npvs.push(npv(c.discountRate, h2Flows(c, shapes, windMult, remediation, h2Price).flows));
    intNpvs.push(npv(c.discountRate, interruptibleFlows(c, runInterruptibleBalance(c, shapes, windMult), remediation, rateMult)));
  }
  compNpvs.sort((a, b) => a - b);
  h2Npvs.sort((a, b) => a - b);
  intNpvs.sort((a, b) => a - b);

  // Break-even lease: bisect the lease rate at which compute NPV = decom NPV.
  let lo = 0;
  let hi = 5000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(c.discountRate, computeFlows({ ...c, leaseKGBPPerMWyr: mid }, balC, c.remediationMeanGBPm));
    if (v < decomNpv) lo = mid;
    else hi = mid;
  }

  // Break-even interruptible rate (£/MWh-IT) vs decom-now.
  let rlo = 0;
  let rhi = 1200;
  for (let i = 0; i < 40; i++) {
    const mid = (rlo + rhi) / 2;
    const v = npv(
      c.discountRate,
      interruptibleFlows({ ...c, intRevenueGBPPerMWhIT: mid }, intBalC, c.remediationMeanGBPm, 1),
    );
    if (v < decomNpv) rlo = mid;
    else rhi = mid;
  }

  const yr1 = (flows: number[]) => flows[2] ?? 0;
  return {
    decomNow: {
      npvGBPm: decomNpv,
      npvP10GBPm: decomNpv,
      npvP90GBPm: decomNpv,
      capexGBPm: c.decomCostGBPm,
      revenueGBPmYr: 0,
      costGBPmYr: c.decomCostGBPm / 3,
    },
    compute: {
      npvGBPm: npv(c.discountRate, compC),
      npvP10GBPm: quantileSorted(compNpvs, 0.1),
      npvP90GBPm: quantileSorted(compNpvs, 0.9),
      capexGBPm: computeCapexGBPm(c) + c.remediationMeanGBPm,
      revenueGBPmYr: (c.computeMW * c.utilisation * c.leaseKGBPPerMWyr * 1000 + balC.surplusRevenueGBP) / 1e6,
      costGBPmYr: (balC.windGenMWh * c.ppaStrikeGBP + balC.deficitCostGBP + c.computeMW * c.opexKGBPPerMWyr * 1000) / 1e6,
      servedShare: balC.servedShare,
      probBeatsDecom: compNpvs.filter((v) => v > decomNpv).length / compNpvs.length,
      breakEvenLeaseKGBP: (lo + hi) / 2,
    },
    h2: {
      npvGBPm: npv(c.discountRate, h2C.flows),
      npvP10GBPm: quantileSorted(h2Npvs, 0.1),
      npvP90GBPm: quantileSorted(h2Npvs, 0.9),
      capexGBPm: h2CapexGBPm(c) + c.remediationMeanGBPm,
      revenueGBPmYr: yr1(h2C.flows) > 0 ? yr1(h2C.flows) : 0,
      costGBPmYr: 0,
      annualKt: h2C.kt,
      probBeatsDecom: h2Npvs.filter((v) => v > decomNpv).length / h2Npvs.length,
    },
    interruptible: {
      npvGBPm: npv(c.discountRate, intC),
      npvP10GBPm: quantileSorted(intNpvs, 0.1),
      npvP90GBPm: quantileSorted(intNpvs, 0.9),
      capexGBPm: intCapexGBPm(c) + c.remediationMeanGBPm,
      revenueGBPmYr: (intBalC.deliveredITMWh * c.intRevenueGBPPerMWhIT) / 1e6,
      costGBPmYr: (intBalC.consumedMWh * c.intStrikeGBP + c.computeMW * c.intOpexKGBPPerMWyr * 1000) / 1e6,
      deliveredShare: intBalC.deliveredShare,
      probBeatsDecom: intNpvs.filter((v) => v > decomNpv).length / intNpvs.length,
      breakEvenRateGBPMWh: (rlo + rhi) / 2,
    },
    runs,
  };
}

// --- Sensitivity tornado --------------------------------------------------------

export interface TornadoRow {
  label: string;
  key: keyof ConceptInputs;
  /** ΔNPV (£m) at -20% / +20% of the input. */
  lowGBPm: number;
  highGBPm: number;
}

// The tornado runs on the v2 primary (interruptible compute).
const TORNADO_KEYS: Array<{ key: keyof ConceptInputs; label: string }> = [
  { key: "intRevenueGBPPerMWhIT", label: "compute rate (£/MWh-IT)" },
  { key: "tiedWindMW", label: "tied wind sizing" },
  { key: "intStrikeGBP", label: "energy strike" },
  { key: "remediationMeanGBPm", label: "structural remediation" },
  { key: "intComputeCapexGBPmPerMW", label: "compute capex" },
  { key: "intOpexKGBPPerMWyr", label: "marine opex" },
  { key: "intConversionGBPm", label: "conversion scope" },
  { key: "discountRate", label: "discount rate" },
];

export function runTornado(c: ConceptInputs, shapes: YearShapes): TornadoRow[] {
  const base = npv(
    c.discountRate,
    interruptibleFlows(c, runInterruptibleBalance(c, shapes, 1), c.remediationMeanGBPm, 1),
  );
  const evalAt = (k: keyof ConceptInputs, mult: number): number => {
    const cc = { ...c, [k]: (c[k] as number) * mult };
    return (
      npv(
        cc.discountRate,
        interruptibleFlows(cc, runInterruptibleBalance(cc, shapes, 1), cc.remediationMeanGBPm, 1),
      ) - base
    );
  };
  return TORNADO_KEYS.map(({ key, label }) => ({
    label,
    key,
    lowGBPm: evalAt(key, 0.8),
    highGBPm: evalAt(key, 1.2),
  })).sort((a, b) => Math.max(Math.abs(b.lowGBPm), Math.abs(b.highGBPm)) - Math.max(Math.abs(a.lowGBPm), Math.abs(a.highGBPm)));
}
