// LeadGen runtime — DOM behavior over SERVER-RENDERED section HTML
// (fix-contract v2.4 03 §3.2 render.ts row).
//
// This module NEVER re-renders components from JSON (Q1 architecture
// decision, §3.1): sections arrive server-rendered as `[data-lg-section]`
// blocks with the §3.3 hydration hook attributes; render.ts only toggles
// visibility/classes/attributes and injects the auction's `banners_html`.
//
// BROWSER module: DOM access happens INSIDE functions only (no DOM globals at
// import time), so importing it under node never throws; it is exercised
// end-to-end by the Group-1 Playwright suite (11 §11.2), not vitest.
//
// §3.3 hooks consumed here: data-lg-section / data-lg-section-id /
// data-lg-index · data-lg-question · data-lg-field · data-lg-choice ·
// data-lg-input · data-lg-continue · data-lg-back · data-lg-progress
// (+data-mode) · data-lg-error-for · data-lg-other-trigger /
// data-lg-other-panel · data-lg-banners.

export const SELECTED_CLASS = "lg-selected";
export const ERROR_CLASS = "lg-error";
export const NOTICE_CLASS = "lg-runtime-notice";

// The `hidden`-attribute toggle every visibility function below performs —
// one shared helper, ~6 call sites (byte trim; behavior-identical:
// removeAttribute("hidden") / setAttribute("hidden","") verbatim).
function toggleHidden(el: Element, visible: boolean): void {
  if (visible) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

export function sectionElements(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll("[data-lg-section]"));
}

export function sectionElementAt(root: Element, index: number): HTMLElement | null {
  const sections = sectionElements(root);
  return sections.find((el) => Number(el.getAttribute("data-lg-index")) === index) || sections[index] || null;
}

// Round-4 P3a same-screen pages (D-3 operator amendment, 2026-07-20): show
// EVERY [data-lg-section] whose data-lg-index is in `indices` together (a
// multi-section page renders as ONE screen); everything else hidden. A
// single-index array is the pre-P3a "exactly one visible" behavior byte-for-
// byte (legacy/single-section-page callers pass [index]). Returns the shown
// elements in `indices` order.
export function showPageSections(root: Element, indices: readonly number[]): HTMLElement[] {
  const wanted = new Set(indices);
  const byIndex = new Map<number, HTMLElement>();
  sectionElements(root).forEach((el) => {
    const elIndex = Number(el.getAttribute("data-lg-index"));
    const match = !Number.isNaN(elIndex) && wanted.has(elIndex);
    toggleHidden(el, match);
    if (match) byIndex.set(elIndex, el);
  });
  const shown: HTMLElement[] = [];
  for (const i of indices) {
    const el = byIndex.get(i);
    if (el !== undefined) shown.push(el);
  }
  return shown;
}

// Dependency-driven reveal WITHIN a section (§3.5.3): toggle each component's
// block. Answer-PRODUCING nodes carry [data-lg-question]; PC-A13 (P4a): a
// conditional NON-producing node (TextBlock/TrustBar/…) carries [data-lg-node]
// instead (presets hydration emits it) — BOTH are hideable here, so a
// conditional on a non-answer component now hides/reveals live exactly as the
// SSR dependency-preview already does (they had diverged).
export function applyComponentVisibility(
  sectionEl: Element,
  visibility: readonly { question_id: string; visible: boolean }[],
): void {
  for (const vis of visibility) {
    const q = cssEscape(vis.question_id);
    const el = sectionEl.querySelector(`[data-lg-question="${q}"],[data-lg-node="${q}"]`);
    if (el === null) continue;
    toggleHidden(el, vis.visible);
  }
}

// Selection classes on choice click (§3.5.3). Single-select: the chosen
// [data-lg-choice] gets SELECTED_CLASS, its siblings in the same question
// block lose it. Multi-select (array value): every member value is marked.
// P5 S5c (ADJ-R8): the SSR choice buttons (presets.ts renderButtonAnswerGroup/
// renderTwoButtonYesNo/renderIconCardAnswerGrid/renderMultiChoiceCardGroup)
// all emit role="radio"/role="checkbox" aria-checked="false" — NEVER
// aria-pressed (that pairs with role="button" only). This used to write
// aria-pressed, an attribute name the SSR markup never has, so the pixel
// selection (SELECTED_CLASS) and the accessibility-tree selection diverged
// on every click across Yes/No, Buttons, and Cards alike. aria-checked is the
// one the SSR role scheme actually calls for.
export function applySelectionClasses(questionEl: Element, value: unknown): void {
  const values = Array.isArray(value) ? value.map((v) => String(v)) : [String(value)];
  questionEl.querySelectorAll("[data-lg-choice]").forEach((el) => {
    const isOn = values.indexOf(el.getAttribute("data-lg-choice") || "") !== -1;
    el.classList[isOn ? "add" : "remove"](SELECTED_CLASS);
    el.setAttribute("aria-checked", isOn ? "true" : "false");
  });
}

