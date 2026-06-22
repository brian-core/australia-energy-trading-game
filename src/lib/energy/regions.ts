import type { FuelGroup } from "./types";

// Static geography + market metadata for Australia's electricity grids.
//
// The NEM (east coast) is split into five AEMO dispatch regions; Western
// Australia's SWIS runs as the separate WEM market. The NT (DKIS) and
// regional WA grids publish no public real-time feed, so they are not shown.

export interface RegionMeta {
  code: string;
  name: string;
  short: string;
  network: "NEM" | "WEM";
  /** Visual anchor for the region's columns/labels (load centre-ish). */
  lat: number;
  lng: number;
}

export const REGIONS: RegionMeta[] = [
  { code: "QLD1", name: "Queensland", short: "QLD", network: "NEM", lat: -22.5, lng: 146.5 },
  { code: "NSW1", name: "New South Wales", short: "NSW", network: "NEM", lat: -32.5, lng: 147.0 },
  { code: "VIC1", name: "Victoria", short: "VIC", network: "NEM", lat: -37.0, lng: 144.0 },
  { code: "SA1", name: "South Australia", short: "SA", network: "NEM", lat: -31.0, lng: 136.0 },
  { code: "TAS1", name: "Tasmania", short: "TAS", network: "NEM", lat: -42.0, lng: 146.5 },
  { code: "WEM", name: "Western Australia (SWIS)", short: "WA", network: "WEM", lat: -30.5, lng: 117.5 },
];

export const REGION_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));

// Physical interconnector borders between NEM regions. Because the NEM's
// region graph is a tree (TAS-VIC-SA / VIC-NSW-QLD), each border's aggregate
// flow is fully determined by regional net interchange:
//   TAS and SA and QLD each touch exactly one neighbour, so their net
//   interchange IS the border flow; NSW<->VIC is VIC's remainder.
export interface BorderMeta {
  id: string;
  label: string;
  /** Convention: positive solved flow goes from `a` to `b`. */
  a: string;
  b: string;
  /** Arc endpoints near the actual crossing for nicer geometry. */
  aLat: number;
  aLng: number;
  bLat: number;
  bLng: number;
}

export const BORDERS: BorderMeta[] = [
  { id: "QLD-NSW", label: "QNI + Terranora", a: "QLD1", b: "NSW1", aLat: -26.5, aLng: 149.8, bLat: -30.5, bLng: 149.0 },
  { id: "VIC-NSW", label: "VIC–NSW", a: "VIC1", b: "NSW1", aLat: -36.6, aLng: 145.8, bLat: -34.8, bLng: 146.8 },
  { id: "VIC-SA", label: "Heywood + Murraylink", a: "VIC1", b: "SA1", aLat: -37.5, aLng: 142.5, bLat: -35.2, bLng: 138.8 },
  { id: "VIC-TAS", label: "Basslink", a: "VIC1", b: "TAS1", aLat: -38.6, aLng: 146.4, bLat: -41.1, bLng: 146.8 },
];

export interface FuelMeta {
  label: string;
  color: string;
  renewable: boolean;
  /** Sort order in stacked bars/legend. */
  order: number;
}

export const FUEL_META: Record<FuelGroup, FuelMeta> = {
  coal: { label: "Coal", color: "#4a4a52", renewable: false, order: 0 },
  gas: { label: "Gas", color: "#e2792e", renewable: false, order: 1 },
  distillate: { label: "Distillate", color: "#8a6d3b", renewable: false, order: 2 },
  hydro: { label: "Hydro", color: "#3f8fd2", renewable: true, order: 3 },
  wind: { label: "Wind", color: "#48a87c", renewable: true, order: 4 },
  solar: { label: "Solar (utility)", color: "#f2c14e", renewable: true, order: 5 },
  rooftop: { label: "Solar (rooftop)", color: "#f7e08a", renewable: true, order: 6 },
  battery: { label: "Battery", color: "#9b6bd3", renewable: true, order: 7 },
  bioenergy: { label: "Bioenergy", color: "#6e7535", renewable: true, order: 8 },
};

/**
 * Map an OpenElectricity fuel_tech id to a display group.
 * Returns null for series that are loads, flows, or already counted elsewhere
 * (battery charging, pumped-hydro pumping, imports/exports, and the aggregate
 * net `battery` series — we count the gross `battery_discharging` instead so
 * charging and discharging are not double-counted).
 */
export function groupFuelTech(fueltech: string): FuelGroup | null {
  const ft = fueltech.toLowerCase();
  if (ft.startsWith("coal")) return "coal";
  if (ft.startsWith("gas")) return "gas";
  if (ft === "distillate" || ft === "liquid_fuel") return "distillate";
  if (ft === "hydro") return "hydro";
  if (ft === "wind" || ft === "wind_offshore") return "wind";
  // Behind-the-meter rooftop is tracked separately from utility-scale solar so
  // operational generation reconciles with operational (rooftop-net) demand.
  if (ft === "solar_rooftop") return "rooftop";
  if (ft.startsWith("solar")) return "solar";
  if (ft === "battery_discharging") return "battery";
  if (ft.startsWith("bioenergy")) return "bioenergy";
  // battery (net aggregate), battery_charging, pumps, imports, exports,
  // interconnector → not gross generation.
  return null;
}
