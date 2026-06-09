// Shared types for the Australia live energy map.

/** Grouped fuel technology buckets used across the map + HUD. */
export type FuelGroup =
  | "coal"
  | "gas"
  | "hydro"
  | "wind"
  | "solar"
  | "battery"
  | "bioenergy"
  | "distillate";

export interface FuelSlice {
  tech: FuelGroup;
  label: string;
  mw: number;
  color: string;
}

export interface RegionLive {
  /** AEMO/OpenNEM region code, e.g. NSW1, QLD1, WEM */
  code: string;
  name: string;
  network: "NEM" | "WEM";
  lat: number;
  lng: number;
  /** Operational demand (load) in MW. */
  demandMW: number;
  /** Total local generation in MW (sum of fuel mix). */
  generationMW: number;
  /** Net interchange in MW, positive = exporting to other regions. */
  netInterchangeMW: number;
  /** Spot price in AUD/MWh, null when unavailable (e.g. WEM). */
  priceAUD: number | null;
  fuelMix: FuelSlice[];
  /** Share of generation from wind/solar/hydro/bioenergy/battery, 0-1. */
  renewableShare: number;
  /** ISO timestamp of the underlying dispatch interval. */
  asOf: string | null;
}

export interface InterconnectorFlow {
  id: string;
  label: string;
  /** Region codes; flow is normalised so mw >= 0 flows from -> to. */
  from: string;
  to: string;
  mw: number;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

export interface LivePayload {
  updatedAt: string;
  /** True when real feeds were unreachable and the demo snapshot is shown. */
  demo: boolean;
  sources: {
    aemo: "ok" | "error";
    openelectricity: "ok" | "partial" | "error";
  };
  regions: RegionLive[];
  flows: InterconnectorFlow[];
  national: {
    demandMW: number;
    generationMW: number;
    renewableShare: number;
    fuelMix: FuelSlice[];
  };
}

export interface Facility {
  name: string;
  lat: number;
  lng: number;
  fuel: FuelGroup;
  /** Registered capacity in MW. */
  capacityMW: number;
  region: string;
}

export interface FacilitiesPayload {
  demo: boolean;
  count: number;
  facilities: Facility[];
}
