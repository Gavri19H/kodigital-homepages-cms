// §31.6 durable delivery — the FULL beacon script executed in node:vm with a
// controllable environment: sendBeacon-fail → keepalive-fetch-fail → the
// localStorage retry queue (event_id preserved), backoff respected, flush on
// load/visible/online drains via the recovered channel, queue cap ~50.

import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { listicleBeaconScriptBody } from "../src/public/listicle/runtime";

interface QueueEntry {
  e: { event_id: string; event_type: string };
  n: number;
  t: number;
}

interface BeaconWorld {
  sandbox: Record<string, unknown>;
  storage: Map<string, string>;
  beaconBodies: string[];
  fetchBodies: string[];
  listeners: Map<string, Array<() => void>>;
  queue(): QueueEntry[];
  fire(target: "window" | "document", type: string): void;
  setBeacon(mode: "ok" | "fail" | "absent"): void;
  setFetch(mode: "ok" | "fail" | "absent"): void;
}

function makeWorld(opts: { beacon: "ok" | "fail" | "absent"; fetch: "ok" | "fail" | "absent" }): BeaconWorld {
  const storage = new Map<string, string>();
  const beaconBodies: string[] = [];
  const fetchBodies: string[] = [];
  const listeners = new Map<string, Array<() => void>>();
  let beaconMode = opts.beacon;
  let fetchMode = opts.fetch;

  const addListener = (scope: string) => (type: string, cb: () => void): void => {
    const key = `${scope}:${type}`;
    listeners.set(key, [...(listeners.get(key) ?? []), cb]);
  };

  // Synchronous stand-in for Blob so the sendBeacon mock can read the body
  // inline (a real Blob only exposes async .text()).
  class FakeBlob {
    parts: unknown[];
    type: string;
    constructor(parts: unknown[], opts?: { type?: string }) {
      this.parts = parts;
      this.type = opts?.type ?? "";
    }
    toText(): string {
      return this.parts.map((p) => String(p)).join("");
    }
  }

  function bodyText(body: unknown): string {
    if (typeof body === "string") return body;
    if (body instanceof FakeBlob) return body.toText();
    return String(body);
  }

  const documentObj: Record<string, unknown> = {
    cookie: "ko_sid=vm-sid",
    referrer: "",
    hidden: false,
    addEventListener: addListener("document"),
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const navigatorObj: Record<string, unknown> = {};

  function applyBeacon(): void {
    if (beaconMode === "absent") {
      delete navigatorObj.sendBeacon;
      return;
    }
    navigatorObj.sendBeacon = (_url: string, body: unknown) => {
      if (beaconMode === "fail") return false;
      beaconBodies.push(bodyText(body));
      return true;
    };
  }

  const windowObj: Record<string, unknown> = {
    _LST_SID: "vm-sid",
    __LST_BOOT: { site_id: "st_vm", article_id: "art_vm", lander_v: "ver_vm", article_version_revision: 2 },
    __LST_CTX: { utm_source: "vmsrc" },
    __LST_PAGES: [],
    __LST_CHOSEN: {},
    addEventListener: addListener("window"),
  };

  function applyFetch(): void {
    if (fetchMode === "absent") {
      delete windowObj.fetch;
      delete sandboxRef.fetch;
      return;
    }
    const fetchImpl = (_url: string, init: { body: string }) => ({
      // synchronous thenable — resolves/rejects INLINE so the test needs no
      // event-loop coordination.
      then(onOk: (res: { ok: boolean }) => void, onFail: () => void) {
        if (fetchMode === "ok") {
          fetchBodies.push(init.body);
          onOk({ ok: true });
        } else {
          onFail();
        }
      },
    });
    windowObj.fetch = fetchImpl;
    sandboxRef.fetch = fetchImpl;
  }

  const timers: Array<() => void> = [];
  const sandbox: Record<string, unknown> = {
    window: windowObj,
    document: documentObj,
    navigator: navigatorObj,
    location: { href: "https://tenant.example.com/list" },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    setTimeout: (fn: () => void, _ms: number) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
    Date,
    JSON,
    Math,
    isFinite,
    parseInt,
    Blob: FakeBlob,
  };
  const sandboxRef = sandbox;
  applyBeacon();
  applyFetch();
  vm.createContext(sandbox);
  vm.runInContext(listicleBeaconScriptBody(), sandbox);

  return {
    sandbox,
    storage,
    beaconBodies,
    fetchBodies,
    listeners,
    queue(): QueueEntry[] {
      const raw = storage.get("lst_evq");
      return raw === undefined ? [] : (JSON.parse(raw) as QueueEntry[]);
    },
    fire(target, type) {
      for (const cb of listeners.get(`${target}:${type}`) ?? []) cb();
    },
    setBeacon(mode) {
      beaconMode = mode;
      applyBeacon();
    },
    setFetch(mode) {
      fetchMode = mode;
      applyFetch();
    },
  };
}

describe("§31.6 send chain: sendBeacon → keepalive fetch → localStorage queue", () => {
  it("happy path: sendBeacon accepts the page_view; nothing queued", () => {
    const world = makeWorld({ beacon: "ok", fetch: "fail" });
    expect(world.beaconBodies.length).toBe(1);
    const batch = JSON.parse(world.beaconBodies[0] ?? "{}") as { events: Array<Record<string, unknown>> };
    expect(batch.events[0]?.event_type).toBe("page_view");
    expect(batch.events[0]?.session_id).toBe("vm-sid");
    expect(batch.events[0]?.utm_source).toBe("vmsrc");
    expect(batch.events[0]?.page_view_id).toBeTruthy();
    expect(world.queue()).toEqual([]);
  });

  it("beacon false → keepalive fetch carries the batch", () => {
    const world = makeWorld({ beacon: "fail", fetch: "ok" });
    expect(world.beaconBodies).toEqual([]);
    expect(world.fetchBodies.length).toBe(1);
    expect(world.queue()).toEqual([]);
  });

  it("beacon fail → fetch fail → the event is QUEUED with backoff + attempts", () => {
    const world = makeWorld({ beacon: "fail", fetch: "fail" });
    const queue = world.queue();
    expect(queue.length).toBe(1);
    expect(queue[0]?.e.event_type).toBe("page_view");
    expect(queue[0]?.e.event_id).toBeTruthy();
    expect(queue[0]?.n).toBe(0);
    expect(queue[0]?.t).toBeGreaterThan(Date.now()); // not-before backoff stamp
  });
});

describe("§31.6 flush on load / visibilitychange→visible / online", () => {
  it("a queued event flushes once due, PRESERVING its event_id (idempotency key)", () => {
    const world = makeWorld({ beacon: "fail", fetch: "fail" });
    const queued = world.queue();
    const originalId = queued[0]?.e.event_id ?? "";
    expect(originalId).not.toBe("");

    // channel recovers…
    world.setBeacon("ok");
    // …but the entry is not DUE yet → flush respects the backoff stamp.
    world.fire("window", "load");
    expect(world.queue().length).toBe(1);

    // force due, then flush via 'online'.
    world.storage.set(
      "lst_evq",
      JSON.stringify(world.queue().map((entry) => ({ ...entry, t: Date.now() - 1 }))),
    );
    world.fire("window", "online");
    expect(world.queue()).toEqual([]); // drained
    const flushed = JSON.parse(world.beaconBodies[world.beaconBodies.length - 1] ?? "{}") as {
      events: Array<{ event_id: string }>;
    };
    expect(flushed.events[0]?.event_id).toBe(originalId); // SAME id resent
  });

  it("a failed flush bumps attempts + pushes the not-before stamp out (exponential backoff)", () => {
    const world = makeWorld({ beacon: "fail", fetch: "fail" });
    world.storage.set(
      "lst_evq",
      JSON.stringify(world.queue().map((entry) => ({ ...entry, t: Date.now() - 1 }))),
    );
    const before = world.queue()[0];
    world.fire("document", "visibilitychange"); // visible → flushQ (still failing)
    const after = world.queue()[0];
    expect(after?.n).toBe((before?.n ?? 0) + 1);
    expect(after?.t ?? 0).toBeGreaterThan(Date.now() + 5000); // 5s·2^1 = 10s out
  });

  it("flush batches at most 20 per request (the server cap)", () => {
    const world = makeWorld({ beacon: "fail", fetch: "fail" });
    const entries = Array.from({ length: 30 }, (_, i) => ({
      e: { event_id: `q-${i}`, event_type: "section_impression" },
      n: 0,
      t: Date.now() - 1,
    }));
    world.storage.set("lst_evq", JSON.stringify(entries));
    world.setBeacon("ok");
    world.fire("window", "load");
    const batch = JSON.parse(world.beaconBodies[world.beaconBodies.length - 1] ?? "{}") as {
      events: unknown[];
    };
    expect(batch.events.length).toBe(20);
    expect(world.queue().length).toBe(10); // remainder still queued
  });
});

describe("§31.6 queue cap (~50)", () => {
  it("the queue never exceeds 50 entries — newest are kept", () => {
    const world = makeWorld({ beacon: "ok", fetch: "fail" });
    const entries = Array.from({ length: 55 }, (_, i) => ({
      e: { event_id: `old-${i}`, event_type: "offer_impression" },
      n: 0,
      t: Date.now() + 60_000,
    }));
    world.storage.set("lst_evq", JSON.stringify(entries));
    // force one more enqueue through the real chain.
    world.setBeacon("fail");
    world.setFetch("fail");
    const send = (world.sandbox.window as Record<string, unknown>).__lstScan; // scan is exported; use a fresh page_view instead:
    void send;
    // Trigger an enqueue by flushing nothing — instead simulate a fresh
    // failed send via the script's own path: dispatch 'online' cannot
    // enqueue, so emulate by writing through saveQ-equivalent: the CAP is
    // enforced on SAVE, so a failed flush over the 55 entries re-saves and
    // must clamp to 50.
    world.storage.set(
      "lst_evq",
      JSON.stringify(entries.map((entry) => ({ ...entry, t: Date.now() - 1 }))),
    );
    world.fire("window", "online"); // flush fails → bumpInQ → saveQ clamps
    expect(world.queue().length).toBeLessThanOrEqual(50);
    const ids = world.queue().map((entry) => entry.e.event_id);
    expect(ids).toContain("old-54"); // newest kept
    expect(ids).not.toContain("old-0"); // oldest dropped
  });
});
