import type { Metadata } from "next";
import NsView from "@/components/northsea/ns-view";

export const metadata: Metadata = {
  title: "North Sea — Platform Repurposing Feasibility",
  description:
    "Live feasibility screening of end-of-life North Sea platforms for AI compute, long-duration storage and hydrogen second lives.",
};

export default function NorthSeaPage() {
  return <NsView />;
}
