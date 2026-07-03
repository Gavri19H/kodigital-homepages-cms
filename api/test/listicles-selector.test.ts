// §15.3 pre-paint selector semantics — the FULL ES5 selector script executed
// in node:vm against a mock document: sticky ab picks (≡ the edge hash),
// single/ab/rule/fallback selection_reason labels, priority-ordered rule
// evaluation over __LST_CTX, §31.3 sid handling (edge-injected sid used;
// client generates ONLY if absent), the pre-paint <style> write, and the
// __lstMat placeholder repoint.

import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { listicleSelectorScriptBody } from "../src/public/listicle/runtime";
import { lstBucket, pickArmIndex } from "../src/public/listicle/ab-hash";

interface ChosenEntry {
  id: string;
  rule_id: string;
  reason: string;
  section_id: string;
  section_name: string;
  allocation: number | null;
  rule_priority: number | null;
  rule_hash: string;
}

interface SelectorRun {
  chosen: Record<string, ChosenEntry>;
  written: string[];
  sid: string;
  cookieWrites: string[];
  sandbox: Record<string, unknown>;
}

interface FakeElement {
  attrs: Record<string, string>;
  className: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(sel: string): FakeElement | null;
}

function runSelector(opts: {
  sid?: string;
  cookie?: string;
  ctx?: Record<string, unknown>;
  pages: unknown[];
  pageEl?: FakeElement | null;
}): SelectorRun {
  const written: string[] = [];
  const cookieWrites: string[] = [];
  let cookie = opts.cookie ?? "";
  const document = {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookieWrites.push(value);
      cookie = `${cookie}${cookie === "" ? "" : "; "}${value.split(";")[0] ?? ""}`;
    },
    write(html: string) {
      written.push(html);
    },
    querySelector() {
      return opts.pageEl ?? null;
    },
    createElement() {
      return { attrs: {}, className: "", setAttribute() {}, appendChild() {} };
    },
  };
  const sandbox: Record<string, unknown> = {};
  const windowObj: Record<string, unknown> = {
    __LST_CTX: opts.ctx ?? {},
    __LST_PAGES: opts.pages,
  };
  if (opts.sid !== undefined) windowObj._LST_SID = opts.sid;
  sandbox.window = windowObj;
  sandbox.document = document;
  vm.createContext(sandbox);
  vm.runInContext(listicleSelectorScriptBody(), sandbox);
  const win = sandbox.window as Record<string, unknown>;
  return {
    chosen: (win.__LST_CHOSEN ?? {}) as Record<string, ChosenEntry>,
    written,
    sid: String(win._LST_SID ?? ""),
    cookieWrites,
    sandbox,
  };
}

function candidate(
  id: string,
  extra: Partial<{
    section_id: string;
    section_name: string;
    allocation: number | null;
    is_fallback: number;
    rule: { id: string; priority: number; conditions: unknown; hash: string } | null;
  }> = {},
): Record<string, unknown> {
  return {
    id,
    section_id: extra.section_id ?? `sec_${id}`,
    section_name: extra.section_name ?? `Section ${id}`,
    allocation: extra.allocation ?? null,
    is_fallback: extra.is_fallback ?? 0,
    rule: extra.rule ?? null,
  };
}

