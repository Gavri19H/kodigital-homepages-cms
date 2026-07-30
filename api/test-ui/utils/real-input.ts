// Real-gesture Playwright input helpers — Section Builder v3.1 remediation,
// register §A M1: "Behavior specs used synthetic dispatchEvent (bypasses
// hit-testing) → misaligned/occluded controls still 'pass' while real mice
// fail." Every helper in this file drives ONLY page.mouse / Locator methods
// that go through Chromium's real input pipeline (real hit-testing, real
// event trust flags). NEVER add dispatchEvent (or any *.evaluate() that
// calls el.dispatchEvent(...)) to this file — synthetic events are
// inadmissible evidence in this mission (register root rule, line 9-10).
//
// Harness fact this file was built to survive (register L5 "Harness fact" +
// P3DRAG/P4DRAG/P10DRAG), UPDATED by the U13 root-cause fix (2026-07-15): a
// real page.mouse.move() driven into the studio's srcdoc canvas iframe used
// to HANG indefinitely under Chromium — NOT a CDP limitation on trusted
// pointer delivery across a same-origin srcdoc boundary (that theory is
// disproven). The real cause: the iframe's sandbox="allow-same-origin"
// (scripts disabled) suppressed Chromium's held-button page.mouse.move
// stream delivery across the boundary — the SAME failure that showed up as
// the operator's real-Chrome dead drag. Granting sandbox="allow-same-origin
// allow-scripts" PLUS a first-in-head script-src 'none' CSP
// (ui-section-studio.ts studioCanvasFrameSrcdoc) fixed delivery while keeping
// every script vector inert, so Chromium now drives these gestures
// correctly (leadgen-u11u12-move.gesture.spec.ts + forensic-live-probe.spec.ts
// run this file's helpers on BOTH the chromium and firefox projects). Every
// primitive call below stays wrapped in a per-step timeout guard as a GENERAL
// watchdog (any future stall — a real regression, a slow render, an
// unrelated harness fault — still throws a typed StepTimeoutError immediately
// instead of wedging the whole test out to the global test timeout).
import type { Locator, Page } from '@playwright/test';

export interface Point {
  x: number;
  y: number;
}

/**
 * Thrown when a single real-input primitive (mouse.move/down/up) does not
 * settle within its per-step guard window. Distinguish this from a normal
 * Playwright TimeoutError in reports/logs: a StepTimeoutError means "the
 * browser never acknowledged this specific primitive" (the harness-hang
 * class the register documents), not "an element never became actionable".
 */
export class StepTimeoutError extends Error {
  readonly step: string;
  readonly guardMs: number;

  constructor(step: string, guardMs: number) {
    super(`real-input step "${step}" exceeded its ${guardMs}ms guard — treat as a HANG (harness/CDP stall), not a wedged run.`);
    this.name = 'StepTimeoutError';
    this.step = step;
    this.guardMs = guardMs;
  }
}

/**
 * Race `op()` against a per-step timeout so a stalled primitive fails fast
 * with a typed error. NOTE: Playwright's mouse/page APIs have no cancel
 * token, so a truly hung underlying CDP call keeps running in the
 * background after this guard rejects — that orphaned call can never
 * resolve later in the harness-hang cases this exists for (real mouse into
 * a same-origin srcdoc iframe), so it is inert, not a source of flakiness.
 */
async function guard<T>(step: string, guardMs: number, op: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(step, guardMs)), guardMs);
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clamp a point to lie within `box`, inset by `insetPx` on every side.
 *
 * Exists to eliminate an entire class of gesture-test fragility surfaced in
 * the Section Builder v3.1 U11b/U12 remediation (2026-07-15): the funnel's
 * live content column widened 500px->600px (a golden-fidelity fix — the
 * golden's OWN composition column is 600px, golden-master-source.dc.html
 * :296, and contract §7.1's "384 = 64% of the 600 column"). That widening
 * pushed several fields' right resize handles closer to the studio canvas's
 * right edge; a handful of gesture tests dragged those handles by a
 * hardcoded rightward delta (+60/+80/+90px) calibrated against the OLD,
 * narrower column. At 600 those same deltas landed the final mouseup PAST
 * the canvas — into the inspector rail or off it entirely — so the drag
 * never committed (nothing under the cursor to receive the mouseup) and a
 * subsequent save+reload hung waiting for a "load" event that never fired.
 * Proven by bisect: the identical drag/test passed at content.maxWidth=500
 * and hung at 600 (same code, same test — only the column width differed).
 *
 * Clamping every drag target inside the canvas frame's own boundingBox (via
 * RealDragOptions.clampToBox below) makes this overshoot class impossible
 * for ANY future column-width value, not just today's 600 — a caller no
 * longer needs to hand-tune a delta against a specific viewport/column size.
 */
