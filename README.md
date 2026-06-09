# Australia Live Energy Map

A live 3D globe of Australia's electricity system: what's being generated (coal, gas, hydro, wind, solar, batteries, …), what's being consumed, spot prices, and how power flows between regions — across the five NEM states and Western Australia's SWIS grid.

![3D globe](https://img.shields.io/badge/three.js-globe-2c8c8a) ![data](https://img.shields.io/badge/data-AEMO%20%2B%20OpenElectricity-f2c14e)

## What you see

- **Teal / pink columns** per region — generation vs load, height proportional to MW
- **Dots** — individual power stations, coloured by fuel tech and sized by registered capacity
- **Animated arcs** — interconnector flows between NEM regions (QNI, VIC–NSW, Heywood, Basslink); dash speed scales with MW
- **HUD** — national totals, renewable share, per-region fuel mix, spot prices, import/export status. Click a region (card, label or column) to fly to it.
- **PRICE view** (toggle, top-left) — columns become wholesale spot price per region, coloured by AEMO-style price bands (negative → purple, >$300 → red). Tooltips and region cards compare the live **merchant** (spot) rate in c/kWh against a **retail** reference range per state — FY2025-26 DMO / Victorian Default Offer / regulated tariffs per distribution network (Ausgrid, Endeavour, Essential, Energex, Ergon, the five Victorian networks, SA Power Networks, Aurora, Synergy). Station tooltips show the spot price their region is earning. Retail has no live feed — those are annual benchmark offers, labelled as such.

- **DESK view** (toggle, top-left) — a synthetic trading desk for a flat-rate energy subscription book. Set your **book** (flat customer rate c/kWh, non-energy costs, customer load MW per region, hedge coverage target, buy-signal threshold), then enter **paper trades** — swaps (fixed price for X MW) and caps (strike + premium). Positions are marked against the live 5-minute spot: per-region and portfolio margin in $/h and $/day, hedge coverage, effective cost, a $10k/MWh spike stress test, and a per-trade mark-to-market blotter. A **signal engine** raises alerts each refresh — buy signals when spot is below your threshold with a coverage gap, spike warnings when you're unhedged above $300, negative-price notices, and serving-at-a-loss flags — with optional browser notifications. Book and trades persist in localStorage. **Simulation only**: nothing connects to ASX Energy or AEMO settlement.

## Data sources

| Feed | What | Cadence |
| --- | --- | --- |
| [AEMO data dashboard](https://visualisations.aemo.com.au) `ELEC_NEM_SUMMARY` | demand, net interchange, spot price per NEM region | 5 min |
| [OpenElectricity](https://openelectricity.org.au) (formerly OpenNEM) per-region power | generation by fuel tech, NEM regions + WEM | 5 min |
| OpenElectricity facility register | power station names, coordinates, fuel, capacity | static-ish |

Both feeds are public and unauthenticated; they're fetched server-side by two route handlers (`/api/energy/live`, `/api/energy/facilities`) with short-lived caching, so browsers never hit AEMO/OpenElectricity directly (no CORS issues, and many clients share one upstream request).

Interconnector flows are solved from regional net interchange — the NEM's region graph is a tree, so border flows are fully determined.

If the upstream feeds are unreachable, the app falls back to a built-in demo snapshot and says so in the status chip.

Not covered: the NT's Darwin–Katherine grid and regional WA systems (no public real-time feed).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Built with Next.js (App Router), react-globe.gl / three.js, Tailwind v4. Deploys cleanly to Vercel.
