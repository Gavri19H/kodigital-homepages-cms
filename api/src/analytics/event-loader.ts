// S3 -> ClickHouse event loader for the LeadGen and Listicles tracking streams.
//
// WHY THIS EXISTS: both products emit their tracking records to Firehose
// (analytics/leadgen-events.ts, analytics/listicle-events.ts), Firehose writes
// them to S3, and the ClickHouse raw tables every analytics view reads —
// lg_events_raw / lg_sessions / lst_events_raw / lst_sessions — were designed
// to be fed from there by an "external Athena->CH pipeline (data/ops)". That
// pipeline was never built, in this repo or anywhere else in the estate
// (measured 2026-09-27: 0 rows in all four tables, all nine
// leadgen_analytics_* and five listicle_analytics_* D1 mirrors empty). This
// module is that pipeline, run by the Worker's existing every-minute cron.
//
// WHY S3 AND NOT ATHENA: Athena is only a SQL view over the very same S3
// objects. Reading the objects directly needs no query engine, no result
// bucket and no polling, and each file is loaded exactly as the Worker wrote
// it. The Athena tables (infra/*/athena-ddl.sql) stay for ad-hoc analysis.
//
// HOW:
//   1. list the stream's objects for today and yesterday (UTC) — the prefixes
//      are dt=YYYY-MM-DD/hr=HH/, so a dt prefix lists one day;
//   2. drop the ones the D1 ledger (0059 analytics_event_files) already holds;
//   3. oldest first, up to MAX_FILES_PER_RUN: fetch, split by record_kind
//      (event -> *_events_raw, session -> *_sessions, dead_letter -> skipped,
//      exactly the split infra/*/clickhouse-ddl.sql documents), insert, then
//      record the file in the ledger.
//
// SAFE TO REPEAT: the raw tables are ReplacingMergeTree and every view reads
// them FINAL, so a file loaded twice (a crash between insert and ledger
// write, overlapping crons) collapses to the same rows. The ledger bounds the
// work; it is not what makes the numbers right.
//
// THE MAPPING follows the LIVE table schema (system.columns, read once per
// run), not a column list copied into this file: a column the table has is
// filled from the record field of the same name (or a documented rename),
// coerced to the column's type; a field the table lacks is simply not sent;
// a null/absent value is omitted so the column's own DEFAULT applies — but an
// EMPTY STRING is sent as "", never omitted: several columns have non-empty
// defaults (answer_source 'user_selected', bid_currency 'USD'), and
// lg_section_daily_mv counts answer_source='user_selected' over EVERY event
// that has a section, so letting a section_view's "" become the default would
// count each page view as a user answer. dt / ts are derived from the
// record's epoch-ms timestamp.
//
// Fail-open like every other cron task: absent AWS creds, bucket or CH creds
// is a silent no-op; any error is logged (never a credential) and contained,
// and the file is retried on the next run.

import { AwsClient } from "aws4fetch";
import type { Env } from "../env";

export const MAX_FILES_PER_RUN = 25;
const LEDGER_RETENTION_DAYS = 3;
const CH_TIMEOUT_MS = 20_000;

interface StreamSpec {
  stream: "leadgen" | "listicles";
  prefix: string;
  eventTable: string;
  sessionTable: string;
  // target column -> record field, where the producer named it differently.
  renames: Readonly<Record<string, string>>;
}

export const EVENT_STREAMS: ReadonlyArray<StreamSpec> = [
  { stream: "leadgen", prefix: "leadgen/events/", eventTable: "lg_events_raw", sessionTable: "lg_sessions", renames: {} },
  {
    stream: "listicles",
    prefix: "listicles/events/",
    eventTable: "lst_events_raw",
    sessionTable: "lst_sessions",
    // lst_events_raw stores the split as a UInt8; the listicle beacon sends
    // the percentage under its §16 name.
    renames: { article_split: "article_split_percentage", ab_split: "ab_split_percentage" },
  },
];

