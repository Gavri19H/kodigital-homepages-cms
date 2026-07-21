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
//   funnel (the first usage match, preferring an is_control/"LIVE" match),
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
  is_control: number;
  traffic_allocation_bp: number;
  frame_overrides_json: string | null;
}

export async function scanVariantThemeUsage(db: D1Database): Promise<VariantThemeUsage[]> {
  const result = await db
    .prepare(
      `SELECT f.id AS funnel_id, f.public_id AS funnel_public_id, f.funnel_name AS funnel_name,
              f.theme_json AS funnel_theme_json, v.variant_label AS variant_label,
              v.is_control AS is_control, v.traffic_allocation_bp AS traffic_allocation_bp,
              v.frame_overrides_json AS frame_overrides_json
         FROM leadgen_funnel_variants v
         JOIN leadgen_funnels f ON f.id = v.funnel_id
        WHERE f.status = 'active' AND v.status = 'active'
        ORDER BY f.id ASC, v.is_control DESC, v.id ASC`,
    )
    .all<UsageScanRow>();
  return (result.results ?? []).map((row) => {
    const funnelTheme = parseJsonColumn(row.funnel_theme_json);
    const variantOverrides = parseJsonColumn(row.frame_overrides_json);
    return {
      funnelId: row.funnel_id,
      funnelPublicId: row.funnel_public_id,
      funnelName: row.funnel_name,
      variantLabel: row.variant_label,
      isControl: row.is_control !== 0,
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

// The "best" match for a badge/use-line: an is_control (LIVE) match wins over
// any A/B match; ties break on scan order (funnel id asc, is_control desc).
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

const ROLE_META: ReadonlyArray<{ key: ThemeRecordRoleKey; label: string; sub: string; border: boolean }> = [
  { key: "brand_primary", label: "Brand primary", sub: "buttons · progress · selected", border: false },
  { key: "accent", label: "Accent", sub: "highlights · recommended", border: false },
  { key: "page_bg", label: "Page background", sub: "behind the card", border: true },
  { key: "card", label: "Card", sub: "question surface", border: true },
  { key: "text", label: "Text", sub: "headings & body", border: false },
  { key: "success", label: "Success", sub: "reassurance · valid", border: false },
];

// P6b round 2 (deliverable 3 — "presets carry+expose the v2 axes"): the 7
// ADDITIONAL roles theme.ts's ThemeRecord.extra_roles carries, completing the
// 14-role palette a rich preset can now author. Labels/sub-text copied
// VERBATIM from ui-quotes.ts's own 14-role ROLE_META for these same 7 keys
// (the inline funnel-theme editor) so the SAME role reads with the SAME
// human name in both editors. All 7 are OPTIONAL (a preset may set some/all/
// none) — renderCenterEditor below falls back to a neutral placeholder swatch
// for any unset key (safeHex's existing undefined-input handling).
const EXTRA_ROLE_META: ReadonlyArray<{ key: ThemeRecordExtraRoleKey; label: string; sub: string; border: boolean }> = [
  { key: "brand_secondary", label: "Brand secondary", sub: "gradients · secondary emphasis", border: false },
  { key: "surface_wash", label: "Soft fill", sub: "selected fills · quiet panels", border: false },
  { key: "border", label: "Border", sub: "card/input borders", border: true },
  { key: "text_muted", label: "Muted text", sub: "subheadlines · helper · meta", border: false },
  { key: "button_primary_bg", label: "Button", sub: "Continue/CTA background", border: false },
  { key: "button_primary_text", label: "Button text", sub: "Continue/CTA text", border: false },
  { key: "button_secondary_bg", label: "Secondary button", sub: "back button-style · quiet buttons", border: false },
];

function fontOptionsHtml(selected: ThemeRecordFontName): string {
  return THEME_RECORD_FONT_NAMES.map(
    (name) => `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`,
  ).join("");
}

function fontSelectRow(id: string, label: string, current: ThemeRecordFontName, themeId: string): string {
  return `<div><div style="font-size:12px;font-weight:600;color:${TM_COLOR.fieldLabel};margin-bottom:5px">${escapeHtml(label)}</div>
          <div class="tm-font-select-wrap" style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid ${TM_COLOR.lineControl};border-radius:8px">
            <select id="${id}" data-theme-id="${escapeHtml(themeId)}" style="appearance:none;-webkit-appearance:none;border:0;background:transparent;outline:none;font-family:${TM_FONT_PREVIEW_STACK[current]};font-size:14px;color:${TM_COLOR.fontPreview};width:100%;cursor:pointer">${fontOptionsHtml(current)}</select>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="pointer-events:none;flex:0 0 auto"><path d="M6 9l6 6 6-6" stroke="${TM_COLOR.chevron}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
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
const BUTTON_LAYOUT_OPTS: ReadonlyArray<{ value: ThemeButtonLayout; label: string }> = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
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

function renderCenterEditor(theme: ThemeRecord, matches: VariantThemeUsage[]): string {
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

  return `<div style="flex:1 1 auto;overflow-y:auto;padding:24px 28px;min-width:0">
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
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
.tm-body{flex:1 1 auto;display:flex;min-height:640px}
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

  const centerHtml =
    selected !== null
      ? renderCenterEditor(selected, usageForTheme(usage, selected.id))
      : `<div style="flex:1 1 auto;padding:28px;color:${TM_COLOR.footerText};font-size:13px">Create a theme to get started.</div>`;
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

  const scripts = THEME_MGR_SCRIPT + (embed ? TM_EMBED_SCRIPT : "");

  return c.html(
    embed
      ? leadgenStandalonePageShell({ content, styles: THEME_MGR_STYLES, scripts })
      : leadgenPageShell({
          activePath: "/admin/leadgen/sections",
          userEmail: branding(c).userEmail,
          content,
          styles: THEME_MGR_STYLES,
          scripts,
        }),
  );
}
