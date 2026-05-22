import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  purgeForHostname,
  resolveDryRunDefault,
  CLOUDFLARE_CACHE_API_TOKEN,
} from "../src/cache/purge";
import type { Env } from "../src/env";

type Row = {
  site_id: string | null;
  hostname: string;
  status: string;
  dry_run: number;
  payload: string;
  response: string;
  id: number;
};

function makeDbMock(): { db: D1Database; rows: Row[] } {
  const rows: Row[] = [];
  let next = 1;
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T>(): Promise<T | null> {
          if (!sql.startsWith("INSERT INTO cache_purge_log")) return null;
          const row: Row = {
            site_id: bound[0] as string | null,
            hostname: bound[1] as string,
            status: bound[2] as string,
            dry_run: bound[3] as number,
            payload: bound[5] as string,
            response: bound[6] as string,
            id: next++,
          };
          rows.push(row);
          return { id: row.id } as unknown as T;
        },
        async run() { return { success: true, meta: {} } as unknown as D1Result; },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, rows };
}

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  };
}

// Phase-7 forbids any outbound fetch under any code path — assert via spy.
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe("purge: resolveDryRunDefault", () => {
  it("caller true wins", () => expect(resolveDryRunDefault(buildEnv(), true)).toBe(true));
  it("caller false wins even when env='true'", () => expect(resolveDryRunDefault(buildEnv({ SITE_PROVISIONING_DRY_RUN: "true" }), false)).toBe(false));
  it("defaults to true when undefined + env unset", () => expect(resolveDryRunDefault(buildEnv({ SITE_PROVISIONING_DRY_RUN: "" }), undefined)).toBe(true));
  it("defaults to false only when env='false'", () => expect(resolveDryRunDefault(buildEnv({ SITE_PROVISIONING_DRY_RUN: "false" }), undefined)).toBe(false));
});

describe("purge: token binding constant", () => {
  it("exports long-form CLOUDFLARE_CACHE_API_TOKEN", () =>
    expect(CLOUDFLARE_CACHE_API_TOKEN).toBe("CLOUDFLARE_CACHE_API_TOKEN"));
});

describe("purge: protected-domain refusal", () => {
  it("throws for theiwise.com BEFORE any cache_purge_log write", async () => {
    const { db, rows } = makeDbMock();
    await expect(
      purgeForHostname({ env: buildEnv(), db }, { hostname: "theiwise.com" }),
    ).rejects.toThrow(/protected hostname/);
    expect(rows.length).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("throws for STAGING.theiwise.com (case-insensitive)", async () => {
    const { db, rows } = makeDbMock();
    await expect(
      purgeForHostname({ env: buildEnv(), db }, { hostname: "STAGING.theiwise.com" }),
    ).rejects.toThrow(/protected hostname/);
    expect(rows.length).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("purge: dry-run short-circuit", () => {
  it("records completed_dry_run row + zero fetch when dryRun=true", async () => {
    const { db, rows } = makeDbMock();
    const outcome = await purgeForHostname(
      { env: buildEnv(), db },
      { hostname: "kodigital.app", dryRun: true, paths: ["/x", "/y"] },
    );
    expect(outcome.status).toBe("completed_dry_run");
    expect(outcome.skipped_missing_zone).toBe(false);
    expect(outcome.cache_purge_log_id).toBe(1);
    expect(rows[0]?.dry_run).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("defaults to dry-run when caller omits dryRun + env unset", async () => {
    const { db, rows } = makeDbMock();
    const env = buildEnv({ SITE_PROVISIONING_DRY_RUN: "" });
    const outcome = await purgeForHostname({ env, db }, { hostname: "kodigital.app" });
    expect(outcome.status).toBe("completed_dry_run");
    expect(rows[0]?.dry_run).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("purge: live mode guards", () => {
  const liveEnv = (extra: Partial<Env> = {}) =>
    buildEnv({ SITE_PROVISIONING_DRY_RUN: "false", ...extra });

  it("skipped_missing_zone when zone_id is null", async () => {
    const { db, rows } = makeDbMock();
    const outcome = await purgeForHostname(
      { env: liveEnv(), db },
      { hostname: "kodigital.app", dryRun: false, zone_id: null },
    );
    expect(outcome.status).toBe("skipped_missing_zone");
    expect(outcome.skipped_missing_zone).toBe(true);
    expect(rows[0]?.dry_run).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("skipped_missing_zone when zone_id is empty string", async () => {
    const { db, rows } = makeDbMock();
    const outcome = await purgeForHostname(
      { env: liveEnv(), db },
      { hostname: "kodigital.app", dryRun: false, zone_id: "" },
    );
    expect(outcome.status).toBe("skipped_missing_zone");
    expect(rows.length).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("skipped_missing_token when zone set but token unset", async () => {
    const { db, rows } = makeDbMock();
    const outcome = await purgeForHostname(
      { env: liveEnv(), db },
      { hostname: "kodigital.app", dryRun: false, zone_id: "zone_abc" },
    );
    expect(outcome.status).toBe("skipped_missing_token");
    expect(outcome.error).toContain("CLOUDFLARE_CACHE_API_TOKEN");
    expect(rows[0]?.status).toBe("skipped_missing_token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("phase-7 no-op: failed row + zero fetch when all guards pass", async () => {
    const { db, rows } = makeDbMock();
    const env = liveEnv({ CLOUDFLARE_CACHE_API_TOKEN: "tok_phase7" });
    const outcome = await purgeForHostname(
      { env, db },
      { hostname: "kodigital.app", dryRun: false, zone_id: "zone_abc" },
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("live cache-purge disabled in Phase 7");
    expect(rows[0]?.response).toContain("phase7_no_op_live_purge_disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("purge: cache_purge_log row contract", () => {
  it("persists hostname + site_id + JSON payload + action", async () => {
    const { db, rows } = makeDbMock();
    await purgeForHostname(
      { env: buildEnv(), db },
      { hostname: "kodigital.app", paths: ["/", "/feed.xml"], site_id: "st_x" },
    );
    expect(rows[0]?.hostname).toBe("kodigital.app");
    expect(rows[0]?.site_id).toBe("st_x");
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as {
      hostname: string;
      paths: string[];
      action: string;
    };
    expect(payload.hostname).toBe("kodigital.app");
    expect(payload.paths).toEqual(["/", "/feed.xml"]);
    expect(payload.action).toBe("purge_for_hostname");
  });
});
