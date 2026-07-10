// LeadGen v2.5 FRAME module (redesign-contract-v2.5 03 §3.3/§3.6, 04 §4.3,
// 13 §13.2). PURE: no DB, no Hono, no admin imports — shared verbatim by
// runtime serve, both preview endpoints, and the Quote Builder's
// `effective_frame` echo (one merge implementation, §13.2).
//
// Owns:
//   - the `frame_config_json` TypeScript contract (§3.3): every group
//     (header / progress / back / disclosure / footer / trust_strip /
//     benefit_bar / background / section_slot / mobile / compat), closed-set
//     enums, role-name colours, media_id media refs, plain-text copy;
//   - FRAME_TEMPLATES — the 6 frame templates (§4.3), each = complete named
//     per-group defaults matching the arrangement table ("registry: code,
//     not DB");
//   - effectiveFrame — template defaults ⊕ funnel frame_config_json ⊕ variant
//     frame_overrides_json (sparse deep-merge, arrays replaced whole, §13.2);
//     unknown template id in STORED json → `centered` + a problems[] warning
//     (mirror of the design-registry unknown-id fallback rule);
//   - validateFrameConfig — server gate for PUT /funnels/:id/frame (§4.8):
//     unknown keys REJECTED, path-precise §3.6 problems in operator language.

import { FUNNEL_TOKEN_ROLES, isFunnelTokenRole } from "./theme";
import type { FunnelTokenRole, Problem, ProblemSeverity, VariantThemeOverrides } from "./theme";

// ---------------------------------------------------------------------------
// §3.3 enums (closed sets).
// ---------------------------------------------------------------------------

export const FRAME_TEMPLATE_IDS = [
  "centered",
  "header-footer",
  "header-cta",
  "full-background",
  "white-trust",
  "minimal",
] as const;

export type FrameTemplateId = (typeof FRAME_TEMPLATE_IDS)[number];

const FRAME_TEMPLATE_ID_SET: ReadonlySet<string> = new Set(FRAME_TEMPLATE_IDS);

export function isFrameTemplateId(value: unknown): value is FrameTemplateId {
  return typeof value === "string" && FRAME_TEMPLATE_ID_SET.has(value);
}

// The registry/default fallback template (mirrors getFunnelDesign's rule).
export const DEFAULT_FRAME_TEMPLATE_ID: FrameTemplateId = "centered";

export const FRAME_LOGO_SOURCES = ["site", "cms_fallback", "manual"] as const;
export const FRAME_SIZES = ["s", "m", "l"] as const;
export const FRAME_LOGO_ALIGNS = ["left", "center"] as const;
export const FRAME_PROGRESS_STYLES = ["hidden", "bar", "dots", "numbered", "percent"] as const;
export const FRAME_PROGRESS_POSITIONS = ["top", "under_header", "above_unit", "in_card"] as const;
export const FRAME_PROGRESS_WIDTHS = ["content", "full"] as const;
export const FRAME_BACK_STYLES = ["hidden", "text", "icon_text", "button"] as const;
export const FRAME_BACK_POSITIONS = ["under_header_left", "in_card", "below_card", "footer"] as const;
export const FRAME_DISCLOSURE_LOCATIONS = ["top_bar", "header", "footer", "modal"] as const;
export const FRAME_FOOTER_SHOW_ON = ["all", "first", "final", "never"] as const;
export const FRAME_FOOTER_LINKS_SOURCES = ["site", "manual"] as const;
export const FRAME_TRUST_SOURCES = ["manual", "site_logo_set"] as const;
export const FRAME_TRUST_PLACEMENTS = ["below_unit", "footer", "between_progress_and_unit"] as const;
export const FRAME_TRUST_MOBILE_MODES = ["wrap", "scroll", "hide"] as const;
export const FRAME_BENEFIT_PLACEMENTS = ["bottom", "below_unit"] as const;
export const FRAME_BACKGROUND_STYLES = ["flat", "brand", "brand_gradient"] as const;
export const FRAME_SLOT_CARDS = ["card", "bare"] as const;
export const FRAME_SLOT_OFFSETS = ["none", "s", "m"] as const;
export const FRAME_SLOT_TRANSITIONS = ["fade", "none"] as const;
export const FRAME_CONTINUE_PLACEMENTS = ["inside_unit", "below_unit"] as const;
// Fixed single-value sets in v2.5 (§3.3 `align:"center"` "(fixed v2.5)" and
// `continue_style_role:"button_primary"`) — widened by a later contract, not
// by this module.
export const FRAME_SLOT_ALIGNS = ["center"] as const;
export const FRAME_CONTINUE_STYLE_ROLES = ["button_primary"] as const;

