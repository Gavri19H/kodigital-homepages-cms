// v2.5 contract test `image-card-choice-data` — RENDER leg (08 §8.4 choice
// depth on the icon/image card presets).
//
// A choice carrying image/alt/title/subtitle/badge/value renders ALL of them;
// `disabled` rides the native attribute + aria-disabled; `aria_label` is the
// explicit accessible name; `emoji` renders where the icon would; image fit
// (cover|contain) rides object-fit on the card image; `description` stays the
// legacy read alias for subtitle. Choices WITHOUT any new field render
// BYTE-IDENTICALLY to the pre-change markup (pinned below as literal
// snapshots captured from the pre-change renderer). Subtitle/badge styling is
// token-driven via the TWO NEW `iconCard.subtitle*` / `iconCard.badge*` slot
// groups (designs/default-funnel/tokens.ts defaultFunnelIconCardDepthSlots).
//
// NOTE (slice boundary): the save→config→render chain legs of
// `image-card-choice-data` (admin save/PATCH accepting the new fields, config
// DTO projection, media picker/alt validation) belong to the INTEGRATION
// slice; this file proves the renderer leg.

import { describe, expect, it } from "vitest";
import type {
  LeadgenChoice,
  LeadgenComponentNode,
} from "../src/public/leadgen/components/content-schema";
import { renderComponent } from "../src/public/leadgen/components/presets";
import {
  defaultFunnelDesign,
  defaultFunnelIconCardDepthSlots,
} from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;

const imageGrid = (choices: LeadgenChoice[]): LeadgenComponentNode => ({
  type: "ImageCardAnswerGrid",
  question_id: "q_make",
  internal_field: "car_make",
  answer_type: "enum",
  choices,
});
const iconGrid = (choices: LeadgenChoice[]): LeadgenComponentNode => ({
  type: "IconCardAnswerGrid",
  question_id: "q_biz",
  internal_field: "business_type",
  answer_type: "enum",
  choices,
});

// --- pre-change byte snapshots (captured from the renderer BEFORE this
// slice's change landed; the no-new-fields legs must reproduce them) --------
//
// Rework §6.7 (test repair, P2): effective columns are now min(authored,
// choiceCount) — these 2-choice fixtures author NO columns, so the design
// default (3) is now correctly clamped down to 2 (the exact #9 under-filled-
// grid bug the contract fixes: a 2-choice grid no longer renders a 3rd empty
// column). --lg-cols:3 → --lg-cols:2 is the ONLY delta; every other byte
// (label/helper/choice markup) is unchanged since neither fixture authors any
// new §6.3/§6.5/§6.6 prop.

const SNAPSHOT_IMAGE_LEGACY =
  `<div class="lg-card-grid" role="radiogroup" data-component-type="ImageCardAnswerGrid"` +
  ` data-question-id="q_make" data-internal-field="car_make" data-answer-type="enum"` +
  ` data-lg-question="q_make" data-lg-field="car_make" style="--lg-cols:2;gap:0.5rem">` +
  `<button type="button" class="lg-card" role="radio" aria-checked="false" data-value="toyota"` +
  ` data-lg-choice="toyota" data-analytics-id="mk_toyota">` +
  `<img class="lg-card-img" src="/media/med_toyota" alt="Toyota" loading="lazy">` +
  `<span class="lg-card-title">Toyota</span></button>` +
  `<button type="button" class="lg-card" role="radio" aria-checked="false" data-value="honda"` +
  ` data-lg-choice="honda" data-analytics-id="mk_honda">` +
  `<img class="lg-card-img" src="/media/med_honda" alt="Honda" loading="lazy">` +
  `<span class="lg-card-title">Honda</span>` +
  `<span class="lg-card-desc">Reliable pick</span></button></div>`;

const SNAPSHOT_ICON_LEGACY =
  `<div class="lg-card-grid" role="radiogroup" data-component-type="IconCardAnswerGrid"` +
  ` data-question-id="q_biz" data-internal-field="business_type" data-answer-type="enum"` +
  ` data-lg-question="q_biz" data-lg-field="business_type" style="--lg-cols:2;gap:0.5rem">` +
  `<button type="button" class="lg-card" role="radio" aria-checked="false" data-value="llc"` +
  ` data-lg-choice="llc" data-analytics-id="bt_llc">` +
  `<span class="lg-card-icon" style="color:#1B3A5C" aria-hidden="true">🏢</span>` +
  `<span class="lg-card-title">LLC</span></button>` +
  `<button type="button" class="lg-card" role="radio" aria-checked="false" data-value="sole"` +
  ` data-lg-choice="sole" data-analytics-id="bt_sole">` +
  `<span class="lg-card-icon" style="color:#1B3A5C" aria-hidden="true">👤</span>` +
  `<span class="lg-card-title">Sole Prop</span>` +
  `<span class="lg-card-desc">Just you</span></button></div>`;

