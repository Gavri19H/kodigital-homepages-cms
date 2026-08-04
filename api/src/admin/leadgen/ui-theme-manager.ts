// LeadGen redesign-contract-v3.1 §10 — the Themes MANAGER page (Concern 2,
// Phase D). Standalone full page at GET /admin/leadgen/themes (golden
// golden-master-source.dc.html lines 627-721 render it as an in-studio
// overlay `<sc-if value="{{ viewThemes }}">`; this build renders the SAME
// chrome as a real page, matching the established Section-Studio precedent —
// ui-sections.ts's sectionEditorHtml wraps its content in leadgenPageShell
// (the normal admin shell chrome) rather than reproducing the golden's outer
// `position:fixed;width:1440px;height:944px` floating-card wrapper, which is
// the DC-mockup's own "simulated browser frame" convention, not a literal
// build instruction (confirmed: ui-section-studio.ts's SECTION_STUDIO_STYLES
// never uses position:fixed for its own layout either). Per-element inline
// style strings ARE copied verbatim from the golden where they are the
// asserted chrome (§13 Gate 1a); `style-hover` DC pseudo-attributes are
// translated into real CSS :hover classes (mirroring ui-section-studio.ts's
// own ".studio-back:hover{...}" translation of the same golden pattern).
//
// §0 fidelity-vs-function + §10.5 fixture-value rule: the golden's `pal()`
// lookup (hardcoded Navy/Bold Yellow/Minimal hex + "Assigned to Auto
// Insurance..." strings) is a DEMO STAND-IN. This build renders LIVE data:
// - LEFT list cards + badges (LIVE·<label> / A/B·<label> / DRAFT) and the
//   CENTER "themeUse" subtitle are computed by scanVariantThemeUsage() below,
//   which mirrors themes-handlers.ts's own findFunnelsReferencingTheme scan
//   (§10.5 "computed by scanning funnels/variants for the theme_id — no
//   back-reference stored") but is its own read-only query (this file's
//   slice does not modify themes-handlers.ts) additionally resolving EACH
//   active variant's WINNING theme_id via theme.ts's own winningThemeId
//   (variant frame_overrides_json.theme_id wins over the funnel's
//   theme_json.theme_id — §10.1), so a card's badge/use-line/right-panel
//   content is one single live computation, never a hardcode.
// - The RIGHT A/B panel is scoped to the CENTER-selected theme's PRIMARY
//   funnel (the first usage match, preferring a primary/"LIVE" match — §5-M1
//   replacement semantics, VariantThemeUsage.isControl below),
//   rendering THAT funnel's full active-variant set (§10.5 "Both variants
//   share the same questions — only the theme differs"), then any OTHER
//   funnels referencing the same theme_id below. This is an interpretation
//   of an under-specified corner of §10.5 (the golden's RIGHT panel carries
//   NO `{{ }}` bindings at all — it is 100% static demo markup) — see the
//   phase report for the reasoning trace.
//
// §10.4 "Role/size writes are role/enum names; colors under Advanced write
// hex": the normal "Colors — semantic roles" swatches are a LABELLED,
// NON-INTERACTIVE preview (matching the golden's own un-bound markup — no
// onClick anywhere in that block); the ONLY functional colour-edit surface
// is the Advanced disclosure's per-role hex inputs (visually a "mono chip"
// styled <input>, the minimal necessary transform from the golden's
// read-only <span> so hex editing has ANYWHERE to happen at all — Advanced
// is explicitly "the ONLY place hex appears"). Typography/Controls edits
// PATCH via a small ES5 fetch island (THEME_MGR_SCRIPT); card selection and
// "New theme" are (mostly) plain navigation, per the ES5 guardrail's
// "prefer plain fetch without a complex island" steer.
//
// §10.4 note: there is NO "Spacing" control (PROPOSED, storage key reserved
// only, §0/§10.4) — none is rendered here.

import type { Env } from "../../env";
import { escapeHtml } from "../templates/layout";
import { apiJson, leadgenPageShell, leadgenStandalonePageShell, branding, type UiContext } from "./ui";
import { parseJsonColumn } from "./offers-handlers";
// §8.4 live canvas: an in-process self-request to the SAME existing
// POST /sections/preview endpoint apiJson (above) already reaches for GET —
// leadgenApi.request(path, init, env) is the identical mechanism ui.ts's
// apiJson wraps, just with an explicit method/body for this POST. No new
// route, no new handler — sections-handlers.ts's previewSectionHandler is
// consumed exactly as authored (its existing `theme_id` preview-override
// body param, §10.6/§12, already resolves an ARBITRARY saved ThemeRecord
// independent of any funnel, which is exactly this page's "preview a
// preset that may not be assigned to any funnel yet" situation).
import leadgenApi from "./router";
import {
  THEME_BUTTON_LAYOUTS,
  THEME_BUTTON_SELECTED_STYLES,
  THEME_BUTTON_STYLES,
  THEME_DISPLAY_SIZE_SCALES,
  THEME_RECORD_BUTTON_SIZES,
  THEME_RECORD_CORNERS,
  THEME_RECORD_EXTRA_ROLE_KEYS,
  THEME_RECORD_FIELD_HEIGHTS,
  THEME_RECORD_FONT_NAMES,
  THEME_RECORD_FONT_STACKS,
  THEME_RECORD_ROLE_KEYS,
  winningThemeId,
  type ThemeButtonLayout,
  type ThemeButtonSelectedStyle,
  type ThemeButtonStyle,
  type ThemeDisplaySizeScale,
  type ThemeRecord,
  type ThemeRecordButtonSize,
  type ThemeRecordCorners,
  type ThemeRecordExtraRoleKey,
  type ThemeRecordFieldHeight,
  type ThemeRecordFontName,
  type ThemeRecordRoleKey,
} from "../../public/leadgen/designs/theme";

// ---------------------------------------------------------------------------
// Colour / geometry constants — literal hex copied from the golden (line
// refs inline), named per this codebase's STUDIO_COLOR-style convention
// (ui-section-studio.ts) so each value is written once.
// ---------------------------------------------------------------------------

const TM_COLOR = {
  topbarBg: "#fff",
  topbarBorder: "#E4E8EF", // golden :631
  back: "#41495B", // golden :632
  backIcon: "#5A6470",
  backHover: "#F5F7FA",
  backHoverBorder: "#CDD5E1",
  lineControl: "#E1E6EE", // golden :632
  divider: "#E4E8EF", // golden :633
  title: "#111726", // golden :634
  subtitle: "#8A93A3", // golden :634
  navy: "#1B3A5C", // golden :635
  navyHover: "#16324f", // golden :635 style-hover
  appBg: "#EDF0F4", // golden :638
  eyebrow: "#8A93A3", // golden :642
  cardActiveBorder: "#1B3A5C", // golden :770 themeCard(true)
  cardActiveBg: "#F7F9FC",
  cardBorder: "#E4E8EF", // golden :771 themeCard(false)
  cardName: "#1A1F36", // golden :645
  footerBorder: "#EEF1F6", // golden :657
  footerBg: "#F8FAFC",
  footerText: "#7C889A",
  footerStrong: "#41495B",
  liveBadgeText: "#0E7C3A", // golden :645
  liveBadgeBg: "#E4F2E9",
  abBadgeText: "#8a6d00", // golden :649
  abBadgeBg: "#FBF0CF",
  draftBadgeText: "#8A93A3", // golden :653
  draftBadgeBg: "#F1F3F7",
  swatchBorder: "#E1E6EE", // golden :948/:949
  themeTitle: "#111726", // golden :664
  themeUse: "#8A93A3", // golden :667
  sectionEyebrow: "#9BA3B1", // golden :669
  roleLabel: "#2A3346", // golden :671
  roleSub: "#98A1B0", // golden :671
  noteBg: "#F6F8FB", // golden :678
  noteText: "#7C889A",
  noteIcon: "#9AA3B2",
  fieldLabel: "#5A6470", // golden :682
  fontPreview: "#2A3346",
  chevron: "#8A93A3",
  segBg: "#EDF0F5", // golden :689
  segActiveText: "#1B3A5C",
  segInactiveText: "#6B7486",
  advBorder: "#E7EBF1", // golden :695
  advHoverBg: "#FBFCFD",
  advIcon: "#98A1B0",
  advChevron: "#B4BCC9",
  advTitle: "#41495B", // golden :697
  advSub: "#98A1B0",
  monoText: "#98A1B0", // golden :698
  monoBg: "#F3F5F8",
  monoTextStrong: "#41495B",
  rightBorder: "#E7EBF1", // golden :704
  rightEyebrow: "#8A93A3",
  rightFunnel: "#1A1F36", // golden :706
  abIcon: "#1B3A5C", // golden :708
  abHeading: "#41495B",
  variantLabel: "#2A3346", // golden :709
  variantSub: "#98A1B0",
  pct: "#1B3A5C",
  rightNote: "#7C889A", // golden :713
  rightNoteStrong: "#41495B",
  otherIcon: "#9AA3B2", // golden :715
  otherText: "#5A6470",
  otherEmpty: "#98A1B0",
  neutralGray: "#C7CFDB", // no-theme bar segment fallback
  errText: "#B23A2C",
} as const;

// Admin-preview font stacks — a CLOSED lookup keyed by the SAME
// THEME_RECORD_FONT_NAMES whitelist theme.ts's THEME_RECORD_FONT_STACKS
// gates on write; this is a SEPARATE table (admin-preview CSS, never the
// served runtime <style>) but reuses the identical closed-enum discipline —
// no raw font-name string is ever interpolated into a style attribute here.
// P6b (round 2 — the P6a ThemeRecord widening's exhaustiveness signal):
// THEME_RECORD_FONT_NAMES grew from 3 to 11 (the 8 new self-hosted families,
// commit 0992752), so this Record's exhaustiveness check demanded all 11 keys
// — the 3 original entries keep their EXISTING literal strings unchanged (a
// deliberately separate admin-preview table, per this const's own doc
// comment, not required to match THEME_RECORD_FONT_STACKS byte-for-byte); the
// 8 new entries mirror THEME_RECORD_FONT_STACKS's values directly (no
// hand-retyped literals — same "reuse verbatim for parity" discipline
// theme.ts's own THEME_RECORD_FONT_STACKS widening already used against
// THEME_FONT_STACKS).
const TM_FONT_PREVIEW_STACK: Record<ThemeRecordFontName, string> = {
  Newsreader: "Newsreader,serif",
  Inter: "Inter,system-ui,Arial,sans-serif",
  "Roboto Mono": "'Roboto Mono',monospace",
  Poppins: THEME_RECORD_FONT_STACKS.Poppins,
  "Space Grotesk": THEME_RECORD_FONT_STACKS["Space Grotesk"],
  Fraunces: THEME_RECORD_FONT_STACKS.Fraunces,
  "Playfair Display": THEME_RECORD_FONT_STACKS["Playfair Display"],
  Manrope: THEME_RECORD_FONT_STACKS.Manrope,
  "DM Sans": THEME_RECORD_FONT_STACKS["DM Sans"],
  "Work Sans": THEME_RECORD_FONT_STACKS["Work Sans"],
  Lexend: THEME_RECORD_FONT_STACKS.Lexend,
};

