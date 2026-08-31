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

- **BUILD view** (toggle, top-left) — model a new utility-scale asset or a scheduled closure and see its first-order effect. Pick from an indicative list of real pipeline projects (Snowy 2.0, Borumba, Golden Plains East, Goyder South, the Eraring/Yallourn/Callide B/Muja closures, …) or define a custom solar / wind / battery / pumped-hydro / gas asset per region. A stylised merit-order model (capacity-by-fuel supply stack with diurnal availability, interconnector import headroom, scarcity tail) is calibrated to each historic 30-min price, the asset is injected (VRE output shifts net demand; storage charges cheap hours and discharges peaks; closures shrink a band), and the price re-solved as a bounded shift on the observed series. Outputs: before/after price curve and averages, p95, modelled generation-mix change, the asset's realised capacity factor and capture price (cannibalisation visible), extrapolated merchant revenue, and the impact on your DESK book's margin. The asset site pulses on the globe. **Not a dispatch model** — no transmission limits or bidding behaviour; labelled simulation throughout.

- **OPS view** (toggle, top-left) — the game layer. Found a generation company with $500m, buy real power stations off the map, and earn the **live spot price** for every MW you send out. Each asset has fuel-specific maintenance systems that decay in real time — panel cleaning and inverter software for solar, turbine gearboxes for wind, coal deliveries and mechanical wear for coal, cell balancing for batteries. Condition drives output (a neglected plant falls to ~25%); maintenance costs money and derates the asset while the crew is on site. Site log, low-condition warnings, sell-back at 70%, progress saved in your browser. Click an asset name to fly to it.
- **Zoom detail** — zoom in close and the globe switches to Esri World Imagery satellite tiles, so you can see the actual sites (Eraring's cooling towers, MacIntyre's turbine rows). Major cities glow on the map with animated arcs showing stylised energy delivery from nearby plants; facilities render as small 3D towers scaled by capacity. Owned (OPS) assets pulse gold.

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

## Deploy it (so people can sign up and play)

1. **Push to GitHub** — create an empty repo, then `git remote add origin <url> && git push -u origin main`.
2. **Vercel** — import the repo at vercel.com; no config needed. Add a custom domain under Settings → Domains.
3. **Accounts (optional)** — create a free [Supabase](https://supabase.com) project, run `supabase/schema.sql` in the SQL editor, set the project's **Auth → URL Configuration → Site URL** to your deployed URL, and add three env vars in Vercel (then redeploy):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only (never exposed to the browser). Cloud saves and leaderboard writes go through `/api/game/save` and `/api/game/leaderboard`, which validate the submitted state server-side before writing with this key — the browser can only read its own save and the public leaderboard, not write either table directly. Without this var, sign-up/sign-in still works but cloud save and the leaderboard return "not configured".

   This enables passwordless email sign-up, cross-device cloud saves, and the public leaderboard (the ACCOUNT card appears in OPS automatically). Without any of these vars the game runs identically with browser-local saves. If you deployed an earlier version of this schema, re-run `supabase/schema.sql` — it now revokes the direct client write access those earlier policies granted.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. Built with Next.js (App Router), react-globe.gl / three.js, Tailwind v4. Deploys cleanly to Vercel.

## Desk

The `/desk` route hosts Meridian Desk — the wholesale trading view (spot board, forward view, buy-timing analytics, and a tabbed AI analyst drawer powered by `ANTHROPIC_API_KEY`).