describe("image-card-choice-data — absent new fields render byte-identically (§8.4 additive)", () => {
  it("ImageCardAnswerGrid with only legacy choice fields === the pre-change snapshot", () => {
    const node = imageGrid([
      { label: "Toyota", value: "toyota", analytics_id: "mk_toyota", imageMediaId: "med_toyota" },
      {
        label: "Honda",
        value: "honda",
        analytics_id: "mk_honda",
        imageMediaId: "med_honda",
        description: "Reliable pick",
      },
    ]);
    expect(renderComponent(node, DESIGN)).toBe(SNAPSHOT_IMAGE_LEGACY);
  });

  it("IconCardAnswerGrid with only legacy choice fields === the pre-change snapshot", () => {
    const node = iconGrid([
      { label: "LLC", value: "llc", analytics_id: "bt_llc", icon: "🏢" },
      { label: "Sole Prop", value: "sole", analytics_id: "bt_sole", icon: "👤", description: "Just you" },
    ]);
    expect(renderComponent(node, DESIGN)).toBe(SNAPSHOT_ICON_LEGACY);
  });
});

describe("image-card-choice-data — full-depth choice renders image/alt/title/subtitle/badge/value (§8.4)", () => {
  const full: LeadgenChoice = {
    label: "Toyota",
    value: "toyota",
    analytics_id: "mk_toyota",
    imageMediaId: "med_toyota",
    image_alt: "Toyota logo",
    title: "Toyota Motors",
    subtitle: "Most popular pick",
    badge: "Popular",
  };
  const html = renderComponent(imageGrid([full]), DESIGN);

  it("renders the image with the authored alt (image_alt beats the label fallback)", () => {
    expect(html).toContain(`<img class="lg-card-img" src="/media/med_toyota" alt="Toyota logo"`);
    expect(html).not.toContain(`alt="Toyota"`);
  });

  it("renders the title in the card-title slot (label stays the stored value only)", () => {
    expect(html).toContain(`<span class="lg-card-title">Toyota Motors</span>`);
  });

  it("renders the subtitle via the NEW iconCard.subtitle* token slots (inline, token-driven)", () => {
    expect(html).toContain(
      `<span class="lg-card-desc lg-card-subtitle" style="font-size:` +
        `${defaultFunnelIconCardDepthSlots.subtitleFontSize};color:` +
        `${defaultFunnelIconCardDepthSlots.subtitleColor}">Most popular pick</span>`,
    );
  });

  it("renders the badge via the NEW iconCard.badge* token slots (inline, token-driven)", () => {
    expect(html).toContain(`<span class="lg-card-badge"`);
    expect(html).toContain(">Popular</span>");
    expect(html).toContain(`background:${defaultFunnelIconCardDepthSlots.badgeBackground}`);
    expect(html).toContain(`color:${defaultFunnelIconCardDepthSlots.badgeColor}`);
    expect(html).toContain(`font-size:${defaultFunnelIconCardDepthSlots.badgeFontSize}`);
    expect(html).toContain(`border-radius:${defaultFunnelIconCardDepthSlots.badgeRadius}`);
  });

  it("keeps the stored value + engine hooks intact", () => {
    expect(html).toContain(`data-value="toyota"`);
    expect(html).toContain(`data-lg-choice="toyota"`);
    expect(html).toContain(`data-analytics-id="mk_toyota"`);
  });
});

describe("image-card-choice-data — disabled + aria (§8.4)", () => {
  it("disabled:true renders the native disabled attribute + aria-disabled", () => {
    const html = renderComponent(
      imageGrid([
        {
          label: "Ford",
          value: "ford",
          analytics_id: "mk_ford",
          imageMediaId: "med_ford",
          disabled: true,
        },
      ]),
      DESIGN,
    );
    expect(html).toContain(
      `<button type="button" class="lg-card" role="radio" aria-checked="false" disabled aria-disabled="true" data-value="ford"`,
    );
  });

  it("aria_label renders as the explicit accessible name", () => {
    const html = renderComponent(
      imageGrid([
        {
          label: "BMW",
          value: "bmw",
          analytics_id: "mk_bmw",
          imageMediaId: "med_bmw",
          aria_label: "Choose BMW as your make",
        },
      ]),
      DESIGN,
    );
    expect(html).toContain(`aria-label="Choose BMW as your make"`);
  });

  it("disabled absent → NO disabled/aria-disabled markup (byte-safe additive)", () => {
    const html = renderComponent(
      imageGrid([
        { label: "Kia", value: "kia", analytics_id: "mk_kia", imageMediaId: "med_kia" },
      ]),
      DESIGN,
    );
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain(" disabled ");
  });
});

