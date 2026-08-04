// LeadGen R2 · P8 FIX ROUND F1 — the five items three slices each correctly
// STOPPED on (each needed a file the slice did not own), plus the two knock-on
// vocabularies they exposed. Every leg here drives a REAL producer:
//
//   1. M1/R7 — the progress mark can be the OPERATOR'S OWN IMAGE. The owner:
//      "I chose 'icon on track' - where is the icon on track??? how do I define
//      it????". Four pieces had to land together or the control would be
//      offered without being honoured (§4 R3): the enum id (frames.ts), the
//      PAINT (default-funnel/styles.ts), the media control (quotes-tabs/
//      templates.ts) and the M2 sweep's own universe.
//   2. M1 ruling R1 — "Show label" is NOT offered for `numbered`. The renderer
//      is untouched (the numbered step label IS the style); the control that
//      could not be honoured is gone from the panel.
//   3. M1 — ONE step wording. SSR and hydration now say the same sentence, and
//      the help quotes it.
//   4. §7 N12 — the logo's Alignment vocabulary matches Progress's.
//   5. §6 M10 — the saved-template thumbnail crosses the wire as DATA the
//      island can mount, derived from the same function the markup is.
//
// WHAT THIS FILE IS NOT. The visible-paint predicate is not a browser (read the
// limitations banner in test/helpers/leadgen-visible-paint.ts): it resolves the
// real sheet against the real markup and can say a value a visitor could see
// moved, but it measures no box and treats a generated box (::before/::after)
// as non-matching. The pixel half of every claim below is the conductor's
// driven re-measurement (E6), never this lane.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { Hono } from "hono";

import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import {
  FRAME_LOGO_ALIGNS,
  FRAME_PROGRESS_ICONS,
  effectiveFrame,
  validateFrameConfig,
} from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";
import {
  listFrameTemplateRecordsHandler,
  savedFrameTemplateThumbnail,
  savedFrameTemplateThumbnailHtml,
} from "../src/admin/leadgen/frame-handlers";
import { makeFakeDb, buildEnv } from "./helpers/admin-test-kit";
import { visibleDiffCoordsAnyViewport, describeCoord } from "./helpers/leadgen-visible-paint";
import type { Env } from "../src/env";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolveTokens(defaultFunnelDesign);
const CSS = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
const ROOT = {
  funnelId: "lgf_0000000000000000000000F101",
  funnelVariantId: "lgn_0000000000000000000000F102",
  quoteId: "lgq_0000000000000000000000F103",
  contentVersion: 1,
};

/** The REAL served frame for a config patch (no branding unless asked). */
function render(patch: FrameConfig, sectionCount = 3, branding: Parameters<typeof renderQuoteFrame>[0]["siteBranding"] = null): string {
  const { frame, problems } = effectiveFrame("centered", patch);
  expect(problems.filter((p) => p.severity === "error"), JSON.stringify(problems)).toEqual([]);
  return renderQuoteFrame({
    effectiveTokens: TOKENS,
    frame,
    siteBranding: branding,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount,
    root: ROOT,
  });
}

const PANEL = renderTemplatesTabPanel(true, []);

// ---------------------------------------------------------------------------
// The shipped island, rebuilt from the REAL panel bytes (the repo's existing
// island-harness convention: a hand-listed manifest, so a renamed helper is a
// failing slice and never a silent skip).
// ---------------------------------------------------------------------------

function islandSource(): string {
  const match = PANEL.match(/<script>([\s\S]*?)<\/script>/);
  expect(match, "the templates panel ships its inline island").not.toBeNull();
  return match![1] ?? "";
}

function sliceIslandFn(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `island must declare function ${name}`).toBeGreaterThan(-1);
  const open = src.indexOf("{", at);
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(at, i + 1);
}

function sliceIslandVar(src: string, name: string): string {
  const m = src.match(new RegExp(`^\\s*var ${name} = .*$`, "m"));
  expect(m, `island must declare var ${name}`).not.toBeNull();
  return (m![0] ?? "").trim();
}