// ---------------------------------------------------------------------------
// §3.3 group shapes — the COMPLETE (effective) config. The STORED column is
// the sparse `FrameConfig` below; effectiveFrame always yields this full
// shape. All colours are ROLE NAMES (09); media refs are media_id strings;
// copy fields are plain text (escaped at render).
// ---------------------------------------------------------------------------

export interface FrameSecureBadgeConfig {
  enabled: boolean;
  text: string | null;
}

export interface FrameHeaderCtaConfig {
  enabled: boolean;
  label: string;
  href: string | null;
  tel: string | null;
}

export interface FrameHeaderConfig {
  enabled: boolean;
  logo_source: (typeof FRAME_LOGO_SOURCES)[number];
  logo_media_id: string | null; // manual only
  logo_size: (typeof FRAME_SIZES)[number];
  logo_align: (typeof FRAME_LOGO_ALIGNS)[number];
  tagline: string | null;
  secure_badge: FrameSecureBadgeConfig;
  cta: FrameHeaderCtaConfig;
  disclosure_link: boolean;
  sticky: boolean;
}

export interface FrameProgressConfig {
  style: (typeof FRAME_PROGRESS_STYLES)[number];
  position: (typeof FRAME_PROGRESS_POSITIONS)[number];
  thickness: (typeof FRAME_SIZES)[number];
  width: (typeof FRAME_PROGRESS_WIDTHS)[number];
  color_role: FunnelTokenRole;
  show_label: boolean;
}

// Behaviour is fixed (§3.3): previous Section per Variant order, hidden on the
// first Section — the engine already does this; only presentation is config.
export interface FrameBackConfig {
  style: (typeof FRAME_BACK_STYLES)[number];
  position: (typeof FRAME_BACK_POSITIONS)[number];
  label: string;
  history_fallback: boolean;
}

export interface FrameDisclosureConfig {
  enabled: boolean;
  location: (typeof FRAME_DISCLOSURE_LOCATIONS)[number];
  link_label: string;
  text: string; // panel copy, plain text
}

export interface FrameFooterLink {
  label: string;
  href: string;
}

export interface FrameFooterConfig {
  enabled: boolean;
  show_on: (typeof FRAME_FOOTER_SHOW_ON)[number];
  links_source: (typeof FRAME_FOOTER_LINKS_SOURCES)[number];
  links: FrameFooterLink[]; // manual mode
  trust_text: string | null;
  description: string | null;
  show_logo: boolean;
  hide_on_mobile: boolean;
}

export interface FrameTrustLogo {
  media_id: string;
  alt: string; // REQUIRED (§3.3)
}

export interface FrameTrustStripConfig {
  enabled: boolean;
  source: (typeof FRAME_TRUST_SOURCES)[number];
  logos: FrameTrustLogo[];
  placement: (typeof FRAME_TRUST_PLACEMENTS)[number];
  mobile: (typeof FRAME_TRUST_MOBILE_MODES)[number];
}

export interface FrameBenefitItem {
  icon: string;
  text: string;
}

export interface FrameBenefitBarConfig {
  enabled: boolean;
  items: FrameBenefitItem[];
  placement: (typeof FRAME_BENEFIT_PLACEMENTS)[number];
}

export interface FrameBackgroundConfig {
  role: FunnelTokenRole;
  image_media_id: string | null;
  style: (typeof FRAME_BACKGROUND_STYLES)[number]; // brand/gradient resolve via roles — no raw CSS
}

