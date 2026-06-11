"use client";

import { useMemo } from "react";
import type { PricePoint } from "@/lib/energy/history";

// Minimal dependency-free SVG line chart for price/equity series.
export default function PriceChart({
  points,
  secondary,
  band,
  height = 70,
  color = "#f2c14e",
  secondaryColor = "rgba(236,235,228,0.35)",
  fillToZero = false,
}: {
  points: PricePoint[];
  /** Optional comparison series drawn dimly behind the main one. */
  secondary?: PricePoint[];
  /** Optional uncertainty band rendered as a translucent fill. */
  band?: { lo: PricePoint[]; hi: PricePoint[] };
  height?: number;
  color?: string;
  secondaryColor?: string;
  fillToZero?: boolean;
}) {
  const W = 300;
  const { path, path2, area, bandPath, zeroY, min, max } = useMemo(() => {
    if (points.length < 2)
      return { path: "", path2: "", area: "", bandPath: "", zeroY: null as number | null, min: 0, max: 0 };
    const all = [
      ...points,
      ...(secondary ?? []),
      ...(band ? [...band.lo, ...band.hi] : []),
    ];
    const xs = points.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const minV = Math.min(...ys, 0);
    const maxV = Math.max(...ys);
    const span = maxV - minV || 1;
    const px = (t: number) => ((t - minX) / (maxX - minX || 1)) * W;
    const py = (v: number) => height - 4 - ((v - minV) / span) * (height - 8);
    const toPath = (pts: PricePoint[]) =>
      pts.map(([t, v], i) => `${i === 0 ? "M" : "L"}${px(t).toFixed(1)},${py(v).toFixed(1)}`).join("");
    const d = toPath(points);
    const a = fillToZero
      ? `${d}L${W},${py(0).toFixed(1)}L0,${py(0).toFixed(1)}Z`
      : "";
    let bp = "";
    if (band && band.lo.length > 1 && band.hi.length > 1) {
      const lo = toPath(band.lo);
      const hiRev = [...band.hi]
        .reverse()
        .map(([tt, vv]) => `L${px(tt).toFixed(1)},${py(vv).toFixed(1)}`)
        .join("");
      bp = `${lo}${hiRev}Z`;
    }
    return {
      path: d,
      path2: secondary && secondary.length > 1 ? toPath(secondary) : "",
      area: a,
      bandPath: bp,
      zeroY: minV < 0 ? py(0) : null,
      min: Math.min(...points.map((p) => p[1])),
      max: maxV,
    };
  }, [points, secondary, band, height, fillToZero]);

  if (!path) {
    return <div className="text-[10px] text-[var(--ink-soft)]">no data</div>;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
        {zeroY != null && (
          <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" strokeWidth={0.75} />
        )}
        {bandPath && <path d={bandPath} fill={color} opacity={0.14} />}
        {area && <path d={area} fill={color} opacity={0.12} />}
        {path2 && <path d={path2} fill="none" stroke={secondaryColor} strokeWidth={1} />}
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} />
      </svg>
      <div className="flex justify-between text-[9px] text-[var(--ink-soft)]">
        <span>min {Math.round(min).toLocaleString()}</span>
        <span>max {Math.round(max).toLocaleString()}</span>
      </div>
    </div>
  );
}
