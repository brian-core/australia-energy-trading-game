import type { RegionSeriesData, SeriesPayload } from "./series";
import type { RegionWeather, WeatherPayload } from "./weather";
import { errorStats, mulberry32, ols, ols2, pearson, quantile, stdDev, winsorize } from "./stats";

// The LAB's forward simulation ("time travel"):
//  1. FIT — from the last 7 days of aligned 30-min grid data and hourly
//     weather, fit: wind generation ~ wind speed³, solar ~ radiation,
//     demand ~ hour-of-day shape + heating/cooling degrees, and
//     price ~ residual demand (demand − wind − solar).
//  2. PROJECT — run those fits over the 7-day weather *forecast* to
//     synthesise future demand, VRE output and price (±1σ band, plus a
//     Monte-Carlo fan from block-bootstrapped model errors).
//  3. SCORE — when reality catches up, compare stored forecasts against
//     actuals: MAE / RMSE / bias per variable.
// Transparent statistics, no AI: every number traces to a fit you can read.

export interface RegionFitInfo {
  corr: { priceTemp: number; priceWind: number; priceSolar: number; priceDemand: number; demandTemp: number; windGenWind: number; solarGenRad: number };
  sigma: { price: number; demand: number; wind: number; solar: number };
  priceModel: { a: number; b: number; r2: number; sigma: number; basis: "utilisation" | "residual" | "hourly-profile" };
  demandModel: { r2: number; coolPerDeg: number; heatPerDeg: number };
  windModel: { r2: number };
  solarModel: { r2: number };
  /** Inferred thermal availability (rolling 48h max of coal+gas output). */
  outage: { availNowMW: number; peak7dMW: number; impliedOutMW: number };
}

export interface RegionForecast {
  t: number[];
  priceHat: number[];
  priceLo: number[];
  priceHi: number[];
  /** Monte-Carlo price fan: per-step quantiles across bootstrapped paths
   *  (null when the history is too thin to resample errors from). */
  mc: { runs: number; p10: number[]; p25: number[]; p75: number[]; p90: number[] } | null;
  demandHat: number[];
  windHat: number[];
  solarHat: number[];
  tempC: number[];
  windMs: number[];
  radWm2: number[];
  fit: RegionFitInfo;
}

export interface ForecastResult {
  createdAt: number;
  horizonH: number;
  regions: Record<string, RegionForecast>;
}

/** Sample an hourly series at a 30-min timestamp (nearest hour). */
function hourlyAt(t: number[], v: number[], ts: number): number {
  if (t.length === 0) return NaN;
  const j = Math.round((ts - t[0]) / 3600_000);
  return v[Math.min(Math.max(j, 0), v.length - 1)];
}

function hodOf(ts: number): number {
  return (new Date(ts).getUTCHours() + 10) % 24; // AEST-ish
}

