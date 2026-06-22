import type { Facility, FuelGroup } from "./types";

// OPS game engine: own a generation fleet, keep it maintained, earn the live
// spot price. Pure simulation for fun — decay rates and prices-per-MW are
// tuned for session pacing, not realism.

export interface MaintTaskDef {
  id: string;
  label: string;
  /** Condition lost per real-time minute, %. */
  decayPerMin: number;
  /** Cost to run, AUD per MW of asset capacity. */
  costPerMW: number;
  /** Real-time seconds the job takes (asset runs derated meanwhile). */
  durationSec: number;
}

export const TASKS_BY_FUEL: Record<FuelGroup, MaintTaskDef[]> = {
  solar: [
    { id: "soiling", label: "Panel cleaning", decayPerMin: 1.3, costPerMW: 220, durationSec: 90 },
    { id: "software", label: "Inverter software", decayPerMin: 0.7, costPerMW: 120, durationSec: 60 },
  ],
  // Rooftop is behind-the-meter (not a buildable facility); mirrors solar so
  // the FuelGroup map stays exhaustive.
  rooftop: [
    { id: "soiling", label: "Panel cleaning", decayPerMin: 1.3, costPerMW: 220, durationSec: 90 },
    { id: "software", label: "Inverter software", decayPerMin: 0.7, costPerMW: 120, durationSec: 60 },
  ],
  wind: [
    { id: "gearbox", label: "Turbine maintenance", decayPerMin: 1.0, costPerMW: 450, durationSec: 150 },
    { id: "software", label: "Control software", decayPerMin: 0.7, costPerMW: 120, durationSec: 60 },
  ],
  coal: [
    { id: "coalstock", label: "Coal delivery", decayPerMin: 2.2, costPerMW: 380, durationSec: 75 },
    { id: "mech", label: "Mechanical maintenance", decayPerMin: 0.6, costPerMW: 600, durationSec: 180 },
  ],
  gas: [
    { id: "mech", label: "Mechanical maintenance", decayPerMin: 0.8, costPerMW: 500, durationSec: 150 },
    { id: "software", label: "Turbine control software", decayPerMin: 0.6, costPerMW: 130, durationSec: 60 },
  ],
  battery: [
    { id: "cells", label: "Cell balancing", decayPerMin: 0.8, costPerMW: 260, durationSec: 90 },
    { id: "software", label: "BMS software", decayPerMin: 0.9, costPerMW: 140, durationSec: 60 },
  ],
  hydro: [
    { id: "mech", label: "Mechanical maintenance", decayPerMin: 0.5, costPerMW: 420, durationSec: 180 },
  ],
  bioenergy: [
    { id: "mech", label: "Mechanical maintenance", decayPerMin: 0.8, costPerMW: 400, durationSec: 120 },
  ],
  distillate: [
    { id: "mech", label: "Mechanical maintenance", decayPerMin: 0.6, costPerMW: 400, durationSec: 120 },
  ],
};

/** Purchase price, AUD per MW (playful, not market valuations). */
export const PRICE_PER_MW: Record<FuelGroup, number> = {
  coal: 300_000,
  gas: 600_000,
  hydro: 1_800_000,
  wind: 1_400_000,
  solar: 900_000,
  rooftop: 900_000,
  battery: 1_100_000,
  bioenergy: 800_000,
  distillate: 300_000,
};

/** Typical capacity factor used for revenue (solar additionally gated by sun). */
export const CF_BY_FUEL: Record<FuelGroup, number> = {
  coal: 0.85,
  gas: 0.4,
  hydro: 0.45,
  wind: 0.36,
  solar: 0.95, // multiplied by the diurnal solar shape
  rooftop: 0.95,
  battery: 0.25, // evening-arbitrage proxy
  bioenergy: 0.6,
  distillate: 0.1,
};

export interface OwnedAsset {
  id: string;
  name: string;
  fuel: FuelGroup;
  capacityMW: number;
  region: string;
  lat: number;
  lng: number;
  /** taskId -> condition 0..100 */
  conditions: Record<string, number>;
  /** taskId currently being serviced and when it finishes (epoch ms). */
  job: { taskId: string; until: number } | null;
  paidAUD: number;
}

export interface GameState {
  cash: number;
  fleet: OwnedAsset[];
  log: Array<{ at: number; msg: string; warn?: boolean }>;
  lastTick: number;
  startedAt: number;
}

export const STARTING_CASH = 500_000_000;
export const GAME_STORAGE_KEY = "au-energy-game-v1";

export function newGame(): GameState {
  const now = Date.now();
  return {
    cash: STARTING_CASH,
    fleet: [],
    log: [{ at: now, msg: "Company founded with $500m. Buy assets in the MARKET, keep them maintained, earn the live spot price." }],
    lastTick: now,
    startedAt: now,
  };
}

export function loadGame(): GameState {
  if (typeof window === "undefined") return newGame();
  try {
    const raw = window.localStorage.getItem(GAME_STORAGE_KEY);
    if (!raw) return newGame();
    const parsed = JSON.parse(raw) as GameState;
    if (typeof parsed.cash !== "number" || !Array.isArray(parsed.fleet)) return newGame();
    return parsed;
  } catch {
    return newGame();
  }
}

export function saveGame(state: GameState) {
  try {
    window.localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — play on in memory
  }
}

export function buyPrice(facility: Facility): number {
  return facility.capacityMW * PRICE_PER_MW[facility.fuel];
}

export function sellPrice(asset: OwnedAsset): number {
  return Math.round(asset.paidAUD * 0.7);
}

