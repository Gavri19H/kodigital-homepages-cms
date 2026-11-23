// F18 Vehicle database — the yearly ingest, its clean-up rules (N1–N4), the
// 2% guardrail, the diff report and repeatability (AC5, AC6).
//
// No live calls: the pipeline tests read real vPIC / EPA answers saved on
// 2026-11-23 in test/fixtures/vehicles/source-cache/ (the ingest's own cache
// format: the three vPIC make lists, EPA make lists 2022–2023, and Toyota 448,
// Ford 460 and Tesla 441 models 2022–2023 for car / mpv / truck).

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { MODEL_ID_RE, modelsForYear, type VehicleSnapshotModelYear } from "../src/leadgen/vehicles/format";
import {
  AC1_TOYOTA_2023,
  AC2_FORD_2023_EXCLUDES,
  AC2_FORD_2023_INCLUDES,
  checkIntegrity,
  checkSameSource,
  diffSnapshots,
  dropShareOfRows,
  guardrail,
  loadSnapshot,
  renderDiffReport,
  runSnapshotChecks,
  snapshotFromRows,
  switchLive,
  type PointerStore,
  type SnapshotRows,
} from "../scripts/vehicles/checks";
import {
  buildSnapshot,
  cleanModelName,
  deniedBy,
  modelIdFor,
  parseCsv,
  parseDenylist,
  parseEpaMakes,
  parseMakeMap,
  parseVpicMakes,
  runIngest,
  selectMakes,
  titleCaseMake,
  vpicModelsUrl,
  type KeptMake,
  type RawModelRow,
} from "../scripts/vehicles/ingest";
import { mediaBuckets, putArgs, uploadPlan } from "../scripts/vehicles/upload";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "vehicles");
const CACHE = path.join(FIX, "source-cache");
const SCRIPTS = path.join(HERE, "..", "scripts", "vehicles");
const SNAP = "2026-11-23";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "vehicles-test-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function cacheShard(name: string): Record<string, { body: unknown }> {
  return JSON.parse(readFileSync(path.join(CACHE, `${name}.json`), "utf8")) as Record<string, { body: unknown }>;
}

function fixtureVpicMakes() {
  const shard = cacheShard("vpic-makes");
  const body = (t: string) => shard[`https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/${t}?format=json`]!.body;
  return parseVpicMakes({ car: body("car"), mpv: body("mpv"), truck: body("truck") });
}

function fixtureEpa(): Map<number, string[]> {
  const shard = cacheShard("epa-makes");
  const out = new Map<number, string[]>();
  for (const y of [2022, 2023]) out.set(y, parseEpaMakes(shard[`https://www.fueleconomy.gov/ws/rest/vehicle/menu/make?year=${y}`]!.body));
  return out;
}

const fixtureMakeMap = () => parseMakeMap(readFileSync(path.join(FIX, "make_map.csv"), "utf8"));
// The real drop list (spec seed terms + the owner-approved make + model pairs), so tests guard what ships.
const REAL_DENYLIST = path.join(SCRIPTS, "model_denylist.csv");
const realDeny = () => parseDenylist(readFileSync(REAL_DENYLIST, "utf8"));

function ingestFixture(out: string, extra: Partial<Parameters<typeof runIngest>[0]> = {}) {
  return runIngest({
    snapshot: SNAP,
    offline: true,
    cacheDir: CACHE,
    outDir: out,
    compareTo: "none",
    snapshotsDir: path.join(tmpRoot, "no-snapshots"),
    makeMapPath: path.join(FIX, "make_map.csv"),
    denylistPath: REAL_DENYLIST,
    onlyMakes: [441, 448, 460],
    minYear: 2022,
    maxYear: 2023,
    epaMinYear: 2022,
    log: () => {},
    ...extra,
  });
}