export interface LoaderStreamResult {
  stream: string;
  files_seen: number;
  files_loaded: number;
  files_pending: number;
  events_loaded: number;
  sessions_loaded: number;
  records_skipped: number;
  error?: string;
}

export interface LoaderResult {
  status: "noop" | "ran";
  streams: LoaderStreamResult[];
}

interface LoaderOpts {
  now?: number;
  fetchImpl?: typeof fetch;
  maxFilesPerRun?: number;
}

type ColumnTypes = Map<string, string>; // column name -> CH type

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function utcDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}
// Records carry epoch MILLISECONDS; tolerate seconds.
function epochMs(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function baseType(t: string): string {
  let b = t.trim();
  for (;;) {
    const m = /^(LowCardinality|Nullable)\((.*)\)$/.exec(b);
    if (m === null) return b;
    b = m[2] ?? "";
  }
}

// Coerce one record value to a column type. undefined = omit (DEFAULT applies).
export function coerceForColumn(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  const t = baseType(type);
  if (t === "String") {
    if (typeof v === "string") return v; // "" stays "" (see the header)
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    return undefined; // objects/arrays are never raw-table columns
  }
  const int = /^(U?)Int(8|16|32|64|128|256)$/.exec(t);
  if (int !== null) {
    let n: number;
    if (typeof v === "boolean") n = v ? 1 : 0;
    else if (typeof v === "number") n = v;
    else if (typeof v === "string" && v.trim() !== "") n = Number(v);
    else return undefined;
    if (!Number.isFinite(n)) return undefined;
    n = Math.round(n);
    if (int[1] === "U" && n < 0) return undefined;
    return n;
  }
  if (/^Float(32|64)$/.test(t) || /^Decimal/.test(t)) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  }
  if (t === "Bool") return typeof v === "boolean" ? v : undefined;
  // Date/DateTime are derived below, never copied; anything else is omitted.
  return undefined;
}

// One CH row from one record, shaped by the live columns.
export function mapRecordToRow(
  record: Record<string, unknown>,
  columns: ColumnTypes,
  renames: Readonly<Record<string, string>>,
  kind: "event" | "session",
): Record<string, unknown> | null {
  const identity = kind === "event" ? ["event_id", "event_type"] : ["session_id"];
  for (const f of identity) {
    if (typeof record[f] !== "string" || (record[f] as string) === "") return null;
  }
  const when =
    kind === "event"
      ? epochMs(record["timestamp"]) ?? epochMs(record["received_at"])
      : epochMs(record["first_seen"]) ?? epochMs(record["last_seen"]) ?? epochMs(record["received_at"]);
  if (when === null) return null;
  const row: Record<string, unknown> = {};
  for (const [col, type] of columns) {
    if (col === "ver" || col === "synced_at") continue; // the table's own now()
    if (col === "dt") { row.dt = utcDate(when); continue; }
    if (col === "ts") { row.ts = utcDateTime(when); continue; }
    const source = renames[col] ?? col;
    const value = coerceForColumn(type, record[source]);
    if (value !== undefined) row[col] = value;
  }
  return row;
}

