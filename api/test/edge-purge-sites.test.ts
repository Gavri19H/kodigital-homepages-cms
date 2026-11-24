import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import * as images from "../src/ai/generators/image";
import { onPublicChange } from "../src/edge/public-change";
import type { Env } from "../src/env";
import { STEP_KEYS } from "../src/site-provisioning/steps";
import { buildEnv, makeFakeDb, type PlantedList, type PlantedRow, type RecordedCall } from "./helpers/admin-test-kit";

vi.mock("../src/edge/public-change", () => ({ onPublicChange: vi.fn().mockResolvedValue(undefined) }));

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {}, exports: {} };
const siteId = "Site-A";
const site = { id: siteId, domain: "primary.example", name: "Old name", status: "active", activity: "main" };
const siteRow = { match: "FROM sites WHERE id = ?", row: site };
const domains = [
  { hostname: "primary.example", cf_route_id: "route-1" },
  { hostname: "alias.example", cf_route_id: null },
];
const domainList = { match: "FROM domains WHERE site_id = ?", rows: domains };
const siteAndHosts = ["site:site-a", "host:primary.example", "host:alias.example"];
const media = { id: 7, site_id: siteId, storage_key: "hero.png", alt_text: "Old alt", caption: "Old caption" };
const mediaRow = { match: "FROM media WHERE id = ?", row: media };

function fixture(rows: PlantedRow[] = [], lists: PlantedList[] = []) {
  const { db, calls } = makeFakeDb(rows, lists);
  return { env: buildEnv(db), calls };
}

function request(env: Env, method: string, path: string, body?: unknown) {
  return admin.request("/api/admin" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env, ctx);
}

function checkWriteAtPurge(calls: RecordedCall[], sql: string) {
  vi.mocked(onPublicChange).mockImplementationOnce(async () => {
    expect(calls.some(call => call.sql.startsWith(sql)), sql).toBe(true);
  });
}

function expectChange(env: Env, context: typeof ctx | undefined, id: string, tags: string[]) {
  expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, context, {
    siteId: id, tags, reason: expect.any(String),
  });
}

