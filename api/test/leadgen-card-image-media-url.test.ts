// LeadGen — the ANSWER-CARD IMAGE defect ("image issue in the cards").
//
// Owner, 2026-08-10, with a screenshot of the section studio: broken-image icons
// in the canvas cards (alt text "Cadillac" / "Buick" / "Option 3" showing beside
// them) AND a broken thumbnail in the Image field of the right-hand panel.
//
// TWO causes, both measured in the driven studio on a REAL uploaded image
// (POST /api/admin/media/upload → storage_key 2026/08/10/<uuid>.png, /media/<key>
// verified 200 by curl before anything else was believed):
//
//   1. NO /media/ PREFIX. D1 stores the bare R2 storage key and the blob is
//      served at GET /media/<key>. The media picker writes that bare key into
//      the choice (applyMediaPick: c.imageMediaId = storageKey) and every
//      renderer interpolated it into src= verbatim, so the browser resolved it
//      against the CURRENT page — measured:
//        src="2026/08/10/<uuid>.png"
//        → http://localhost/admin/leadgen/sections/lgs_…/2026/08/10/<uuid>.png
//        → 404, naturalWidth 0
//      The control that makes this airtight: the media PICKER's own grid, in the
//      same DOM at the same moment, rendered the SAME key through mediaSrc() and
//      loaded fine (naturalWidth 32). One key, two readers, one prefix.
//   2. <img src="">. The card's icon fallback required an EMOJI to exist
//      (`!hasImage && emoji !== undefined`), so an image-style card whose choice
//      had neither image nor emoji fell through to the <img> branch with an empty
//      src — a broken image by construction. Measured in the canvas on a freshly
//      added card: <img class="lg-card-img" src="" alt="Option 2">.
//
// A third, adjacent source of guaranteed-broken images: the studio INVENTED
// media ids it had never stored — sampleChoice wrote "media_option_" + n, the
// paste path wrote "media_" + value, and defaultTextFor seeded a logo slot with
// "media_logo". Prefixing those only turns 404 into a prettier 404, so they are
// gone: no image → the card renders its icon slot and the studio's existing
// pre-save advisory ("… has a choice missing its image") asks the operator for
// one. A prompt instead of a fake.
//
// WHAT THIS FILE IS NOT: a browser. It asserts the SERVED bytes of the real
// renderer and EXECUTES the real island functions; "the image now appears" is
// the conductor's driven measurement, recorded in the PR.

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { mediaUrl, MEDIA_PENDING_REF } from "../src/public/view-models/media-url";
import { SECTION_STUDIO_SCRIPT } from "../src/admin/leadgen/ui-section-studio";

const DESIGN = defaultFunnelDesign;
const HERE = dirname(fileURLToPath(import.meta.url));

/** A real R2 storage key shape — what the picker actually writes. */
const KEY = "2026/08/10/6487645f-f96d-418c-bbb8-e636ab769c09.png";
const SERVED = `/media/${KEY}`;

function render(node: Record<string, unknown>): string {
  return renderComponent(node as never, DESIGN);
}

function imgs(html: string): string[] {
  return html.match(/<img[^>]*>/g) ?? [];
}

function srcOf(tag: string): string | null {
  const m = tag.match(/\ssrc="([^"]*)"/);
  return m === null ? null : (m[1] as string);
}

const cardNode = (choices: Array<Record<string, unknown>>): Record<string, unknown> => ({
  type: "ImageCardAnswerGrid",
  question_id: "q_cards",
  internal_field: "make",
  props: { columns: 3 },
  choices,
});