export function fitAndProject(
  series: RegionSeriesData,
  weather: RegionWeather,
  horizonH: number,
): RegionForecast {
  const { t, priceAUD, demandMW, windMW, solarMW } = series;

  // Align weather history onto the grid.
  const tempH = t.map((ts) => hourlyAt(weather.capital.t, weather.capital.tempC, ts));
  const windH = t.map((ts) => hourlyAt(weather.belt.t, weather.belt.windMs, ts));
  const radH = t.map((ts) => hourlyAt(weather.belt.t, weather.belt.radWm2, ts));

  // --- FIT ---------------------------------------------------------------
  // Wind: power ~ v³ (capped) — first-order turbine power curve.
  const windCubed = windH.map((v) => Math.min(v, 14) ** 3);
  const windFit = ols(windCubed, windMW);
  // Solar: power ~ radiation (daylight samples only).
  const dayIdx = radH.map((r, i) => (r > 20 ? i : -1)).filter((i) => i >= 0);
  const solarFit = ols(
    dayIdx.map((i) => radH[i]),
    dayIdx.map((i) => solarMW[i]),
  );
  // Demand: hour-of-day baseline + cooling/heating degree response.
  const hodSum = new Array(24).fill(0);
  const hodN = new Array(24).fill(0);
  t.forEach((ts, i) => {
    if (Number.isFinite(demandMW[i])) {
      hodSum[hodOf(ts)] += demandMW[i];
      hodN[hodOf(ts)]++;
    }
  });
  const hodBase = hodSum.map((s, i) => (hodN[i] ? s / hodN[i] : NaN));
  const demandResid = t.map((ts, i) => demandMW[i] - hodBase[hodOf(ts)]);
  const cdd = tempH.map((x) => Math.max(x - 22, 0));
  const hdd = tempH.map((x) => Math.max(15 - x, 0));
  const demandFit = ols2(cdd, hdd, demandResid);
  // Price model with outage awareness. Available thermal capacity is
  // inferred as the rolling 48h max of coal+gas output: when a unit trips,
  // that ceiling visibly drops. Where a region has a meaningful thermal
  // fleet we fit price ~ utilisation (residual demand / available thermal),
  // which reprices automatically when capacity is lost; otherwise we fall
  // back to plain residual demand.
  const residual = t.map((_, i) => demandMW[i] - windMW[i] - solarMW[i]);
  const thermal = series.thermalMW ?? new Array(t.length).fill(NaN);
  const WINDOW = 96; // 48h of 30-min steps
  const avail: number[] = new Array(t.length).fill(NaN);
  for (let i = 0; i < t.length; i++) {
    let mx = NaN;
    for (let j = Math.max(0, i - WINDOW); j <= i; j++) {
      const v = thermal[j];
      if (Number.isFinite(v) && (!Number.isFinite(mx) || v > mx)) mx = v;
    }
    avail[i] = mx;
  }
  const finiteThermal = thermal.filter(Number.isFinite);
  const peak7d = finiteThermal.length ? Math.max(...finiteThermal) : 0;
  const availNow = [...avail].reverse().find(Number.isFinite) ?? 0;
  const hasThermal = peak7d > 250;
  const utilisation = t.map((_, i) =>
    hasThermal && Number.isFinite(avail[i]) && avail[i]! > 1 ? residual[i] / avail[i]! : NaN,
  );
  // Spot markets spike to 100x the median; a handful of $10k+ intervals
  // crush least-squares and Pearson r to ~0. Fit on winsorized prices
  // (clipped to P2..P98) so the regression learns the bulk behaviour, and
  // fall back to an hour-of-day price profile when even the robust
  // regressions explain little (weak-coupling weeks are real).
  const priceRobust = winsorize(priceAUD, 0.02, 0.98);
  const utilFit = hasThermal ? ols(utilisation, priceRobust) : null;
  const residFit = ols(residual, priceRobust);
  const MIN_R2 = 0.15;
  const useUtil = utilFit !== null && utilFit.r2 > residFit.r2 && utilFit.r2 >= MIN_R2;
  const useResid = !useUtil && residFit.r2 >= MIN_R2;
  const priceFit = useUtil ? utilFit! : residFit;
  // Hour-of-day price profile (median + IQR-based sigma) as the fallback.
  const hodPrices: number[][] = Array.from({ length: 24 }, () => []);
  t.forEach((ts, i) => {
    if (Number.isFinite(priceRobust[i])) hodPrices[hodOf(ts)].push(priceRobust[i]);
  });
  const hodPriceMed = hodPrices.map((arr) => quantile(arr, 0.5));
  const hodPriceSigma = hodPrices.map((arr) => {
    const s = stdDev(arr);
    return Number.isFinite(s) ? s : 0;
  });
  const useProfile = !useUtil && !useResid;

  const dayMask = radH.map((r) => Number.isFinite(r) && r > 20);
  const fit: RegionFitInfo = {
    corr: {
      priceTemp: pearson(tempH, priceRobust),
      priceWind: pearson(windH, priceRobust),
      priceSolar: pearson(radH, priceRobust),
      priceDemand: pearson(demandMW, priceRobust),
      demandTemp: pearson(tempH, demandMW),
      windGenWind: pearson(windH, windMW),
      // Daylight samples only — including nights dilutes solar to noise.
      solarGenRad: pearson(
        radH.filter((_, i) => dayMask[i]),
        solarMW.filter((_, i) => dayMask[i]),
      ),
    },
    sigma: {
      price: stdDev(priceAUD.filter(Number.isFinite)),
      demand: stdDev(demandMW.filter(Number.isFinite)),
      wind: stdDev(windMW.filter(Number.isFinite)),
      solar: stdDev(solarMW.filter(Number.isFinite)),
    },
    priceModel: {
      a: priceFit.intercept,
      b: priceFit.slope,
      r2: priceFit.r2,
      sigma: priceFit.sigma,
      basis: useProfile ? "hourly-profile" : useUtil ? "utilisation" : "residual",
    },
    demandModel: { r2: demandFit.r2, coolPerDeg: demandFit.b1, heatPerDeg: demandFit.b2 },
    windModel: { r2: windFit.r2 },
    solarModel: { r2: solarFit.r2 },
    outage: {
      availNowMW: Math.round(availNow),
      peak7dMW: Math.round(peak7d),
      impliedOutMW: Math.round(Math.max(peak7d - availNow, 0)),
    },
  };

  // --- PROJECT -----------------------------------------------------------
  const startMs = Math.ceil(Date.now() / 1800_000) * 1800_000;
  const steps = horizonH * 2;
  const ft: number[] = [];
  const priceHat: number[] = [];
  const priceLo: number[] = [];
  const priceHi: number[] = [];
  const demandHat: number[] = [];
  const windHat: number[] = [];
  const solarHat: number[] = [];
  const tempF: number[] = [];
  const windF: number[] = [];
  const radF: number[] = [];
  const maxWind = Math.max(...windMW.filter(Number.isFinite), 1) * 1.15;
  const maxSolar = Math.max(...solarMW.filter(Number.isFinite), 1) * 1.15;

  for (let i = 0; i < steps; i++) {
    const ts = startMs + i * 1800_000;
    ft.push(ts);
    const temp = hourlyAt(weather.capital.t, weather.capital.tempC, ts);
    const wind = hourlyAt(weather.belt.t, weather.belt.windMs, ts);
    const rad = hourlyAt(weather.belt.t, weather.belt.radWm2, ts);
    tempF.push(temp);
    windF.push(wind);
    radF.push(rad);

    const w = Math.min(Math.max(windFit.intercept + windFit.slope * Math.min(wind, 14) ** 3, 0), maxWind);
    const s = rad > 20 ? Math.min(Math.max(solarFit.intercept + solarFit.slope * rad, 0), maxSolar) : 0;
    const d = Math.max(
      (hodBase[hodOf(ts)] || 0) +
        demandFit.a +
        demandFit.b1 * Math.max(temp - 22, 0) +
        demandFit.b2 * Math.max(15 - temp, 0),
      0,
    );
    let p: number;
    let sig: number;
    if (useProfile) {
      p = hodPriceMed[hodOf(ts)];
      sig = hodPriceSigma[hodOf(ts)] || priceFit.sigma;
    } else {
      const x = useUtil ? (d - w - s) / Math.max(availNow, 1) : d - w - s;
      p = priceFit.intercept + priceFit.slope * x;
      sig = priceFit.sigma;
    }
    const pc = Math.min(Math.max(Number.isFinite(p) ? p : 0, -150), 2000);
    windHat.push(Math.round(w));
    solarHat.push(Math.round(s));
    demandHat.push(Math.round(d));
    priceHat.push(Math.round(pc * 10) / 10);
    priceLo.push(Math.round((pc - sig) * 10) / 10);
    priceHi.push(Math.round((pc + sig) * 10) / 10);
  }

  // --- MONTE CARLO ---------------------------------------------------------
  // Simulate price paths by block-bootstrapping the model's own in-sample
  // errors (actual − fitted over the 7-day history) around the deterministic
  // projection. 4h blocks preserve spike clustering; per-step quantiles across
  // the paths give the fan. Errors come from the raw (not winsorized) prices
  // so the upper tail carries genuine spike risk.
  const residErr: number[] = [];
  t.forEach((ts, i) => {
    const actual = priceAUD[i];
    if (!Number.isFinite(actual)) return;
    let hat: number;
    if (useProfile) {
      hat = hodPriceMed[hodOf(ts)];
    } else {
      const x = useUtil ? utilisation[i] : residual[i];
      if (!Number.isFinite(x)) return;
      hat = priceFit.intercept + priceFit.slope * x;
    }
    if (Number.isFinite(hat)) residErr.push(actual - hat);
  });

  let mc: RegionForecast["mc"] = null;
  if (residErr.length >= 48) {
    const RUNS = 240;
    const BLOCK = 8; // 4h of 30-min steps
    const rng = mulberry32(0x51ab5eed);
    const perStep: number[][] = Array.from({ length: steps }, () => []);
    for (let r = 0; r < RUNS; r++) {
      for (let i = 0; i < steps; i += BLOCK) {
        const start = Math.floor(rng() * residErr.length);
        for (let j = 0; j < BLOCK && i + j < steps; j++) {
          const v = priceHat[i + j] + residErr[(start + j) % residErr.length];
          // NEM floor/cap — paths may spike; quantiles stay robust.
          perStep[i + j].push(Math.min(Math.max(v, -1000), 16600));
        }
      }
    }
    const q = (p: number) => perStep.map((s) => Math.round(quantile(s, p) * 10) / 10);
    mc = { runs: RUNS, p10: q(0.1), p25: q(0.25), p75: q(0.75), p90: q(0.9) };
  }

  return { t: ft, priceHat, priceLo, priceHi, mc, demandHat, windHat, solarHat, tempC: tempF, windMs: windF, radWm2: radF, fit };
}

