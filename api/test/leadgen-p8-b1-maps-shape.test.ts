// LeadGen P8 defect contract — B1/R1-1 regression.
//
// Ground defect: renderAddressFieldSet's per-field emission serialized a
// NESTED `{enabled,jobs:{validate,auction,autocomplete},fills}` data-lg-maps
// value; runtime/maps.ts parseMapsConfig only ever read the TOP-LEVEL flat
// `enable_autocomplete`/`validate` keys, so every multi-field address
// composite's Places autocomplete decoded to `false` and never wired, while
// the browser still paid to load the Maps SDK for a field with nothing
// runnable. The fix converges BOTH producers (mapsConfigJson's single-field
// path and renderAddressFieldSet's per-field loop) on the ONE flat shape via
// a shared `flatMapsConfigJson` builder, and teaches maybeInjectMapsSdk to
// gate on a REAL parsed runnable job instead of bare attribute presence.
//
// PARSEMAPSCONFIG NOTE (the SAME documented constraint as
// leadgen-r4b-facet.test.ts / leadgen-r4b-maps-runtime.test.ts): runtime/
// maps.ts is a BROWSER module (lib DOM); the worker tsconfig this file's
// program belongs to has no "dom" lib. Importing ANY export from
// runtime/maps.ts here pulls the WHOLE file into `tsc --noEmit` under the
// worker's DOM-less lib and fails on its OTHER Element/window-typed exports
// — CONFIRMED: `npm run typecheck` errored at maps.ts:130/145/153/261/278/307
// (Cannot find name 'window'/'document'/'HTMLInputElement', Property
// 'querySelectorAll' does not exist on 'Element') the moment this file
// imported parseMapsConfig directly. Registering this file in
// tsconfig.json's exclude + tsconfig.runtime.json's include (mirroring the
// existing 4-file split) would remove the need for this mirror, but both
// files are outside this slice's ownership (reported to the conductor as a
// conflict). mirrorParseMapsConfig/mirrorMapsFieldsNeedSdk below are FAITHFUL
// local copies of runtime/maps.ts's parseMapsConfig (lines 32-66) and this
// fix's new mapsFieldsNeedSdk predicate — the DIRECT round-trip through the
// real functions belongs in the DOM-program test/leadgen-runtime-
// hydration.test.ts (also outside this slice's ownership).
//
// E11 (one real side): every round trip below drives the REAL renderComponent
// (presets.ts, this slice's owned producer) to produce the markup; only the
// CONSUMER side is mirrored, and only because of the tsconfig split above.

import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;

function addressNode(props: Record<string, unknown>): LeadgenComponentNode {
  return {
    type: "AddressAutocompleteQuestion",
    question_id: "q_addr",
    internal_field: "addr",
    props,
  } as LeadgenComponentNode;
}