const PROGRESS_ROW_IDS = [
  "lg-tpl-progress-icon-row",
  "lg-tpl-progress-icon-media-row",
  "lg-tpl-progress-showlabel-row",
  "lg-tpl-progress-numbered-note",
] as const;

/**
 * Drive the SHIPPED syncProgressIconRow over the four rows it decides, with the
 * real [data-frame-key="progress.style"] radio set the panel renders and a real
 * progress.icon select. Returns which rows carry `lg-hidden` afterwards.
 */
function rowVisibility(checkedStyle: string, iconValue: string): Record<string, boolean> {
  const src = islandSource();
  const rows: Record<string, { className: string }> = {};
  for (const id of PROGRESS_ROW_IDS) rows[id] = { className: id.endsWith("note") ? "lg-region-note lg-hidden" : "lg-hidden" };
  const radios = ["bar", "dots", "numbered", "percent", "icon_on_track", "hidden"].map((value) => ({
    value,
    checked: value === checkedStyle,
  }));
  const body =
    sliceIslandVar(src, "boot") +
    "\n" +
    ["byId", "toArray", "progressStyleRadios", "styleForIconRow", "syncProgressIconRow"]
      .map((n) => sliceIslandFn(src, n))
      .join("\n") +
    "\nboot = null;\n" +
    "(function () { syncProgressIconRow(); return __hidden(); })()";
  return runInNewContext(body, {
    __hidden: () =>
      Object.fromEntries(PROGRESS_ROW_IDS.map((id) => [id, / lg-hidden|^lg-hidden/.test(rows[id]!.className)])),
    document: {
      getElementById: (id: string) => rows[id] ?? null,
      // The island asks for the style radios and for the progress.icon select;
      // both are real controls this panel renders.
      querySelectorAll: (sel: string) => (sel.indexOf("progress.icon") >= 0 ? [{ value: iconValue }] : radios),
    },
    Array,
    JSON,
    Object,
    String,
  }) as Record<string, boolean>;
}

// ===========================================================================
// 1. M1/R7 — the operator's OWN image can be the mark on the track
// ===========================================================================

