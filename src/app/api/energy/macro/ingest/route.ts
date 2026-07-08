import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/energy/supabase-admin";
import { fetchBoeBankRate, fetchOnsCpi } from "@/lib/energy/gb";
import { fetchAbsCpi, fetchFx } from "@/lib/energy/macro";
import {
  fetchRbaCsv,
  normaliseRbaTable,
  parseCsv,
  RBA_TABLES,
  type MacroObservation,
} from "@/lib/energy/rba";

// Server-side macro ingestion. Fetches the RBA CSVs (cash rate, CPI), stores
// each raw drop in macro_ingest (skipping unchanged content by hash) and the
// normalised series in macro_observations. Also persists the live FX and ABS
// CPI snapshots for consistency. Requires SUPABASE_SERVICE_ROLE_KEY.
//
// GET and POST both run it (GET kept for easy manual/cron triggering).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

interface SourceSummary {
  source: string;
  tableCode: string;
  status: "ingested" | "unchanged" | "error";
  observations?: number;
  detail?: string;
}

const CHUNK = 500;

async function upsertObservations(sb: SupabaseAdmin, ingestId: string, rows: MacroObservation[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map((o) => ({ ...o, ingest_id: ingestId, ingested_at: new Date().toISOString() }));
    const { error } = await sb
      .from("macro_observations")
      .upsert(batch, { onConflict: "source,series_id,obs_date" });
    if (error) throw new Error(error.message);
    written += batch.length;
  }
  return written;
}

/** Insert a raw drop and its normalised observations, skipping if the content
 *  hash matches the most recent drop for this (source, table_code). */
async function ingestDrop(
  sb: SupabaseAdmin,
  source: string,
  tableCode: string,
  rawText: string,
  rawJson: unknown,
  observations: MacroObservation[],
): Promise<SourceSummary> {
  const contentHash = createHash("sha256").update(rawText).digest("hex");

  const { data: prev } = await sb
    .from("macro_ingest")
    .select("content_hash")
    .eq("source", source)
    .eq("table_code", tableCode)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prev?.content_hash === contentHash) {
    return { source, tableCode, status: "unchanged" };
  }

  const { data: ingest, error: insErr } = await sb
    .from("macro_ingest")
    .insert({ source, table_code: tableCode, content_hash: contentHash, raw_json: rawJson })
    .select("id")
    .single();
  if (insErr || !ingest) throw new Error(insErr?.message ?? "macro_ingest insert failed");

  const written = await upsertObservations(sb, ingest.id as string, observations);
  return { source, tableCode, status: "ingested", observations: written };
}

async function ingestRbaTables(sb: SupabaseAdmin): Promise<SourceSummary[]> {
  const out: SourceSummary[] = [];
  for (const spec of RBA_TABLES) {
    try {
      const text = await fetchRbaCsv(spec.tableCode);
      const rows = parseCsv(text);
      const observations = normaliseRbaTable(rows, spec);
      out.push(await ingestDrop(sb, spec.source, spec.tableCode, text, { rows }, observations));
    } catch (e) {
      out.push({ source: spec.source, tableCode: spec.tableCode, status: "error", detail: String(e) });
    }
  }
  return out;
}

/** UK macro for the North Sea view: BoE Bank Rate (full daily history from
 *  the IADB CSV) and ONS CPI (monthly year-ended rate), sources 'BOE'/'ONS'. */