// S2-3 (register §C): a range slider's visible value text + filled track must
// move as the visitor drags. The SSR renderRange paints the INITIAL value/fill;
// nothing updated them on `input` until this hook. The value text is rebuilt
// byte-identically to the server's formatRangeValue (data-currency prefix, then
// Number#toLocaleString("en-US") grouping), and the fill width uses the same
// (value-min)/(max-min) percentage the server clamps. Reads min/max off the
// input's own attributes (getAttribute, not the HTMLInputElement.min property,
// so the fake-DOM unit harness exercises the identical path).
export function updateRangeDisplay(input: HTMLInputElement): void {
  const wrap = input.closest(".lg-range");
  if (wrap === null) return;
  const min = Number(input.getAttribute("min") || 0);
  const max = Number(input.getAttribute("max") || 100);
  const val = Number(input.value);
  if (!Number.isFinite(val)) return;
  // A range input's own .value is always clamped by the browser into
  // [min,max], so (val-min)/span is already in [0,1] — no extra clamp needed.
  const span = max - min;
  const pct = span > 0 ? Math.round(((val - min) / span) * 100) : 0;
  const fill = wrap.querySelector(".lg-range-fill");
  if (fill instanceof HTMLElement) fill.style.width = `${pct}%`;
  const valueEl = wrap.querySelector(".lg-range-value");
  if (valueEl !== null) valueEl.textContent = (wrap.getAttribute("data-currency") || "") + val.toLocaleString("en-US");
  input.setAttribute("aria-valuenow", `${val}`);
}

// Progress over the VISIBLE dependency-satisfied sections (§3.5.2):
// mode "step" → "N / M" text; mode "percent" → width on an inner
// [data-lg-progress-bar] (when present) + a percent label. Both stamp
// aria/data attributes for the Playwright assertions.
export function updateProgress(root: Element, currentStep: number, totalSteps: number): void {
  const safeTotal = totalSteps > 0 ? totalSteps : 1;
  const pct = Math.max(0, Math.min(100, Math.round((currentStep / safeTotal) * 100)));
  root.querySelectorAll("[data-lg-progress]").forEach((el) => {
    const mode = el.getAttribute("data-mode") === "percent" ? "percent" : "step";
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", String(safeTotal));
    el.setAttribute("aria-valuenow", String(currentStep));
    el.setAttribute("data-lg-progress-current", String(currentStep));
    el.setAttribute("data-lg-progress-total", String(safeTotal));
    // A mount that SSRs aria-valuetext="Step 1 of N" (presets renderProgressBar
    // step-mode default label / renderStepIndicator) must have it re-stamped
    // per step — screen readers PREFER valuetext over valuenow, so a stale one
    // reads "Step 1 of N" on every slide (the E3-found a11y defect). The copy
    // matches the SSR format verbatim; mounts without the attr never gain one.
    if (el.hasAttribute("aria-valuetext")) {
      el.setAttribute("aria-valuetext", `Step ${currentStep} of ${safeTotal}`);
    }
    const bar = el.querySelector("[data-lg-progress-bar]");
    if (bar !== null && bar instanceof HTMLElement) {
      bar.style.width = `${pct}%`;
    }
    // 11 §11.6 dots-style mounts: re-stamp the StepIndicator dots inside this
    // mount so EXACTLY the current step's dot carries data-active (the server
    // renders step 1 active; without this the dots never advance).
    el.querySelectorAll(".lg-step").forEach((dot, d) => {
      if (d === currentStep - 1) dot.setAttribute("data-active", "true");
      else dot.removeAttribute("data-active");
    });
    const label = el.querySelector("[data-lg-progress-label]");
    const text = mode === "percent" ? `${pct}%` : `${currentStep} / ${safeTotal}`;
    if (label !== null) label.textContent = text;
    else if (bar === null) el.textContent = text;
  });
}

