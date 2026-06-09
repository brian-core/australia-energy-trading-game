// Pricing reference data + helpers.
//
// Wholesale (merchant) spot prices are live from AEMO/OpenElectricity.
// Retail prices have no live feed — they're annual regulated/benchmark
// offers, so we carry a static reference table per region: the Default
// Market Offer (NSW, SE QLD, SA), Victorian Default Offer, and regulated
// standing tariffs elsewhere. Values are representative residential
// single-rate usage charges in c/kWh incl GST for FY2025-26.

export interface RetailRef {
  /** Range of usage rates across the region's distribution networks, c/kWh. */
  minCkwh: number;
  maxCkwh: number;
  /** Distribution networks / offers the range covers. */
  networks: string[];
  scheme: string;
}

export const RETAIL_REF: Record<string, RetailRef> = {
  NSW1: {
    minCkwh: 33,
    maxCkwh: 38,
    networks: ["Ausgrid", "Endeavour", "Essential"],
    scheme: "DMO",
  },
  QLD1: {
    minCkwh: 33,
    maxCkwh: 34,
    networks: ["Energex (SEQ)", "Ergon (regional)"],
    scheme: "DMO / regulated",
  },
  VIC1: {
    minCkwh: 28,
    maxCkwh: 33,
    networks: ["CitiPower", "Powercor", "Jemena", "United", "AusNet"],
    scheme: "VDO",
  },
  SA1: {
    minCkwh: 38,
    maxCkwh: 40,
    networks: ["SA Power Networks"],
    scheme: "DMO",
  },
  TAS1: {
    minCkwh: 30,
    maxCkwh: 31,
    networks: ["TasNetworks (Aurora)"],
    scheme: "regulated",
  },
  WEM: {
    minCkwh: 31,
    maxCkwh: 33,
    networks: ["Western Power (Synergy A1)"],
    scheme: "regulated",
  },
};

/** AEMO-style price bands for colouring the map in price view. */
export const PRICE_BANDS = [
  { max: 0, color: "#9b6bd3", label: "negative" },
  { max: 50, color: "#48a87c", label: "< $50" },
  { max: 150, color: "#f2c14e", label: "$50–150" },
  { max: 300, color: "#e2792e", label: "$150–300" },
  { max: Infinity, color: "#e2483d", label: "> $300" },
] as const;

export function priceColor(priceAUD: number | null): string {
  if (priceAUD == null) return "#8a8f98";
  for (const band of PRICE_BANDS) {
    if (priceAUD < band.max) return band.color;
  }
  return PRICE_BANDS[PRICE_BANDS.length - 1].color;
}

/** Spot $/MWh expressed as c/kWh for comparison with retail rates. */
export function spotAsCkwh(priceAUD: number): number {
  return priceAUD / 10;
}

export function fmtRetail(ref: RetailRef): string {
  return ref.minCkwh === ref.maxCkwh
    ? `${ref.minCkwh}c`
    : `${ref.minCkwh}–${ref.maxCkwh}c`;
}