describe("§15.3 selection per mode", () => {
  it("single → candidates[0], reason=single_default", () => {
    const run = runSelector({
      sid: "sid-1",
      pages: [
        { page_index: 0, mode: "single", ab_test_id: "", rule_set_id: "", candidates: [candidate("cand_a"), candidate("cand_b")] },
      ],
    });
    expect(run.chosen["0"]).toMatchObject({ id: "cand_a", reason: "single_default", rule_id: "" });
  });

  it("ab_test → §31.2 hash pick, ≡ the edge implementation, sticky per sid", () => {
    const pages = [
      {
        page_index: 0,
        mode: "ab_test",
        ab_test_id: "ab_77",
        rule_set_id: "",
        candidates: [candidate("cand_a", { allocation: 50 }), candidate("cand_b", { allocation: 50 })],
      },
    ];
    // parity with the edge for many sids + stickiness across repeated runs.
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const sid = `sid-${i}`;
      const expected = pickArmIndex(lstBucket(sid, "ab_77"), [{ allocation: 50 }, { allocation: 50 }]);
      const first = runSelector({ sid, pages }).chosen["0"];
      const again = runSelector({ sid, pages }).chosen["0"];
      expect(first?.id).toBe(expected === 0 ? "cand_a" : "cand_b");
      expect(first?.reason).toBe("ab_hash");
      expect(first?.allocation).toBe(50);
      expect(again?.id).toBe(first?.id); // sticky
      seen.add(first?.id ?? "");
    }
    expect(seen.size).toBe(2); // both arms observed across sids (50/50)
  });

  it("rule_based → priority-ordered first match over __LST_CTX (reason=rule_match, rule dims stamped)", () => {
    const pages = [
      {
        page_index: 2,
        mode: "rule_based",
        ab_test_id: "",
        rule_set_id: "rs_1",
        candidates: [
          candidate("cand_low", {
            rule: { id: "rule_low", priority: 20, conditions: { sets: { device: ["desktop"] } }, hash: "hash_low" },
          }),
          candidate("cand_high", {
            rule: { id: "rule_high", priority: 10, conditions: { sets: { device: ["desktop"], country: ["US"] } }, hash: "hash_high" },
          }),
          candidate("cand_fb", { is_fallback: 1 }),
        ],
      },
    ];
    // Both rules match — the LOWER priority value wins (evaluated first).
    const run = runSelector({ sid: "s", ctx: { device: "desktop", country: "US" }, pages });
    expect(run.chosen["2"]).toMatchObject({
      id: "cand_high",
      reason: "rule_match",
      rule_id: "rule_high",
      rule_priority: 10,
      rule_hash: "hash_high",
    });
    // Only the priority-20 rule matches when country differs.
    const runLow = runSelector({ sid: "s", ctx: { device: "desktop", country: "DE" }, pages });
    expect(runLow.chosen["2"]).toMatchObject({ id: "cand_low", reason: "rule_match", rule_id: "rule_low" });
  });

  it("rule_based with NO matching rule → the fallback candidate, reason=fallback", () => {
    const pages = [
      {
        page_index: 0,
        mode: "rule_based",
        ab_test_id: "",
        rule_set_id: "rs_1",
        candidates: [
          candidate("cand_mob", {
            rule: { id: "rule_m", priority: 10, conditions: { sets: { device: ["mobile"] } }, hash: "h" },
          }),
          candidate("cand_fb", { is_fallback: 1, section_id: "sec_fb" }),
        ],
      },
    ];
    const run = runSelector({ sid: "s", ctx: { device: "desktop" }, pages });
    expect(run.chosen["0"]).toMatchObject({
      id: "cand_fb",
      reason: "fallback",
      rule_id: "",
      section_id: "sec_fb",
      rule_hash: "",
    });
  });

  it("hour ranges evaluate against __LST_CTX.hour (site-tz, half-open)", () => {
    const pages = [
      {
        page_index: 0,
        mode: "rule_based",
        ab_test_id: "",
        rule_set_id: "rs",
        candidates: [
          candidate("cand_morning", {
            rule: { id: "rule_h", priority: 10, conditions: { ranges: { hour: [6, 12] } }, hash: "h" },
          }),
          candidate("cand_fb", { is_fallback: 1 }),
        ],
      },
    ];
    expect(runSelector({ sid: "s", ctx: { hour: 6 }, pages }).chosen["0"]?.id).toBe("cand_morning");
    expect(runSelector({ sid: "s", ctx: { hour: 11 }, pages }).chosen["0"]?.id).toBe("cand_morning");
    expect(runSelector({ sid: "s", ctx: { hour: 12 }, pages }).chosen["0"]?.id).toBe("cand_fb"); // half-open
    expect(runSelector({ sid: "s", ctx: {}, pages }).chosen["0"]?.id).toBe("cand_fb"); // no hour → no match
  });
});