beforeEach(() => {
  vi.mocked(onPublicChange).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("edge purge after a public site write", () => {
  it("purges the site's branding after applying its AI logo", async () => {
    const { env, calls } = fixture([siteRow]);
    env.OPENAI_API_KEY = "test";
    env.OPENAI_IMAGE_MODEL = "gpt-image-2";
    vi.spyOn(images, "generateLogoImage").mockResolvedValueOnce({
      status: "success", media_id: 7, storage_key: "logo.png", ai_generation_id: "gen-1",
      idempotency_key: "logo-1", prompt: "logo", replay: false,
    });
    checkWriteAtPurge(calls, "INSERT INTO site_settings");
    const response = await request(env, "POST", "/ai/logo", { site_id: siteId });
    expect(response.status).toBe(200);
    expectChange(env, ctx, siteId, ["site:site-a"]);
  });

  it("clears cached misses for a newly uploaded site asset", async () => {
    const { env, calls } = fixture([siteRow, { match: "INSERT INTO media", row: media }]);
    env.MEDIA.put = vi.fn();
    const form = new FormData();
    form.append("site_id", siteId);
    form.append("file", new File(["image"], "hero.png", { type: "image/png" }));
    checkWriteAtPurge(calls, "INSERT INTO media");
    const response = await admin.request("/api/admin/media/upload", { method: "POST", body: form }, env, ctx);
    expect(response.status).toBe(201);
    // onPublicChange supplies nf:<site> and snap:<site> for every site write.
    expectChange(env, ctx, siteId, []);
  });

  it.each([{ alt_text: "New alt" }, { caption: "New caption" }])(
    "uses the media row's site when editing %o without a request site_id", async (edit) => {
      const { env, calls } = fixture([mediaRow]);
      checkWriteAtPurge(calls, "UPDATE media");
      expect((await request(env, "PUT", "/media/7", edit)).status).toBe(200);
      expectChange(env, ctx, siteId, ["site:site-a"]);
    },
  );

  it("purges the media owner's site after deleting the row", async () => {
    const { env, calls } = fixture([mediaRow]);
    env.MEDIA.delete = vi.fn();
    checkWriteAtPurge(calls, "DELETE FROM media");
    expect((await request(env, "DELETE", "/media/7")).status).toBe(200);
    expectChange(env, ctx, siteId, ["site:site-a"]);
  });

  it("skips folder-only edits and rejected cross-site writes", async () => {
    const { env } = fixture([mediaRow]);
    expect((await request(env, "PUT", "/media/7", { folder: "archive" })).status).toBe(200);
    expect((await request(env, "DELETE", "/media/7?site_id=Site-B")).status).toBe(403);
    expect(onPublicChange).not.toHaveBeenCalled();
  });

  it("does not treat a caller's site_id as the owner of global media", async () => {
    const { env } = fixture([{ ...mediaRow, row: { ...media, site_id: null } }]);
    env.MEDIA.delete = vi.fn();
    expect((await request(env, "PUT", "/media/7", { site_id: siteId, alt_text: "Shared" })).status).toBe(200);
    expect((await request(env, "DELETE", "/media/7?site_id=" + siteId)).status).toBe(200);
    expect(onPublicChange).not.toHaveBeenCalled();
  });

  it("purges the newly registered host when creating a site", async () => {
    const { env, calls } = fixture([{ match: "FROM verticals WHERE slug = ?", row: { slug: "home" } }]);
    checkWriteAtPurge(calls, "INSERT INTO site_creation_jobs");
    const response = await request(env, "POST", "/sites", { domain: "Fresh.Example", vertical_slug: "home" });
    expect(response.status).toBe(201);
    const { resource } = await response.json<{ resource: { id: string } }>();
    expect(resource.id).toMatch(/^st_/);
    expectChange(env, ctx, resource.id, ["host:fresh.example"]);
  });

  it("does not purge a replayed site creation", async () => {
    const { env } = fixture([
      { match: "FROM verticals WHERE slug = ?", row: { slug: "home" } },
      { match: "FROM site_creation_jobs WHERE idempotency_key = ?", row: { id: "job-1", site_id: siteId } },
      siteRow,
    ]);
    const response = await admin.request("/api/admin/sites", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "existing-job" },
      body: JSON.stringify({ domain: site.domain, vertical_slug: "home" }),
    }, env, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ idempotent_replay: true });
    expect(onPublicChange).not.toHaveBeenCalled();
  });

  it.each([{ name: "New name" }, { status: "disabled" }])(
    "purges the site and all registered hostnames for %o", async (edit) => {
      const { env, calls } = fixture([siteRow], [domainList]);
      checkWriteAtPurge(calls, "UPDATE sites");
      expect((await request(env, "PATCH", "/sites/" + siteId, edit)).status).toBe(200);
      expectChange(env, ctx, siteId, siteAndHosts);
      expect(calls.find(call => call.sql.includes(domainList.match))?.binds).toEqual([siteId]);
    },
  );

  it("captures all hostnames before the delete cascade and submits them in one change", async () => {
    const aliases = Array.from({ length: 101 }, (_, i) => ({ hostname: "alias" + i + ".example", cf_route_id: null }));
    const rows = [domains[0]!, ...aliases];
    const { env, calls } = fixture([siteRow], [{ ...domainList, rows }]);
    checkWriteAtPurge(calls, "DELETE FROM sites");
    const response = await request(env, "DELETE", "/sites/" + siteId);
    expect(response.status).toBe(200);
    expectChange(env, ctx, siteId, ["site:site-a", ...rows.map(row => "host:" + row.hostname)]);
    const read = calls.findIndex(call => call.sql.startsWith("SELECT") && call.sql.includes(domainList.match));
    expect(calls[read]?.binds).toEqual([siteId]);
    expect(read).toBeLessThan(calls.findIndex(call => call.sql.startsWith("DELETE FROM domains")));
  });

  it.each([
    ["primary.example", ["site:site-a", "host:primary.example"]],
    ["saved.example", ["site:site-a", "host:primary.example", "host:saved.example"]],
  ] as const)("merges the prior domain hostname with the stored hostname %s", async (hostname, tags) => {
    const domain = { id: 3, site_id: siteId, hostname: "primary.example", status: "pending", kind: "alias", is_primary: 0 };
    const { env, calls } = fixture([
      { match: "is_primary, status FROM domains WHERE id = ?", row: domain },
      { match: "UPDATE domains", row: { ...domain, hostname, status: "active" } },
    ]);
    checkWriteAtPurge(calls, "UPDATE domains");
    expect((await request(env, "PATCH", "/domains/3", { status: "active" })).status).toBe(200);
    expectChange(env, ctx, siteId, [...tags]);
  });

  it("queues one change for every hostname at launch after the earlier content-version bump", async () => {
    const job = {
      id: "job-1", site_id: siteId, status: "running",
      current_step_index: STEP_KEYS.indexOf("publish_starter_articles"), total_steps: STEP_KEYS.length,
    };
    const { env, calls } = fixture([siteRow, { match: "FROM site_creation_jobs WHERE site_id = ?", row: job }], [domainList]);
    const next = () => request(env, "POST", "/sites/" + siteId + "/provision/next");
    expect(await (await next()).json()).toMatchObject({ current_step: "publish_starter_articles", last_step_status: "completed" });
    expect(calls.some(call => call.sql.startsWith("UPDATE sites SET content_version"))).toBe(true);
    expect(onPublicChange).not.toHaveBeenCalled();

    job.current_step_index = STEP_KEYS.indexOf("update_launch_readiness");
    checkWriteAtPurge(calls, "UPDATE sites SET status = 'active'");
    expect(await (await next()).json()).toMatchObject({ current_step: "update_launch_readiness", completed: true });
    expectChange(env, undefined, siteId, siteAndHosts);
    expect(calls.find(call => call.sql.startsWith("SELECT hostname") && call.sql.includes(domainList.match))?.binds).toEqual([siteId]);
  });

  it("skips the purge if the final write of a site delete fails", async () => {
    const { env } = fixture([siteRow], [domainList]);
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation(sql => {
      if (sql.startsWith("DELETE FROM sites")) throw new Error("delete failed");
      return prepare(sql);
    });
    expect((await request(env, "DELETE", "/sites/" + siteId)).status).toBe(500);
    expect(onPublicChange).not.toHaveBeenCalled();
  });
});
