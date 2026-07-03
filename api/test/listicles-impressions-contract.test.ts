// §31.5 impression semantics — contract greps over the beacon source
// (thresholds 50%/1000ms/500ms, hidden-tab pause, once-per-(pv,entity)),
// strict-ES5 + node --check byte-parse of BOTH runtime scripts, and a
// vm-driven IntersectionObserver/dwell simulation proving fire-once +
// visibility pause end-to-end at the unit level (the Playwright e2e drives
// the real browser behavior).

import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listicleBeaconScriptBody,
  listicleSelectorScriptBody,
} from "../src/public/listicle/runtime";

const BEACON = listicleBeaconScriptBody();
const SELECTOR = listicleSelectorScriptBody();

// --- contract greps (§31.5 / §31.6 / §31.2 / §31.9) ---------------------------

describe("beacon source — §31.5/§31.6 contract markers", () => {
  it("impression machinery: IO threshold 0.5, dwell 1000ms (section) / 500ms (offer)", () => {
    expect(BEACON).toContain("IntersectionObserver");
    expect(BEACON).toContain("threshold:[0,0.5]");
    expect(BEACON).toContain("intersectionRatio>=0.5");
    expect(BEACON).toContain(",1000,fireSection");
    expect(BEACON).toContain(",500,fireOffer");
  });

  it("pause while document.hidden (visibilitychange) + once per (page_view_id, entity)", () => {
    expect(BEACON).toContain("visibilitychange");
    expect(BEACON).toContain("document.hidden");
    expect(BEACON).toContain("SENT[key]=1");
    expect(BEACON).toContain("clearTimeout");
  });

  it("§31.6 chain: sendBeacon → keepalive fetch → localStorage queue (+ flush triggers, cap, backoff)", () => {
    expect(BEACON).toContain("navigator.sendBeacon");
    expect(BEACON).toContain("keepalive:true");
    expect(BEACON).toContain("localStorage");
    expect(BEACON).toContain("'lst_evq'");
    expect(BEACON).toContain("QMAX=50");
    expect(BEACON).toContain("window.addEventListener('load',flushQ)");
    expect(BEACON).toContain("window.addEventListener('online',flushQ)");
    expect(BEACON).toContain("backoffMs");
  });

  it("§31.4/§31.9: page_view_id mint + pv= stamping into governed /lc anchors; event_id per event", () => {
    expect(BEACON).toContain("window._LST_PVID=PVID");
    expect(BEACON).toContain("pv='+PVID");
    expect(BEACON).toContain("event_id:lstGenId()");
    expect(BEACON).toContain("'/api/lst/track'");
  });

  it("§31.2 twin present in BOTH scripts (one algorithm, FNV-1a seed)", () => {
    expect(BEACON).toContain("0x811c9dc5");
    expect(SELECTOR).toContain("0x811c9dc5");
  });

  it("§15.3 reasons vocabulary in the selector", () => {
    for (const reason of ["single_default", "ab_hash", "rule_match", "fallback"]) {
      expect(SELECTOR).toContain(`'${reason}'`);
    }
    expect(SELECTOR).toContain("__LST_CHOSEN");
  });
});

// --- strict ES5 + node --check -------------------------------------------------

function assertStrictEs5(label: string, source: string): void {
  expect(source, `${label}: arrow fn`).not.toMatch(/=>/);
  expect(source, `${label}: const`).not.toMatch(/\bconst\b/);
  expect(source, `${label}: let`).not.toMatch(/\blet\b/);
  expect(source, `${label}: async`).not.toMatch(/\basync\b/);
  expect(source, `${label}: await`).not.toMatch(/\bawait\b/);
  expect(source, `${label}: template literal`).not.toContain("`");
}