export interface FrameSectionSlotConfig {
  max_width: (typeof FRAME_SIZES)[number];
  align: (typeof FRAME_SLOT_ALIGNS)[number];
  card: (typeof FRAME_SLOT_CARDS)[number];
  padding: (typeof FRAME_SIZES)[number];
  offset_y: (typeof FRAME_SLOT_OFFSETS)[number];
  allow_section_card: boolean; // false = WARNING surfaced, never silent deletion
  transition: (typeof FRAME_SLOT_TRANSITIONS)[number];
  continue_placement: (typeof FRAME_CONTINUE_PLACEMENTS)[number];
  continue_style_role: (typeof FRAME_CONTINUE_STYLE_ROLES)[number];
}

// §3.3 mobile: sparse overrides — ONLY these keys; everything else inherits
// (breakpoints come from the base design). Sparse even in the effective shape.
export interface FrameMobileConfig {
  hide_footer?: boolean;
  progress_position?: (typeof FRAME_PROGRESS_POSITIONS)[number];
  logo_size?: (typeof FRAME_SIZES)[number];
  trust_strip_mobile?: (typeof FRAME_TRUST_MOBILE_MODES)[number];
}

// §3.3 compat (Advanced-only, C2): the per-Funnel legacy override.
export interface FrameCompatConfig {
  allow_section_chrome: boolean;
}

// The COMPLETE effective frame configuration (what effectiveFrame returns and
// what renderQuoteFrame consumes).
export interface EffectiveFrameConfig {
  version: 1;
  template: FrameTemplateId;
  compat: FrameCompatConfig;
  header: FrameHeaderConfig;
  progress: FrameProgressConfig;
  back: FrameBackConfig;
  disclosure: FrameDisclosureConfig;
  footer: FrameFooterConfig;
  trust_strip: FrameTrustStripConfig;
  benefit_bar: FrameBenefitBarConfig;
  background: FrameBackgroundConfig;
  section_slot: FrameSectionSlotConfig;
  mobile: FrameMobileConfig;
}

// The STORED shape (`leadgen_funnels.frame_config_json`): every group optional
// → template defaults apply (§3.3); within a group every field optional (a
// sparse patch). Arrays are NEVER partial — a present array replaces the
// default/parent array whole (§13.2).
type SparsePatch<T> = {
  [K in keyof T]?: T[K] extends ReadonlyArray<unknown>
    ? T[K]
    : T[K] extends object
      ? SparsePatch<T[K]>
      : T[K];
};

export type FrameConfig = SparsePatch<EffectiveFrameConfig>;

// RAW stored json as read back from `leadgen_funnels.frame_config_json`: the
// same sparse shape, but `template` is an arbitrary string — a stored id may
// stop existing over time, which is exactly the §4.3 fallback case
// effectiveFrame handles (unknown id → `centered` + warning). A validated
// FrameConfig is assignable to it.
export type StoredFrameConfig = Omit<FrameConfig, "template"> & { template?: string };

// A Variant's `frame_overrides_json` (§3.1): a sparse deep-merge patch of
// frame_config_json PLUS `theme.palette.*` role overrides (§4.5). The `theme`
// key is EXCLUDED from the frame merge — resolveTokens consumes it as its
// layer 3. `template`/`version` are funnel-level and never variant-overridable.
export type FrameOverrides = StoredFrameConfig & { theme?: VariantThemeOverrides };

// ---------------------------------------------------------------------------
// §4.3 FRAME_TEMPLATES — 6 templates, each = named per-group defaults.
// Base defaults are the §3.3 `=` schema defaults; each template patches them
// per its arrangement row. `enabled` flags that require operator CONTENT
// (trust logos, benefit items, call-CTA label/number, manual links) default
// OFF everywhere — a template defines WHERE a region goes when it is on.
// ---------------------------------------------------------------------------

export interface FrameTemplateDef {
  id: FrameTemplateId;
  label: string;
  // §4.3 arrangement row (desktop), verbatim — the picker/thumbnail copy.
  arrangement: string;
  defaults: EffectiveFrameConfig;
}

