import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Australia Live Energy Map",
  description:
    "Live 3D map of Australia's electricity grid — generation by fuel source, demand, prices and interconnector flows across the NEM and WA's SWIS.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