describe("P8 F1 · M1/R7 — the icon_on_track mark accepts the operator's own image", () => {
  it("FAIL-BEFORE (recorded): `custom` was not a legal id, so the media path could not be authored at all", () => {
    // The pre-F1 vocabulary was six ids ending at site_logo. It is now seven,
    // and the seventh is the one the owner asked for. (The state this replaces
    // is pinned in test/leadgen-p8-m3-apply-template.test.ts's own M1/R7 leg,
    // which recorded `validateFrameConfig({progress:{icon:"custom"}}).config`
    // === null — that pin belongs to the file that wrote it.)
    expect([...FRAME_PROGRESS_ICONS]).toEqual(["dot", "car", "shield", "check", "star", "site_logo", "custom"]);
  });

  it("PASS-AFTER: a custom mark + a media id validates, and the served region carries the resolved image", () => {
    const ok = validateFrameConfig({
      progress: { style: "icon_on_track", icon: "custom", icon_media_id: "brand-mark.png" },
    });
    expect(ok.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(ok.config).not.toBeNull();

    const html = render({ progress: { style: "icon_on_track", icon: "custom", icon_media_id: "brand-mark.png" } } as unknown as FrameConfig);
    expect(html).toContain("lg-frame-progress--icon-custom");
    // …resolved through the SAME canonical /media/ prefixer every other media
    // reference on this frame uses, and quoted for the stylesheet.
    expect(html).toContain('style="--lg-progress-icon-url:url(&quot;/media/brand-mark.png&quot;)"');
  });

  it("no image authored → the plain dot, never an empty url() (the site_logo fail-safe, same code path)", () => {
    const none = render({ progress: { style: "icon_on_track", icon: "custom" } } as unknown as FrameConfig);
    expect(none).toContain("lg-frame-progress--icon-dot");
    expect(none).not.toContain("lg-frame-progress--icon-custom");
    expect(none).not.toContain("--lg-progress-icon-url");
  });

  it("a reference that could break out of the CSS url() token is refused, not escaped into the sheet", () => {
    for (const ref of ['a").x{', "a b", "has(paren)", "semi;colon"]) {
      const html = render({ progress: { style: "icon_on_track", icon: "custom", icon_media_id: ref } } as unknown as FrameConfig);
      expect(html, `ref ${ref} must not reach the stylesheet`).not.toContain("--lg-progress-icon-url");
      expect(html).toContain("lg-frame-progress--icon-dot");
    }
  });

  it("the PAINT exists, and it is the SAME pair site_logo has always used (one loop, so they cannot drift)", () => {
    const decls = (iconId: string, pseudo: string): string => {
      const sel = `.lg-frame-region.lg-frame-progress--icon_on_track.lg-frame-progress--icon-${iconId} .lg-progress-fill::${pseudo}`;
      const at = CSS.indexOf(sel);
      expect(at, `the sheet paints ${sel}`).toBeGreaterThan(-1);
      return CSS.slice(CSS.indexOf("{", at) + 1, CSS.indexOf("}", at));
    };
    expect(decls("custom", "before")).toBe(decls("site_logo", "before"));
    expect(decls("custom", "after")).toBe(decls("site_logo", "after"));
    expect(decls("custom", "before")).toContain("background-image:var(--lg-progress-icon-url)");
  });

  it("VISIBLE PAINT: authoring the image moves what the M2 sweep measures (the mark class the paint rule selects on)", () => {
    const page = (mediaId: string | null) => ({
      css: CSS,
      html: render({ progress: { style: "icon_on_track", icon: "custom", icon_media_id: mediaId } } as unknown as FrameConfig),
    });
    const diff = visibleDiffCoordsAnyViewport(page(null), page("brand-mark.png"));
    expect(diff.length, "no visitor-visible coordinate moved").toBeGreaterThan(0);
    expect(
      diff.some((c) => c.classes.includes("lg-frame-progress")),
      diff.map(describeCoord).join(" · "),
    ).toBe(true);
  });

  it("the operator can reach it: the Marker icon select offers the image, and the picker is the existing media path", () => {
    expect(PANEL).toContain('<option value="custom">My own image</option>');
    expect(PANEL).toContain('data-frame-key="progress.icon_media_id"');
    expect(PANEL).toContain('id="lg-tpl-progress-icon-media-row"');
    // the shared media affordance, not a new one
    expect(PANEL).toContain('data-media-choose aria-label="Choose Marker image from the Media library"');
  });

  it("the image picker is offered ONLY where it does something (driven over the shipped island)", () => {
    const MEDIA = "lg-tpl-progress-icon-media-row";
    const ICON = "lg-tpl-progress-icon-row";
    expect(rowVisibility("icon_on_track", "custom")[MEDIA], "shown for icon_on_track + custom").toBe(false);
    expect(rowVisibility("icon_on_track", "site_logo")[MEDIA], "hidden for a non-image mark").toBe(true);
    expect(rowVisibility("bar", "custom")[MEDIA], "hidden when no mark rides the track").toBe(true);
    // …and the Marker-icon row's own rule is unchanged by the addition.
    expect(rowVisibility("icon_on_track", "dot")[ICON]).toBe(false);
    expect(rowVisibility("numbered", "dot")[ICON]).toBe(true);
  });
});

// ===========================================================================
// 2. M1 ruling R1 — a control that cannot be honoured is not offered
// ===========================================================================

describe("P8 F1 · M1 — 'Show label' is not offered for numbered (the renderer keeps the label)", () => {
  it("REPRODUCTION: for `numbered` alone, ON and OFF are the same render", () => {
    const on = render({ progress: { style: "numbered", show_label: true } } as unknown as FrameConfig);
    const off = render({ progress: { style: "numbered", show_label: false } } as unknown as FrameConfig);
    expect(on).toBe(off);
    // …because the numbered step label IS the style (the pinned product
    // decision, test/leadgen-frame-progress-back.test.ts).
    expect(off).toContain("data-lg-progress-label>Step 1 of 3</div>");
  });

  it("the four styles that DO honour it still do — the switch is only withdrawn where it is meaningless", () => {
    for (const style of ["bar", "dots", "percent", "icon_on_track"] as const) {
      const on = render({ progress: { style, show_label: true } } as unknown as FrameConfig);
      const off = render({ progress: { style, show_label: false } } as unknown as FrameConfig);
      expect(on, `${style} must honour show_label`).not.toBe(off);
    }
  });

  it("so the panel withdraws it, and says why (driven over the shipped island)", () => {
    const SWITCH = "lg-tpl-progress-showlabel-row";
    const NOTE = "lg-tpl-progress-numbered-note";
    expect(rowVisibility("numbered", "dot")[SWITCH], "hidden for numbered").toBe(true);
    expect(rowVisibility("numbered", "dot")[NOTE], "the note takes its place").toBe(false);
    for (const style of ["bar", "dots", "percent", "icon_on_track"] as const) {
      expect(rowVisibility(style, "dot")[SWITCH], `${style} keeps the switch`).toBe(false);
      expect(rowVisibility(style, "dot")[NOTE], `${style} shows no numbered note`).toBe(true);
    }
    expect(PANEL).toContain("Numbered steps always show the step label");
  });
});

// ===========================================================================
// 3. M1 — one wording for the step label
// ===========================================================================

describe("P8 F1 · M1 — the step label reads the same in every place it is written", () => {
  const RUNTIME_RENDER = readFileSync(join(HERE, "..", "src", "public", "leadgen", "runtime", "render.ts"), "utf8");

  it("SSR: every step-mode style renders one sentence, and the screen-reader text matches it", () => {
    for (const style of ["bar", "numbered", "icon_on_track"] as const) {
      const html = render({ progress: { style, show_label: true } } as unknown as FrameConfig, 5);
      expect(html, `${style} label`).toContain(">Step 1 of 5</div>");
      expect(html, `${style} aria`).toContain('aria-valuetext="Step 1 of 5"');
    }
  });

  it("the operator is TOLD what is painted — the help quotes the same sentence", () => {
    expect(PANEL).toContain("A visitor sees &quot;Step 2 of 5&quot; beside the bar, or &quot;40%&quot; on Percent.");
    expect(PANEL).not.toContain("&quot;2 / 5&quot;");
  });

  it("hydration re-stamps that SAME sentence instead of replacing it with a second shape", () => {
    // The label text and the aria-valuetext are now ONE expression, so they
    // cannot drift apart or away from the server's wording. The behavioural
    // drive of updateProgress lives in the runtime tsconfig program
    // (test/leadgen-runtime-hydration.test.ts, which owns the fake-DOM harness);
    // what is asserted here is that the worker-side wording and the runtime's
    // wording are the same string.
    expect(RUNTIME_RENDER).toContain("const stepText = `Step ${currentStep} of ${safeTotal}`;");
    expect(RUNTIME_RENDER).toContain('const text = mode === "percent" ? `${pct}%` : stepText;');
    expect(RUNTIME_RENDER).not.toContain("`${currentStep} / ${safeTotal}`");
  });
});

// ===========================================================================
// 4. §7 N12 — one Alignment vocabulary
// ===========================================================================

describe("P8 F1 · N12 — the logo offers the third placement, because the header can now honour it", () => {
  it("the two vocabularies match", () => {
    expect([...FRAME_LOGO_ALIGNS]).toEqual(["left", "center", "right"]);
    expect(PANEL).toContain('<option value="right">Right</option>');
  });

  it("and it is honoured: the sheet carries the rule, and the render moves a value a visitor can see", () => {
    expect(CSS).toContain(".lg-frame-header--right .lg-header-inner{justify-content:flex-end}");
    expect(CSS).toContain(".lg-frame-header--right .lg-frame-header-extras{justify-content:flex-end}");
    // A header with a real logo row — that IS the element the placement moves
    // (components/presets.ts renderHeaderLogo emits .lg-header-inner).
    const branding = {
      site_name: "Acme Insure",
      logo_url: "/media/site-logo.png",
      tagline: null,
      legal_links: [],
      trust_logos: null,
    };
    const page = (align: "center" | "right") => ({
      css: CSS,
      html: render({ header: { logo_align: align } } as unknown as FrameConfig, 3, branding),
    });
    const diff = visibleDiffCoordsAnyViewport(page("center"), page("right"));
    expect(diff.length, "right must paint differently from center").toBeGreaterThan(0);
    expect(
      diff.some((c) => c.prop === "justify-content" && c.classes.includes("lg-header-inner")),
      diff.map(describeCoord).join(" · "),
    ).toBe(true);
  });
});

// ===========================================================================
// 5. §6 M10 — the saved-template thumbnail crosses the wire as mountable DATA
// ===========================================================================

const SAVED_ROW = {
  id: 7,
  public_id: "lgt_f1thumb",
  name: "F1 Thumb",
  frame_json: JSON.stringify({
    template: "minimal",
    version: 1,
    progress: { style: "dots" },
    section_slot: { card: "bare" },
    footer: { enabled: true },
    background: { style: "brand" },
  }),
  is_default: 0,
  created_at: 0,
  updated_at: 0,
};

describe("P8 F1 · M10 — one derivation, two renderings: the island can mount the real thumbnail", () => {
  it("the DATA and the MARKUP are the same bands (serialising one reproduces the other byte for byte)", () => {
    const data = savedFrameTemplateThumbnail(SAVED_ROW as never);
    const html = savedFrameTemplateThumbnailHtml(SAVED_ROW as never);
    const rebuilt =
      `<div class="${data.root_class}" data-template-thumb="${data.id}" aria-hidden="true">` +
      data.bands.map((cls) => `<span class="${cls}"></span>`).join("") +
      "</div>";
    expect(rebuilt).toBe(html);
    // …and the bands are the ROW's own values, not a registry default.
    expect(data.root_class).toContain("lg-tpl-thumb--bg-brand");
    expect(data.bands.some((b) => b.includes("lg-tpl-progress--dots"))).toBe(true);
    expect(data.bands.some((b) => b.includes("lg-tpl-slot--bare"))).toBe(true);
    expect(data.bands.some((b) => b.includes("lg-tpl-footer"))).toBe(true);
  });

  it("the real records route carries it, alongside the markup key it already carried", async () => {
    const { db } = makeFakeDb([], [{ match: "FROM leadgen_frame_templates", rows: [SAVED_ROW] }]);
    const app = new Hono<{ Bindings: Env }>();
    app.get("/frame-template-records", listFrameTemplateRecordsHandler);
    const res = await app.request("/frame-template-records", { method: "GET" }, buildEnv(db) as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ thumbnail_html: string; thumbnail: { root_class: string; id: string; bands: string[] } }> };
    const row = body.items[0]!;
    expect(row.thumbnail_html).toContain('data-template-thumb="lgt_f1thumb"');
    expect(row.thumbnail.id).toBe("lgt_f1thumb");
    expect(row.thumbnail.bands.length).toBeGreaterThan(2);
    for (const cls of row.thumbnail.bands) expect(row.thumbnail_html).toContain(`class="${cls}"`);
  });

  it("the island MOUNTS it with createElement — no innerHTML anywhere in these bytes", () => {
    const src = islandSource();
    const thumbFor = sliceIslandFn(src, "thumbFor");
    expect(thumbFor).toContain("tpl.thumbnail");
    expect(thumbFor).toContain("document.createElement");
    expect(thumbFor).toContain("data.bands[i]");
    // the chip actually appends it
    expect(src).toContain("var thumb = thumbFor(tpl);");
    expect(src).toContain("if (thumb) { chip.appendChild(thumb); }");
    // …and the island never re-derives the bands from frame_json (§4 R1: one
    // reader of one wire shape).
    expect(thumbFor).not.toContain("frame_json");
    // …and no island byte WRITES markup: the only occurrence of the word in
    // these bytes is the comment that explains why it is forbidden.
    expect(src).not.toContain(".innerHTML");
  });
});