// P4a-adj (P5a runtime seam #2): a [data-frame-pages] element's spec is
// "range:<from>-<to>" or "list:<n>,<n>,…" (frame.ts pageTargetGating) — true
// when the 1-based `current` page falls inside it. `indexOf` (not split on
// ":" then again) keeps this to one pass per axis; multi-digit from/to (e.g.
// "10-12") still split correctly since only the FIRST "-" after the colon is
// significant.
function pageInSpec(spec: string, current: number): boolean {
  const rest = spec.slice(spec.indexOf(":") + 1);
  if (spec[0] === "r") {
    const dash = rest.indexOf("-");
    return current >= Number(rest.slice(0, dash)) && current <= Number(rest.slice(dash + 1));
  }
  return ("," + rest + ",").includes("," + current + ",");
}

// 11 §11.3 footer show_on (v2.5): the frame renders the footer ONCE with
// data-show-on="all|first|final" ("never" renders nothing at all); the engine
// toggles it per step — first = only the first VISIBLE section, final = the
// last visible section AND the banners/auction view, all/unknown = always.
// Legacy shells carry no [data-show-on] → no-op.
// P4a-adj: the SAME pass also toggles [data-frame-pages] (10E/10F/10G page
// RANGE/LIST targeting, frame.ts pageTargetGating) against `current` — an
// element carrying data-show-on is decided by that (unchanged); a
// data-frame-pages-only element (the general range/list case a `first`-only
// target doesn't need) is decided by pageInSpec. Still display-only, one
// selector/pass, never touches section visibility or progress.
export function updateFooterVisibility(root: Element, first: boolean, final: boolean, current: number): void {
  forEachToggle(root, "[data-show-on],[data-frame-pages]", (el) => {
    const on = el.getAttribute("data-show-on");
    if (on !== null) return on === "first" ? first : on === "final" ? final : true;
    return pageInSpec(el.getAttribute("data-frame-pages") || "", current);
  });
}

// Shared by setBackVisible/setContinueVisible/updateFooterVisibility below —
// identical loop shape (NodeList's OWN .forEach — no hand-rolled iterator
// needed; every querySelectorAll index is a real Element, never a hole), only
// the selector + per-element decision differ (byte trim).
function forEachToggle(root: Element, selector: string, decide: (el: Element) => boolean): void {
  root.querySelectorAll(selector).forEach((el) => toggleHidden(el, decide(el)));
}

// Back affordance (§3.5.2): shown only while back_stack is non-empty.
export function setBackVisible(sectionEl: Element, visible: boolean): void {
  forEachToggle(sectionEl, "[data-lg-back]", () => visible);
}

// P4c (register PC-12): section-level Continue visibility. Scoped to
// sectionEl (every section keeps its own [data-lg-continue] mount; sections
// server-render simultaneously, only one shown at a time via
// showOnlySection), so a rule on one section's Continue never touches
// another's. Hidden ⇒ unreachable by the click delegate below (a hidden
// element cannot receive a real click), so "cannot advance via it while
// unmet" holds with no extra engine guard.
export function setContinueVisible(sectionEl: Element, visible: boolean): void {
  forEachToggle(sectionEl, "[data-lg-continue]", () => visible);
}

// Inline field errors (§3.5.4): fill [data-lg-error-for="{internal_field}"],
// mark the owning question block, set aria-invalid on its input. Error copy
// goes through textContent (never markup).
export function setFieldError(
  sectionEl: Element,
  internalField: string,
  message: string | null,
): void {
  const slot = sectionEl.querySelector(`[data-lg-error-for="${cssEscape(internalField)}"]`);
  if (slot !== null) {
    slot.textContent = message || "";
    toggleHidden(slot, message !== null);
  }
  const fieldEl = sectionEl.querySelector(`[data-lg-field="${cssEscape(internalField)}"]`);
  if (fieldEl !== null) {
    if (message !== null) fieldEl.classList.add(ERROR_CLASS);
    else fieldEl.classList.remove(ERROR_CLASS);
    const input = fieldEl.querySelector("[data-lg-input]");
    if (input !== null) {
      if (message !== null) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }
}

export function clearFieldErrors(sectionEl: Element): void {
  sectionEl.querySelectorAll("[data-lg-error-for]").forEach((el) => {
    el.textContent = "";
    toggleHidden(el, false);
  });
  sectionEl.querySelectorAll(`.${ERROR_CLASS}`).forEach((el) => el.classList.remove(ERROR_CLASS));
  sectionEl.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute("aria-invalid"));
}

