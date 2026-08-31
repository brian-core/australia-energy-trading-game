import { PRICE_PER_MW, STARTING_CASH, type GameState, type OwnedAsset } from "./game";

// Server-side plausibility check for a submitted GameState, run before it is
// ever written to Supabase (see /api/game/save, /api/game/leaderboard).
//
// The game itself is a client-side simulation — there is no per-action
// server ledger — so this doesn't replay history. Instead it bounds what a
// *final* state could physically be, using facts the client can't fake:
//   - any state with cheatsUsed set is rejected outright (the client is
//     supposed to stop syncing once a cheat code is used, see
//     applyCheatCode in game.ts — this is the backstop if it doesn't)
//   - each asset's price must match the fixed PRICE_PER_MW catalog for its
//     declared capacity (catches fabricated assets)
//   - total fleet capacity can't exceed the physical grid (catches a fleet
//     of fake giant "consistent" assets)
//   - total company value can't exceed starting cash plus every owned MW
//     earning the administered NEM price cap for every hour the *account*
//     has existed (catches "set cash to 10^15" outright) — account age is
//     looked up server-side, never trusted from the payload, otherwise a
//     forged `startedAt` could inflate its own ceiling.
//
// This won't catch small-scale cheating (a legitimate-looking but inflated
// state within the ceiling) but it kills the trivial "type a huge number in
// devtools" exploit that would otherwise poison a public leaderboard.

const PRICE_CAP_AUD_PER_MWH = 20_000; // above the NEM's administered price cap, as headroom
const MAX_ASSET_MW = 5_000; // above any real NEM/WEM facility
const MAX_FLEET_SIZE = 300;
const MAX_TOTAL_FLEET_MW = 100_000; // above total NEM + WEM installed capacity
const MAX_LOG_ENTRIES = 200;
const MIN_CASH = -10 * STARTING_CASH; // sustained negative-price exposure can drain cash, but not infinitely
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type ValidationResult = { ok: true; state: GameState } | { ok: false; error: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function validateGameState(raw: unknown, now: number, accountCreatedAtMs: number): ValidationResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "state must be an object" };
  const s = raw as Partial<GameState>;

  if (s.cheatsUsed === true) {
    return { ok: false, error: "cheats are active in this game — cloud save & leaderboard are disabled for it" };
  }

  if (!isFiniteNumber(s.cash)) return { ok: false, error: "invalid cash" };
  if (s.cash < MIN_CASH) return { ok: false, error: "cash below plausible floor" };

  if (!isFiniteNumber(s.startedAt) || s.startedAt > now + CLOCK_SKEW_MS) {
    return { ok: false, error: "invalid startedAt" };
  }
  if (!isFiniteNumber(s.lastTick) || s.lastTick > now + CLOCK_SKEW_MS || s.lastTick < s.startedAt) {
    return { ok: false, error: "invalid lastTick" };
  }

  if (!Array.isArray(s.fleet)) return { ok: false, error: "invalid fleet" };
  if (s.fleet.length > MAX_FLEET_SIZE) return { ok: false, error: "fleet too large" };
  if (!Array.isArray(s.log)) return { ok: false, error: "invalid log" };
  if (s.log.length > MAX_LOG_ENTRIES) return { ok: false, error: "log too large" };

  let totalMW = 0;
  let bookValue = 0;
  const seenIds = new Set<string>();

  for (const asset of s.fleet as OwnedAsset[]) {
    if (!asset || typeof asset !== "object") return { ok: false, error: "invalid asset" };
    if (typeof asset.id !== "string" || asset.id.length === 0 || seenIds.has(asset.id)) {
      return { ok: false, error: "invalid or duplicate asset id" };
    }
    seenIds.add(asset.id);

    if (!isFiniteNumber(asset.capacityMW) || asset.capacityMW <= 0 || asset.capacityMW > MAX_ASSET_MW) {
      return { ok: false, error: "invalid asset capacity" };
    }

    const perMW = PRICE_PER_MW[asset.fuel as keyof typeof PRICE_PER_MW];
    if (perMW == null) return { ok: false, error: "invalid asset fuel" };

    const expectedPaid = asset.capacityMW * perMW;
    if (!isFiniteNumber(asset.paidAUD) || Math.abs(asset.paidAUD - expectedPaid) > Math.max(1, expectedPaid * 0.001)) {
      return { ok: false, error: "asset price does not match catalog" };
    }

    if (!asset.conditions || typeof asset.conditions !== "object") {
      return { ok: false, error: "invalid asset conditions" };
    }
    for (const v of Object.values(asset.conditions)) {
      if (!isFiniteNumber(v) || v < 0 || v > 100) return { ok: false, error: "condition out of range" };
    }

    totalMW += asset.capacityMW;
    bookValue += asset.paidAUD * 0.7;
  }

  if (totalMW > MAX_TOTAL_FLEET_MW) return { ok: false, error: "fleet capacity exceeds grid-scale bound" };

  const hoursAccountOld = Math.max(0, (now - accountCreatedAtMs) / 3_600_000);
  const revenueCeiling = MAX_TOTAL_FLEET_MW * PRICE_CAP_AUD_PER_MWH * hoursAccountOld;
  const maxCompanyValue = STARTING_CASH + revenueCeiling;
  const companyValue = s.cash + bookValue;
  if (companyValue > maxCompanyValue) {
    return { ok: false, error: "company value exceeds what this account could physically have earned" };
  }

  return { ok: true, state: s as GameState };
}
