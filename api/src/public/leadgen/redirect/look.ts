// F11 — the redirect screen's LOOK: the Templates element "L · Redirect"
// (designs/frames.ts FrameRedirectConfig) merged over the defaults below, with
// every colour taken from the funnel Theme's roles and the fonts from the
// Theme (owner rule: a Theme owns fonts). Plan Section 4, the part table.
//
// PURE (no I/O): redirect/screen.ts resolves the funnel's effective frame and
// design and hands them here; the admin Templates preview mirrors the same
// rules client-side from the composed preview's design tokens.

import {
  FRAME_REDIRECT_ANIMATIONS,
  FRAME_REDIRECT_CORNERS,
  FRAME_REDIRECT_TEXT_MAX,
  FRAME_SIZES,
  type FrameRedirectConfig,
} from "../designs/frames";
import { baseTokenForRole, isFunnelTokenRole, ROLE_TO_BASE_TOKEN, type EffectiveFunnelDesign, type FunnelTokenRole } from "../designs/theme";
import type { FunnelDesign } from "../designs/registry";
import type { CountdownAnimationSize, CountdownAnimationStyle } from "./animations";

type Size = (typeof FRAME_SIZES)[number];
type Corners = (typeof FRAME_REDIRECT_CORNERS)[number];

/** The defaults a Template with no "L · Redirect" block shows (plan Section 4). */
export const REDIRECT_LOOK_DEFAULTS = {
  badge_on: true,
  badge_text: "It’s a match",
  headline: "We found an offer that fits you",
  message_on: true,
  message: "{brand} will help you finish in a few steps.",
  countdown_line: "Taking you to {brand} in {n}…",
  stay_label: "Stay here",
  background_role: "card_background",
  border_role: "border",
  badge_role: "brand_primary",
  badge_bg_role: "surface_wash",
  headline_role: "text_primary",
  text_role: "text_muted",
  corners: "theme",
  shadow: true,
  headline_size: "m",
  animation: "ring",
  animation_role: "brand_primary",
  track_role: "border",
  // The banner's size. The animation-only screen, which has no banner around
  // it, shows the animation one size larger — so by default Large (plan
  // Section 3 H) — see REDIRECT_ONLY_ANIMATION_SIZE.
  animation_size: "m",
  show_seconds: true,
  only_headline: "Taking you to {brand}…",
  only_message: "You’ll continue on our partner’s site in a few seconds.",
  only_link: "Show me all offers",
} as const satisfies { [K in keyof FrameRedirectConfig]-?: NonNullable<FrameRedirectConfig[K]> };

/** The animation-only screen's animation: one size larger than the banner's. */
export const REDIRECT_ONLY_ANIMATION_SIZE: Readonly<Record<Size, Size>> = { s: "m", m: "l", l: "l" };

/** "{brand}" when the chosen card has no brand name. */
export const REDIRECT_NO_BRAND = "your offer";

/** Headline font sizes per S / M / L: desktop px, phone px (plan Section 4). */
export const REDIRECT_HEADLINE_SIZES_PX: Readonly<Record<Size, readonly [number, number]>> = {
  s: [20, 18],
  m: [24, 21],
  l: [28, 24],
};
/** The animation-only screen's headline (plan Section 4 "Exact texts"). */
export const REDIRECT_ONLY_HEADLINE_PX: readonly [number, number] = [26, 22];
/** "Rounded" corners; "Square" is 0; "Follow the Theme" is the Theme's large radius. */
export const REDIRECT_ROUNDED_RADIUS = "24px";

const ROLE_SLOTS = [
  ["background", "background_role"],
  ["border", "border_role"],
  ["badge", "badge_role"],
  ["badge_bg", "badge_bg_role"],
  ["headline", "headline_role"],
  ["text", "text_role"],
  ["animation", "animation_role"],
  ["track", "track_role"],
] as const;
type RoleSlot = (typeof ROLE_SLOTS)[number][0];

const TEXT_KEYS = [
  "badge_text",
  "headline",
  "message",
  "countdown_line",
  "stay_label",
  "only_headline",
  "only_message",
  "only_link",
] as const;
type TextKey = (typeof TEXT_KEYS)[number];

/** The resolved look: every setting decided, every colour a CSS value. */
export interface RedirectLook {
  badge_on: boolean;
  message_on: boolean;
  shadow: boolean;
  show_seconds: boolean;
  corners: Corners;
  headline_size: Size;
  animation: CountdownAnimationStyle;
  /** The banner's size (the animation-only screen shows one size larger). */
  animation_size: CountdownAnimationSize;
  texts: Record<TextKey, string>;
  roles: Record<RoleSlot, FunnelTokenRole>;
  /** Resolved CSS values (colours from the Theme roles, the Theme's radius, shadow and fonts). */
  css: Record<RoleSlot, string> & {
    radius: string;
    shadow: string;
    font_headline: string;
    font_body: string;
  };
}

