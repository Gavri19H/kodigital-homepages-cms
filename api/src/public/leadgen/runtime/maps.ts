// LeadGen runtime — Google Places Autocomplete wiring (fix-contract v2.4 03
// §3.2 maps.ts row; field-level config per 08 §8.8, browser Places leg only).
//
// The SHELL injects only the browser key global (`window.__LG_MAPS_KEY__`,
// spliced per-request — 03 §3.2d serve.ts row); the ENGINE owns loading the
// SDK itself: when the key is present AND at least one `[data-lg-maps]`
// field exists, `wireMapsFields` injects the Maps JS script
// (maps.googleapis.com/maps/api/js?key=…&libraries=places&loading=async +
// callback/load-event) and (re)runs `initMapsFields` once Places is ready.
// This module wires whatever is present:
//   * SDK + key present → attach Places Autocomplete to each field carrying a
//     `data-lg-maps="{configJSON}"` hook; on a place selection, fill the
//     mapped fields' VISIBLE inputs — the engine's own input path then records
//     exactly what is on screen (P8 B1) — and emit `address_autofill`; a
//     complete/valid resolution additionally emits `address_validation_success`, an
//     incomplete one `address_validation_error` (10 §10.2 producer row).
//   * key missing → graceful CONSOLE-ERROR-FREE no-op: no script tag, nothing
//     wired, manual entry keeps working (08 §8.8 "Autocomplete/validation
//     will no-op; manual entry still works").
//
// BROWSER module: window/google/document access strictly inside functions.

export interface LgMapsFieldConfig {
  autocomplete: boolean;
  validate: boolean;
  fills: { street?: string; city?: string; state?: string; zip?: string };
  normalize: boolean;
}

// Liberal parse of the per-field data-lg-maps JSON (08 §8.8 authoring keys;
// both the flat `autofill_*` spelling and a nested `fills` object are
// accepted so the presets author has room — unknown keys ignored).
export function parseMapsConfig(raw: string | null): LgMapsFieldConfig | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const c = parsed as Record<string, unknown>;
  const fillsRaw =
    c["fills"] !== null && typeof c["fills"] === "object"
      ? (c["fills"] as Record<string, unknown>)
      : {};
  const pick = (flat: string, nested: string): string | undefined => {
    const v = c[flat] !== undefined ? c[flat] : fillsRaw[nested];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const fills: LgMapsFieldConfig["fills"] = {};
  const street = pick("autofill_street", "street");
  const city = pick("autofill_city", "city");
  const state = pick("autofill_state", "state");
  const zip = pick("autofill_zip", "zip");
  if (street !== undefined) fills.street = street;
  if (city !== undefined) fills.city = city;
  if (state !== undefined) fills.state = state;
  if (zip !== undefined) fills.zip = zip;
  return {
    autocomplete: c["enable_autocomplete"] === true || c["autocomplete"] === true,
    validate:
      c["validate_full_address"] === true || c["validate_zip"] === true || c["validate"] === true,
    fills,
    normalize: c["normalize_address_line"] === true || c["normalize"] === true,
  };
}

// The address parts extracted from a Places result.
export interface LgResolvedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
}

interface AddressComponentLike {
  types?: string[];
  long_name?: string;
  short_name?: string;
}

export function extractAddressParts(components: readonly AddressComponentLike[]): LgResolvedAddress {
  const find = (type: string, short = false): string => {
    for (const component of components) {
      if (Array.isArray(component.types) && component.types.indexOf(type) !== -1) {
        const v = short ? component.short_name : component.long_name;
        if (typeof v === "string") return v;
      }
    }
    return "";
  };
  const streetNumber = find("street_number");
  const route = find("route");
  const street = `${streetNumber} ${route}`.trim();
  return {
    street,
    city: find("locality") || find("sublocality") || find("postal_town"),
    state: find("administrative_area_level_1", true),
    zip: find("postal_code"),
    formatted: "",
  };
}

export interface LgMapsHooks {
  // Beacon emitters (engine stamps section dims). P8 B1 deleted the former
  // store-only `setAnswer` member entirely: a resolved place fills the
  // VISIBLE input and lets the engine's own input listener record it (see
  // fillVisibleInput below), so nothing here can stamp an answer the visitor
  // cannot see.
  emit: (
    eventType: "address_autofill" | "address_validation_success" | "address_validation_error",
    fields: Record<string, unknown>,
  ) => void;
}

