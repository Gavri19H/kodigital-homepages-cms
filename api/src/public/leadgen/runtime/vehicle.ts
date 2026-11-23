// LeadGen runtime — F18 Vehicle database, the visitor side (backlog F18
// Section 3 parts E/F, Section 4 "Visitor pages", owner decisions Q5–Q10),
// plus the generic Searchable-dropdown filter.
//
// BROWSER module: DOM access happens INSIDE functions only. Markup contract:
// components/presets.ts renderVehicleQuestion (its header lists every
// data-lg-v* hook read here). Server modules are NOT imported (the bundle stays
// dependency-free); the two shared numbers are mirrored below and pinned to
// leadgen/vehicles by test/leadgen-vehicle-runtime.test.ts.
//
// Speed rules (spec P1–P7): no new script, the browser's own fetch only; the
// Make choices are in the page HTML (nothing is fetched on page load); ONE
// request per picked make (its years and models together), kept in memory for
// the page's life, so Year → Model makes no further call. The request starts
// as soon as a make is picked (the engine's vAns), so it is usually done
// before the Year page shows. P7 / Q6: the request gives up after 1 second
// (AbortController), and a failed, slow or empty lookup turns the Year / Model
// question into its typed-answer box, saving to the same field — the visitor
// can always go on.

import type { LgComponentConfig } from "./state";
import { applySelectionClasses, toggleHidden } from "./render";

// config-dto.ts LeadgenPublicConfig.vehicle (present only when the page was
// rendered with the live vehicle list).
export interface LgVehicleConfig {
  snapshot: string;
  base: string;
}

// The served make file (leadgen/vehicles/format.ts VehicleMakeFile): every
// model A→Z, and the model years newest first, each pointing into `models`.
export interface LgMakeFile {
  years: { year: number; m: number[] }[];
  models: { model_id: string; name: string }[];
}

// [label, saved value]
type LgOpt = [string, string];

// = VEHICLE_LOOKUP_TIMEOUT_MS (leadgen/vehicles/props.ts, owner decision Q6).
export const LG_VEHICLE_TIMEOUT_MS = 1000;

const files: Record<string, Promise<LgMakeFile>> = {};
// Each filterable <select>'s FULL option list (after its placeholder).
const lists = new WeakMap<Element, HTMLOptionElement[]>();

