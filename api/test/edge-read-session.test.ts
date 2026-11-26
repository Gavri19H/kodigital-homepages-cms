import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { renderReadDb } from "../src/db/read-session";
import { PublicPage } from "../src/edge/public-page";
import * as snapshots from "../src/edge/snapshot";
import type { Env } from "../src/env";
import { honoFetch } from "../src/index";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture, d1FromSqlite } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb } from "./helpers/x06-a2-sqlite";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const siteId = "news";
const host = "news.example";
const slug = "story";
const oldTitle = "Original headline";
const newTitle = "Published headline";
const readTitle = "SELECT title FROM articles WHERE slug = ?";
const updateTitle = "UPDATE articles SET title = ? WHERE slug = ?";

function articleStore() {
  const sql = createDb();
  addSite(sql, siteId, "News", "home");
  sql.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(siteId, host);
  sql.prepare(`INSERT INTO articles (site_id, slug, title, content_json, status, published_at)
    VALUES (?, ?, ?, '{"blocks":[]}', 'published', 100)`).run(siteId, slug, oldTitle);
  return { sql, db: d1FromSqlite(sql) };
}

function laggingReplica() {
  const primary = articleStore();
  const replica = articleStore();
  const { ctx, promises } = ctxCapture();
  onTestFinished(async () => {
    await Promise.all(promises);
    replica.sql.close();
    primary.sql.close();
  });

  // SQLite's connection-local write count gives each committed edit a later bookmark.
  function latestBookmark() {
    const row = primary.sql.prepare("SELECT total_changes() AS revision").get() as { revision: number };
    return String(row.revision);
  }

  const withSession = vi.fn((anchor?: string): D1DatabaseSession => {
    if (anchor === "first-primary" || Number(anchor) >= Number(latestBookmark())) {
      const row = primary.sql.prepare(readTitle).get(slug) as { title: string };
      replica.sql.prepare(updateTitle).run(row.title, slug);
    }
    return {
      // D1 sends the fixture's UPDATE to the primary. All render queries read the replica.
      prepare: query => (query === updateTitle ? primary.db : replica.db).prepare(query),
      batch: statements => primary.db.batch(statements),
      getBookmark: latestBookmark,
    };
  });
  const db = Object.assign(replica.db, {
    withSession,
    exec: vi.fn(async (query: string) => {
      primary.sql.prepare(query).run();
      return { count: 1, duration: 0 };
    }),
    dump: vi.fn(async () => new ArrayBuffer(1)),
  });
  const env = buildEnv(db);
  const page = new PublicPage({ ...ctx, props: { siteKey: siteId, variantKey: "human" } }, env);
  async function publish() {
    const writer = db.withSession("first-primary");
    await writer.prepare(updateTitle).bind(newTitle, slug).run();
    return writer.getBookmark()!;
  }
  return { primary: primary.db, db, env, ctx, page, withSession, publish };
}

function articleRequest(bookmark?: string) {
  const headers = new Headers({ "x-cms-variant": "human" });
  if (bookmark !== undefined) headers.set("x-cms-bookmark", bookmark);
  return new Request(`https://${host}/article/${slug}`, { headers });
}

function titleIn(db: Pick<D1Database, "prepare">) {
  return db.prepare(readTitle).bind(slug).first<{ title: string }>();
}

afterEach(() => vi.restoreAllMocks());

