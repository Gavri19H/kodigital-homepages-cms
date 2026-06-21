// T21: responsive-image primitive for the public Home + Article surfaces.
// Emits a /media/-prefixed src (the always-served public route — see
// view-models/media-url.ts + media/serve.ts) PLUS a srcset of Cloudflare
// image-transformation candidates and a blur-up (LQIP) placeholder. This is
// the "port the responsive image system (srcset + blur-up)" brief (BCL-020).
//
// Mechanism:
//   - src    : /media/<key> — the bare public route. Always resolves through
//              the Worker (media/serve.ts), so it is the safe fallback even on
//              a zone without image transformations enabled.
//   - srcset : /cdn-cgi/image/width=<W>,quality=<Q>,format=auto/media/<key>
//              candidates, each with a `<W>w` descriptor. This is Cloudflare's
//              documented URL-format transform
//              (developers.cloudflare.com/images/optimization/features —
//              default breakpoints 320;768;960;1200). On a zone WITHOUT
//              transformations enabled CF serves the ORIGINAL image, so the
//              markup degrades gracefully and never renders broken. Each
//              candidate URL is a single non-whitespace run followed by a `w`
//              descriptor, so the comma-separated transform options are
//              unambiguous to the HTML srcset parser.
//   - LQIP   : a width=32,blur=40 transform set as the element's own
//              background-image (background-size:cover). While the full bitmap
//              streams in, the tiny blurred preview paints behind it; once the
//              image decodes its content covers the placeholder. Pure CSS — no
//              client JS required. Also surfaced as data-lqip for
//              progressive-enhancement / testability.
//
// Every <img> carries explicit width+height (anti-CLS, T20 contract) and an
// explicit loading hint (eager for the LCP hero, lazy below the fold;
// fetchpriority is reserved for the eager hero — never on a lazy image).

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

// Build a Cloudflare image-transformation URL for a same-origin source path.
// The source path's leading slash is dropped so the result is a clean
// `/cdn-cgi/image/<options>/<path>` URL.
export function cfTransform(sourcePath: string, options: string): string {
  return `/cdn-cgi/image/${options}/${sourcePath.replace(/^\/+/, "")}`;
}

// The blur-up (LQIP) placeholder URL for a same-origin source path.
export function lqipUrl(sourcePath: string): string {
  return cfTransform(
    sourcePath,
    `width=${LQIP_WIDTH},quality=${LQIP_QUALITY},blur=${LQIP_BLUR},format=auto`,
  );
}

function isSameOriginPath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

export function responsiveImg(opts: ResponsiveImgOptions): string {
  const resolved = mediaUrl(opts.src);
  if (resolved === null) return "";
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
  const baseAttrs = `${classAttr} src="${escAttr(resolved)}"${altAttr}${dimAttr} loading="${loading}"${fpAttr} decoding="async"`;

  // RESCUE-4 RENDER FIX (live-verified 2026-06-21): Cloudflare Image Resizing
  // (/cdn-cgi/image/<options>/...) is NOT enabled on the tenant zones — every
  // transform URL 404s (GET /cdn-cgi/image/width=640,.../media/<key> -> 404,
  // while the bare /media/<key> -> 200). A <img srcset> of 404 candidates makes
  // the browser render a BROKEN image (once it SELECTS a srcset candidate per
  // `sizes` it does NOT fall back to `src`), and the LQIP background-image 404s
  // too — exactly why every card/featured/picks image showed broken live. So we
  // emit ONLY the bare /media/ src (Worker-served, 200 on every zone) + the
  // anti-CLS width/height. The transform helpers (cfTransform/srcsetWidths/
  // lqipUrl) + constants are retained + unit-tested so the srcset+blur-up
  // optimisation can be re-enabled HERE in one place the day Cloudflare Image
  // Resizing is turned on for the zone. A working full-size image beats a broken
  // responsive one.
  void DEFAULT_QUALITY;
  void LQIP_WIDTH;
  void LQIP_BLUR;
  void LQIP_QUALITY;
  void isSameOriginPath;
  return `<img${baseAttrs}>`;
}
