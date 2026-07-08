// North Sea platform-repurposing screening: data types for the curated static
// datasets (platforms, wind farms, subsea fibre) and the weighted screening
// scorer. The thesis question this serves: which end-of-life platforms are
// best placed to host an AI-compute + long-duration-storage payload — scored
// on wind adjacency, fibre proximity, topside capacity, remaining life and
// pipeline reuse, with user-adjustable weights.

export type PlatformType = "fixed-steel" | "gravity-concrete" | "semi-sub" | "fpso";

export interface Platform {
  id: string;
  name: string;
  operator: string;
  field: string;
  type: PlatformType;
  lat: number;
  lng: number;
  waterDepthM: number;
  /** Topside weight, tonnes. Estimates flagged in `estimated`. */
  topsideTonnes: number;
  installedYear: number;
  /** Cessation of production — actual or forecast. */
  copYear: number;
  status: "producing" | "post-cop" | "decommissioning";
  /** Export pipeline potentially reusable (H2 comparator credit). */
  pipelineReuse: boolean;
  /** Which numeric attributes are estimates rather than sourced figures. */
  estimated: string[];
  source: string;
  note?: string;
  /** Verbatim status from the NSTA infrastructure registry, where matched. */
  nstaStatus?: string;
}

export interface WindFarm {
  id: string;
  name: string;
  lat: number;
  lng: number;
  capacityMW: number;
  status: "operational" | "commissioning" | "construction" | "consented" | "development" | "zone";
  type: "fixed" | "floating";
  note?: string;
}

export interface CableLanding {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Cable systems present at this landing. */
  cables: string[];
}

/** Great-circle distance, km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface PlatformDistances {
  nearestWind: { farm: WindFarm; km: number } | null;
  /** Wind capacity within 60 km — the "adjacent resource" pool. */
  windWithin60kmMW: number;
  nearestLanding: { landing: CableLanding; km: number } | null;
}

export function computeDistances(p: Platform, farms: WindFarm[], landings: CableLanding[]): PlatformDistances {
  let nearestWind: PlatformDistances["nearestWind"] = null;
  let windWithin60kmMW = 0;
  for (const f of farms) {
    const km = haversineKm(p.lat, p.lng, f.lat, f.lng);
    if (!nearestWind || km < nearestWind.km) nearestWind = { farm: f, km };
    if (km <= 60) windWithin60kmMW += f.capacityMW;
  }
  let nearestLanding: PlatformDistances["nearestLanding"] = null;
  for (const l of landings) {
    const km = haversineKm(p.lat, p.lng, l.lat, l.lng);
    if (!nearestLanding || km < nearestLanding.km) nearestLanding = { landing: l, km };
  }
  return { nearestWind, windWithin60kmMW, nearestLanding };
}

// --- Screening ----------------------------------------------------------------

export interface ScreenWeights {
  wind: number;
  fibre: number;
  capacity: number;
  life: number;
  pipeline: number;
}

export const DEFAULT_WEIGHTS: ScreenWeights = { wind: 30, fibre: 25, capacity: 20, life: 15, pipeline: 10 };

export interface SubScores {
  wind: number;
  fibre: number;
  capacity: number;
  life: number;
  pipeline: number;
}

export interface ScreenResult {
  platform: Platform;
  distances: PlatformDistances;
  sub: SubScores;
  /** Weighted composite, 0-100. */
  score: number;
}

/** Distance decay: 1 at 0 km, ~0.5 at `half` km, → 0 asymptotically. */
function decay(km: number, half: number): number {
  return 1 / (1 + km / half);
}

/**
 * Sub-scores are each 0-1:
 *  - wind: proximity-decayed nearest-farm distance, boosted by resource pool
 *    within 60 km (an adjacent 1.5 GW zone beats a distant 200 MW farm);
 *  - fibre: own-pipeline backhaul (fibre through the retired export line)
 *    scores >=0.75 outright; otherwise proximity decay to the nearest cable
 *    landing (a screen, not a guarantee of dark fibre);
 *  - capacity: topside tonnage headroom for compute/battery decks (log scale,
 *    ~40 kt saturates);
 *  - life: younger structures score higher (installedYear vs a 25-90yr band);
 *  - pipeline: binary reuse credit (fibre corridor + H2 comparator).
 */
export function screenPlatform(p: Platform, d: PlatformDistances, w: ScreenWeights): ScreenResult {
  const windProx = d.nearestWind ? decay(d.nearestWind.km, 40) : 0;
  const windPool = Math.min(d.windWithin60kmMW / 3000, 1);
  const wind = 0.6 * windProx + 0.4 * windPool;
  // v2 concept: a surviving export pipeline is its own fibre corridor
  // (flooded lines can carry pulled/floated fibre to shore), so pipeline
  // reuse guarantees a strong connectivity score; third-party landing
  // proximity can only improve on it.
  const landingProx = d.nearestLanding ? decay(d.nearestLanding.km, 80) : 0;
  const fibre = p.pipelineReuse ? Math.max(0.75, landingProx) : landingProx;
  const capacity = Math.min(Math.log10(Math.max(p.topsideTonnes, 100)) / Math.log10(40_000), 1);
  const age = new Date().getUTCFullYear() - p.installedYear;
  const life = Math.min(Math.max((90 - age) / 65, 0), 1);
  const pipeline = p.pipelineReuse ? 1 : 0;

  const sub: SubScores = { wind, fibre, capacity, life, pipeline };
  const total = w.wind + w.fibre + w.capacity + w.life + w.pipeline || 1;
  const score =
    ((w.wind * wind + w.fibre * fibre + w.capacity * capacity + w.life * life + w.pipeline * pipeline) / total) * 100;
  return { platform: p, distances: d, sub, score };
}

export function screenFleet(
  platforms: Platform[],
  farms: WindFarm[],
  landings: CableLanding[],
  weights: ScreenWeights,
): ScreenResult[] {
  return platforms
    .map((p) => screenPlatform(p, computeDistances(p, farms, landings), weights))
    .sort((a, b) => b.score - a.score);
}
