// Section Builder v3.1 REMEDIATION — phase R4b (Google Maps end-to-end).
//
// PURE unit coverage for the answer-normalization-seam facet derivation
// (S3-6, src/leadgen/answers.ts) + the preset translation layer's job/fills
// emission (S3-6/S3-7, src/public/leadgen/components/presets.ts). No DB — the
// real POST /lg/auction wiring is proven in leadgen-r4b-maps-runtime.test.ts.
//
// PARSEMAPSCONFIG NOTE: runtime/maps.ts is a BROWSER module (lib DOM), excluded
// from the worker tsconfig — so this worker-program suite cannot import
// parseMapsConfig directly. The shape-parity pin below therefore mirrors
// parseMapsConfig's nested-`fills` reader (runtime/maps.ts:42-58 pick(flat,
// nested)) with a LOCAL faithful copy + a byte-parity guard on the fills-less
// emission; the direct parseMapsConfig round-trip lives in the DOM-program
// leadgen-runtime-hydration.test.ts.

import { describe, expect, it } from "vitest";
import {
  collectMapsAuctionFields,
  deriveAuctionFacet,
  type LeadgenMapsFieldEnrichment,
} from "../src/leadgen/answers";
import { mapsJobsFor, renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { LeadgenComponentNode, LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";

// A ZIP question node with the given props.maps config.
function zipNode(maps: unknown, field = "zip"): LeadgenComponentNode {
  return {
    type: "ZIPInputQuestion",
    question_id: "q_zip",
    internal_field: field,
    answer_type: "string",
    props: maps === undefined ? {} : { maps },
  } as unknown as LeadgenComponentNode;
}
function content(nodes: LeadgenComponentNode[]): LeadgenSectionContent {
  return { components: nodes } as unknown as LeadgenSectionContent;
}
const newShape = (jobs: Record<string, boolean>, extra: Record<string, unknown> = {}) => ({
  enabled: true,
  jobs,
  ...extra,
});

// Decode a data-lg-maps attribute value (HTML-entity escaped) → the wire JSON,
// exactly like the existing preset-seam test (leadgen-section-studio-ui.test.ts).
function decodeMapsAttr(rendered: string): Record<string, unknown> {
  const m = rendered.match(/data-lg-maps="([^"]*)"/);
  if (m === null) throw new Error("no data-lg-maps attribute in render");
  const decoded = m[1]!
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return JSON.parse(decoded) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// mapsJobsFor — the §9.3 per-field precedence reader now returns `auction`
// ---------------------------------------------------------------------------

describe("R4b S3-6 — mapsJobsFor returns the auction job", () => {
  it("new {enabled,jobs} shape surfaces each job independently (incl. auction)", () => {
    expect(mapsJobsFor(zipNode(newShape({ auction: true })))).toEqual({
      validate: false,
      auction: true,
      autocomplete: false,
    });
    expect(mapsJobsFor(zipNode(newShape({ validate: true, auction: true, autocomplete: true })))).toEqual({
      validate: true,
      auction: true,
      autocomplete: true,
    });
  });

  it("enabled:false zeroes every job (auction included) — per-field OFF", () => {
    expect(mapsJobsFor(zipNode({ enabled: false, jobs: { auction: true } }))).toEqual({
      validate: false,
      auction: false,
      autocomplete: false,
    });
  });

  it("legacy flat shape has no auction concept → auction:false (no-regression)", () => {
    expect(mapsJobsFor(zipNode({ validate_zip: true, enable_autocomplete: true }))).toEqual({
      validate: true,
      auction: false,
      autocomplete: true,
    });
  });
});

// ---------------------------------------------------------------------------
// collectMapsAuctionFields — enumerate the validate/auction ZIP-family fields
// ---------------------------------------------------------------------------

describe("R4b S3-6 — collectMapsAuctionFields", () => {
  it("lists a ZIP field carrying validate and/or auction, with its jobs", () => {
    const fields = collectMapsAuctionFields(
      content([zipNode(newShape({ validate: true, auction: true }), "postal")]),
    );
    expect(fields).toEqual([{ zipField: "postal", validate: true, auction: true }]);
  });

  it("skips a Maps field with NO validate/auction job (autocomplete-only)", () => {
    expect(collectMapsAuctionFields(content([zipNode(newShape({ autocomplete: true }))]))).toEqual([]);
  });

  it("skips a plain (non-Maps) field and enabled:false fields", () => {
    const plain = { type: "TextInputQuestion", question_id: "q_t", internal_field: "name", answer_type: "string", props: {} } as unknown as LeadgenComponentNode;
    expect(collectMapsAuctionFields(content([plain, zipNode({ enabled: false, jobs: { auction: true } })]))).toEqual([]);
  });

  // R2 P5 (SRC-6 field-name SEAM): the contributed ZIP key is the one the
  // RENDERER emits (`{base}_zip`, base = internal_field || question_id ||
  // "address") — the key normalizeAnswers now populates from a driven visitor.
  // The old literal "zip" was an answer nobody has recorded since M9, so the §9
  // facet read an absent value on every authored Address.
  it("AddressAutocompleteQuestion contributes its RENDERED `{base}_zip` sub-field", () => {
    const addr = {
      type: "AddressAutocompleteQuestion",
      question_id: "q_a",
      answer_type: "string",
      props: { maps: newShape({ auction: true }) },
    } as unknown as LeadgenComponentNode;
    expect(collectMapsAuctionFields(content([addr]))).toEqual([
      { zipField: "q_a_zip", validate: false, auction: true },
    ]);
    // a maps.fills override renames the very same slot (one derivation)
    const overridden = {
      type: "AddressAutocompleteQuestion",
      question_id: "q_b",
      internal_field: "home",
      answer_type: "string",
      props: { maps: { ...newShape({ auction: true }), fills: { zip: "home_postal" } } },
    } as unknown as LeadgenComponentNode;
    expect(collectMapsAuctionFields(content([overridden]))).toEqual([
      { zipField: "home_postal", validate: false, auction: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// deriveAuctionFacet — §9 facet from normalized answers (+ optional enrichment)
// ---------------------------------------------------------------------------

describe("R4b S3-6 — deriveAuctionFacet", () => {
  const auctionZip = content([zipNode(newShape({ auction: true }))]);

  it("ZIP-ONLY facet without enrichment (the no-server-key §9.3 degradation)", () => {
    expect(deriveAuctionFacet(auctionZip, { zip: "90210" })).toEqual({ zip: "90210" });
  });

  it("enriches the facet with state/city from the validate leg", () => {
    const enr: Record<string, LeadgenMapsFieldEnrichment> = { zip: { city: "Beverly Hills", state: "CA" } };
    expect(deriveAuctionFacet(auctionZip, { zip: "90210" }, enr)).toEqual({
      zip: "90210",
      state: "CA",
      city: "Beverly Hills",
    });
  });

  it("empty enrichment strings never emit blank state/city keys", () => {
    const enr: Record<string, LeadgenMapsFieldEnrichment> = { zip: { city: "", state: "" } };
    const facet = deriveAuctionFacet(auctionZip, { zip: "10001" }, enr);
    expect(facet).toEqual({ zip: "10001" });
    expect(Object.prototype.hasOwnProperty.call(facet ?? {}, "state")).toBe(false);
  });

  it("null when the auction field's ZIP answer is missing or not 5 digits", () => {
    expect(deriveAuctionFacet(auctionZip, {})).toBeNull();
    expect(deriveAuctionFacet(auctionZip, { zip: "1234" })).toBeNull();
    expect(deriveAuctionFacet(auctionZip, { zip: "abcde" })).toBeNull();
  });

  it("null when no field carries the auction job (validate-only ≠ facet)", () => {
    expect(deriveAuctionFacet(content([zipNode(newShape({ validate: true }))]), { zip: "90210" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S3-7 — mapsConfigJson emits the sibling fills object (stop discarding), and
// stays byte-identical for fills-less content
// ---------------------------------------------------------------------------

// A faithful LOCAL copy of runtime/maps.ts parseMapsConfig's nested-`fills`
// reader (runtime/maps.ts:42-58 pick(flat, nested)) — the consumer contract the
// emitted wire config must satisfy. Kept in lockstep with that module (the
// direct parseMapsConfig round-trip lives in leadgen-runtime-hydration.test.ts).
function fillsAsRuntimeReads(wire: Record<string, unknown>): Record<string, string> {
  const fillsRaw = wire["fills"] !== null && typeof wire["fills"] === "object" ? (wire["fills"] as Record<string, unknown>) : {};
  const pick = (flat: string, nested: string): string | undefined => {
    const v = wire[flat] !== undefined ? wire[flat] : fillsRaw[nested];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const out: Record<string, string> = {};
  for (const slot of ["street", "city", "state", "zip"] as const) {
    const v = pick(`autofill_${slot}`, slot);
    if (v !== undefined) out[slot] = v;
  }
  return out;
}

describe("R4b S3-7 — mapsConfigJson fills emission + parseMapsConfig shape parity", () => {
  it("emits the nested fills object the runtime consumes (when authored)", () => {
    const rendered = renderComponent(
      zipNode(newShape({ autocomplete: true }, { fills: { city: "city_field", state: "state_field" } })),
      defaultFunnelDesign,
    );
    const wire = decodeMapsAttr(rendered);
    expect(wire["fills"]).toEqual({ city: "city_field", state: "state_field" });
    // Shape parity: what parseMapsConfig's reader recovers == what was authored.
    expect(fillsAsRuntimeReads(wire)).toEqual({ city: "city_field", state: "state_field" });
  });

  it("keeps the wire config byte-identical (NO fills key) for fills-less content", () => {
    const wire = decodeMapsAttr(renderComponent(zipNode(newShape({ validate: true })), defaultFunnelDesign));
    expect(wire).toEqual({ enable_autocomplete: false, validate: true });
    expect("fills" in wire).toBe(false);
  });

  it("only non-empty string slots survive (empty/blank slots dropped)", () => {
    const rendered = renderComponent(
      zipNode(newShape({ autocomplete: true }, { fills: { street: "addr_field", city: "", state: 5 } })),
      defaultFunnelDesign,
    );
    const wire = decodeMapsAttr(rendered);
    expect(wire["fills"]).toEqual({ street: "addr_field" });
  });
});