// Minimal structural typing of the Places surface we touch (the SDK is an
// EXTERNAL runtime global — never a bundled dependency, 03 §3.9).
interface PlacesAutocompleteLike {
  addListener(event: "place_changed", handler: () => void): void;
  getPlace(): {
    address_components?: AddressComponentLike[];
    formatted_address?: string;
  } | null;
}

// P8 B1 (the ROOT of "a chosen suggestion changes nothing on screen"): an
// autofilled value enters through the SAME door a keystroke does — the value
// lands in the VISIBLE input and a real `change` event tells the engine, whose
// root-level input/change listener (engine.bindListeners → handleInputEvent)
// reads the value straight off the element and does the rest (records it,
// clears that field's stale error, re-evaluates dependencies/Continue,
// persists, beacons). Before this, maps.ts wrote the STORE directly and never
// touched the DOM: the City box still showed its grey placeholder while the
// answer the buyer receives already carried Google's value — an answer the
// visitor could neither see nor correct. Because the engine reads the box, the
// stored answer can now only ever BE what is displayed, and the visitor's own
// next keystroke still wins (same path, later).
function fillVisibleInput(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// The VISIBLE input an autofill target names, or null. `[data-lg-field]` is the
// wrapper every renderer stamps with the internal_field and `[data-lg-input]`
// its control (presets.ts) — the SAME pair handleInputEvent reads back off a
// keystroke. A target with no rendered input fills NOTHING, anywhere: no box
// to show or correct it means no answer (P8 B1's "the owner's manual ZIP").
function fillTarget(root: Element, internalField: string): HTMLInputElement | null {
  let el: Element | null = null;
  try {
    el = root.querySelector('[data-lg-field="' + internalField + '"] [data-lg-input]');
  } catch {
    return null; // a field name that is not a valid selector fills nothing
  }
  return el instanceof HTMLInputElement ? el : null;
}

// P8 F4 (owner D3/A.1#6 "poorly designed with poor logic"): a genuine
// multi-field address (renderAddressFieldSet, presets.ts) renders EACH part
// as its own SIBLING [data-lg-field] box under one [data-lg-question]
// wrapper; the single full_address box carries data-lg-question AND
// data-lg-field on the SAME wrapping element with no [data-lg-field] anywhere
// inside it. Counting the DISTINCT data-lg-field values under the question
// wrapper — >1 only when true siblings render — tells composite from
// single-field structurally, with no address-naming convention assumed and
// no dependence on config.fills (which is empty whenever every sibling is
// authored mode:"manual", yet the boxes are still siblings on screen).
function isCompositeAddressField(fieldEl: Element): boolean {
  const scope = fieldEl.closest("[data-lg-question]") ?? fieldEl;
  const names = new Set<string>();
  const subfields = scope.querySelectorAll("[data-lg-field]");
  for (let i = 0; i < subfields.length; i++) {
    const name = subfields[i]?.getAttribute("data-lg-field");
    if (name !== null && name !== undefined && name !== "") names.add(name);
  }
  return names.size > 1;
}

function placesCtor(): (new (
  input: Element,
  opts: Record<string, unknown>,
) => PlacesAutocompleteLike) | null {
  const w = window as unknown as {
    google?: { maps?: { places?: { Autocomplete?: unknown } } };
  };
  const ctor = w.google?.maps?.places?.Autocomplete;
  return typeof ctor === "function"
    ? (ctor as new (input: Element, opts: Record<string, unknown>) => PlacesAutocompleteLike)
    : null;
}

// Wire every `[data-lg-maps]` field under `root`. Returns the number of
// fields wired (0 = graceful no-op: no SDK, no configs, or nothing enabled).
export function initMapsFields(root: Element, hooks: LgMapsHooks): number {
  const Autocomplete = placesCtor();
  if (Autocomplete === null) return 0; // key/SDK absent → silent no-op (E6)

  const fields = root.querySelectorAll("[data-lg-maps]");
  let wired = 0;
  for (let i = 0; i < fields.length; i++) {
    const fieldEl = fields[i];
    if (fieldEl === undefined) continue;
    const config = parseMapsConfig(fieldEl.getAttribute("data-lg-maps"));
    if (config === null || !config.autocomplete) continue;
    const input = fieldEl.querySelector("[data-lg-input]") ?? fieldEl.querySelector("input");
    if (input === null || !(input instanceof HTMLInputElement)) continue;

    const questionId = fieldEl.closest("[data-lg-question]")?.getAttribute("data-lg-question") ?? "";

    // Dedicated try/catch: a Places wiring failure must never break the
    // funnel (manual entry keeps working) nor log an error.
    try {
      const autocomplete = new Autocomplete(input, {
        types: ["address"],
        fields: ["address_components", "formatted_address"],
      });
      autocomplete.addListener("place_changed", () => {
        try {
          const place = autocomplete.getPlace();
          const components = place?.address_components;
          if (!Array.isArray(components) || components.length === 0) {
            if (config.validate) {
              hooks.emit("address_validation_error", {
                question_id: questionId,
                answer_value_normalized: "no_place_details",
              });
            }
            return;
          }
          const parts = extractAddressParts(components);
          // P8 F4 (owner D3 "auto fill only for street address and city...
          // the user will insert the Zip by himself" + A.1#6 "poorly designed
          // with poor logic"): on a genuine multi-field composite the anchor
          // IS the box labelled "Street address" sitting next to sibling
          // city/state/zip boxes — it must hold ONLY the street line, never
          // Google's full formatted address duplicated across every sibling.
          // The single full_address box (no siblings at all — one box IS the
          // whole address) is untouched: `normalize` still gates it exactly
          // as before, and stays authorable for that legacy case (a
          // composite's anchor no longer NEEDS the flag — it always resolves
          // to parts.street there — but nothing here removes the option).
          const isComposite = isCompositeAddressField(fieldEl);
          const line =
            (isComposite || config.normalize) && parts.street !== "" ? parts.street : input.value;

          // The field's own answer: the (possibly normalized) address line —
          // into the box the visitor is looking at (Places already put its own
          // text there; a normalize:true config replaces it, visibly).
          fillVisibleInput(input, line);
          // Linked autofills (08 §8.8 field pickers): ONLY the fields the
          // operator mapped, and ONLY where that field has a visible input.
          const links: Array<[string | undefined, string]> = [
            [config.fills.street, parts.street],
            [config.fills.city, parts.city],
            [config.fills.state, parts.state],
            [config.fills.zip, parts.zip],
          ];
          const filled: string[] = [];
          for (const [target, value] of links) {
            if (target === undefined || target === "" || value === "") continue;
            const el = fillTarget(root, target);
            if (el === null) continue; // nothing on screen ⇒ nothing recorded
            fillVisibleInput(el, value);
            filled.push(target);
          }
          hooks.emit("address_autofill", {
            question_id: questionId,
            answer_value_normalized: filled.join(","),
          });
          if (config.validate) {
            const complete = parts.zip !== "" && parts.state !== "" && parts.city !== "";
            hooks.emit(
              complete ? "address_validation_success" : "address_validation_error",
              {
                question_id: questionId,
                answer_value_normalized: complete ? "ok" : "incomplete_address",
              },
            );
          }
        } catch {
          /* place handling is best-effort; manual entry unaffected */
        }
      });
      wired += 1;
    } catch {
      /* wiring failure → this field stays manual-entry */
    }
  }
  return wired;
}

// ---------------------------------------------------------------------------
// SDK loader (E6 — 03 §3.2d / 08 §8.8): the ENGINE loads the Maps JS itself.
// ---------------------------------------------------------------------------

// The global callback name the SDK URL's `callback=` names — the SDK invokes
// it once Places is ready (`loading=async` recommends the callback form; a
// script `load` listener rides as the belt-and-braces fallback).
export const LG_MAPS_CALLBACK = "__LG_MAPS_ON_READY__";
const LG_MAPS_READY_QUEUE = "__LG_MAPS_READY_QUEUE__";
const LG_MAPS_SDK_ATTR = "data-lg-maps-sdk";

export function mapsSdkSrc(key: string): string {
  return (
    "https://maps.googleapis.com/maps/api/js?key=" +
    encodeURIComponent(key) +
    "&libraries=places&loading=async&callback=" +
    LG_MAPS_CALLBACK
  );
}

export type LgMapsSdkOutcome = "no_key" | "no_fields" | "already_loaded" | "pending" | "injected";

// P8 defect contract B1/R1-1: whether at least one `[data-lg-maps]` field
// under `root` parses to a RUNNABLE browser job. `autocomplete` is the ONLY
// leg initMapsFields ever wires (its own `if (config === null ||
// !config.autocomplete) continue;` skip above) — a field whose config has
// `validate:true` but `autocomplete:false` never gets an Autocomplete
// instance, so `validate` alone has zero browser-side effect and is not
// "runnable" on its own. Before this fix, maybeInjectMapsSdk injected the SDK
// whenever a `[data-lg-maps]` ATTRIBUTE existed at all, regardless of what it
// parsed to — every address funnel paid for a wasted Maps JS load even when
// every field's parsed config carried autocomplete:false. Exported for the
// B1 regression spec (test/leadgen-p8-b1-maps-shape.test.ts).
export function mapsFieldsNeedSdk(root: Element): boolean {
  const fields = root.querySelectorAll("[data-lg-maps]");
  for (let i = 0; i < fields.length; i++) {
    const config = parseMapsConfig(fields[i]?.getAttribute("data-lg-maps") ?? null);
    if (config !== null && config.autocomplete) return true;
  }
  return false;
}

// Inject the Maps SDK script when (a) the shell spliced a browser key global
// and (b) at least one `[data-lg-maps]` field parses to a runnable job
// (mapsFieldsNeedSdk) — then run `onReady` once Places is available.
// Key-missing (or any failure) is a CONSOLE-ERROR-FREE no-op: no script tag,
// no throw, manual entry keeps working (08 §8.8). Idempotent: a second call
// while the script is in flight chains onto the same ready queue — never a
// second tag.
export function maybeInjectMapsSdk(root: Element, onReady: () => void): LgMapsSdkOutcome {
  try {
    const w = window as unknown as Record<string, unknown>;
    const key = w["__LG_MAPS_KEY__"];
    if (typeof key !== "string" || key === "") return "no_key";
    if (!mapsFieldsNeedSdk(root)) return "no_fields";
    if (placesCtor() !== null) {
      onReady();
      return "already_loaded";
    }
    // An injection is already in flight → chain (exactly one script tag).
    const inFlight = w[LG_MAPS_READY_QUEUE];
    if (Array.isArray(inFlight)) {
      inFlight.push(onReady);
      return "pending";
    }
    const queue: Array<() => void> = [onReady];
    w[LG_MAPS_READY_QUEUE] = queue;
    const fire = (): void => {
      // `load` can fire before Places finishes async-initializing; the SDK
      // callback then fires the queue. Guarded + splice ⇒ ready runs ONCE.
      if (placesCtor() === null) return;
      for (const fn of queue.splice(0, queue.length)) {
        try {
          fn();
        } catch {
          /* field wiring is best-effort */
        }
      }
    };
    w[LG_MAPS_CALLBACK] = fire;
    const doc = root.ownerDocument ?? document;
    const script = doc.createElement("script");
    script.async = true;
    script.setAttribute(LG_MAPS_SDK_ATTR, "1");
    script.src = mapsSdkSrc(key);
    try {
      script.addEventListener("load", fire);
      script.addEventListener("error", () => {
        /* SDK load failure → silent manual-entry fallback (no console) */
      });
    } catch {
      /* listener wiring best-effort — the callback param still fires */
    }
    (doc.head ?? doc.documentElement ?? doc.body)?.appendChild(script);
    return "injected";
  } catch {
    return "no_key"; // any unexpected failure degrades to the silent no-op
  }
}

// The engine's entry point (03 §3.5.1): wire whatever is present NOW, and —
// when the SDK is absent but the key + at least one [data-lg-maps] field are
// present — inject the SDK and re-run the wiring once it is ready.
export function wireMapsFields(root: Element, hooks: LgMapsHooks): number {
  const wired = initMapsFields(root, hooks);
  try {
    if (placesCtor() === null) {
      maybeInjectMapsSdk(root, () => {
        initMapsFields(root, hooks);
      });
    }
  } catch {
    /* loader is best-effort; manual entry unaffected */
  }
  return wired;
}