// ---------------------------------------------------------------------------
// Defense in depth (mirrors theme-store.ts's isThemeRecordShape /
// theme.ts's safeThemeRecordFontStack doc comments): a role hex value is
// gated at write time (themes-handlers.ts validateThemeBody's HEX_RE) and
// again at KV-read time (theme-store.ts's isThemeRecordShape); this is a
// THIRD, harmless layer specific to this render path — never trust a string
// into a `background:` style attribute without re-checking the shape here.
// ---------------------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function safeHex(value: string | undefined | null): string {
  return typeof value === "string" && HEX_RE.test(value) ? value : TM_COLOR.neutralGray;
}

// ---------------------------------------------------------------------------
// §10.5 live usage scan — "computed by scanning funnels/variants for the
// theme_id — no back-reference stored." A SEPARATE, read-only query from
// themes-handlers.ts's own findFunnelsReferencingTheme (that file is outside
// this slice's ownership); this one returns EVERY active variant's resolved
// winning theme_id (or null), so per-theme classification is a pure in-memory
// filter over ONE query result rather than N per-theme scans.
// ---------------------------------------------------------------------------

// Rework M1 (§5-M1, §4.3-10): `is_control` no longer exists on
// leadgen_funnel_variants — "no control concept anywhere." Replacement
// semantics: with no running test a funnel has exactly one active variant
// (validation enforces this); the deterministic pick/tie-break order is
// variant_label ASC, id ASC (labels A/B/C). `isControl` below keeps its NAME
// (and every downstream badge/primary-usage consumer keeps working
// unchanged) but is now DERIVED — true for whichever variant sorts first,
// per funnel, under that order — rather than read off a DB column.
export interface VariantThemeUsage {
  funnelId: number;
  funnelPublicId: string;
  funnelName: string;
  variantLabel: string;
  isControl: boolean;
  trafficAllocationBp: number;
  themeId: string | null;
}

interface UsageScanRow {
  funnel_id: number;
  funnel_public_id: string;
  funnel_name: string;
  funnel_theme_json: string | null;
  variant_label: string;
  traffic_allocation_bp: number;
  frame_overrides_json: string | null;
}

export async function scanVariantThemeUsage(db: D1Database): Promise<VariantThemeUsage[]> {
  const result = await db
    .prepare(
      `SELECT f.id AS funnel_id, f.public_id AS funnel_public_id, f.funnel_name AS funnel_name,
              f.theme_json AS funnel_theme_json, v.variant_label AS variant_label,
              v.traffic_allocation_bp AS traffic_allocation_bp,
              v.frame_overrides_json AS frame_overrides_json
         FROM leadgen_funnel_variants v
         JOIN leadgen_funnels f ON f.id = v.funnel_id
        WHERE f.status = 'active' AND v.status = 'active'
        ORDER BY f.id ASC, v.variant_label ASC, v.id ASC`,
    )
    .all<UsageScanRow>();
  // Rows arrive pre-ordered (variant_label ASC, id ASC WITHIN each funnel) —
  // the first row seen for a given funnel_id is that funnel's primary/
  // "isControl" variant (§5-M1 replacement semantics); every later row for
  // the same funnel_id is a non-primary A/B arm.
  const seenFunnels = new Set<number>();
  return (result.results ?? []).map((row) => {
    const funnelTheme = parseJsonColumn(row.funnel_theme_json);
    const variantOverrides = parseJsonColumn(row.frame_overrides_json);
    const isPrimary = !seenFunnels.has(row.funnel_id);
    seenFunnels.add(row.funnel_id);
    return {
      funnelId: row.funnel_id,
      funnelPublicId: row.funnel_public_id,
      funnelName: row.funnel_name,
      variantLabel: row.variant_label,
      isControl: isPrimary,
      trafficAllocationBp: row.traffic_allocation_bp,
      themeId: winningThemeId(funnelTheme, variantOverrides),
    };
  });
}

// ---------------------------------------------------------------------------
// Pure classification helpers (unit-testable independent of D1/HTML).
// ---------------------------------------------------------------------------

export function usageForTheme(all: VariantThemeUsage[], themeId: string): VariantThemeUsage[] {
  return all.filter((e) => e.themeId === themeId);
}

// The "best" match for a badge/use-line: the primary ("isControl", §5-M1
// replacement semantics) match wins over any A/B match; ties break on scan
// order (funnel id asc, then primary-before-arm).
export function primaryUsage(matches: VariantThemeUsage[]): VariantThemeUsage | null {
  const live = matches.find((m) => m.isControl);
  return live ?? matches[0] ?? null;
}

export type UsageBadgeKind = "live" | "ab" | "draft";

export function usageBadgeKind(matches: VariantThemeUsage[]): UsageBadgeKind {
  if (matches.some((m) => m.isControl)) return "live";
  if (matches.length > 0) return "ab";
  return "draft";
}

// Appendix A: "LIVE · A", "A/B · B", "DRAFT".
export function usageBadgeText(matches: VariantThemeUsage[]): string {
  const kind = usageBadgeKind(matches);
  if (kind === "draft") return "DRAFT";
  const primary = primaryUsage(matches);
  const label = primary?.variantLabel ?? "";
  return kind === "live" ? `LIVE · ${label}` : `A/B · ${label}`;
}

// CENTER subtitle — Appendix A "remainder": "Assigned to Auto Insurance ·
// Variant A" / "Assigned to Auto Insurance · Variant B · A/B test" /
// "Not assigned to a funnel yet".
export function themeUseLine(matches: VariantThemeUsage[]): string {
  const primary = primaryUsage(matches);
  if (primary === null) return "Not assigned to a funnel yet";
  const base = `Assigned to ${primary.funnelName} · Variant ${primary.variantLabel}`;
  return primary.isControl ? base : `${base} · A/B test`;
}

// All active variants of one funnel (for the RIGHT panel's "A/B test ·
// Theme" box — the funnel's FULL variant set, each resolved to ITS OWN
// theme, not just the ones matching the selected theme; golden §10.5's
// "Both variants share the same questions — only the theme differs").
export function variantsForFunnel(all: VariantThemeUsage[], funnelId: number): VariantThemeUsage[] {
  return all.filter((e) => e.funnelId === funnelId);
}

// "Other funnels using this theme" — every OTHER funnel (excluding the
// primary's own funnel) referencing themeId, deduped to one row per funnel
// (preferring that funnel's own LIVE match, matching the badge priority).
export function otherFunnelsUsing(
  all: VariantThemeUsage[],
  themeId: string,
  excludeFunnelId: number | null,
): VariantThemeUsage[] {
  const matches = usageForTheme(all, themeId).filter((m) => m.funnelId !== excludeFunnelId);
  const byFunnel = new Map<number, VariantThemeUsage>();
  for (const m of matches) {
    const cur = byFunnel.get(m.funnelId);
    if (cur === undefined || (m.isControl && !cur.isControl)) byFunnel.set(m.funnelId, m);
  }
  return [...byFunnel.values()];
}

// ---------------------------------------------------------------------------
// §8.4 live canvas — replaces the swatch-only preview (ground truth #11E:
// "swatches are a labelled NON-INTERACTIVE preview", THIS file). A REAL
// section rendered through the REAL renderer (studio server-preview
// pattern), beside the editor, for the theme currently selected in CENTER.
// Section-picker default rule (§8.4, "same rule as Templates"): the owning
// quote's shared-page first section → else the theme's primary funnel's own
// first section → else the Appendix A-9 fixture. SERVER-COMPUTED per page
// load/reload: "editing a theme re-renders the canvas" holds because every
// control here already PATCHes-then-reloads (THEME_MGR_SCRIPT's patchTheme,
// unchanged) — the very next render recomputes this canvas from the freshly
// PERSISTED theme. No per-keystroke fetch loop exists to debounce (every
// control fires on a discrete `change`, not per-character), so there is
// nothing this SSR-computed canvas needs its own timer for; the "beside the
// editor" plumbing itself reuses the SAME existing POST /sections/preview
// endpoint the studio's OWN debounced client-side canvas calls (P2/funnel.ts
// precedent), just invoked server-side here via one in-process request.
// ---------------------------------------------------------------------------

// Appendix A-9 fallback fixture ("Sample section (add sections to preview
// your own).") — a REAL, minimal, already-proven component pair (mirrors the
// shipped test/fixtures/leadgen-rework/image2-two-questions.json shape: one
// answer-producing component + a ContinueButton) so the "through the REAL
// renderer" guardrail holds even with zero real sections reachable (a brand
// new/unassigned theme preset, or a funnel/quote with no sections yet).
const CANVAS_FIXTURE_LABEL = "Sample section (add sections to preview your own).";
const CANVAS_FIXTURE_CONTENT_JSON = JSON.stringify({
  components: [
    {
      type: "TwoButtonYesNo",
      question_id: "q_tm_canvas_sample",
      question_key: "tm_canvas_sample_q",
      internal_field: "tm_canvas_sample",
      answer_type: "boolean",
      props: { label: "Are you currently insured?", yesLabel: "Yes", noLabel: "No" },
    },
    { type: "ContinueButton", question_id: "q_tm_canvas_continue", props: { label: "Continue" } },
  ],
});

// The section-picker's resolved seed: which content to render, and the
// frame_context to compose it inside. sections-handlers.ts's own doc comment
// (previewSectionHandler, §10.6/§12) is explicit: the theme_id preview
// override "applies ONLY inside the composed frame_context branch... it just
// has no visual effect" without one — so a REAL funnel/variant frame_context
// is used when reachable, and the EXISTING §5.3 mode-5 empty-state
// `{default:true}` frame_context (no funnel needed at all) otherwise, NEVER
// the unit-only (no frame_context) path, or the selected theme's button
// style/roles would silently fail to apply — an inert, fake-looking canvas.
interface CanvasSeed {
  contentJson: string;
  frameContext: { default: true } | { funnel_public_id: string; variant_public_id: string; site_id?: string };
  isFixture: boolean;
}

interface CanvasPrimaryVariantRow {
  variant_id: number;
  variant_public_id: string;
  funnel_public_id: string;
  quote_id: number;
}

// Rework §8.8 (follow-up round, conductor-granted): "Open Site settings"
// needs an unambiguous site to link to. A quote MAY be activated on several
// sites (leadgen_site_quotes) — there is no single canonical "the" site in
// general, so this picks the first ENABLED activation (deterministic
// site_id ASC order) ONLY as a best-effort preview convenience; it never
// invents one when the quote has zero activations (siteId stays undefined,
// frame_context carries no site_id, the chip still always renders — only
// the OPTIONAL link is absent).
async function firstActivatedSiteId(db: D1Database, quoteId: number): Promise<string | undefined> {
  const row = await db
    .prepare(
      `SELECT site_id AS site_id FROM leadgen_site_quotes
        WHERE quote_id = ? AND enabled = 1
        ORDER BY site_id ASC LIMIT 1`,
    )
    .bind(quoteId)
    .first<{ site_id: string }>();
  return row?.site_id;
}

