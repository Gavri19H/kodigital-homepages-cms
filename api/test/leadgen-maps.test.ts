// LeadGen §12.8 / §30.2 Google Maps SERVER module — unit tests.
// validateZip regex, split-key resolution, and validateAddress across the KV
// cache, absent-secret no-op, geocode-ok, malformed, and timeout branches with
// a mocked env.CACHE + global fetch (the listicles test idiom).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  validateZip,
  resolveBrowserMapsKey,
  validateAddress,
  ZIP_CACHE_NAMESPACE,
  LG_ZIP_CACHE_TTL_S,
  GOOGLE_MAPS_BROWSER_KEY,
  GOOGLE_MAPS_SERVER_KEY,
} from "../src/leadgen/maps";
import type { Env } from "../src/env";

// Minimal Map-backed KV stub recording put options (to assert the TTL).
function kvStub() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string; opts?: { expirationTtl?: number } }> = [];
  return {
    store,
    puts,
    kv: {
      get: async (k: string) => (store.has(k) ? store.get(k)! : null),
      put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
        store.set(k, v);
        puts.push({ key: k, value: v, opts });
      },
      delete: async (k: string) => {
        store.delete(k);
      },
    },
  };
}

function makeEnv(secrets: Record<string, string>, kv: unknown): Env {
  return { CACHE: kv, ...secrets } as unknown as Env;
}

function geocodeResponse(components: Array<{ types: string[]; long_name?: string; short_name?: string }>) {
  return {
    ok: true,
    json: async () => ({ results: [{ address_components: components }] }),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateZip — §12.8 /^\\d{5}$/", () => {
  it("accepts exactly 5 digits", () => {
    expect(validateZip("90210")).toBe(true);
    expect(validateZip("00000")).toBe(true);
  });
  it("rejects 4/6-digit, non-numeric, spaced, non-string", () => {
    for (const z of ["9021", "902101", "9021a", " 90210", "90210 ", "abcde", ""]) {
      expect(validateZip(z), z).toBe(false);
    }
    expect(validateZip(90210 as unknown as string)).toBe(false);
    expect(validateZip(undefined as unknown as string)).toBe(false);
  });
});

describe("resolveBrowserMapsKey — §30.2 referrer-restricted browser key", () => {
  it("returns the browser key when the secret is set", () => {
    const env = makeEnv({ [GOOGLE_MAPS_BROWSER_KEY]: "browser-abc" }, kvStub().kv);
    expect(resolveBrowserMapsKey(env)).toBe("browser-abc");
  });
  it("returns null when the browser key is absent (leg no-ops), never the server key", () => {
    const env = makeEnv({ [GOOGLE_MAPS_SERVER_KEY]: "server-xyz" }, kvStub().kv);
    expect(resolveBrowserMapsKey(env)).toBeNull();
  });
});

describe("validateAddress — §12.8 server validate/geocode + §30.2 no-op", () => {
  it("malformed ZIP → invalid, NO fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env = makeEnv({ [GOOGLE_MAPS_SERVER_KEY]: "server-xyz" }, kvStub().kv);
    const r = await validateAddress(env, { zip: "9021" });
    expect(r.status).toBe("invalid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("absent server key → no_op, NO fetch (§30.2)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env = makeEnv({}, kvStub().kv);
    const r = await validateAddress(env, { zip: "90210" });
    expect(r.status).toBe("no_op");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("KV cache HIT → ok from cache, NO fetch", async () => {
    const { kv, store } = kvStub();
    store.set(`${ZIP_CACHE_NAMESPACE}90210`, JSON.stringify({ city: "Beverly Hills", state: "CA" }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env = makeEnv({ [GOOGLE_MAPS_SERVER_KEY]: "server-xyz" }, kv);
    const r = await validateAddress(env, { zip: "90210" });
    expect(r.status).toBe("ok");
    expect(r.cached).toBe(true);
    expect(r.city).toBe("Beverly Hills");
    expect(r.state).toBe("CA");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("KV MISS → geocodes, normalizes distinct fields, POPULATES cache with the 30d TTL", async () => {
    const { kv, store, puts } = kvStub();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      geocodeResponse([
        { types: ["street_number"], long_name: "1600" },
        { types: ["route"], long_name: "Amphitheatre Pkwy" },
        { types: ["locality"], long_name: "Mountain View" },
        { types: ["administrative_area_level_1"], short_name: "CA", long_name: "California" },
        { types: ["postal_code"], long_name: "94043" },
      ]),
    );
    const env = makeEnv({ [GOOGLE_MAPS_SERVER_KEY]: "server-xyz" }, kv);
    const r = await validateAddress(env, { address: "1600 Amphitheatre Pkwy" });
    expect(r.status).toBe("ok");
    expect(r.normalized).toEqual({
      street: "1600 Amphitheatre Pkwy",
      city: "Mountain View",
      state: "CA",
      zip: "94043",
    });
    // cache populated for the resolved ZIP with the 30-day TTL
    expect(store.has(`${ZIP_CACHE_NAMESPACE}94043`)).toBe(true);
    expect(puts[0]?.opts?.expirationTtl).toBe(LG_ZIP_CACHE_TTL_S);
  });

  it("zero results → invalid (never throws)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as unknown as Response);
    const env = makeEnv({ [GOOGLE_MAPS_SERVER_KEY]: "server-xyz" }, kvStub().kv);
    const r = await validateAddress(env, { address: "nowhere-xyzzy" });
    expect(r.status).toBe("invalid");
  });

  it("non-2xx / malformed JSON / network error / timeout → no_op (never throws)", async () => {
    const env = makeEnv({ [GOOGLE_MAPS_SERVER_KEY]: "server-xyz" }, kvStub().kv);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false } as unknown as Response);
    expect((await validateAddress(env, { address: "x" })).status).toBe("no_op");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    expect((await validateAddress(env, { address: "x" })).status).toBe("no_op");

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    expect((await validateAddress(env, { address: "x" })).status).toBe("no_op");
  });

  it("corrupt KV entry is dropped and falls through (no throw)", async () => {
    const { kv, store } = kvStub();
    store.set(`${ZIP_CACHE_NAMESPACE}90210`, "{not json");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      geocodeResponse([
        { types: ["locality"], long_name: "Beverly Hills" },
        { types: ["administrative_area_level_1"], short_name: "CA" },
        { types: ["postal_code"], long_name: "90210" },
      ]),
    );
    const env = makeEnv({ [GOOGLE_MAPS_SERVER_KEY]: "server-xyz" }, kv);
    const r = await validateAddress(env, { zip: "90210" });
    expect(r.status).toBe("ok");
    expect(r.cached).toBeUndefined(); // came from geocode, not the corrupt cache
  });
});