// Defense in depth: every value below lands inside a <style> block, so only a
// value that cannot break out of a declaration is used (Theme colours are
// validated hex at save; base design values are code constants).
const SAFE_CSS_VALUE_RE = /^[#\w\s.,%()'"\/+-]{1,200}$/;
function safeCss(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (v === "" || !SAFE_CSS_VALUE_RE.test(v) || /url\s*\(|expression|\\|\/\*/i.test(v)) return fallback;
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickBool(stored: Record<string, unknown>, key: keyof typeof REDIRECT_LOOK_DEFAULTS, fallback: boolean): boolean {
  const v = stored[key];
  return typeof v === "boolean" ? v : fallback;
}

function pickEnum<T extends string>(stored: Record<string, unknown>, key: string, values: readonly T[], fallback: T): T {
  const v = stored[key];
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fallback;
}

function pickText(stored: Record<string, unknown>, key: TextKey): string {
  const v = stored[key];
  const fallback = REDIRECT_LOOK_DEFAULTS[key];
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  if (t === "" || t.length > FRAME_REDIRECT_TEXT_MAX) return fallback;
  // The countdown line must carry the seconds; a stored line without {n}
  // (never accepted on save) falls back rather than freezing the countdown.
  if (key === "countdown_line" && !t.includes("{n}")) return fallback;
  return t;
}

/** Same lookup the Theme uses for every role (designs/theme.ts ROLE_TO_BASE_TOKEN). */
export const REDIRECT_ROLE_TOKEN_PATHS = ROLE_TO_BASE_TOKEN;

function read(design: FunnelDesign | EffectiveFunnelDesign, group: string, key: string): unknown {
  const g = (design as unknown as Record<string, unknown>)[group];
  return isRecord(g) ? g[key] : undefined;
}

/**
 * Merge a stored "L · Redirect" block (anything — an invalid field falls back
 * to its default, never throws) over the defaults, resolving colours, radius,
 * shadow and fonts from the funnel's effective design (the Theme applied).
 */
export function resolveRedirectLook(stored: unknown, design: FunnelDesign | EffectiveFunnelDesign): RedirectLook {
  const s = isRecord(stored) ? stored : {};
  const d = REDIRECT_LOOK_DEFAULTS;
  const roles = {} as Record<RoleSlot, FunnelTokenRole>;
  for (const [slot, key] of ROLE_SLOTS) {
    const v = s[key];
    roles[slot] = isFunnelTokenRole(v) ? v : (d[key] as FunnelTokenRole);
  }
  const texts = {} as Record<TextKey, string>;
  for (const key of TEXT_KEYS) texts[key] = pickText(s, key);
  const corners = pickEnum(s, "corners", FRAME_REDIRECT_CORNERS, d.corners);
  const shadow = pickBool(s, "shadow", d.shadow);

  const css = {} as RedirectLook["css"];
  for (const [slot] of ROLE_SLOTS) {
    // (Fallbacks are colour keywords: a Theme value is always a safe colour.)
    css[slot] = safeCss(baseTokenForRole(design, roles[slot]), slot === "background" ? "white" : "currentColor");
  }
  css.radius =
    corners === "square"
      ? "0px"
      : corners === "rounded"
        ? REDIRECT_ROUNDED_RADIUS
        : safeCss(read(design, "radius", "lg"), "14px");
  css.shadow = shadow ? safeCss(read(design, "shadow", "lg"), "none") : "none";
  css.font_headline = safeCss(read(design, "headline", "fontFamily"), "inherit");
  css.font_body = safeCss(read(design, "page", "fontFamily"), "inherit");

  return {
    badge_on: pickBool(s, "badge_on", d.badge_on),
    message_on: pickBool(s, "message_on", d.message_on),
    shadow,
    show_seconds: pickBool(s, "show_seconds", d.show_seconds),
    corners,
    headline_size: pickEnum(s, "headline_size", FRAME_SIZES, d.headline_size),
    animation: pickEnum(s, "animation", FRAME_REDIRECT_ANIMATIONS, d.animation),
    animation_size: pickEnum(s, "animation_size", FRAME_SIZES, d.animation_size),
    texts,
    roles,
    css,
  };
}