// One row's `content_json` at the lowest `position` for either owner axis
// (§5-M2: quote-owned = the shared page, variant-owned = a funnel's own
// plan) — both tables carry the SAME shape post-M2 (0047 migration).
async function firstSectionContentByOwner(
  db: D1Database,
  ownerColumn: "quote_id" | "variant_id",
  ownerId: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT s.content_json AS content_json
         FROM leadgen_funnel_variant_sections vs
         JOIN leadgen_sections s ON s.id = vs.section_id
        WHERE vs.${ownerColumn} = ?
        ORDER BY vs.position ASC
        LIMIT 1`,
    )
    .bind(ownerId)
    .first<{ content_json: string }>();
  return row?.content_json ?? null;
}

const CANVAS_FIXTURE_FRAME_CONTEXT = { default: true } as const;

// §8.4 section-picker default rule, resolved for ONE theme's primary usage
// (primaryUsage's funnelId, or null when the theme is unassigned to any
// funnel yet — a brand-new/never-applied preset has no quote/funnel to pick
// a section from at all, so it falls straight to the fixture).
async function pickCanvasSeed(db: D1Database, primaryFunnelId: number | null): Promise<CanvasSeed> {
  if (primaryFunnelId !== null) {
    const variant = await db
      .prepare(
        `SELECT v.id AS variant_id, v.public_id AS variant_public_id, f.public_id AS funnel_public_id, f.quote_id AS quote_id
           FROM leadgen_funnel_variants v
           JOIN leadgen_funnels f ON f.id = v.funnel_id
          WHERE v.funnel_id = ? AND v.status = 'active'
          ORDER BY v.variant_label ASC, v.id ASC
          LIMIT 1`,
      )
      .bind(primaryFunnelId)
      .first<CanvasPrimaryVariantRow>();
    if (variant !== null) {
      const siteId = await firstActivatedSiteId(db, variant.quote_id);
      const frameContext: CanvasSeed["frameContext"] = {
        funnel_public_id: variant.funnel_public_id,
        variant_public_id: variant.variant_public_id,
        ...(siteId !== undefined ? { site_id: siteId } : {}),
      };
      const shared = await firstSectionContentByOwner(db, "quote_id", variant.quote_id);
      if (shared !== null) {
        return { contentJson: shared, frameContext, isFixture: false };
      }
      const own = await firstSectionContentByOwner(db, "variant_id", variant.variant_id);
      if (own !== null) {
        return { contentJson: own, frameContext, isFixture: false };
      }
      return { contentJson: CANVAS_FIXTURE_CONTENT_JSON, frameContext, isFixture: true };
    }
  }
  return { contentJson: CANVAS_FIXTURE_CONTENT_JSON, frameContext: CANVAS_FIXTURE_FRAME_CONTEXT, isFixture: true };
}

interface CanvasPreviewBody {
  preview?: { html?: unknown; css?: unknown };
}

// One in-process POST to the EXISTING, unmodified previewSectionHandler
// (sections-handlers.ts) — the SAME self-request mechanism apiJson (./ui)
// already uses for GET. `theme_id` is the §10.6/§12 preview override: it
// resolves and applies the NAMED ThemeRecord's tokens regardless of whether
// any funnel's OWN theme_json/frame_overrides_json currently references it —
// exactly this page's situation (the CENTER-selected theme may be unassigned,
// or a DIFFERENT theme than the picked section's owning funnel/variant
// naturally resolves to; the explicit override always wins either way) —
// PROVIDED a frame_context rides along (see CanvasSeed's doc comment).
async function fetchCanvasPreview(env: Env, seed: CanvasSeed, themeId: string): Promise<{ html: string; css: string } | null> {
  const body: Record<string, unknown> = {
    content_json: seed.contentJson,
    theme_id: themeId,
    frame_context: seed.frameContext,
    viewport: "desktop",
  };
  let res: Response;
  try {
    res = await leadgenApi.request(
      "/api/admin/leadgen/sections/preview",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      env,
    );
  } catch {
    return null;
  }
  if (res.status !== 200) return null;
  let parsed: CanvasPreviewBody;
  try {
    parsed = (await res.json()) as CanvasPreviewBody;
  } catch {
    return null;
  }
  const preview = parsed.preview;
  if (preview === undefined || typeof preview.html !== "string" || typeof preview.css !== "string") return null;
  return { html: preview.html, css: preview.css };
}

// The canvas mount: a real, isolated iframe rendering the REAL renderer's
// output for the current theme (mirrors themes.ts/funnel.ts's OWN mini-
// preview `srcdoc` technique — the established pattern for a live admin
// preview surface in this codebase). `escapeHtml` safely embeds the nested
// document as the outer attribute value (it escapes both quote characters).
function renderCanvasFrame(preview: { html: string; css: string } | null, isFixture: boolean): string {
  if (preview === null) {
    return (
      `<div class="lg-theme-canvas-error" style="padding:16px;font-size:12px;color:${TM_COLOR.footerText};` +
      `background:${TM_COLOR.footerBg};border-radius:10px;text-align:center">Preview unavailable.</div>`
    );
  }
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${preview.css}</style></head><body>${preview.html}</body></html>`;
  const fixtureLabel = isFixture
    ? `<div style="font-size:10.5px;color:${TM_COLOR.subtitle};margin-top:6px;text-align:center">${escapeHtml(CANVAS_FIXTURE_LABEL)}</div>`
    : "";
  return (
    `<iframe class="tm-canvas-frame" title="Live theme preview" sandbox="allow-same-origin"` +
    ` style="width:100%;min-height:360px;border:0;background:${TM_COLOR.appBg};border-radius:12px"` +
    ` srcdoc="${escapeHtml(srcdoc)}"></iframe>` +
    fixtureLabel
  );
}

// ---------------------------------------------------------------------------
// Small render helpers
// ---------------------------------------------------------------------------

function swatch(hex: string, withBorder: boolean): string {
  const border = withBorder ? `border:1px solid ${TM_COLOR.swatchBorder};` : "";
  return `<span style="width:22px;height:22px;border-radius:6px;${border}background:${safeHex(hex)}"></span>`;
}

// P6b round 2: widened to accept `undefined` (was `string`-only) — the 7
// extra_roles are OPTIONAL, so a preset that never set one calls this with
// `theme.extra_roles?.[key]`; safeHex already accepted undefined/null, this
// just lets a legitimate optional-role caller reach it without a cast.
function bigSwatch(hex: string | undefined, withBorder: boolean): string {
  const border = withBorder ? `border:1px solid ${TM_COLOR.swatchBorder};` : "";
  return `<span style="width:40px;height:40px;border-radius:10px;flex:0 0 auto;${border}background:${safeHex(hex)}"></span>`;
}

function badgeHtml(matches: VariantThemeUsage[]): string {
  const kind = usageBadgeKind(matches);
  const text = usageBadgeText(matches);
  const bg = kind === "live" ? TM_COLOR.liveBadgeBg : kind === "ab" ? TM_COLOR.abBadgeBg : TM_COLOR.draftBadgeBg;
  const color = kind === "live" ? TM_COLOR.liveBadgeText : kind === "ab" ? TM_COLOR.abBadgeText : TM_COLOR.draftBadgeText;
  return `<span style="font-size:9.5px;font-weight:800;letter-spacing:.4px;color:${color};background:${bg};padding:2px 7px;border-radius:10px">${escapeHtml(text)}</span>`;
}

function buildThemesHref(themeId: string, from: string): string {
  const params = new URLSearchParams();
  params.set("theme", themeId);
  if (from !== "") params.set("from", from);
  return `/admin/leadgen/themes?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// TOP BAR (golden :631-636)
// ---------------------------------------------------------------------------

// R5 D6 (register S4-A11): `embed` marks the "← Back to section" link with
// data-tm-embed-close so the ES5 embed-only script (below, gated the same
// way) can intercept the click and postMessage the STUDIO PARENT to close
// the overlay instead of navigating the iframe itself. The href stays a
// real, working fallback (direct-link / no-JS / opened standalone).
//
// P6b: gated additionally on `from !== ""` — the close-intercept only makes
// sense when there IS a specific "from" surface to signal closing back to
// (Section Studio's own usage always pairs embed=1 with a from=<sectionId>).
// ui-quotes.ts's NEW Themes-tab embed (deliverable 3) passes embed=1 with NO
// `from` (there is no "close the overlay" concept in a persistent tab) — for
// that shape the link stays a PLAIN, working navigation instead of an inert
// preventDefault-then-nothing dead click. Zero change to the existing
// Section Studio path (from is never empty there).
function renderTopBar(from: string, embed: boolean): string {
  const backHref = from !== "" ? `/admin/leadgen/sections/${encodeURIComponent(from)}/edit` : "/admin/leadgen/sections";
  const backAttr = embed && from !== "" ? " data-tm-embed-close" : "";
  return `<div style="flex:0 0 auto;height:56px;display:flex;align-items:center;gap:14px;padding:0 18px;background:${TM_COLOR.topbarBg};border-bottom:1px solid ${TM_COLOR.topbarBorder}">
  <a href="${escapeHtml(backHref)}" class="tm-back"${backAttr} style="display:flex;align-items:center;gap:7px;padding:7px 12px 7px 9px;border:1px solid ${TM_COLOR.lineControl};border-radius:8px;cursor:pointer;color:${TM_COLOR.back};font-weight:600;font-size:13px;text-decoration:none"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M14 6l-6 6 6 6" stroke="${TM_COLOR.backIcon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Back to section</a>
  <div style="width:1px;height:24px;background:${TM_COLOR.divider}"></div>
  <div style="display:flex;align-items:baseline;gap:9px"><span style="font-size:17px;font-weight:800;color:${TM_COLOR.title}">Themes</span><span style="font-size:12.5px;color:${TM_COLOR.subtitle}">one look &amp; feel per funnel · A/B-testable in a quote</span></div>
  <button type="button" id="tm-new-theme" class="tm-new-theme" data-from="${escapeHtml(from)}" style="margin-left:auto;display:inline-flex;align-items:center;gap:7px;padding:9px 15px;background:${TM_COLOR.navy};color:#fff;font-weight:700;font-size:13px;border-radius:8px;cursor:pointer;box-shadow:0 1px 2px rgba(27,58,92,.28);border:0"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/></svg>New theme</button>
</div>
<div id="tm-error" role="alert" style="display:none;padding:8px 18px;background:#FBEEEC;color:${TM_COLOR.errText};font-size:12.5px" hidden></div>`;
}

// R5 D6: strict-ES5 embed-only script — posts a close request to the parent
// window (the Section Studio) instead of letting the "Back to section" link
// navigate the IFRAME itself. Scoped to same-origin only (this route is
// same-origin admin-only; no cross-origin embed is ever legitimate).
const TM_EMBED_SCRIPT = `
(function () {
  var backEl = document.querySelector('[data-tm-embed-close]');
  if (backEl) {
    backEl.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'lg-themes-embed', action: 'close' }, window.location.origin);
      }
    });
  }
}());
`;

// ---------------------------------------------------------------------------
// LEFT — theme list (golden :641-658)
// ---------------------------------------------------------------------------

