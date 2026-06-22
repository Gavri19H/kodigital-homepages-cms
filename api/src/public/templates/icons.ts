// Phase 5 / T5: inline SVG icon primitives for the public surface.
//
// Every icon is decorative — meaning is carried by the surrounding text on
// the button/link that wraps the icon (e.g. "Share", "Copy link", "Search"),
// so each <svg> is hidden from assistive tech and not focusable. Icons take
// an optional className so callers can size/color them via CSS without
// re-declaring the path.
//
// PART 12 RED LINE: these icons MUST NOT embed any vertical-specific brand
// glyph. `iconBrandMark` is a neutral mark used as a logo fallback when a
// site has no `logoUrl` configured.

export interface IconArgs {
  className?: string;
  size?: number;
}

function cls(args: IconArgs | undefined): string {
  return args !== undefined && args.className !== undefined && args.className.length > 0
    ? args.className
    : "icon";
}

function size(args: IconArgs | undefined): number {
  return args !== undefined && args.size !== undefined && args.size > 0 ? args.size : 20;
}

export function iconSearch(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M10 4a6 6 0 1 1-4.24 10.24l-3.05 3.05a1 1 0 0 1-1.42-1.41l3.05-3.05A6 6 0 0 1 10 4Zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" fill="currentColor"/></svg>`;
}

export function iconShare(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M14 3a3 3 0 1 1 1.27 2.45l-5.6 3.2a3 3 0 0 1 0 2.7l5.6 3.2A3 3 0 1 1 14.4 16l-5.6-3.2a3 3 0 1 1 0-3.6l5.6-3.2A3 3 0 0 1 14 3Z" fill="currentColor"/></svg>`;
}

export function iconCopy(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M8 3h9a2 2 0 0 1 2 2v11h-2V5H8V3Zm-3 4h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v11h9V9H5Z" fill="currentColor"/></svg>`;
}

export function iconArrow(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M13.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 1 1-1.4-1.4L17.58 13H4a1 1 0 1 1 0-2h13.58l-4.28-4.3a1 1 0 0 1 0-1.4Z" fill="currentColor"/></svg>`;
}

export function iconChevronDown(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M5.3 8.3a1 1 0 0 1 1.4 0L12 13.58l5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4Z" fill="currentColor"/></svg>`;
}

export function iconPin(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  // Design Icon.Pin (filled location pin) — used as the card hover affordance.
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M12 2C8.5 2 6 4.5 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.5-2.5-6-6-6zm0 8.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>`;
}

export function iconBrandMark(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M12 2 2 7l10 5 10-5-10-5Zm-8 9.2v5.4l8 4 8-4v-5.4l-8 4-8-4Z" fill="currentColor"/></svg>`;
}

// === rescue-4 round-2: share/social icons + per-vertical brand glyphs ===

export function iconLink(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>`;
}

export function iconTwitter(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M3 2h4.3l4.1 5.6L16.4 2H21l-6.9 8 7.4 10h-4.3l-4.6-6.2L7.7 20H3l7.3-8.4L3 2z" fill="currentColor"/></svg>`;
}

export function iconFacebook(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z" fill="currentColor"/></svg>`;
}

export function iconInstagram(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>`;
}

export function iconLinkedin(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M4.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM3 9h3v12H3V9zm6 0h2.9v1.6h.05c.4-.76 1.4-1.6 2.9-1.6 3.1 0 3.7 2 3.7 4.7V21h-3v-5.4c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21H9V9z" fill="currentColor"/></svg>`;
}

export function iconYoutube(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5A3 3 0 0 0 22 15.8 31 31 0 0 0 22.4 12 31 31 0 0 0 22 8.2zM10 15V9l5.2 3L10 15z" fill="currentColor"/></svg>`;
}

export const iconPinterest = iconPin;

