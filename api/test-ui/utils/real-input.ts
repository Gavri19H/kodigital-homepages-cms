// Real-gesture Playwright input helpers — Section Builder v3.1 remediation,
// register §A M1: "Behavior specs used synthetic dispatchEvent (bypasses
// hit-testing) → misaligned/occluded controls still 'pass' while real mice
// fail." Every helper in this file drives ONLY page.mouse / Locator methods
// that go through Chromium's real input pipeline (real hit-testing, real
// event trust flags). NEVER add dispatchEvent (or any *.evaluate() that
// calls el.dispatchEvent(...)) to this file — synthetic events are
// inadmissible evidence in this mission (register root rule, line 9-10).
//
// Harness fact this file exists to survive (register L5 "Harness fact" +
// P3DRAG/P4DRAG/P10DRAG): a real page.mouse.move() driven into the studio's
// srcdoc canvas iframe can HANG indefinitely (CDP limitation moving a
// trusted pointer across a same-origin srcdoc frame boundary). Every
// primitive call below is wrapped in a per-step timeout guard so a hang
// throws a typed StepTimeoutError immediately — the caller (and Playwright's
// reporter) sees a fast, legible failure instead of the whole test wedging
// out to the global test timeout.
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

export interface RealDragOptions {
  /** Number of intermediate page.mouse.move calls between `from` and `to` (excludes the initial move-to-`from` and the final move-to-`to`). Default 5 — matches the register's P3DRAG finding that a hang can appear as early as the 2nd move, so multiple discrete steps (not one steps-internal Playwright move) are required for the hang to be observable and guardable per-step. */
  steps?: number;
  /** Per-primitive timeout guard in ms. A hang on ANY single mouse.move/down/up throws StepTimeoutError instead of wedging the run to the global Playwright test timeout. Default 5000. */
  perStepGuardMs?: number;
  /** Optional settle wait (page.waitForTimeout) after mouse.up, in ms. Default 0 — callers assert their own settle/debounce window (e.g. the 300ms afterModelChange debounce documented in register §C S2). */
  settleMs?: number;
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
 */
export async function realDrag(page: Page, from: Point, to: Point, options: RealDragOptions = {}): Promise<void> {
  const steps = options.steps ?? 5;
  const guardMs = options.perStepGuardMs ?? 5000;
  const dx = (to.x - from.x) / steps;
  const dy = (to.y - from.y) / steps;

  await guard('mouse.move(from)', guardMs, () => page.mouse.move(from.x, from.y));
  await guard('mouse.down()', guardMs, () => page.mouse.down());
  for (let i = 1; i <= steps; i++) {
    const x = from.x + dx * i;
    const y = from.y + dy * i;
    await guard(`mouse.move(step ${i}/${steps})`, guardMs, () => page.mouse.move(x, y));
  }
  await guard('mouse.move(to, final)', guardMs, () => page.mouse.move(to.x, to.y));
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
 */
export async function realDragFromLocator(
  page: Page,
  fromLocator: Locator,
  to: Point | Locator,
  options: RealDragOptions = {},
): Promise<void> {
  const fromBox = await fromLocator.boundingBox();
  if (!fromBox) throw new Error('realDragFromLocator: source locator has no bounding box (not visible/attached)');
  const from: Point = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 };
  let toPoint: Point;
  if ('x' in to && 'y' in to) {
    toPoint = to;
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