export function buildForecast(
  series: SeriesPayload,
  weather: WeatherPayload,
  horizonH: number,
): ForecastResult {
  const regions: Record<string, RegionForecast> = {};
  for (const code of Object.keys(series.regions)) {
    const w = weather.regions[code];
    if (!w) continue;
    regions[code] = fitAndProject(series.regions[code], w, horizonH);
  }
  return { createdAt: Date.now(), horizonH, regions };
}

// --- Snapshots & scoring ----------------------------------------------------

export interface LabSnapshot {
  id: string;
  createdAt: number;
  horizonH: number;
  /** Per region: timestamps + the four forecast tracks we grade, plus the
   *  MC price fan when it existed at snapshot time (older snapshots and
   *  thin-history regions won't have it). */
  regions: Record<
    string,
    {
      t: number[];
      priceHat: number[];
      demandHat: number[];
      windHat: number[];
      solarHat: number[];
      priceP10?: number[];
      priceP90?: number[];
    }
  >;
}

export const LAB_SNAPSHOT_KEY = "energy-lab-snapshots-v1";

export function loadSnapshots(): LabSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(LAB_SNAPSHOT_KEY) ?? "[]") as LabSnapshot[];
  } catch {
    return [];
  }
}

export function saveSnapshots(snaps: LabSnapshot[]) {
  try {
    window.localStorage.setItem(LAB_SNAPSHOT_KEY, JSON.stringify(snaps.slice(-8)));
  } catch {
    // storage full — keep going in memory
  }
}

