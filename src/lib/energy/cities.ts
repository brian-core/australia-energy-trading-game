import type { Facility } from "./types";

// Major cities / load centres for the delivery-flow layer.

export interface City {
  name: string;
  lat: number;
  lng: number;
  region: string;
  /** Approximate metro population, used for marker/label sizing. */
  pop: number;
}

export const CITIES: City[] = [
  { name: "Sydney", lat: -33.87, lng: 151.21, region: "NSW1", pop: 5_450_000 },
  { name: "Melbourne", lat: -37.81, lng: 144.96, region: "VIC1", pop: 5_300_000 },
  { name: "Brisbane", lat: -27.47, lng: 153.03, region: "QLD1", pop: 2_700_000 },
  { name: "Perth", lat: -31.95, lng: 115.86, region: "WEM", pop: 2_300_000 },
  { name: "Adelaide", lat: -34.93, lng: 138.6, region: "SA1", pop: 1_450_000 },
  { name: "Gold Coast", lat: -28.0, lng: 153.43, region: "QLD1", pop: 720_000 },
  { name: "Newcastle", lat: -32.93, lng: 151.78, region: "NSW1", pop: 510_000 },
  { name: "Canberra", lat: -35.28, lng: 149.13, region: "NSW1", pop: 470_000 },
  { name: "Wollongong", lat: -34.42, lng: 150.89, region: "NSW1", pop: 310_000 },
  { name: "Geelong", lat: -38.15, lng: 144.36, region: "VIC1", pop: 290_000 },
  { name: "Hobart", lat: -42.88, lng: 147.33, region: "TAS1", pop: 255_000 },
  { name: "Townsville", lat: -19.26, lng: 146.82, region: "QLD1", pop: 200_000 },
  { name: "Cairns", lat: -16.92, lng: 145.77, region: "QLD1", pop: 160_000 },
  { name: "Toowoomba", lat: -27.56, lng: 151.95, region: "QLD1", pop: 150_000 },
  { name: "Ballarat", lat: -37.56, lng: 143.85, region: "VIC1", pop: 115_000 },
  { name: "Bendigo", lat: -36.76, lng: 144.28, region: "VIC1", pop: 105_000 },
  { name: "Launceston", lat: -41.44, lng: 147.14, region: "TAS1", pop: 90_000 },
  { name: "Bunbury", lat: -33.33, lng: 115.64, region: "WEM", pop: 80_000 },
];

export interface DeliveryArc {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  color: string;
  city: string;
  source: string;
  mw: number;
}

function dist2(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return (aLat - bLat) ** 2 + (aLng - bLng) ** 2;
}

/**
 * Stylised "energy flowing to the cities" arcs: each city draws from its
 * nearest few generators in the same market region.
 */
export function buildDeliveryArcs(
  facilities: Facility[],
  fuelColor: (fuel: Facility["fuel"]) => string,
): DeliveryArc[] {
  const arcs: DeliveryArc[] = [];
  for (const city of CITIES) {
    const sources = facilities
      .filter((f) => f.region === city.region)
      .sort(
        (a, b) => dist2(a.lat, a.lng, city.lat, city.lng) - dist2(b.lat, b.lng, city.lat, city.lng),
      )
      .slice(0, Math.min(4, Math.max(2, Math.round(city.pop / 1_500_000) + 2)));
    for (const f of sources) {
      arcs.push({
        fromLat: f.lat,
        fromLng: f.lng,
        toLat: city.lat,
        toLng: city.lng,
        color: fuelColor(f.fuel),
        city: city.name,
        source: f.name,
        mw: f.capacityMW,
      });
    }
  }
  return arcs;
}
