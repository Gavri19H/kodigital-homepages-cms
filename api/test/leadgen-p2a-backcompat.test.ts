// P2a §R-A back-compat BYTE gate (the phase invariant): content WITHOUT any
// per-choice `style` (and TwoButtonYesNo without props.yesStyle/noStyle) MUST
// render BYTE-IDENTICAL to the pre-P2a output. The fixture
// (fixtures/leadgen-p2a-backcompat/unstyled-choice-render.json) was frozen from
// HEAD before the presets per-choice change; this test re-renders the SAME
// unstyled nodes through the REAL renderComponent and asserts ZERO delta.
// Any non-empty diff here = the additive contract was broken → STOP.
//
// EXCEPTION (2026-07-22, LeadGen Rework §6.7 FIX-FIRST F1): the
// `ButtonAnswerGroup` key is NOT actually pre-P2a bytes any more, and — on
// inspection — never cleanly was. Its 3-choice/unauthored-2-column shape has
// a genuine partial trailing row (remainder 1), so the LATER §6.7 wrapped-
// row-centering feature was always going to touch it once introduced; the
// value already in this fixture (grid-column-start:1, the pre-F1 LEFT-LEAN
// bug's exact output) shows §6.7's original slice had already silently
// re-frozen this ONE key mid-phase, so "byte-identical to pre-P2a" had
// already drifted to "byte-identical to pre-F1 §6.7" before this round ever
// started. F1 (2026-07-22 adversarial review) fixed the centering math
// (doubled-track half-offset), so this key was regenerated AGAIN via a
// fresh, live renderComponent capture (not hand-edited) to reflect the new,
// CORRECTLY-centered output.
//
// F2 (2026-07-22, SAME-DAY adversarial review follow-up): F1's own first
// shape emitted the doubled track count as a literal INLINE
// `grid-template-columns` override, which out-ranked the mobile media-query
// collapse rule by cascade specificity (`.lg-card-grid` stayed doubled at
// 375px instead of collapsing to 1 column — reviewer-proved live in
// Chromium). The fix moved the doubled value to an inline CUSTOM PROPERTY,
// --lg-tracks, instead (presets.ts gridItemColumnEntries's own comment has
// the full mechanism) — so this key was regenerated a THIRD time, again via
// a fresh live capture, to swap `grid-template-columns:repeat(4, minmax(0,
// 1fr))` for `--lg-tracks:repeat(4, minmax(0, 1fr))`.
//
// F2 FOLLOW-UP (same review pass, live-Chromium testing during THIS round's
// OWN new geometry-gate coverage): the per-item grid-column-start/-end are
// ALSO inline, so they ALSO kept demanding a 2-track span once a mobile
// collapse reduced the container to 1 explicit column, forcing the grid to
// fabricate implicit extra columns (live-measured: 5 tracks, "133px 38px
// 38px 38px 38px", not one full-width column). Fixed the SAME way — the
// SAME custom-property indirection, --lg-gc-start/--lg-gc-end — so this key
// was regenerated a FOURTH time to swap `grid-column-end:span 2`/
// `grid-column-start:2` for `--lg-gc-end:span 2`/`--lg-gc-start:2`. The
// centering VALUES themselves (2 and 4, span 2 on every item) are IDENTICAL
// across all 4 captures — only the emission mechanism (property vs custom
// property) ever changed. Every other key in the fixture is unaffected (all
// exact-fit shapes — no partial row, so §6.7/F1/F2 never execute their new
// code paths at all) and remains genuinely pre-P2a.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "leadgen-p2a-backcompat", "unstyled-choice-render.json");
const DESIGN = defaultFunnelDesign;

// The SAME representative unstyled nodes the fixture was frozen from — the 5
// per-choice families exercising choices, badges, subtitles, images, columns.
// Rework §10 removal (test repair, P2): OtherGroupSelector's render leg is
// RETIRED to a fail-safe extinct-type box (own dedicated, non-byte-gate
// coverage in leadgen-components-render.test.ts) — it is no longer a
// "per-choice family" subject for THIS byte gate, so its entry is dropped
// from both this map and the frozen fixture (never silently — see the git
// history of the fixture JSON for the removed key).
const NODES: Record<string, LeadgenComponentNode> = {
  // F1 EXCEPTION (see file header): 3 choices / unauthored 2-column default
  // is a genuine partial row — this key's frozen value is §6.7/F1 output,
  // not pre-P2a bytes (it never cleanly was; see header for the full story).
  ButtonAnswerGroup: {
    type: "ButtonAnswerGroup",
    question_id: "q_bag",
    internal_field: "bag",
    choices: [
      { label: "Allow", value: "allow", analytics_id: "a_allow" },
      { label: "Disallow", value: "disallow", analytics_id: "a_disallow" },
      { label: "Maybe", value: "maybe", analytics_id: "a_maybe" },
    ],
  },
  TwoButtonYesNo: {
    type: "TwoButtonYesNo",
    question_id: "q_yn",
    internal_field: "yn",
    props: { yesLabel: "Yes", noLabel: "No" },
  },
  IconCardAnswerGrid: {
    type: "IconCardAnswerGrid",
    question_id: "q_icon",
    internal_field: "icon",
    choices: [
      { label: "LLC", value: "llc", analytics_id: "a_llc", icon: "🏢", subtitle: "Company", badge: "Popular" },
      { label: "Corp", value: "corp", analytics_id: "a_corp", icon: "🏦" },
    ],
    props: { columns: 2 },
  },
  ImageCardAnswerGrid: {
    type: "ImageCardAnswerGrid",
    question_id: "q_img",
    internal_field: "img",
    choices: [
      { label: "A", value: "a", analytics_id: "a_a", imageMediaId: "media-a", image_alt: "Brand A" },
      { label: "B", value: "b", analytics_id: "a_b", imageMediaId: "media-b", image_alt: "Brand B" },
    ],
    props: { columns: 2, image_fit: "contain" },
  },
  MultiChoiceCardGroup: {
    type: "MultiChoiceCardGroup",
    question_id: "q_multi",
    internal_field: "multi",
    choices: [
      { label: "One", value: "one", analytics_id: "a_one", subtitle: "first" },
      { label: "Two", value: "two", analytics_id: "a_two" },
      { label: "Three", value: "three", analytics_id: "a_three" },
    ],
    props: { min: 1, max: 2, columns: 3 },
  },
};

describe("P2a back-compat byte gate — unstyled choice content is byte-identical to pre-P2a", () => {
  const frozen = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;

  it("the fixture covers every per-choice family this slice touches", () => {
    expect(Object.keys(frozen).sort()).toEqual(Object.keys(NODES).sort());
  });

  for (const [name, node] of Object.entries(NODES)) {
    it(`${name}: re-rendered HTML === frozen pre-P2a HTML (zero delta)`, () => {
      expect(renderComponent(node, DESIGN)).toBe(frozen[name]);
    });
  }
});