// The §3.3 field defaults (every `=` in the schema tables), template-agnostic.
function baseFrameDefaults(): EffectiveFrameConfig {
  return {
    version: 1,
    template: DEFAULT_FRAME_TEMPLATE_ID,
    compat: { allow_section_chrome: false },
    header: {
      enabled: true,
      logo_source: "site",
      logo_media_id: null,
      logo_size: "m",
      logo_align: "center",
      tagline: null,
      secure_badge: { enabled: false, text: null },
      cta: { enabled: false, label: "", href: null, tel: null },
      disclosure_link: false,
      sticky: true,
    },
    progress: {
      style: "bar",
      position: "under_header",
      thickness: "m",
      width: "content",
      color_role: "brand_primary",
      show_label: false,
    },
    back: { style: "text", position: "in_card", label: "Back", history_fallback: true },
    disclosure: {
      enabled: false,
      location: "footer",
      link_label: "Advertising Disclosure",
      text: "",
    },
    footer: {
      enabled: true,
      show_on: "all",
      links_source: "site",
      links: [],
      trust_text: null,
      description: null,
      show_logo: false,
      hide_on_mobile: false,
    },
    trust_strip: { enabled: false, source: "manual", logos: [], placement: "below_unit", mobile: "wrap" },
    benefit_bar: { enabled: false, items: [], placement: "below_unit" },
    background: { role: "page_background", image_media_id: null, style: "flat" },
    section_slot: {
      max_width: "m",
      align: "center",
      card: "card",
      padding: "m",
      offset_y: "none",
      allow_section_card: true,
      transition: "fade",
      continue_placement: "inside_unit",
      continue_style_role: "button_primary",
    },
    mobile: {},
  };
}

