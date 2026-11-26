import { afterEach, expect, it, vi } from "vitest";
import { D1Timing } from "../src/db/read-session";
import { PublicPage } from "../src/edge/public-page";
import type { Env } from "../src/env";
import { honoFetch } from "../src/index";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));
vi.mock("../src/index", () => ({ honoFetch: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

const sql = "SELECT ? AS title";
const title = "Café";
const origin = "https://news.example";

function productionPage(db: D1Database) {
  const { ctx } = ctxCapture();
  const env = { ...buildEnv(db), APP_ENV: "production" };
  return new PublicPage({ ...ctx, props: { siteKey: "news", variantKey: "human" } }, env);
}

it("logs one fresh build without query data and preserves native first, raw and child session calls", async () => {
  const { db } = makeFakeDb();
  const native = db.prepare(sql);
  const bind = vi.spyOn(native, "bind");
  const first = vi.spyOn(native, "first").mockResolvedValue(title);
  const rows = [["title", "title"], [title, null]];
  native.raw = vi.fn();
  const raw = vi.mocked(native.raw).mockResolvedValue(rows);
  const all = vi.spyOn(native, "all");
  const session = Object.freeze({ prepare: vi.fn(() => native), batch: db.batch, getBookmark: vi.fn(() => "current") });
  const withSession = db.withSession = vi.fn(() => session);
  vi.mocked(honoFetch).mockImplementation(async (_request, bindings) => {
    if (!bindings || !("DB" in bindings)) throw new Error("missing DB");
    const child = bindings.DB.withSession("next");
    const stmt = child.prepare(sql).bind(title);
    return Response.json([await stmt.first("title"), await stmt.raw({ columnNames: true }), child.getBookmark()]);
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const request = new Request(origin + "/article/story?gclid=private-click#fragment", {
    headers: { "x-cms-bookmark": "published" },
  });
  request.cf = { colo: "SEA" };
  const response = await productionPage(db).fetch(request);
  expect(response.status).toBe(200);
  expect(response.headers.has("Server-Timing")).toBe(false);
  expect(await response.json()).toEqual([title, rows, "current"]);
  expect(withSession.mock.calls).toEqual([["published"], ["next"]]);
  expect(withSession.mock.contexts).toEqual([db, db]);
  expect(session.prepare).toHaveBeenCalledExactlyOnceWith(sql);
  expect(bind).toHaveBeenCalledExactlyOnceWith(title);
  expect(first).toHaveBeenCalledExactlyOnceWith("title");
  expect(first.mock.contexts[0]).toBe(native);
  expect(raw).toHaveBeenCalledExactlyOnceWith({ columnNames: true });
  expect(raw.mock.contexts[0]).toBe(native);
  expect(all).not.toHaveBeenCalled();
  expect(session.getBookmark).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledTimes(1);
  const [line] = log.mock.calls[0]!;
  expect(line).not.toMatch(/[\r\n]|private-click|fragment/);
  expect(JSON.parse(line)).toEqual({
    evt: "edge-build", host: "news.example", path: "/article/story", variant: "human", snap: false,
    build_ms: expect.any(Number), d1_ms: expect.any(Number), rounds: 2, calls: 2,
    primary: 0, replica: 0, region: "none", colo: "SEA",
  });
});

it("logs a rejected build once and propagates the original D1 error without retrying", async () => {
  const { db } = makeFakeDb();
  const native = db.prepare(sql);
  const error = new Error("D1 unavailable");
  const first = vi.spyOn(native, "first").mockRejectedValue(error);
  vi.spyOn(db, "prepare").mockReturnValue(native);
  vi.mocked(honoFetch).mockImplementation(async (_request, bindings) => {
    if (!bindings || !("DB" in bindings)) throw new Error("missing DB");
    await bindings.DB.prepare(sql).bind(title).first();
    return new Response(title);
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await expect(productionPage(db).fetch(new Request(origin + "/article/story?gclid=private-click"))).rejects.toBe(error);
  expect(first).toHaveBeenCalledExactlyOnceWith();
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ evt: "edge-build", path: "/article/story", calls: 1, rounds: 1 });
});

it.each(["clock", "collector before dispatch", "collector after dispatch", "console"])(
  "delivers the original response and executes the query once when the %s fails", async failure => {
    const { db, calls } = makeFakeDb([{ match: sql, row: { title } }]);
    const unavailable = () => { throw new Error("diagnostic unavailable"); };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    if (failure === "clock") vi.spyOn(performance, "now").mockImplementation(unavailable);
    if (failure === "collector before dispatch") vi.spyOn(D1Timing.prototype, "measure").mockImplementation(unavailable);
    if (failure === "collector after dispatch") {
      vi.spyOn(D1Timing.prototype, "measure").mockImplementation(async execute => { await execute(); return unavailable(); });
    }
    if (failure === "console") log.mockImplementation(unavailable);
    vi.mocked(honoFetch).mockImplementation(async (_request, bindings) => {
      if (!bindings || !("DB" in bindings)) throw new Error("missing DB");
      const row = await bindings.DB.prepare(sql).bind(title).first<{ title: string }>();
      return new Response(row?.title, { status: 404, headers: { ETag: '"v1"', "Server-Timing": "renderer;dur=1" } });
    });
    const response = await productionPage(db).fetch(new Request(origin + "/article/story"));
    expect(response.status).toBe(404);
    expect(await response.bytes()).toEqual(new TextEncoder().encode(title));
    expect([...response.headers]).toEqual([...new Headers({
      "Cache-Control": "public, max-age=0, s-maxage=60", "Cache-Tag": "site:news,slug:news:story,listing:news,nf:news",
      "Content-Type": "text/plain;charset=UTF-8", ETag: '"v1"',
    })]);
    expect(log).toHaveBeenCalledOnce();
    expect(calls).toEqual([{ sql, binds: [title] }]);
  },
);
