"use client";

// Three.js globe rendering for the live energy map. This module is only ever
// loaded via next/dynamic with ssr:false — react-globe.gl touches WebGL/window
// at import time.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { CITIES, buildDeliveryArcs, type City, type DeliveryArc } from "@/lib/energy/cities";
import { FUEL_META } from "@/lib/energy/regions";
import { RETAIL_REF, fmtRetail, priceColor, spotAsCkwh } from "@/lib/energy/pricing";
import type { Facility, InterconnectorFlow, RegionLive } from "@/lib/energy/types";

export type MapMode = "power" | "price";

// Esri World Imagery — free satellite tiles (attribution in the legend),
// engaged when the camera gets close so you can see the actual sites.
const SAT_TILE_URL = (x: number, y: number, l: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`;

const GEN_COLOR = "#2c8c8a"; // generation columns (teal)
const LOAD_COLOR = "#d97a86"; // demand columns (pink)
const ARC_COLOR_DIM = "rgba(242, 193, 78, 0.08)";
const ARC_COLOR_BRIGHT = "rgba(242, 193, 78, 0.95)";

// Columns and facility dots share globe.gl's single points layer, so every
// styling accessor switches on `kind`.
type MapPoint =
  | (Facility & { kind: "facility"; spotAUD: number | null; owned: boolean })
  | (City & { kind: "city" })
  | {
      kind: "column";
      metric: "generation" | "load";
      region: RegionLive;
      lat: number;
      lng: number;
      mw: number;
    }
  | {
      kind: "pricecol";
      region: RegionLive;
      lat: number;
      lng: number;
    };

type MapArc = InterconnectorFlow | DeliveryArc;

const isDelivery = (a: MapArc): a is DeliveryArc => "city" in a;

function fmtMW(mw: number): string {
  return mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw)} MW`;
}

function tooltipHtml(point: MapPoint): string {
  const box = (rows: string) =>
    `<div style="font-family:var(--f-mono,monospace);font-size:11px;line-height:1.5;background:#11141aee;border:1px solid #ffffff26;border-radius:6px;padding:8px 10px;color:#ecebe4">${rows}</div>`;
  if (point.kind === "facility") {
    const meta = FUEL_META[point.fuel];
    return box(
      `<b>${point.name}</b><br/>` +
        `<span style="color:${meta.color}">●</span> ${meta.label} · ${fmtMW(point.capacityMW)} capacity` +
        (point.owner ? `<br/>${point.owner}` : "") +
        (point.spotAUD != null
          ? `<br/>merchant spot <span style="color:${priceColor(point.spotAUD)}">$${point.spotAUD.toFixed(0)}/MWh</span>`
          : "") +
        `<br/><span style="opacity:.6">${point.region ? point.region + " · " : ""}click for details</span>`,
    );
  }
  if (point.kind === "city") {
    return box(
      `<b>${point.name}</b><br/>` +
        `${(point.pop / 1e6).toFixed(point.pop >= 1e6 ? 1 : 2)}m people · ${point.region.replace(/\d$/, "")}<br/>` +
        `<span style="opacity:.6">arcs show stylised supply from nearby plants</span>`,
    );
  }
  if (point.kind === "pricecol") {
    const r = point.region;
    const retail = RETAIL_REF[r.code];
    return box(
      `<b>${r.name}</b><br/>` +
        (r.priceAUD != null
          ? `spot <span style="color:${priceColor(r.priceAUD)}">$${r.priceAUD.toFixed(0)}/MWh</span> (${spotAsCkwh(r.priceAUD).toFixed(1)}c/kWh)<br/>`
          : `spot n/a<br/>`) +
        (retail
          ? `retail ref ${fmtRetail(retail)}/kWh (${retail.scheme})<br/><span style="opacity:.6">${retail.networks.join(", ")}</span>`
          : ""),
    );
  }
  const r = point.region;
  return box(
    `<b>${r.name}</b><br/>` +
      `<span style="color:${GEN_COLOR}">▲ generation</span> ${fmtMW(r.generationMW)}<br/>` +
      `<span style="color:${LOAD_COLOR}">▼ load</span> ${fmtMW(r.demandMW)}<br/>` +
      `renewables ${(r.renewableShare * 100).toFixed(0)}%` +
      (r.priceAUD != null ? ` · $${r.priceAUD.toFixed(0)}/MWh` : ""),
  );
}

