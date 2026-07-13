import type { FuelGroup } from "./types";
import type { PricePoint } from "./history";

// Stylized merit-order scenario model.
//
// For each region we assume a supply stack: capacity by fuel tech at an
// indicative short-run marginal cost. For every historic 30-min interval we
// invert the stack at the observed price to get an implied net demand, apply
// the scenario (new VRE output shifts demand down the stack, storage moves
// load between hours, closures shrink a band), then re-solve the price.
//
// This captures the first-order merit-order effect — it is NOT a dispatch
// model (no transmission limits, no bidding behaviour, no interconnector
// re-flows) and is labelled as a simulation throughout the UI.

export type ScenarioTech = "solar" | "wind" | "battery" | "phes" | "gas";

export interface ScenarioAsset {
  region: string;
  tech: ScenarioTech;
  mw: number;
  /** Negative mw on `closureFuel` removes capacity instead of adding. */
  closureFuel?: FuelGroup;
}

export interface PipelineProject {
  id: string;
  name: string;
  region: string;
  tech: ScenarioTech | "closure";
  /** Capacity added (positive) or retired (negative). */
  mw: number;
  closureFuel?: FuelGroup;
  year: number;
  lat: number;
  lng: number;
  developer: string;
  status: string;
  /** One-line context for the detail card. */
  description: string;
  /** Storage volume for batteries/PHES, e.g. "350 GWh". */
  storage?: string;
  /** Indicative cost where publicly cited. */
  cost?: string;
  url?: string;
}