export function clampPointToBox(point: Point, box: Box, insetPx = 4): Point {
  const minX = box.x + insetPx;
  const maxX = box.x + box.width - insetPx;
  const minY = box.y + insetPx;
  const maxY = box.y + box.height - insetPx;
  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY),
  };
}

export interface RealDragOptions {
  /** Number of intermediate page.mouse.move calls between `from` and `to` (excludes the initial move-to-`from` and the final move-to-`to`). Default 5 — matches the register's P3DRAG finding that a hang can appear as early as the 2nd move, so multiple discrete steps (not one steps-internal Playwright move) are required for the hang to be observable and guardable per-step. */
  steps?: number;
  /** Per-primitive timeout guard in ms. A hang on ANY single mouse.move/down/up throws StepTimeoutError instead of wedging the run to the global Playwright test timeout. Default 5000. */
  perStepGuardMs?: number;
  /** Optional settle wait (page.waitForTimeout) after mouse.up, in ms. Default 0 — callers assert their own settle/debounce window (e.g. the 300ms afterModelChange debounce documented in register §C S2). */
  settleMs?: number;
  /**
   * Optional bounding box — typically the canvas iframe's own
   * `page.locator("#lg-studio-canvas-frame").boundingBox()` (page/viewport
   * coordinates, the same space page.mouse operates in) — that the drag's
   * TARGET is clamped inside (see clampPointToBox above for the incident
   * this guards against: the 500->600 content-column overshoot class).
   * Only `to` is clamped, never `from` — `from` is assumed valid because it
   * comes from a real, actionable element's own boundingBox(); clamping it
   * too could shift a mousedown off the element it is meant to grab.
   */
  clampToBox?: Box;
  /** Inset (px) applied on all four sides of clampToBox. Default 4. */
  clampInsetPx?: number;
}

/**
 * Real-gesture drag: page.mouse.move(from) → page.mouse.down() → N stepped
 * page.mouse.move() calls toward `to` → page.mouse.move(to) (exact final
 * position) → page.mouse.up(). Every primitive is individually guarded
 * (see `guard`) so a mid-drag hang (register: real mouse into the srcdoc
 * canvas can hang at the 2nd move) surfaces immediately as a typed
 * StepTimeoutError rather than wedging the test to its global timeout.
 *
 * NEVER falls back to dispatchEvent on failure/timeout — a HANG here is
 * itself a valid, reportable finding (see register L5 P3DRAG/P4DRAG/P10DRAG:
 * "HANG (harness)" is a recorded verdict, not a bug to work around with
 * synthetic events).
 *
 * When `options.clampToBox` is set, `to` is clamped (clampPointToBox) BEFORE
 * the per-step interpolation, so every intermediate move also stays between
 * `from` and the clamped target — see RealDragOptions.clampToBox.
 */
export async function realDrag(page: Page, from: Point, to: Point, options: RealDragOptions = {}): Promise<void> {
  const steps = options.steps ?? 5;
  const guardMs = options.perStepGuardMs ?? 5000;
  const target = options.clampToBox ? clampPointToBox(to, options.clampToBox, options.clampInsetPx ?? 4) : to;
  const dx = (target.x - from.x) / steps;
  const dy = (target.y - from.y) / steps;

  await guard('mouse.move(from)', guardMs, () => page.mouse.move(from.x, from.y));
  await guard('mouse.down()', guardMs, () => page.mouse.down());
  for (let i = 1; i <= steps; i++) {
    const x = from.x + dx * i;
    const y = from.y + dy * i;
    await guard(`mouse.move(step ${i}/${steps})`, guardMs, () => page.mouse.move(x, y));
  }
  await guard('mouse.move(to, final)', guardMs, () => page.mouse.move(target.x, target.y));
  await guard('mouse.up()', guardMs, () => page.mouse.up());
  if (options.settleMs !== undefined && options.settleMs > 0) {
    await page.waitForTimeout(options.settleMs);
  }
}