function renderLeftList(
  themes: ThemeRecord[],
  usage: VariantThemeUsage[],
  selectedId: string | null,
  from: string,
): string {
  const cards =
    themes.length === 0
      ? `<div style="font-size:12.5px;color:${TM_COLOR.footerText}">No themes yet — use New theme to create one.</div>`
      : themes
          .map((theme) => {
            const matches = usageForTheme(usage, theme.id);
            const active = theme.id === selectedId;
            const cardStyle = active
              ? `border:2px solid ${TM_COLOR.cardActiveBorder};background:${TM_COLOR.cardActiveBg};border-radius:12px;padding:13px;cursor:pointer;box-shadow:0 2px 8px rgba(16,24,40,.08)`
              : `border:1px solid ${TM_COLOR.cardBorder};background:#fff;border-radius:12px;padding:13px;cursor:pointer`;
            return `<a href="${escapeHtml(buildThemesHref(theme.id, from))}" style="${cardStyle};text-decoration:none;display:block">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-size:13.5px;font-weight:700;color:${TM_COLOR.cardName}">${escapeHtml(theme.name)}</span>${badgeHtml(matches)}</div>
          <div style="display:flex;gap:5px">${swatch(theme.roles.brand_primary, false)}${swatch(theme.roles.accent, false)}${swatch(theme.roles.page_bg, true)}${swatch(theme.roles.text, false)}</div>
        </a>`;
          })
          .join("\n        ");

  return `<div style="flex:0 0 300px;background:#fff;border-right:1px solid ${TM_COLOR.topbarBorder};display:flex;flex-direction:column;min-height:0">
      <div style="padding:16px 16px 8px;font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${TM_COLOR.eyebrow}">Your themes</div>
      <div style="flex:1 1 auto;overflow-y:auto;padding:4px 14px 16px;display:flex;flex-direction:column;gap:10px">
        ${cards}
      </div>
      <div style="flex:0 0 auto;padding:13px 15px;border-top:1px solid ${TM_COLOR.footerBorder};background:${TM_COLOR.footerBg};font-size:11.5px;color:${TM_COLOR.footerText};line-height:1.5"><b style="color:${TM_COLOR.footerStrong}">A/B testing:</b> assign different themes to two variants of the same funnel to see which converts better.</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// CENTER — editor (golden :661-701, contract §10.4)
// ---------------------------------------------------------------------------

// R2 P8 M2 / S3.11: converged VERBATIM (word-for-word, comma vs "·" only)
// with quotes-tabs/shared.ts's ROLE_META for every role both files describe —
// the rail and this manager must never describe the same role differently
// (test/leadgen-p8-m2-role-usedby.test.ts pins the convergence). brand_primary
// and text also correct two now-fixed false claims — see shared.ts's own
// ROLE_META comment for the full per-role evidence (frozen, unwired copies:
// progress.fillColor / iconCard.selectedBorderColor / header.logoColor for
// brand_primary; headline.color / page.textSecondaryColor for text).
// Exported (S3.11): so test/leadgen-p8-m2-role-usedby.test.ts can pin this
// table's words against the REAL rail (shared.ts's ROLE_META) and the REAL
// generated stylesheet without a second, hand-copied fixture — no rendering
// behaviour changes (renderCenterEditor's own `ROLE_META.map(...)` call is
// unchanged).
export const ROLE_META: ReadonlyArray<{ key: ThemeRecordRoleKey; label: string; sub: string; border: boolean }> = [
  // FIX ROUND F3 (MINOR-4) — "progress fill" restored in lockstep with
  // shared.ts's ROLE_META (same evidence: frames.ts:645 defaults every frame's
  // progress to the brand_primary role and default-funnel/styles.ts:2553-2558
  // paints `.lg-frame-progress--role-brand_primary .lg-progress-fill` from it).
  // FIX ROUND F11 (review-p8-3b MINOR-3, the correction F10 measured but could
  // not land) — "buttons" -> "stepper buttons", in lockstep with
  // quotes-tabs/shared.ts's ROLE_META (I4 of
  // test/leadgen-p8-m2-role-usedby.test.ts requires the two tables to read the
  // SAME words, so they move together). Evidence: an exhaustive sentinel sweep
  // of the REAL resolveTokens+funnelChromeCss pair — of the 15 declarations
  // that move with this role, the only button-shaped one is
  // `.lg-range-stepper-btn`; every button a funnel actually renders follows
  // button_primary_bg. Full measurement in shared.ts's own ROLE_META comment.
  // FIX ROUND F13 (review-p8-3c MINOR-4) — "trust-row icons" and "list check
  // marks" added, in lockstep with shared.ts's ROLE_META: review #3's sweep
  // through the real PUT route found three unconditional painted declarations
  // this row did not name (`.lg-frame-trustrow-icon` and the check glyph of
  // both `--check` frame lists). Full measurement in shared.ts's own comment.
  { key: "brand_primary", label: "Brand primary", sub: "stepper buttons · progress fill · focus ring · trust-row icons · list check marks", border: false },
  { key: "accent", label: "Accent", sub: "category label · highlights · recommended", border: false },
  { key: "page_bg", label: "Page background", sub: "frame background", border: true },
  // R2 P8-3 FIX ROUND F8 — "input fields" added, in lockstep with
  // shared.ts's ROLE_META (same evidence: color.card is ALSO `.lg-input`'s
  // resting background, default-funnel/styles.ts:1845 — see shared.ts's own
  // ROLE_META comment for the full measurement).
  { key: "card", label: "Card", sub: "question card · answer cards · input fields", border: true },
  { key: "text", label: "Text", sub: "body text · input text", border: false },
  { key: "success", label: "Success", sub: "reassurance · valid states", border: false },
];

// P6b round 2 (deliverable 3 — "presets carry+expose the v2 axes"): the 7
// ADDITIONAL roles theme.ts's ThemeRecord.extra_roles carries, completing the
// 14-role palette a rich preset can now author. Labels/sub-text copied
// VERBATIM from ui-quotes.ts's own 14-role ROLE_META for these same 7 keys
// (the inline funnel-theme editor) so the SAME role reads with the SAME
// human name in both editors. All 7 are OPTIONAL (a preset may set some/all/
// none) — renderCenterEditor below falls back to a neutral placeholder swatch
// for any unset key (safeHex's existing undefined-input handling).
// S3.11: surface_wash/text_muted/button_secondary_bg corrected in lockstep
// with shared.ts's ROLE_META (same evidence, same replacement words) — see
// this file's own ROLE_META comment above for the pointer.
export const EXTRA_ROLE_META: ReadonlyArray<{ key: ThemeRecordExtraRoleKey; label: string; sub: string; border: boolean }> = [
  { key: "brand_secondary", label: "Brand secondary", sub: "gradients · secondary emphasis", border: false },
  { key: "surface_wash", label: "Soft fill", sub: "range-slider focus ring", border: false },
  // FIX ROUND F11 — "card/input borders" -> "answer card/input borders", in
  // lockstep with shared.ts's ROLE_META. The bare noun "card" read as the
  // QUESTION card (which this role provably does not paint: driven, it stayed
  // rgb(233,237,243)); the three unconditional component borders that DO move
  // are `.lg-card`, `.lg-btn.lg-btn-answer` and `.lg-input`. Full measurement
  // in shared.ts's own ROLE_META comment.
  // FIX ROUND F13 (review-p8-3c MINOR-5) — "progress steps" / "progress track"
  // added, same lockstep, same reason: the numbered step's 2px border and the
  // percent track's inset ring both move with this role and were unnamed.
  { key: "border", label: "Border", sub: "answer card/input borders · progress steps · progress track", border: true },
  { key: "text_muted", label: "Muted text", sub: "labels · disclosure text", border: false },
  { key: "button_primary_bg", label: "Button", sub: "Continue/CTA background", border: false },
  { key: "button_primary_text", label: "Button text", sub: "Continue/CTA text", border: false },
  { key: "button_secondary_bg", label: "Secondary button", sub: "benefit bar · disclosure bar", border: false },
];

// R2 P8-3 N20 — THEME_RECORD_FONT_NAMES's original 3 (Newsreader/Inter/Roboto
// Mono) are NOT self-hosted (theme.ts's own THEME_RECORD_FONT_STACKS doc
// comment; fonts.generated.ts's LEADGEN_SELF_HOSTED_FONT_FAMILIES is the 8
// that follow, and only the 8 the renderer actually vendors a @font-face
// for) — the SAME "back-compat, not self-hosted" set the funnel-theme rail
// (quotes-tabs/themes.ts THEME_FONT_LABELS) also demotes. They keep their
// EXACT enum values (a preset already storing one renders byte-identically —
// same THEME_RECORD_FONT_STACKS lookup, untouched) but sort after the 8 real
// choices.
// FIX ROUND F2 — the first pass labelled these "(legacy)", which is
// engineering vocabulary printed to a marketer; the product's own
// jargon-scan gate correctly rejected it (owner verbatim: "the rules you
// build are using jargon" / "theme is only design language!!!! colors,
// fonts, sizes"). Replaced with a plain-English OUTCOME label: because none
// of these 3 families is vendored a @font-face (confirmed above), a visitor
// whose device does not already have that exact family installed sees the
// generic stack THEME_RECORD_FONT_STACKS falls to instead (Georgia/
// system-ui/monospace) — the label says what will happen, not why. Same
// wording, same mechanism, on the rail (quotes-tabs/themes.ts
// THEME_FONT_LABELS) — the two were deliberately converged; do not let them
// drift apart again.
const THEME_RECORD_FONT_LEGACY_NAMES: ReadonlySet<ThemeRecordFontName> = new Set(["Newsreader", "Inter", "Roboto Mono"]);
// Fresh (self-hosted) choices first, unavailable-labelled last — DISPLAY
// ORDER only; every name THEME_RECORD_FONT_NAMES carries is still present
// and still the exact PATCH value (I1: values never change, only what is
// displayed).
const THEME_RECORD_FONT_SELECT_NAMES: readonly ThemeRecordFontName[] = [
  ...THEME_RECORD_FONT_NAMES.filter((n) => !THEME_RECORD_FONT_LEGACY_NAMES.has(n)),
  ...THEME_RECORD_FONT_NAMES.filter((n) => THEME_RECORD_FONT_LEGACY_NAMES.has(n)),
];
// R2 P8-3 FIX ROUND F13 (BLOCKER-2) — THE SAME WORDS, OFF THE OPTION TEXT.
// F2's parenthetical is what N7 then measured on this very page: these two
// selects PAINT IN THE FAMILY THEY NAME, and in the monospace stack
// "Roboto Mono (shows as default font)" is 294px of text in a 282px box (+12px
// at 1280 AND 375, title=null at load and after document.fonts.ready) — the
// closing paren cut, the chevron over the glyphs, on the manager's own default
// theme. A 24-character suffix on the option text cannot be made to fit a box
// this control does not control, so the suffix comes OFF the option text and
// the SAME WORDS are carried in the two places that are not inside the box:
//   * the <optgroup> heading over the not-served families — the idiomatic HTML
//     place for "everything below this line has this property", written once
//     instead of once per option, and rendered in the dropdown the operator
//     opens (emitted only when one of those families is actually STORED, so a
//     theme on a vendored family never gets an empty heading over its hidden
//     options); and
//   * a caption under the control (fontSelectRow), which is what keeps the
//     closed select honest — today's parenthetical is the only thing that
//     tells an operator who never opens the dropdown, and dropping it without
//     replacement would trade a clipped truth for a hidden one.
// The option's VALUE and the stored record are untouched (I1), and the rail
// (quotes-tabs/themes.ts) still says the same words in its own parenthetical:
// there, all three not-served ids stay hidden permanently because the stored
// id is only assigned client-side after hydration, so an <optgroup> would
// stand over nothing — the closed control is the only place the rail can say
// it, and the rail's 312px box shows it in full (driven, +0px at 1280 and 375
// across all 90 options). Same sentence, two surfaces, each where it fits.
// FIX ROUND F14 (review-p8-3d MINOR-4) — WHY THE TWO PRESENTATIONS STAY
// DIFFERENT, since F3's own note says "do not let them drift apart again" and
// the review is right that an operator now meets two shapes of one sentence.
// The WORDS are identical and pinned as identical (the N20 leg in
// test/leadgen-p8-n-theme-ui.test.ts slices the rail's parenthetical out of one
// real render and this heading plus its caption out of the other, and requires
// the same words). What differs is the REGISTER, and it follows from the place,
// which is itself measured, not chosen: a standalone heading and a caption are
// sentences of their own, so they start with a capital; the rail's is a
// mid-string parenthetical inside an option label, so it does not. Converging
// the presentation would mean one of two things, and both are measured shut:
// putting the suffix back on THIS page's option text is BLOCKER-2 again (294px
// of text in a 282px box, in the family the option names), and moving the rail
// to an <optgroup> would stand a heading over options that are permanently
// hidden there (its stored id is assigned client-side after hydration) — and
// that markup lives in quotes-tabs/themes.ts, not in this file. So: one
// vocabulary, one sentence, two registers, each forced by where the sentence
// has to sit. If the rail ever gains a server-known stored id, converge them.
const FONT_NOT_SERVED_NOTE = "Shows as default font";

// FIX ROUND F3 (MINOR-1) — ONE FONT VOCABULARY, FINISHED.
// N20 asks for one vocabulary across this manager and the funnel-theme rail.
// F2 converged 8 of 11 names and the reviewer measured the rest still split:
// this page OFFERED Newsreader/Inter/Roboto Mono, the rail OFFERED Literata/
// Sora/System — six families on one surface and not the other, and none of
// the six is vendored (fonts.generated.ts), so picking one afresh cannot be
// honoured (contract §4 R3 corollary). The three are therefore no longer
// OFFERED — `hidden` keeps them out of the dropdown a human opens — while the
// one that is ALREADY STORED is un-hidden, stays `selected`, keeps its exact
// enum value and renders through the untouched THEME_RECORD_FONT_STACKS
// lookup, byte-identically to today. Same mechanism, same words, in
// quotes-tabs/themes.ts's themeFontOptions(); the offered set on the two
// surfaces is now identical — do not let them drift apart again.
function fontOptionsHtml(selected: ThemeRecordFontName): string {
  const optionFor = (name: ThemeRecordFontName): string => {
    const isSelected = name === selected;
    const notOffered = THEME_RECORD_FONT_LEGACY_NAMES.has(name) && !isSelected ? " hidden" : "";
    return `<option value="${escapeHtml(name)}"${isSelected ? " selected" : ""}${notOffered}>${escapeHtml(name)}</option>`;
  };
  const offered = THEME_RECORD_FONT_SELECT_NAMES.filter((n) => !THEME_RECORD_FONT_LEGACY_NAMES.has(n)).map(optionFor).join("");
  const notServed = THEME_RECORD_FONT_SELECT_NAMES.filter((n) => THEME_RECORD_FONT_LEGACY_NAMES.has(n)).map(optionFor).join("");
  return THEME_RECORD_FONT_LEGACY_NAMES.has(selected)
    ? `${offered}<optgroup label="${escapeHtml(FONT_NOT_SERVED_NOTE)}">${notServed}</optgroup>`
    : offered + notServed;
}

function fontSelectRow(id: string, label: string, current: ThemeRecordFontName, themeId: string): string {
  // The caption rides OUTSIDE the select's box (a wrapping div in the grid
  // cell, ~308px wide against 110px of text at 11.5px), so unlike the suffix
  // it replaces it cannot be clipped by the control it describes.
  const note = THEME_RECORD_FONT_LEGACY_NAMES.has(current)
    ? `<div data-tm-font-note="${escapeHtml(id)}" style="font-size:11.5px;color:${TM_COLOR.subtitle};margin-top:5px">${escapeHtml(FONT_NOT_SERVED_NOTE)}</div>`
    : "";
  return `<div><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:5px">${escapeHtml(label)}</div>
          <div class="tm-font-select-wrap" style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid ${TM_COLOR.lineControl};border-radius:8px">
            <select id="${id}" data-theme-id="${escapeHtml(themeId)}" style="appearance:none;-webkit-appearance:none;border:0;background:transparent;outline:none;font-family:${TM_FONT_PREVIEW_STACK[current]};font-size:14px;color:${TM_COLOR.fontPreview};width:100%;cursor:pointer">${fontOptionsHtml(current)}</select>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="pointer-events:none;flex:0 0 auto"><path d="M6 9l6 6 6-6" stroke="${TM_COLOR.chevron}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>${note}
        </div>`;
}

const FIELD_HEIGHT_OPTS: ReadonlyArray<{ value: ThemeRecordFieldHeight; label: string }> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];
const BUTTON_SIZE_OPTS: ReadonlyArray<{ value: ThemeRecordButtonSize; label: string }> = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
];
const CORNERS_OPTS: ReadonlyArray<{ value: ThemeRecordCorners; label: string }> = [
  { value: "sharp", label: "Sharp" },
  { value: "rounded", label: "Rounded" },
  { value: "pill", label: "Pill" },
];

// P6b round 2 (deliverable 3) — option tables for the 4 new segmented
// controls (typography.display_size + the button_style triple), matching the
// SAME enums/labels ui-quotes.ts's inline theme editor already exposes for
// funnel-level theming (Round-4 P6b round 1), so a preset and an inline theme
// present the SAME vocabulary to the operator.
const DISPLAY_SIZE_OPTS: ReadonlyArray<{ value: ThemeDisplaySizeScale; label: string }> = [
  { value: "m", label: "Base" },
  { value: "l", label: "Large" },
  { value: "xl", label: "X-Large" },
  { value: "xxl", label: "XX-Large" },
];
const BUTTON_FILL_OPTS: ReadonlyArray<{ value: ThemeButtonStyle; label: string }> = [
  { value: "fill", label: "Solid" },
  { value: "outline", label: "Outline" },
  { value: "soft", label: "Soft" },
];
// Rework §8.4 follow-up round (conductor-granted, P3b union at 7a12ee7): the
// THIRD Answer-layout value — theme.ts's THEME_BUTTON_LAYOUTS now carries
// "card" (presets.ts renders title/subtitle tscards for button groups under
// layout==="card"; themes-handlers.ts's write-time validator already accepts
// it, since it re-reads THEME_BUTTON_LAYOUTS itself, no separate change
// needed there). Same segmentedControl mechanism as Grid/List — the pack's
// 8.4-editor-controls region pins this as a plain third segment (its "NEW"
// pill is pack-authoring chrome for the P0 mock, not a persisted value).
const BUTTON_LAYOUT_OPTS: ReadonlyArray<{ value: ThemeButtonLayout; label: string }> = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
  { value: "card", label: "Card" },
];
const BUTTON_SELECTED_OPTS: ReadonlyArray<{ value: ThemeButtonSelectedStyle; label: string }> = [
  { value: "wash", label: "Wash" },
  { value: "mark", label: "Mark" },
];

// P6b round 2: `topGroup` is the PATCH body's top-level key this control's
// group nests under (theme.ts's ThemeRecord shape: controls.*/typography.*/
// button_style.*) — stamped as `data-top` so THEME_MGR_SCRIPT's wireSegments
// can build the right patch shape generically instead of always assuming
// `controls` (the ONLY top-level group before this round). The 3 EXISTING
// call sites below now pass "controls" explicitly — byte-identical resulting
// PATCH body to before this change (still `{controls:{<group>:<value>}}`).
function segmentedControl<T extends string>(
  topGroup: "controls" | "typography" | "button_style",
  group: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T,
  themeId: string,
): string {
  const segs = options
    .map((opt) => {
      const active = opt.value === current;
      const style = active
        ? `flex:1;text-align:center;font-size:12px;padding:6px;background:#fff;border-radius:6px;color:${TM_COLOR.segActiveText};font-weight:700;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.1)`
        : `flex:1;text-align:center;font-size:12px;padding:6px;color:${TM_COLOR.segInactiveText};font-weight:600;cursor:pointer`;
      return `<div data-tm-seg data-top="${topGroup}" data-group="${group}" data-value="${escapeHtml(opt.value)}" data-theme-id="${escapeHtml(themeId)}" style="${style}">${escapeHtml(opt.label)}</div>`;
    })
    .join("");
  return `<div style="display:flex;background:${TM_COLOR.segBg};border-radius:8px;padding:2px">${segs}</div>`;
}

