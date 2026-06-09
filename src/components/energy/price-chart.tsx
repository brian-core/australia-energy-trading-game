"use client";

import { useMemo } from "react";
import type { PricePoint } from "@/lib/energy/history";

// Minimal dependency-free SVG line chart for price/equity series.
export default function PriceChart({
  points,
  height = 70,
  color = "#f2c14e",
  fillToZero = false,
}: {
  points: PricePoint[];
  height?: number;
  color?: string;
  fillToZero?: boolean;
}) {
  const W = 300;
  const { path, area, zeroY, min, max } = useMemo(() => {
    if (points.length < 2) return { path: "", area: "", zeroY: null as number | null, min: 0, max: 0 };
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const minV = Math.min(...ys, 0);
    const maxV = Math.max(...ys);
    const span = maxV - minV || 1;
    const px = (t: number) => ((t - minX) / (maxX - minX || 1)) * W;
    const py = (v: number) => height - 4 - ((v - minV) / span) * (height - 8);
    const d = points.map(([t, v], i) => `${i === 0 ? "M" : "L"}${px(t).toFixed(1)},${py(v).toFixed(1)}`).join("");
    const a = fillToZero
      ? `${d}L${W},${py(0).toFixed(1)}L0,${py(0).toFixed(1)}Z`
      : "";
    return {
      path: d,
      area: a,
      zeroY: minV < 0 ? py(0) : null,
      min: Math.min(...ys),
      max: maxV,
    };
  }, [points, height, fillToZero]);

  if (!path) {
    return <div className="text-[10px] text-[var(--ink-soft)]">no data</div>;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }}>
        {zeroY != null && (
          <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" strokeWidth={0.75} />
        )}
        {area && <path d={area} fill={color} opacity={0.12} />}
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} />
      </svg>
      <div className="flex justify-between text-[9px] text-[var(--ink-soft)]">
        <span>min {Math.round(min).toLocaleString()}</span>
        <span>max {Math.round(max).toLocaleString()}</span>
      </div>
    </div>
  );
}
