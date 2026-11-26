// F18 Vehicle database — the visitor page render (backlog F18 Section 3 part
// E, Section 4 "Visitor pages", owner decisions Q6–Q11) and the public config:
// a Buttons / Cards / Dropdown question set to "Source: Vehicle database"
// (props.choice_source = "vehicle") renders its choices from ctx.vehicle in
// the presets.ts markup contract the runtime (runtime/vehicle.ts) reads, and
// every typed-choice node renders byte-identically.

import { describe, expect, it } from "vitest";

import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import {
  renderComponent,
  renderSectionComponents,
  type LeadgenSectionRenderCtx,
} from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { vehicleQuestionCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { toPublicComponent } from "../src/public/leadgen/config-dto";
import type { VehicleRenderData } from "../src/leadgen/vehicles/store";
import type { VehicleMakeFile } from "../src/leadgen/vehicles/format";
import { VEHICLE_TYPED_ANSWER_MAX } from "../src/leadgen/vehicles/props";

const DESIGN = defaultFunnelDesign;

const MAKES = [
  { make_id: 440, name: "Acura", slug: "acura" },
  { make_id: 452, name: "BMW", slug: "bmw" },
  { make_id: 460, name: "Ford", slug: "ford" },
  { make_id: 474, name: "Honda", slug: "honda" },
  { make_id: 499, name: "Kia", slug: "kia" },
  { make_id: 448, name: "Toyota", slug: "toyota" },
  { make_id: 900, name: "Zed <b>&", slug: "zed" },
];
const SAMPLE: VehicleMakeFile = {
  snapshot: "2026-10-05",
  make_id: 448,
  models: [
    { model_id: "m_000000000a", name: "4Runner" },
    { model_id: "m_000000000b", name: "bZ4X" },
    { model_id: "m_000000000c", name: "Camry" },
  ],
  years: [
    { year: 2027, m: [0, 1, 2] },
    { year: 2026, m: [2] },
    { year: 2025, m: [2] },
  ],
};
function vehicleData(over: Partial<VehicleRenderData> = {}): VehicleRenderData {
  return {
    snapshot: "2026-10-05",
    makes: MAKES,
    logos: { toyota: "/media/2026/11/logo-toyota.png", ford: "https://cdn.example.com/ford.png" },
    default_featured: [448, 474, 460],
    sample: null,
    ...over,
  };
}
const ctxWith = (vehicle: VehicleRenderData | null, extra: Partial<LeadgenSectionRenderCtx> = {}): LeadgenSectionRenderCtx => ({
  headline_text: "What car do you drive?",
  subheadline_text: null,
  vehicle,
  ...extra,
});

function node(type: LeadgenComponentNode["type"], props: Record<string, unknown>, extra: Partial<LeadgenComponentNode> = {}): LeadgenComponentNode {
  return {
    type,
    question_id: `q_${String(props["vehicle_asks"] ?? "x")}`,
    question_key: "k",
    internal_field: `vehicle_${String(props["vehicle_asks"] ?? "x")}`,
    // Typed data the Studio keeps for switching back — must never reach the page.
    choices: [{ label: "Typed Toyota", value: "toyota", analytics_id: "typed_1" }],
    ...extra,
    props: {
      choice_source: "vehicle",
      other: { enabled: true, label: "Typed other", choices: [{ label: "Typed Lexus", value: "lexus", analytics_id: "typed_2" }] },
      defaultValue: "toyota",
      ...props,
    },
  } as LeadgenComponentNode;
}
const make = (type: LeadgenComponentNode["type"], props: Record<string, unknown> = {}) => node(type, { vehicle_asks: "make", ...props });
const year = (type: LeadgenComponentNode["type"], props: Record<string, unknown> = {}) =>
  node(type, { vehicle_asks: "year", vehicle_make_field: "vehicle_make", ...props });
const model = (type: LeadgenComponentNode["type"], props: Record<string, unknown> = {}) =>
  node(type, { vehicle_asks: "model", vehicle_make_field: "vehicle_make", vehicle_year_field: "vehicle_year", ...props });

const render = (n: LeadgenComponentNode, ctx: LeadgenSectionRenderCtx | undefined): string =>
  renderComponent(n, DESIGN, 1, ctx === undefined ? undefined : { ctx, suppressContinue: false, deferContinue: false, continueSeen: false, deferredContinue: undefined, errorBoundFields: new Set(), answerKeyClaims: new Map() } as never);
const choiceValues = (html: string): string[] => [...html.matchAll(/<button[^>]*data-lg-choice="([^"]*)"/g)].map((m) => m[1] ?? "");
const otherOptions = (html: string): string[] => {
  const sel = /<select[^>]*data-lg-other-panel[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  return [...sel.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => `${m[1]}=${m[2]}`);
};
const selectOptions = (html: string): string[] => {
  const sel = /<select class="lg-input lg-dropdown"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  return [...sel.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => `${m[1]}=${m[2]}`);
};
const noTypedData = (html: string): void => {
  expect(html).not.toContain("Typed Toyota");
  expect(html).not.toContain("Typed Lexus");
  expect(html).not.toContain("Typed other");
  expect(html).not.toContain('"toyota"');
};

describe("F18 render — Make", () => {
  it("Buttons: the featured makes in the operator's order (saved value = make_id), then 'Other make' listing every other make A→Z by name; typed data ignored", () => {
    const html = render(make("ButtonAnswerGroup", { vehicle_featured_makes: [460, 448] }), ctxWith(vehicleData()));
    expect(html).toContain('data-lg-vehicle="make"');
    expect(html).toContain('data-lg-question="q_make"');
    expect(choiceValues(html)).toEqual(["460", "448"]);
    expect(html).toMatch(/data-lg-other-trigger[^>]*>Other make</);
    expect(otherOptions(html)).toEqual(["=Choose…", "440=Acura", "452=BMW", "474=Honda", "499=Kia", "900=Zed &lt;b&gt;&amp;"]);
    expect(html).not.toContain("data-lg-vtext"); // the Make list is in the page — it never falls back
    noTypedData(html);
  });

  it("Buttons with no featured makes use the default set; a featured make missing from the snapshot is dropped; the 'Other' label is editable", () => {
    expect(choiceValues(render(make("ButtonAnswerGroup"), ctxWith(vehicleData())))).toEqual(["448", "474", "460"]);
    const html = render(make("ButtonAnswerGroup", { vehicle_featured_makes: [12345, 499], vehicle_other_label: "More brands" }), ctxWith(vehicleData()));
    expect(choiceValues(html)).toEqual(["499"]);
    expect(html).toMatch(/data-lg-other-trigger[^>]*>More brands</);
    expect(otherOptions(html)).toContain("448=Toyota");
  });

  it("Cards: each featured make shows its logo (small resized, fixed size, lazy) above its name; no logo ⇒ name only; 4 per row unless columns are set", () => {
    const html = render(make("IconCardAnswerGrid", { vehicle_featured_makes: [448, 474, 460] }), ctxWith(vehicleData()));
    expect(html).toContain("data-lg-vlogos");
    expect(html).toContain("--lg-cols:3"); // 3 featured makes: min(4, 3)
    const toyota = /<button[^>]*data-lg-choice="448"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "";
    expect(toyota).toContain(
      '<img class="lg-card-logo" src="/cdn-cgi/image/height=80,fit=scale-down,format=auto,quality=75/media/2026/11/logo-toyota.png" alt=""' +
        ' srcset="/cdn-cgi/image/height=40,fit=scale-down,format=auto,quality=75/media/2026/11/logo-toyota.png 1x, /cdn-cgi/image/height=80,fit=scale-down,format=auto,quality=75/media/2026/11/logo-toyota.png 2x"' +
        ' width="80" height="40" loading="lazy" decoding="async">',
    );
    expect(toyota.indexOf("lg-card-logo")).toBeLessThan(toyota.indexOf(">Toyota<"));
    expect(toyota).not.toContain("lg-card-icon");
    // Honda has no logo: the name only.
    const honda = /<button[^>]*data-lg-choice="474"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "";
    expect(honda).not.toContain("<img");
    expect(honda).toContain('<span class="lg-card-title">Honda</span>');
    // An off-site logo address gets the bare picture (no /cdn-cgi transform).
    const ford = /<button[^>]*data-lg-choice="460"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "";
    expect(ford).toContain('src="https://cdn.example.com/ford.png" alt=""');
    // Eight featured makes: 4 per row; authored columns win.
    const eight = render(make("ImageCardAnswerGrid", { vehicle_featured_makes: [440, 452, 460, 474, 499, 448, 900] }), ctxWith(vehicleData()));
    expect(eight).toContain("--lg-cols:4");
    expect(render(make("IconCardAnswerGrid", { columns: 3 }), ctxWith(vehicleData()))).toContain("--lg-cols:3");
    noTypedData(html);
  });

  it("Cards on the funnel's first page load their logos eagerly", () => {
    const html = render(make("IconCardAnswerGrid"), ctxWith(vehicleData(), { first_page: true }));
    expect(html).toContain('loading="eager"');
    expect(html).not.toContain('loading="lazy"');
  });

  it("Dropdown and Searchable dropdown: every make A→Z as options, in a wrapper that carries the question hooks", () => {
    for (const type of ["DropdownQuestion", "SearchableDropdownQuestion"] as const) {
      const html = render(make(type, { vehicle_featured_makes: [448] }), ctxWith(vehicleData()));
      expect(selectOptions(html)).toEqual(["=Select…", "440=Acura", "452=BMW", "460=Ford", "474=Honda", "499=Kia", "448=Toyota", "900=Zed &lt;b&gt;&amp;"]);
      expect(html).toMatch(/<div class="[^"]*"[^>]*data-lg-question="q_make"[^>]*data-lg-vehicle="make"/);
      expect(html.includes("data-lg-dropdown-search")).toBe(type === "SearchableDropdownQuestion");
      noTypedData(html);
    }
  });
});

describe("F18 render — Year and Model", () => {
  it("Year on Buttons: N hidden, value-less slots + a hidden 'Older year' + the hidden typed-answer box; the Make field it depends on", () => {
    const html = render(year("ButtonAnswerGroup", { vehicle_year_cards: 4 }), ctxWith(vehicleData()));
    expect(html).toContain('data-lg-vehicle="year"');
    expect(html).toContain('data-lg-vmake="vehicle_make"');
    expect(html).toContain('data-lg-vcards="4"');
    const slots = [...html.matchAll(/<button[^>]*data-lg-vslot hidden[^>]*>([\s\S]*?)<\/button>/g)];
    expect(slots).toHaveLength(4);
    for (const s of slots) {
      expect(s[0]).not.toContain("data-lg-choice");
      expect(s[1]).toContain('<span class="lg-vlabel"></span>');
    }
    expect(html).toMatch(/data-lg-other-trigger hidden[^>]*>Older year</);
    expect(html).toContain(
      `<input class="lg-input lg-vehicle-text" type="text" data-lg-input data-lg-vtext maxlength="${VEHICLE_TYPED_ANSWER_MAX}" placeholder="Type your car&#39;s year"`,
    );
    expect(html).toMatch(/data-lg-vtext[^>]*hidden>/);
    noTypedData(html);
  });

  it("Year on Cards: plain cards (no icon or picture), the label in the card title", () => {
    const html = render(year("IconCardAnswerGrid"), ctxWith(vehicleData()));
    const slots = [...html.matchAll(/<button[^>]*data-lg-vslot hidden[^>]*>([\s\S]*?)<\/button>/g)];
    expect(slots).toHaveLength(6); // default "newest 6 years"
    for (const s of slots) expect(s[1]).toBe('<span class="lg-card-title"></span>');
    expect(html).not.toContain("lg-card-icon");
  });

  it("Year on Dropdown and Model (any kind): a <select> with only its placeholder + the hidden typed-answer box; Model knows its Year field", () => {
    const y = render(year("DropdownQuestion"), ctxWith(vehicleData()));
    expect(selectOptions(y)).toEqual(["=Select…"]);
    expect(y).toContain("data-lg-vtext");
    for (const type of ["SearchableDropdownQuestion", "DropdownQuestion", "ButtonAnswerGroup", "ImageCardAnswerGrid"] as const) {
      const html = render(model(type), ctxWith(vehicleData()));
      expect(html).toContain('data-lg-vyear="vehicle_year"');
      expect(selectOptions(html)).toEqual(["=Select…"]);
      expect(html).toContain('placeholder="Type your car&#39;s model"');
      // Model is one list (Q10): searchable unless it is a plain Dropdown.
      expect(html.includes("data-lg-dropdown-search")).toBe(type !== "DropdownQuestion");
      expect(html).not.toContain("data-lg-vslot");
      noTypedData(html);
    }
  });

  it("Studio sample (ctx.vehicle.sample): Year shows the sample make's newest N years + the older ones, Model its newest year's models, with the sample note", () => {
    const data = vehicleData({ sample: SAMPLE });
    const y = render(year("IconCardAnswerGrid", { vehicle_year_cards: 2 }), ctxWith(data));
    expect(choiceValues(y)).toEqual(["2027", "2026"]);
    expect(otherOptions(y)).toEqual(["=Choose…", "2025=2025"]);
    expect(y).not.toMatch(/data-lg-other-trigger hidden/);
    expect(y).toContain("Sample: Toyota. Visitors see the make they picked.");
    const m = render(model("SearchableDropdownQuestion"), ctxWith(data));
    expect(selectOptions(m)).toEqual(["=Select…", "m_000000000a=4Runner", "m_000000000b=bZ4X", "m_000000000c=Camry"]);
    expect(m).toContain("Sample: Toyota.");
  });
});

describe("F18 render — no readable list, and everything else unchanged", () => {
  it("without ctx.vehicle every vehicle question is a visible typed-answer box with the question hooks (the page never breaks)", () => {
    for (const n of [make("IconCardAnswerGrid"), year("ButtonAnswerGroup"), model("SearchableDropdownQuestion")]) {
      for (const ctx of [ctxWith(null), undefined]) {
        const html = render(n, ctx);
        expect(html).toMatch(/<div class="lg-vehicle"[^>]*data-lg-question="[^"]+"[^>]*data-lg-vehicle="(make|year|model)"/);
        expect(html).toMatch(/<input class="lg-input lg-vehicle-text"[^>]*autocomplete="off">/); // not hidden
        expect(html).not.toContain("<select");
        expect(html).not.toContain("<button");
        noTypedData(html);
      }
    }
  });

  it("a Section with a vehicle question carries the vehicle style rules once; typed-choice nodes beside it render exactly as they do alone", () => {
    const typed: LeadgenComponentNode[] = [
      { type: "ButtonAnswerGroup", question_id: "q_b", internal_field: "b", choices: [{ label: "A", value: "a", analytics_id: "a" }, { label: "B", value: "b", analytics_id: "b" }], props: { other: { enabled: true, label: "More", choices: [{ label: "C", value: "c", analytics_id: "c" }] } } },
      { type: "IconCardAnswerGrid", question_id: "q_i", internal_field: "i", choices: [{ label: "Car", value: "car", analytics_id: "c", icon: "🚗" }], props: {} },
      { type: "DropdownQuestion", question_id: "q_d", internal_field: "d", choices: [{ label: "X", value: "x", analytics_id: "x" }], props: { defaultValue: "x" } },
      { type: "SearchableDropdownQuestion", question_id: "q_s", internal_field: "s", choices: [{ label: "Y", value: "y", analytics_id: "y" }], props: {} },
      // "vehicle" without a valid "This question asks for" stays a typed question.
      { type: "ButtonAnswerGroup", question_id: "q_v", internal_field: "v", choices: [{ label: "Z", value: "z", analytics_id: "z" }], props: { choice_source: "vehicle" } },
    ];
    const ctx = ctxWith(vehicleData());
    const alone = renderSectionComponents(typed, DESIGN, ctxWith(null));
    expect(renderSectionComponents(typed, DESIGN, ctx)).toBe(alone);
    expect(alone).not.toContain("data-lg-vtext");
    expect(alone).not.toContain("lg-card-logo");
    const vehicleNode = make("IconCardAnswerGrid");
    const mixed = renderSectionComponents([vehicleNode, ...typed], DESIGN, ctx);
    // Exactly: the vehicle rules once + the typed-only Section with the
    // vehicle question's markup in front — every typed byte unchanged.
    expect(alone.startsWith('<div class="lg-question-card">')).toBe(true);
    expect(mixed).toBe(
      `<style>${vehicleQuestionCss(DESIGN)}</style>` +
        alone.replace('<div class="lg-question-card">', `<div class="lg-question-card">${render(vehicleNode, ctx)}`),
    );
    expect(vehicleQuestionCss(DESIGN)).toContain(
      "@media (max-width: 480px){.lg-card-grid.lg-card-grid[data-lg-vlogos]{grid-template-columns:repeat(2, minmax(0, 1fr))}",
    );
  });

  // F24 Round 3 (owner 24 Nov 2026, "logos are escaping the square"): with 4
  // make cards per row in a ~320px question card, a card is ~75px wide, but
  // the logo box was a fixed 80×40 — wide logos (Tesla, Subaru, GMC…) spilled
  // out. The logo box now never grows past its card (object-fit keeps the
  // logo's shape), logo cards use slim side padding, and a long make name
  // wraps inside its card instead of running out of it.
  it("keeps every make logo and name inside its card", () => {
    const css = vehicleQuestionCss(DESIGN);
    expect(css).toContain(
      ".lg-card-grid.lg-card-grid[data-lg-vlogos] .lg-card-logo{display:block;width:80px;height:40px;max-width:100%;object-fit:contain}",
    );
    expect(css).toContain(
      ".lg-card-grid.lg-card-grid[data-lg-vlogos] > .lg-card:not(.lg-other-trigger){min-width:0;padding-left:6px;padding-right:6px;overflow-wrap:anywhere}",
    );
    // …and the "Other make" card is one button-tall row, not a 140px card.
    expect(css).toContain(
      ".lg-card-grid.lg-card-grid[data-lg-vlogos] > .lg-other-trigger{grid-column:1 / -1;flex-direction:row;min-height:52px}",
    );
  });
});

describe("F18 public config — a vehicle question carries none of its typed data", () => {
  it("typed choices, the typed 'Other' list, allowed values and the typed default are left out; typed nodes are unchanged", () => {
    const v = toPublicComponent({ ...year("ButtonAnswerGroup"), valid_values: ["toyota"], required: true });
    expect(v.choices).toBeUndefined();
    expect(v.valid_values).toBeUndefined();
    expect(v.default_answer).toBeUndefined();
    expect(v.client_validation).toEqual({ required: true });
    expect(v.props["other"]).toBeUndefined();
    expect(v.props["defaultValue"]).toBeUndefined();
    expect(v.props["vehicle_asks"]).toBe("year");
    expect(v.props["vehicle_make_field"]).toBe("vehicle_make");

    const typedNode: LeadgenComponentNode = { type: "ButtonAnswerGroup", question_id: "q_t", internal_field: "t", choices: [{ label: "A", value: "a", analytics_id: "a" }], props: { defaultValue: "a", other: { enabled: true, choices: [{ label: "C", value: "c", analytics_id: "c" }] } } };
    const t = toPublicComponent(typedNode);
    expect(t.choices).toHaveLength(1);
    expect(t.valid_values).toEqual(["a", "c"]);
    expect(t.default_answer).toEqual({ value: "a", answer_source: "default_applied" });
    expect(t.props).toBe(typedNode.props);
  });
});

describe("F18 render — {make}/{year} headline names", () => {
  const headlines: LeadgenComponentNode[] = [
    { type: "QuestionHeadline", question_id: "h1", bind: "section_headline" } as LeadgenComponentNode,
    { type: "Subheadline", question_id: "h2", bind: "section_subheadline" } as LeadgenComponentNode,
    { type: "Subheadline", question_id: "h3", props: { text: "Your {make}, {year}" } } as LeadgenComponentNode,
  ];
  const sectionCtx = (vehicle: VehicleRenderData | null): LeadgenSectionRenderCtx => ({
    headline_text: "What year is your {make}?",
    subheadline_text: "{year} {make} <i>",
    vehicle,
  });
  const texts = (html: string): string[] => [...html.matchAll(/<(?:h1|p) class="lg-(?:sub)?headline"[^>]*>([^<]*)<\/(?:h1|p)>/g)].map((m) => m[1] ?? "");

  it("Studio / previews (a sample make): the tokens show the sample's name and newest year, escaped; public pages keep the tokens for the engine", () => {
    expect(texts(renderSectionComponents(headlines, DESIGN, sectionCtx(vehicleData({ sample: SAMPLE }))))).toEqual([
      "What year is your Toyota?",
      "2027 Toyota &lt;i&gt;",
      "Your Toyota, 2027",
    ]);
    // Public page (the live list, no sample) and a page without the list: untouched.
    for (const ctx of [sectionCtx(vehicleData()), sectionCtx(null)]) {
      expect(texts(renderSectionComponents(headlines, DESIGN, ctx))).toEqual([
        "What year is your {make}?",
        "{year} {make} &lt;i&gt;",
        "Your {make}, {year}",
      ]);
    }
  });

  it("a sample make whose name holds HTML characters is escaped (text, never markup)", () => {
    const html = renderSectionComponents(headlines.slice(0, 1), DESIGN, sectionCtx(vehicleData({ sample: { ...SAMPLE, make_id: 900 } })));
    expect(texts(html)).toEqual(["What year is your Zed &lt;b&gt;&amp;?"]);
    expect(html).not.toContain("<b>&");
  });
});

describe("F18 render — \"Go to next\" Sections and the 'Other make' search box", () => {
  const GO = '<button type="button" class="lg-btn lg-continue" data-lg-vgo';
  it("in a 'Go to next' Section the typed-answer box gets its own theme Continue — hidden with the box, shown when the page has no list; a normal Section gets none", () => {
    const auto = (vehicle: VehicleRenderData | null) => ctxWith(vehicle, { continue_mode: "auto_advance" });
    const y = render(year("ButtonAnswerGroup"), auto(vehicleData()));
    expect(y).toMatch(/data-lg-vtext[^>]*hidden><button type="button" class="lg-btn lg-continue" data-lg-vgo hidden><span class="lg-btn-label">Continue<\/span><\/button>/);
    expect(y).not.toContain("data-lg-continue");
    expect(render(model("SearchableDropdownQuestion"), auto(vehicleData()))).toContain(`${GO} hidden>`);
    // No readable list: the box shows, so does its Continue.
    expect(render(make("IconCardAnswerGrid"), auto(null))).toContain(`${GO}><span class="lg-btn-label">Continue</span></button>`);
    // A Make with the list never needs the box (or the button).
    expect(render(make("IconCardAnswerGrid"), auto(vehicleData()))).not.toContain("data-lg-vgo");
    // A Section with a normal Continue: nothing extra.
    for (const ctx of [ctxWith(vehicleData(), { continue_mode: "button" }), ctxWith(null)]) {
      expect(render(year("ButtonAnswerGroup"), ctx)).not.toContain("data-lg-vgo");
    }
  });

  // F24 Round 3 (owner 24 Nov 2026): the box moved from above the list to right below it.
  it("Make on Buttons / Cards: a hidden 'Search makes…' box sits right below the 'Other make' list; Year's 'Older year' and typed 'Other' lists get none", () => {
    for (const type of ["ButtonAnswerGroup", "IconCardAnswerGrid"] as const) {
      const html = render(make(type), ctxWith(vehicleData()));
      expect(html).toMatch(/data-lg-vehicle="make" data-lg-searchable/);
      const list = html.indexOf('<select class="lg-input lg-other-select lg-other-panel" data-lg-input data-lg-other-panel hidden aria-label="Other make — choose one">');
      const box = html.indexOf(
        '</select><input class="lg-input lg-dropdown-search" type="text" data-lg-dropdown-search placeholder="Search makes…" aria-label="Search makes" hidden>',
      );
      expect(list).toBeGreaterThan(-1);
      expect(box).toBeGreaterThan(list);
      expect(html.indexOf("<select", list + 1)).toBe(-1);
    }
    expect(render(year("IconCardAnswerGrid"), ctxWith(vehicleData()))).not.toContain("data-lg-dropdown-search");
    const typed = renderComponent({ type: "ButtonAnswerGroup", question_id: "q_t", internal_field: "t", choices: [{ label: "A", value: "a", analytics_id: "a" }], props: { other: { enabled: true, choices: [{ label: "C", value: "c", analytics_id: "c" }] } } }, DESIGN);
    expect(typed).not.toContain("data-lg-dropdown-search");
    expect(typed).not.toContain("data-lg-searchable");
  });
});