// P6b round 2: `topGroup` mirrors segmentedControl's — "roles" for the
// original 7 (existing call site now passes it explicitly, same resulting
// `{roles:{<key>:<hex>}}` PATCH body as before), "extra_roles" for the 7 new
// ones (a SEPARATE optional group, never merged into the required 7-key
// `roles`).
function advancedHexRow(topGroup: "roles" | "extra_roles", key: string, hex: string, themeId: string): string {
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0"><span style="font-size:12px;color:${TM_COLOR.segInactiveText}">${escapeHtml(key)}</span><input data-tm-hex data-top="${topGroup}" data-role="${key}" data-theme-id="${escapeHtml(themeId)}" value="${escapeHtml(hex)}" spellcheck="false" style="font-family:'Roboto Mono',monospace;font-size:11.5px;color:${TM_COLOR.monoTextStrong};background:${TM_COLOR.monoBg};padding:2px 8px;border-radius:5px;border:1px solid transparent;width:88px;text-align:right" /></div>`;
}

// R2 P8-3 FIX ROUND F3 (BLOCKER-1) — THE FONT SELECT'S BOX, NOT ITS LABEL.
// Two edits below, both in this function's markup (kept out here in TS so the
// served bytes carry none of it):
//
// 1. data-pin="8.4-editor-controls" — min-width:0 -> min-width:300px.
//    FAIL-BEFORE (reviewer, driven at 375): min-width:0 let this column shrink
//    without limit instead of letting its flex line WRAP, so it measured ~118px
//    and squeezed #tm-headline-font to a 14.00px content box (every option
//    overflowed, even "Poppins" at 52px) while #tm-body-font collapsed to w=0
//    and vanished. A real shrink floor makes the row wrap instead of grinding
//    both columns down. 1280 IS UNCHANGED: hypothetical sizes 300 + 26 (gap) +
//    340 (the flex:0 1 340px preview column) = 666 still fit the 670px row the
//    reviewer measured (304 + 26 + 340), and this column still grows to that
//    same 304px.
//    CORRECTION, FIX ROUND F10 — this comment used to continue "At 375 the row
//    is ~343px, 666 > 343, so the two columns stack and this one takes the
//    full 343px." THAT SENTENCE WAS FALSE and the product falsified it: the
//    row it describes is inside the CENTRE PANE, and at 375 that pane measured
//    56.0px (clientWidth 56, scrollWidth 348), because .tm-body was a nowrap
//    row with two unshrinkable 300/320 rails. So this column did take a full
//    line — a 300px line starting at x=345, 270px outside a 375 viewport, with
//    its two font selects 6% visible. The stacking that makes the sentence
//    true had to be added one level up (.tm-body's flex-wrap, THEME_MGR_STYLES
//    below); at 375 the centre pane is now the full 341px line and this column
//    takes 300..341 of it, on screen. Never re-argue a width in prose here:
//    the numbers above and below are driven measurements of this page.
//
// 2. data-pin="8.4-typography-grid" — 1fr 1fr -> repeat(auto-fit,minmax(320px,
//    1fr)). FAIL-BEFORE (reviewer, driven at 1280): 1fr 1fr gave each font
//    select a 107.00px content box, so the select truncated its OWN selected
//    value — "Inter (shows as default font)" 181.2px (+74.2), "Roboto Mono (…)"
//    238.2px (+131.2), "Newsreader (…)" 229.3px (+122.3). Same mechanism as the
//    rail's .lg-scalars (quotes-tabs/shared.ts): auto-fit plus a minmax floor,
//    so a column that cannot seat two full-size cells becomes ONE full-width
//    cell instead of halving the box.
//    ARITHMETIC: a cell loses 24 (wrap padding) + 2 (wrap border) + 12
//    (chevron) = 38px to chrome, and the widest label this select can ever
//    show is a STORED non-vendored family — "Roboto Mono (shows as default
//    font)", 238.2px measured / 255.1px by the test's conservative model — so
//    a cell must clear ~293px. The 320px floor does: one column below 654px
//    (worst case = this column's own 300px floor -> 262.00px of content), two
//    320px columns at or above it (-> 282.00px). At 1280 the column is 304px,
//    so the two selects stack and each box is 266.00px. The 220px floor tried
//    first was NOT enough and the spec caught it: at a 454px column it went
//    2-up with 182.00px boxes and all three stored-family labels overflowed.
//    test/leadgen-p8-n-theme-ui.test.ts recomputes this from THESE inline
//    styles for every option of both selects at every column width, so a
//    revert to 1fr 1fr (or to min-width:0, or a narrower floor) fails there.
function renderCenterEditor(theme: ThemeRecord, matches: VariantThemeUsage[], canvasHtml: string): string {
  const colorRows = ROLE_META.map(
    (meta) =>
      `<div style="display:flex;align-items:center;gap:12px;cursor:pointer">${bigSwatch(theme.roles[meta.key], meta.border)}<div><div style="font-size:13px;font-weight:600;color:${TM_COLOR.roleLabel}">${escapeHtml(meta.label)}</div><div style="font-size:11px;color:${TM_COLOR.roleSub}">${escapeHtml(meta.sub)}</div></div></div>`,
  ).join("\n        ");

  // P6b round 2 (deliverable 3) — the 7 additional roles completing the
  // 14-role palette. `theme.extra_roles?.[key]` is `undefined` for a
  // pre-P6/never-set role; bigSwatch/safeHex already render undefined as the
  // neutral placeholder (no new fallback logic needed).
  const extraColorRows = EXTRA_ROLE_META.map(
    (meta) =>
      `<div style="display:flex;align-items:center;gap:12px;cursor:pointer">${bigSwatch(theme.extra_roles?.[meta.key], meta.border)}<div><div style="font-size:13px;font-weight:600;color:${TM_COLOR.roleLabel}">${escapeHtml(meta.label)}</div><div style="font-size:11px;color:${TM_COLOR.roleSub}">${escapeHtml(meta.sub)}</div></div></div>`,
  ).join("\n        ");

  const advRows = THEME_RECORD_ROLE_KEYS.map((key) => advancedHexRow("roles", key, theme.roles[key], theme.id)).join(
    "\n          ",
  );
  // Advanced hex rows for the 7 extra_roles — "" (empty input) for an unset
  // one rather than inventing a fake default; typing a hex here PATCHes
  // exactly like an original role's row (mergeThemeBody/validateThemeBody
  // now accept `extra_roles.<key>`, P6b round 2).
  const extraAdvRows = THEME_RECORD_EXTRA_ROLE_KEYS.map((key) =>
    advancedHexRow("extra_roles", key, theme.extra_roles?.[key] ?? "", theme.id),
  ).join("\n          ");

  const buttonStyle = theme.button_style ?? {};

  // §8.4: editor controls (LEFT-of-center) beside the live canvas (RIGHT-of-
  // center) — pack regions 8.4-editor-controls / 8.4-live-canvas, both
  // nested INSIDE the SAME outer flex:1 1 auto CENTER column (rails stay
  // 300/320, unchanged — only this column's OWN internal layout gains a
  // second child). All EXISTING editor content below is UNCHANGED.
  //
  // R2 P6 (measured layout defect, owner clause ③): this row had NO
  // flex-wrap and an UNSHRINKABLE flex:0 0 340px canvas, so on any viewport
  // where the centre column's inner width fell below <editor>+26+340 the
  // flexible editor child absorbed the entire deficit and computed to
  // width 0 — every §10.3/§10.4 control it holds was hidden. Measured on
  // the real page BEFORE this change (rails 300+320 + the admin nav's
  // 300px): editor width 0px @1280, 24px @1366, 98px @1440 — i.e. broken on
  // every ordinary laptop; only ≥~1650 rendered.
  //
  // Degrade chosen: keep the §8.4 side-by-side anatomy WHEREVER IT FITS and
  // wrap to a stack where it does not. flex-wrap breaks a line on the items'
  // HYPOTHETICAL (un-shrunk) sizes, so the editor's basis is the explicit
  // "how much room does BESIDE require" knob: 240 + 26 gap + 340 canvas =
  // 606px of centre-inner. At 1600 the centre's inner width is 624px ⇒ one
  // line, editor 258 / canvas 340 — byte-for-byte today's anatomy. Below
  // ~1582 viewport the canvas wraps UNDER the controls (DOM order kept) and
  // the editor takes the full line instead of collapsing. The canvas is now
  // flex:0 1 (shrink allowed, grow still 0) with min-width:0 so on its own
  // line it fits a narrow column instead of overflowing it, while keeping
  // its designed 340px wherever there is room. No media query: the trigger
  // is this column's OWN width, so the ?embed=1 standalone shell (no admin
  // nav) degrades on the same rule.
  return `<div data-pin="8.4-center-pane" style="flex:1 1 348px;overflow-y:auto;padding:24px 28px;min-width:0">
    <div style="display:flex;flex-wrap:wrap;gap:26px;align-items:flex-start">
    <div style="flex:1 1 240px;min-width:300px" data-pin="8.4-editor-controls">
      <div style="display:flex;align-items:center;gap:13px;margin-bottom:5px">
        ${bigSwatch(theme.roles.brand_primary, false)}
        <!-- R4a E3-NEW-6: the server already supports PATCH {name}
             (themes-handlers.ts mergeThemeBody/validateThemeBody) — this
             was the only missing piece: an input to send it. Reuses the
             SAME patchTheme() ES5 helper every other control here calls. -->
        <input type="text" id="tm-theme-name" class="tm-name-input" data-tm-name data-theme-id="${escapeHtml(theme.id)}" value="${escapeHtml(theme.name)}" maxlength="80" aria-label="Theme name" style="font-size:21px;font-weight:800;color:${TM_COLOR.themeTitle};border:1px solid transparent;border-radius:6px;padding:2px 6px;margin:-2px -6px;background:transparent;min-width:0;flex:1 1 auto" />
      </div>
      <div style="font-size:12.5px;color:${TM_COLOR.themeUse};margin-bottom:24px">${escapeHtml(themeUseLine(matches))}</div>

      <div style="font-size:11px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${TM_COLOR.sectionEyebrow};margin-bottom:13px">Colors — semantic roles</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;margin-bottom:11px">
        ${colorRows}
      </div>
      <div style="display:flex;align-items:flex-start;gap:8px;background:${TM_COLOR.noteBg};border-radius:9px;padding:11px 13px;font-size:11.5px;color:${TM_COLOR.noteText};line-height:1.45;margin-bottom:24px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex:0 0 auto;margin-top:1px"><path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z" stroke="${TM_COLOR.noteIcon}" stroke-width="1.7"/></svg>Components reference these roles, never fixed shades — change one here and every question in the funnel reskins.</div>

      <!-- P6b round 2 (deliverable 3) — the 7 roles completing the 14-role
           palette (theme.ts ThemeRecord.extra_roles); no golden line ref
           (a follow-on ruling beyond the original §10.4 mockup's 7-swatch
           set). Same swatch/label pattern as "Colors — semantic roles"
           above, editable the SAME way (Advanced hex, below). -->
      <div style="font-size:11px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${TM_COLOR.sectionEyebrow};margin-bottom:6px">More roles — completing the 14-role palette</div>
      <div style="font-size:11.5px;color:${TM_COLOR.subtitle};line-height:1.45;margin-bottom:13px">Optional — set any of these under Advanced to move past the design's default for that role.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;margin-bottom:24px">
        ${extraColorRows}
      </div>

      <div style="font-size:11px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${TM_COLOR.sectionEyebrow};margin-bottom:13px">Typography</div>
      <div data-pin="8.4-typography-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px">
        ${fontSelectRow("tm-headline-font", "Headline font", theme.typography.headline_font, theme.id)}
        ${fontSelectRow("tm-body-font", "Body font", theme.typography.body_font, theme.id)}
      </div>
      <!-- P6b round 2 (deliverable 3) — the display-only size ramp
           (theme.ts ThemeRecordTypography.display_size), mirroring the
           inline theme editor's SAME "Display size" control (Round-4 P6b
           round 1, ui-quotes.ts). Absent ⇒ "m" (base) ⇒ identity. -->
      <div style="max-width:50%;margin-bottom:24px"><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:6px">Display size</div>${segmentedControl("typography", "display_size", DISPLAY_SIZE_OPTS, theme.typography.display_size ?? "m", theme.id)}</div>

      <div style="font-size:11px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${TM_COLOR.sectionEyebrow};margin-bottom:6px">Buttons &amp; inputs — the shared size language</div>
      <div style="font-size:11.5px;color:${TM_COLOR.subtitle};line-height:1.45;margin-bottom:13px">Every question inherits these. A section can override a single field on its canvas — that field then shows as <b style="color:${TM_COLOR.footerStrong}">Custom</b>.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px">
        <div><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:6px">Field height</div>${segmentedControl("controls", "field_height", FIELD_HEIGHT_OPTS, theme.controls.field_height, theme.id)}</div>
        <div><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:6px">Button size</div>${segmentedControl("controls", "button_size", BUTTON_SIZE_OPTS, theme.controls.button_size, theme.id)}</div>
      </div>
      <div style="max-width:50%;margin-bottom:24px"><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:6px">Corners</div>${segmentedControl("controls", "corners", CORNERS_OPTS, theme.controls.corners, theme.id)}</div>

      <!-- P6b round 2 (deliverable 3) — the button-style triple
           (theme.ts ThemeRecord.button_style.{fill,layout,selected}),
           mirroring the inline editor's SAME 3 controls exactly (same
           enums/labels). All 3 independently optional; absent ⇒ today's
           look (fill/grid/wash). -->
      <div style="font-size:11px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${TM_COLOR.sectionEyebrow};margin-bottom:6px">Button style</div>
      <div style="font-size:11.5px;color:${TM_COLOR.subtitle};line-height:1.45;margin-bottom:13px">Three independent looks — mix and match; each defaults to today's look.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px">
        <div><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:6px">Fill</div>${segmentedControl("button_style", "fill", BUTTON_FILL_OPTS, buttonStyle.fill ?? "fill", theme.id)}</div>
        <div><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:6px">Answer layout</div>${segmentedControl("button_style", "layout", BUTTON_LAYOUT_OPTS, buttonStyle.layout ?? "grid", theme.id)}</div>
      </div>
      <div style="max-width:50%;margin-bottom:24px"><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:6px">Selected style</div>${segmentedControl("button_style", "selected", BUTTON_SELECTED_OPTS, buttonStyle.selected ?? "wash", theme.id)}</div>

      <div style="height:1px;background:${TM_COLOR.topbarBorder};margin-bottom:16px"></div>
      <button type="button" id="tm-adv-toggle" class="tm-adv-toggle" style="display:flex;align-items:center;gap:9px;padding:12px 14px;border:1px solid ${TM_COLOR.advBorder};border-radius:10px;cursor:pointer;width:100%;background:transparent;text-align:left">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z" stroke="${TM_COLOR.advIcon}" stroke-width="1.7"/></svg>
        <div style="flex:1"><div style="font-size:12.5px;font-weight:700;color:${TM_COLOR.advTitle}">Advanced — exact hex &amp; tokens</div><div style="font-size:11px;color:${TM_COLOR.advSub}">for developers</div></div>
        <span style="font-family:'Roboto Mono',monospace;font-size:11px;color:${TM_COLOR.monoText};background:${TM_COLOR.monoBg};padding:2px 8px;border-radius:5px">brand ${escapeHtml(theme.roles.brand_primary)}</span>
        <svg id="tm-adv-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="${TM_COLOR.advChevron}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="rotate(0)" transform-origin="12 12"/></svg>
      </button>
      <div id="tm-adv-body" hidden style="padding:6px 2px 0">
        <div style="font-size:11.5px;color:${TM_COLOR.roleSub};line-height:1.5;margin:6px 0 11px">For developers. Renaming these can unlink Offer mappings.</div>
          ${advRows}
          ${extraAdvRows}
      </div>
      <div style="height:1px;background:${TM_COLOR.topbarBorder};margin:20px 0 16px"></div>
      <!-- P6b (deliverable 1 — the operator's explicit demand, no golden line
           ref: DELETE was out of scope for the original v3.1 §10.1 CRUD).
           IN-USE guard lives server-side (themes-handlers.ts deleteTheme-
           Handler); this button just surfaces it + relays a 409's plain-
           language funnel listing through the SAME #tm-error banner every
           other failure here already uses (showError). Reuses TM_COLOR.
           errText + the EXISTING literal #FBEEEC (the #tm-error banner's own
           background, THEME_MGR_STYLES below) -- zero new hex introduced. -->
      <button type="button" id="tm-delete-theme" class="tm-delete-theme" data-tm-delete-theme="${escapeHtml(theme.id)}" data-tm-delete-theme-name="${escapeHtml(theme.name)}" style="display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border:1px solid ${TM_COLOR.cardBorder};border-radius:8px;cursor:pointer;background:transparent;color:${TM_COLOR.errText};font-weight:600;font-size:12.5px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v13a1 1 0 01-1 1H8a1 1 0 01-1-1V7h10z" stroke="${TM_COLOR.errText}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Delete theme
      </button>
    </div>
    <div style="flex:0 1 340px;min-width:0" data-pin="8.4-live-canvas">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:${TM_COLOR.sectionEyebrow}">Live preview — this theme</span>
        <span style="font-size:10.5px;color:${TM_COLOR.roleSub};font-weight:600">server-rendered</span>
      </div>
      ${canvasHtml}
    </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// RIGHT — A/B assignment panel (golden :704-717, contract §10.5, READ-ONLY)
// ---------------------------------------------------------------------------

function abBarSegment(pctBp: number, hex: string): string {
  const pct = pctBp / 100;
  return `<div style="width:${pct}%;background:${safeHex(hex)}"></div>`;
}

function renderAbTestBox(primaryFunnelVariants: VariantThemeUsage[], themesById: Map<string, ThemeRecord>): string {
  if (primaryFunnelVariants.length === 0) return "";
  const rows = primaryFunnelVariants
    .map((v) => {
      const theme = v.themeId !== null ? themesById.get(v.themeId) : undefined;
      const themeName = theme?.name ?? "—";
      const brandHex = theme?.roles.brand_primary ?? TM_COLOR.neutralGray;
      const pct = v.trafficAllocationBp / 100;
      return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px"><div style="display:flex;align-items:center;gap:9px">${bigSwatchSmall(brandHex)}<div><div style="font-size:12.5px;font-weight:700;color:${TM_COLOR.variantLabel}">Variant ${escapeHtml(v.variantLabel)}</div><div style="font-size:10.5px;color:${TM_COLOR.variantSub}">${escapeHtml(themeName)}</div></div></div><span style="font-size:13px;font-weight:800;color:${TM_COLOR.pct}">${pct}%</span></div>`;
    })
    .join("\n        ");
  const bar = primaryFunnelVariants
    .map((v) => abBarSegment(v.trafficAllocationBp, (v.themeId !== null ? themesById.get(v.themeId)?.roles.brand_primary : undefined) ?? TM_COLOR.neutralGray))
    .join("");
  const note =
    primaryFunnelVariants.length > 1
      ? `<div style="font-size:11.5px;color:${TM_COLOR.rightNote};line-height:1.5;margin-bottom:18px">Both variants share the same questions — only the theme differs. Promote the winner to 100% from the quote's <b style="color:${TM_COLOR.rightNoteStrong}">A/B</b> tab.</div>`
      : "";
  return `<div style="border:1px solid ${TM_COLOR.rightBorder};border-radius:12px;padding:15px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:${TM_COLOR.abHeading};margin-bottom:14px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 7h7v13H4zM13 4h7v16h-7z" stroke="${TM_COLOR.abIcon}" stroke-width="1.8" stroke-linejoin="round"/></svg>A/B test · Theme</div>
        ${rows}
        <div style="height:8px;border-radius:5px;overflow:hidden;display:flex">${bar}</div>
      </div>
      ${note}`;
}

