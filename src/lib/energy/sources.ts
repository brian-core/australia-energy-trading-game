import { BORDERS, FUEL_META, REGIONS, groupFuelTech } from "./regions";
import { DEMO_FACILITIES, DEMO_REGION_DATA } from "./demo-data";
import type {
  Facility,
  FuelGroup,
  FuelSlice,
  InterconnectorFlow,
  LivePayload,
  RegionLive,
} from "./types";

// Server-side fetchers for the live energy feeds.
//
// Sources (both public, no auth):
//  - AEMO NEM data dashboard: 5-minute demand / net interchange / spot price
//    per dispatch region.
//  - OpenElectricity (formerly OpenNEM): 5-minute generation by fuel tech per
//    region, plus the national facility register with coordinates.
//
// Every fetcher degrades independently; if all feeds fail the demo snapshot
// is served so the map never renders empty.

const AEMO_SUMMARY_URL =
  "https://visualisations.aemo.com.au/aemo/apps/api/report/ELEC_NEM_SUMMARY";

// OpenElectricity is the current home of the OpenNEM datasets; the legacy
// domain still mirrors them. Try in order.
const OE_DATA_HOSTS = ["https://data.openelectricity.org.au", "https://data.opennem.org.au"];

const FETCH_HEADERS = { Accept: "application/json" };