function makeTemplate(
  id: FrameTemplateId,
  label: string,
  arrangement: string,
  patch: FrameConfig,
): FrameTemplateDef {
  const defaults = baseFrameDefaults();
  mergeInto(defaults as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  defaults.template = id;
  return { id, label, arrangement, defaults };
}

export const FRAME_TEMPLATES: Record<FrameTemplateId, FrameTemplateDef> = {
  // Pattern A (reference-style): the §3.3 schema defaults verbatim.
  centered: makeTemplate(
    "centered",
    "Centered card",
    "logo top-center → progress → centered card slot → trust strip → legal footer",
    {},
  ),
  // Pattern B: classic site chrome — left logo + tagline + secure badge,
  // bare slot, large site footer (site links + logo).
  "header-footer": makeTemplate(
    "header-footer",
    "Site header + footer",
    "site header (logo+tagline+secure) → progress → bare slot → LARGE site footer",
    {
      header: { logo_align: "left", secure_badge: { enabled: true } },
      section_slot: { card: "bare" },
      footer: { show_logo: true },
    },
  ),
  // Pattern C: compliance-forward — disclosure top bar, centered logo with a
  // call-CTA slot (CTA itself stays off until the operator supplies label +
  // number), benefit bar under the unit, back link at the end.
  "header-cta": makeTemplate(
    "header-cta",
    "Header + call CTA",
    "disclosure top bar → logo center + call CTA → progress → slot → benefit bar → back link",
    {
      disclosure: { enabled: true, location: "top_bar" },
      back: { position: "below_card" },
      benefit_bar: { placement: "below_unit" },
    },
  ),
  // Pattern D: brand background, floating logo, step dots above a white card.
  "full-background": makeTemplate(
    "full-background",
    "Full background",
    "brand background → logo → step dots → white card slot → legal footer",
    {
      header: { sticky: false },
      progress: { style: "dots", position: "above_unit" },
      background: { role: "brand_primary", style: "brand" },
      section_slot: { card: "card" },
    },
  ),
  // Pattern A/B hybrid: white page (card_background role), minimal header,
  // bare slot, trust strip pinned to the footer area.
  "white-trust": makeTemplate(
    "white-trust",
    "White + trust bar",
    "white page → minimal header → slot → bottom trust bar",
    {
      header: { logo_size: "s", sticky: false },
      background: { role: "card_background" },
      section_slot: { card: "bare" },
      trust_strip: { placement: "footer" },
    },
  ),
  // Pattern E: clean header, back under the header, bare slot, no footer.
  minimal: makeTemplate(
    "minimal",
    "Minimal",
    "clean header → progress → back → bare slot, no footer",
    {
      back: { position: "under_header_left" },
      section_slot: { card: "bare" },
      footer: { enabled: false },
    },
  ),
};

// ---------------------------------------------------------------------------
// §13.2 effectiveFrame — ONE merge implementation for serve, previews, and
// the Quote Builder echo: template defaults deep-merged with funnel config,
// then variant overrides. Sparse deep-merge; arrays replaced whole; scalars
// and nulls replace; absent keys inherit.
// ---------------------------------------------------------------------------

export interface EffectiveFrameResult {
  frame: EffectiveFrameConfig;
  problems: Problem[];
}

// First argument: a template id (e.g. §13.4 `draft_frame_config` template
// preview-before-apply, where the id wins over the stored one) OR the stored
// funnel config itself (its `.template` selects the template). The funnel
// layer is the explicit second argument when given, else the object passed
// first. Unknown template id in STORED json → `centered` + a problems[]
// warning (mirror of the design-registry unknown-id fallback); ABSENT
// template → `centered` silently (it is simply the default).
export function effectiveFrame(
  template: FrameTemplateId | string | StoredFrameConfig | null | undefined,
  frame_config_json?: StoredFrameConfig | null,
  frame_overrides_json?: FrameOverrides | null,
): EffectiveFrameResult {
  const problems: Problem[] = [];

  const funnel: StoredFrameConfig | null =
    frame_config_json ?? (typeof template === "object" && template !== null ? template : null);

  let requested: string | undefined;
  if (typeof template === "string") {
    requested = template;
  } else if (template !== null && typeof template === "object" && typeof template.template === "string") {
    requested = template.template;
  }
  if (requested === undefined && funnel !== null && typeof funnel.template === "string") {
    requested = funnel.template;
  }

  let templateId: FrameTemplateId;
  if (requested === undefined) {
    templateId = DEFAULT_FRAME_TEMPLATE_ID;
  } else if (isFrameTemplateId(requested)) {
    templateId = requested;
  } else {
    templateId = DEFAULT_FRAME_TEMPLATE_ID;
    problems.push({
      path: "frame.template",
      scope: "frame",
      severity: "warning",
      message: `The '${requested}' frame template isn't available any more — showing the '${DEFAULT_FRAME_TEMPLATE_ID}' layout instead.`,
    });
  }

  const frame = cloneJson(FRAME_TEMPLATES[templateId].defaults);
  if (funnel !== null) {
    const { template: _template, version: _version, ...groups } = funnel;
    mergeInto(frame as unknown as Record<string, unknown>, groups as Record<string, unknown>);
  }
  if (frame_overrides_json !== null && frame_overrides_json !== undefined) {
    // `theme` belongs to resolveTokens layer 3; template/version are
    // funnel-level — none of them merge into the frame (§4.5).
    const { theme: _theme, template: _template, version: _version, ...groups } = frame_overrides_json;
    mergeInto(frame as unknown as Record<string, unknown>, groups as Record<string, unknown>);
  }
  frame.template = templateId;
  frame.version = 1;
  return { frame, problems };
}

// Sparse deep-merge (§13.2): objects merge recursively; arrays replace WHOLE;
// scalars and nulls replace; `undefined` keys inherit. The patch is never
// mutated and never shares references with the result (values are cloned in).
function mergeInto(base: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      base[key] = cloneJson(value); // arrays replaced whole
      continue;
    }
    if (isRecord(value)) {
      const current = base[key];
      if (isRecord(current)) {
        mergeInto(current, value);
      } else {
        base[key] = cloneJson(value);
      }
      continue;
    }
    base[key] = value;
  }
}

// ---------------------------------------------------------------------------
// validateFrameConfig — §3.3 server validation. Closed-set enums; unknown keys
// REJECTED (top level, group level, nested objects, list entries); colours are
// role names; media refs are media_id strings; href/tel follow the SAFE_HREF
// rule. Problems are §3.6-shaped: path-precise (frame.header.cta.href), scope
// `frame`, operator-language messages (never raw JSON, never internal ids).
// `config` is non-null iff no error-severity problem (warnings keep it).
// ---------------------------------------------------------------------------

export interface FrameConfigValidation {
  config: FrameConfig | null;
  problems: Problem[];
}

