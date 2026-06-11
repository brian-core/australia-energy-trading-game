import type { RegionSeriesData, SeriesPayload } from "./series";
import type { RegionWeather, WeatherPayload } from "./weather";
import { errorStats, ols, ols2, pearson, stdDev } from "./stats";

// The LAB's forward simulation ("time travel"):
//  1. FIT — from the last 7 days of aligned 30-min grid data and hourly
//     weather, fit: wind generation ~ wind speed³, solar ~ radiation,
//     demand ~ hour-of-day shape + heating/cooling degrees, and
//     price ~ residual demand (demand − wind − solar).
//  2. PROJECT — run those fits over the 7-day weather *forecast* to
//     synthesise future demand, VRE output and price (with a ±1σ band).
//  3. SCORE — when reality catches up, compare stored forecasts against
//     actuals: MAE / RMSE / bias per variable.
// Transparent statistics, no AI: every number traces to a fit you can read.

export interface RegionFitInfo {
  corr: { priceTemp: number; priceWind: number; priceSolar: number; priceDemand: number; demandTemp: number; windGenWind: number; solarGenRad: number };
  sigma: { price: number; demand: number; wind: number; solar: number };
  priceModel: { a: number; b: number; r2: number; sigma: number };
  demandModel: { r2: number; coolPerDeg: number; heatPerDeg: number };
  windModel: { r2: number };
  solarModel: { r2: number };
}

export interface RegionForecast {
  t: number[];
  priceHat: number[];
  priceLo: number[];
  priceHi: number[];
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
  // Price: ~ residual demand share.
  const residual = t.map((_, i) => demandMW[i] - windMW[i] - solarMW[i]);
  const priceFit = ols(residual, priceAUD);

  const fit: RegionFitInfo = {
    corr: {
      priceTemp: pearson(tempH, priceAUD),
      priceWind: pearson(windH, priceAUD),
      priceSolar: pearson(radH, priceAUD),
      priceDemand: pearson(demandMW, priceAUD),
      demandTemp: pearson(tempH, demandMW),
      windGenWind: pearson(windH, windMW),
      solarGenRad: pearson(radH, solarMW),
    },
    sigma: {
      price: stdDev(priceAUD.filter(Number.isFinite)),
      demand: stdDev(demandMW.filter(Number.isFinite)),
      wind: stdDev(windMW.filter(Number.isFinite)),
      solar: stdDev(solarMW.filter(Number.isFinite)),
    },
    priceModel: { a: priceFit.intercept, b: priceFit.slope, r2: priceFit.r2, sigma: priceFit.sigma },
    demandModel: { r2: demandFit.r2, coolPerDeg: demandFit.b1, heatPerDeg: demandFit.b2 },
    windModel: { r2: windFit.r2 },
    solarModel: { r2: solarFit.r2 },
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
    const p = priceFit.intercept + priceFit.slope * (d - w - s);
    const pc = Math.min(Math.max(p, -150), 2000);
    windHat.push(Math.round(w));
    solarHat.push(Math.round(s));
    demandHat.push(Math.round(d));
    priceHat.push(Math.round(pc * 10) / 10);
    priceLo.push(Math.round((pc - priceFit.sigma) * 10) / 10);
    priceHi.push(Math.round((pc + priceFit.sigma) * 10) / 10);
  }

  return { t: ft, priceHat, priceLo, priceHi, demandHat, windHat, solarHat, tempC: tempF, windMs: windF, radWm2: radF, fit };
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
  /** Per region: timestamps + the four forecast tracks we grade. */
  regions: Record<
    string,
    { t: number[]; priceHat: number[]; demandHat: number[]; windHat: number[]; solarHat: number[] }
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

/** Grade a snapshot against actual series over the elapsed overlap. */
export function scoreSnapshot(
  snap: LabSnapshot,
  actual: SeriesPayload,
  region: string,
  now: number,
): { rows: VarianceRow[]; coverage: number } | null {
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
  const elapsed = f.t.filter((ts) => ts <= now).length;
  return { rows, coverage: f.t.length ? elapsed / f.t.length : 0 };
}
