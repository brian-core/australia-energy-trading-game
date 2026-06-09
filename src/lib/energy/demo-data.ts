import { FUEL_META } from "./regions";
import type { Facility, FuelGroup, FuelSlice } from "./types";

// Fallback snapshot used when the live feeds are unreachable (offline dev,
// blocked egress, upstream outage). Numbers approximate a typical early
// evening on the NEM/SWIS so the visualisation stays meaningful.

function mix(parts: Partial<Record<FuelGroup, number>>): FuelSlice[] {
  return (Object.entries(parts) as [FuelGroup, number][])
    .filter(([, mw]) => mw > 0)
    .sort((a, b) => FUEL_META[a[0]].order - FUEL_META[b[0]].order)
    .map(([tech, mw]) => ({ tech, label: FUEL_META[tech].label, mw, color: FUEL_META[tech].color }));
}

export const DEMO_REGION_DATA: Record<
  string,
  { demandMW: number; netInterchangeMW: number; priceAUD: number | null; fuelMix: FuelSlice[] }
> = {
  QLD1: {
    demandMW: 6900,
    netInterchangeMW: 480,
    priceAUD: 112.4,
    fuelMix: mix({ coal: 4900, gas: 980, hydro: 360, wind: 420, solar: 520, battery: 160, bioenergy: 60 }),
  },
  NSW1: {
    demandMW: 8300,
    netInterchangeMW: -1150,
    priceAUD: 128.9,
    fuelMix: mix({ coal: 4700, gas: 520, hydro: 900, wind: 640, solar: 310, battery: 140, bioenergy: 40 }),
  },
  VIC1: {
    demandMW: 5600,
    netInterchangeMW: 720,
    priceAUD: 96.2,
    fuelMix: mix({ coal: 3700, gas: 260, hydro: 540, wind: 1500, solar: 180, battery: 120 }),
  },
  SA1: {
    demandMW: 1650,
    netInterchangeMW: -210,
    priceAUD: 87.5,
    fuelMix: mix({ gas: 420, wind: 820, solar: 110, battery: 90, distillate: 10 }),
  },
  TAS1: {
    demandMW: 1120,
    netInterchangeMW: 60,
    priceAUD: 74.1,
    fuelMix: mix({ hydro: 1010, wind: 160, gas: 10 }),
  },
  WEM: {
    demandMW: 2950,
    netInterchangeMW: 0,
    priceAUD: null,
    fuelMix: mix({ coal: 980, gas: 1180, wind: 480, solar: 220, battery: 70, bioenergy: 20 }),
  },
};