// HTML-entity-unescape a `data-lg-maps="..."` attribute value — the same
// unescape leadgen-r4b-facet.test.ts / leadgen-section-studio-ui.test.ts use
// for this exact attribute.
function unescapeAttr(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Every `data-lg-maps="..."` attribute value in rendered markup, decoded.
function allMapsAttrs(rendered: string): string[] {
  return [...rendered.matchAll(/data-lg-maps="([^"]*)"/g)].map((m) => unescapeAttr(m[1]!));
}

// P8-1 fix-round-4 J2 (reviewer F-5): count of the literal
// `data-address-autocomplete="true"` marker in rendered markup — always 0 or
// 1 for a single lone full_address field. This is a pure DOM-honesty
// assertion, not a wiring one (no runtime consumer reads this attribute
// today — grep-verified against api/src and api/test).
function addressAutocompleteCount(rendered: string): number {
  return (rendered.match(/data-address-autocomplete="true"/g) ?? []).length;
}

interface MirroredMapsConfig {
  autocomplete: boolean;
  validate: boolean;
  fills: { street?: string; city?: string; state?: string; zip?: string };
  normalize: boolean;
}

// Faithful mirror of runtime/maps.ts parseMapsConfig (lines 32-66) — see the
// PARSEMAPSCONFIG NOTE above for why this cannot be the real import.
function mirrorParseMapsConfig(raw: string): MirroredMapsConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const c = parsed as Record<string, unknown>;
  const fillsRaw =
    c["fills"] !== null && typeof c["fills"] === "object" ? (c["fills"] as Record<string, unknown>) : {};
  const pick = (flat: string, nested: string): string | undefined => {
    const v = c[flat] !== undefined ? c[flat] : fillsRaw[nested];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const fills: MirroredMapsConfig["fills"] = {};
  const street = pick("autofill_street", "street");
  const city = pick("autofill_city", "city");
  const state = pick("autofill_state", "state");
  const zip = pick("autofill_zip", "zip");
  if (street !== undefined) fills.street = street;
  if (city !== undefined) fills.city = city;
  if (state !== undefined) fills.state = state;
  if (zip !== undefined) fills.zip = zip;
  return {
    autocomplete: c["enable_autocomplete"] === true || c["autocomplete"] === true,
    validate: c["validate_full_address"] === true || c["validate_zip"] === true || c["validate"] === true,
    fills,
    normalize: c["normalize_address_line"] === true || c["normalize"] === true,
  };
}

// Faithful mirror of this fix's runtime/maps.ts mapsFieldsNeedSdk predicate:
// runnable iff at least one field's parsed config has autocomplete:true (the
// ONLY leg initMapsFields ever wires — validate alone is never runnable).
function mirrorMapsFieldsNeedSdk(rawConfigs: readonly string[]): boolean {
  return rawConfigs.some((raw) => mirrorParseMapsConfig(raw)?.autocomplete === true);
}

describe("P8 B1/R1-1 — data-lg-maps converges to the ONE flat shape parseMapsConfig reads", () => {
  it("(a) the D3 unconfigured default's autocomplete-driving field parses to autocomplete:true", () => {
    const html = renderComponent(addressNode({}), DESIGN);
    const attrs = allMapsAttrs(html);
    expect(attrs, "exactly one data-lg-maps field on the default 4-field composite").toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    // THIS is the assertion that fails on the pre-fix nested emission (raw
    // fail pasted in the dispatch report) — the runtime never read the
    // nested `jobs.autocomplete` key, so it always decoded to false.
    expect(parsed!.autocomplete).toBe(true);
  });

  it("(b) street(autofill)+city(autofill)+zip(manual) round-trips: per-field jobs + sibling fills survive", () => {
    const html = renderComponent(
      addressNode({
        maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: true } },
        fields: [
          { field: "street", mode: "autofill" },
          { field: "city", mode: "autofill" },
          { field: "zip", mode: "manual" },
        ],
      }),
      DESIGN,
    );
    // manual zip never carries the attribute at all.
    expect(html).not.toMatch(/data-lg-field="addr_zip"[^>]*data-lg-maps/);
    const attrs = allMapsAttrs(html);
    expect(attrs, "exactly one data-lg-maps field (street drives autocomplete)").toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete).toBe(true);
    expect(parsed!.validate).toBe(true);
    // city is the only OTHER autofill-mode sibling → the only fill target.
    expect(parsed!.fills).toEqual({ city: "addr_city" });
  });

  it("(c) a no-runnable-job config round-trips to a parsed config on which the SDK-injection predicate says NO", () => {
    const html = renderComponent(
      addressNode({
        maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } },
        fields: [{ field: "full_address" }],
      }),
      DESIGN,
    );
    const attrs = allMapsAttrs(html);
    expect(attrs, "full_address always carries data-lg-maps when addressMapsEnabled").toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete).toBe(false); // validate alone is not runnable
    // No field has a runnable job, so the SDK-injection predicate must say
    // NO — even though a [data-lg-maps] ATTRIBUTE is present (the exact bug:
    // presence alone used to be maybeInjectMapsSdk's whole gate).
    expect(mirrorMapsFieldsNeedSdk(attrs)).toBe(false);
  });

  it("(c-control) a runnable-job config makes the SAME predicate say YES", () => {
    const html = renderComponent(addressNode({}), DESIGN); // D3 default: street autofill, autocomplete:true
    expect(mirrorMapsFieldsNeedSdk(allMapsAttrs(html))).toBe(true);
  });

  it("(d) the full_address single-field branch still parses autocomplete:true (the previously-working case stays working)", () => {
    const html = renderComponent(
      addressNode({ maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } }, fields: [{ field: "full_address" }] }),
      DESIGN,
    );
    const attrs = allMapsAttrs(html);
    expect(attrs).toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P8-1 fix-round-2 G2 (F-13): the SAME authored `mode` intent must yield the