describe("answer-card images resolve to their /media/ address (owner defect 2026-08-10)", () => {
  it("CAUSE 1 — a picked image renders its SERVED address, not the bare storage key", () => {
    const html = render(cardNode([{ label: "Cadillac", value: "o1", analytics_id: "o1", imageMediaId: KEY, image_alt: "Cadillac" }]));
    const tags = imgs(html);
    expect(tags.length, html.slice(0, 300)).toBe(1);
    // Before the fix this was the bare key and the browser 404'd it.
    expect(srcOf(tags[0] as string)).toBe(SERVED);
    expect(html).not.toContain(`src="${KEY}"`);
  });

  it("CAUSE 2 — a card with no image and no emoji renders NO <img>, never src=\"\"", () => {
    // The exact shape the studio produces for a fresh image-style card.
    const html = render(cardNode([{ label: "Buick", value: "o2", analytics_id: "o2" }]));
    expect(imgs(html), "no image ⇒ no <img> at all").toEqual([]);
    expect(html).not.toContain('src=""');
    // …and the card is not empty: the icon slot takes the space.
    expect(html).toContain("lg-card-icon");
  });

  it("an operator's own emoji/icon still wins the empty slot (fallback unchanged in kind)", () => {
    expect(render(cardNode([{ label: "A", value: "a", analytics_id: "a", emoji: "🚗" }]))).toContain("🚗");
    // an icon-only choice used to reach the broken <img>; now it reaches the icon slot
    const iconOnly = render(cardNode([{ label: "B", value: "b", analytics_id: "b", icon: "car" }]));
    expect(imgs(iconOnly)).toEqual([]);
    expect(iconOnly).toContain("lg-card-icon");
  });

  it("IDEMPOTENT — an already-usable address is passed through untouched", () => {
    // Absolute and rooted values must NOT be rewritten into a broken /media/ path
    // (external CDN images, and anything already stored as "/media/…").
    for (const already of ["https://cdn.example.com/mark.png", "/media/legacy/key.png", "data:image/png;base64,iVBOR"]) {
      const html = render(cardNode([{ label: "X", value: "x", analytics_id: "x", imageMediaId: already, image_alt: "X" }]));
      expect(srcOf(imgs(html)[0] as string), already).toBe(already);
    }
  });

  it("EVERY media renderer in the file goes through the one prefixer, not just the card", () => {
    // The card was the reported one; these four were the identical bug waiting to
    // be reported next. Each is the node shape its preset actually reads.
    const cases: Array<[string, Record<string, unknown>]> = [
      ["lg-headerbar-logo", { type: "HeaderBar", question_id: "q_hb", props: { logoMediaId: KEY, logoAlt: "Acme" } }],
      ["lg-logo-strip-img", { type: "LogoStrip", question_id: "q_ls", props: { logos: [{ mediaId: KEY, alt: "Logo" }] } }],
      // ImageBlock source="media" reads logoMediaId (it reuses the
      // HeaderLogo/HeaderBar convention — see renderImageBlockMedia), NOT mediaId.
      ["lg-image-block-img", { type: "ImageBlock", question_id: "q_ib", props: { source: "media", logoMediaId: KEY, alt: "Block" } }],
      ["lg-bg-panel-img", { type: "BackgroundPanel", question_id: "q_bp", props: { imageMediaId: KEY } }],
    ];
    const missing: string[] = [];
    for (const [cls, node] of cases) {
      const html = render(node);
      if (!html.includes(cls)) {
        missing.push(cls); // the preset did not paint an image for this shape
        continue;
      }
      const tag = imgs(html).find((t) => t.includes(cls));
      expect(srcOf(tag as string), `${cls} src`).toBe(SERVED);
    }
    // Every case must actually exercise its renderer — a shape that silently
    // paints nothing would make this test a no-op, which is how the card bug
    // survived five shipped phases in the first place.
    expect(missing, `these preset shapes painted no image: ${missing.join(", ")}`).toEqual([]);
  });

  it("the whole file is swept — no MEDIA REF is left interpolated into a src raw", () => {
    // A structural guard so the next media-bearing preset cannot reintroduce the
    // bug. It names the identifiers that hold a stored media reference: each must
    // reach `src=` only via mediaUrl (directly, or through a local already
    // resolved by it — the card's `imageHref`, which the CAUSE-1 test pins by
    // value anyway).
    const src = readPresets();
    const RAW_MEDIA_IDENT = /src="\$\{esc\((?:[\w.]*\b(?:imageMediaId|logoMediaId|logoUrl|mediaId)\b[\w.]*)\)\}"/g;
    const offenders = src.match(RAW_MEDIA_IDENT) ?? [];
    expect(offenders, `these emit an unprefixed media ref: ${offenders.join(" · ")}`).toEqual([]);
    // …and the prefixer is genuinely in use here, so the guard above cannot pass
    // by the module having stopped rendering images altogether.
    expect((src.match(/mediaUrl\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});

function readPresets(): string {
  return readFileSync(join(HERE, "../src/public/leadgen/components/presets.ts"), "utf8");
}

// ---------------------------------------------------------------------------
// The STUDIO ISLAND — the broken thumbnail in the panel's Image field, and the
// invented ids. These EXECUTE the SERVED island (renderSectionStudio's own
// bytes, the repo's STUDIO_HTML fixture idiom), so a renamed function is a
// failing test and never a silent skip.
// ---------------------------------------------------------------------------

function studioIslandSource(): string {
  // SECTION_STUDIO_SCRIPT is the SHIPPED island (ui-sections.ts inlines it into
  // the studio page) — the served bytes, not a test copy.
  expect(SECTION_STUDIO_SCRIPT).toContain("function setChoiceThumb(");
  return SECTION_STUDIO_SCRIPT;
}

function sliceFn(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing ${name}`);
}

describe("studio island: the panel thumbnail and the invented media ids", () => {
  const source = studioIslandSource();

  it("setChoiceThumb resolves through the SAME prefixer the media picker uses", () => {
    const sandbox: Record<string, unknown> = {};
    runInNewContext(
      [
        sliceFn(source, "mediaSrc"),
        sliceFn(source, "trimStr"),
        sliceFn(source, "setChoiceThumb"),
        // a stand-in for the <img>: records what the island assigns
        "var img = { src: null, hidden: null, removeAttribute: function (n) { this.src = null; } };",
        "var out = {};",
        `setChoiceThumb(img, "${KEY}"); out.picked = { src: img.src, hidden: img.hidden };`,
        'setChoiceThumb(img, ""); out.cleared = { src: img.src, hidden: img.hidden };',
        'setChoiceThumb(img, "https://cdn.example.com/x.png"); out.absolute = { src: img.src };',
      ].join("\n"),
      sandbox,
    );
    const out = sandbox["out"] as { picked: { src: string; hidden: boolean }; cleared: { src: string | null; hidden: boolean }; absolute: { src: string } };
    // Before the fix: the bare key, which the browser resolved against the
    // editor's own path and 404'd.
    expect(out.picked.src).toBe(SERVED);
    expect(out.picked.hidden).toBe(false);
    // empty still means "no thumbnail", not "/media/"
    expect(out.cleared.src).toBeNull();
    expect(out.cleared.hidden).toBe(true);
    // and an absolute URL is not rewritten
    expect(out.absolute.src).toBe("https://cdn.example.com/x.png");
  });

  it("the island and the server agree on the rule (one prefix, two languages)", () => {
    const sandbox: Record<string, unknown> = {};
    runInNewContext(`${sliceFn(source, "mediaSrc")}\nvar out = mediaSrc(${JSON.stringify(KEY)});`, sandbox);
    // mediaSrc (ES5 island) and mediaUrl (server) must not drift.
    expect(sandbox["out"]).toBe(mediaUrl(KEY));
  });

  // RESOLVED 2026-08-11 (owner: "go for it"). The scaffold still has to seed
  // SOMETHING — content-schema requires a non-empty imageMediaId on an image card
  // and logoMediaId on a HeaderLogo, so a seedless scaffold is unsaveable the
  // moment it is added (I tried removing them; it broke the studio's
  // add-from-library invariant, measured). What changed is WHAT it seeds: a fake
  // storage key ("media_option_3", "media_" + value, "media_logo") that could only
  // ever render as a BROKEN IMAGE is now MEDIA_PENDING_REF, which presets.ts paints
  // as a labelled slot ("Image" / "Logo"). Same save-legality, honest pixels, and
  // the save requirement did NOT move.
  it("the scaffold seeds the recognisable not-picked-yet ref, never a fake key", () => {
    const sandbox: Record<string, unknown> = {};
    runInNewContext(
      `${sliceFn(source, "sampleChoice")}\nvar out = sampleChoice({ choice_image: true, choice_icon: false }, 3);`,
      sandbox,
    );
    const sample = sandbox["out"] as Record<string, unknown>;
    expect(sample["imageMediaId"], "a scaffolded card is PENDING, not a fake key").toBe(MEDIA_PENDING_REF);
    // …still a save-LEGAL pair (image + alt), which is why the seed exists at all.
    expect(sample["image_alt"]).toBe("Option 3");
    // the invented shapes are gone from the served island entirely
    expect(source).not.toContain("'media_option_' + n");
    expect(source).not.toContain("'media_' + value");
    expect(source).not.toContain("return 'media_logo'");
  });

  it("a not-picked-yet card renders a LABELLED SLOT, never an <img>", () => {
    const html = render(cardNode([{ label: "Option 3", value: "o3", analytics_id: "o3", imageMediaId: MEDIA_PENDING_REF, image_alt: "Option 3" }]));
    expect(imgs(html), "no <img> for an image nobody has picked").toEqual([]);
    expect(html).toContain("lg-card-img-placeholder");
    expect(html).toContain(">Image<");
    // and never a request for the sentinel
    expect(html).not.toContain("__pending__");
    expect(html).not.toContain("/media/__pending__");
  });

  it("the panel thumbnail stays EMPTY for a not-picked-yet ref (no /media/__pending__)", () => {
    const sandbox: Record<string, unknown> = {};
    runInNewContext(
      [
        sliceFn(source, "mediaSrc"),
        sliceFn(source, "trimStr"),
        sliceFn(source, "setChoiceThumb"),
        "var img = { src: 'x', hidden: false, removeAttribute: function () { this.src = null; } };",
        `setChoiceThumb(img, ${JSON.stringify(MEDIA_PENDING_REF)});`,
        "var out = { src: img.src, hidden: img.hidden };",
      ].join("\n"),
      sandbox,
    );
    expect(sandbox["out"]).toEqual({ src: null, hidden: true });
  });
});