/**
 * Real-gesture drag FROM a locator's center TO another locator's center (or
 * an absolute Point). Resolves bounding boxes via Playwright's real
 * actionability-checked boundingBox() — never getBoundingClientRect via
 * evaluate, so the same trusted-input contract holds end to end.
 *
 * P6 D5 — SOURCE SCROLL-INTO-VIEW (retires a whole false-failure class):
 * boundingBox() reports VIEWPORT coordinates and happily returns a box that
 * lies OUTSIDE the viewport, while toBeVisible() still passes (Playwright's
 * "visible" means a non-empty box, not "on screen"). page.mouse, however,
 * only delivers to real viewport coordinates — so an off-screen source made
 * mouse.down() undeliverable and the drag silently never started. Measured
 * instance (P6 C2, leadgen-u11u12-move-chromium-attempt.spec.ts's own
 * comment): the product's §6.2/§6.4 focusChoiceRow scrolled the studio body
 * scroller to scrollTop 651, putting the move tag at page y=-63.1; the same
 * class is documented at the bottom edge. Callers used to patch this one at
 * a time with their own scrollIntoViewIfNeeded() before the drag — doing it
 * HERE retires the class repo-wide. scrollIntoViewIfNeeded() is a real
 * Playwright actionability primitive (the same scroll Locator.click() and
 * Locator.dragTo() perform before every real gesture), NOT dispatchEvent, so
 * this file's trusted-input contract is untouched. Best-effort by design: if
 * the scroll cannot complete, the `!fromBox` throw below still reports the
 * unreachable source exactly as before.
 *
 * DELTA COMPENSATION (measured, not assumed — the first cut of this fix
 * regressed on it): a scroll moves the caller's world too. Callers routinely
 * pass `to` as an ABSOLUTE Point they computed from a boundingBox BEFORE this
 * call (leadgen-p3a-placement's thirdPoint(), leadgen-u11u12-move's
 * dropPoint), so scrolling here silently invalidated that point and the drop
 * landed in the wrong place — proven by probe: with the raw scroll and a
 * pre-measured drop point, the C2 drag ran to completion but persisted
 * q_head,q_btn,q_zip (no reorder). So the source box is measured on BOTH
 * sides of the scroll and an absolute `to` is shifted by the SAME delta,
 * which is exactly the shift every element in that scroller took. Delta is
 * {0,0} whenever nothing scrolled (the overwhelmingly common case), so an
 * in-view source is byte-for-byte the pre-P6 behaviour. A `to` LOCATOR needs
 * no compensation: its box is read AFTER the scroll. `clampToBox` stays
 * caller-owned (it is typically the canvas FRAME's page box, which an
 * in-iframe scroller does not move).
 */
export async function realDragFromLocator(
  page: Page,
  fromLocator: Locator,
  to: Point | Locator,
  options: RealDragOptions = {},
): Promise<void> {
  const boxBeforeScroll = await fromLocator.boundingBox();
  try {
    await fromLocator.scrollIntoViewIfNeeded({ timeout: options.perStepGuardMs ?? 5000 });
  } catch {
    /* unreachable/detached source → the !fromBox throw below reports it */
  }
  const fromBox = await fromLocator.boundingBox();
  if (!fromBox) throw new Error('realDragFromLocator: source locator has no bounding box (not visible/attached)');
  const scrollDelta: Point = boxBeforeScroll
    ? { x: fromBox.x - boxBeforeScroll.x, y: fromBox.y - boxBeforeScroll.y }
    : { x: 0, y: 0 };
  const from: Point = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 };
  let toPoint: Point;
  if ('x' in to && 'y' in to) {
    toPoint = { x: to.x + scrollDelta.x, y: to.y + scrollDelta.y };
  } else {
    const toBox = await to.boundingBox();
    if (!toBox) throw new Error('realDragFromLocator: target locator has no bounding box (not visible/attached)');
    toPoint = { x: toBox.x + toBox.width / 2, y: toBox.y + toBox.height / 2 };
  }
  await realDrag(page, from, toPoint, options);
}

export interface RealClickOptions {
  /** Playwright actionability-wait timeout for this click, in ms. Default 4000. */
  timeoutMs?: number;
  clickCount?: number;
}

/**
 * Real-gesture click wrapper around Locator.click() — Playwright's trusted
 * click (waits for actionability, then dispatches a real, hit-tested
 * pointer event through Chromium; NOT el.dispatchEvent()). Returns a
 * boolean instead of throwing so probe-style callers can record
 * clickable=true/false without a try/catch at every call site; genuine
 * infra errors (e.g. a closed page) still propagate.
 */
export async function realClick(locator: Locator, options: RealClickOptions = {}): Promise<boolean> {
  const timeout = options.timeoutMs ?? 4000;
  try {
    await locator.click({ timeout, clickCount: options.clickCount ?? 1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Real-gesture click at absolute page coordinates via page.mouse (move →
 * down → up), for the rare case with no stable locator to click (e.g. a
 * computed midpoint inside a canvas overlay). Per-step guarded like
 * realDrag so a hang fails fast and typed.
 */
export async function realClickAt(page: Page, point: Point, guardMs = 4000): Promise<void> {
  await guard('mouse.move(click)', guardMs, () => page.mouse.move(point.x, point.y));
  await guard('mouse.down(click)', guardMs, () => page.mouse.down());
  await guard('mouse.up(click)', guardMs, () => page.mouse.up());
}