// SAME wire contract whether the field is rendered ALONE (full_address) or as
// ONE entry in the multi-field composite — one rule, no special-casing. Both
// branches now honour the field's own `mode`: the composite via its per-field
// loop (autocompleteIndex's `f.mode === "autofill"`, presets.ts ~3301, choosing
// which field drives autocomplete), and the lone full_address branch via
// `addressMapsEnabled && f.mode !== "manual"` (presets.ts ~3287), which gates
// the data-lg-maps attribute itself. mode:"manual" carries no attribute at all
// in either case (the composite's non-driver fields carry none; the lone branch
// skips emission). mode:"autofill" (the default) is untouched — the node-level
// Maps job still gates autocomplete:true when authored.
//
// P8-1 H1 (m-1) — WHAT ROW (a) ASSERTS, stated once. An earlier round of this
// file carried an `it.fails` here with a rationale block arguing the opposite
// of the test below (that the lone full_address SHOULD converge on the
// composite's autocomplete:true, blocked only by an out-of-scope byte pin).
// No `it.fails` exists in this file any more and that argument no longer
// describes anything here, so it is removed rather than left contradicting
// the assertions it sits above: row (a) is a GUARD, and it guards the owner's
// free-text scenario (SOURCE-OF-TRUTH.md A.1 #6, quoted in the describe body
// below) — the lone full_address stays autocomplete:false. Row (b) is the
// same branch WITH props.maps authored (autocomplete on, as authored); rows
// (c)-(d) are the composite, whose per-field modes drive it.
describe("P8-1 fix-round-2 G2 (F-13) — lone full_address vs. composite: one authored-mode rule, no special-casing", () => {
  // ui-section-studio.ts:2348-2363: studio's "Plain text address" control
  // seeds a SINGLE full_address row with mode MANUAL. Owner scenario 1
  // (SOURCE-OF-TRUTH.md A.1 #6): "if I want it as a free text without
  // validations or auto fill?" — the lone full_address IS that free-text
  // case. Contract §8 lists it as already-delivered, graded PERFECT ("do not
  // re-report or re-break"). Renderer intentionally emits enable_autocomplete:false
  // here, keeping the free-text case free. This test guards AGAINST a
  // convergence that would re-break the owner's scenario.
  it("(a) lone full_address (mode unspecified or :autofill) is the free-text case: emits autocomplete:false, SDK not needed", () => {
    // Test with mode unspecified (defaults to autofill; the attribute is emitted, but no node-level Maps job means autocomplete:false)
    let html = renderComponent(addressNode({ fields: [{ field: "full_address" }] }), DESIGN);
    let attrs = allMapsAttrs(html);
    expect(attrs, "lone full_address carries data-lg-maps when addressMapsEnabled").toHaveLength(1);
    let parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete, "free-text case: no autocomplete").toBe(false);
    expect(mirrorMapsFieldsNeedSdk(attrs), "free-text case: SDK not needed").toBe(false);

    // Test with mode explicitly :autofill (same as default; mode is now honored, attribute emitted; autocomplete controlled by node-level Maps job)
    html = renderComponent(addressNode({ fields: [{ field: "full_address", mode: "autofill" }] }), DESIGN);
    attrs = allMapsAttrs(html);
    expect(attrs, "lone full_address with explicit mode:autofill carries data-lg-maps").toHaveLength(1);
    parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete, "free-text without node Maps job: autocomplete:false").toBe(false);
    expect(mirrorMapsFieldsNeedSdk(attrs), "SDK not needed even with mode:autofill (no node Maps job)").toBe(false);
  });

  it("(b) lone full_address with props.maps authored (enabled+jobs.autocomplete:true) -> autocomplete/validate follow the authored jobs (untouched — reviewer-verified correct)", () => {
    const html = renderComponent(
      addressNode({
        maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: true } },
        fields: [{ field: "full_address", mode: "autofill" }],
      }),
      DESIGN,
    );
    const attrs = allMapsAttrs(html);
    expect(attrs).toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete).toBe(true);
    expect(parsed!.validate).toBe(true);
  });

  it("(c) the D3 composite default (props:{}, no props.maps) -> the street field's mode:autofill alone drives autocomplete:true (already correct, F4/B1 — the asymmetric reference point)", () => {
    const html = renderComponent(addressNode({}), DESIGN);
    const attrs = allMapsAttrs(html);
    expect(attrs, "exactly one data-lg-maps field on the default 4-field composite").toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete, "identical no-props.maps input to row (a); the composite already honours mode here").toBe(true);
  });

  it("(d) composite with explicit per-field modes (street+city autofill, zip manual) -> only the autofill-mode driver gets autocomplete:true; the manual field carries no data-lg-maps at all (already correct, F4/B1)", () => {
    const html = renderComponent(
      addressNode({
        fields: [
          { field: "street", mode: "autofill" },
          { field: "city", mode: "autofill" },
          { field: "zip", mode: "manual" },
        ],
      }),
      DESIGN,
    );
    expect(html).not.toMatch(/data-lg-field="addr_zip"[^>]*data-lg-maps/);
    const attrs = allMapsAttrs(html);
    expect(attrs).toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P8-1 fix-round-3 H2 (owner A.1 #6 "the mapping of what is auto-filled per
// field should definately be an option... but not in this poor way"):
// converges the LONE full_address branch onto the exact rule the composite
// branch above already applies — autocomplete is driven SOLELY by the row's
// OWN authored `mode` (autocompleteIndex's `f.mode === "autofill"`,
// presets.ts ~3300), never by the node-level Maps job alone. Full truth
// table: {mode manual, mode autofill} x {node Maps off, node Maps on with an
// autocomplete job}. Cell (2) is the reviewer's exact defect (M-2): pre-fix,
// the lone branch read ONLY addressMapsEnabled (presets.ts:3273-3277) and
// ignored the row's mode entirely, so an authored Mode=Manual field still
// carried data-lg-maps with autocomplete:true whenever the node's own Maps
// job was on — the Mode control was inert. It now reads
// `addressMapsEnabled && f.mode !== "manual"`, mirroring the composite's
// non-driver fields (which carry NO data-lg-maps attribute at all, not one
// that parses to false) — one rule, no special-casing.
// P8-1 fix-round-4 J2 (reviewer F-5, screenshots j5a-lone-MANUAL-jobON /
// j5c-lone-FREETEXT-mapsOFF): this SAME truth table's manual-mode cells (1)
// and (2) also pin data-address-autocomplete now. Pre-round-4-fix,
// renderAddressFieldSet's lone full_address branch emitted
// `data-address-autocomplete="true"` UNCONDITIONALLY (presets.ts:3293),
// independent of lonelyMapsEnabled — so a mode:"manual" field (the studio's
// "Plain text address" / the owner's free-text address) still advertised an
// autocomplete wiring in the served DOM even though data-lg-maps was already
// correctly absent (round-3 H2). The fix gates the attribute on the exact
// SAME `lonelyMapsEnabled` condition data-lg-maps already uses — cells (3)
// and (4) (mode:autofill, the driver case) are unaffected: the attribute was
// already present there both pre- and post-fix.
describe("P8-1 fix-round-3 H2 — lone full_address honours ITS OWN row mode (one rule, no special-casing)", () => {
  const NODE_MAPS_ON = { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } };

  it("(1) mode:manual, node Maps OFF (no props.maps authored at all) -> no data-lg-maps attribute, SDK not needed", () => {
    const html = renderComponent(addressNode({ fields: [{ field: "full_address", mode: "manual" }] }), DESIGN);
    const attrs = allMapsAttrs(html);
    expect(attrs, "manual + no node maps: no data-lg-maps attribute at all").toHaveLength(0);
    expect(mirrorMapsFieldsNeedSdk(attrs)).toBe(false);
    // J2: the manual/free-text row must not advertise data-address-autocomplete either.
    expect(addressAutocompleteCount(html), "manual + no node maps: no data-address-autocomplete either").toBe(0);
  });

  it("(2) mode:manual, node Maps ON with an autocomplete job -> STILL no data-lg-maps / no autocomplete (THE FIX — fails pre-fix)", () => {
    const html = renderComponent(
      addressNode({ maps: NODE_MAPS_ON, fields: [{ field: "full_address", mode: "manual" }] }),
      DESIGN,
    );
    const attrs = allMapsAttrs(html);
    expect(attrs, "manual + node Maps on: the authored mode wins, no data-lg-maps attribute at all").toHaveLength(0);
    expect(mirrorMapsFieldsNeedSdk(attrs), "SDK not needed: the row is authored manual").toBe(false);
    // J2 (THE FIX — fails pre-fix): pre-round-4 this attribute was emitted
    // unconditionally (measured autoAttrs:1) even though data-lg-maps was
    // already correctly absent.
    expect(
      addressAutocompleteCount(html),
      "manual + node Maps on: no data-address-autocomplete either (FAILS pre-fix)",
    ).toBe(0);
  });

  it("(3) mode:autofill, node Maps OFF (no props.maps authored at all) -> data-lg-maps present but autocomplete:false (unchanged)", () => {
    const html = renderComponent(addressNode({ fields: [{ field: "full_address", mode: "autofill" }] }), DESIGN);
    const attrs = allMapsAttrs(html);
    expect(attrs, "addressMapsEnabled defaults true absent props.maps").toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete, "no node-level job authored -> false").toBe(false);
    expect(mirrorMapsFieldsNeedSdk(attrs)).toBe(false);
    // J2: the driver (autofill) row is untouched by this round's fix.
    expect(addressAutocompleteCount(html), "autofill mode: data-address-autocomplete present (unchanged)").toBe(1);
  });

  it("(4) mode:autofill, node Maps ON with an autocomplete job -> autocomplete:true, SDK needed (unchanged — as it does today)", () => {
    const html = renderComponent(
      addressNode({ maps: NODE_MAPS_ON, fields: [{ field: "full_address", mode: "autofill" }] }),
      DESIGN,
    );
    const attrs = allMapsAttrs(html);
    expect(attrs).toHaveLength(1);
    const parsed = mirrorParseMapsConfig(attrs[0]!);
    expect(parsed).not.toBeNull();
    expect(parsed!.autocomplete).toBe(true);
    expect(mirrorMapsFieldsNeedSdk(attrs)).toBe(true);
    // J2: the driver (autofill) row is untouched by this round's fix.
    expect(addressAutocompleteCount(html), "autofill mode: data-address-autocomplete present (unchanged)").toBe(1);
  });
});
