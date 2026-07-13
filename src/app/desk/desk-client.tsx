"use client";

import dynamic from "next/dynamic";

// Client-only: the desk reads the shared localStorage book on first render,
// so it must never be server-rendered (same pattern as the globe/asset views).
const TradingDesk = dynamic(() => import("@/components/desk/trading-desk"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-screen place-items-center bg-[#0a0e14] text-[11px] tracking-widest text-[#667081]">
      CONNECTING TO DESK…
    </div>
  ),
});

export default function DeskClient() {
  return <TradingDesk />;
}