export default function EnergyGlobe({
  regions,
  flows,
  facilities,
  selectedRegion,
  onSelectRegion,
  onSelectFacility,
  mode,
  scenarioSite,
  ownedAssets,
  flyTo,
  width,
  height,
}: {
  regions: RegionLive[];
  flows: InterconnectorFlow[];
  facilities: Facility[];
  selectedRegion: string | null;
  onSelectRegion: (code: string | null) => void;
  onSelectFacility?: (facility: Facility) => void;
  mode: MapMode;
  scenarioSite?: { lat: number; lng: number; label: string } | null;
  /** Player-owned assets (OPS game) — highlighted with pulsing rings. */
  ownedAssets?: Array<{ lat: number; lng: number; id: string }>;
  /** Imperative fly-to target; bump `seq` to retrigger. */
  flyTo?: { lat: number; lng: number; seq: number; altitude?: number; ms?: number } | null;
  width: number;
  height: number;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  const points = useMemo<MapPoint[]>(() => {
    const priceByRegion = new Map(regions.map((r) => [r.code, r.priceAUD]));
    const columns: MapPoint[] =
      mode === "price"
        ? regions.map((region) => ({
            kind: "pricecol",
            region,
            lat: region.lat,
            lng: region.lng,
          }))
        : regions.flatMap((region): MapPoint[] => [
            {
              kind: "column",
              metric: "generation",
              region,
              lat: region.lat,
              lng: region.lng - 1.1,
              mw: region.generationMW,
            },
            {
              kind: "column",
              metric: "load",
              region,
              lat: region.lat,
              lng: region.lng + 1.1,
              mw: region.demandMW,
            },
          ]);
    const ownedIds = new Set((ownedAssets ?? []).map((a) => a.id));
    const dots: MapPoint[] = facilities.map((f) => ({
      ...f,
      kind: "facility",
      spotAUD: priceByRegion.get(f.region) ?? null,
      owned: ownedIds.has(f.name),
    }));
    const cityDots: MapPoint[] = CITIES.map((c) => ({ ...c, kind: "city" }));
    return [...dots, ...cityDots, ...columns];
  }, [regions, facilities, mode, ownedAssets]);

  const labels = useMemo(
    () => [
      ...regions.map((r) => ({
        lat: r.lat + 2.4,
        lng: r.lng,
        text: r.name.includes("(") ? r.name.slice(0, r.name.indexOf("(")).trim() : r.name,
        code: r.code as string | null,
        size: 0.85,
        color: "rgba(236,235,228,0.75)",
      })),
      ...CITIES.map((c) => ({
        lat: c.lat - 0.35,
        lng: c.lng,
        text: c.name,
        code: null as string | null,
        size: 0.28 + Math.min(c.pop / 12e6, 0.18),
        color: "rgba(223,243,242,0.65)",
      })),
    ],
    [regions],
  );

  const arcs = useMemo<MapArc[]>(() => {
    const delivery = buildDeliveryArcs(facilities, (fuel) => FUEL_META[fuel].color);
    return [...flows.filter((f) => f.mw > 5), ...delivery];
  }, [flows, facilities]);

  // Satellite tiles fade in when the camera gets close (with hysteresis so
  // the engine doesn't thrash at the boundary).
  const [satTiles, setSatTiles] = useState(false);
  const handleZoom = useCallback((pov: { altitude: number }) => {
    setSatTiles((prev) => (prev ? pov.altitude < 0.5 : pov.altitude < 0.35));
  }, []);

  // Imperative fly-to (used by OPS "fly to asset") — close enough for tiles.
  const flySeqRef = useRef(0);
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !flyTo || flyTo.seq === flySeqRef.current) return;
    flySeqRef.current = flyTo.seq;
    globe.controls().autoRotate = false;
    globe.pointOfView({ lat: flyTo.lat, lng: flyTo.lng, altitude: flyTo.altitude ?? 0.06 }, flyTo.ms ?? 1200);
  }, [flyTo]);

  const rings = useMemo(() => {
    const owned = (ownedAssets ?? []).map((a) => ({ lat: a.lat, lng: a.lng, kind: "owned" }));
    return scenarioSite ? [...owned, { lat: scenarioSite.lat, lng: scenarioSite.lng, kind: "scenario" }] : owned;
  }, [ownedAssets, scenarioSite]);

  const handleReady = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.pointOfView({ lat: -28, lng: 134, altitude: 1.45 }, 0);
    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    controls.minDistance = 130;
    // Pause the slow spin as soon as the user grabs the globe.
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
    });
  }, []);

  // Fly to a region on selection, back to the overview on deselect. Regions
  // are read through a ref so the 60s data refresh doesn't re-trigger flight.
  const regionsRef = useRef(regions);
  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);
  const hasFlownRef = useRef(false);
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    if (!selectedRegion) {
      if (hasFlownRef.current) {
        globe.pointOfView({ lat: -28, lng: 134, altitude: 1.45 }, 900);
      }
      return;
    }
    const region = regionsRef.current.find((r) => r.code === selectedRegion);
    if (!region) return;
    hasFlownRef.current = true;
    globe.controls().autoRotate = false;
    globe.pointOfView({ lat: region.lat, lng: region.lng, altitude: 0.7 }, 900);
  }, [selectedRegion]);

  return (
    <Globe
      ref={globeRef}
      width={width}
      height={height}
      onGlobeReady={handleReady}
      globeImageUrl="/textures/earth-night.jpg"
      bumpImageUrl="/textures/earth-topology.png"
      backgroundColor="rgba(8,10,14,1)"
      atmosphereColor="#2c8c8a"
      atmosphereAltitude={0.16}
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor={(p) => {
        const point = p as MapPoint;
        if (point.kind === "facility")
          return point.owned ? "#ffd76a" : FUEL_META[point.fuel].color;
        if (point.kind === "city") return "rgba(223,243,242,0.95)";
        if (point.kind === "pricecol") return priceColor(point.region.priceAUD);
        return point.metric === "generation" ? GEN_COLOR : LOAD_COLOR;
      }}
      pointAltitude={(p) => {
        const point = p as MapPoint;
        // Facilities are little 3D towers scaled by capacity, visible up close.
        if (point.kind === "facility") return 0.004 + Math.min(point.capacityMW / 90000, 0.035);
        if (point.kind === "city") return 0.0035;
        if (point.kind === "pricecol") {
          const price = point.region.priceAUD;
          // Negative or missing prices get a stub column; colour carries the signal.
          if (price == null || price <= 0) return 0.015;
          return 0.015 + Math.min(price, 600) / 2400;
        }
        return Math.min(0.005 + point.mw / 42000, 0.3);
      }}
      pointRadius={(p) => {
        const point = p as MapPoint;
        if (point.kind === "facility") return 0.05 + Math.sqrt(point.capacityMW) / 220;
        if (point.kind === "city") return 0.1 + Math.min(point.pop / 30e6, 0.16);
        if (point.kind === "pricecol") return 0.8;
        return 0.55;
      }}
      pointResolution={18}
      pointLabel={(p) => tooltipHtml(p as MapPoint)}
      onPointClick={(p) => {
        const point = p as MapPoint;
        if (point.kind === "facility") {
          onSelectFacility?.({
            name: point.name,
            lat: point.lat,
            lng: point.lng,
            fuel: point.fuel,
            capacityMW: point.capacityMW,
            region: point.region,
            owner: point.owner,
            url: point.url,
          });
        } else if (point.kind === "city") {
          onSelectRegion(point.region);
        } else {
          onSelectRegion(point.region.code);
        }
      }}
      arcsData={arcs}
      arcStartLat="fromLat"
      arcStartLng="fromLng"
      arcEndLat="toLat"
      arcEndLng="toLng"
      arcColor={(a: object) => {
        const arc = a as MapArc;
        if (isDelivery(arc)) return ["rgba(255,255,255,0.02)", arc.color];
        return [ARC_COLOR_DIM, ARC_COLOR_BRIGHT];
      }}
      arcAltitude={(a: object) => (isDelivery(a as MapArc) ? 0.015 : 0.06)}
      arcStroke={(a: object) => {
        const arc = a as MapArc;
        if (isDelivery(arc)) return 0.08 + Math.min(arc.mw, 2000) / 14000;
        return 0.25 + Math.min(arc.mw, 1600) / 1600;
      }}
      arcDashLength={0.35}
      arcDashGap={(a: object) => (isDelivery(a as MapArc) ? 0.6 : 0.25)}
      arcDashAnimateTime={(a: object) => {
        const arc = a as MapArc;
        return isDelivery(arc) ? 1400 + (arc.mw % 700) : 240000 / (arc.mw + 120);
      }}
      arcLabel={(a: object) => {
        const arc = a as MapArc;
        const box = (s: string) =>
          `<div style="font-family:var(--f-mono,monospace);font-size:11px;background:#11141aee;border:1px solid #ffffff26;border-radius:6px;padding:6px 9px;color:#ecebe4">${s}</div>`;
        if (isDelivery(arc)) return box(`${arc.source} → <b>${arc.city}</b>`);
        return box(
          `<b>${arc.label}</b><br/>${arc.from.replace(/\d$/, "")} → ${arc.to.replace(/\d$/, "")} · ${fmtMW(arc.mw)}`,
        );
      }}
      ringsData={rings}
      ringLat="lat"
      ringLng="lng"
      ringColor={(r: object) =>
        (r as { kind: string }).kind === "owned"
          ? (t: number) => `rgba(255,215,106,${Math.max(0.8 - t, 0)})`
          : (t: number) => `rgba(242,193,78,${Math.max(1 - t, 0)})`
      }
      ringMaxRadius={(r: object) => ((r as { kind: string }).kind === "owned" ? 1.6 : 3.5)}
      ringPropagationSpeed={1.6}
      ringRepeatPeriod={900}
      labelsData={labels}
      labelLat="lat"
      labelLng="lng"
      labelText="text"
      labelSize="size"
      labelDotRadius={0}
      labelColor="color"
      labelResolution={2}
      onLabelClick={(l) => {
        const code = (l as { code: string | null }).code;
        if (code) onSelectRegion(code);
      }}
      globeTileEngineUrl={satTiles ? SAT_TILE_URL : null}
      onZoom={handleZoom}
    />
  );
}
