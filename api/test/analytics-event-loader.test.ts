// S3 -> ClickHouse event loader (src/analytics/event-loader.ts).
//
// Both sides of every boundary here are REAL artifacts, not hand-built:
//   * the input files are the two files Firehose actually wrote to S3 in
//     production on 2026-09-27 (a LeadGen funnel visit + a listicle visit,
//     tagged utm_source=qa_probe), with only ip/ua and the visitor's geo
//     replaced — test/fixtures/analytics-event-loader/*-real-file.ndjson;
//   * the target schema is the LIVE ClickHouse system.columns of the four raw
//     tables, captured the same day — live-ch-columns.json;
//   * the ledger is the real 0059 migration on node:sqlite.
// Only the network is simulated: S3 answers from those files, ClickHouse
// answers the schema query from the captured columns and records inserts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import { runEventLoader, coerceForColumn, chErrorSummary } from "../src/analytics/event-loader";

type SqliteDb = Record<string, unknown> & { prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } };
type DatabaseSyncCtor = new (path: string) => SqliteDb;
function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
    return typeof getBuiltin === "function" ? (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync : null;
  }
}
function d1(sdb: SqliteDb): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T>() { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() { sdb.prepare(sql).run(...binds); return { success: true, meta: {} }; },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

const DIR = dirname(fileURLToPath(import.meta.url));
const FIX = join(DIR, "fixtures/analytics-event-loader");
const LG_FILE = readFileSync(join(FIX, "lg-real-file.ndjson"), "utf8");
const LST_FILE = readFileSync(join(FIX, "lst-real-file.ndjson"), "utf8");
const LIVE_COLUMNS = JSON.parse(readFileSync(join(FIX, "live-ch-columns.json"), "utf8")) as Array<{ table: string; name: string; type: string }>;
const LG_KEY = "leadgen/events/dt=2026-09-27/hr=10/leadgen-events-1-2026-09-27-10-33-20-d865606a-ea07-405e-ac67-5a6047446568";
const LST_KEY = "listicles/events/dt=2026-09-27/hr=10/listicle-events-1-2026-09-27-10-50-05-5078b90b-98fa-40b5-a597-12398b30f1e0";
const BUCKET = "homepage-events-589426401114";
const NOW = Date.parse("2026-09-27T11:00:00Z");
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function columnsOf(table: string): Set<string> {
  return new Set(LIVE_COLUMNS.filter((c) => c.table === table).map((c) => c.name));
}

interface World {
  env: Env;
  sdb: SqliteDb;
  files: Map<string, string>; // S3 key -> body
  inserts: Array<{ table: string; rows: Record<string, unknown>[] }>;
  failInserts: boolean;
  chDown: boolean;
  pageSize: number;
  fetch: typeof fetch;
  calls: string[];
}

function world(opts: { chCreds?: boolean; bucket?: boolean; columns?: typeof LIVE_COLUMNS } = {}): World {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  (sdb["exec"] as (s: string) => void)(readFileSync(join(DIR, "../migrations/0059_analytics_event_file_ledger.sql"), "utf8"));
  const env = {
    DB: d1(sdb),
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "AKIATESTTESTTEST",
    AWS_SECRET_ACCESS_KEY: "test-secret",
    ...(opts.bucket === false ? {} : { ANALYTICS_EVENTS_BUCKET: BUCKET }),
    ...(opts.chCreds === false ? {} : { CH_URL: "https://ch.example.test:8443", CH_USER: "kodigital_cms_runtime", CH_PASSWORD: "pw" }),
  } as unknown as Env;
  const cols = opts.columns ?? LIVE_COLUMNS;
  const w: World = { env, sdb, files: new Map(), inserts: [], failInserts: false, chDown: false, pageSize: 1000, calls: [], fetch: undefined as unknown as typeof fetch };
  w.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    w.calls.push(`${req.method} ${url.host}${url.pathname}${url.search}`);
    if (url.host === `${BUCKET}.s3.us-east-1.amazonaws.com`) {
      expect(req.headers.get("authorization") ?? "").toMatch(/^AWS4-HMAC-SHA256 /); // really signed
      if (url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const all = [...w.files.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = Number(url.searchParams.get("continuation-token") ?? "0");
        const page = all.slice(start, start + w.pageSize);
        const more = start + w.pageSize < all.length;
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>${more}</IsTruncated>` +
          page.map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key><Size>1</Size></Contents>`).join("") +
          (more ? `<NextContinuationToken>${start + w.pageSize}</NextContinuationToken>` : "") +
          `</ListBucketResult>`;
        return new Response(xml, { status: 200 });
      }
      const key = decodeURIComponent(url.pathname.slice(1));
      const body = w.files.get(key);
      return body === undefined ? new Response("NoSuchKey", { status: 404 }) : new Response(body, { status: 200 });
    }
    if (url.host === "ch.example.test:8443") {
      expect(req.headers.get("X-ClickHouse-User")).toBe("kodigital_cms_runtime");
      const body = await req.text();
      if (body.startsWith("SELECT table, name, type FROM system.columns")) {
        return new Response(cols.map((c) => JSON.stringify(c)).join("\n") + "\n", { status: 200 });
      }
      const m = /^INSERT INTO (\w+) FORMAT JSONEachRow\n([\s\S]*)$/.exec(body);
      if (m !== null) {
        if (w.failInserts || w.chDown) return new Response("Code: 241. DB::Exception: Memory limit exceeded (MEMORY_LIMIT_EXCEEDED)", { status: 500 });
        const parsed = m[2]!.split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
        if (parsed.some((r) => r["event_id"] === "poison")) {
          // ClickHouse quotes the offending row back — with the visitor's data in it.
          return new Response(`Code: 27. DB::Exception: Cannot parse input: expected '"' before: ${m[2]!.slice(0, 80)} ip 203.0.113.9: (at row 1) (CANNOT_PARSE_INPUT_ASSERTION_FAILED) (version 26.4.1.2359 (official build))`, { status: 500 });
        }
        w.inserts.push({ table: m[1]!, rows: m[2]!.split("\n").map((l) => JSON.parse(l) as Record<string, unknown>) });
        return new Response("", { status: 200 });
      }
      return new Response("unexpected", { status: 400 });
    }
    throw new Error(`unexpected fetch ${req.url}`);
  }) as typeof fetch;
  return w;
}

