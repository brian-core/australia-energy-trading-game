"use client";

// North Sea screening globe: platforms (coloured by screening score), wind
// farms, fibre landings, and — for the selected platform — its tie lines to
// the nearest wind farm and fibre landing. Loaded via next/dynamic ssr:false.

import { useEffect, useMemo, useRef } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { CableLanding, ScreenResult, WindFarm } from "@/lib/energy/northsea";

type NsPoint =
  | { kind: "platform"; r: ScreenResult; lat: number; lng: number }
  | { kind: "wind"; f: WindFarm; lat: number; lng: number }
  | { kind: "landing"; l: CableLanding; lat: number; lng: number };

interface TieArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  label: string;
}

export default function NsGlobe({
  results,
  farms,
  landings,
  selectedId,
  onSelect,
  width,
  height,
}: {
  results: ScreenResult[];
  farms: WindFarm[];
  landings: CableLanding[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  width: number;
  height: number;
}) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  useEffect(() => {
    // Frame the central North Sea on mount.
    globeRef.current?.pointOfView({ lat: 57.2, lng: 1.5, altitude: 0.55 }, 0);
  }, []);

  const points = useMemo<NsPoint[]>(
    () => [
      ...results.map((r) => ({ kind: "platform" as const, r, lat: r.platform.lat, lng: r.platform.lng })),
      ...farms.map((f) => ({ kind: "wind" as const, f, lat: f.lat, lng: f.lng })),
      ...landings.map((l) => ({ kind: "landing" as const, l, lat: l.lat, lng: l.lng })),
    ],
    [results, farms, landings],
  );

  const scoreColor = (score: number): string => {
    if (score >= 60) return "#48a87c";
    if (score >= 40) return "#f2c14e";
    return "#d97a86";
  };

  const arcs = useMemo<TieArc[]>(() => {
    const sel = results.find((r) => r.platform.id === selectedId);
    if (!sel) return [];
    const out: TieArc[] = [];
    if (sel.distances.nearestWind) {
      const w = sel.distances.nearestWind;
      out.push({
        startLat: sel.platform.lat,
        startLng: sel.platform.lng,
        endLat: w.farm.lat,
        endLng: w.farm.lng,
        color: "rgba(72,168,124,0.9)",
        label: `wind tie — ${w.farm.name} · ${Math.round(w.km)} km`,
      });
    }
    if (sel.distances.nearestLanding) {
      const l = sel.distances.nearestLanding;
      out.push({
        startLat: sel.platform.lat,
        startLng: sel.platform.lng,
        endLat: l.landing.lat,
        endLng: l.landing.lng,
        color: "rgba(110,168,220,0.9)",
        label: `fibre — ${l.landing.name} · ${Math.round(l.km)} km`,
      });
    }
    return out;
  }, [results, selectedId]);

  const rings = useMemo(() => {
    const sel = results.find((r) => r.platform.id === selectedId);
    return sel ? [{ lat: sel.platform.lat, lng: sel.platform.lng }] : [];
  }, [results, selectedId]);

  return (
    <Globe
      ref={globeRef}
      width={width}
      height={height}
      globeImageUrl="/textures/earth-night.jpg"
      bumpImageUrl="/textures/earth-topology.png"
      backgroundColor="rgba(8,10,14,1)"
      atmosphereColor="#6ea8dc"
      atmosphereAltitude={0.14}
      pointsData={points}
      pointLat={(d) => (d as NsPoint).lat}
      pointLng={(d) => (d as NsPoint).lng}
      pointAltitude={(d) => {
        const p = d as NsPoint;
        return p.kind === "platform" ? 0.012 : 0.004;
      }}
      pointRadius={(d) => {
        const p = d as NsPoint;
        if (p.kind === "platform") return p.r.platform.id === selectedId ? 0.34 : 0.24;
        if (p.kind === "wind") return Math.max(0.1, Math.min(p.f.capacityMW / 8000, 0.3));
        return 0.12;
      }}
      pointColor={(d) => {
        const p = d as NsPoint;
        if (p.kind === "platform") return scoreColor(p.r.score);
        if (p.kind === "wind") return p.f.status === "operational" ? "#2c8c8a" : "rgba(44,140,138,0.45)";
        return "#6ea8dc";
      }}
      pointLabel={(d) => {
        const p = d as NsPoint;
        if (p.kind === "platform")
          return `<div style="font-family:monospace;font-size:11px">${p.r.platform.name} — score ${Math.round(p.r.score)}<br/>${p.r.platform.operator} · ${p.r.platform.type} · COP ${p.r.platform.copYear}</div>`;
        if (p.kind === "wind")
          return `<div style="font-family:monospace;font-size:11px">${p.f.name} · ${p.f.capacityMW.toLocaleString()} MW · ${p.f.status}</div>`;
        return `<div style="font-family:monospace;font-size:11px">${p.l.name}<br/>${p.l.cables.join(" · ")}</div>`;
      }}
      onPointClick={(d: object) => {
        const p = d as NsPoint;
        if (p.kind === "platform") onSelect(p.r.platform.id === selectedId ? null : p.r.platform.id);
      }}
      arcsData={arcs}
      arcStartLat={(d) => (d as TieArc).startLat}
      arcStartLng={(d) => (d as TieArc).startLng}
      arcEndLat={(d) => (d as TieArc).endLat}
      arcEndLng={(d) => (d as TieArc).endLng}
      arcColor={(d: object) => (d as TieArc).color}
      arcLabel={(d) => (d as TieArc).label}
      arcStroke={0.35}
      arcDashLength={0.6}
      arcDashGap={0.25}
      arcDashAnimateTime={2400}
      ringsData={rings}
      ringLat={(d) => (d as { lat: number }).lat}
      ringLng={(d) => (d as { lng: number }).lng}
      ringMaxRadius={1.4}
      ringPropagationSpeed={1.2}
      ringRepeatPeriod={1400}
      ringColor={() => (t: number) => `rgba(110,168,220,${1 - t})`}
    />
  );
}
