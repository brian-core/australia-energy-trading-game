# A Theory of North Sea Platform-Repurposing Outcomes

**Computed, not asserted.** Every number below is a run of the `/northsea` feasibility engine
(post round-2 corrections, PR #20) on **live GB market data** (Elexon spot & wind, BoE 3.75%,
CPI 2.8%, discount 7.75%), 500 seeded Monte-Carlo paths, 2026-07-08. Re-run any claim in the
tool; the engine is deterministic.

---

## 1. The scenarios

| Option | One-line logic | Whose money |
|---|---|---|
| **A** — decommission now | Pay the removal bill (gross) | Operator |
| **A′** — decommission now, net | Same, net of ~55% ring-fence relief — the honest baseline | Operator |
| **B** — interruptible compute (v2) | External developer pays full freight, earns merchant £/MWh-IT on delivered energy | Developer |
| **C** — firm compute + LDES (v1) | Tier-III ambitions offshore: iron-air deck, HVDC, take-or-pay PPA | Developer |
| **D** — H₂ electrolysis | The literature's option: tied wind → PEM → £6.08/kg | Developer |
| **E** — operator-sponsored anchor | Platform at nil into an SPV; decom netted & deferral credited; tenant owns GPUs; powered-capacity anchor tenancy at tenant-indifferent pricing | Operator + anchor tenant |

## 2. The outcomes (P50 NPV, £m, at round-2 defaults)

| Platform | A | A′ | B | C | D | **E P50** | **E P10** | E P(beats A′) |
|---|---|---|---|---|---|---|---|---|
| Gannet Alpha | −224 | −101 | −642 | −801 | −330 | **+334** | +135 | >99% |
| Elgin PUQ | −294 | −132 | −819 | −1024 | −406 | **+462** | +208 | >99% |
| ETAP Central | −266 | −120 | −706 | −886 | −365 | **+381** | +160 | >99% |
| Shearwater | −280 | −126 | −780 | −968 | −402 | **+411** | +175 | >99% |
| Brent Charlie (worst-screened) | −710 | −355 | — | — | — | **+510** | +141 | >99% |

Availability pins at ~75% everywhere (2.2× tied wind + 15% import); E break-even capacity
rates cluster at **£32–34/kW-mo** against a £97 all-in default; B break-evens cluster at
**£256–259/MWh-IT** against a £170 default.

## 3. The theory

### T1 — The physics is indifferent; the financing is not.
B, C, D and E share the same steel, the same wind, the same water. Every developer-financed
structure (B, C, D) is NPV-negative at defensible prices; the operator-sponsored structure is
decisively positive on the same platform. **Repurposing is not an infrastructure yield play;
it is a liability-management instrument.** The value was never in the electrons or the
molecules — it is in who already owes the removal bill.

### T2 — E's value decomposes into five transfers, in rank order.
From the lever sweeps (Gannet, ΔP50 across plausible ranges):

1. **Revenue denomination** (capacity rate £50→£100/kW-mo: −£249m → +£317m around base) —
   billing *contracted capacity* at colo-floor rates beats billing *delivered energy* at any
   defensible merchant rate. This is the single load-bearing assumption.
2. **Wind sizing** (1.5×→3.0×: +£69m → +£469m) — utilisation is bought, not hoped for;
   oversizing the tie is the cheapest risk reduction in the whole structure.
3. **Marine opex** (£150k→£450k/MW-yr: +£482m → +£139m) — the Natick line. It cannot kill
   the structure at plausible levels, but it eats ~£85m per £100k/MW-yr.
4. **Capex transfer** (tenant-owned GPUs: −60% of fit-out; platform at nil) — embedded in
   every row; the reason E's capex is £403m where C's is £1.03bn.
5. **The tax story is a rounding error.** Relief 40%→75% moves P50 by **£36m** on a +£334m
   NPV. The deferral credit is real (+£83m) but second-order. *The heart of the operator
   case is the balance sheet transfer, not the tax treatment* — a finding that inverts the
   round-1 brief's framing, and the model is unambiguous about it.

### T3 — The decision boundaries (Gannet, all else at defaults).
- E beats A′ at P50 down to a capacity rate of **~£34/kW-mo** — 35% of the tenant-indifferent
  default. The structure survives pricing that would be a distressed fire-sale of capacity.
- **P10 turns negative** below ~£55/kW-mo, above ~£430k/MW-yr opex, below ~1.7× wind ratio,
  or above ~£250m remediation. Those four numbers are the honest edge of the case.
- B needs **£350/MWh-IT** to reach positive P50 — GPU-scarcity pricing sustained for 20
  years. That is the bet the developer-financed version silently makes; E does not make it.

### T4 — The paradox of the worst platform.
Brent Charlie — bottom of the screening table (no pipeline, in decommissioning, 1978
concrete) — prints the **largest** E NPV (+£510m), because E's value scales with the size of
the liability being deferred and the topside available for payload. **Screening rank and
financial rank invert under the operator structure.** The resolution: the screen's risk
channels still bind — the remediation sweep shows P10 flipping negative at ~£300m, which is
precisely Brent-Charlie territory, and its fibre must be laid, not pulled. The theory's
statement: *revenue is set by contract architecture (invariant across platforms); risk is set
by the steel (highly variant). Pick platforms on the risk channel, not the revenue channel.*

### T5 — Geography barely matters; counterparty does.
Across the top four platforms — different operators, fields, distances — E's P50 varies only
with platform scale, availability pins at 75%, and break-evens sit within £2/kW-mo of each
other. The INTOG wind adjacency and pipeline backhaul set *feasibility*; they do not set
*value*. The deal-relevant variable is the **operator** (Shell holds two of the top four —
a portfolio conversation amortising one regulatory pathway over two platforms).

### T6 — What the theory says the residual bet is.
After two rounds of adversarial correction, the uncertainty concentrates in exactly three
externally answerable numbers, in order of tornado weight:
1. **The rate a real anchor tenant signs** for ~75%-available, interruptible, time-to-power
   capacity (every £10/kW-mo ≈ ±£110m P50).
2. **An O&M contractor's marine opex quote** (every £100k/MW-yr ≈ ∓£85m).
3. **The operator's structural condition data** (remediation mean beyond ~£250m breaks P10).

If those three come back inside the defaults, the theory's conclusion is: *end-of-life
platforms are worth more as liability-deferral vehicles with compute anchors than as removal
projects, by roughly 3–5× the net liability — but only when sponsored by the party that owes
the bill.* If the tenant rate comes back below ~£55/kW-mo all-in, the honest conclusion is
that the compute-scarcity premium does not survive contact with a real counterparty, and the
thesis reverts to hydrogen-or-remove.

## 4. Known limits carried forward
Screening-grade throughout: 7-day GB shapes seasonally tiled (not dispatch), reference outage
and cost parameters where no public feed exists (labelled in-tool), OSPAR 98/3 derogation
untested for compute, structural condition unmodelled beyond a fat-tailed lump. The removal
obligation is preserved and funded at net cost in every E run — never laundered.

---

*Generated from `/northsea` engine sweeps; reproduce via the tool's study export or the
sweep harness. Session: PRs #9–#20.*
