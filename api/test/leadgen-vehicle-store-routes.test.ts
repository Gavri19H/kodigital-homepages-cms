import { beforeEach, describe, expect, it } from "vitest";
import media from "../src/media";
import { vehiclesPublicRouter } from "../src/public/vehicles/routes";
import {
  findVehicleLogoUrls,
  loadVehicleRenderData,
  readLiveSnapshotId,
  readMakeFile,
  resetVehicleStoreMemo,
} from "../src/leadgen/vehicles/store";
import { parseMakeIdParam, isSnapshotId, slugifyMakeName, modelsForYear, parseMakeFile } from "../src/leadgen/vehicles/format";
import { readVehicleSource, isVehicleIdShaped, parseFeaturedMakes } from "../src/leadgen/vehicles/props";

// F18 (plan Section 3 parts C–D, checks AC7 / AC8): the ready-made vehicle
// files in R2, the shared reader, and the two public lookups.

const SNAP = "2026-11-23";

const MAKES = {
  snapshot: SNAP,
  makes: [
    { make_id: 475, name: "Acura", slug: "acura" },
    { make_id: 460, name: "Ford", slug: "ford" },
    { make_id: 448, name: "Toyota", slug: "toyota" },
  ],
};

const TOYOTA = {
  snapshot: SNAP,
  make_id: 448,
  models: [
    { model_id: "m_0000000001", name: "4Runner" },
    { model_id: "m_0000000002", name: "bZ4X" },
    { model_id: "m_0000000003", name: "Corolla" },
  ],
  years: [
    { year: 2027, m: [0, 2] },
    { year: 2023, m: [0, 1, 2] },
  ],
};

function fakeBucket(files: Record<string, string>) {
  const gets: string[] = [];
  const bucket = {
    gets,
    async get(key: string) {
      gets.push(key);
      const text = files[key];
      if (text === undefined) return null;
      return {
        httpEtag: `"etag-${key.length}"`,
        body: text,
        async text() {
          return text;
        },
      };
    },
  };
  return bucket;
}

function filesFor(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "vehicles/live.json": JSON.stringify({ snapshot: SNAP }),
    [`vehicles/${SNAP}/makes.json`]: JSON.stringify(MAKES),
    [`vehicles/${SNAP}/makes/448.json`]: JSON.stringify(TOYOTA),
    ...extra,
  };
}

function fakeDb(rows: { filename: string; storage_key: string }[]) {
  const sqls: string[] = [];
  return {
    sqls,
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          binds = args;
          return stmt;
        },
        async all<T>() {
          sqls.push(sql);
          return { results: rows.filter((r) => binds.includes(r.filename)) as unknown as T[] };
        },
      };
      return stmt;
    },
  };
}

function env(files: Record<string, string>, logoRows: { filename: string; storage_key: string }[] = []) {
  return { MEDIA: fakeBucket(files), DB: fakeDb(logoRows) } as unknown as {
    MEDIA: R2Bucket & { gets: string[] };
    DB: D1Database & { sqls: string[] };
  };
}

beforeEach(() => resetVehicleStoreMemo());

describe("F18 vehicle format helpers", () => {
  it("parses make_id path parameters as positive whole numbers only", () => {
    expect(parseMakeIdParam("448")).toBe(448);
    expect(parseMakeIdParam("0")).toBeNull();
    expect(parseMakeIdParam("-1")).toBeNull();
    expect(parseMakeIdParam("4.5")).toBeNull();
    expect(parseMakeIdParam("abc")).toBeNull();
    expect(parseMakeIdParam("0448")).toBeNull();
  });

  it("accepts dated snapshot ids only", () => {
    expect(isSnapshotId("2026-11-23")).toBe(true);
    expect(isSnapshotId("2026-11-23-b")).toBe(true);
    expect(isSnapshotId("../etc")).toBe(false);
    expect(isSnapshotId("latest")).toBe(false);
  });

  it("slugs make names", () => {
    expect(slugifyMakeName("Mercedes-Benz")).toBe("mercedes-benz");
    expect(slugifyMakeName("Land Rover")).toBe("land-rover");
    expect(slugifyMakeName("Citroën")).toBe("citroen");
  });

  it("reads a make file and lists a year's models; a damaged file reads as null", () => {
    const f = parseMakeFile(TOYOTA);
    expect(f).not.toBeNull();
    expect(modelsForYear(f!, 2023).map((m) => m.name)).toEqual(["4Runner", "bZ4X", "Corolla"]);
    expect(modelsForYear(f!, 1999)).toEqual([]);
    expect(parseMakeFile({ ...TOYOTA, years: [{ year: 2023, m: [9] }] })).toBeNull();
  });

  it("reads the vehicle settings of a question", () => {
    expect(readVehicleSource("DropdownQuestion", { choice_source: "vehicle", vehicle_asks: "model", vehicle_make_field: "car_make", vehicle_year_field: "car_year" })).toMatchObject({
      asks: "model",
      make_field: "car_make",
      year_field: "car_year",
    });
    expect(readVehicleSource("FreeTextQuestion", { choice_source: "vehicle", vehicle_asks: "make" })).toBeNull();
    expect(readVehicleSource("DropdownQuestion", { vehicle_asks: "make" })).toBeNull();
    expect(readVehicleSource("IconCardAnswerGrid", { choice_source: "vehicle", vehicle_asks: "year", vehicle_year_cards: "40" })?.year_cards).toBe(12);
    expect(parseFeaturedMakes(["448", 460, "x", 448])).toEqual([448, 460]);
    expect(isVehicleIdShaped("model", "m_0000000003")).toBe(true);
    expect(isVehicleIdShaped("model", "Corolla")).toBe(false);
  });
});