// ONE request per make, kept for the page's life; a failed or slow one is
// forgotten so a later pick can try again. The abort timer is left to run
// out: aborting a request that already finished does nothing.
export function vehicleFile(v: LgVehicleConfig, make: string): Promise<LgMakeFile> {
  let p = files[make];
  if (!p) {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), LG_VEHICLE_TIMEOUT_MS);
    p = files[make] = fetch(`${v.base}/${v.snapshot}/makes/${make}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw 0;
        return r.json() as Promise<LgMakeFile>;
      })
      .catch((e) => {
        delete files[make];
        throw e;
      });
  }
  return p;
}

// Year: every model year, newest first. Model: the models of the saved year
// (a number from a card / list, or the visitor's own text), A→Z.
export function vehicleOptions(f: LgMakeFile, asks: string, year: unknown): LgOpt[] {
  if (asks === "year") return f.years.map((y) => ["" + y.year, "" + y.year]);
  const y = f.years.find((e) => e.year === Number(year));
  return y ? y.m.sort((a, b) => a - b).map((i) => [f.models[i]!.name, f.models[i]!.model_id]) : [];
}

// Rebuild a <select>'s options (after its placeholder) from its full list:
// those whose label contains `text` (lower case), plus the chosen one, which
// stays chosen. Rebuilt rather than hidden — iOS ignores hidden <option>s.
function refill(sel: HTMLSelectElement, text: string, v: string): void {
  sel.length = 1;
  for (const o of lists.get(sel) || []) if (o.value === v || o.text.toLowerCase().indexOf(text) >= 0) sel.add(o);
  sel.value = v;
  if (sel.value !== v) sel.value = "";
}

// Searchable dropdown (presets.ts [data-lg-searchable] / [data-lg-dropdown-search],
// typed or vehicle): typing narrows the list to the options whose label
// contains the typed text, ignoring case.
export function lgSearch(box: HTMLInputElement): void {
  const w = box.closest("[data-lg-searchable]");
  const sel = w && w.querySelector("select");
  if (!sel) return;
  if (!lists.has(sel)) lists.set(sel, Array.from(sel.options).slice(1));
  refill(sel, box.value.toLowerCase(), sel.value);
}

// Show a Year / Model question's choices — or, `opts` null, its typed-answer
// box (Q6) — and re-select `saved` (the field's current answer; this is also
// the restore after a reload). Card / button slots take the first options in
// order; the rest go to the question's <select> (Year cards: the "Older year"
// list, shown only when a saved year is in it).
export function vehicleFill(q: Element, opts: LgOpt[] | null, saved: unknown): void {
  const s = saved == null ? "" : "" + saved;
  const slots = q.querySelectorAll("[data-lg-vslot]");
  const rest = opts ? opts.slice(slots.length) : [];
  const box = q.querySelector("[data-lg-dropdown-search]") as HTMLInputElement | null;
  const text = q.querySelector("[data-lg-vtext]") as HTMLInputElement | null;
  const trig = q.querySelector("[data-lg-other-trigger]");
  // The box and, in a "Go to next" Section, its own Continue ([data-lg-vgo]).
  q.querySelectorAll("[data-lg-vtext],[data-lg-vgo]").forEach((e) => toggleHidden(e, !opts));
  // A saved model id is never shown as typed text.
  if (text && !opts && !/^m_/.test(s)) text.value = s;
  if (box) toggleHidden(box, !!opts);
  if (trig) toggleHidden(trig, rest.length > 0);
  slots.forEach((b, i) => {
    const o = opts && opts[i];
    toggleHidden(b, !!o);
    if (o) {
      b.setAttribute("data-lg-choice", o[1]);
      // The slot's label box: a card's / card-layout button's title, or a
      // plain button's .lg-vlabel (presets.ts) — never the ✓ marker spans.
      (b.querySelector(".lg-card-title,.lg-tscard-title,.lg-vlabel") as Element).textContent = o[0];
    } else b.removeAttribute("data-lg-choice");
  });
  q.querySelectorAll("select").forEach((sel) => {
    if (opts) {
      lists.set(sel, rest.map((o) => new Option(o[0], o[1])));
      refill(sel, box ? box.value.toLowerCase() : "", s);
    }
    toggleHidden(sel, !!opts && (!sel.hasAttribute("data-lg-other-panel") || sel.value !== ""));
  });
  applySelectionClasses(q, s);
}

// The vehicle questions — all of them, or (`only`) those whose answer depends
// on that field (its Make or Year question).
export function vehicleQs(root: Element, only?: string): Element[] {
  return Array.from(root.querySelectorAll("[data-lg-vehicle]")).filter(
    (q) => only === undefined || q.getAttribute("data-lg-vmake") === only || q.getAttribute("data-lg-vyear") === only,
  );
}

// Headline names (owner, 23 Nov): in a Section's headline / subheadline
// (presets.ts .lg-headline / .lg-subheadline) {make} shows the make's display
// name — its card / option label, or the visitor's own text when the make is a
// text box — and "car" with no make answer; {year} shows the year (or typed
// year), or nothing, the double space collapsed. Each element's text as served
// is kept as its template, so a changed answer replaces again. Text only
// (textContent), never HTML. Elements without a token get no work.
const tpls = new WeakMap<Element, string>();
export function vehicleNames(root: Element, ans: Record<string, unknown>): void {
  let make = "car";
  let year = "";
  for (const q of vehicleQs(root)) {
    const a = ans[q.getAttribute("data-lg-field") || ""];
    if (a == null || a === "") continue;
    const s = "" + a;
    const k = q.getAttribute("data-lg-vehicle");
    if (k === "year") year = s;
    else if (k === "make") {
      const c = /^\d+$/.test(s) && q.querySelector(`[data-lg-choice="${s}"],option[value="${s}"]`);
      make = c ? (c.textContent || "").trim() : s;
    }
  }
  root.querySelectorAll(".lg-headline,.lg-subheadline").forEach((h) => {
    let t = tpls.get(h);
    if (t === undefined) tpls.set(h, (t = h.textContent || ""));
    if (/\{(make|year)\}/.test(t)) {
      h.textContent = t.replace(/\{make\}/g, make).replace(/\{year\}/g, year).replace(/\s+/g, " ").trim();
    }
  });
}

// Bring the vehicle questions under `root` in line with the answers: a Make
// question re-selects its saved make in its <select> (after a reload); a Year
// / Model question shows its make's choices, or its typed-answer box when the
// make (or, for a Model, the year) was skipped or typed, the lookup fails or
// is slow, or the make has nothing for the saved year. While a lookup runs —
// or while the Make / Year question it waits for is still unanswered under
// `root` — the question shows no choices. A vehicle
// question accepts only a value from its current choices (its valid_values,
// read by validation.ts) or, in typed-answer mode, any text. No-op without
// the live list (the page then rendered every vehicle question as a text box).
export function vehicleScan(
  root: Element,
  v: LgVehicleConfig | undefined,
  ans: () => Record<string, unknown>,
  comp: (questionId: string) => LgComponentConfig | null,
  only?: string,
): void {
  if (!v) return;
  for (const q of vehicleQs(root, only)) {
    const at = (n: string): string => q.getAttribute("data-lg-" + n) || "";
    const field = at("field");
    const mk = at("vmake");
    const asks = at("vehicle");
    if (asks === "make") {
      const s = "" + ans()[field];
      q.querySelectorAll("select").forEach((sel) => {
        sel.value = s;
        if (sel.value !== s) sel.value = "";
        else toggleHidden(sel, true);
      });
      continue;
    }
    const c = comp(at("question"));
    const set = (o: LgOpt[] | null): void => {
      if (c) c.valid_values = o ? o.map((x) => x[1]) : undefined;
      vehicleFill(q, o, ans()[field]);
    };
    const yr = at("vyear");
    // An unanswered Make / Year is waited for (no choices) while its question
    // is right here; otherwise — skipped or typed — the typed-answer box.
    const wait = (f: string): boolean =>
      ans()[f] == null && vehicleQs(root).some((e) => e.getAttribute("data-lg-field") === f);
    const make = "" + ans()[mk];
    if (!/^\d+$/.test(make)) {
      set(wait(mk) ? [] : null);
      continue;
    }
    set([]);
    // A late answer for a make the visitor has since changed is ignored.
    const cur = (): boolean => "" + ans()[mk] === make;
    vehicleFile(v, make)
      .then((f) => vehicleOptions(f, asks, ans()[yr]))
      .then(
        (o) => cur() && set(o.length > 0 ? o : wait(yr) ? [] : null),
        () => cur() && set(null),
      );
  }
}