// A safe, non-executable link target for the header call-CTA and manual
// footer links: absolute http(s), site-relative path (NOT protocol-relative
// //), fragment, tel: or mailto:. Anything else (javascript:, data:, //host)
// is rejected. MUST stay byte-identical to SAFE_HREF_RE in
// components/content-schema.ts — the canonical source (module-private there,
// so re-declared per the reuse rule).
const SAFE_HREF_RE = /^(https?:\/\/|\/(?!\/)|#|tel:|mailto:)/i;

// A phone target: optional tel: prefix, then + and common phone punctuation.
const SAFE_TEL_RE = /^(tel:)?\+?[0-9(). -]{3,}$/i;

type FrameScalarFieldSpec =
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "text" } // plain text; may be empty (escaped at render)
  | { kind: "text_or_null" }
  | { kind: "required_text" } // non-empty plain text (list-entry fields)
  | { kind: "media_id" } // non-empty media_id string
  | { kind: "media_id_or_null" }
  | { kind: "role" }
  | { kind: "href" }
  | { kind: "href_or_null" }
  | { kind: "tel_or_null" };

type FrameFieldSpec =
  | FrameScalarFieldSpec
  | { kind: "object"; label: string; fields: Record<string, FrameScalarFieldSpec> }
  | { kind: "array"; itemLabel: string; fields: Record<string, FrameScalarFieldSpec> };

interface FrameGroupSpec {
  label: string;
  fields: Record<string, FrameFieldSpec>;
}

const bool: FrameScalarFieldSpec = { kind: "boolean" };
const text: FrameScalarFieldSpec = { kind: "text" };
const textOrNull: FrameScalarFieldSpec = { kind: "text_or_null" };
const role: FrameScalarFieldSpec = { kind: "role" };
const oneOf = (values: readonly string[]): FrameScalarFieldSpec => ({ kind: "enum", values });

const FRAME_GROUP_SPECS: Record<string, FrameGroupSpec> = {
  header: {
    label: "header",
    fields: {
      enabled: bool,
      logo_source: oneOf(FRAME_LOGO_SOURCES),
      logo_media_id: { kind: "media_id_or_null" },
      logo_size: oneOf(FRAME_SIZES),
      logo_align: oneOf(FRAME_LOGO_ALIGNS),
      tagline: textOrNull,
      secure_badge: {
        kind: "object",
        label: "header secure badge",
        fields: { enabled: bool, text: textOrNull },
      },
      cta: {
        kind: "object",
        label: "header call-to-action",
        fields: { enabled: bool, label: text, href: { kind: "href_or_null" }, tel: { kind: "tel_or_null" } },
      },
      disclosure_link: bool,
      sticky: bool,
    },
  },
  progress: {
    label: "progress",
    fields: {
      style: oneOf(FRAME_PROGRESS_STYLES),
      position: oneOf(FRAME_PROGRESS_POSITIONS),
      thickness: oneOf(FRAME_SIZES),
      width: oneOf(FRAME_PROGRESS_WIDTHS),
      color_role: role,
      show_label: bool,
    },
  },
  back: {
    label: "back link",
    fields: {
      style: oneOf(FRAME_BACK_STYLES),
      position: oneOf(FRAME_BACK_POSITIONS),
      label: text,
      history_fallback: bool,
    },
  },
  disclosure: {
    label: "disclosure",
    fields: {
      enabled: bool,
      location: oneOf(FRAME_DISCLOSURE_LOCATIONS),
      link_label: text,
      text: text,
    },
  },
  footer: {
    label: "footer",
    fields: {
      enabled: bool,
      show_on: oneOf(FRAME_FOOTER_SHOW_ON),
      links_source: oneOf(FRAME_FOOTER_LINKS_SOURCES),
      links: {
        kind: "array",
        itemLabel: "footer link",
        fields: { label: { kind: "required_text" }, href: { kind: "href" } },
      },
      trust_text: textOrNull,
      description: textOrNull,
      show_logo: bool,
      hide_on_mobile: bool,
    },
  },
  trust_strip: {
    label: "trust strip",
    fields: {
      enabled: bool,
      source: oneOf(FRAME_TRUST_SOURCES),
      logos: {
        kind: "array",
        itemLabel: "trust logo",
        fields: { media_id: { kind: "media_id" }, alt: { kind: "required_text" } },
      },
      placement: oneOf(FRAME_TRUST_PLACEMENTS),
      mobile: oneOf(FRAME_TRUST_MOBILE_MODES),
    },
  },
  benefit_bar: {
    label: "benefit bar",
    fields: {
      enabled: bool,
      items: {
        kind: "array",
        itemLabel: "benefit item",
        fields: { icon: { kind: "required_text" }, text: { kind: "required_text" } },
      },
      placement: oneOf(FRAME_BENEFIT_PLACEMENTS),
    },
  },
  background: {
    label: "background",
    fields: {
      role: role,
      image_media_id: { kind: "media_id_or_null" },
      style: oneOf(FRAME_BACKGROUND_STYLES),
    },
  },
  section_slot: {
    label: "section slot",
    fields: {
      max_width: oneOf(FRAME_SIZES),
      align: oneOf(FRAME_SLOT_ALIGNS),
      card: oneOf(FRAME_SLOT_CARDS),
      padding: oneOf(FRAME_SIZES),
      offset_y: oneOf(FRAME_SLOT_OFFSETS),
      allow_section_card: bool,
      transition: oneOf(FRAME_SLOT_TRANSITIONS),
      continue_placement: oneOf(FRAME_CONTINUE_PLACEMENTS),
      continue_style_role: oneOf(FRAME_CONTINUE_STYLE_ROLES),
    },
  },
  mobile: {
    label: "mobile",
    fields: {
      hide_footer: bool,
      progress_position: oneOf(FRAME_PROGRESS_POSITIONS),
      logo_size: oneOf(FRAME_SIZES),
      trust_strip_mobile: oneOf(FRAME_TRUST_MOBILE_MODES),
    },
  },
  compat: {
    label: "compatibility",
    fields: {
      allow_section_chrome: bool,
    },
  },
};