function rowsFor(w: World, table: string): Record<string, unknown>[] {
  return w.inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
}
function ledger(w: World): Array<{ stream: string; object_key: string; dt: string; events_loaded: number; sessions_loaded: number; records_skipped: number }> {
  return w.sdb.prepare("SELECT stream, object_key, dt, events_loaded, sessions_loaded, records_skipped FROM analytics_event_files ORDER BY stream").all() as never;
}

afterEach(() => vi.restoreAllMocks());

describeDb("the real production files land in the right ClickHouse tables", () => {
  it("LeadGen: 2 events -> lg_events_raw, 1 session -> lg_sessions; listicles: 1 + 1; ledger records both files", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    w.files.set(LST_KEY, LST_FILE);
    const out = await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });

    expect(out.status).toBe("ran");
    expect(rowsFor(w, "lg_events_raw").map((r) => r["event_type"])).toEqual(["section_view", "quote_view"]);
    expect(rowsFor(w, "lg_sessions")).toHaveLength(1);
    expect(rowsFor(w, "lst_events_raw").map((r) => r["event_type"])).toEqual(["page_view"]);
    expect(rowsFor(w, "lst_sessions")).toHaveLength(1);
    expect(ledger(w)).toEqual([
      { stream: "leadgen", object_key: LG_KEY, dt: "2026-09-27", events_loaded: 2, sessions_loaded: 1, records_skipped: 0 },
      { stream: "listicles", object_key: LST_KEY, dt: "2026-09-27", events_loaded: 1, sessions_loaded: 1, records_skipped: 0 },
    ]);
  });

  it("every value is faithful to the record and typed for the live column", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    const ev = rowsFor(w, "lg_events_raw")[0]!;
    const rec = JSON.parse(LG_FILE.split("\n")[0]!) as Record<string, unknown>;
    expect(ev["event_id"]).toBe(rec["event_id"]);
    expect(ev["dt"]).toBe("2026-09-27");
    expect(ev["ts"]).toBe(new Date(rec["timestamp"] as number).toISOString().slice(0, 19).replace("T", " "));
    expect(ev["funnel_id"]).toBe("lgf_01KZX86X7XAC5A6C8B0EA20XXS");
    expect(ev["section_mapping_version"]).toBe(15);
    expect(ev["is_bot"]).toBe(0); // boolean -> UInt8
    expect(ev["continued_to_next_section"]).toBe(0);
    expect(ev["traffic_quality_flag"]).toBe("clean");
    // null / unparseable numbers are OMITTED so the column DEFAULT applies
    expect(ev).not.toHaveProperty("carrier_position");
    expect(ev).not.toHaveProperty("bid_value");
    expect(ev).not.toHaveProperty("assignment_bucket"); // "" into UInt16
    expect(ev).not.toHaveProperty("ver"); // the table's own now()
  });

  it("FOUND DURING BUILD: an empty answer_source loads as '' — never the column default 'user_selected' (lg_section_daily counts it over every event with a section)", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    for (const ev of rowsFor(w, "lg_events_raw")) {
      expect(ev["answer_source"]).toBe("");
      expect(ev["bid_currency"]).toBe(""); // not the 'USD' default either
    }
  });

  it("nothing is sent that the live table does not have (quote_name, answer_value_raw, ip, ua, city…)", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    w.files.set(LST_KEY, LST_FILE);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    for (const { table, rows } of w.inserts) {
      const cols = columnsOf(table);
      for (const row of rows) for (const k of Object.keys(row)) expect(cols.has(k), `${table}.${k}`).toBe(true);
    }
    expect(rowsFor(w, "lg_events_raw")[0]).not.toHaveProperty("answer_value_raw");
    expect(rowsFor(w, "lg_events_raw")[0]).not.toHaveProperty("ip");
  });

  it("sessions: dt from first_seen; a blank cpc is not forced into the Float column", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    const s = rowsFor(w, "lg_sessions")[0]!;
    expect(s["session_id"]).toBe("dabe3b70-64e4-4944-a463-73af90b106b7");
    expect(s["dt"]).toBe("2026-09-27");
    expect(s).not.toHaveProperty("cpc");
    expect(s["landing_url"]).toContain("moneylantern.com/lg/business-loans");
  });

  it("listicles: the split percentage lands in the renamed UInt8 column", async () => {
    const w = world();
    const lines = LST_FILE.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    lines[0]!["article_split_percentage"] = 50;
    w.files.set(LST_KEY, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    const ev = rowsFor(w, "lst_events_raw")[0]!;
    expect(ev["article_split"]).toBe(50);
    expect(ev["article_version_revision"]).toBe(4);
    expect(ev["site_id"]).toBe("st_9d91f95c66ed4df1");
  });
});

