// P8-5 J1 regression block — BLOCKED ON PLACEMENT (see report).
// It imports the DOM-lib runtime (engine.ts), so it can only live in a test
// file inside tsconfig.runtime.json (e.g. test/leadgen-runtime-hydration.test.ts)
// or after tsconfig.json/tsconfig.runtime.json move leadgen-runtime-engine.test.ts
// across the split. Requires `export` on syncDualRange in engine.ts.
// Measured: 3 failed / 5 passed pre-fix; 8 passed post-fix.
import { syncDualRange } from "../src/public/leadgen/runtime/engine";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

// ---------------------------------------------------------------------------
// §6.8 two-handle sliders — the value that reaches the buyer (P8-5 J1)
//
// The regression: syncDualRange's gap clamp (written for RAIL drags, so two
// thumbs can never land on the same pixel) also ran on the from_to NUMBER BOX,
// so `step` silently rewrote a typed answer. Measured on the live r2fix funnel
// (min="0" max="100000" step="5000") through real per-character typing, with
// the real POST /lg/auction body read off the wire: a typed max of 40 posted
// 5000, and a typed max of 100 against a typed min of 20000 posted 25000.
//
// These are DOM-stand-in tests of the real shipped function; the behavioural
// proof on the money path is scripts/p8/probe-p85-fromto-clean.mjs (drives the
// live funnel at 1280 + 375 and reads /lg/auction). The rig is anchored to the
// real producer by the first test below: every class, type and attribute it
// models is asserted against renderComponent's own from_to/dual_range output.
// ---------------------------------------------------------------------------

interface FakeStyle {
  left: string;
  width: string;
  props: Record<string, string>;
  setProperty(name: string, value: string): void;
}

