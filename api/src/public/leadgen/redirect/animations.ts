// F11 — the five countdown animations (plan Section 4, decision 12), built
// once so F10's "K · Result animation" can reuse them (decision 15).
//
// CSS ONLY: no visitor script drives them. Each one is timed to the caller's
// seconds through two custom properties the caller sets on an ancestor:
//   --lg-ra-secs   the countdown length as a CSS time, e.g. "5s"
//   --lg-ra-turns  the same number as a plain count (one 1s loop per second, so
//                  the looping styles stop exactly when the countdown ends)
// and takes its colours from two more (Theme roles resolved by the caller):
//   --lg-ra-color  the moving part      --lg-ra-track  the track behind it
// Under "Reduce motion" nothing moves: the ring and bar show their current
// state from --lg-ra-p (0..1, the share of the countdown already elapsed —
// whatever script runs the countdown may set it each second; absent = 0), and
// the spinner and dots stand still.
//
// Pure: no I/O, no DOM. Every interpolated value is escaped.

import { FRAME_REDIRECT_ANIMATIONS, FRAME_SIZES } from "../designs/frames";

export type CountdownAnimationStyle = (typeof FRAME_REDIRECT_ANIMATIONS)[number];
export type CountdownAnimationSize = (typeof FRAME_SIZES)[number];

export const COUNTDOWN_ANIMATION_STYLES = FRAME_REDIRECT_ANIMATIONS;

// Plan Section 4: M = 64px, S 48, L 96.
export const COUNTDOWN_ANIMATION_SIZE_PX: Readonly<Record<CountdownAnimationSize, number>> = { s: 48, m: 64, l: 96 };

// The ring's circle (r = 28 in a 64-unit box): its circumference is the dash
// length the ring empties over.
const RING_R = 28;
export const RING_CIRCUMFERENCE = 175.93; // 2 * PI * 28, to 2 dp

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isHttpLogoUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(value.trim());
}

export interface CountdownAnimationInput {
  style: CountdownAnimationStyle;
  size: CountdownAnimationSize;
  /** Show the seconds (ring: inside it; bar: beside it). Ignored by the other styles. */
  show_seconds: boolean;
  /** The number first shown before any script ticks (the countdown's length). */
  seconds: number;
  /** "Logo on a bar": the partner's logo (absolute http(s) only). None → the ring. */
  logo_url?: string | null;
  /** The logo's alt text (the brand), plain text. */
  logo_alt?: string | null;
}

/** The style that actually renders: "Logo on a bar" with no usable logo falls back to the ring. */
export function effectiveAnimationStyle(style: CountdownAnimationStyle, logoUrl: string | null | undefined): CountdownAnimationStyle {
  return style === "logo_bar" && !isHttpLogoUrl(logoUrl) ? "ring" : style;
}

// The seconds number: every element carrying data-lg-rd-n is what a countdown
// script rewrites each second.
function secondsSpan(cls: string, seconds: number): string {
  return `<span class="${cls}" data-lg-rd-n>${String(Math.max(0, Math.floor(seconds)))}</span>`;
}