describeDb("each file once; failures retried; bounded work", () => {
  it("a second run fetches no file and inserts nothing", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    const before = w.inserts.length;
    w.calls.length = 0;
    await runEventLoader(w.env, { now: NOW + 60_000, fetchImpl: w.fetch });
    expect(w.inserts.length).toBe(before);
    const downloads = w.calls.filter((c) => c.startsWith(`GET ${BUCKET}.s3`) && !c.includes("list-type=2"));
    expect(downloads).toEqual([]);
    expect(w.calls.some((c) => c.includes("list-type=2"))).toBe(true); // it did look
  });

  it("a ClickHouse failure records nothing, so the next run loads the same file", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    w.failInserts = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(first.streams.find((s) => s.stream === "leadgen")?.error).toMatch(/clickhouse 500/);
    expect(ledger(w)).toHaveLength(0);
    w.failInserts = false;
    await runEventLoader(w.env, { now: NOW + 60_000, fetchImpl: w.fetch });
    expect(rowsFor(w, "lg_events_raw")).toHaveLength(2);
    expect(ledger(w)).toHaveLength(1);
  });

  it("a file that arrives later is picked up; yesterday's files are in the window too", async () => {
    const w = world();
    const yesterday = "leadgen/events/dt=2026-09-26/hr=23/leadgen-events-1-2026-09-26-23-59-01-aaaa";
    w.files.set(yesterday, LG_FILE);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(ledger(w).map((l) => l.dt)).toEqual(["2026-09-26"]);
    w.files.set(LG_KEY, LG_FILE);
    await runEventLoader(w.env, { now: NOW + 60_000, fetchImpl: w.fetch });
    expect(ledger(w).map((l) => l.object_key).sort()).toEqual([yesterday, LG_KEY].sort());
  });

  it("at most maxFilesPerRun files per run, oldest first; the rest next run", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.files.set(`leadgen/events/dt=2026-09-27/hr=10/leadgen-events-1-2026-09-27-10-0${i}-00-x`, LG_FILE);
    const r1 = await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch, maxFilesPerRun: 2 });
    expect(r1.streams.find((s) => s.stream === "leadgen")).toMatchObject({ files_loaded: 2, files_pending: 3 });
    expect(ledger(w).map((l) => l.object_key)).toEqual([
      "leadgen/events/dt=2026-09-27/hr=10/leadgen-events-1-2026-09-27-10-00-00-x",
      "leadgen/events/dt=2026-09-27/hr=10/leadgen-events-1-2026-09-27-10-01-00-x",
    ]);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch, maxFilesPerRun: 10 });
    expect(ledger(w)).toHaveLength(5);
  });

  it("REVIEW M1: a week of files is in the window (a late deploy strands nothing); older ones need a deliberate backfill", async () => {
    const w = world();
    const fiveDaysOld = "leadgen/events/dt=2026-09-22/hr=09/leadgen-events-1-2026-09-22-09-00-00-old";
    const nineDaysOld = "leadgen/events/dt=2026-09-18/hr=09/leadgen-events-1-2026-09-18-09-00-00-older";
    w.files.set(fiveDaysOld, LG_FILE);
    w.files.set(nineDaysOld, LG_FILE);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(ledger(w).map((l) => l.object_key)).toEqual([fiveDaysOld]);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch, lookbackDays: 14 });
    expect(ledger(w).map((l) => l.object_key).sort()).toEqual([nineDaysOld, fiveDaysOld].sort());
  });

  it("follows S3 list pagination", async () => {
    const w = world();
    w.pageSize = 2;
    for (let i = 0; i < 5; i++) w.files.set(`leadgen/events/dt=2026-09-27/hr=11/leadgen-events-1-2026-09-27-11-0${i}-00-y`, LG_FILE);
    const r = await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(r.streams.find((s) => s.stream === "leadgen")?.files_seen).toBe(5);
    expect(ledger(w)).toHaveLength(5);
  });

  it("malformed lines and dead_letter audit copies are skipped and counted; the rest still loads", async () => {
    const w = world();
    const dead = JSON.stringify({ record_kind: "dead_letter", event_id: "x", reason: "oversize", payload_json: "{}", received_at: 1790505199792 });
    w.files.set(LG_KEY, `${LG_FILE}{not json\n${dead}\n`);
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(rowsFor(w, "lg_events_raw")).toHaveLength(2);
    expect(ledger(w)[0]).toMatchObject({ events_loaded: 2, sessions_loaded: 1, records_skipped: 2 });
  });
});