async function fetchJson(url: string, revalidate: number): Promise<unknown> {
  const res = await fetch(url, { headers: FETCH_HEADERS, next: { revalidate } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchJsonWithHostFallback(path: string, revalidate: number): Promise<unknown> {
  let lastError: unknown;
  for (const host of OE_DATA_HOSTS) {
    try {
      return await fetchJson(`${host}${path}`, revalidate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// AEMO summary (NEM regions only)

interface AemoRegionRow {
  demandMW: number;
  netInterchangeMW: number;
  priceAUD: number | null;
  asOf: string | null;
}

async function fetchAemoSummary(): Promise<Map<string, AemoRegionRow>> {
  const json = (await fetchJson(AEMO_SUMMARY_URL, 55)) as {
    ELEC_NEM_SUMMARY?: Array<Record<string, unknown>>;
  };
  const rows = json.ELEC_NEM_SUMMARY;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("AEMO summary empty");

  const out = new Map<string, AemoRegionRow>();
  for (const row of rows) {
    const code = String(row.REGIONID ?? "");
    if (!code) continue;
    out.set(code, {
      demandMW: Number(row.TOTALDEMAND ?? 0),
      // AEMO convention: positive NETINTERCHANGE = net export from the region.
      netInterchangeMW: Number(row.NETINTERCHANGE ?? 0),
      priceAUD: row.PRICE != null ? Number(row.PRICE) : null,
      asOf: row.SETTLEMENTDATE ? String(row.SETTLEMENTDATE) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// OpenElectricity per-region power (generation by fuel tech)

interface OePowerSeries {
  id?: string;
  type?: string;
  fuel_tech?: string;
  units?: string;
  history?: { last?: string; data?: Array<number | null> };
}

function lastValue(series: OePowerSeries): number | null {
  const data = series.history?.data;
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0 && i >= data.length - 6; i--) {
    const v = data[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

interface RegionPower {
  fuelMix: FuelSlice[];
  generationMW: number;
  demandMW: number | null;
  asOf: string | null;
}

async function fetchRegionPower(network: "NEM" | "WEM", region?: string): Promise<RegionPower> {
  const path = region
    ? `/v3/stats/au/${network}/${region}/power/7d.json`
    : `/v3/stats/au/${network}/power/7d.json`;
  const json = (await fetchJsonWithHostFallback(path, 55)) as { data?: OePowerSeries[] };
  if (!Array.isArray(json.data)) throw new Error(`unexpected power payload for ${path}`);

  const byGroup = new Map<FuelGroup, number>();
  let demandMW: number | null = null;
  let asOf: string | null = null;

  for (const series of json.data) {
    if (series.history?.last && (!asOf || series.history.last > asOf)) {
      asOf = series.history.last;
    }
    if (series.type === "demand" || series.id?.endsWith(".demand")) {
      const v = lastValue(series);
      if (v != null) demandMW = v;
      continue;
    }
    if (series.type !== "power" || !series.fuel_tech) continue;
    const group = groupFuelTech(series.fuel_tech);
    if (!group) continue;
    const v = lastValue(series);
    if (v == null || v <= 0) continue;
    byGroup.set(group, (byGroup.get(group) ?? 0) + v);
  }

  const fuelMix = [...byGroup.entries()]
    .sort((a, b) => FUEL_META[a[0]].order - FUEL_META[b[0]].order)
    .map(([tech, mw]) => ({
      tech,
      label: FUEL_META[tech].label,
      mw: Math.round(mw),
      color: FUEL_META[tech].color,
    }));
  const generationMW = fuelMix.reduce((sum, s) => sum + s.mw, 0);
  if (fuelMix.length === 0) throw new Error(`no generation series for ${path}`);
  return { fuelMix, generationMW, demandMW, asOf };
}

// ---------------------------------------------------------------------------
// Assembly

function renewableShare(fuelMix: FuelSlice[]): number {
  const total = fuelMix.reduce((sum, s) => sum + s.mw, 0);
  if (total <= 0) return 0;
  const green = fuelMix
    .filter((s) => FUEL_META[s.tech].renewable)
    .reduce((sum, s) => sum + s.mw, 0);
  return green / total;
}

function demoRegion(code: string): Omit<RegionLive, "code" | "name" | "network" | "lat" | "lng"> {
  const d = DEMO_REGION_DATA[code];
  return {
    demandMW: d.demandMW,
    generationMW: d.fuelMix.reduce((sum, s) => sum + s.mw, 0),
    netInterchangeMW: d.netInterchangeMW,
    priceAUD: d.priceAUD,
    fuelMix: d.fuelMix,
    renewableShare: renewableShare(d.fuelMix),
    asOf: null,
  };
}

/**
 * Solve aggregate border flows from regional net interchange. The NEM region
 * graph is a tree, so QLD/SA/TAS borders equal that region's net interchange
 * and VIC-NSW is VIC's remainder.
 */
function solveFlows(regions: Map<string, RegionLive>): InterconnectorFlow[] {
  const net = (code: string) => regions.get(code)?.netInterchangeMW ?? 0;
  const solved: Record<string, number> = {
    // positive value = flow from border.a to border.b (see BORDERS)
    "QLD-NSW": net("QLD1"),
    "VIC-TAS": -net("TAS1"),
    "VIC-SA": -net("SA1"),
  };
  solved["VIC-NSW"] = net("VIC1") - solved["VIC-TAS"] - solved["VIC-SA"];

  return BORDERS.map((border) => {
    const raw = solved[border.id] ?? 0;
    const forward = raw >= 0;
    return {
      id: border.id,
      label: border.label,
      from: forward ? border.a : border.b,
      to: forward ? border.b : border.a,
      mw: Math.round(Math.abs(raw)),
      fromLat: forward ? border.aLat : border.bLat,
      fromLng: forward ? border.aLng : border.bLng,
      toLat: forward ? border.bLat : border.aLat,
      toLng: forward ? border.bLng : border.aLng,
    };
  });
}

export async function buildLivePayload(): Promise<LivePayload> {
  const [aemo, powers] = await Promise.all([
    fetchAemoSummary().catch(() => null),
    Promise.all(
      REGIONS.map((r) =>
        (r.network === "WEM" ? fetchRegionPower("WEM") : fetchRegionPower("NEM", r.code)).catch(
          () => null,
        ),
      ),
    ),
  ]);

  const powerOk = powers.filter((p) => p !== null).length;
  const demo = !aemo && powerOk === 0;

  const regionMap = new Map<string, RegionLive>();
  REGIONS.forEach((meta, i) => {
    const power = powers[i];
    const aemoRow = aemo?.get(meta.code) ?? null;
    const fallback = demoRegion(meta.code);

    const fuelMix = power?.fuelMix ?? fallback.fuelMix;
    const generationMW = power?.generationMW ?? fallback.generationMW;
    // WEM is islanded: demand ≈ local generation when no demand series exists.
    const demandMW =
      aemoRow?.demandMW ??
      power?.demandMW ??
      (power && meta.network === "WEM" ? power.generationMW : fallback.demandMW);

    regionMap.set(meta.code, {
      code: meta.code,
      name: meta.name,
      network: meta.network,
      lat: meta.lat,
      lng: meta.lng,
      demandMW: Math.round(demandMW),
      generationMW: Math.round(generationMW),
      netInterchangeMW: Math.round(aemoRow?.netInterchangeMW ?? fallback.netInterchangeMW),
      priceAUD: aemoRow?.priceAUD ?? (aemo ? null : fallback.priceAUD),
      fuelMix,
      renewableShare: renewableShare(fuelMix),
      asOf: power?.asOf ?? aemoRow?.asOf ?? null,
    });
  });

  const regions = [...regionMap.values()];
  const nationalMix = new Map<FuelGroup, number>();
  for (const region of regions) {
    for (const slice of region.fuelMix) {
      nationalMix.set(slice.tech, (nationalMix.get(slice.tech) ?? 0) + slice.mw);
    }
  }
  const fuelMix = [...nationalMix.entries()]
    .sort((a, b) => FUEL_META[a[0]].order - FUEL_META[b[0]].order)
    .map(([tech, mw]) => ({
      tech,
      label: FUEL_META[tech].label,
      mw: Math.round(mw),
      color: FUEL_META[tech].color,
    }));

  return {
    updatedAt: new Date().toISOString(),
    demo,
    sources: {
      aemo: aemo ? "ok" : "error",
      openelectricity:
        powerOk === REGIONS.length ? "ok" : powerOk > 0 ? "partial" : "error",
    },
    regions,
    flows: solveFlows(regionMap),
    national: {
      demandMW: regions.reduce((sum, r) => sum + r.demandMW, 0),
      generationMW: regions.reduce((sum, r) => sum + r.generationMW, 0),
      renewableShare: renewableShare(fuelMix),
      fuelMix,
    },
  };
}

// ---------------------------------------------------------------------------
// Facilities (power station register with coordinates)

interface GeoFeature {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

function parseFacilityFeature(feature: GeoFeature): Facility | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const props = feature.properties ?? {};

  const name = typeof props.name === "string" ? props.name : null;
  if (!name) return null;

  // The register nests unit data in slightly different shapes across versions;
  // probe the common ones.
  let capacityMW = 0;
  let fuelRaw: string | null = null;
  if (typeof props.capacity_registered === "number") capacityMW = props.capacity_registered;
  if (Array.isArray(props.fueltechs) && typeof props.fueltechs[0] === "string") {
    fuelRaw = props.fueltechs[0];
  }
  const duidData = props.duid_data;
  if (duidData && typeof duidData === "object") {
    for (const unit of Object.values(duidData as Record<string, Record<string, unknown>>)) {
      if (!capacityMW && typeof unit.capacity_registered === "number") {
        capacityMW += unit.capacity_registered;
      }
      if (!fuelRaw && typeof unit.fuel_tech === "string") fuelRaw = unit.fuel_tech;
    }
  }
  if (!fuelRaw || capacityMW < 15) return null;
  const fuel = groupFuelTech(fuelRaw);
  if (!fuel) return null;

  const status = props.status;
  const statusLabel =
    typeof status === "string"
      ? status
      : status && typeof status === "object"
        ? String((status as Record<string, unknown>).code ?? (status as Record<string, unknown>).label ?? "")
        : "";
  if (statusLabel && !/operating/i.test(statusLabel)) return null;

  return {
    name,
    lng: coords[0],
    lat: coords[1],
    fuel,
    capacityMW: Math.round(capacityMW),
    region: typeof props.network_region === "string" ? props.network_region : "",
  };
}

export async function fetchFacilities(): Promise<{ demo: boolean; facilities: Facility[] }> {
  try {
    const json = (await fetchJsonWithHostFallback("/v3/geo/au_facilities.json", 86400)) as {
      features?: GeoFeature[];
    };
    if (!Array.isArray(json.features)) throw new Error("unexpected facilities payload");
    const facilities = json.features
      .map(parseFacilityFeature)
      .filter((f): f is Facility => f !== null);
    if (facilities.length < 20) throw new Error("facilities feed too sparse");
    return { demo: false, facilities };
  } catch {
    return { demo: true, facilities: DEMO_FACILITIES };
  }
}
