// RBA statistical-table ingestion helpers: fetch a CSV, parse it (RBA CSVs are
// a block of metadata header rows — Title / Description / Frequency / Type /
// Units / Source / Publication date / Series ID — followed by a date/value
// matrix), and normalise into flat (series, date, value) observations.
//
// Pure parsing/normalisation only — no Supabase or fetch side-effects beyond
// fetchRbaCsv, so the normaliser is unit-testable against a CSV string.

export interface RbaTableSpec {
  source: "RBA";
  /** Table code as it appears in the CSV filename, e.g. "f1.1", "g1". */
  tableCode: string;
  /** Series IDs to normalise. Empty object => keep every series in the table. */
  series: Record<string, true>;
}

export interface MacroObservation {
  source: string;
  series_id: string;
  series_label: string | null;
  unit: string | null;
  frequency: string | null;
  /** ISO yyyy-mm-dd. */
  obs_date: string;
  value: number | null;
}

// RBA tables we ingest. f1.1 carries the cash-rate target; g1 carries CPI
// (headline index, year-ended headline inflation, and trimmed-mean inflation).
export const RBA_TABLES: RbaTableSpec[] = [
  { source: "RBA", tableCode: "f1.1", series: { FIRMMCRT: true, FIRMMCRI: true } },
  { source: "RBA", tableCode: "g1", series: { GCPIAG: true, GCPIAGYP: true, GCPIOCPMTMYP: true } },
];

const RBA_CSV_BASE = "https://www.rba.gov.au/statistics/tables/csv";

export function rbaCsvUrl(tableCode: string): string {
  return `${RBA_CSV_BASE}/${tableCode}-data.csv`;
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas and
 *  escaped double-quotes. Returns rows of string cells. */
export function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM if present.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Collapse \r\n into a single row break; ignore lone \r before \n.
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Trailing field/row (file may not end with a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER_LABELS = new Set([
  "title",
  "description",
  "frequency",
  "type",
  "units",
  "source",
  "publication date",
  "series id",
]);

/** dd/mm/yyyy (RBA's date format) -> ISO yyyy-mm-dd, or null if not a date. */
export function rbaDateToIso(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Normalise a parsed RBA table into observations. Header rows populate the
 * per-column series metadata; the Series ID row keys each column to its series;
 * subsequent date rows yield one observation per (series, date) with a value.
 */
export function normaliseRbaTable(rows: string[][], spec: RbaTableSpec): MacroObservation[] {
  const meta: { title?: string[]; units?: string[]; frequency?: string[]; seriesId?: string[] } = {};
  let dataStart = -1;
  for (let r = 0; r < rows.length; r++) {
    const first = (rows[r][0] ?? "").trim().toLowerCase();
    if (HEADER_LABELS.has(first)) {
      if (first === "title") meta.title = rows[r];
      else if (first === "units") meta.units = rows[r];
      else if (first === "frequency") meta.frequency = rows[r];
      else if (first === "series id") {
        meta.seriesId = rows[r];
        dataStart = r + 1;
      }
      continue;
    }
  }
  if (!meta.seriesId || dataStart < 0) return [];

  const whitelistAll = Object.keys(spec.series).length === 0;
  // Build the set of column indices to keep (skip column 0 = the date column).
  const cols: number[] = [];
  for (let c = 1; c < meta.seriesId.length; c++) {
    const id = (meta.seriesId[c] ?? "").trim();
    if (!id) continue;
    if (whitelistAll || spec.series[id]) cols.push(c);
  }

  const out: MacroObservation[] = [];
  for (let r = dataStart; r < rows.length; r++) {
    const iso = rbaDateToIso(rows[r][0] ?? "");
    if (!iso) continue;
    for (const c of cols) {
      const cell = (rows[r][c] ?? "").trim();
      if (cell === "") continue;
      const value = Number(cell);
      if (!Number.isFinite(value)) continue;
      out.push({
        source: spec.source,
        series_id: (meta.seriesId[c] ?? "").trim(),
        series_label: meta.title?.[c]?.trim() || null,
        unit: meta.units?.[c]?.trim() || null,
        frequency: meta.frequency?.[c]?.trim() || null,
        obs_date: iso,
        value,
      });
    }
  }
  return out;
}

/** Fetch a raw RBA CSV. Throws on non-2xx so the caller can record the error. */
export async function fetchRbaCsv(tableCode: string): Promise<string> {
  const res = await fetch(rbaCsvUrl(tableCode), {
    // RBA tables update at most daily; cache aggressively.
    next: { revalidate: 86400 },
    headers: { Accept: "text/csv,*/*" },
  });
  if (!res.ok) throw new Error(`RBA ${tableCode} fetch failed: HTTP ${res.status}`);
  return res.text();
}