async function chPost(env: Env, body: string, doFetch: typeof fetch): Promise<string> {
  const base = (env.CH_URL ?? "").replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CH_TIMEOUT_MS);
  try {
    const resp = await doFetch(`${base}/?date_time_input_format=best_effort`, {
      method: "POST",
      headers: {
        "X-ClickHouse-User": env.CH_USER ?? "",
        "X-ClickHouse-Key": env.CH_PASSWORD ?? "",
        "Content-Type": "text/plain; charset=utf-8",
      },
      body,
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      // CH's own error text names the table/column at fault; it never echoes
      // the credentials (they travel in headers, not the body).
      throw new Error(`clickhouse ${resp.status}: ${text.slice(0, 300)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function loadSchema(env: Env, tables: string[], doFetch: typeof fetch): Promise<Map<string, ColumnTypes>> {
  const list = tables.map((t) => `'${t.replace(/[^a-z0-9_]/g, "")}'`).join(",");
  const text = await chPost(
    env,
    `SELECT table, name, type FROM system.columns WHERE database = currentDatabase() AND table IN (${list}) ORDER BY table, position FORMAT JSONEachRow`,
    doFetch,
  );
  const out = new Map<string, ColumnTypes>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as { table: string; name: string; type: string };
    if (!out.has(r.table)) out.set(r.table, new Map());
    out.get(r.table)!.set(r.name, r.type);
  }
  return out;
}

function xmlDecode(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function s3Host(env: Env): string {
  const region = env.AWS_REGION ?? "us-east-1";
  return `https://${env.ANALYTICS_EVENTS_BUCKET}.s3.${region}.amazonaws.com`;
}

async function listKeys(aws: AwsClient, env: Env, prefix: string, doFetch: typeof fetch): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ "list-type": "2", prefix });
    if (token !== null) q.set("continuation-token", token);
    const req = await aws.sign(`${s3Host(env)}/?${q.toString()}`, { method: "GET" });
    const resp = await doFetch(req);
    const text = await resp.text();
    if (!resp.ok) throw new Error(`s3 list ${resp.status}: ${text.slice(0, 200)}`);
    for (const m of text.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlDecode(m[1] ?? ""));
    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(text);
    if (!/<IsTruncated>true<\/IsTruncated>/.test(text) || next === null) break;
    token = xmlDecode(next[1] ?? "");
  }
  return keys;
}

async function getObject(aws: AwsClient, env: Env, key: string, doFetch: typeof fetch): Promise<string> {
  const path = key.split("/").map(encodeURIComponent).join("/");
  const req = await aws.sign(`${s3Host(env)}/${path}`, { method: "GET" });
  const resp = await doFetch(req);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`s3 get ${resp.status}`);
  return text;
}

function dtOfKey(key: string): string {
  return /\/dt=(\d{4}-\d{2}-\d{2})\//.exec(key)?.[1] ?? "";
}

export async function runEventLoader(env: Env, opts?: LoaderOpts): Promise<LoaderResult> {
  if (
    (env.AWS_ACCESS_KEY_ID ?? "") === "" ||
    (env.AWS_SECRET_ACCESS_KEY ?? "") === "" ||
    (env.ANALYTICS_EVENTS_BUCKET ?? "") === "" ||
    (env.CH_URL ?? "").trim() === "" ||
    (env.CH_USER ?? "").trim() === "" ||
    (env.CH_PASSWORD ?? "").trim() === ""
  ) {
    return { status: "noop", streams: [] };
  }
  const now = opts?.now ?? Date.now();
  const doFetch = opts?.fetchImpl ?? fetch;
  const maxFiles = opts?.maxFilesPerRun ?? MAX_FILES_PER_RUN;
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
    region: env.AWS_REGION ?? "us-east-1",
    service: "s3",
  });
  const days = [utcDate(now - 86_400_000), utcDate(now)];

  let schema: Map<string, ColumnTypes>;
  try {
    schema = await loadSchema(env, EVENT_STREAMS.flatMap((s) => [s.eventTable, s.sessionTable]), doFetch);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ message: "analytics event loader", stage: "schema", error }));
    return { status: "ran", streams: EVENT_STREAMS.map((s) => ({ ...emptyResult(s.stream), error })) };
  }

  const results: LoaderStreamResult[] = [];
  for (const spec of EVENT_STREAMS) {
    results.push(await loadStream(env, spec, schema, aws, days, maxFiles, doFetch));
  }
  // Ledger rows older than the scan window are never consulted again.
  try {
    await env.DB.prepare("DELETE FROM analytics_event_files WHERE dt < ?")
      .bind(utcDate(now - LEDGER_RETENTION_DAYS * 86_400_000))
      .run();
  } catch {
    // bookkeeping only
  }
  return { status: "ran", streams: results };
}