function bigSwatchSmall(hex: string): string {
  return `<span style="width:26px;height:26px;border-radius:7px;background:${safeHex(hex)}"></span>`;
}

function renderRightPanel(
  selectedThemeId: string,
  usage: VariantThemeUsage[],
  themesById: Map<string, ThemeRecord>,
): string {
  const matches = usageForTheme(usage, selectedThemeId);
  const primary = primaryUsage(matches);
  const primaryFunnelVariants = primary !== null ? variantsForFunnel(usage, primary.funnelId) : [];
  const others = otherFunnelsUsing(usage, selectedThemeId, primary?.funnelId ?? null);

  const inThisQuote =
    primary !== null
      ? `<div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${TM_COLOR.rightEyebrow};margin-bottom:4px">In this quote</div>
      <div style="font-size:15px;font-weight:800;color:${TM_COLOR.rightFunnel};margin-bottom:16px">${escapeHtml(primary.funnelName)}</div>
      ${renderAbTestBox(primaryFunnelVariants, themesById)}`
      : "";

  const otherRows =
    others.length > 0
      ? others
          .map(
            (o) =>
              `<div style="font-size:12.5px;color:${TM_COLOR.otherText};display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #F1F3F7"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16v13H4z" stroke="${TM_COLOR.otherIcon}" stroke-width="1.7"/><path d="M4 11h16" stroke="${TM_COLOR.otherIcon}" stroke-width="1.7"/></svg>${escapeHtml(o.funnelName)} · Variant ${escapeHtml(o.variantLabel)}</div>`,
          )
          .join("\n      ")
      : `<div style="font-size:12.5px;color:${TM_COLOR.otherEmpty};padding:9px 0">No others yet.</div>`;

  return `<div style="flex:0 0 320px;background:#fff;border-left:1px solid ${TM_COLOR.topbarBorder};overflow-y:auto;padding:20px 18px">
      ${inThisQuote}
      <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${TM_COLOR.rightEyebrow};margin-bottom:9px">Other funnels using this theme</div>
      ${otherRows}
    </div>`;
}