/** Diurnal solar gate using AEST-ish local hour. */
function solarShape(date: Date): number {
  const h = (date.getUTCHours() + 10 + date.getUTCMinutes() / 60) % 24;
  const s = Math.sin((Math.PI * (h - 6)) / 13);
  return s > 0 ? Math.pow(s, 1.4) : 0;
}

/** Output derate from condition: pristine fleet = 1.0, neglected ≈ 0.25. */
export function conditionFactor(asset: OwnedAsset): number {
  const tasks = TASKS_BY_FUEL[asset.fuel];
  if (tasks.length === 0) return 1;
  const avg = tasks.reduce((s, t) => s + (asset.conditions[t.id] ?? 100), 0) / tasks.length;
  return 0.25 + 0.75 * (avg / 100);
}

/** Current sent-out MW, including condition + sun + in-progress job derate. */
export function assetOutputMW(asset: OwnedAsset, now: number): number {
  let out = asset.capacityMW * CF_BY_FUEL[asset.fuel] * conditionFactor(asset);
  if (asset.fuel === "solar") out *= solarShape(new Date(now));
  if (asset.job && asset.job.until > now) out *= 0.5;
  return out;
}

const TICK_LOG_THRESHOLD = 35;

/**
 * Advance the game: decay conditions, complete jobs, accrue revenue at the
 * live regional spot price. Mutation-free; returns the next state.
 */
export function tick(
  state: GameState,
  now: number,
  spotByRegion: Map<string, number | null>,
): GameState {
  const dtMin = Math.min(Math.max((now - state.lastTick) / 60_000, 0), 240); // cap offline catch-up at 4h
  if (dtMin <= 0) return state;
  const dtH = dtMin / 60;

  let cash = state.cash;
  const log = [...state.log];

  const fleet = state.fleet.map((asset) => {
    const tasks = TASKS_BY_FUEL[asset.fuel];
    const conditions = { ...asset.conditions };
    let job = asset.job;

    for (const task of tasks) {
      const current = conditions[task.id] ?? 100;
      if (job?.taskId === task.id) continue; // being serviced, no decay
      const next = Math.max(current - task.decayPerMin * dtMin, 5);
      if (current >= TICK_LOG_THRESHOLD && next < TICK_LOG_THRESHOLD) {
        log.push({
          at: now,
          warn: true,
          msg: `${asset.name}: ${task.label.toLowerCase()} at ${Math.round(next)}% — output degrading.`,
        });
      }
      conditions[task.id] = next;
    }

    if (job && job.until <= now) {
      conditions[job.taskId] = 100;
      const def = tasks.find((t) => t.id === job?.taskId);
      log.push({ at: now, msg: `${asset.name}: ${def?.label ?? "maintenance"} complete — back to 100%.` });
      job = null;
    }

    const spot = spotByRegion.get(asset.region) ?? null;
    if (spot != null) {
      cash += assetOutputMW({ ...asset, conditions, job }, now) * spot * dtH;
    }

    return { ...asset, conditions, job };
  });

  return { ...state, cash, fleet, log: log.slice(-60), lastTick: now };
}

export function buyAsset(state: GameState, facility: Facility, now: number): GameState | null {
  const price = buyPrice(facility);
  if (price > state.cash) return null;
  if (state.fleet.some((a) => a.id === facility.name)) return null;
  const conditions: Record<string, number> = {};
  for (const t of TASKS_BY_FUEL[facility.fuel]) conditions[t.id] = 75 + Math.random() * 20;
  return {
    ...state,
    cash: state.cash - price,
    fleet: [
      ...state.fleet,
      {
        id: facility.name,
        name: facility.name,
        fuel: facility.fuel,
        capacityMW: facility.capacityMW,
        region: facility.region,
        lat: facility.lat,
        lng: facility.lng,
        conditions,
        job: null,
        paidAUD: price,
      },
    ],
    log: [...state.log, { at: now, msg: `Acquired ${facility.name} (${facility.capacityMW} MW) for $${(price / 1e6).toFixed(0)}m.` }].slice(-60),
  };
}

export function sellAsset(state: GameState, assetId: string, now: number): GameState {
  const asset = state.fleet.find((a) => a.id === assetId);
  if (!asset) return state;
  const proceeds = sellPrice(asset);
  return {
    ...state,
    cash: state.cash + proceeds,
    fleet: state.fleet.filter((a) => a.id !== assetId),
    log: [...state.log, { at: now, msg: `Sold ${asset.name} for $${(proceeds / 1e6).toFixed(0)}m.` }].slice(-60),
  };
}

export function startMaintenance(state: GameState, assetId: string, taskId: string, now: number): GameState {
  const asset = state.fleet.find((a) => a.id === assetId);
  if (!asset || asset.job) return state;
  const task = TASKS_BY_FUEL[asset.fuel].find((t) => t.id === taskId);
  if (!task) return state;
  const cost = task.costPerMW * asset.capacityMW;
  if (cost > state.cash) return state;
  return {
    ...state,
    cash: state.cash - cost,
    fleet: state.fleet.map((a) =>
      a.id === assetId ? { ...a, job: { taskId, until: now + task.durationSec * 1000 } } : a,
    ),
    log: [
      ...state.log,
      { at: now, msg: `${asset.name}: ${task.label.toLowerCase()} started ($${Math.round(cost / 1000)}k, ${task.durationSec}s, output −50% meanwhile).` },
    ].slice(-60),
  };
}

/** Fleet book value + cash = score. */
export function companyValue(state: GameState): number {
  return state.cash + state.fleet.reduce((s, a) => s + a.paidAUD * 0.7, 0);
}