export function renderCountdownAnimation(input: CountdownAnimationInput): string {
  const style = effectiveAnimationStyle(input.style, input.logo_url);
  const size = (FRAME_SIZES as readonly string[]).includes(input.size) ? input.size : "m";
  const cls = `lg-ra lg-ra--${style} lg-ra--${size}`;
  switch (style) {
    case "ring":
      return (
        `<div class="${cls}" aria-hidden="true">` +
        `<svg class="lg-ra-svg" viewBox="0 0 64 64" focusable="false">` +
        `<circle class="lg-ra-track" cx="32" cy="32" r="${RING_R}"></circle>` +
        `<circle class="lg-ra-prog" cx="32" cy="32" r="${RING_R}"></circle>` +
        `</svg>` +
        (input.show_seconds ? secondsSpan("lg-ra-n", input.seconds) : "") +
        `</div>`
      );
    case "bar":
      return (
        `<div class="${cls}" aria-hidden="true">` +
        `<span class="lg-ra-bar"><span class="lg-ra-fill"></span></span>` +
        (input.show_seconds ? secondsSpan("lg-ra-n lg-ra-n--side", input.seconds) : "") +
        `</div>`
      );
    case "logo_bar": {
      const px = COUNTDOWN_ANIMATION_SIZE_PX[size];
      // The logo fills the lane minus its rider's vertical padding and border.
      const width = Math.round(px * 1.9);
      const height = Math.round(px * 0.62 - 8);
      return (
        `<div class="${cls}" aria-hidden="true">` +
        `<span class="lg-ra-lane"><span class="lg-ra-logo">` +
        `<img src="${esc((input.logo_url as string).trim())}" alt="${esc(input.logo_alt ?? "")}"` +
        ` width="${width}" height="${height}" loading="eager" />` +
        `</span></span>` +
        `<span class="lg-ra-bar"><span class="lg-ra-fill"></span></span>` +
        `</div>`
      );
    }
    case "spinner":
      return `<div class="${cls}" aria-hidden="true"><span class="lg-ra-spin"></span></div>`;
    case "dots":
      return `<div class="${cls}" aria-hidden="true"><span class="lg-ra-dot"></span><span class="lg-ra-dot"></span><span class="lg-ra-dot"></span></div>`;
  }
}

