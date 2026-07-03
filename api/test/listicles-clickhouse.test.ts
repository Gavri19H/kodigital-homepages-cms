// Listicles ClickHouse HTTP client (§17/§18): query shaping (FINAL-aware,
// JSONEachRow, param substitution, settings + X-ClickHouse-* headers),
// structured no-op on missing creds (NO network), and error isolation
// (HTTP 5xx / 401 / network → typed ListicleChError; never a silent swallow).

import { describe, expect, it, vi } from "vitest";
import {
  createListicleChClient,
  chCredentialsConfigured,
  ListicleChError,
} from "../src/listicles/clickhouse";

const CREDS = { CH_URL: "https://ch.example.com:8443", CH_USER: "default", CH_PASSWORD: "secret" };

function jsonEachRow(...objs: unknown[]): string {
  return objs.map((o) => JSON.stringify(o)).join("\n");
}

describe("chCredentialsConfigured", () => {
  it("requires all three non-empty secrets", () => {
    expect(chCredentialsConfigured(CREDS)).toBe(true);
    expect(chCredentialsConfigured({})).toBe(false);
    expect(chCredentialsConfigured({ CH_URL: "x", CH_USER: "y" })).toBe(false);
    expect(chCredentialsConfigured({ ...CREDS, CH_PASSWORD: "  " })).toBe(false);
  });
});

describe("no-op on missing creds", () => {
  it("makes NO HTTP request and returns configured:false + empty rows", async () => {
    const fetchImpl = vi.fn();
    const client = createListicleChClient({}, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(client.configured).toBe(false);
    const res = await client.query("SELECT 1 FROM lst_offer_daily FINAL");
    expect(res).toEqual({ rows: [], configured: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("query shaping", () => {
  it("appends FORMAT JSONEachRow, sets FINAL-aware settings + unquoted 64-bit ints, sends X-ClickHouse-* headers, substitutes params", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(jsonEachRow({ offer_id: "off_1", impressions: 5 }), { status: 200 });
    });
    const client = createListicleChClient(CREDS, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await client.query<{ offer_id: string; impressions: number }>(
      "SELECT offer_id, impressions FROM lst_offer_daily FINAL WHERE dt BETWEEN toDate({from}) AND toDate({to});",
      { from: "2026-07-02", to: "2026-07-03" },
    );

    expect(res.configured).toBe(true);
    expect(res.rows).toEqual([{ offer_id: "off_1", impressions: 5 }]);

    // settings on the query string
    expect(capturedUrl).toContain("do_not_merge_across_partitions_select_final=1");
    expect(capturedUrl).toContain("output_format_json_quote_64bit_integers=0");

    const body = String(capturedInit?.body);
    expect(body.endsWith("FORMAT JSONEachRow")).toBe(true);
    // trailing ";" stripped before FORMAT is appended
    expect(body).not.toContain("; FORMAT");
    // params substituted (quoted strings)
    expect(body).toContain("toDate('2026-07-02')");
    expect(body).toContain("toDate('2026-07-03')");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-ClickHouse-User"]).toBe("default");
    expect(headers["X-ClickHouse-Key"]).toBe("secret");
  });

  it("parses multi-row JSONEachRow and tolerates blank trailing lines", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(jsonEachRow({ n: 1 }, { n: 2 }, { n: 3 }) + "\n", { status: 200 }),
    );
    const client = createListicleChClient(CREDS, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await client.query<{ n: number }>("SELECT n FROM t");
    expect(res.rows.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it("empty body → empty rows (configured:true)", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const client = createListicleChClient(CREDS, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await client.query("SELECT 1 FROM t");
    expect(res).toEqual({ rows: [], configured: true });
  });
});

describe("error isolation", () => {
  it("HTTP 500 → ListicleChError with status", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    const client = createListicleChClient(CREDS, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.query("SELECT 1 FROM t")).rejects.toBeInstanceOf(ListicleChError);
    await expect(client.query("SELECT 1 FROM t")).rejects.toMatchObject({ statusCode: 500 });
  });

  it("HTTP 403 → auth-flavored ListicleChError", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    const client = createListicleChClient(CREDS, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.query("SELECT 1 FROM t")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("network/timeout throw → ListicleChError status 0", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("The operation was aborted");
    });
    const client = createListicleChClient(CREDS, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.query("SELECT 1 FROM t")).rejects.toMatchObject({
      name: "ListicleChError",
      statusCode: 0,
    });
  });
});