describeDb("REVIEW M2: one bad row cannot stall a stream", () => {
  it("ClickHouse refuses a row: the batch is bisected, that row is dropped and counted, the rest loads, and the files behind it keep flowing", async () => {
    const w = world();
    const lines = LG_FILE.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    lines[0]!["event_id"] = "poison";
    const bad = "leadgen/events/dt=2026-09-27/hr=10/leadgen-events-1-2026-09-27-10-00-00-bad";
    const good = "leadgen/events/dt=2026-09-27/hr=10/leadgen-events-1-2026-09-27-10-05-00-good";
    w.files.set(bad, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    w.files.set(good, LG_FILE);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    const lg = r.streams.find((s) => s.stream === "leadgen")!;
    expect(lg.error).toBeUndefined();
    expect(ledger(w).filter((l) => l.stream === "leadgen")).toEqual([
      { stream: "leadgen", object_key: bad, dt: "2026-09-27", events_loaded: 1, sessions_loaded: 1, records_skipped: 1 },
      { stream: "leadgen", object_key: good, dt: "2026-09-27", events_loaded: 2, sessions_loaded: 1, records_skipped: 0 },
    ]);
    expect(rowsFor(w, "lg_events_raw").map((e) => e["event_id"])).not.toContain("poison");
    const logged = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"event_id":"poison"');
    expect(logged).toContain("CANNOT_PARSE_INPUT_ASSERTION_FAILED");
    expect(logged).not.toContain("203.0.113.9"); // the row ClickHouse quoted back is never logged
  });

  it("ClickHouse UP but refusing for a non-data reason (access revoked, code 497): every row is kept — the stream stops and retries", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    const real = w.fetch;
    let denied = true;
    w.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      if (denied && req.url.startsWith("https://ch.example.test")) {
        const body = await req.clone().text();
        if (body.startsWith("INSERT")) return new Response("Code: 497. DB::Exception: kodigital_cms_runtime: Not enough privileges (ACCESS_DENIED)", { status: 500 });
      }
      return real(req);
    }) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(r.streams.find((s) => s.stream === "leadgen")?.error).toMatch(/code 497 ACCESS_DENIED/);
    expect(ledger(w)).toHaveLength(0); // nothing recorded, nothing dropped
    denied = false;
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(ledger(w)[0]).toMatchObject({ events_loaded: 2, sessions_loaded: 1, records_skipped: 0 });
  });

  it("ClickHouse down: nothing is dropped, nothing is recorded, the same file loads once it is back", async () => {
    const w = world();
    w.files.set(LG_KEY, LG_FILE);
    w.chDown = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(r.streams.find((s) => s.stream === "leadgen")?.error).toMatch(/clickhouse 500 code 241/);
    expect(ledger(w)).toHaveLength(0);
    w.chDown = false;
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(ledger(w)[0]).toMatchObject({ events_loaded: 2, records_skipped: 0 });
  });

  it("the reviewer's trigger — a beacon number no integer column can hold — never reaches ClickHouse", async () => {
    const w = world();
    const lines = LST_FILE.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    lines[0]!["page_index"] = 1e21;
    lines[0]!["link_position_index"] = 70000; // > UInt16
    w.files.set(LST_KEY, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    const ev = rowsFor(w, "lst_events_raw")[0]!;
    expect(ev).not.toHaveProperty("page_index");
    expect(ev).not.toHaveProperty("link_position_index");
    expect(ledger(w)[0]).toMatchObject({ events_loaded: 1, records_skipped: 0 });
  });
});

