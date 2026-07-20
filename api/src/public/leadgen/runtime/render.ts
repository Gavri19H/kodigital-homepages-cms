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
  return Array.prototype.slice.call(root.querySelectorAll("[data-lg-section]"));
}

export function sectionElementAt(root: Element, index: number): HTMLElement | null {
  const sections = sectionElements(root);
  for (const el of sections) {
    if (Number(el.getAttribute("data-lg-index")) === index) return el;
  }
  return sections[index] ?? null;
}

// §3.5.2: exactly ONE [data-lg-section] visible.
export function showOnlySection(root: Element, index: number): HTMLElement | null {
  let shown: HTMLElement | null = null;
  for (const el of sectionElements(root)) {
    const elIndex = Number(el.getAttribute("data-lg-index"));
    const match = (Number.isNaN(elIndex) ? -1 : elIndex) === index;
    toggleHidden(el, match);
    if (match) shown = el;
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
export function applySelectionClasses(questionEl: Element, value: unknown): void {
  const values = Array.isArray(value) ? value.map((v) => String(v)) : [String(value)];
  const choices = questionEl.querySelectorAll("[data-lg-choice]");
  for (let i = 0; i < choices.length; i++) {
    const el = choices[i];
    if (el === undefined) continue;
    const isOn = values.indexOf(el.getAttribute("data-lg-choice") ?? "") !== -1;
    if (isOn) {
      el.classList.add(SELECTED_CLASS);
      el.setAttribute("aria-pressed", "true");
    } else {
      el.classList.remove(SELECTED_CLASS);
      el.setAttribute("aria-pressed", "false");
    }
  }
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
  const min = Number(input.getAttribute("min") ?? 0);
  const max = Number(input.getAttribute("max") ?? 100);
  const val = Number(input.value);
  if (!Number.isFinite(val)) return;
  // A range input's own .value is always clamped by the browser into
  // [min,max], so (val-min)/span is already in [0,1] — no extra clamp needed.
  const span = max - min;
  const pct = span > 0 ? Math.round(((val - min) / span) * 100) : 0;
  const fill = wrap.querySelector(".lg-range-fill");
  if (fill instanceof HTMLElement) fill.style.width = `${pct}%`;
  const valueEl = wrap.querySelector(".lg-range-value");
  if (valueEl !== null) valueEl.textContent = (wrap.getAttribute("data-currency") ?? "") + val.toLocaleString("en-US");
  input.setAttribute("aria-valuenow", `${val}`);
}

// Progress over the VISIBLE dependency-satisfied sections (§3.5.2):
// mode "step" → "N / M" text; mode "percent" → width on an inner
// [data-lg-progress-bar] (when present) + a percent label. Both stamp
// aria/data attributes for the Playwright assertions.
export function updateProgress(root: Element, currentStep: number, totalSteps: number): void {
  const nodes = root.querySelectorAll("[data-lg-progress]");
  const safeTotal = totalSteps > 0 ? totalSteps : 1;
  const pct = Math.max(0, Math.min(100, Math.round((currentStep / safeTotal) * 100)));
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el === undefined) continue;
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
    const dots = el.querySelectorAll(".lg-step");
    for (let d = 0; d < dots.length; d++) {
      const dot = dots[d];
      if (dot === undefined) continue;
      if (d === currentStep - 1) dot.setAttribute("data-active", "true");
      else dot.removeAttribute("data-active");
    }
    const label = el.querySelector("[data-lg-progress-label]");
    const text = mode === "percent" ? `${pct}%` : `${currentStep} / ${safeTotal}`;
    if (label !== null) label.textContent = text;
    else if (bar === null) el.textContent = text;
  }
}

// 11 §11.3 footer show_on (v2.5): the frame renders the footer ONCE with
// data-show-on="all|first|final" ("never" renders nothing at all); the engine
// toggles it per step — first = only the first VISIBLE section, final = the
// last visible section AND the banners/auction view, all/unknown = always.
// Legacy shells carry no [data-show-on] → no-op.
export function updateFooterVisibility(root: Element, first: boolean, final: boolean): void {
  const nodes = root.querySelectorAll("[data-show-on]");
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el === undefined) continue;
    const on = el.getAttribute("data-show-on");
    toggleHidden(el, on === "first" ? first : on === "final" ? final : true);
  }
}

// Back affordance (§3.5.2): shown only while back_stack is non-empty.
export function setBackVisible(sectionEl: Element, visible: boolean): void {
  const backs = sectionEl.querySelectorAll("[data-lg-back]");
  for (let i = 0; i < backs.length; i++) {
    const el = backs[i];
    if (el === undefined) continue;
    toggleHidden(el, visible);
  }
}

// P4c (register PC-12): section-level Continue visibility. Scoped to
// sectionEl (every section keeps its own [data-lg-continue] mount; sections
// server-render simultaneously, only one shown at a time via
// showOnlySection), so a rule on one section's Continue never touches
// another's. Hidden ⇒ unreachable by the click delegate below (a hidden
// element cannot receive a real click), so "cannot advance via it while
// unmet" holds with no extra engine guard.
export function setContinueVisible(sectionEl: Element, visible: boolean): void {
  const conts = sectionEl.querySelectorAll("[data-lg-continue]");
  for (let i = 0; i < conts.length; i++) {
    const el = conts[i];
    if (el === undefined) continue;
    toggleHidden(el, visible);
  }
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
    slot.textContent = message ?? "";
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
  const slots = sectionEl.querySelectorAll("[data-lg-error-for]");
  for (let i = 0; i < slots.length; i++) {
    const el = slots[i];
    if (el === undefined) continue;
    el.textContent = "";
    el.setAttribute("hidden", "");
  }
  const marked = sectionEl.querySelectorAll(`.${ERROR_CLASS}`);
  for (let i = 0; i < marked.length; i++) marked[i]?.classList.remove(ERROR_CLASS);
  const invalid = sectionEl.querySelectorAll('[aria-invalid="true"]');
  for (let i = 0; i < invalid.length; i++) invalid[i]?.removeAttribute("aria-invalid");
}

// B9 Other-group expansion (§3.2 render row): clicking [data-lg-other-trigger]
// reveals the sibling [data-lg-other-panel] (scoped to the same question
// block); choosing a secondary [data-lg-choice] INSIDE the panel stores the
// REAL value through the engine's normal choice path.
export function openOtherPanel(triggerEl: Element): HTMLElement | null {
  const question = triggerEl.closest("[data-lg-question]");
  const scope = question ?? triggerEl.parentElement;
  if (scope === null) return null;
  const panel = scope.querySelector("[data-lg-other-panel]");
  if (panel === null || !(panel instanceof HTMLElement)) return null;
  panel.removeAttribute("hidden");
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
  mount.removeAttribute("hidden");
  return mount;
}

// Completion state (§3.5.6–7): hide every section, reveal the banners mount
// region, stamp the root for the E2E assertions.
export function showCompletionState(root: Element, status: "filled" | "unfilled"): void {
  for (const el of sectionElements(root)) el.setAttribute("hidden", "");
  root.setAttribute("data-lg-complete", "1");
  root.setAttribute("data-lg-auction", status);
  // §11.3: the banners/auction view counts as "final" for footer show_on.
  updateFooterVisibility(root, false, true);
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
  if (notice !== null) notice.setAttribute("hidden", "");
}

// Container-aware focus (§3.2 render row): focus the first interactive
// element INSIDE the newly-shown section without scroll-jacking.
export function focusSection(sectionEl: Element): void {
  const target =
    sectionEl.querySelector("[data-lg-input]") ?? sectionEl.querySelector("[data-lg-choice]");
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
