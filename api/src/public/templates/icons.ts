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

export function iconBrandMark(args?: IconArgs): string {
  const c = cls(args);
  const s = size(args);
  return `<svg class="${c}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false"><path d="M12 2 2 7l10 5 10-5-10-5Zm-8 9.2v5.4l8 4 8-4v-5.4l-8 4-8-4Z" fill="currentColor"/></svg>`;
}