describeDb("fail-open", () => {
  it("REVIEW m3: configured bucket but no ClickHouse login — says so once an hour (names only), never silent", async () => {
    const w = world({ chCreds: false });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runEventLoader(w.env, { now: Date.parse("2026-09-27T11:05:00Z"), fetchImpl: w.fetch });
    expect(log).not.toHaveBeenCalled();
    await runEventLoader(w.env, { now: Date.parse("2026-09-27T12:00:00Z"), fetchImpl: w.fetch });
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual([
      JSON.stringify({ message: "analytics event loader disabled", missing: ["CH_URL", "CH_USER", "CH_PASSWORD"] }),
    ]);
  });

  it("no ClickHouse login or no bucket: no network at all", async () => {
    for (const w of [world({ chCreds: false }), world({ bucket: false })]) {
      w.files.set(LG_KEY, LG_FILE);
      expect(await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch })).toEqual({ status: "noop", streams: [] });
      expect(w.calls).toHaveLength(0);
    }
  });

  it("the ClickHouse tables are missing: logged, nothing loaded, nothing recorded", async () => {
    const w = world({ columns: [] });
    w.files.set(LG_KEY, LG_FILE);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await runEventLoader(w.env, { now: NOW, fetchImpl: w.fetch });
    expect(r.streams.every((s) => /tables missing/.test(s.error ?? ""))).toBe(true);
    expect(w.inserts).toHaveLength(0);
    expect(ledger(w)).toHaveLength(0);
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("pw");
  });
});

describe("coerceForColumn", () => {
  it("types values for ClickHouse columns", () => {
    expect(coerceForColumn("LowCardinality(String)", "")).toBe("");
    expect(coerceForColumn("String", 12)).toBe("12");
    expect(coerceForColumn("UInt8", true)).toBe(1);
    expect(coerceForColumn("UInt16", "7")).toBe(7);
    expect(coerceForColumn("UInt16", "")).toBeUndefined();
    expect(coerceForColumn("UInt32", -1)).toBeUndefined();
    expect(coerceForColumn("Float64", "2.5")).toBe(2.5);
    expect(coerceForColumn("Float64", "")).toBeUndefined();
    expect(coerceForColumn("String", null)).toBeUndefined();
    expect(coerceForColumn("String", { a: 1 })).toBeUndefined();
  });

  it("REVIEW M2: integers outside the column's range are omitted — never sent in exponent form", () => {
    expect(coerceForColumn("UInt16", 1e21)).toBeUndefined();
    expect(coerceForColumn("UInt8", 256)).toBeUndefined();
    expect(coerceForColumn("UInt8", 255)).toBe(255);
    expect(coerceForColumn("UInt16", 65535)).toBe(65535);
    expect(coerceForColumn("UInt32", 2 ** 32)).toBeUndefined();
    expect(coerceForColumn("UInt64", 2 ** 60)).toBeUndefined();
    expect(coerceForColumn("UInt64", 1790505199792)).toBe(1790505199792);
    expect(coerceForColumn("Int8", -129)).toBeUndefined();
    expect(coerceForColumn("Int8", -128)).toBe(-128);
  });

  it("REVIEW m4: ClickHouse errors are logged as code + name only", () => {
    expect(
      chErrorSummary(500, "Code: 27. DB::Exception: Cannot parse input: row {\"ip\":\"203.0.113.9\"} (CANNOT_PARSE_INPUT_ASSERTION_FAILED) (version 26.4.1.2359 (official build))"),
    ).toBe("clickhouse 500 code 27 CANNOT_PARSE_INPUT_ASSERTION_FAILED");
    expect(chErrorSummary(502, "Bad gateway")).toBe("clickhouse 502");
  });
});