describe("PublicPage reads after a publish", () => {
  it("renders the new headline at the write bookmark while the raw binding still renders the old one", async () => {
    const { env, ctx, page, withSession, publish } = laggingReplica();
    const bookmark = await publish();
    const request = articleRequest(bookmark);

    // Reproduce the pre-session render with exactly the same request and raw database.
    const stale = await honoFetch(request.clone(), { ...env, EDGE_INNER: "1" }, ctx);
    expect(stale.status).toBe(200);
    expect(await stale.text()).toContain(">" + oldTitle + "</h1>");

    const fresh = await page.fetch(request);
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toContain(">" + newTitle + "</h1>");
    expect(withSession.mock.calls).toEqual([["first-primary"], [bookmark]]);
  });

  it.each([
    ["missing", undefined],
    ["comma-separated", "a,b"],
    ["overlong", "a".repeat(300)],
  ] as const)("renders the new headline using first-primary for a %s bookmark", async (_kind, bookmark) => {
    const { page, withSession, publish } = laggingReplica();
    await publish();
    const response = await page.fetch(articleRequest(bookmark));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(">" + newTitle + "</h1>");
    expect(withSession.mock.calls).toEqual([["first-primary"], ["first-primary"]]);
  });

  it("lets the snapshot builder open its own primary session on the raw binding", async () => {
    const { db, primary, env, ctx, withSession } = laggingReplica();
    primary.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(stmt => stmt.all<T>()));
    const build = vi.spyOn(snapshots, "buildSiteSnapshot");
    const page = new PublicPage({ ...ctx, props: { siteKey: "host:" + host, variantKey: "snap" } }, env);
    const response = await page.fetch(new Request(`https://${host}/__snap`, {
      headers: { "x-cms-bookmark": "render-bookmark" },
    }));
    expect(response.status).toBe(200);
    expect(build).toHaveBeenCalledBefore(withSession);
    expect(withSession.mock.contexts[0]).toBe(db);
    expect(withSession).toHaveBeenCalledExactlyOnceWith("first-primary");
  });
});

describe("renderReadDb", () => {
  it.each(["", "a b", "a\tb", "a\n", "a\x7f", "café", "a".repeat(257)])(
    "falls back to first-primary for invalid bookmark %j", bookmark => {
      const { db } = makeFakeDb();
      db.withSession = vi.fn<D1Database["withSession"]>();
      renderReadDb(db, bookmark);
      expect(db.withSession).toHaveBeenCalledExactlyOnceWith("first-primary");
    },
  );

  it("passes a 256-character visible ASCII bookmark through verbatim", () => {
    const { db } = makeFakeDb();
    db.withSession = vi.fn<D1Database["withSession"]>();
    const bookmark = "!+/=".padEnd(256, "~");
    renderReadDb(db, bookmark);
    expect(db.withSession).toHaveBeenCalledExactlyOnceWith(bookmark);
  });

  it.each(["absent", "throwing"])("keeps the original binding and reads when withSession is %s", async kind => {
    const { db } = makeFakeDb([{ match: readTitle, row: { title: oldTitle } }]);
    if (kind === "throwing") db.withSession = () => { throw new Error("session unavailable"); };
    const renderDb = renderReadDb(db, "bookmark");
    expect(renderDb).toBe(db);
    await expect(titleIn(renderDb)).resolves.toEqual({ title: oldTitle });
  });

  it("commits prepared and batched writes to the primary through the render session", async () => {
    const { db, primary } = laggingReplica();
    const sessionBatch = vi.spyOn(primary, "batch");
    const renderDb = renderReadDb(db, "0");
    await renderDb.prepare(updateTitle).bind(newTitle, slug).run();
    await expect(titleIn(primary)).resolves.toEqual({ title: newTitle });

    const update = renderDb.prepare(updateTitle).bind("Next edit", slug);
    await renderDb.batch([update]);
    expect(sessionBatch).toHaveBeenCalledExactlyOnceWith([update]);
    await expect(titleIn(primary)).resolves.toEqual({ title: "Next edit" });
    await expect(titleIn(db)).resolves.toEqual({ title: oldTitle });
  });

  it("delegates withSession, exec and dump to the original binding", async () => {
    const { db, primary, withSession } = laggingReplica();
    const renderDb = renderReadDb(db, null);
    const next = renderDb.withSession("another-bookmark");
    expect(withSession.mock.calls).toEqual([["first-primary"], ["another-bookmark"]]);
    expect(next).toBe(withSession.mock.results[1]!.value);

    await expect(renderDb.exec("DELETE FROM articles")).resolves.toEqual({ count: 1, duration: 0 });
    expect(db.exec).toHaveBeenCalledExactlyOnceWith("DELETE FROM articles");
    await expect(titleIn(primary)).resolves.toBeNull();
    await expect(titleIn(db)).resolves.toEqual({ title: oldTitle });

    const dump = await renderDb.dump();
    expect(db.dump).toHaveBeenCalledOnce();
    expect(dump).toBe(await vi.mocked(db.dump).mock.results[0]!.value);
  });
});