// The stylesheet for all five. Colours, timing and the reduced-motion state
// come from the custom properties named in the header comment.
export const COUNTDOWN_ANIMATION_CSS =
  ".lg-ra{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:10px;max-width:100%;--lg-ra-size:64px}" +
  ".lg-ra--s{--lg-ra-size:48px}.lg-ra--m{--lg-ra-size:64px}.lg-ra--l{--lg-ra-size:96px}" +
  // 1 · Countdown ring — the ring empties over the seconds.
  ".lg-ra--ring{width:var(--lg-ra-size);height:var(--lg-ra-size)}" +
  ".lg-ra-svg{display:block;width:100%;height:100%;transform:rotate(-90deg)}" +
  ".lg-ra-track{fill:none;stroke:var(--lg-ra-track,#D2D9E5);stroke-width:4}" +
  `.lg-ra-prog{fill:none;stroke:var(--lg-ra-color,#1B3A5C);stroke-width:4;stroke-linecap:round;stroke-dasharray:${RING_CIRCUMFERENCE};stroke-dashoffset:0;animation:lg-ra-empty var(--lg-ra-secs,5s) linear forwards}` +
  `@keyframes lg-ra-empty{from{stroke-dashoffset:0}to{stroke-dashoffset:${RING_CIRCUMFERENCE}}}` +
  ".lg-ra-n{font-weight:600;font-variant-numeric:tabular-nums;line-height:1;color:var(--lg-ra-text,inherit)}" +
  ".lg-ra--ring .lg-ra-n{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:calc(var(--lg-ra-size) * .32)}" +
  ".lg-ra-n--side{font-size:14px;min-width:1.2em;text-align:left}" +
  // 2 · Progress bar — the bar fills over the seconds.
  ".lg-ra-bar{display:block;position:relative;width:calc(var(--lg-ra-size) * 3.4);max-width:100%;height:calc(var(--lg-ra-size) / 8);border-radius:999px;background:var(--lg-ra-track,#D2D9E5);overflow:hidden}" +
  ".lg-ra-fill{display:block;height:100%;width:0;border-radius:999px;background:var(--lg-ra-color,#1B3A5C);animation:lg-ra-fill var(--lg-ra-secs,5s) linear forwards}" +
  "@keyframes lg-ra-fill{from{width:0}to{width:100%}}" +
  // 3 · Logo on a bar — the partner's logo rides the bar's fill edge.
  ".lg-ra--logo_bar{flex-direction:column;align-items:stretch;gap:6px;width:calc(var(--lg-ra-size) * 3.4);max-width:100%}" +
  ".lg-ra--logo_bar .lg-ra-bar{width:100%}" +
  ".lg-ra-lane{display:block;position:relative;height:calc(var(--lg-ra-size) * .62)}" +
  ".lg-ra-logo{position:absolute;bottom:0;left:0;display:flex;align-items:center;justify-content:center;height:100%;padding:3px 6px;box-sizing:border-box;background:#FFFFFF;border:1px solid var(--lg-ra-track,#D2D9E5);border-radius:6px;box-shadow:0 1px 3px rgba(16,24,40,.08);animation:lg-ra-ride var(--lg-ra-secs,5s) linear forwards}" +
  ".lg-ra-logo img{display:block;height:100%;width:auto;max-width:calc(var(--lg-ra-size) * 1.9);object-fit:contain}" +
  "@keyframes lg-ra-ride{from{left:0;transform:translateX(0)}to{left:100%;transform:translateX(-100%)}}" +
  // 4 · Spinner — the same ring as the loading screen; one turn per second.
  ".lg-ra-spin{display:block;width:var(--lg-ra-size);height:var(--lg-ra-size);box-sizing:border-box;border-radius:50%;border:calc(var(--lg-ra-size) / 16) solid var(--lg-ra-track,#D2D9E5);border-top-color:var(--lg-ra-color,#1B3A5C);animation:lg-ra-spin 1s linear;animation-iteration-count:var(--lg-ra-turns,5)}" +
  "@keyframes lg-ra-spin{to{transform:rotate(360deg)}}" +
  // 5 · Dots — three soft pulsing dots; one pulse per second, all ending together.
  ".lg-ra--dots{gap:calc(var(--lg-ra-size) / 8);height:calc(var(--lg-ra-size) / 2)}" +
  // The stagger lives inside each dot's own keyframes (not in a delay), so all
  // three run exactly the countdown's length and stop together.
  ".lg-ra-dot{display:block;width:calc(var(--lg-ra-size) / 5.33);height:calc(var(--lg-ra-size) / 5.33);border-radius:50%;background:var(--lg-ra-color,#1B3A5C);opacity:.4;transform:scale(.6);animation:lg-ra-pulse1 1s ease-in-out;animation-iteration-count:var(--lg-ra-turns,5)}" +
  ".lg-ra-dot:nth-child(2){animation-name:lg-ra-pulse2}.lg-ra-dot:nth-child(3){animation-name:lg-ra-pulse3}" +
  "@keyframes lg-ra-pulse1{0%,45%,100%{transform:scale(.6);opacity:.4}20%{transform:scale(1);opacity:1}}" +
  "@keyframes lg-ra-pulse2{0%,25%,70%,100%{transform:scale(.6);opacity:.4}45%{transform:scale(1);opacity:1}}" +
  "@keyframes lg-ra-pulse3{0%,50%,95%,100%{transform:scale(.6);opacity:.4}70%{transform:scale(1);opacity:1}}" +
  // Paused (a hidden tab): the countdown script marks an ancestor.
  "[data-lg-rd-paused] .lg-ra-prog,[data-lg-rd-paused] .lg-ra-fill,[data-lg-rd-paused] .lg-ra-logo,[data-lg-rd-paused] .lg-ra-spin,[data-lg-rd-paused] .lg-ra-dot{animation-play-state:paused}" +
  // "Reduce motion": nothing moves; the ring and bar show their current state.
  "@media (prefers-reduced-motion:reduce){" +
  ".lg-ra-prog,.lg-ra-fill,.lg-ra-logo,.lg-ra-spin,.lg-ra-dot{animation:none!important}" +
  `.lg-ra-prog{stroke-dashoffset:calc(${RING_CIRCUMFERENCE}px * var(--lg-ra-p,0))}` +
  ".lg-ra-fill{width:calc(100% * var(--lg-ra-p,0))}" +
  ".lg-ra-logo{left:calc(100% * var(--lg-ra-p,0));transform:translateX(calc(-100% * var(--lg-ra-p,0)))}" +
  ".lg-ra-dot{opacity:.7;transform:none}" +
  "}";