export function validateFrameConfig(raw: unknown): FrameConfigValidation {
  const problems: Problem[] = [];
  const push = (severity: ProblemSeverity, path: string, message: string): void => {
    problems.push({ path, scope: "frame", severity, message });
  };

  if (!isRecord(raw)) {
    push("error", "frame", "Frame settings must be a JSON object.");
    return { config: null, problems };
  }

  for (const [key, value] of Object.entries(raw)) {
    if (key === "version") {
      if (value !== 1) push("error", "frame.version", "Frame settings version must be 1.");
      continue;
    }
    if (key === "template") {
      if (!isFrameTemplateId(value)) {
        push(
          "error",
          "frame.template",
          `The frame template must be one of: ${FRAME_TEMPLATE_IDS.join(", ")}.`,
        );
      }
      continue;
    }
    const spec = FRAME_GROUP_SPECS[key];
    if (spec === undefined) {
      push("error", `frame.${key}`, `'${key}' isn't a recognised frame setting.`);
      continue;
    }
    validateGroup(key, spec, value, push);
  }

  // Cross-field rules (header).
  const header = raw["header"];
  if (isRecord(header)) {
    const cta = header["cta"];
    if (isRecord(cta) && cta["enabled"] === true) {
      if (!isNonEmptyString(cta["label"])) {
        push("error", "frame.header.cta.label", "The header call-to-action needs a label.");
      }
      if (!isNonEmptyString(cta["href"]) && !isNonEmptyString(cta["tel"])) {
        push(
          "error",
          "frame.header.cta",
          "The header call-to-action needs a phone number or a link to point at.",
        );
      }
    }
    if (header["logo_source"] === "manual") {
      // §4.4 — manual is Advanced-gated and stamps this warning.
      push("warning", "frame.header.logo_source", "Manual logo overrides site branding.");
      if (!isNonEmptyString(header["logo_media_id"])) {
        push(
          "error",
          "frame.header.logo_media_id",
          "Choose a logo image to use the manual logo option.",
        );
      }
    }
  }

  const hasErrors = problems.some((p) => p.severity === "error");
  return { config: hasErrors ? null : (raw as FrameConfig), problems };
}