function emptyResult(stream: string): LoaderStreamResult {
  return { stream, files_seen: 0, files_loaded: 0, files_pending: 0, events_loaded: 0, sessions_loaded: 0, records_skipped: 0 };
}

async function loadStream(
  env: Env,
  spec: StreamSpec,
  schema: Map<string, ColumnTypes>,
  aws: AwsClient,
  days: string[],
  maxFiles: number,
  doFetch: typeof fetch,
): Promise<LoaderStreamResult> {
  const r = emptyResult(spec.stream);
  const eventCols = schema.get(spec.eventTable);
  const sessionCols = schema.get(spec.sessionTable);
  try {
    if (eventCols === undefined || sessionCols === undefined) {
      throw new Error(`clickhouse tables missing or not readable: ${spec.eventTable}, ${spec.sessionTable}`);
    }
    const keys: string[] = [];
    for (const d of days) keys.push(...(await listKeys(aws, env, `${spec.prefix}dt=${d}/`, doFetch)));
    r.files_seen = keys.length;
    if (keys.length === 0) return r;

    const done = new Set<string>();
    const ledger = await env.DB.prepare(
      `SELECT object_key FROM analytics_event_files WHERE stream = ? AND dt IN (${days.map(() => "?").join(",")})`,
    )
      .bind(spec.stream, ...days)
      .all<{ object_key: string }>();
    for (const row of ledger.results ?? []) done.add(row.object_key);

    const pending = keys.filter((k) => !done.has(k)).sort();
    r.files_pending = pending.length;
    for (const key of pending.slice(0, maxFiles)) {
      const text = await getObject(aws, env, key, doFetch);
      const events: Record<string, unknown>[] = [];
      const sessions: Record<string, unknown>[] = [];
      let skipped = 0;
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        let rec: unknown;
        try {
          rec = JSON.parse(line);
        } catch {
          skipped++;
          continue;
        }
        if (rec === null || typeof rec !== "object" || Array.isArray(rec)) { skipped++; continue; }
        const record = rec as Record<string, unknown>;
        const kind = record["record_kind"];
        if (kind === "event") {
          const row = mapRecordToRow(record, eventCols, spec.renames, "event");
          if (row === null) skipped++; else events.push(row);
        } else if (kind === "session") {
          const row = mapRecordToRow(record, sessionCols, spec.renames, "session");
          if (row === null) skipped++; else sessions.push(row);
        } else {
          skipped++; // dead_letter audit copies stay in S3/Athena only
        }
      }
      if (events.length > 0) {
        await chPost(env, `INSERT INTO ${spec.eventTable} FORMAT JSONEachRow\n${events.map((e) => JSON.stringify(e)).join("\n")}`, doFetch);
      }
      if (sessions.length > 0) {
        await chPost(env, `INSERT INTO ${spec.sessionTable} FORMAT JSONEachRow\n${sessions.map((e) => JSON.stringify(e)).join("\n")}`, doFetch);
      }
      await env.DB.prepare(
        "INSERT INTO analytics_event_files (stream, object_key, dt, events_loaded, sessions_loaded, records_skipped) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(stream, object_key) DO NOTHING",
      )
        .bind(spec.stream, key, dtOfKey(key), events.length, sessions.length, skipped)
        .run();
      r.files_loaded++;
      r.files_pending--;
      r.events_loaded += events.length;
      r.sessions_loaded += sessions.length;
      r.records_skipped += skipped;
    }
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
  if (r.files_loaded > 0 || r.error !== undefined) {
    const line = JSON.stringify({ message: "analytics event loader", ...r });
    if (r.error !== undefined) console.error(line);
    else console.log(line);
  }
  return r;
}
