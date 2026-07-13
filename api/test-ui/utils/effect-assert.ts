// Effect-assertion helpers — Section Builder v3.1 remediation, register §A
// M5: "No effect-assertions: gates proved markup/attr existence, never
// 'click ⇒ render changed'." The roast's F8 finding sharpens this further:
// a bare "did something change" check passes just as happily on a WRONG
// change as the right one. Every assertion here is therefore an
// EXPECTED-VALUE assertion (after == exactly this), never a bare delta
// ("before !== after") check standing in for correctness.
import { expect, type FrameLocator } from '@playwright/test';

export interface ComputedStyleSnapshot {
  width: string;
  height: string;
  borderRadius: string;
  borderColor: string;
  backgroundColor: string;
  color: string;
}

export interface RenderState {
  /** Cheap content-change fingerprint (djb2-family hash) of the WHOLE render root's innerHTML — catches side effects anywhere in the render, not only at targetSelector. Two RenderStates with equal htmlHash mean NOTHING in the render root changed at all. */
  htmlHash: number;
  /** getComputedStyle() of the first element matching targetSelector inside the render root. All fields are '' (never throws) if targetSelector matches nothing — callers assert only the fields they expect populated. */
  computed: ComputedStyleSnapshot;
}

const DEFAULT_ROOT_SELECTOR = '#lg-studio-canvas-render';

/**
 * Capture a render-state fingerprint for `targetSelector` inside
 * `frameLocator` (the studio's canvas srcdoc frame in every existing
 * probe). Call this BEFORE and AFTER a real-input action, then pass both
 * snapshots to `assertEffect`.
 */
export async function captureRenderState(
  frameLocator: FrameLocator,
  targetSelector: string,
  rootSelector: string = DEFAULT_ROOT_SELECTOR,
): Promise<RenderState> {
  const root = frameLocator.locator(rootSelector);
  return root.evaluate((rootEl: Element, args: { targetSelector: string }) => {
    const html = rootEl.innerHTML || '';
    let h = 0;
    for (let i = 0; i < html.length; i++) h = (Math.imul(h, 31) + html.charCodeAt(i)) | 0;
    const target = rootEl.querySelector(args.targetSelector) as HTMLElement | null;
    const cs = target ? getComputedStyle(target) : null;
    return {
      htmlHash: h,
      computed: {
        width: cs ? cs.width : '',
        height: cs ? cs.height : '',
        borderRadius: cs ? cs.borderRadius : '',
        borderColor: cs ? cs.borderColor : '',
        backgroundColor: cs ? cs.backgroundColor : '',
        color: cs ? cs.color : '',
      },
    };
  }, { targetSelector });
}

export type StyleKey = keyof ComputedStyleSnapshot;
/** An EXPECTED-VALUE map, e.g. `{ borderRadius: "20px" }` — never a boolean "did it change" flag. */
export type ExpectedEffect = Partial<Record<StyleKey, string>>;

export interface AssertEffectOptions {
  /** When true (default), also assert the PRE-action state did NOT already equal the expected value for each asserted key — proves the action caused a genuine transition, not a coincidental pre-existing match. Set false only for a deliberate idempotency check (value expected to already hold). */
  requireChange?: boolean;
  /** Optional label folded into failure messages (e.g. the probe name) for faster triage. */
  label?: string;
}

/**
 * Assert that an action's effect on the canvas produced EXACTLY the
 * `expected` computed-style values — never merely "the render changed to
 * *something*". Each key in `expected` is checked against `after` with a
 * hard equality assertion; by default each key is ALSO checked against
 * `before` to prove a real transition happened (register M5 / roast F8: a
 * click that does nothing must not pass just because the pre-existing
 * value happened to already equal the expectation).
 *
 * Throws (via a descriptive Error, before any expect() call) if `expected`
 * is empty — an empty expected-value map can never fail, which defeats the
 * purpose of an effect-assertion.
 */
export function assertEffect(before: RenderState, after: RenderState, expected: ExpectedEffect, options: AssertEffectOptions = {}): void {
  const requireChange = options.requireChange ?? true;
  const label = options.label ? `[${options.label}] ` : '';
  const keys = Object.keys(expected) as StyleKey[];
  if (keys.length === 0) {
    throw new Error(`${label}assertEffect: expected map is empty — pass at least one {styleKey: "expectedValue"} pair.`);
  }
  // keys.length === 0 does NOT catch an all-undefined map: Object.keys({borderRadius:
  // undefined}) still has length 1 (the property is own-enumerable, its VALUE is
  // undefined) — the loop below would then `continue` on every key without a single
  // expect() call, a silent vacuous pass (register M5 class: a caller whose per-type
  // lookup, e.g. APPENDIX_B_RADII[typeKey], resolves undefined for a missing key would
  // have that row of the effect matrix pass falsely). Filter to defined keys and
  // re-check emptiness against THAT set.
  const definedKeys = keys.filter((k) => expected[k] !== undefined);
  if (definedKeys.length === 0) {
    throw new Error(`${label}assertEffect: no defined expected values — an all-undefined map can never fail.`);
  }
  for (const key of definedKeys) {
    const expectedValue = expected[key];
    if (expectedValue === undefined) continue;
    if (requireChange) {
      expect(
        before.computed[key],
        `${label}precondition failed: before.computed.${key} already equals the expected value "${expectedValue}" — this action would prove nothing (pass options.requireChange=false if idempotency is the intent)`,
      ).not.toBe(expectedValue);
    }
    expect(after.computed[key], `${label}after.computed.${key} must equal the expected value exactly`).toBe(expectedValue);
  }
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayAlignmentResult {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  tolerancePx: number;
  aligned: boolean;
}

/**
 * Pure geometry comparison (no assertion) — useful when a caller wants to
 * record the deltas (e.g. into verdicts.jsonl, as the existing P2 probe
 * does) without throwing.
 */
export function computeOverlayAlignment(elementRect: RectLike, overlayRect: RectLike, tolerancePx = 4): OverlayAlignmentResult {
  const dx = +(overlayRect.x - elementRect.x).toFixed(2);
  const dy = +(overlayRect.y - elementRect.y).toFixed(2);
  const dw = +(overlayRect.width - elementRect.width).toFixed(2);
  const dh = +(overlayRect.height - elementRect.height).toFixed(2);
  const aligned = Math.abs(dx) <= tolerancePx && Math.abs(dy) <= tolerancePx && Math.abs(dw) <= tolerancePx && Math.abs(dh) <= tolerancePx;
  return { dx, dy, dw, dh, tolerancePx, aligned };
}

/**
 * Assert an overlay rect tracks its target element's rect within
 * `tolerancePx` on EVERY axis (dx, dy, dw, dh) — fails if any single axis
 * exceeds tolerance, matching register S1-1/S1-2 (width AND vertical
 * geometry are independently wrong; a gate that only checks one axis would
 * have missed the other).
 */
export function assertOverlayAligned(elementRect: RectLike, overlayRect: RectLike, tolerancePx = 4): void {
  const r = computeOverlayAlignment(elementRect, overlayRect, tolerancePx);
  expect(
    r.aligned,
    `overlay misaligned beyond ±${tolerancePx}px: dx=${r.dx} dy=${r.dy} dw=${r.dw} dh=${r.dh} (element=${JSON.stringify(elementRect)} overlay=${JSON.stringify(overlayRect)})`,
  ).toBe(true);
}