describe("F18 vehicle store", () => {
  it("re-reads the live pointer at most once a minute", async () => {
    const e = env(filesFor());
    expect(await readLiveSnapshotId(e, 1_000)).toBe(SNAP);
    expect(await readLiveSnapshotId(e, 30_000)).toBe(SNAP);
    expect(e.MEDIA.gets.filter((k) => k === "vehicles/live.json")).toHaveLength(1);
    await readLiveSnapshotId(e, 62_000);
    expect(e.MEDIA.gets.filter((k) => k === "vehicles/live.json")).toHaveLength(2);
  });

  it("keeps a parsed snapshot file in memory and reads a damaged one as null", async () => {
    const e = env(filesFor({ [`vehicles/${SNAP}/makes/460.json`]: "{not json" }));
    expect((await readMakeFile(e, SNAP, 448))?.make_id).toBe(448);
    await readMakeFile(e, SNAP, 448);
    expect(e.MEDIA.gets.filter((k) => k.endsWith("/448.json"))).toHaveLength(1);
    expect(await readMakeFile(e, SNAP, 460)).toBeNull();
    expect(await readMakeFile(e, SNAP, 999)).toBeNull();
  });

  it("finds logos by file name among global uploads; the newest upload wins", async () => {
    const e = env(filesFor(), [
      { filename: "vehicle-logo-toyota.png", storage_key: "old-toyota.png" },
      { filename: "vehicle-logo-toyota.png", storage_key: "new-toyota.png" },
      { filename: "vehicle-logo-ford.png", storage_key: "ford.png" },
    ]);
    const logos = await findVehicleLogoUrls(e, ["toyota", "ford", "acura", "bad slug!"]);
    expect(logos).toEqual({ toyota: "/media/new-toyota.png", ford: "/media/ford.png" });
    expect(e.DB.sqls[0]).toMatch(/site_id IS NULL/);
  });

  it("reads nothing for a page without vehicle questions", async () => {
    const e = env(filesFor());
    const out = await loadVehicleRenderData(e, [{ type: "DropdownQuestion", props: {} }, { type: "Stack", children: [{ type: "FreeTextQuestion" }] }]);
    expect(out).toBeNull();
    expect(e.MEDIA.gets).toEqual([]);
  });

  it("loads the live list, default featured makes, logos for logo cards and a Toyota sample for previews", async () => {
    const e = env(filesFor(), [{ filename: "vehicle-logo-toyota.png", storage_key: "toyota.png" }]);
    const out = await loadVehicleRenderData(
      e,
      [
        { type: "Stack", children: [{ type: "IconCardAnswerGrid", props: { choice_source: "vehicle", vehicle_asks: "make" } }] },
        { type: "SearchableDropdownQuestion", props: { choice_source: "vehicle", vehicle_asks: "model", vehicle_make_field: "car_make" } },
      ],
      { sample: true },
    );
    expect(out?.snapshot).toBe(SNAP);
    expect(out?.makes.map((m) => m.name)).toEqual(["Acura", "Ford", "Toyota"]);
    expect(out?.default_featured).toEqual([448, 460]);
    expect(out?.logos).toEqual({ toyota: "/media/toyota.png" });
    expect(out?.sample?.make_id).toBe(448);
  });

  it("fails open when no list is live", async () => {
    const e = env({});
    expect(await loadVehicleRenderData(e, [{ type: "DropdownQuestion", props: { choice_source: "vehicle", vehicle_asks: "make" } }])).toBeNull();
  });
});

describe("F18 public vehicle lookups (AC7, AC8)", () => {
  const BASE = "https://quotes.example.com";

  it("serves the makes list as stored, cached for a year as immutable", async () => {
    const e = env(filesFor());
    const res = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/${SNAP}/makes`, {}, e);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(res.headers.get("ETag")).toBeTruthy();
    expect(await res.json()).toEqual(MAKES);
  });

  it("serves one make's models and years", async () => {
    const e = env(filesFor());
    const res = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/${SNAP}/makes/448`, {}, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TOYOTA);
  });

  it("answers 304 when the browser already has the file", async () => {
    const e = env(filesFor());
    const first = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/${SNAP}/makes/448`, {}, e);
    const etag = first.headers.get("ETag")!;
    const res = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/${SNAP}/makes/448`, { headers: { "If-None-Match": etag } }, e);
    expect(res.status).toBe(304);
  });

  it("gives 400 invalid_param for a make_id that is not a positive whole number", async () => {
    const e = env(filesFor());
    for (const bad of ["abc", "0", "-3", "4.5"]) {
      const res = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/${SNAP}/makes/${bad}`, {}, e);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_param" });
    }
  });

  it("gives 404 unknown_make and unknown_snapshot", async () => {
    const e = env(filesFor());
    const make = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/${SNAP}/makes/999`, {}, e);
    expect(make.status).toBe(404);
    expect(await make.json()).toEqual({ error: "unknown_make" });
    const snap = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/2001-01-01/makes/448`, {}, e);
    expect(snap.status).toBe(404);
    expect(await snap.json()).toEqual({ error: "unknown_snapshot" });
    const list = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/2001-01-01/makes`, {}, e);
    expect(await list.json()).toEqual({ error: "unknown_snapshot" });
    const bad = await vehiclesPublicRouter.request(`${BASE}/api/vehicles/v1/live/makes`, {}, e);
    expect(bad.status).toBe(404);
  });

  it("never serves the vehicle files through /media (the live pointer changes)", async () => {
    const e = env(filesFor());
    for (const path of ["/media/vehicles/live.json", `/media/vehicles/${SNAP}/makes.json`, "/media/Vehicles%2Flive.json"]) {
      const res = await media.request(`${BASE}${path}`, {}, e as never);
      expect(res.status).toBe(404);
    }
    expect(e.MEDIA.gets).toEqual([]);
  });
});