describe("runtime scripts — strict ES5 + byte-parse", () => {
  it("selector + beacon are strict ES5", () => {
    assertStrictEs5("selector", SELECTOR);
    assertStrictEs5("beacon", BEACON);
  });

  it("both parse standalone via node --check", () => {
    const dir = mkdtempSync(join(tmpdir(), "listicles-p7-parse-"));
    for (const [name, source] of [
      ["selector.js", SELECTOR],
      ["beacon.js", BEACON],
    ] as const) {
      const file = join(dir, name);
      writeFileSync(file, source, "utf-8");
      expect(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" })).not.toThrow();
    }
  });
});

// --- vm dwell simulation ---------------------------------------------------------

interface FakeEl {
  attrs: Record<string, string>;
  className: string;
  parentNode: FakeEl | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

function el(className: string, attrs: Record<string, string>, parent: FakeEl | null = null): FakeEl {
  return {
    attrs: { ...attrs },
    className,
    parentNode: parent,
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

interface DwellWorld {
  sent: Array<Record<string, unknown>>;
  ioCallbacks: Array<(entries: unknown[]) => void>;
  observed: FakeEl[];
  timers: Map<number, { fn: () => void; ms: number }>;
  runTimer(id: number): void;
  document: Record<string, unknown>;
  fire(target: "window" | "document", type: string): void;
  clearedTimers: number[];
}

function makeDwellWorld(): DwellWorld {
  const sent: Array<Record<string, unknown>> = [];
  const ioCallbacks: Array<(entries: unknown[]) => void> = [];
  const observed: FakeEl[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const clearedTimers: number[] = [];
  const listeners = new Map<string, Array<() => void>>();
  let timerSeq = 0;

  // DOM graph: page 0 → chosen candidate (with section) → governed anchor.
  const page = el("lst-page", { "data-page-index": "0" });
  const cand = el("lst-cand", { "data-cand": "cand_1", "data-section": "sec_9" }, page);
  const anchor = el(
    "",
    {
      href: "/lc/off_7?a=art_1&pv=",
      "data-offer": "off_7",
      "data-link-instance": "lnk_3",
      "data-block-id": "blk_2",
      "data-link-role": "choice_button",
    },
    cand,
  );

  class FakeBlob {
    parts: unknown[];
    constructor(parts: unknown[]) {
      this.parts = parts;
    }
    toText(): string {
      return this.parts.map((p) => String(p)).join("");
    }
  }

  const documentObj: Record<string, unknown> = {
    cookie: "ko_sid=dwell-sid",
    referrer: "",
    hidden: false,
    addEventListener: (type: string, cb: () => void) => {
      listeners.set(`document:${type}`, [...(listeners.get(`document:${type}`) ?? []), cb]);
    },
    querySelectorAll: (sel: string) => {
      if (sel.startsWith("a[")) return [anchor];
      if (sel === ".lst-page") return [page];
      return [];
    },
    querySelector: (sel: string) => {
      if (sel.includes(".lst-cand[data-cand=")) return cand;
      return null;
    },
  };

  class FakeIO {
    static instances: FakeIO[] = [];
    cb: (entries: unknown[]) => void;
    constructor(cb: (entries: unknown[]) => void) {
      this.cb = cb;
      ioCallbacks.push(cb);
    }
    observe(target: FakeEl): void {
      observed.push(target);
    }
    disconnect(): void {}
    unobserve(): void {}
  }

  const sandbox: Record<string, unknown> = {
    window: {
      _LST_SID: "dwell-sid",
      __LST_BOOT: { site_id: "st_1", article_id: "art_1", lander_v: "ver_1", article_version_revision: 1 },
      __LST_CTX: {},
      __LST_PAGES: [
        {
          page_index: 0,
          mode: "ab_test",
          ab_test_id: "ab_1",
          rule_set_id: "",
          candidates: [{ id: "cand_1", section_id: "sec_9", section_name: "S9", allocation: 100, is_fallback: 0, rule: null }],
        },
      ],
      __LST_CHOSEN: {
        0: { id: "cand_1", rule_id: "", reason: "ab_hash", section_id: "sec_9", section_name: "S9", allocation: 100, rule_priority: null, rule_hash: "" },
      },
      IntersectionObserver: FakeIO,
      addEventListener: (type: string, cb: () => void) => {
        listeners.set(`window:${type}`, [...(listeners.get(`window:${type}`) ?? []), cb]);
      },
    },
    document: documentObj,
    navigator: {
      sendBeacon: (_url: string, body: unknown) => {
        const text = body instanceof FakeBlob ? body.toText() : String(body);
        const parsed = JSON.parse(text) as { events: Array<Record<string, unknown>> };
        sent.push(...parsed.events);
        return true;
      },
    },
    location: { href: "https://tenant.example.com/list" },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    setTimeout: (fn: () => void, ms: number) => {
      timerSeq += 1;
      timers.set(timerSeq, { fn, ms });
      return timerSeq;
    },
    clearTimeout: (id: number) => {
      clearedTimers.push(id);
      timers.delete(id);
    },
    Date,
    JSON,
    Math,
    isFinite,
    parseInt,
    Blob: FakeBlob,
    IntersectionObserver: FakeIO,
  };
  vm.createContext(sandbox);
  vm.runInContext(listicleBeaconScriptBody(), sandbox);

  return {
    sent,
    ioCallbacks,
    observed,
    timers,
    clearedTimers,
    document: documentObj,
    runTimer(id: number) {
      const t = timers.get(id);
      timers.delete(id);
      t?.fn();
    },
    fire(target, type) {
      for (const cb of listeners.get(`${target}:${type}`) ?? []) cb();
    },
  };
}

function entryFor(target: FakeEl, ratio: number): Record<string, unknown> {
  return {
    target,
    isIntersecting: ratio > 0,
    intersectionRatio: ratio,
    rootBounds: { height: 800 },
    boundingClientRect: { height: 300 },
    intersectionRect: { height: 300 * ratio },
  };
}

describe("§31.5 dwell simulation (vm)", () => {
  it("section (1000ms) + offer (500ms) fire ONCE after their dwell; re-entry never re-fires", () => {
    const world = makeDwellWorld();
    // page_view sent on boot.
    expect(world.sent.map((e) => e.event_type)).toEqual(["page_view"]);
    // Both targets observed (chosen candidate + the governed anchor).
    expect(world.observed.length).toBeGreaterThanOrEqual(2);

    const sectionEl = world.observed.find((o) => o.attrs["data-lst-obs-key"]?.startsWith("sec|"));
    const offerEl = world.observed.find((o) => o.attrs["data-lst-obs-key"]?.startsWith("off|"));
    expect(sectionEl).toBeTruthy();
    expect(offerEl).toBeTruthy();

    // ≥50% visible → dwell timers armed with the §31.5 durations.
    const mainIo = world.ioCallbacks[0]!;
    mainIo([entryFor(sectionEl!, 0.6), entryFor(offerEl!, 0.75)]);
    const durations = [...world.timers.values()].map((t) => t.ms).sort((a, b) => a - b);
    expect(durations).toEqual([500, 1000]);

    // dwell elapses → one section_impression + one offer_impression.
    for (const id of [...world.timers.keys()]) world.runTimer(id);
    const types = world.sent.map((e) => e.event_type);
    expect(types).toContain("section_impression");
    expect(types).toContain("offer_impression");
    const offer = world.sent.find((e) => e.event_type === "offer_impression")!;
    expect(offer.offer_id).toBe("off_7");
    expect(offer.link_instance_id).toBe("lnk_3");
    expect(offer.section_id).toBe("sec_9");
    expect(offer.page_candidate_id).toBe("cand_1");

    // scroll out + back in → timers may re-arm but firing is deduped.
    mainIo([entryFor(sectionEl!, 0), entryFor(offerEl!, 0)]);
    mainIo([entryFor(sectionEl!, 0.9), entryFor(offerEl!, 0.9)]);
    for (const id of [...world.timers.keys()]) world.runTimer(id);
    expect(world.sent.filter((e) => e.event_type === "section_impression").length).toBe(1);
    expect(world.sent.filter((e) => e.event_type === "offer_impression").length).toBe(1);
  });

  it("sub-threshold visibility never arms a timer; document.hidden clears pending dwell", () => {
    const world = makeDwellWorld();
    const mainIo = world.ioCallbacks[0]!;
    const sectionEl = world.observed.find((o) => o.attrs["data-lst-obs-key"]?.startsWith("sec|"))!;

    mainIo([entryFor(sectionEl, 0.3)]); // below 50%
    expect(world.timers.size).toBe(0);

    mainIo([entryFor(sectionEl, 0.7)]); // eligible → armed
    expect(world.timers.size).toBe(1);

    // tab hidden → pause (armed timer cleared).
    (world.document as { hidden: boolean }).hidden = true;
    world.fire("document", "visibilitychange");
    expect(world.timers.size).toBe(0);
    expect(world.clearedTimers.length).toBeGreaterThan(0);

    // back to visible while still eligible → dwell restarts, then fires.
    (world.document as { hidden: boolean }).hidden = false;
    world.fire("document", "visibilitychange");
    expect(world.timers.size).toBe(1);
    for (const id of [...world.timers.keys()]) world.runTimer(id);
    expect(world.sent.filter((e) => e.event_type === "section_impression").length).toBe(1);
  });

  it("oversized-element clause: a section TALLER than the viewport counts once it covers ≥50% of it", () => {
    const world = makeDwellWorld();
    const mainIo = world.ioCallbacks[0]!;
    const sectionEl = world.observed.find((o) => o.attrs["data-lst-obs-key"]?.startsWith("sec|"))!;
    // 2000px section in an 800px viewport: ratio maxes at 0.4 — the §31.5
    // letter (0.5) alone would NEVER count it; the documented guard counts
    // it when it covers ≥400px of the viewport.
    mainIo([
      {
        target: sectionEl,
        isIntersecting: true,
        intersectionRatio: 0.4,
        rootBounds: { height: 800 },
        boundingClientRect: { height: 2000 },
        intersectionRect: { height: 780 },
      },
    ]);
    expect(world.timers.size).toBe(1);
  });
});