// Real announced/committed projects and scheduled closures. Capacities,
// dates, statuses and costs are indicative (verified mid-2026 where noted) —
// the pipeline moves; treat as scenario seeds, not a project register.
export const PIPELINE_PROJECTS: PipelineProject[] = [
  {
    id: "snowy2", name: "Snowy 2.0 (pumped hydro)", region: "NSW1", tech: "phes", mw: 2200, year: 2028, lat: -36.0, lng: 148.4,
    developer: "Snowy Hydro (Commonwealth)", status: "under construction (~67% complete)", storage: "≈350 GWh", cost: "≈$12b",
    description: "Links Tantangara and Talbingo reservoirs via 27km of tunnels; six 367MW pump-turbines. First power targeted ~2027, full operation Dec 2028.",
    url: "https://www.snowyhydro.com.au/snowy-20/about/",
  },
  {
    id: "borumba", name: "Borumba (pumped hydro)", region: "QLD1", tech: "phes", mw: 2000, year: 2030, lat: -26.5, lng: 152.55,
    developer: "Queensland Hydro (state)", status: "early works / design", storage: "≈48 GWh (24h)", cost: "≈$14b+",
    description: "24-hour pumped hydro near Imbil, the anchor of Queensland's storage plan.",
    url: "https://www.qldhydro.com.au/borumba",
  },
  {
    id: "wsb2", name: "Liddell / Hunter battery", region: "NSW1", tech: "battery", mw: 500, year: 2026, lat: -32.37, lng: 150.98,
    developer: "AGL Energy", status: "under construction", storage: "2h (1 GWh)",
    description: "Grid battery on the retired Liddell coal site, first stage of AGL's Hunter Energy Hub.",
    url: "https://www.agl.com.au/about-agl/how-we-source-energy/hunter-energy-hub",
  },
  {
    id: "nes2", name: "New England Solar stage 2", region: "NSW1", tech: "solar", mw: 320, year: 2026, lat: -30.65, lng: 151.6,
    developer: "ACEN Australia", status: "construction / commissioning",
    description: "Second stage taking the Uralla project to ≈1 GW with a co-located battery.",
    url: "https://acenrenewables.com.au/project/new-england-solar/",
  },
  {
    id: "gpe", name: "Golden Plains East (wind)", region: "VIC1", tech: "wind", mw: 577, year: 2027, lat: -37.9, lng: 144.1,
    developer: "TagEnergy", status: "under construction",
    description: "Eastern stage of Australia's largest wind farm (≈1.3 GW total at Rokewood).",
    url: "https://goldenplainswindfarm.com.au",
  },
  {
    id: "melton", name: "Melbourne Renewable Energy Hub BESS", region: "VIC1", tech: "battery", mw: 600, year: 2027, lat: -37.68, lng: 144.58,
    developer: "Equis", status: "under construction", storage: "1.6 GWh",
    description: "Large grid battery at Melton supporting Victoria's renewables shift.",
    url: "https://www.equisdev.com",
  },
  {
    id: "goyder", name: "Goyder South (wind)", region: "SA1", tech: "wind", mw: 412, year: 2027, lat: -33.85, lng: 139.05,
    developer: "Neoen", status: "staged construction",
    description: "Wind stage of the Goyder renewables precinct near Burra.",
    url: "https://goyderrenewables.com.au",
  },
  {
    id: "wambo", name: "Wambo Wind Farm (both stages)", region: "QLD1", tech: "wind", mw: 504, year: 2027, lat: -26.9, lng: 150.9,
    developer: "Stanwell + Cubico JV", status: "under construction",
    description: "Two-stage wind farm near Jandowae backed by Queensland government offtake.",
    url: "https://wambowindfarm.com.au",
  },
  {
    id: "collie", name: "Collie battery stage 2", region: "WEM", tech: "battery", mw: 500, year: 2027, lat: -33.36, lng: 116.3,
    developer: "Neoen", status: "construction", storage: "4h",
    description: "Expansion of WA's biggest battery, firming the SWIS as coal exits.",
    url: "https://www.neoen.com",
  },
  {
    id: "eraring-x", name: "Eraring closure (coal)", region: "NSW1", tech: "closure", mw: -2880, closureFuel: "coal", year: 2027, lat: -33.06, lng: 151.52,
    developer: "Origin Energy", status: "extended to Aug 2027 under NSW underwriting",
    description: "Australia's largest power station; closure deferred once already — the defining NSW supply event.",
    url: "https://www.originenergy.com.au",
  },
  {
    id: "yallourn-x", name: "Yallourn W closure (coal)", region: "VIC1", tech: "closure", mw: -1480, closureFuel: "coal", year: 2028, lat: -38.18, lng: 146.36,
    developer: "EnergyAustralia", status: "scheduled mid-2028",
    description: "Brown-coal exit covering ~20% of Victoria's supply; backed by the Wooreen battery commitment.",
    url: "https://www.energyaustralia.com.au",
  },
  {
    id: "callideb-x", name: "Callide B closure (coal)", region: "QLD1", tech: "closure", mw: -700, closureFuel: "coal", year: 2028, lat: -24.34, lng: 150.61,
    developer: "CS Energy (state)", status: "scheduled 2028",
    description: "First scheduled Queensland coal exit under the state energy plan.",
    url: "https://www.csenergy.com.au",
  },
  {
    id: "muja-x", name: "Muja D closure (coal)", region: "WEM", tech: "closure", mw: -392, closureFuel: "coal", year: 2026, lat: -33.45, lng: 116.31,
    developer: "Synergy (state)", status: "staged retirement underway",
    description: "Final Muja units in WA's plan to exit state-owned coal by ~2030.",
    url: "https://www.synergy.net.au",
  },
];

// Approximate registered capacity by fuel, MW (stylized; ±, mid-2020s).
// Exported: the desk uses it to turn regional generation into capacity factors.
export const REGION_CAPACITY_MW: Record<string, Partial<Record<FuelGroup, number>>> = {
  NSW1: { coal: 8240, gas: 2600, hydro: 4600, wind: 3600, solar: 5000, battery: 1800, distillate: 200 },
  QLD1: { coal: 8100, gas: 3300, hydro: 1700, wind: 2700, solar: 5500, battery: 1300, distillate: 400 },
  VIC1: { coal: 4760, gas: 2400, hydro: 2300, wind: 4800, solar: 2200, battery: 1200, distillate: 100 },
  SA1: { gas: 2600, wind: 2300, solar: 800, battery: 1000, distillate: 400 },
  TAS1: { hydro: 2300, gas: 380, wind: 600, solar: 10 },
  WEM: { coal: 1600, gas: 3500, wind: 900, solar: 600, battery: 900, distillate: 100 },
};