// ---------------------------------------------------------------------------
// Styles (hover/focus states — DC `style-hover` translated to real :hover,
// mirroring ui-section-studio.ts's SECTION_STUDIO_STYLES convention)
// ---------------------------------------------------------------------------

export const THEME_MGR_STYLES = `
.tm-back:hover{background:${TM_COLOR.backHover};border-color:${TM_COLOR.backHoverBorder}}
.tm-new-theme:hover{background:${TM_COLOR.navyHover}}
.tm-font-select-wrap:hover{border-color:${TM_COLOR.backHoverBorder}}
.tm-adv-toggle:hover{background:${TM_COLOR.advHoverBg}}
.tm-adv-toggle:focus-visible{outline:2px solid ${TM_COLOR.navy};outline-offset:2px}
[data-tm-seg]:hover{opacity:.85}
/* R4a E3-NEW-6: the theme-name input reads as plain text until touched. */
.tm-name-input:hover,.tm-name-input:focus{border-color:${TM_COLOR.backHoverBorder};background:#fff}
.tm-name-input:focus-visible{outline:2px solid ${TM_COLOR.navy};outline-offset:1px}
/* P6b: the SAME literal #FBEEEC the #tm-error banner already uses (renderTopBar) -- no new hex. */
.tm-delete-theme:hover{border-color:${TM_COLOR.errText};background:#FBEEEC}
/* Conductor ruling (gate1c-unmasked defect): this shell had NO height bound
   at all (only min-height:0, a flex-shrink enabler, not a ceiling) while its
   3 columns (LEFT list / CENTER editor / RIGHT panel, below) each already
   carry their OWN overflow-y:auto -- inert without a bounded ancestor to
   scroll WITHIN, so the "YOUR THEMES" list (and, structurally, every other
   column) just grew the whole page taller with every accumulated theme
   record instead of scrolling internally. Grounded in the page's own layout
   system (templates/layout.ts): --header-h is 60px (.admin-header, sticky)
   and .admin-content carries a 24px top padding before this shell starts --
   104px consumed above it, plus a matching 24px breathing gap below (the
   same value as the top padding, for visual symmetry) = 108px. overflow:
   hidden (already set below) clips anything that still doesn't fit within
   that bound; the per-column overflow-y:auto is what actually makes the
   list (and the other 2 columns) scroll internally instead.  */
.tm-shell{position:relative;display:flex;flex-direction:column;min-height:0;height:calc(100vh - 108px);border-radius:14px;overflow:hidden;border:1px solid #C4CCD9;background:${TM_COLOR.appBg}}
/* R2 P8-3 FIX ROUND F10 (review-p8-3b MAJOR-1) -- THE THREE COLUMNS MUST BE
   ABLE TO STACK. This row was nowrap with two unshrinkable rails
   (flex:0 0 300px / flex:0 0 320px), so the whole deficit landed on the
   centre column. MEASURED on the real page (chromium, 127.0.0.1:8901) BEFORE
   this change: at 375 .tm-body is 341px wide with scrollWidth 676, the centre
   editor pane computes to 56px, [data-pin="8.4-editor-controls"] sits at
   x=345 w=300 (right edge 645, 270px past the viewport), #tm-headline-font
   and #tm-body-font are 282px with 6% of their width inside the viewport,
   and the right rail (x=373) is entirely off-screen -- while
   document.scrollWidth == innerWidth, so nothing on screen says so.
   flex-wrap lets the line break instead, keyed on the row's OWN width (the
   real constraint: the admin sidebar is present at 1280 and gone at 375, so
   no viewport media query describes it correctly). overflow-y:auto is what
   makes the stacked columns reachable: .tm-shell is overflow:hidden with a
   fixed height, and each column's own overflow-y:auto is inert once the
   columns are lines rather than side-by-side items.
   1280 IS UNCHANGED and that is arithmetic from the measured numbers, not
   prose: .tm-body is 980px there, the hypothetical row is 300 + 348 + 320 =
   968 <= 980 so it stays ONE line, and the centre still grows into all the
   free space -> 360px, the same 360px measured before this change. */
.tm-body{flex:1 1 auto;display:flex;flex-wrap:wrap;overflow-y:auto;min-height:640px}
`;