interface FakeNode {
  value: string;
  textContent: string;
  style: FakeStyle;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

function fakeNode(attrs: Record<string, string> = {}, value = ""): FakeNode {
  const a: Record<string, string> = { ...attrs };
  return {
    value,
    textContent: "",
    style: {
      left: "",
      width: "",
      props: {},
      setProperty(name: string, v: string): void {
        this.props[name] = v;
      },
    },
    getAttribute: (name) => (name in a ? (a[name] as string) : null),
    setAttribute: (name, v) => {
      a[name] = v;
    },
  };
}

// A <input type=range> SANITIZES an assigned value onto its step grid — the
// behaviour the neighbour-read fix exists for. Measured in Chrome 126 (min=0
// max=100000 step=5000): assigning "40" reads back "0", "42000" reads back
// "40000", "60000" reads back "60000"; the sibling type=number box keeps all
// three verbatim. The rail stand-in reproduces exactly that.
function fakeRail(min: number, max: number, step: number, value: string): FakeNode {
  const node = fakeNode({ type: "range", min: `${min}`, max: `${max}`, step: `${step}` });
  let raw = "";
  const snap = (v: string): string => {
    if (v === "") return "";
    const n = Number(v);
    const grid = min + Math.round((Math.min(Math.max(n, min), max) - min) / step) * step;
    return `${Math.min(grid, max)}`;
  };
  Object.defineProperty(node, "value", {
    get: () => raw,
    set: (v: string) => {
      raw = snap(v);
    },
    enumerable: true,
  });
  node.value = value;
  return node;
}

function dualRig(opts: {
  min: number;
  max: number;
  step: number;
  lo: string;
  hi: string;
  boxes: boolean;
  currency?: string;
}): {
  wrap: Element;
  lo: FakeNode;
  hi: FakeNode;
  boxLo: FakeNode;
  boxHi: FakeNode;
  pills: FakeNode[];
  fill: FakeNode;
  sync: (moved: FakeNode) => string | null;
} {
  const boxAttrs = {
    type: "number",
    min: `${opts.min}`,
    max: `${opts.max}`,
    step: `${opts.step}`,
  };
  const lo = fakeRail(opts.min, opts.max, opts.step, opts.lo);
  const hi = fakeRail(opts.min, opts.max, opts.step, opts.hi);
  const boxLo = fakeNode(boxAttrs, opts.lo);
  const boxHi = fakeNode(boxAttrs, opts.hi);
  const fill = fakeNode();
  const pills = [fakeNode(), fakeNode()];
  const byClass: Record<string, FakeNode[]> = {
    ".lg-range-input-dual": [lo, hi],
    ".lg-input": opts.boxes ? [boxLo, boxHi] : [],
    ".lg-range-handle-value": pills,
  };
  const wrap = {
    getAttribute: (name: string) => (name === "data-currency" ? opts.currency ?? null : null),
    querySelector: (sel: string) => (sel === ".lg-range-fill" ? fill : null),
    querySelectorAll: (sel: string) => byClass[sel] ?? [],
  } as unknown as Element;
  return {
    wrap,
    lo,
    hi,
    boxLo,
    boxHi,
    pills,
    fill,
    sync: (moved) => syncDualRange(wrap, moved as unknown as HTMLInputElement),
  };
}

const FT_LIVE = { min: 0, max: 100000, step: 5000 }; // the live r2fix from_to

describe("§6.8 from_to/dual_range: the typed value that reaches the buyer (P8-5 J1)", () => {
  it("the rig models the markup renderComponent actually emits", () => {
    const render = (sliderType: string): string =>
      renderComponent(
        {
          type: "NumberRangeQuestion",
          question_id: "q_band",
          internal_field: "band",
          props: { ...FT_LIVE, slider_type: sliderType, currency_affix: true, currency: "$" },
        } as unknown as LeadgenComponentNode,
        defaultFunnelDesign,
      );
    const ft = render("from_to");
    const dual = render("dual_range");
    const rails = /<input class="lg-range-input lg-range-input-dual" type="range"[^>]*min="0" max="100000" step="5000"/g;
    const boxes = /<input id="[^"]*" class="lg-input lg-range-(?:from|to)" type="number"[^>]*min="0" max="100000" step="5000"/g;
    // from_to: two rails AND two labelled number boxes (one pair per key).
    expect((ft.match(rails) ?? []).length).toBe(2);
    expect((ft.match(boxes) ?? []).length).toBe(2);
    // dual_range: the SAME two rails, and NO number box at all — so the typed
    // path this describe() is about cannot exist there.
    expect((dual.match(rails) ?? []).length).toBe(2);
    expect((dual.match(boxes) ?? []).length).toBe(0);
    expect(dual).not.toContain(`class="lg-input`);
  });

  it("a typed max BELOW one step keeps its own number (40 stays 40, never 5000)", () => {
    const r = dualRig({ ...FT_LIVE, lo: "0", hi: "100000", boxes: true, currency: "$" });
    r.boxHi.value = "40";
    expect(r.sync(r.boxHi)).toBe("40"); // the RECORDED answer = what was typed
    expect(r.boxHi.value).toBe("40"); // the box is not rewritten under them
    expect(r.pills[1]?.textContent).toBe("$40");
    expect(r.boxLo.value).toBe("0"); // the neighbour never moves
    // The rail sanitizes 40 onto its own grid (browser-owned, measured above);
    // the fill — the PAINTED handle position — still carries the exact value.
    expect(r.hi.value).toBe("0");
    expect(r.fill.style.width).toBe("0%");
  });

  it("a typed value off the step grid is not snapped (42000 stays 42000)", () => {
    const r = dualRig({ ...FT_LIVE, lo: "0", hi: "100000", boxes: true });
    r.boxHi.value = "42000";
    expect(r.sync(r.boxHi)).toBe("42000");
    expect(r.boxHi.value).toBe("42000");
  });

  it("editing the OTHER end reads the typed neighbour from its box, not its snapped rail", () => {
    const r = dualRig({ ...FT_LIVE, lo: "0", hi: "100000", boxes: true });
    r.boxHi.value = "42000";
    expect(r.sync(r.boxHi)).toBe("42000");
    expect(r.hi.value).toBe("40000"); // the rail snapped, as a real rail does
    // Now the visitor types a min. The max side must stay 42000 everywhere:
    // handleInputEvent records ONLY the moved field, so mirroring the rail's
    // 40000 into the box would leave the box reading a number the /lg/auction
    // body never carries (42000) — the F-1 divergence in reverse.
    r.boxLo.value = "10000";
    expect(r.sync(r.boxLo)).toBe("10000");
    expect(r.boxHi.value).toBe("42000");
    expect(r.pills[1]?.textContent).toBe("42,000");
  });

  it("a typed max below the typed min lands on the min itself, never one step past it", () => {
    const r = dualRig({ ...FT_LIVE, lo: "0", hi: "100000", boxes: true, currency: "$" });
    r.boxLo.value = "20000";
    expect(r.sync(r.boxLo)).toBe("20000");
    r.boxHi.value = "100"; // a real ordering conflict: 100 < 20000
    expect(r.sync(r.boxHi)).toBe("20000"); // the nearest legal number, not 25000
    // ...and the correction is visible on every surface at once, so the box can
    // never disagree with the recorded answer.
    expect(r.boxHi.value).toBe("20000");
    expect(r.hi.value).toBe("20000");
    expect(r.pills[1]?.textContent).toBe("$20,000");
    expect(r.boxLo.value).toBe("20000");
  });

  it("bounds still hold: a typed value above the declared max lands on the max", () => {
    const r = dualRig({ ...FT_LIVE, lo: "0", hi: "100000", boxes: true });
    r.boxHi.value = "150000";
    expect(r.sync(r.boxHi)).toBe("100000");
    expect(r.boxHi.value).toBe("100000");
  });

  it("from_to RAIL drags keep the one-step rule (the neighbour never moves)", () => {
    const r = dualRig({ ...FT_LIVE, lo: "0", hi: "100000", boxes: true });
    r.hi.value = "40000";
    expect(r.sync(r.hi)).toBe("40000");
    r.lo.value = "90000"; // dragged past the max handle
    expect(r.sync(r.lo)).toBe("35000"); // 40000 - one step
    expect(r.hi.value).toBe("40000");
  });

  it("dual_range (handles-only) is untouched: values survive, crossings still clamp", () => {
    const d = dualRig({ min: 0, max: 100, step: 1, lo: "0", hi: "100", boxes: false });
    d.hi.value = "95";
    expect(d.sync(d.hi)).toBe("95"); // no clamp — 95 is nowhere near the min
    d.lo.value = "3";
    expect(d.sync(d.lo)).toBe("3");
    d.hi.value = "0"; // Home on the max handle = dragged onto the min
    expect(d.sync(d.hi)).toBe("4"); // one step above the min handle (3)
    expect(d.lo.value).toBe("3"); // the neighbour never moves
  });
});

