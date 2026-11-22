// X14 plan v2 (owner, 22 Nov 2026): the site's tab icon and the ONE logo rule
// every public page family shares (homepage family, listicles, LeadGen).
//
// * Logo rule (Q4): only an uploaded logo shows — a same-origin /media/ picture
//   that is NOT the AI-made setup logo (stored under ai/<site>/logo/, a square
//   mostly made of white space; PR #37 replaced it with the badge and the
//   10 Nov decision kept that). Anything else counts as "no logo".
// * Tab icon (Q3): the site's "Tab icon" (site setting favicon_media_id) when
//   set, resized at the edge to 32 px (tab) and 180 px (phone home screen);
//   otherwise the site's badge — the same brand-colored square + glyph the
//   header shows when there is no logo — drawn as an SVG at /site-icon.svg.
// Nothing here throws on bad input: an unusable value means "not set".

import { mediaUrl } from "./view-models/media-url";
import { cfTransform } from "./templates/responsive-img";
import { brandGlyphSvg, resolveBrandGlyphKey } from "./templates/icons";

export const DEFAULT_BRAND_COLOR = "#1ba8c8";
export const SITE_ICON_SVG_PATH = "/site-icon.svg";
const AI_SETUP_LOGO_PATH = /^\/media\/ai\/[^/]+\/logo\//;

// The one logo rule. Accepts a /media/ address, a bare storage key or null.
export function uploadedLogoUrl(logo: string | null | undefined): string | null {
  const raw = typeof logo === "string" ? logo.trim() : "";
  if (raw === "") return null;
  const url = raw.startsWith("/") ? raw : mediaUrl(raw);
  if (url === null || !url.startsWith("/media/") || url.startsWith("//")) return null;
  if (AI_SETUP_LOGO_PATH.test(url) || url === "/media/__pending__") return null;
  return url;
}

// For page families that also accept a safe outside logo address (listicles,
// LeadGen): the same rule's "AI setup logo counts as none" part, without the
// same-origin requirement the homepage header needs for edge resizing.
export function withoutAiSetupLogo(logo: string | null | undefined): string | null {
  const raw = typeof logo === "string" ? logo.trim() : "";
  if (raw === "" || raw === "/media/__pending__") return null;
  return AI_SETUP_LOGO_PATH.test(raw) ? null : raw;
}

// The site's uploaded tab icon as a /media/ address, or null when not set.
export function siteFaviconUrl(faviconMediaId: string | null | undefined): string | null {
  const raw = typeof faviconMediaId === "string" ? faviconMediaId.trim() : "";
  if (raw === "") return null;
  const url = mediaUrl(raw);
  if (url === null || !url.startsWith("/media/") || url.startsWith("//") || url === "/media/__pending__") return null;
  return url;
}

// The site's brand color for the badge and the browser color: the brand
// token "tw-brand" (the variable the public CSS uses) when it is a plain CSS
// hex color, else the default teal. Never passes arbitrary text through.
export function siteBrandColor(tokens: Readonly<Record<string, string>> | undefined | null): string {
  const value = tokens?.["tw-brand"] ?? tokens?.["--tw-brand"];
  const v = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v) ? v : DEFAULT_BRAND_COLOR;
}

const isSvg = (url: string): boolean => /\.svg$/i.test(url.split("?")[0] ?? "");

const escAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Where a tab icon of `size` px lives (same-origin path).
export function siteIconHref(faviconUrl: string | null, size: 32 | 180): string {
  if (faviconUrl === null) return SITE_ICON_SVG_PATH;
  if (isSvg(faviconUrl)) return faviconUrl;
  return cfTransform(faviconUrl, `width=${size},height=${size},fit=contain,format=png`);
}

// The <head> tags for the tab icon, the phone home-screen icon and the
// browser color. Same output for every public page family.
export function siteIconHeadTags(args: { faviconUrl: string | null; brandColor: string }): string {
  const color = escAttr(args.brandColor);
  const lines: string[] = [];
  if (args.faviconUrl === null) {
    lines.push(`<link rel="icon" type="image/svg+xml" href="${SITE_ICON_SVG_PATH}">`);
  } else if (isSvg(args.faviconUrl)) {
    lines.push(`<link rel="icon" type="image/svg+xml" href="${escAttr(args.faviconUrl)}">`);
  } else {
    lines.push(`<link rel="icon" type="image/png" sizes="32x32" href="${escAttr(siteIconHref(args.faviconUrl, 32))}">`);
    lines.push(`<link rel="apple-touch-icon" sizes="180x180" href="${escAttr(siteIconHref(args.faviconUrl, 180))}">`);
  }
  lines.push(`<meta name="theme-color" content="${color}">`);
  return lines.join("\n");
}

// The badge as a stand-alone SVG picture (the /site-icon.svg body).
export function siteBadgeIconSvg(args: { brandColor: string; name?: string; tagline?: string }): string {
  const key = resolveBrandGlyphKey(`${args.name ?? ""} ${args.tagline ?? ""}`);
  const glyph = brandGlyphSvg(key, 36)
    .replace(/^<svg class="[^"]*"/, '<svg x="14" y="14"')
    .replace(/ aria-hidden="true"| focusable="false"/g, "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<rect width="64" height="64" rx="14" fill="${escAttr(args.brandColor)}"/>` +
    `<g color="#ffffff" fill="#ffffff">${glyph}</g></svg>`
  );
}

// A same-origin path as a full web address on the site's own host (for
// structured data and share pictures, which need absolute URLs).
export function absoluteOnHost(hostname: string, path: string | null): string | null {
  if (path === null || !path.startsWith("/") || path.startsWith("//")) return null;
  const host = hostname.trim().toLowerCase();
  if (host === "" || !/^[a-z0-9.-]+(:[0-9]+)?$/.test(host)) return null;
  return `https://${host}${path}`;
}
