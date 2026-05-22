import { describe, it, expect } from "vitest";
import {
  executeWithMetrics,
  queryWithMetrics,
  extractMetrics,
  type D1QueryMetrics,
  type D1QueryResult,
} from "../src/db/query";

interface RecordedCall {
  sql: string;
  bindArgs: unknown[];
}

function makeFakeDb(planted: {
  results?: unknown[];
  meta?: Partial<D1Meta>;
}): { db: D1Database; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      const call: RecordedCall = { sql, bindArgs: [] };
      calls.push(call);
      const stmt = {
        bind(...args: unknown[]) {
          call.bindArgs = args;
          return stmt;
        },
        async all<T = unknown>() {
          return {
            results: (planted.results ?? []) as T[],
            success: true,
            meta: (planted.meta ?? {}) as D1Meta,
          };
        },
        async first<T = unknown>(): Promise<T | null> {
          const rows = planted.results ?? [];
          return ((rows[0] ?? null) as T | null);
        },
        async run() {
          return { success: true, meta: (planted.meta ?? {}) as D1Meta };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe("extractMetrics", () => {
  it("returns zeros for missing meta (undefined / null / empty)", () => {
    expect(extractMetrics(undefined)).toEqual({ rows_read: 0, rows_written: 0, duration: 0 });
    expect(extractMetrics(null)).toEqual({ rows_read: 0, rows_written: 0, duration: 0 });
    expect(extractMetrics({} as unknown as D1Meta)).toEqual({
      rows_read: 0,
      rows_written: 0,
      duration: 0,
    });
  });

  it("projects rows_read / rows_written / duration verbatim", () => {
    const m: D1QueryMetrics = extractMetrics({
      rows_read: 12,
      rows_written: 3,
      duration: 4.5,
      size_after: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 0,
    } as D1Meta);
    expect(m.rows_read).toBe(12);
    expect(m.rows_written).toBe(3);
    expect(m.duration).toBe(4.5);
  });

  it("includes served_by_region when present, omits when empty-string", () => {
    const present = extractMetrics({
      rows_read: 1,
      rows_written: 0,
      duration: 0.1,
      served_by_region: "wnam",
      size_after: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 0,
    } as D1Meta);
    expect(present.served_by_region).toBe("wnam");

    const empty = extractMetrics({
      rows_read: 1,
      rows_written: 0,
      duration: 0.1,
      served_by_region: "",
      size_after: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 0,
    } as D1Meta);
    expect(empty.served_by_region).toBeUndefined();
  });

  it("coerces non-number meta fields to 0 (defensive)", () => {
    const m = extractMetrics({
      rows_read: undefined as unknown as number,
      rows_written: null as unknown as number,
      duration: "fast" as unknown as number,
    } as D1Meta);
    expect(m).toEqual({ rows_read: 0, rows_written: 0, duration: 0 });
  });
});

describe("executeWithMetrics", () => {
  it("returns results + projected meta from D1PreparedStatement.all()", async () => {
    const { db } = makeFakeDb({
      results: [{ id: 1 }, { id: 2 }],
      meta: {
        rows_read: 2,
        rows_written: 0,
        duration: 1.25,
        served_by_region: "enam",
      } as D1Meta,
    });
    const stmt = db.prepare("SELECT id FROM articles").bind();
    const result: D1QueryResult<{ id: number }> = await executeWithMetrics<{ id: number }>(stmt);
    expect(result.results).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.meta.rows_read).toBe(2);
    expect(result.meta.rows_written).toBe(0);
    expect(result.meta.duration).toBe(1.25);
    expect(result.meta.served_by_region).toBe("enam");
  });

  it("returns empty results array when D1 returns nothing", async () => {
    const { db } = makeFakeDb({ results: [], meta: { rows_read: 0 } as D1Meta });
    const stmt = db.prepare("SELECT * FROM articles WHERE 1=0").bind();
    const result = await executeWithMetrics(stmt);
    expect(result.results).toEqual([]);
    expect(result.meta.rows_read).toBe(0);
  });

  it("survives missing meta gracefully (zeros)", async () => {
    const { db } = makeFakeDb({ results: [{ id: 9 }] });
    const stmt = db.prepare("SELECT id FROM articles").bind();
    const result = await executeWithMetrics<{ id: number }>(stmt);
    expect(result.results).toEqual([{ id: 9 }]);
    expect(result.meta).toEqual({ rows_read: 0, rows_written: 0, duration: 0 });
  });
});

describe("queryWithMetrics", () => {
  it("routes through prepare(SQL).bind(...args) — no string interpolation", async () => {
    const { db, calls } = makeFakeDb({
      results: [{ slug: "foo" }],
      meta: { rows_read: 1, duration: 0.2 } as D1Meta,
    });
    const result = await queryWithMetrics<{ slug: string }>(
      db,
      "SELECT slug FROM articles WHERE site_id = ? AND status = ? LIMIT ?",
      "st_demo",
      "published",
      10,
    );
    expect(calls).toHaveLength(1);
    const recorded = calls[0]!;
    expect(recorded.sql).toBe(
      "SELECT slug FROM articles WHERE site_id = ? AND status = ? LIMIT ?",
    );
    expect(recorded.bindArgs).toEqual(["st_demo", "published", 10]);
    expect(result.results).toEqual([{ slug: "foo" }]);
    expect(result.meta.rows_read).toBe(1);
    expect(result.meta.duration).toBe(0.2);
  });

  it("propagates served_by_region from meta block", async () => {
    const { db } = makeFakeDb({
      results: [],
      meta: { rows_read: 5, duration: 0.4, served_by_region: "weur" } as D1Meta,
    });
    const result = await queryWithMetrics(db, "SELECT 1");
    expect(result.meta.served_by_region).toBe("weur");
  });

  it("accepts zero bind args", async () => {
    const { db, calls } = makeFakeDb({ results: [], meta: { rows_read: 0 } as D1Meta });
    await queryWithMetrics(db, "SELECT COUNT(*) FROM sites");
    expect(calls[0]!.bindArgs).toEqual([]);
  });
});