export interface VarianceRow {
  variable: "price" | "demand" | "wind" | "solar";
  mae: number;
  rmse: number;
  bias: number;
  n: number;
}

/** Fan calibration: how often the actual landed inside the snapshot's
 *  P10-P90 band. A well-calibrated fan hits ~80%. */
export interface FanCalibration {
  hitRate: number;
  n: number;
}

/** Grade a snapshot against actual series over the elapsed overlap. */
export function scoreSnapshot(
  snap: LabSnapshot,
  actual: SeriesPayload,
  region: string,
  now: number,
): { rows: VarianceRow[]; coverage: number; fan: FanCalibration | null } | null {
  const f = snap.regions[region];
  const a = actual.regions[region];
  if (!f || !a) return null;
  const pick = (track: number[], actualTrack: number[]): [number[], number[]] => {
    const fs: number[] = [];
    const as: number[] = [];
    f.t.forEach((ts, i) => {
      if (ts > now) return;
      const j = Math.round((ts - a.startMs) / 1800_000);
      if (j >= 0 && j < actualTrack.length) {
        fs.push(track[i]);
        as.push(actualTrack[j]);
      }
    });
    return [fs, as];
  };
  const make = (variable: VarianceRow["variable"], track: number[], actualTrack: number[]): VarianceRow => {
    const [fs, as] = pick(track, actualTrack);
    return { variable, ...errorStats(fs, as) };
  };
  const rows = [
    make("price", f.priceHat, a.priceAUD),
    make("demand", f.demandHat, a.demandMW),
    make("wind", f.windHat, a.windMW),
    make("solar", f.solarHat, a.solarMW),
  ];

  let fan: FanCalibration | null = null;
  if (f.priceP10 && f.priceP90) {
    let hits = 0;
    let n = 0;
    f.t.forEach((ts, i) => {
      if (ts > now) return;
      const j = Math.round((ts - a.startMs) / 1800_000);
      const actualP = j >= 0 && j < a.priceAUD.length ? a.priceAUD[j] : NaN;
      const lo = f.priceP10![i];
      const hi = f.priceP90![i];
      if (!Number.isFinite(actualP) || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
      n++;
      if (actualP >= lo && actualP <= hi) hits++;
    });
    if (n > 0) fan = { hitRate: hits / n, n };
  }

  const elapsed = f.t.filter((ts) => ts <= now).length;
  return { rows, coverage: f.t.length ? elapsed / f.t.length : 0, fan };
}