function validateGroup(
  groupKey: string,
  spec: FrameGroupSpec,
  value: unknown,
  push: (severity: ProblemSeverity, path: string, message: string) => void,
): void {
  const basePath = `frame.${groupKey}`;
  if (!isRecord(value)) {
    push("error", basePath, `The ${spec.label} settings must be a group of settings.`);
    return;
  }
  for (const [key, fieldValue] of Object.entries(value)) {
    const field = spec.fields[key];
    if (field === undefined) {
      push("error", `${basePath}.${key}`, `'${key}' isn't a recognised ${spec.label} setting.`);
      continue;
    }
    validateField(fieldValue, field, `${basePath}.${key}`, `${spec.label} '${humanize(key)}'`, push);
  }
}

function validateField(
  value: unknown,
  spec: FrameFieldSpec,
  path: string,
  label: string,
  push: (severity: ProblemSeverity, path: string, message: string) => void,
): void {
  switch (spec.kind) {
    case "object": {
      if (!isRecord(value)) {
        push("error", path, `The ${label} setting must be a group of settings.`);
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        const field = spec.fields[key];
        if (field === undefined) {
          push("error", `${path}.${key}`, `'${key}' isn't a recognised ${spec.label} setting.`);
          continue;
        }
        validateField(nested, field, `${path}.${key}`, `${spec.label} '${humanize(key)}'`, push);
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        push("error", path, `The ${label} setting must be a list.`);
        return;
      }
      const fieldNames = Object.keys(spec.fields);
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${path}[${i}]`;
        const item: unknown = value[i];
        if (!isRecord(item)) {
          push(
            "error",
            itemPath,
            `Each ${spec.itemLabel} must be an entry with ${fieldNames.join(" + ")}.`,
          );
          continue;
        }
        for (const key of Object.keys(item)) {
          if (!(key in spec.fields)) {
            push("error", `${itemPath}.${key}`, `'${key}' isn't a recognised ${spec.itemLabel} field.`);
          }
        }
        // Every declared field of a list entry is required.
        for (const [key, field] of Object.entries(spec.fields)) {
          validateField(item[key], field, `${itemPath}.${key}`, `${spec.itemLabel} '${humanize(key)}'`, push);
        }
      }
      return;
    }
    case "boolean":
      if (typeof value !== "boolean") push("error", path, `The ${label} setting must be true or false.`);
      return;
    case "enum":
      if (typeof value !== "string" || !spec.values.includes(value)) {
        push("error", path, `The ${label} setting must be one of: ${spec.values.join(", ")}.`);
      }
      return;
    case "text":
      if (typeof value !== "string") push("error", path, `The ${label} setting must be plain text.`);
      return;
    case "text_or_null":
      if (value !== null && typeof value !== "string") {
        push("error", path, `The ${label} setting must be plain text, or empty.`);
      }
      return;
    case "required_text":
      if (!isNonEmptyString(value)) push("error", path, `The ${label} field needs plain text.`);
      return;
    case "media_id":
      if (!isNonEmptyString(value)) {
        push("error", path, `The ${label} field must reference an uploaded image (its media id).`);
      }
      return;
    case "media_id_or_null":
      if (value !== null && !isNonEmptyString(value)) {
        push("error", path, `The ${label} setting must reference an uploaded image, or be empty.`);
      }
      return;
    case "role":
      if (!isFunnelTokenRole(value)) {
        push(
          "error",
          path,
          `The ${label} setting must be a theme colour role: ${FUNNEL_TOKEN_ROLES.join(", ")}.`,
        );
      }
      return;
    case "href":
      if (!isNonEmptyString(value) || !SAFE_HREF_RE.test(value.trim())) {
        push(
          "error",
          path,
          `The ${label} must be a web address (https://…), a page path (/…), a #section link, or a tel:/mailto: link.`,
        );
      }
      return;
    case "href_or_null":
      if (value !== null && (!isNonEmptyString(value) || !SAFE_HREF_RE.test(value.trim()))) {
        push(
          "error",
          path,
          `The ${label} must be a web address (https://…), a page path (/…), a #section link, or a tel:/mailto: link.`,
        );
      }
      return;
    case "tel_or_null":
      if (value !== null && (!isNonEmptyString(value) || !SAFE_TEL_RE.test(value.trim()))) {
        push(
          "error",
          path,
          `The ${label} must be a phone number (digits, spaces, +, dashes), like +1 555 123 4567.`,
        );
      }
      return;
  }
}

function humanize(key: string): string {
  return key.replace(/_/g, " ");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