/** Indicative short-run marginal cost per fuel band, $/MWh, merit order. */
const SRMC: Array<{ fuel: FuelGroup; srmc: number }> = [
  { fuel: "solar", srmc: 0 },
  { fuel: "wind", srmc: 8 },
  { fuel: "coal", srmc: 38 },
  { fuel: "hydro", srmc: 55 },
  { fuel: "gas", srmc: 110 },
  { fuel: "battery", srmc: 170 },
  { fuel: "bioenergy", srmc: 90 },
  { fuel: "distillate", srmc: 350 },
];

const PRICE_CAP = 17_500;
const TOP_SRMC = 350;

/** Indicative import headroom over interconnectors, MW — without this a
 *  closure scenario hits the scarcity tail far too easily. */
const IMPORT_CAPACITY_MW: Record<string, number> = {
  NSW1: 3400, QLD1: 1300, VIC1: 2700, SA1: 900, TAS1: 600, WEM: 0,
};
const IMPORT_SRMC = 130;

export type StackFuel = FuelGroup | "import";

interface Band {
  fuel: StackFuel;
  srmc: number;
  capMW: number;
  cumBelowMW: number;
  /** Price at the top of this band = next band's SRMC (or TOP_SRMC). */
  srmcNext: number;
}

/** Diurnal availability of each band: solar follows the sun, wind a typical
 *  capacity factor, thermal/hydro a flat outage allowance. Without this the
 *  stack would offer full VRE nameplate at evening peak and every scenario
 *  would sit unrealistically close to the scarcity tail. */
function availability(fuel: StackFuel, hourLocal: number): number {
  switch (fuel) {
    case "solar": {
      const s = Math.sin((Math.PI * (hourLocal - 6)) / 13);
      return s > 0 ? Math.pow(s, 1.4) * 0.85 : 0;
    }
    case "wind":
      return 0.38;
    case "battery":
      return hourLocal >= 16 && hourLocal < 23 ? 0.9 : 0.4;
    case "import":
      return 0.75;
    default:
      return 0.92;
  }
}

export function buildStack(
  region: string,
  hourLocal: number,
  mods: Partial<Record<FuelGroup, number>> = {},
): Band[] {
  const caps = REGION_CAPACITY_MW[region] ?? {};
  const entries: Array<{ fuel: StackFuel; srmc: number; nameplate: number }> = SRMC.map((b) => ({
    fuel: b.fuel,
    srmc: b.srmc,
    nameplate: Math.max((caps[b.fuel] ?? 0) + (mods[b.fuel] ?? 0), 0),
  }));
  entries.push({ fuel: "import", srmc: IMPORT_SRMC, nameplate: IMPORT_CAPACITY_MW[region] ?? 0 });

  const ordered = entries
    .filter((e) => e.nameplate * availability(e.fuel, hourLocal) > 0)
    .sort((a, b) => a.srmc - b.srmc);

  const bands: Band[] = [];
  let cum = 0;
  ordered.forEach((e, i) => {
    const cap = e.nameplate * availability(e.fuel, hourLocal);
    bands.push({
      fuel: e.fuel,
      srmc: e.srmc,
      capMW: cap,
      cumBelowMW: cum,
      srmcNext: ordered[i + 1]?.srmc ?? TOP_SRMC,
    });
    cum += cap;
  });
  return bands;
}

function totalCap(stack: Band[]): number {
  const last = stack[stack.length - 1];
  return last ? last.cumBelowMW + last.capMW : 0;
}