function filesUnder(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const full = path.join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(path.relative(dir, full), readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out;
}

const K = (make_id: number, display_name: string): KeptMake => ({ make_id, vpic_name: display_name.toUpperCase(), display_name });
const R = (make_id: number, year: number, type: RawModelRow["type"], name: string): RawModelRow => ({ make_id, year, type, name });

// --- N1: make names and the consumer filter -------------------------------------------

describe("N1 make names and the consumer filter", () => {
  it("title-cases vPIC names by default, hyphens included", () => {
    expect(titleCaseMake("ALFA ROMEO")).toBe("Alfa Romeo");
    expect(titleCaseMake("MERCEDES-BENZ")).toBe("Mercedes-Benz");
    expect(titleCaseMake("ROLLS-ROYCE")).toBe("Rolls-Royce");
    expect(titleCaseMake("  LAND   ROVER ")).toBe("Land Rover");
  });

  it("keeps vPIC makes EPA lists, applies make_map.csv, and flags what a person must decide", () => {
    const vpic = fixtureVpicMakes();
    expect(vpic.length).toBeGreaterThan(300); // union of car + mpv + truck by MakeId
    const toyota = vpic.find((m) => m.make_id === 448)!;
    expect(toyota.types.sort()).toEqual(["car", "mpv", "truck"]);

    const sel = selectMakes(vpic, fixtureEpa(), fixtureMakeMap());
    const byId = new Map(sel.kept.map((k) => [k.make_id, k]));
    expect(byId.get(452)?.display_name).toBe("BMW"); // exception from make_map.csv
    expect(byId.get(448)?.display_name).toBe("Toyota");
    expect(byId.has(474)).toBe(false); // Honda: include=no in this fixture map
    expect(byId.get(2236)?.display_name).toBe("McLaren"); // EPA says "McLaren Automotive": kept by a person's row
    // Not on any EPA list → never kept (AC4 names among them).
    for (const id of [11938 /* Zoox */, 10647 /* Cruise */, 8365 /* Chanje */, 450 /* Freightliner */]) expect(byId.has(id)).toBe(false);
    // EPA-matched but not in make_map.csv: kept with the title-case default and flagged.
    expect(byId.get(482)?.display_name).toBe("Volkswagen");
    expect(sel.flags.some((f) => f.kind === "make-not-in-map" && f.make_id === 482)).toBe(true);
    // EPA names covered by a row's epa_names leave the review list; others stay on it.
    const unmatched = sel.flags.filter((f) => f.kind === "epa-unmatched").map((f) => f.message);
    expect(unmatched.some((m) => m.includes('"MCLAREN AUTOMOTIVE"'))).toBe(false);
    expect(unmatched.some((m) => m.includes('"INEOS AUTOMOTIVE"'))).toBe(false);
    expect(unmatched.length).toBeGreaterThan(0);
  });

  it("fails loudly when a kept make's display name has a company suffix (AC4)", () => {
    const map = parseMakeMap("vpic_make_id,display_name,include\n448,Toyota Motor Corporation,yes\n");
    expect(() => selectMakes(fixtureVpicMakes(), fixtureEpa(), map)).toThrow(/AC4/);
  });

  it("rejects malformed make_map.csv rows", () => {
    expect(() => parseMakeMap("vpic_make_id,display_name,include\n448,Toyota,maybe\n")).toThrow(/include/);
    expect(() => parseMakeMap("vpic_make_id,display_name,include\n448,Toyota,yes\n448,Toyota,no\n")).toThrow(/twice/);
    expect(() => parseMakeMap("vpic_make_id,display_name,include\n,Nobody,yes\n")).toThrow(/include=no/);
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

// --- N2: model names ----------------------------------------------------------------------

describe("N2 model names", () => {
  it("trims, collapses spaces, keeps vPIC casing and drops a powertrain suffix in brackets", () => {
    expect(cleanModelName("  RAV4   Prime (PHEV) ").name).toBe("RAV4 Prime");
    expect(cleanModelName("RAV4 Prime (PHEV)").removed).toBe("(PHEV)");
    expect(cleanModelName("Prius Prime (Plug-In Hybrid)").name).toBe("Prius Prime");
    expect(cleanModelName("Ioniq 5 (EV)").name).toBe("Ioniq 5");
    expect(cleanModelName("bZ4X").name).toBe("bZ4X");
    expect(cleanModelName("F-150").name).toBe("F-150");
  });

  it("keeps a bracket that isn't only powertrain words, and says so", () => {
    const c = cleanModelName("Sprinter (Dodge or Freightliner)");
    expect(c.name).toBe("Sprinter (Dodge or Freightliner)");
    expect(c.keptBracket).toBe("(Dodge or Freightliner)");
    expect(cleanModelName("(PHEV)").name).toBe("(PHEV)"); // never strip a name to nothing
  });
});

// --- N3: denylist ----------------------------------------------------------------------------

describe("N3 denylist", () => {
  const deny = realDeny();
  const hit = (make: number, raw: string) => deniedBy(make, raw, cleanModelName(raw).name, deny);

  it("drops names containing a seed term, ignoring case", () => {
    for (const n of ["Commercial Chassis", "Motorhome Chassis", "E-350 Cutaway", "Utility TRAILER", "Incomplete Vehicle"]) {
      expect(hit(460, n)?.kind).toBe("term");
    }
    expect(hit(460, "Trailblazer")).toBeNull();
  });

  it("drops exact make + model pairs only for that make", () => {
    expect(hit(460, "'34")?.kind).toBe("pair");
    expect(hit(460, "classic sedan")?.kind).toBe("pair");
    expect(hit(460, "Cordova Sedan")?.kind).toBe("pair");
    expect(hit(448, "'34")).toBeNull();
    expect(hit(460, "Classic Sedan Deluxe")).toBeNull();
  });

  it("drop-list pairs remove non-consumer models while similar consumer names survive", () => {
    // Ford medium / heavy trucks go; the consumer pickups and vans stay.
    for (const n of ["F-600", "F-650", "F-750", "LT9513", "AT9522", "C8000", "B700", "P600", "Recreational Vehicle"]) expect(hit(460, n)?.kind).toBe("pair");
    for (const n of ["F-150", "F-250", "F-350", "F-450", "E-350", "Transit", "Transit Connect", "Ranger"]) expect(hit(460, n)).toBeNull();
    // Volvo truck cabs go; Volvo cars with similar names stay.
    for (const n of ["VT", "VS", "Cab Over Engine HT", "F12 w/F7 Cab"]) expect(hit(485, n)?.kind).toBe("pair");
    for (const n of ["V70", "V60CC", "S90", "C30"]) expect(hit(485, n)).toBeNull();
    // Tesla, Rivian, Chevrolet: fleet, robotaxi, police and export-only models.
    expect(hit(441, "Semi")?.kind).toBe("pair");
    expect(hit(441, "Cybercab")?.kind).toBe("pair");
    expect(hit(441, "Cybertruck")).toBeNull();
    expect(hit(10887, "EDV")?.kind).toBe("pair");
    expect(hit(10887, "R1T")).toBeNull();
    expect(hit(467, "Caprice Police Vehicle")?.kind).toBe("pair");
    expect(hit(467, "Caprice")).toBeNull();
    expect(hit(467, "Orlando")?.kind).toBe("pair");
    // A pair belongs to one make only: Oldsmobile's Alero stays though Chevrolet's (Mexico-only) goes.
    expect(hit(467, "Alero")?.kind).toBe("pair");
    expect(hit(4162, "Alero")).toBeNull();
    expect(hit(448, "Cargo Van")).toBeNull();
  });
});

// --- N4: model ids ----------------------------------------------------------------------------

describe("N4 model_id", () => {
  it("has the agreed format and never changes (a forever contract for stored leads)", () => {
    expect(modelIdFor(448, "RAV4 Prime")).toBe("m_64bd1e49e1");
    expect(modelIdFor(448, "bZ4X")).toBe("m_48fff1ba2d");
    expect(modelIdFor(448, "Camry")).toBe("m_280387955d");
    expect(modelIdFor(448, "Camry")).toMatch(MODEL_ID_RE);
  });

  it("ignores case and extra spaces but not the make", () => {
    expect(modelIdFor(448, "BZ4X")).toBe(modelIdFor(448, "bZ4X"));
    expect(modelIdFor(448, " RAV4  Prime ")).toBe(modelIdFor(448, "RAV4 Prime"));
    expect(modelIdFor(460, "Ranger")).not.toBe(modelIdFor(448, "Ranger"));
  });

  it("fails loudly on a model_id collision", () => {
    expect(() =>
      buildSnapshot({
        snapshot: SNAP,
        makes: [K(448, "Toyota")],
        rows: [R(448, 2023, "car", "Camry"), R(448, 2023, "car", "Corolla")],
        deny: [],
        modelIdFn: () => "m_0000000000",
      }),
    ).toThrow(/collision/);
  });
});

// --- Merge and de-dup ------------------------------------------------------------------------

describe("vehicle types merge and de-duplication", () => {
  const built = buildSnapshot({
    snapshot: SNAP,
    makes: [K(460, "Ford"), K(448, "Toyota")],
    rows: [
      R(460, 2023, "mpv", "Transit"),
      R(460, 2023, "truck", "Transit"),
      R(460, 2023, "truck", "Transit "),
      R(448, 2023, "mpv", "bZ4X"),
      R(448, 2022, "car", "BZ4X"),
      R(448, 2023, "car", "BZ4X"),
      R(448, 2023, "mpv", "RAV4 Prime (PHEV)"),
      R(448, 2023, "mpv", "RAV4 Prime"),
      R(448, 2021, "mpv", "RAV4"),
    ],
    deny: [],
  });
  const row = (make: number, year: number, name: string): VehicleSnapshotModelYear | undefined =>
    built.rows.model_years.find((r) => r.make_id === make && r.model_year === year && r.model_id === modelIdFor(make, name));

  it("merges Transit's mpv and truck rows into one 'mpv,truck' row", () => {
    expect(built.rows.model_years.filter((r) => r.make_id === 460)).toEqual([
      { make_id: 460, model_year: 2023, model_id: modelIdFor(460, "Transit"), vehicle_types: "mpv,truck" },
    ]);
  });

  it("de-duplicates per make + year ignoring case; newest spelling wins, mixed case over ALL CAPS on a tie", () => {
    const toyota = built.rows.models.filter((m) => m.make_id === 448);
    expect(toyota.map((m) => m.display_name)).toEqual(["bZ4X", "RAV4", "RAV4 Prime"]);
    expect(row(448, 2023, "bZ4X")?.vehicle_types).toBe("car,mpv");
    expect(row(448, 2022, "bZ4X")?.vehicle_types).toBe("car");
    expect(row(448, 2023, "RAV4 Prime")?.vehicle_types).toBe("mpv");
    expect(built.flags.some((f) => f.kind === "casing-variants" && f.message.includes('"bZ4X"'))).toBe(true);
    expect(built.flags.some((f) => f.kind === "suffix-removed" && f.message.includes('"RAV4 Prime (PHEV)" → "RAV4 Prime"'))).toBe(true);
  });

  it("serves models once each A→Z ignoring case, years newest first with indexes", () => {
    const f = built.makeFiles.find((x) => x.make_id === 448)!;
    expect(f.models.map((m) => m.name)).toEqual(["bZ4X", "RAV4", "RAV4 Prime"]);
    expect(f.years.map((y) => y.year)).toEqual([2023, 2022, 2021]);
    expect(modelsForYear(f, 2023).map((m) => m.name)).toEqual(["bZ4X", "RAV4 Prime"]);
    expect(built.makesFile.makes.map((m) => m.name)).toEqual(["Ford", "Toyota"]);
    expect(built.makesFile.makes[1]).toEqual({ make_id: 448, name: "Toyota", slug: "toyota" });
  });

  it("only ever builds make-ID, typed model lookups (V1, V2, V4)", () => {
    expect(vpicModelsUrl(460, 2023, "mpv")).toBe(
      "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeIdYear/makeId/460/modelyear/2023/vehicletype/mpv?format=json",
    );
    expect(() => vpicModelsUrl(0, 2023, "car")).toThrow();
  });
});

// --- The pipeline on saved real answers ------------------------------------------------------

describe("ingest on saved real vPIC / EPA answers", () => {
  it("builds the served files, rows and manifest; Toyota and Ford 2023 meet AC1 / AC2", async () => {
    const out = path.join(tmpRoot, "run-a");
    const res = await ingestFixture(out);
    const s = loadSnapshot(out);
    expect(checkIntegrity(s).ok).toBe(true);
    expect(res.manifest.counts.makes).toBe(3);
    expect(res.manifest.source_note).toMatch(/PARTIAL/);
    expect(Object.keys(res.manifest.files).sort()).toEqual(["makes.json", "makes/441.json", "makes/448.json", "makes/460.json"]);

    const toyota2023 = modelsForYear(s.makeFiles.get(448)!, 2023).map((m) => m.name);
    expect(toyota2023).toEqual([...AC1_TOYOTA_2023].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)));
    const ford2023 = modelsForYear(s.makeFiles.get(460)!, 2023).map((m) => m.name);
    for (const n of AC2_FORD_2023_INCLUDES) expect(ford2023).toContain(n);
    for (const n of AC2_FORD_2023_EXCLUDES) expect(ford2023).not.toContain(n);
    const transit = s.rows.model_years.find((r) => r.make_id === 460 && r.model_year === 2023 && r.model_id === modelIdFor(460, "Transit"));
    expect(transit?.vehicle_types).toBe("mpv,truck");
    // Minified served JSON, readable committed rows.
    expect(readFileSync(path.join(out, "makes.json"), "utf8")).not.toContain("\n");
    expect(readFileSync(path.join(out, "rows", "model_years.json"), "utf8").split("\n").length).toBeGreaterThan(10);
    expect(readFileSync(path.join(out, "diff-report.md"), "utf8")).toContain("first snapshot");
  });

  it("the drop list removes exactly the listed models from the saved answers, and the report lists them", async () => {
    const out = path.join(tmpRoot, "drop-list");
    const res = await ingestFixture(out);
    expect(res.built.dropped.map((d) => `${d.make}|${d.model}|${d.years.join(",")}|${d.kind}`)).toEqual([
      "Tesla|Semi|2023|pair",
      "Ford|'34|2022,2023|pair",
      "Ford|F-600|2022,2023|pair",
    ]);
    const s = loadSnapshot(out);
    const names = (make: number) => s.rows.models.filter((m) => m.make_id === make).map((m) => m.display_name);
    for (const n of ["F-450", "F-550", "Transit", "Transit Connect", "Maverick"]) expect(names(460)).toContain(n);
    expect(names(460)).not.toContain("F-600");
    expect(names(441)).toEqual(["Model 3", "Model S", "Model X", "Model Y"]);
    const md = readFileSync(path.join(out, "diff-report.md"), "utf8");
    expect(md).toContain("## Removed by the drop list (3 models)");
    expect(md).toContain("| Ford | F-600 | 2022–2023 | Ford medium-duty truck (Class 6 and up) |");
    expect(md).toContain("| Tesla | Semi | 2023 | Tesla Class 8 truck |");
  });

  it("AC5: a rerun on the same source gives byte-identical files, the same model_ids and an empty diff", async () => {
    const a = path.join(tmpRoot, "rerun-a");
    const b = path.join(tmpRoot, "rerun-b");
    await ingestFixture(a);
    await ingestFixture(b);
    expect(filesUnder(b)).toEqual(filesUnder(a));

    const c = path.join(tmpRoot, "rerun-c");
    const res = await ingestFixture(c, { compareTo: a });
    expect(res.diffEmpty).toBe(true);
    expect(readFileSync(path.join(c, "diff-report.md"), "utf8")).toContain("**Result: no differences");
    const same = checkSameSource(loadSnapshot(a), loadSnapshot(c));
    expect(same.ok).toBe(true);
  });

  it("is repeat-safe: running again into the same folder replaces it cleanly", async () => {
    const out = path.join(tmpRoot, "same-folder");
    await ingestFixture(out);
    const first = filesUnder(out);
    await ingestFixture(out);
    expect(filesUnder(out)).toEqual(first);
    expect(readdirSync(tmpRoot).some((n) => n.includes(".tmp-"))).toBe(false);
  });

  it("--offline refuses a lookup that was never saved", async () => {
    await expect(ingestFixture(path.join(tmpRoot, "missing"), { maxYear: 2024 })).rejects.toThrow(/--offline: no saved answer/);
  });
});

// --- Guardrail and the live switch (AC6) --------------------------------------------------------

describe("2% guardrail and the live pointer", () => {
  function bigRows(n: number): SnapshotRows {
    const models = Array.from({ length: n }, (_, i) => ({ model_id: modelIdFor(448, `Model ${i}`), make_id: 448, display_name: `Model ${i}` }));
    return {
      makes: [{ make_id: 448, display_name: "Toyota", slug: "toyota", min_year: 2023, max_year: 2023 }],
      models,
      model_years: models.map((m) => ({ make_id: 448, model_year: 2023, model_id: m.model_id, vehicle_types: "car" })),
    };
  }
  const live = bigRows(1000);

  function memoryStore(initial: string | null) {
    const state = { pointer: initial, writes: 0 };
    const store: PointerStore = {
      read: async () => state.pointer,
      write: async (id) => {
        state.writes++;
        state.pointer = id;
      },
    };
    return { state, store };
  }

  it("refuses a snapshot missing 5% of rows and allows one missing 1% (2% exactly is allowed)", () => {
    expect(guardrail(live, dropShareOfRows(live, 0.05))).toMatchObject({ removedRows: 50, ok: false });
    expect(guardrail(live, dropShareOfRows(live, 0.01))).toMatchObject({ removedRows: 10, ok: true });
    expect(guardrail(live, dropShareOfRows(live, 0.02))).toMatchObject({ removedRows: 20, ok: true });
    expect(guardrail(live, dropShareOfRows(live, 0.021)).ok).toBe(false);
  });

  it("AC6: the 5% snapshot is refused and the live pointer does not move", async () => {
    const { state, store } = memoryStore("2026-10-05");
    const next = snapshotFromRows("2026-11-23", dropShareOfRows(live, 0.05));
    const out = await switchLive({ store, next, loadRows: (id) => (id === "2026-10-05" ? live : null), approveDiff: false, checks: [] });
    expect(out.switched).toBe(false);
    expect(out.reasons.join(" ")).toMatch(/guardrail/);
    expect(state).toEqual({ pointer: "2026-10-05", writes: 0 });
  });

  it("switches for a 1% drop, or a larger one a person approved", async () => {
    const a = memoryStore("2026-10-05");
    const ok = await switchLive({ store: a.store, next: snapshotFromRows("2026-11-23", dropShareOfRows(live, 0.01)), loadRows: () => live, approveDiff: false, checks: [] });
    expect(ok.switched).toBe(true);
    expect(a.state).toEqual({ pointer: "2026-11-23", writes: 1 });

    const b = memoryStore("2026-10-05");
    const approved = await switchLive({ store: b.store, next: snapshotFromRows("2026-11-23", dropShareOfRows(live, 0.05)), loadRows: () => live, approveDiff: true, checks: [] });
    expect(approved.switched).toBe(true);
  });

  it("refuses when a QA check fails, or when the live snapshot's rows can't be found", async () => {
    const a = memoryStore("2026-10-05");
    const failed = await switchLive({
      store: a.store,
      next: snapshotFromRows("2026-11-23", live),
      loadRows: () => live,
      approveDiff: true,
      checks: [{ id: "AC1", title: "t", ok: false, details: ["missing: Crown"] }],
    });
    expect(failed.switched).toBe(false);
    expect(a.state.writes).toBe(0);

    const b = memoryStore("2025-10-01");
    const unknown = await switchLive({ store: b.store, next: snapshotFromRows("2026-11-23", live), loadRows: () => null, approveDiff: false, checks: [] });
    expect(unknown.switched).toBe(false);
    expect(b.state.pointer).toBe("2025-10-01");
  });
});

// --- AC3 (owner decision 23 Nov 2026) -------------------------------------------------------

describe("AC3 Tesla years", () => {
  const tesla = (years: number[]): SnapshotRows => ({
    makes: [{ make_id: 441, display_name: "Tesla", slug: "tesla", min_year: Math.min(...years), max_year: Math.max(...years) }],
    models: [{ model_id: modelIdFor(441, "Roadster"), make_id: 441, display_name: "Roadster" }],
    model_years: years.map((y) => ({ make_id: 441, model_year: y, model_id: modelIdFor(441, "Roadster"), vehicle_types: "car" })),
  });
  const ac3 = (years: number[]) => runSnapshotChecks(snapshotFromRows(SNAP, tesla(years))).find((c) => c.id === "AC3")!;

  it("accepts 2009 (vPIC lists the Roadster for 2009; the source data wins)", () => {
    expect(ac3([2008, 2009, 2010, 2011, 2012]).ok).toBe(true);
  });

  it("still refuses any year before 2008", () => {
    const r = ac3([2007, 2008, 2009]);
    expect(r.ok).toBe(false);
    expect(r.details.join(" ")).toContain("not allowed: 2007");
  });
});

// --- Diff report -----------------------------------------------------------------------------

describe("diff report", () => {
  const make = (make_id: number, display_name: string, min = 2022, max = 2023) => ({ make_id, display_name, slug: display_name.toLowerCase(), min_year: min, max_year: max });
  const model = (make_id: number, name: string) => ({ model_id: modelIdFor(make_id, name), make_id, display_name: name });
  const my = (make_id: number, year: number, name: string, t = "car") => ({ make_id, model_year: year, model_id: modelIdFor(make_id, name), vehicle_types: t });
  const prev: SnapshotRows = {
    makes: [make(448, "Toyota"), make(5468, "Merkur")],
    models: [model(448, "Camry"), model(448, "Venza"), model(5468, "Scorpio")],
    model_years: [my(448, 2023, "Camry"), my(448, 2022, "Camry"), my(448, 2023, "Venza"), my(5468, 2022, "Scorpio")],
  };
  const next: SnapshotRows = {
    makes: [make(448, "Toyota", 2022, 2024), make(475, "Acura", 2024, 2024)],
    models: [model(448, "Camry"), model(448, "Crown"), model(475, "MDX")],
    model_years: [my(448, 2024, "Camry"), my(448, 2023, "Camry"), my(448, 2022, "Camry", "car,mpv"), my(448, 2024, "Crown"), my(475, 2024, "MDX")],
  };

  it("lists makes and models added and removed, rows per year, the guardrail and the flags", () => {
    const d = diffSnapshots(prev, next, "2025-10-06", "2026-11-23");
    expect(d.empty).toBe(false);
    expect(d.makesAdded.map((m) => m.display_name)).toEqual(["Acura"]);
    expect(d.makesRemoved.map((m) => m.display_name)).toEqual(["Merkur"]);
    expect(d.modelsAdded.map((m) => m.display_name).sort()).toEqual(["Crown", "MDX"]);
    expect(d.modelsRemoved.map((m) => m.display_name).sort()).toEqual(["Scorpio", "Venza"]);
    expect(d.rowsRemoved).toBe(2);
    expect(d.typesChanged).toHaveLength(1);
    const md = renderDiffReport(d, [{ kind: "epa-unmatched", message: 'EPA make "VECTOR" matches no vPIC make' }], {
      sourceNote: "test",
      featured: ["Toyota", "Honda"],
      nextRows: next,
    });
    expect(md).toContain("Compared with: snapshot 2025-10-06");
    expect(md).toContain("**Over the limit:** 2 of 4 rows removed (50.00%)");
    expect(md).toContain("**Missing: Honda.**");
    expect(md).toMatch(/## Makes added \(1\)\n\n- Acura \(make_id 475, 2024–2024\)/);
    expect(md).toContain("- Merkur (make_id 5468, was 2022–2023)");
    expect(md).toContain("- **Toyota**: Crown (2024)");
    expect(md).toContain("- **Toyota**: Venza (2023)");
    expect(md).toContain("- **Merkur**: Scorpio (2022)");
    expect(md).toContain("| 2024 | 0 | 3 | +3 |");
    expect(md).toContain("| 2022 | 2 | 1 | -1 |");
    expect(md).toContain("Toyota Camry 2022: car → car,mpv");
    expect(md).toContain('### EPA make names no vPIC make matches — decide in make_map.csv (1)\n\n- EPA make "VECTOR" matches no vPIC make');
  });

  it("says plainly when there is nothing to review", () => {
    const d = diffSnapshots(next, next, "2026-11-23", "2026-11-23-b");
    expect(d.empty).toBe(true);
    const md = renderDiffReport(d, [], { sourceNote: "test", featured: [], nextRows: next });
    expect(md).toContain("**Result: no differences against 2026-11-23.**");
    expect(md).toContain("## Makes added (0)\n\nNone.");
    expect(md).toContain("## Models removed (0)\n\nNone.");
  });
});

// --- The real hand-kept files and the upload helper --------------------------------------------

describe("hand-kept files and upload plan", () => {
  it("make_map.csv and model_denylist.csv parse; no included display name breaks AC4", () => {
    const map = parseMakeMap(readFileSync(path.join(SCRIPTS, "make_map.csv"), "utf8"));
    const kept = map.filter((r) => r.include);
    expect(kept.length).toBeGreaterThan(50);
    for (const r of kept) expect(r.display_name).not.toMatch(/\b(llc|inc|corporation|limited)\b/i);
    for (const name of ["Zoox", "Cruise", "Iveco", "Chanje"]) expect(kept.some((r) => r.display_name.toLowerCase() === name.toLowerCase())).toBe(false);
    const byId = new Map(kept.map((r) => [r.vpic_make_id, r.display_name]));
    expect(byId.get(452)).toBe("BMW");
    expect(byId.get(472)).toBe("GMC");
    expect(byId.get(456)).toBe("MINI");
    expect(byId.get(496)).toBe("RAM");
    expect(byId.get(449)).toBe("Mercedes-Benz");
    expect(byId.get(445)).toBe("Rolls-Royce");
    expect(byId.get(2236)).toBe("McLaren");
    const deny = parseDenylist(readFileSync(path.join(SCRIPTS, "model_denylist.csv"), "utf8"));
    for (const t of ["trailer", "chassis", "motorhome", "cutaway", "incomplete"]) expect(deny.some((d) => d.kind === "term" && d.value === t)).toBe(true);
    expect(deny.some((d) => d.kind === "pair" && d.make_id === 460 && d.value === "'34")).toBe(true);
  });

  it("reads each env's MEDIA bucket from wrangler.toml and uploads manifest.json last", async () => {
    const toml = readFileSync(path.join(HERE, "..", "wrangler.toml"), "utf8");
    const buckets = mediaBuckets(toml);
    expect(buckets.get("default")).toBeTruthy();
    expect(buckets.get("staging")).toBeTruthy();
    expect(buckets.get("production")).toBeTruthy();
    const out = path.join(tmpRoot, "plan");
    await ingestFixture(out);
    const plan = uploadPlan(loadSnapshot(out), { bucket: "b", mode: "local", label: "local" });
    expect(plan.map((p) => p.key)).toEqual([
      `vehicles/${SNAP}/makes/441.json`,
      `vehicles/${SNAP}/makes/448.json`,
      `vehicles/${SNAP}/makes/460.json`,
      `vehicles/${SNAP}/makes.json`,
      `vehicles/${SNAP}/manifest.json`,
    ]);
    expect(putArgs({ bucket: "b", mode: "remote", label: "r" }, "vehicles/x.json", "/f")).toEqual([
      "wrangler", "r2", "object", "put", "b/vehicles/x.json", "--file", "/f", "--content-type", "application/json", "--remote",
    ]);
  });
});