describe("image-card-choice-data — emoji renders where the icon would (§8.4)", () => {
  it("IconCardAnswerGrid: a choice with emoji (no icon) renders the emoji in the icon slot", () => {
    const html = renderComponent(
      iconGrid([{ label: "Vans", value: "vans", analytics_id: "bt_vans", emoji: "🚐" }]),
      DESIGN,
    );
    expect(html).toContain(
      `<span class="lg-card-icon" style="color:#1B3A5C" aria-hidden="true">🚐</span>`,
    );
  });

  it("ImageCardAnswerGrid: a choice with emoji and NO image renders the emoji slot instead of an empty <img>", () => {
    const html = renderComponent(
      imageGrid([{ label: "Other", value: "other", analytics_id: "mk_other", emoji: "🚗" }]),
      DESIGN,
    );
    expect(html).toContain(
      `<span class="lg-card-icon" style="color:#1B3A5C" aria-hidden="true">🚗</span>`,
    );
    expect(html).not.toContain("<img");
  });

  it("an image beats the emoji slot when both are present (image cards keep their image)", () => {
    const html = renderComponent(
      imageGrid([
        { label: "Audi", value: "audi", analytics_id: "mk_audi", imageMediaId: "med_audi", emoji: "🚗" },
      ]),
      DESIGN,
    );
    expect(html).toContain(`<img class="lg-card-img" src="/media/med_audi"`);
    expect(html).not.toContain("🚗");
  });
});

describe("image-card-choice-data — image fit cover|contain (§8.4)", () => {
  const withFit = (fit: unknown): string =>
    renderComponent(
      imageGrid([
        {
          label: "Tesla",
          value: "tesla",
          analytics_id: "mk_tesla",
          imageMediaId: "med_tesla",
          image_alt: "Tesla logo",
          image_fit: fit,
        } as unknown as LeadgenChoice,
      ]),
      DESIGN,
    );

  it("image_fit:'cover' rides object-fit on the card image", () => {
    expect(withFit("cover")).toContain(
      `alt="Tesla logo" style="object-fit:cover" loading="lazy">`,
    );
  });

  it("image_fit:'contain' rides object-fit on the card image", () => {
    expect(withFit("contain")).toContain(`style="object-fit:contain"`);
  });

  it("absent/unknown fit → today's attribute-free <img> (byte-safe additive)", () => {
    expect(withFit(undefined)).toContain(`alt="Tesla logo" loading="lazy">`);
    expect(withFit("stretch")).toContain(`alt="Tesla logo" loading="lazy">`);
    expect(withFit(undefined)).not.toContain("object-fit");
  });
});

describe("image-card-choice-data — description stays the read alias for subtitle (§8.4)", () => {
  it("description-only renders today's lg-card-desc markup (no subtitle class, no inline tokens)", () => {
    const html = renderComponent(
      iconGrid([
        { label: "LLC", value: "llc", analytics_id: "bt_llc", icon: "🏢", description: "Limited liability" },
      ]),
      DESIGN,
    );
    expect(html).toContain(`<span class="lg-card-desc">Limited liability</span>`);
    expect(html).not.toContain("lg-card-subtitle");
  });

  it("subtitle SUPERSEDES description when both are present", () => {
    const html = renderComponent(
      iconGrid([
        {
          label: "LLC",
          value: "llc",
          analytics_id: "bt_llc",
          icon: "🏢",
          description: "OLD copy",
          subtitle: "NEW copy",
        },
      ]),
      DESIGN,
    );
    expect(html).toContain(">NEW copy</span>");
    expect(html).not.toContain("OLD copy");
  });
});

describe("image-card-choice-data — hostile author content in the new fields stays escaped", () => {
  it("title/subtitle/badge/aria_label never become live markup", () => {
    const HOSTILE = `<script>alert(1)</script>" onmouseover="x`;
    const html = renderComponent(
      imageGrid([
        {
          label: "X",
          value: "x",
          analytics_id: "mk_x",
          imageMediaId: "med_x",
          image_alt: HOSTILE,
          title: HOSTILE,
          subtitle: HOSTILE,
          badge: HOSTILE,
          aria_label: HOSTILE,
        },
      ]),
      DESIGN,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(`" onmouseover=`);
    expect(html).toContain("&lt;script&gt;");
  });
});
