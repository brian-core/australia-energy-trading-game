import type { Metadata } from "next";
import DeskClient from "./desk-client";

// Unlinked professional view — same engine as the game, wholesale-desk skin.
// Deliberately absent from the landing page nav and excluded from indexing.
export const metadata: Metadata = {
  title: "Meridian Desk",
  robots: { index: false, follow: false },
};

export default function DeskPage() {
  return <DeskClient />;
}