// B9 Other-group expansion (§3.2 render row): clicking [data-lg-other-trigger]
// reveals the sibling [data-lg-other-panel] (scoped to the same question
// block); choosing a secondary [data-lg-choice] INSIDE the panel stores the
// REAL value through the engine's normal choice path.
export function openOtherPanel(triggerEl: Element): HTMLElement | null {
  const question = triggerEl.closest("[data-lg-question]");
  const scope = question || triggerEl.parentElement;
  if (scope === null) return null;
  const panel = scope.querySelector("[data-lg-other-panel]");
  if (panel === null || !(panel instanceof HTMLElement)) return null;
  toggleHidden(panel, true);
  triggerEl.setAttribute("aria-expanded", "true");
  return panel;
}

// §3.5.7: inject the auction's banners_html into [data-lg-banners].
//
// TRUST BOUNDARY (why innerHTML is correct here, §3.6): banners_html is the
// SAME-ORIGIN /lg/auction response body — HTML our own Worker composed
// (serve-auction.ts renders offer templates + governed /lg/lc hrefs
// server-side, where escaping is owned). It carries anchor markup by design,
// so it cannot go through textContent; it is exactly as trusted as the rest
// of the server-rendered shell this engine hydrates. NO client/user/URL data
// is ever concatenated into it here (auction-client.ts pins the fetch to the
// relative /lg/auction path — 03 §3.9 forbids non-/lg calls).
export function injectBanners(root: Element, bannersHtml: string): HTMLElement | null {
  const mount = root.querySelector("[data-lg-banners]");
  if (mount === null || !(mount instanceof HTMLElement)) return null;
  mount.innerHTML = bannersHtml;
  toggleHidden(mount, true);
  return mount;
}

// Completion state (§3.5.6–7): hide every section, reveal the banners mount
// region, stamp the root for the E2E assertions.
export function showCompletionState(root: Element, status: "filled" | "unfilled"): void {
  sectionElements(root).forEach((el) => toggleHidden(el, false));
  root.setAttribute("data-lg-complete", "1");
  root.setAttribute("data-lg-auction", status);
  // §11.3: the banners/auction view counts as "final" for footer show_on.
  // A page-RANGE/LIST target (data-frame-pages) is scoped to the FUNNEL
  // pages, never the post-funnel completion view — 1e9 is outside any real
  // range/list, so such an element (if present) hides here (data-show-on
  // elements are unaffected — decided before `current` is ever read).
  updateFooterVisibility(root, false, true, 1e9);
}

// §3.5.8 error path: a NON-TECHNICAL notice inside the funnel card — never a
// blank page. Rendered into the current section (or the mount as fallback);
// idempotent (one notice element reused); textContent only.
export function showRuntimeNotice(container: Element, message: string): void {
  let notice = container.querySelector(`.${NOTICE_CLASS}`);
  if (notice === null) {
    notice = container.ownerDocument.createElement("div");
    notice.className = NOTICE_CLASS;
    notice.setAttribute("role", "alert");
    container.appendChild(notice);
  }
  notice.textContent = message;
  notice.removeAttribute("hidden");
}

export function hideRuntimeNotice(container: Element): void {
  const notice = container.querySelector(`.${NOTICE_CLASS}`);
  if (notice !== null) toggleHidden(notice, false);
}

// Container-aware focus (§3.2 render row): focus the first interactive
// element INSIDE the newly-shown section without scroll-jacking.
export function focusSection(sectionEl: Element): void {
  const target =
    sectionEl.querySelector("[data-lg-input]") || sectionEl.querySelector("[data-lg-choice]");
  if (target !== null && target instanceof HTMLElement) {
    try {
      target.focus({ preventScroll: true });
    } catch {
      /* focus best-effort */
    }
  }
}

// Minimal CSS.escape for attribute-selector interpolation (question ids /
// internal fields are author-controlled tokens; escape defensively anyway).
function cssEscape(value: string): string {
  return value.replace(/["\\\]]/g, "\\$&");
}
