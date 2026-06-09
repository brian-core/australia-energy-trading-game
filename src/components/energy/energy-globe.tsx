"use client";

// Three.js globe rendering for the live energy map. This module is only ever
// loaded via next/dynamic with ssr:false — react-globe.gl touches WebGL/window
// at import time.

import { useCallback, useEffect, useMemo, useRef } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { FUEL_META } from "@/lib/energy/regions";
import type { Facility, InterconnectorFlow, RegionLive } from "@/lib/energy/types";

const GEN_COLOR = "#2c8c8a"; // generation columns (teal)
const LOAD_COLOR = "#d97a86"; // demand columns (pink)
const ARC_COLOR_DIM = "rgba(242, 193, 78, 0.08)";
const ARC_COLOR_BRIGHT = "rgba(242, 193, 78, 0.95)";

// Columns and facility dots share globe.gl's single points layer, so every
// styling accessor switches on `kind`.
type MapPoint =
  | (Facility & { kind: "facility" })
  | {
      kind: "column";
      metric: "generation" | "load";
      region: RegionLive;
      lat: number;
      lng: number;
      mw: number;
    };

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
        (point.region ? `<br/><span style="opacity:.6">${point.region}</span>` : ""),
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
  width,
  height,
}: {
  regions: RegionLive[];
  flows: InterconnectorFlow[];
  facilities: Facility[];
  selectedRegion: string | null;
  onSelectRegion: (code: string | null) => void;
  width: number;
  height: number;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  const points = useMemo<MapPoint[]>(() => {
    const columns: MapPoint[] = regions.flatMap((region) => [
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
    const dots: MapPoint[] = facilities.map((f) => ({ ...f, kind: "facility" }));
    return [...dots, ...columns];
  }, [regions, facilities]);

  const labels = useMemo(
    () =>
      regions.map((r) => ({
        lat: r.lat + 2.4,
        lng: r.lng,
        text: r.name.includes("(") ? r.name.slice(0, r.name.indexOf("(")).trim() : r.name,
        code: r.code,
      })),
    [regions],
  );

  const arcs = useMemo(() => flows.filter((f) => f.mw > 5), [flows]);

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
        if (point.kind === "facility") return FUEL_META[point.fuel].color;
        return point.metric === "generation" ? GEN_COLOR : LOAD_COLOR;
      }}
      pointAltitude={(p) => {
        const point = p as MapPoint;
        if (point.kind === "facility") return 0.008;
        return Math.min(0.005 + point.mw / 42000, 0.3);
      }}
      pointRadius={(p) => {
        const point = p as MapPoint;
        if (point.kind === "facility") return 0.05 + Math.sqrt(point.capacityMW) / 220;
        return 0.55;
      }}
      pointResolution={10}
      pointLabel={(p) => tooltipHtml(p as MapPoint)}
      onPointClick={(p) => {
        const point = p as MapPoint;
        onSelectRegion(point.kind === "column" ? point.region.code : null);
      }}
      arcsData={arcs}
      arcStartLat="fromLat"
      arcStartLng="fromLng"
      arcEndLat="toLat"
      arcEndLng="toLng"
      arcColor={() => [ARC_COLOR_DIM, ARC_COLOR_BRIGHT]}
      arcAltitude={0.06}
      arcStroke={(a) => 0.25 + Math.min((a as InterconnectorFlow).mw, 1600) / 1600}
      arcDashLength={0.35}
      arcDashGap={0.25}
      arcDashAnimateTime={(a) => 240000 / ((a as InterconnectorFlow).mw + 120)}
      arcLabel={(a) => {
        const flow = a as InterconnectorFlow;
        return `<div style="font-family:var(--f-mono,monospace);font-size:11px;background:#11141aee;border:1px solid #ffffff26;border-radius:6px;padding:6px 9px;color:#ecebe4"><b>${flow.label}</b><br/>${flow.from.replace(/\d$/, "")} → ${flow.to.replace(/\d$/, "")} · ${fmtMW(flow.mw)}</div>`;
      }}
      labelsData={labels}
      labelLat="lat"
      labelLng="lng"
      labelText="text"
      labelSize={0.85}
      labelDotRadius={0}
      labelColor={() => "rgba(236,235,228,0.75)"}
      labelResolution={2}
      onLabelClick={(l) => onSelectRegion((l as { code: string }).code)}
    />
  );
}