describe("pre-paint style write (§15.3)", () => {
  it("writes .lst-cand hide + a SCOPED show rule per chosen candidate, before any body markup", () => {
    const run = runSelector({
      sid: "sid-1",
      pages: [
        { page_index: 0, mode: "single", ab_test_id: "", rule_set_id: "", candidates: [candidate("cand_x")] },
        { page_index: 1, mode: "single", ab_test_id: "", rule_set_id: "", candidates: [candidate("cand_y")] },
      ],
    });
    expect(run.written.length).toBe(1);
    const css = run.written[0] ?? "";
    expect(css).toContain(".lst-cand{display:none}");
    expect(css).toContain('[data-layout] .lst-cand[data-cand="cand_x"]{display:block}');
    expect(css).toContain('[data-layout] .lst-cand[data-cand="cand_y"]{display:block}');
  });
});

describe("§31.3 sid handling", () => {
  const pages = [
    { page_index: 0, mode: "single", ab_test_id: "", rule_set_id: "", candidates: [candidate("cand_a")] },
  ];

  it("uses the edge-injected _LST_SID; never rewrites the cookie", () => {
    const run = runSelector({ sid: "edge-sid-1", pages });
    expect(run.sid).toBe("edge-sid-1");
    expect(run.cookieWrites).toEqual([]);
  });

  it("falls back to the ko_sid cookie when no injection", () => {
    const run = runSelector({ cookie: "ko_sid=cookie-sid-9", pages });
    expect(run.sid).toBe("cookie-sid-9");
    expect(run.cookieWrites).toEqual([]);
  });

  it("generates a sid ONLY when both are absent (and persists it as ko_sid)", () => {
    const run = runSelector({ pages });
    expect(run.sid).not.toBe("");
    expect(run.cookieWrites.length).toBe(1);
    expect(run.cookieWrites[0]).toContain(`ko_sid=${run.sid}`);
    expect(run.cookieWrites[0]).toContain("max-age=1800");
  });
});

describe("__lstMat — over-budget placeholder repoint", () => {
  it("re-points a pending placeholder at the CHOSEN candidate's /lst-cand URL", () => {
    const placeholder: FakeElement = {
      attrs: {
        "data-cand": "cand_default",
        "data-lst-lazy": "/lst-cand/cand_default",
      },
      className: "lst-cand lst-cand-pending",
      getAttribute(name) {
        return this.attrs[name] ?? null;
      },
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      querySelector() {
        return null;
      },
    };
    const pageEl: FakeElement = {
      attrs: { "data-page-index": "1" },
      className: "lst-page",
      getAttribute(name) {
        return this.attrs[name] ?? null;
      },
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      querySelector(sel: string) {
        if (sel.includes("lst-cand-pending")) return placeholder;
        return null; // the chosen candidate is NOT in the DOM (over budget)
      },
    };
    const run = runSelector({
      sid: "sid-42",
      pages: [
        {
          page_index: 1,
          mode: "ab_test",
          ab_test_id: "ab_1",
          rule_set_id: "",
          candidates: [candidate("cand_default", { allocation: 50 }), candidate("cand_alt", { allocation: 50 })],
        },
      ],
      pageEl,
    });
    const chosen = run.chosen["1"];
    expect(chosen).toBeTruthy();
    const mat = (run.sandbox.window as Record<string, unknown>).__lstMat as (idx: number) => void;
    expect(typeof mat).toBe("function");
    mat(1);
    expect(placeholder.attrs["data-cand"]).toBe(chosen?.id);
    expect(placeholder.attrs["data-lst-lazy"]).toBe(`/lst-cand/${chosen?.id}`);
  });
});
