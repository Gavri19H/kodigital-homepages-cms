// P4b (register PC-5 / PC-A5) — DateQuestion real type + dynamic token grammar.
//
// Investigation ground: DateQuestion had ZERO app validation — the "date range"
// was fictional (Number(ISO)=NaN dead path), garbage min/max saved silently and
// silently disabled the native constraint. P4b: min/max are real bounds (ISO or
// token); tokens resolve SERVER-side to concrete ISO at config build; the client
// gate is a pure lexical ISO compare; the native attr gets only a literal ISO.

import { describe, expect, it } from "vitest";
import {
  isIsoDate,
  isDateBound,
  resolveDateBound,
  validateSectionContent,
} from "../src/public/leadgen/components/content-schema";
import { validateValue } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";
import { toPublicComponent } from "../src/public/leadgen/config-dto";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { renderDateQuestion } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { runInNewContext } from "node:vm";
import { SECTION_STUDIO_SCRIPT } from "../src/admin/leadgen/ui-section-studio";

const TODAY = "2026-07-17"; // a fixed reference day for the resolver unit tests

describe("P4b PC-5 — the date-token grammar (resolveDateBound, fixed today)", () => {
  const cases: Array<[string, string, string]> = [
    ["today", "2026-07-17", "today"],
    ["+7d", "2026-07-24", "+7 days"],
    ["-1d", "2026-07-16", "-1 day (yesterday)"],
    ["+2w", "2026-07-31", "+2 weeks"],
    ["+1m", "2026-08-17", "+1 month"],
    ["-3m", "2026-04-17", "-3 months"],
    ["year_end", "2026-12-31", "this year end"],
    ["2026-08-01", "2026-08-01", "literal ISO passthrough"],
    ["1990-05-09", "1990-05-09", "literal ISO in the past"],
  ];
  for (const [raw, expected, note] of cases) {
    it(`${raw} → ${expected} (${note})`, () => {
      expect(resolveDateBound(raw, TODAY)).toBe(expected);
    });
  }

  it("month add clamps the day to the target month end (Jan 31 +1m → Feb 28)", () => {
    expect(resolveDateBound("+1m", "2026-01-31")).toBe("2026-02-28");
  });

  it("garbage resolves to null", () => {
    for (const bad of ["", "next tuesday", "2026-13-40", "+7x", "7d", "abc"]) {
      expect(resolveDateBound(bad, TODAY), bad).toBeNull();
    }
  });

  it("isIsoDate rejects non-calendar dates; isDateBound accepts ISO + tokens", () => {
    expect(isIsoDate("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isIsoDate("2024-02-29")).toBe(true); // 2024 is
    expect(isIsoDate("2026-7-1")).toBe(false); // not zero-padded
    for (const ok of ["2026-08-01", "today", "year_end", "+7d", "-2w", "+1m"]) {
      expect(isDateBound(ok), ok).toBe(true);
    }
    for (const bad of ["7d", "tomorrow", "2026/08/01", "+7x"]) {
      expect(isDateBound(bad), bad).toBe(false);
    }
  });
});

describe("P4b PC-5 — content-schema rejects garbage date bounds (400, plain message)", () => {
  const codes = (min: unknown): string[] =>
    validateSectionContent({
      components: [{ type: "DateQuestion", question_id: "q", internal_field: "dob", props: { min } }],
    }).errors.map((e) => e.code);

  it("a garbage min is rejected", () => {
    expect(codes("next-week")).toContain("invalid_field_prop");
    expect(codes(500)).toContain("invalid_field_prop"); // the old numeric-garbage bug
  });
  it("an ISO or token min is accepted", () => {
    expect(codes("2026-08-01")).not.toContain("invalid_field_prop");
    expect(codes("+7d")).not.toContain("invalid_field_prop");
    expect(codes("year_end")).not.toContain("invalid_field_prop");
  });
});

describe("P4b PC-A5 — validateValue date range (lexical ISO compare)", () => {
  const dateComp = (cv: Record<string, unknown>): LgComponentConfig =>
    ({ type: "DateQuestion", question_id: "q", internal_field: "dob", client_validation: cv }) as unknown as LgComponentConfig;

  it("a value before the resolved min FAILS with 'on or after'", () => {
    const f = validateValue(dateComp({ min: "2026-07-24" }), "2026-07-20", false);
    expect(f.map((x) => x.code)).toEqual(["min"]);
    expect(f[0]?.message).toBe("Pick a date on or after 2026-07-24.");
  });
  it("a value after the resolved max FAILS with 'on or before'", () => {
    const f = validateValue(dateComp({ max: "2026-07-24" }), "2026-08-01", false);
    expect(f.map((x) => x.code)).toEqual(["max"]);
    expect(f[0]?.message).toBe("Pick a date on or before 2026-07-24.");
  });
  it("a value within [min,max] passes", () => {
    expect(validateValue(dateComp({ min: "2026-07-01", max: "2026-07-31" }), "2026-07-17", false)).toEqual([]);
  });
  it("boundary dates are inclusive", () => {
    expect(validateValue(dateComp({ min: "2026-07-17", max: "2026-07-17" }), "2026-07-17", false)).toEqual([]);
  });
  it("error_text overrides the range message", () => {
    const f = validateValue(dateComp({ min: "2026-07-24", error_text: "Choose a later date." }), "2026-07-20", false);
    expect(f[0]?.message).toBe("Choose a later date.");
  });
  it("lexical compare is chronologically correct across year/month rollovers", () => {
    // "2026-09-01" > "2026-08-31" and "2027-01-01" > "2026-12-31" lexically
    expect(validateValue(dateComp({ min: "2026-08-31" }), "2026-09-01", false)).toEqual([]);
    expect(validateValue(dateComp({ max: "2026-12-31" }), "2027-01-01", false).map((x) => x.code)).toEqual(["max"]);
  });
});

describe("P4b PC-5 — config-dto resolves token bounds to concrete ISO in client_validation", () => {
  it("a +7d min becomes a resolved ISO date in the projected config", () => {
    const node = { type: "DateQuestion", question_id: "q", internal_field: "dob", props: { min: "+7d", max: "year_end" } } as LeadgenComponentNode;
    const projected = toPublicComponent(node);
    const cv = projected.client_validation as Record<string, unknown>;
    // resolved to a real ISO date, NOT the raw token
    expect(isIsoDate(cv["min"])).toBe(true);
    expect(cv["min"]).not.toBe("+7d");
    // and it equals the pure resolver against the same day the DTO used (today)
    const today = new Date().toISOString().slice(0, 10);
    expect(cv["min"]).toBe(resolveDateBound("+7d", today));
    expect(cv["max"]).toBe(resolveDateBound("year_end", today));
  });
  it("a literal ISO min is passed through unchanged", () => {
    const node = { type: "DateQuestion", question_id: "q", internal_field: "dob", props: { min: "1900-01-01" } } as LeadgenComponentNode;
    const cv = toPublicComponent(node).client_validation as Record<string, unknown>;
    expect(cv["min"]).toBe("1900-01-01");
  });
});

// --- studio Min/Max token editor (vm-probe of the served ES5 island) --------

function sliceFn(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  expect(start, `island fn ${name}`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let d = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") d += 1;
    else if (script[i] === "}" && --d === 0) return script.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

describe("P4b PC-5 — studio collectDateBound writes token / clears / defers custom", () => {
  function makeSandbox(): { run: (expr: string) => unknown } {
    const source = [
      "var __node = null;",
      "var __inputs = {};",
      "function selectedNode() { return __node; }",
      "function afterModelChange() {}",
      // fake document: querySelector('[data-inspector-vprop=\"min\"]') → a stub input
      "var document = { querySelector: function (s) { var m = s.match(/vprop=\"([^\"]+)\"/); if (!m) { return null; } if (!__inputs[m[1]]) { __inputs[m[1]] = { hidden: true, value: '' }; } return __inputs[m[1]]; } };",
      sliceFn(SECTION_STUDIO_SCRIPT, "ensureObj"),
      sliceFn(SECTION_STUDIO_SCRIPT, "cleanupEmpty"),
      sliceFn(SECTION_STUDIO_SCRIPT, "collectDateBound"),
    ].join("\n");
    const sandbox: Record<string, unknown> = {};
    runInNewContext(source, sandbox);
    return { run: (expr) => runInNewContext(expr, sandbox) };
  }
  const sel = (value: string, key: string) => `collectDateBound({ value: '${value}', getAttribute: function () { return '${key}'; } })`;

  it("a token choice stores the token string on props", () => {
    const { run } = makeSandbox();
    run("__node = { type: 'DateQuestion', question_id: 'q', internal_field: 'dob', props: {} };");
    run(sel("+7d", "min"));
    expect(run("__node.props.min")).toBe("+7d");
    // the native date input is hidden in token mode
    expect(run("__inputs.min.hidden")).toBe(true);
  });

  it("'No date limit' ('') clears the bound", () => {
    const { run } = makeSandbox();
    run("__node = { type: 'DateQuestion', question_id: 'q', internal_field: 'dob', props: { min: '+7d' } };");
    run(sel("", "min"));
    // cleanupEmpty removes the now-empty props object entirely — either way, no min
    expect(run("(__node.props && __node.props.min) || null")).toBeNull();
  });

  it("'Custom date…' reveals the date input and does NOT store the sentinel", () => {
    const { run } = makeSandbox();
    run("__node = { type: 'DateQuestion', question_id: 'q', internal_field: 'dob', props: {} };");
    run(sel("__custom__", "max"));
    expect(run("(__node.props && __node.props.max) || null")).toBeNull(); // sentinel never stored
    expect(run("__inputs.max.hidden")).toBe(false); // native picker revealed
  });
});

describe("P4b PC-5 — presets native <input type=date> min/max", () => {
  const DESIGN = defaultFunnelDesign;
  it("emits native min/max for a literal ISO bound", () => {
    const html = renderDateQuestion(
      { type: "DateQuestion", question_id: "q", internal_field: "dob", props: { min: "1900-01-01", max: "2030-12-31" } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).toContain('min="1900-01-01"');
    expect(html).toContain('max="2030-12-31"');
  });
  it("does NOT emit a native token bound (would silently disable the constraint)", () => {
    const html = renderDateQuestion(
      { type: "DateQuestion", question_id: "q", internal_field: "dob", props: { min: "+7d", max: "year_end" } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).not.toContain('min="+7d"');
    expect(html).not.toContain("min=");
    expect(html).not.toContain("max=");
  });
});