// Per-vertical brand glyphs rendered inside the design `.brand-logo` teal badge
// (replacing the bare site-initial letter). Each is a filled 24-viewBox shape so
// it inherits the badge's white color. resolveBrandGlyphKey infers the vertical
// from the site name + tagline; an explicit `brand_icon` setting overrides it.
const BRAND_GLYPH_PATHS: Readonly<Record<string, string>> = {
  parenting:
    '<circle cx="7" cy="5" r="2.3"/><rect x="4.5" y="8" width="5" height="11.5" rx="2.5"/><circle cx="16.6" cy="7.2" r="1.7"/><rect x="14.6" y="9.8" width="4" height="9.7" rx="2"/>',
  home: '<path d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3z"/>',
  finance: '<path d="M4 20v-8h4v8H4zm6 0V4h4v16h-4zm6 0v-6h4v6h-4z"/>',
  travel: '<path d="M2 12 21 4l-8 19-2.6-7.4L2 12z"/>',
  food: '<path d="M7 2v7a2 2 0 0 0 2 2v11h1V11a2 2 0 0 0 2-2V2h-1v6.5h-1V2H9v6.5H8V2H7zm9.3 0C14.8 2 14 4.3 14 7.3c0 2.1.9 3.5 2.1 3.9V22h1V2h-.8z"/>',
  health:
    '<path d="M12 21S3 14.7 3 8.9C3 6.2 5 4.2 7.6 4.2c1.7 0 3.3 1 4.4 2.6C13.1 5.2 14.7 4.2 16.4 4.2 19 4.2 21 6.2 21 8.9 21 14.7 12 21 12 21z"/>',
  pets:
    '<circle cx="6" cy="10" r="2"/><circle cx="10" cy="6" r="2"/><circle cx="14" cy="6" r="2"/><circle cx="18" cy="10" r="2"/><path d="M12 11.5c-2.6 0-4.7 2-4.7 4.4 0 1.4 1.1 2.3 2.6 2.3h4.2c1.5 0 2.6-.9 2.6-2.3 0-2.4-2.1-4.4-4.7-4.4z"/>',
  tech: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>',
  fashion: '<path d="M8 7a4 4 0 0 1 8 0h-2a2 2 0 0 0-4 0v.3L20 13v7H4v-7l6-5.7V7z"/>',
};

export function brandGlyphSvg(key: string, glyphSize = 22): string {
  const inner = BRAND_GLYPH_PATHS[key] ?? "";
  if (inner.length === 0) {
    return iconBrandMark({ className: "brand-glyph", size: glyphSize });
  }
  return `<svg class="brand-glyph" viewBox="0 0 24 24" width="${glyphSize}" height="${glyphSize}" aria-hidden="true" focusable="false" fill="currentColor">${inner}</svg>`;
}

const BRAND_GLYPH_KEYWORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["parenting", /parent|baby|babies|\bkid|\bkids|child|family|families|\bmom\b|\bmum\b|\bdad\b|toddler|nursery|pregnan|newborn|playful path|parenthood/i],
  ["home", /home decor|home improvement|\bdiy\b|interior|renovat|\bgarden|household|furnitur/i],
  ["finance", /financ|invest|\bmoney|stock|budget|wealth|trading|crypto|saving|retire/i],
  ["travel", /travel|vacation|flight|destination|itinerary|backpack|tourism|getaway|\bhotel/i],
  ["food", /\bfood|recipe|\bcook|kitchen|\bmeal|baking|cuisine|restaurant|\bdiet/i],
  ["health", /health|wellness|fitness|nutrition|mental|medical|workout|\byoga/i],
  ["pets", /\bpet|\bdog|\bcat\b|puppy|kitten|\banimal/i],
  ["tech", /\btech|software|gadget|\bai\b|computer|startup|coding|\bapp\b/i],
  ["fashion", /fashion|\bstyle|beauty|makeup|skincare|outfit|wardrobe/i],
];

export function resolveBrandGlyphKey(text: string): string {
  const t = (text ?? "").toLowerCase();
  for (const [key, re] of BRAND_GLYPH_KEYWORDS) {
    if (re.test(t)) return key;
  }
  return "default";
}