// Major operating facilities (approximate coordinates, registered MW).
// Used when the OpenElectricity facility feed is unavailable.
export const DEMO_FACILITIES: Facility[] = [
  // Queensland
  { name: "Gladstone", lat: -23.85, lng: 151.22, fuel: "coal", capacityMW: 1680, region: "QLD1" },
  { name: "Stanwell", lat: -23.51, lng: 150.32, fuel: "coal", capacityMW: 1460, region: "QLD1" },
  { name: "Tarong + Tarong North", lat: -26.78, lng: 151.91, fuel: "coal", capacityMW: 1843, region: "QLD1" },
  { name: "Callide B & C", lat: -24.34, lng: 150.61, fuel: "coal", capacityMW: 1540, region: "QLD1" },
  { name: "Kogan Creek", lat: -26.94, lng: 150.74, fuel: "coal", capacityMW: 744, region: "QLD1" },
  { name: "Millmerran", lat: -27.96, lng: 151.27, fuel: "coal", capacityMW: 852, region: "QLD1" },
  { name: "Darling Downs", lat: -27.18, lng: 151.04, fuel: "gas", capacityMW: 644, region: "QLD1" },
  { name: "Braemar 1 & 2", lat: -27.13, lng: 150.84, fuel: "gas", capacityMW: 1008, region: "QLD1" },
  { name: "Wivenhoe (pumped hydro)", lat: -27.39, lng: 152.61, fuel: "hydro", capacityMW: 570, region: "QLD1" },
  { name: "Coopers Gap Wind Farm", lat: -26.74, lng: 151.42, fuel: "wind", capacityMW: 453, region: "QLD1" },
  { name: "MacIntyre Wind Farm", lat: -28.45, lng: 151.42, fuel: "wind", capacityMW: 923, region: "QLD1" },
  { name: "Western Downs Solar", lat: -26.72, lng: 150.53, fuel: "solar", capacityMW: 400, region: "QLD1" },
  { name: "Daydream Solar Farm", lat: -20.62, lng: 147.92, fuel: "solar", capacityMW: 168, region: "QLD1" },
  { name: "Chinchilla Battery", lat: -26.75, lng: 150.62, fuel: "battery", capacityMW: 100, region: "QLD1" },

  // New South Wales
  { name: "Eraring", lat: -33.06, lng: 151.52, fuel: "coal", capacityMW: 2880, region: "NSW1" },
  { name: "Bayswater", lat: -32.39, lng: 150.95, fuel: "coal", capacityMW: 2640, region: "NSW1" },
  { name: "Mount Piper", lat: -33.4, lng: 150.07, fuel: "coal", capacityMW: 1400, region: "NSW1" },
  { name: "Vales Point B", lat: -33.16, lng: 151.53, fuel: "coal", capacityMW: 1320, region: "NSW1" },
  { name: "Tallawarra", lat: -34.53, lng: 150.83, fuel: "gas", capacityMW: 752, region: "NSW1" },
  { name: "Colongra", lat: -33.21, lng: 151.54, fuel: "gas", capacityMW: 667, region: "NSW1" },
  { name: "Tumut 3 (Snowy)", lat: -35.6, lng: 148.45, fuel: "hydro", capacityMW: 1800, region: "NSW1" },
  { name: "Murray 1 & 2 (Snowy)", lat: -36.21, lng: 148.13, fuel: "hydro", capacityMW: 1500, region: "NSW1" },
  { name: "Shoalhaven (pumped hydro)", lat: -34.77, lng: 150.5, fuel: "hydro", capacityMW: 240, region: "NSW1" },
  { name: "New England Solar", lat: -30.65, lng: 151.6, fuel: "solar", capacityMW: 720, region: "NSW1" },
  { name: "Sapphire Wind Farm", lat: -29.62, lng: 151.27, fuel: "wind", capacityMW: 270, region: "NSW1" },
  { name: "Rye Park Wind Farm", lat: -34.46, lng: 148.92, fuel: "wind", capacityMW: 396, region: "NSW1" },
  { name: "Waratah Super Battery", lat: -33.18, lng: 151.49, fuel: "battery", capacityMW: 850, region: "NSW1" },

  // Victoria
  { name: "Loy Yang A", lat: -38.25, lng: 146.58, fuel: "coal", capacityMW: 2210, region: "VIC1" },
  { name: "Loy Yang B", lat: -38.27, lng: 146.6, fuel: "coal", capacityMW: 1070, region: "VIC1" },
  { name: "Yallourn W", lat: -38.18, lng: 146.36, fuel: "coal", capacityMW: 1480, region: "VIC1" },
  { name: "Newport", lat: -37.85, lng: 144.89, fuel: "gas", capacityMW: 500, region: "VIC1" },
  { name: "Mortlake", lat: -38.09, lng: 142.86, fuel: "gas", capacityMW: 566, region: "VIC1" },
  { name: "Dartmouth", lat: -36.54, lng: 147.51, fuel: "hydro", capacityMW: 185, region: "VIC1" },
  { name: "Macarthur Wind Farm", lat: -38.05, lng: 142.18, fuel: "wind", capacityMW: 420, region: "VIC1" },
  { name: "Stockyard Hill Wind Farm", lat: -37.62, lng: 143.43, fuel: "wind", capacityMW: 530, region: "VIC1" },
  { name: "Golden Plains Wind Farm", lat: -37.95, lng: 144.05, fuel: "wind", capacityMW: 756, region: "VIC1" },
  { name: "Victorian Big Battery", lat: -37.83, lng: 144.55, fuel: "battery", capacityMW: 300, region: "VIC1" },

  // South Australia
  { name: "Torrens Island B", lat: -34.8, lng: 138.53, fuel: "gas", capacityMW: 800, region: "SA1" },
  { name: "Pelican Point", lat: -34.77, lng: 138.5, fuel: "gas", capacityMW: 479, region: "SA1" },
  { name: "Osborne", lat: -34.79, lng: 138.5, fuel: "gas", capacityMW: 180, region: "SA1" },
  { name: "Hornsdale Wind Farm", lat: -33.08, lng: 138.52, fuel: "wind", capacityMW: 315, region: "SA1" },
  { name: "Lake Bonney Wind Farm", lat: -37.73, lng: 140.4, fuel: "wind", capacityMW: 278, region: "SA1" },
  { name: "Hornsdale Power Reserve", lat: -33.09, lng: 138.51, fuel: "battery", capacityMW: 150, region: "SA1" },
  { name: "Torrens Island Battery", lat: -34.8, lng: 138.54, fuel: "battery", capacityMW: 250, region: "SA1" },
  { name: "Bungala Solar Farm", lat: -32.43, lng: 137.85, fuel: "solar", capacityMW: 220, region: "SA1" },

  // Tasmania
  { name: "Gordon", lat: -42.73, lng: 145.97, fuel: "hydro", capacityMW: 432, region: "TAS1" },
  { name: "Poatina", lat: -41.79, lng: 146.92, fuel: "hydro", capacityMW: 360, region: "TAS1" },
  { name: "Reece", lat: -41.74, lng: 145.13, fuel: "hydro", capacityMW: 231, region: "TAS1" },
  { name: "Tarraleah", lat: -42.3, lng: 146.45, fuel: "hydro", capacityMW: 104, region: "TAS1" },
  { name: "Woolnorth / Bluff Point Wind", lat: -40.69, lng: 144.72, fuel: "wind", capacityMW: 140, region: "TAS1" },
  { name: "Cattle Hill Wind Farm", lat: -42.13, lng: 146.97, fuel: "wind", capacityMW: 144, region: "TAS1" },

  // Western Australia (SWIS)
  { name: "Muja C & D", lat: -33.45, lng: 116.31, fuel: "coal", capacityMW: 854, region: "WEM" },
  { name: "Collie", lat: -33.35, lng: 116.27, fuel: "coal", capacityMW: 300, region: "WEM" },
  { name: "Bluewaters", lat: -33.32, lng: 116.27, fuel: "coal", capacityMW: 434, region: "WEM" },
  { name: "Cockburn", lat: -32.19, lng: 115.77, fuel: "gas", capacityMW: 240, region: "WEM" },
  { name: "Kwinana (gas + battery)", lat: -32.2, lng: 115.77, fuel: "gas", capacityMW: 470, region: "WEM" },
  { name: "NewGen Kwinana", lat: -32.21, lng: 115.78, fuel: "gas", capacityMW: 327, region: "WEM" },
  { name: "Collgar Wind Farm", lat: -31.62, lng: 118.35, fuel: "wind", capacityMW: 206, region: "WEM" },
  { name: "Yandin Wind Farm", lat: -30.86, lng: 115.62, fuel: "wind", capacityMW: 214, region: "WEM" },
  { name: "Warradarge Wind Farm", lat: -30.05, lng: 115.32, fuel: "wind", capacityMW: 180, region: "WEM" },
  { name: "Greenough River Solar", lat: -28.95, lng: 114.95, fuel: "solar", capacityMW: 40, region: "WEM" },
  { name: "Kwinana Big Battery", lat: -32.2, lng: 115.76, fuel: "battery", capacityMW: 200, region: "WEM" },
];
