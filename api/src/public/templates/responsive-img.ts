// Public image slots use Cloudflare width candidates up to 2× display size.
// The largest candidate also serves browsers that use the src fallback.

import { imageTransformsEnabled } from "../../env";
import { escAttr } from "./esc";
import { mediaUrl } from "../view-models/media-url";

const STANDARD_BREAKPOINTS: ReadonlyArray<number> = [
  320, 480, 640, 768, 960, 1200, 1600, 1920,
];
const DEFAULT_QUALITY = 75;
const LQIP_WIDTH = 32;
const LQIP_BLUR = 40;
const LQIP_QUALITY = 30;

export interface ResponsiveImgOptions {
  src: string | null | undefined;
  alt: string | null | undefined;
  width: number;
  height: number;
  className?: string;
  loading?: "eager" | "lazy";
  fetchpriority?: "high" | "low" | "auto";
  sizes?: string;
  quality?: number;
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `responsiveImg: ${label} must be a positive integer (got ${value})`,
    );
  }
}

// The srcset candidate widths for a given intrinsic display width: the
// standard breakpoints up to 2× the display width (covers a 2× DPR screen),
// plus the display width and its retina (2×) variant. Always returns at least
// two distinct candidates so the srcset is genuinely responsive.
export function srcsetWidths(displayWidth: number): number[] {
  assertPositiveInt(displayWidth, "width");
  const max = displayWidth * 2;
  const set = new Set<number>(STANDARD_BREAKPOINTS.filter((w) => w <= max));
  set.add(displayWidth);
  set.add(max);
  return [...set].sort((a, b) => a - b);
}

// Use the same root-relative source path with or without the transform prefix.
export function cfTransform(sourcePath: string, options: string): string {
  const path = "/" + sourcePath.replace(/^\/+/, "");
  return imageTransformsEnabled ? `/cdn-cgi/image/${options}${path}` : path;
}

// The blur-up (LQIP) placeholder URL for a same-origin source path.
export function lqipUrl(sourcePath: string): string {
  return cfTransform(
    sourcePath,
    `width=${LQIP_WIDTH},quality=${LQIP_QUALITY},blur=${LQIP_BLUR},format=auto`,
  );
}

// Editor blocks can have a known display width even when their intrinsic
// dimensions were never saved. They share the same sources as fixed slots.
export function responsiveSrcAttrs(
  src: string | null | undefined,
  displayWidth: number,
  { sizes, quality = DEFAULT_QUALITY, fit }: {
    sizes?: string;
    quality?: number;
    fit?: "scale-down";
  } = {},
): string {
  const ref = src?.trim();
  if (!ref) return "";
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|\/\/|data:|blob:)/i.test(ref)) {
    return `src="${escAttr(ref)}"`;
  }
  const path = mediaUrl(ref)!.replace(/\s/g, encodeURIComponent);
  if (!imageTransformsEnabled) {
    assertPositiveInt(displayWidth, "width");
    return `src="${escAttr(path)}"`;
  }
  const fitOption = fit ? `,fit=${fit}` : "";
  const candidates = srcsetWidths(displayWidth).map((width) => ({
    width,
    url: cfTransform(path, `width=${width}${fitOption},quality=${quality},format=auto`),
  }));
  const fallback = candidates[candidates.length - 1]!.url;
  const srcset = candidates.map(({ url, width }) => `${url} ${width}w`).join(", ");
  const sizesAttr = sizes ? ` sizes="${escAttr(sizes)}"` : "";
  return `src="${escAttr(fallback)}" srcset="${escAttr(srcset)}"${sizesAttr}`;
}

export function responsiveImg(opts: ResponsiveImgOptions): string {
  const sources = responsiveSrcAttrs(opts.src, opts.width, opts);
  if (!sources) return "";
  assertPositiveInt(opts.width, "width");
  assertPositiveInt(opts.height, "height");

  const loading = opts.loading ?? "lazy";
  const altAttr = ` alt="${escAttr(opts.alt ?? "")}"`;
  const classAttr =
    opts.className !== undefined && opts.className.length > 0
      ? ` class="${escAttr(opts.className)}"`
      : "";
  const fpAttr =
    opts.fetchpriority !== undefined
      ? ` fetchpriority="${opts.fetchpriority}"`
      : "";
  const dimAttr = ` width="${opts.width}" height="${opts.height}"`;
  const tail = `${altAttr}${dimAttr} loading="${loading}"${fpAttr} decoding="async"`;

  return `<img${classAttr} ${sources}${tail}>`;
}