async function ingestUk(sb: SupabaseAdmin): Promise<SourceSummary[]> {
  const out: SourceSummary[] = [];

  try {
    const boe = await fetchBoeBankRate();
    if (boe) {
      const obs: MacroObservation[] = boe.csv
        .trim()
        .split("\n")
        .slice(1)
        .map((line): MacroObservation | null => {
          const [d, v] = line.split(",");
          const ms = Date.parse(d);
          const value = Number(v);
          if (!Number.isFinite(ms) || !Number.isFinite(value)) return null;
          return {
            source: "BOE",
            series_id: "IUDBEDR",
            series_label: "Official Bank Rate",
            unit: "Per cent",
            frequency: "Daily",
            obs_date: new Date(ms).toISOString().slice(0, 10),
            value,
          };
        })
        .filter((o): o is MacroObservation => o !== null);
      out.push(await ingestDrop(sb, "BOE", "iudbedr", boe.csv, { rows: obs.length }, obs));
    }
  } catch (e) {
    out.push({ source: "BOE", tableCode: "iudbedr", status: "error", detail: String(e) });
  }

  try {
    const ons = await fetchOnsCpi();
    if (ons) {
      const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const obs: MacroObservation[] = ons.months
        .map((m): MacroObservation | null => {
          const [y, mon] = m.date.split(" ");
          const idx = MONTHS.indexOf(mon);
          if (idx < 0) return null;
          return {
            source: "ONS",
            series_id: "D7G7",
            series_label: "CPI annual rate, all items",
            unit: "Per cent",
            frequency: "Monthly",
            obs_date: `${y}-${String(idx + 1).padStart(2, "0")}-01`,
            value: m.value,
          };
        })
        .filter((o): o is MacroObservation => o !== null);
      out.push(await ingestDrop(sb, "ONS", "d7g7", JSON.stringify(ons.months), { months: ons.months }, obs));
    }
  } catch (e) {
    out.push({ source: "ONS", tableCode: "d7g7", status: "error", detail: String(e) });
  }

  return out;
}

/** Best-effort persistence of the live FX + ABS CPI snapshots into the same
 *  tables (source 'FX' / 'ABS'), so they share one normalised store. */
async function ingestFxAbs(sb: SupabaseAdmin): Promise<SourceSummary[]> {
  const out: SourceSummary[] = [];

  try {
    const fx = await fetchFx();
    if (fx) {
      const obs: MacroObservation[] = (
        [
          ["AUDUSD", "AUD/USD spot", fx.audUsd],
          ["AUDEUR", "AUD/EUR spot", fx.audEur],
          ["AUDJPY", "AUD/JPY spot", fx.audJpy],
        ] as const
      )
        .filter(([, , v]) => Number.isFinite(v))
        .map(([id, label, v]) => ({
          source: "FX",
          series_id: id,
          series_label: label,
          unit: "rate",
          frequency: "Daily",
          obs_date: fx.asOf,
          value: v,
        }));
      out.push(await ingestDrop(sb, "FX", "frankfurter", JSON.stringify(fx), { fx }, obs));
    }
  } catch (e) {
    out.push({ source: "FX", tableCode: "frankfurter", status: "error", detail: String(e) });
  }

  try {
    const cpi = await fetchAbsCpi();
    if (cpi) {
      const asOf = new Date().toISOString().slice(0, 10);
      const obs: MacroObservation[] = [
        {
          source: "ABS",
          series_id: "CPI_YOY",
          series_label: "CPI; All groups; year-ended change",
          unit: "Per cent",
          frequency: "Quarterly",
          obs_date: asOf,
          value: cpi.yoyPct,
        },
      ];
      out.push(await ingestDrop(sb, "ABS", "cpi", JSON.stringify(cpi), cpi, obs));
    }
  } catch (e) {
    out.push({ source: "ABS", tableCode: "cpi", status: "error", detail: String(e) });
  }

  return out;
}

async function runIngestion() {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set on the server to ingest macro data.",
      },
      { status: 503 },
    );
  }
  const results = [...(await ingestRbaTables(sb)), ...(await ingestFxAbs(sb)), ...(await ingestUk(sb))];
  const ok = results.every((r) => r.status !== "error");
  return NextResponse.json({ ok, ranAt: new Date().toISOString(), results }, { status: ok ? 200 : 207 });
}

export async function GET() {
  return runIngestion();
}

export async function POST() {
  return runIngestion();
}