/** Price for a given net demand against the stack (piecewise linear + scarcity tail). */
export function priceAt(stack: Band[], demandMW: number): number {
  const total = totalCap(stack);
  if (total <= 0) return TOP_SRMC;
  if (demandMW <= 0) return stack[0].srmc;
  if (demandMW >= total) {
    const over = (demandMW - total) / Math.max(total * 0.15, 1);
    return Math.min(TOP_SRMC + Math.pow(over, 1.5) * (PRICE_CAP - TOP_SRMC), PRICE_CAP);
  }
  for (const band of stack) {
    if (demandMW <= band.cumBelowMW + band.capMW) {
      const frac = (demandMW - band.cumBelowMW) / band.capMW;
      return band.srmc + frac * (band.srmcNext - band.srmc);
    }
  }
  return TOP_SRMC;
}

/** Inverse: implied net demand consistent with an observed price. */
export function demandAt(stack: Band[], priceAUD: number): number {
  const total = totalCap(stack);
  const p = Math.max(priceAUD, 0);
  if (stack.length === 0) return 0;
  if (p >= TOP_SRMC) {
    const over = Math.pow(Math.max(p - TOP_SRMC, 0) / (PRICE_CAP - TOP_SRMC), 2 / 3);
    return total + over * total * 0.15;
  }
  for (const band of stack) {
    if (p <= band.srmcNext || band.srmcNext === band.srmc) {
      const span = band.srmcNext - band.srmc;
      const frac = span > 0 ? Math.min(Math.max((p - band.srmc) / span, 0), 1) : 0.5;
      return band.cumBelowMW + frac * band.capMW;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Generation profiles (per 30-min interval)

function hash01(n: number): number {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

/** Asset output in MW at timestamp; negative = drawing from the grid. */
export function assetOutputMW(asset: ScenarioAsset, ts: number, i: number): number {
  const h = (new Date(ts).getUTCHours() + 10 + new Date(ts).getUTCMinutes() / 60) % 24;
  switch (asset.tech) {
    case "solar": {
      const s = Math.sin((Math.PI * (h - 6)) / 13);
      return s > 0 ? asset.mw * Math.pow(s, 1.4) * 0.95 : 0;
    }
    case "wind": {
      const cf =
        0.38 + 0.28 * Math.sin(i / 16.3 + asset.mw) + 0.36 * (hash01(asset.mw + i * 2.7) - 0.5);
      return asset.mw * Math.min(Math.max(cf, 0.04), 0.92);
    }
    case "battery":
      if (h >= 17 && h < 21.5) return asset.mw;
      if (h >= 10.5 && h < 15) return -asset.mw * 0.55;
      return 0;
    case "phes":
      if (h >= 17 && h < 22.5) return asset.mw * 0.85;
      if (h < 6 || (h >= 11 && h < 15)) return -asset.mw * 0.5;
      return 0;
    case "gas":
      // Dispatchable: modelled as stack capacity, not a fixed profile.
      return 0;
  }
}

// ---------------------------------------------------------------------------

export interface MixSlice {
  fuel: StackFuel;
  mwh: number;
}

export interface ScenarioResult {
  region: string;
  hours: number;
  avgBeforeAUD: number;
  avgAfterAUD: number;
  /** Price-duration extremes for context. */
  p95BeforeAUD: number;
  p95AfterAUD: number;
  mixBefore: MixSlice[];
  mixAfter: MixSlice[];
  /** Asset energy delivered over the window (discharge only for storage). */
  assetMWh: number;
  realizedCF: number | null;
  /** Generation-weighted price the asset earns under the new price curve. */
  captureAUD: number | null;
  revenueWindowAUD: number | null;
  seriesBefore: PricePoint[];
  seriesAfter: PricePoint[];
}

function bandGeneration(stack: Band[], demandMW: number, gen: Map<StackFuel, number>, dtH: number) {
  for (const band of stack) {
    const used = Math.min(Math.max(demandMW - band.cumBelowMW, 0), band.capMW);
    if (used > 0) gen.set(band.fuel, (gen.get(band.fuel) ?? 0) + used * dtH);
  }
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(q * sorted.length), sorted.length - 1)];
}

export function runScenario(
  prices: PricePoint[],
  intervalHours: number,
  asset: ScenarioAsset,
): ScenarioResult {
  const isClosure = asset.closureFuel != null;
  const mods: Partial<Record<FuelGroup, number>> = {};
  if (isClosure) mods[asset.closureFuel as FuelGroup] = asset.mw; // mw negative
  if (asset.tech === "gas" && !isClosure) mods.gas = asset.mw;

  const genBefore = new Map<StackFuel, number>();
  const genAfter = new Map<StackFuel, number>();
  const seriesBefore: PricePoint[] = [];
  const seriesAfter: PricePoint[] = [];
  let sumBefore = 0;
  let sumAfter = 0;
  let assetMWh = 0;
  let captureWeighted = 0;

  prices.forEach(([ts, observed], i) => {
    const h = (new Date(ts).getUTCHours() + 10 + new Date(ts).getUTCMinutes() / 60) % 24;
    const stackBefore = buildStack(asset.region, h);
    const stackAfter = buildStack(asset.region, h, mods);

    const pObserved = Math.max(observed, 0);
    const demand = demandAt(stackBefore, pObserved);

    let out = isClosure || asset.tech === "gas" ? 0 : assetOutputMW(asset, ts, i);
    // Storage wouldn't charge into expensive hours or dispatch into a glut.
    if (out < 0 && pObserved > 90) out = 0;
    if (out > 0 && (asset.tech === "battery" || asset.tech === "phes") && pObserved < 40) out = 0;

    const demandAfter = Math.max(demand - out, 0);

    // The merit-order model only sets the price *shift*; anchor to the
    // observed price so the baseline is exact. Additive (not multiplicative)
    // so already-spiked observed prices don't compound the scarcity tail.
    const modelBefore = priceAt(stackBefore, demand);
    const modelAfter = priceAt(stackAfter, demandAfter);
    // Bound the per-interval shift: the stylised stack shouldn't claim more
    // precision than it has, especially in the scarcity tail.
    const delta = Math.min(Math.max(modelAfter - modelBefore, -500), 2500);
    const pBefore = pObserved;
    const pAfter = Math.min(Math.max(pObserved + delta, -300), PRICE_CAP);

    bandGeneration(stackBefore, demand, genBefore, intervalHours);
    bandGeneration(stackAfter, demandAfter, genAfter, intervalHours);
    if (out > 0) {
      assetMWh += out * intervalHours;
      captureWeighted += pAfter * out * intervalHours;
    }

    sumBefore += pBefore;
    sumAfter += pAfter;
    seriesBefore.push([ts, Math.round(pBefore * 10) / 10]);
    seriesAfter.push([ts, Math.round(pAfter * 10) / 10]);
  });

  // Credit the new asset's own energy to its fuel bucket in the "after" mix.
  if (assetMWh > 0) {
    const bucket: FuelGroup = asset.tech === "phes" ? "hydro" : (asset.tech as FuelGroup);
    genAfter.set(bucket, (genAfter.get(bucket) ?? 0) + assetMWh);
  }

  const toMix = (m: Map<StackFuel, number>): MixSlice[] =>
    [...m.entries()]
      .map(([fuel, mwh]) => ({ fuel, mwh }))
      .sort((a, b) => b.mwh - a.mwh);

  const n = prices.length || 1;
  const hours = prices.length * intervalHours;
  const sortedBefore = seriesBefore.map((p) => p[1]).sort((a, b) => a - b);
  const sortedAfter = seriesAfter.map((p) => p[1]).sort((a, b) => a - b);
  const generating = !isClosure && asset.tech !== "gas";

  return {
    region: asset.region,
    hours,
    avgBeforeAUD: sumBefore / n,
    avgAfterAUD: sumAfter / n,
    p95BeforeAUD: percentile(sortedBefore, 0.95),
    p95AfterAUD: percentile(sortedAfter, 0.95),
    mixBefore: toMix(genBefore),
    mixAfter: toMix(genAfter),
    assetMWh,
    realizedCF: generating && hours > 0 && asset.mw > 0 ? assetMWh / (asset.mw * hours) : null,
    captureAUD: generating && assetMWh > 0 ? captureWeighted / assetMWh : null,
    revenueWindowAUD: generating ? captureWeighted : null,
    seriesBefore,
    seriesAfter,
  };
}