// ---------------------------------------------------------------------------
// ES5 inline island — strict ES5 (var/function only; no arrow/const/let/
// backtick/async/spread/destructure/optional-chaining). Card selection and
// nav are plain <a href> per the ES5 guardrail's "prefer plain fetch without
// a complex island" steer; this script only wires the controls that must
// PATCH/POST (§10.4) plus the client-only Advanced disclosure toggle.
// ---------------------------------------------------------------------------

export const THEME_MGR_SCRIPT = `
(function () {
  'use strict';

  function showError(msg) {
    var el = document.getElementById('tm-error');
    if (!el) { return; }
    if (msg) { el.textContent = msg; el.hidden = false; el.style.display = 'block'; }
    else { el.textContent = ''; el.hidden = true; el.style.display = 'none'; }
  }

  function patchTheme(themeId, body) {
    showError('');
    fetch('/api/admin/leadgen/themes/' + encodeURIComponent(themeId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.ok) { window.location.reload(); return null; }
      return res.json().catch(function () { return null; }).then(function (data) {
        var msg = (data && data.error) ? data.error : ('Save failed (HTTP ' + res.status + ')');
        throw new Error(msg);
      });
    }).catch(function (err) {
      showError(err && err.message ? err.message : 'Network error');
    });
  }

  // P6b round 2: generalized over data-top (defaulting to 'controls' --
  // byte-identical behavior for the 3 pre-existing segmented controls, which
  // now stamp data-top="controls" explicitly) so the SAME wiring drives the
  // NEW typography.display_size / button_style.fill/layout/selected
  // segments too, each nesting its patch under its OWN top-level key instead
  // of always assuming controls.
  function wireSegments() {
    var segs = document.querySelectorAll('[data-tm-seg]');
    var i;
    for (i = 0; i < segs.length; i++) {
      (function (el) {
        el.addEventListener('click', function () {
          var top = el.getAttribute('data-top') || 'controls';
          var group = el.getAttribute('data-group');
          var value = el.getAttribute('data-value');
          var themeId = el.getAttribute('data-theme-id');
          var patch = {};
          patch[top] = {};
          patch[top][group] = value;
          patchTheme(themeId, patch);
        });
      })(segs[i]);
    }
  }

  function wireFontSelect(id, field) {
    var el = document.getElementById(id);
    if (!el) { return; }
    el.addEventListener('change', function () {
      var themeId = el.getAttribute('data-theme-id');
      var patch = { typography: {} };
      patch.typography[field] = el.value;
      patchTheme(themeId, patch);
    });
  }

  // P6b round 2: generalized over data-top (defaulting to 'roles' --
  // byte-identical for the 7 original Advanced hex rows, which now stamp
  // data-top="roles" explicitly) so the SAME wiring also drives the 7 new
  // extra_roles hex rows, nesting under extra_roles instead.
  function wireHexInputs() {
    var inputs = document.querySelectorAll('[data-tm-hex]');
    var i;
    for (i = 0; i < inputs.length; i++) {
      (function (el) {
        el.addEventListener('change', function () {
          var top = el.getAttribute('data-top') || 'roles';
          var role = el.getAttribute('data-role');
          var themeId = el.getAttribute('data-theme-id');
          var patch = {};
          patch[top] = {};
          patch[top][role] = el.value;
          patchTheme(themeId, patch);
        });
      })(inputs[i]);
    }
  }

  // R4a E3-NEW-6: theme rename — the SAME patchTheme() every other control
  // here already calls; the server's mergeThemeBody/validateThemeBody
  // (themes-handlers.ts) already accept + validate {name} on its own.
  function wireNameInput() {
    var input = document.getElementById('tm-theme-name');
    if (!input) { return; }
    input.addEventListener('change', function () {
      var themeId = input.getAttribute('data-theme-id');
      patchTheme(themeId, { name: input.value });
    });
  }

  function wireAdvancedToggle() {
    var toggle = document.getElementById('tm-adv-toggle');
    var body = document.getElementById('tm-adv-body');
    var chevron = document.getElementById('tm-adv-chevron');
    if (!toggle || !body) { return; }
    toggle.addEventListener('click', function () {
      var wasOpen = !body.hidden;
      body.hidden = wasOpen;
      if (chevron) { chevron.setAttribute('transform', wasOpen ? 'rotate(0)' : 'rotate(90)'); }
    });
  }

  // P6b (deliverable 1): read a query param the plain-string way (no
  // URLSearchParams dependency needed for a single-value read) so a delete
  // redirect can preserve embed and from query params, exactly like
  // wireNewTheme's own redirect already threads from through -- same "plain
  // fetch, no complex island" steer this whole script follows.
  function currentQueryParam(name) {
    var re = new RegExp('[?&]' + name + '=([^&]*)');
    var m = window.location.search.match(re);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function wireDeleteTheme() {
    var btn = document.getElementById('tm-delete-theme');
    if (!btn) { return; }
    btn.addEventListener('click', function () {
      var themeId = btn.getAttribute('data-tm-delete-theme');
      var themeName = btn.getAttribute('data-tm-delete-theme-name') || 'this theme';
      if (!window.confirm('Delete "' + themeName + '"? This cannot be undone.')) { return; }
      btn.disabled = true;
      showError('');
      fetch('/api/admin/leadgen/themes/' + encodeURIComponent(themeId), {
        method: 'DELETE',
        headers: { 'Accept': 'application/json' }
      }).then(function (res) {
        if (res.ok) {
          var qs = [];
          var embedVal = currentQueryParam('embed');
          var fromVal = currentQueryParam('from');
          if (embedVal) { qs.push('embed=' + encodeURIComponent(embedVal)); }
          if (fromVal) { qs.push('from=' + encodeURIComponent(fromVal)); }
          window.location.href = '/admin/leadgen/themes' + (qs.length ? '?' + qs.join('&') : '');
          return null;
        }
        return res.json().catch(function () { return null; }).then(function (data) {
          var msg = (data && data.error) ? data.error : ('Delete failed (HTTP ' + res.status + ')');
          throw new Error(msg);
        });
      }).catch(function (err) {
        btn.disabled = false;
        showError(err && err.message ? err.message : 'Network error');
      });
    });
  }

  function wireNewTheme() {
    var btn = document.getElementById('tm-new-theme');
    if (!btn) { return; }
    btn.addEventListener('click', function () {
      var fromVal = btn.getAttribute('data-from') || '';
      var payload = {
        name: 'New theme',
        roles: {
          brand_primary: '#1B3A5C', accent: '#2E6BB0', page_bg: '#FFFFFF',
          card: '#FFFFFF', text: '#1A1F36', success: '#0E7C3A', error: '#B23A2C'
        },
        typography: { headline_font: 'Newsreader', body_font: 'Inter', base_px: 16 },
        controls: { field_height: 'medium', button_size: 'm', corners: 'rounded' }
      };
      btn.disabled = true;
      showError('');
      fetch('/api/admin/leadgen/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            var msg = (data && data.error) ? data.error : 'Create failed';
            throw new Error(msg);
          }
          var qs = 'theme=' + encodeURIComponent(data.item.id);
          if (fromVal) { qs += '&from=' + encodeURIComponent(fromVal); }
          window.location.href = '/admin/leadgen/themes?' + qs;
        });
      }).catch(function (err) {
        btn.disabled = false;
        showError(err && err.message ? err.message : 'Network error');
      });
    });
  }

  wireSegments();
  wireFontSelect('tm-headline-font', 'headline_font');
  wireFontSelect('tm-body-font', 'body_font');
  wireHexInputs();
  wireNameInput();
  wireAdvancedToggle();
  wireNewTheme();
  wireDeleteTheme();
}());
`;

// ---------------------------------------------------------------------------
// Page handler — GET /admin/leadgen/themes
// ---------------------------------------------------------------------------

interface ThemesListBody {
  items: ThemeRecord[];
}

function pickSelectedTheme(themes: ThemeRecord[], requestedId: string): ThemeRecord | null {
  if (themes.length === 0) return null;
  const requested = themes.find((t) => t.id === requestedId);
  return requested ?? themes[0] ?? null;
}

export async function leadgenThemeManagerPage(c: UiContext): Promise<Response> {
  const env: Env = c.env;
  const from = (c.req.query("from") ?? "").trim();
  const requestedTheme = (c.req.query("theme") ?? "").trim();
  // R5 D6 (register S4-A11): ?embed=1 marks the request as the Section
  // Studio's in-page overlay (an <iframe> the studio opens instead of
  // navigating away). The standalone route above still works UNCHANGED for
  // deep links (bare /admin/leadgen/themes, no embed param) — this is
  // strictly additive gating, not a replacement of the existing route.
  const embed = c.req.query("embed") === "1";

  const [listRes, usage] = await Promise.all([
    apiJson<ThemesListBody>(env, "/api/admin/leadgen/themes"),
    scanVariantThemeUsage(env.DB),
  ]);
  const themes = listRes.ok ? listRes.body.items : [];
  const selected = pickSelectedTheme(themes, requestedTheme);
  const themesById = new Map(themes.map((t) => [t.id, t]));

  // §8.4 live canvas: resolved ONLY for a selected theme (no theme selected
  // ⇒ nothing to preview, same as the pre-existing empty-state leg below).
  let canvasHtml = "";
  if (selected !== null) {
    const matches = usageForTheme(usage, selected.id);
    const primary = primaryUsage(matches);
    const seed = await pickCanvasSeed(env.DB, primary?.funnelId ?? null);
    const preview = await fetchCanvasPreview(env, seed, selected.id);
    canvasHtml = renderCanvasFrame(preview, seed.isFixture);
  }

  const centerHtml =
    selected !== null
      ? renderCenterEditor(selected, usageForTheme(usage, selected.id), canvasHtml)
      : `<div data-pin="8.4-center-pane" style="flex:1 1 348px;padding:28px;color:${TM_COLOR.footerText};font-size:13px">Create a theme to get started.</div>`;
  const rightHtml =
    selected !== null
      ? renderRightPanel(selected.id, usage, themesById)
      : `<div style="flex:0 0 320px;background:#fff;border-left:1px solid ${TM_COLOR.topbarBorder}"></div>`;

  const content = `<div class="tm-shell">
  ${renderTopBar(from, embed)}
  <div class="tm-body">
    ${renderLeftList(themes, usage, selected?.id ?? null, from)}
    ${centerHtml}
    ${rightHtml}
  </div>
</div>`;

  // F13 (MAJOR-2): the clip reveal's include moved UP, out of this page and
  // out of quotes-tabs/themes.ts, into the two leadgen shells below — one
  // include site for every leadgen admin page instead of two hand-picked
  // surfaces (ui.ts's leadgenPageShell / leadgenStandalonePageShell; the why
  // and the driven numbers are in clip-reveal.ts's header). Both shells still
  // interpolate `scripts` at the end of <body>, so this page's own island runs
  // after it exactly as before, and neither shell touches templates/layout.ts.
  const scripts = THEME_MGR_SCRIPT + (embed ? TM_EMBED_SCRIPT : "");

  return c.html(
    embed
      ? leadgenStandalonePageShell({ content, styles: THEME_MGR_STYLES, scripts })
      : leadgenPageShell({
          activePath: "/admin/leadgen/sections",
          userEmail: branding(c).userEmail,
          conversionsUiEnabled: branding(c).conversionsUiEnabled,
          content,
          styles: THEME_MGR_STYLES,
          scripts,
        }),
  );
}
