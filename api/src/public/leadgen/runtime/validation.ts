// LeadGen runtime — client validation (fix-contract v2.4 03 §3.2
// validation.ts row).
//
// DOM-FREE + pure: mirrors the `client_validation` rules the config DTO
// serializes (config-dto.ts buildClientValidation — required, valid_values,
// min/max/step, minLength/maxLength, pattern) plus the format checks for the
// email/phone/ZIP input component types (03 §3.2). The engine consumes the
// typed failures to block Continue and fire one `validation_error` beacon per
// failing field (§3.5.4).
//
// ZIP format mirrors the server's validateZip (leadgen/maps.ts: /^\d{5}$/).
// Email/phone are pragmatic client-side formats (the server/provider mapping
// remains the source of truth for payload validity — 05).

import type { LgComponentConfig } from "./state";
import { isAnswered } from "./dependencies";

export type LgValidationCode =
  | "required"
  | "invalid_value"
  | "min"
  | "max"
  | "min_count"
  | "max_count"
  | "step"
  | "min_length"
  | "max_length"
  | "pattern"
  | "email_format"
  | "phone_format"
  | "zip_format";

export interface LgValidationFailure {
  code: LgValidationCode;
  message: string;
}

export interface LgSectionValidationFailure extends LgValidationFailure {
  question_id: string;
  internal_field: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Server parity (leadgen/maps.ts ZIP_RE): exactly 5 digits.
const ZIP_RE = /^\d{5}$/;
// Shared "empty required field" copy — one literal, two emit sites
// (validateValue + validateSection group-required); byte-identical to before.
const REQUIRED_MSG = "This field is required.";

// The lowercased "type answer_type" token both format detectors match on —
// one template literal instead of two identical inline copies.
function typeToken(component: LgComponentConfig): string {
  return `${component.type} ${component.answer_type ?? ""}`.toLowerCase();
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ruleNumber(cv: Record<string, unknown>, key: string): number | null {
  const v = cv[key];
  return v === undefined || v === null ? null : asFiniteNumber(v);
}

// Format family from the component/answer type names (catalog vocabulary,
// 08 §8.2: EmailInputQuestion / PhoneInputQuestion / ZIPInputQuestion /
// AddressAutocompleteQuestion — matched case-insensitively on the token so a
// future rename like `email_input` still binds).
export type LgFormatKind = "email" | "phone" | "zip" | null;

export function formatKindFor(component: LgComponentConfig): LgFormatKind {
  const type = typeToken(component);
  if (type.indexOf("email") !== -1) return "email";
  if (type.indexOf("phone") !== -1 || type.indexOf("tel") !== -1) return "phone";
  if (type.indexOf("zip") !== -1 || type.indexOf("postal") !== -1) return "zip";
  return null;
}

// PC-5/PC-A5 (P4b): a date-input component. Its config carries RESOLVED ISO
// min/max (config-dto resolved any dynamic token server-side), so the client
// gate is a pure lexical ISO compare — no token grammar ships in the bundle.
function isDateComponent(component: LgComponentConfig): boolean {
  return typeToken(component).indexOf("date") !== -1;
}

// PC-A2 (P4b): the sub-field internal_fields a multi-subfield group contributes
// to the answer space (mirrors the server's answers.ts fieldsOf) — or null for
// a normal single-field component. NameFieldsGroup + AddressAutocomplete carry
// NO single internal_field; each expands to its configured sub-fields (defaults
// first/last and street/city/state/zip). Read from `props` (config-dto copies
// it through). P4d adds per-sub-field props; this reads the CURRENT shape only.
export function groupSubfields(component: LgComponentConfig): string[] | null {
  const props = (component.props ?? {}) as Record<string, unknown>;
  if (component.type === "NameFieldsGroup") {
    const f = props["fields"];
    return Array.isArray(f) && f.length > 0 ? f.map(String) : ["first", "last"];
  }
  if (component.type === "AddressAutocompleteQuestion") {
    const f = props["internal_fields"];
    return Array.isArray(f) && f.length > 0 ? f.map(String) : ["street", "city", "state", "zip"];
  }
  return null;
}

// LeadGen Rework §6.10/M9 — the answer-store base an Address records its
// sub-fields under: internal_field ?? question_id ?? "address" (the SAME
// fallback ladder presets.ts renderAddressFieldSet uses for `addrBase`).
function addressBase(component: LgComponentConfig): string {
  const f = component.internal_field;
  if (typeof f === "string" && f.trim() !== "") return f.trim();
  return component.question_id !== "" ? component.question_id : "address";
}

// §6.10/M9 — the answer key ONE address field spec records under, derived the
// EXACT way the recorder does (presets.ts m9AddressFieldName): props.maps.fills
// .<kind> override, else `{base}_{kind}`; a `full_address` field records under
// the base itself ("full_address = the base field"). This is why the validator
// must read the COMPILED config (internal_field/question_id + props.maps.fills),
// NOT props.internal_fields — the M9 studio writes props.fields[] and never
// props.internal_fields, so the old groupSubfields-positional read always keyed
// the wrong store slot and every required/zip5 check on an authored address
// failed no matter what the visitor typed.
function addressFieldKey(component: LgComponentConfig, kind: string): string {
  if (kind === "full_address") return addressBase(component);
  const maps = (component.props ?? {})["maps"];
  const fills = isRecord(maps) ? maps["fills"] : undefined;
  const override = isRecord(fills) ? fills[kind] : undefined;
  return typeof override === "string" && override.trim() !== ""
    ? override.trim()
    : `${addressBase(component)}_${kind}`;
}

// PC-A4 (P4b) — NANP structural phone validation + E.164 normalization.
//
// Returns the E.164 form (`+1` + 10 digits) for a valid US/Canada number, or
// null. Strips all formatting; accepts 10 significant digits, or 11 with a
// leading country-code `1`. NANP requires BOTH the area code and the exchange
// (central-office) code to begin 2–9 — so the old strip-and-count 7..15 check's
// false-accepts are now correctly rejected: "1111111111" has area code 111
// (first digit 1) → invalid, and a 14-digit blob is not 10/11 digits → invalid.
// A valid number like "(415) 555-1234" → "+14155551234".
export function normalizePhoneE164(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  // strip a leading country-code 1 on an 11-digit number
  if (digits.length === 11 && digits.charCodeAt(0) === 49 /* "1" */) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  const area = digits.charCodeAt(0); // NANP: area code first digit 2–9
  const exch = digits.charCodeAt(3); // NANP: exchange code first digit 2–9
  if (area < 50 || area > 57) return null; // "2".."9"
  if (exch < 50 || exch > 57) return null; // "2".."9"
  return "+1" + digits;
}

function checkFormat(
  kind: LgFormatKind,
  value: unknown,
  out: LgValidationFailure[],
  cv: Record<string, unknown>,
): void {
  if (kind === null) return;
  if (typeof value !== "string" || value === "") return; // emptiness is `required`'s job
  if (kind === "email" && !EMAIL_RE.test(value.trim())) {
    out.push({ code: "email_format", message: "Enter a valid email address." });
  } else if (kind === "phone") {
    // Round-4 A-6b: the compiled phone contract (config-dto buildPhoneContract →
    // client_validation.phone) drives a GENERIC checker — strip per `normalize`,
    // test the compiled `regex`, emit the compiled `message`. When NO contract
    // is present (legacy config, no phone_format) the behavior is BYTE-FOR-BYTE
    // the NANP default (normalizePhoneE164 — still the engine's answer-normalizer
    // + the frozen p4b pin). A bad compiled regex degrades to "no rule" (never a
    // runtime throw), the same defensive idiom as the authored `pattern` rule.
    // config-dto guarantees `regex`/`normalize`/`message` are non-empty strings
    // on every emitted contract, so the cast is safe (a corrupt non-object /
    // primitive falls through to the NANP default; a bad regex is caught below).
    const c = cv["phone"] as { regex: string; normalize: string; message: string } | undefined;
    if (c && typeof c === "object") {
      // Review-round (MAJOR-1, defense-in-depth): patterns are pre-screened at
      // save (content-schema isCatastrophicRegexShape); this is a cheap floor
      // for legacy/pre-fix-stored contracts — no phone ever needs 40+ chars.
      // Gating regex work behind it (not just gating the push) keeps a bad
      // legacy contract from ever running .test() on an over-long value.
      let ok = value.length <= 40;
      if (ok) {
        const stripped =
          c.normalize === "e164"
            ? value.replace(/[^\d+]/g, "")
            : c.normalize === "none"
              ? value.trim()
              : value.replace(/\D/g, "");
        try {
          ok = new RegExp(c.regex).test(stripped);
        } catch {
          ok = true;
        }
      }
      if (!ok) out.push({ code: "phone_format", message: c.message });
    } else if (normalizePhoneE164(value) === null) {
      out.push({ code: "phone_format", message: "Enter a valid US phone number." });
    }
  } else if (kind === "zip" && !ZIP_RE.test(value.trim())) {
    out.push({ code: "zip_format", message: "Enter a valid 5-digit ZIP code." });
  }
}

// Membership over the enum domain: scalars must be a member; a multi-select
// array requires EVERY item to be a member. Comparison is `String(candidate)
// === String(member)` — the DOM round-trips values through attributes, so a
// numeric choice arriving as its string form still validates (the store keeps
// the typed value; validation is deliberately tolerant here).
function inDomain(value: unknown, domain: unknown[]): boolean {
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    let found = false;
    for (const member of domain) {
      if (item === member || String(item) === String(member)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

// Validate one component's current value against its client_validation rules
// + format family. `requiredNow` is the dependency-effective requirement the
// caller computed (dependencies.evaluateComponents) — it overrides the static
// `required` rule so "required only when shown/when X" behaves.
export function validateValue(
  component: LgComponentConfig,
  value: unknown,
  requiredNow: boolean,
): LgValidationFailure[] {
  const out: LgValidationFailure[] = [];
  const cv: Record<string, unknown> = component.client_validation ?? {};
  // E1-C1: the authored error_text (config-dto projects it into
  // client_validation) overrides the generic per-rule copy on any "value is
  // wrong" failure. Applied ONCE at the end — the empty/required branch returns
  // before it, so required's own copy is deliberately never overridden.
  const et = cv["error_text"];
  const errText = typeof et === "string" && et !== "" ? et : undefined;

  const required = requiredNow || cv["required"] === true || component.required === true;
  if (!isAnswered(value)) {
    if (required) out.push({ code: "required", message: REQUIRED_MSG });
    return out; // nothing else to validate on an empty answer
  }

  const domain = Array.isArray(cv["valid_values"])
    ? (cv["valid_values"] as unknown[])
    : Array.isArray(component.valid_values)
      ? (component.valid_values as unknown[])
      : null;
  if (domain !== null && domain.length > 0 && !inDomain(value, domain)) {
    out.push({ code: "invalid_value", message: "Choose one of the offered options." });
  }

  const min = ruleNumber(cv, "min");
  const max = ruleNumber(cv, "max");
  const step = ruleNumber(cv, "step");
  if (min !== null || max !== null || step !== null) {
    if (Array.isArray(value)) {
      // E1-NEW-3: min/max on an ARRAY answer (MultiChoice selection) validate
      // the selection COUNT — the scalar leg below skips arrays
      // (asFiniteNumber(array) === null), so multi-select count limits were
      // enforced NOWHERE before this. `step` is meaningless for a count.
      const count = value.length;
      if (min !== null && count < min) {
        out.push({ code: "min_count", message: `Select at least ${min} options.` });
      }
      if (max !== null && count > max) {
        out.push({ code: "max_count", message: `Select at most ${max} options.` });
      }
    } else {
      const n = asFiniteNumber(value);
      if (n !== null) {
        if (min !== null && n < min) {
          out.push({ code: "min", message: `Enter a value of at least ${min}.` });
        }
        if (max !== null && n > max) {
          out.push({ code: "max", message: `Enter a value of at most ${max}.` });
        }
        if (step !== null && step > 0) {
          const base = min !== null ? min : 0;
          const ratio = (n - base) / step;
          if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
            // PC-A3/PC-7 (P4b): the old "Use steps of 5." told the visitor
            // NOTHING actionable (the operator's "terrible" — e.g. 502 with
            // min=1,step=5). Compute the two nearest ON-GRID neighbors, clamped
            // to any authored min/max, and name them.
            const fix = (v: number): number => Math.round(v * 1e6) / 1e6;
            const low = fix(base + Math.floor((n - base) / step) * step);
            const high = fix(low + step);
            const ok = (v: number): boolean =>
              (min === null || v >= min) && (max === null || v <= max);
            const opts = [low, high].filter(ok);
            out.push({
              code: "step",
              message:
                opts.length > 0
                  ? `Nearest valid ${opts.length > 1 ? "values" : "value"}: ${opts.join(" and ")}.`
                  : `Use steps of ${step}.`,
            });
          }
        }
      } else if (typeof value === "string" || typeof value === "number") {
        // A numeric rule on a non-numeric answer is itself a failure.
        out.push({ code: "invalid_value", message: "Enter a number." });
      }
    }
  }

  if (typeof value === "string") {
    const minLength = ruleNumber(cv, "minLength");
    const maxLength = ruleNumber(cv, "maxLength");
    if (minLength !== null && value.length < minLength) {
      out.push({ code: "min_length", message: `Enter at least ${minLength} characters.` });
    }
    if (maxLength !== null && value.length > maxLength) {
      out.push({ code: "max_length", message: `Enter at most ${maxLength} characters.` });
    }
    const pattern = cv["pattern"];
    if (typeof pattern === "string" && pattern !== "") {
      // Dedicated try/catch: an unparseable authored pattern must never throw
      // at runtime — it degrades to "no pattern rule".
      try {
        if (!new RegExp(pattern).test(value)) {
          out.push({ code: "pattern", message: "The value has an invalid format." });
        }
      } catch {
        /* invalid authored regex → rule skipped */
      }
    }
  }

  // PC-5/PC-A5 date range: a lexical ISO compare (YYYY-MM-DD sorts
  // chronologically). cv.min/max are the RESOLVED ISO bounds (config-dto). The
  // numeric block above never fires for these (Number("2026-08-01") is NaN), so
  // this is the ONLY min/max leg for a date field. Clear "on or after/before"
  // copy naming the concrete resolved date.
  if (isDateComponent(component) && typeof value === "string" && value !== "") {
    const dmin = typeof cv["min"] === "string" ? (cv["min"] as string) : null;
    const dmax = typeof cv["max"] === "string" ? (cv["max"] as string) : null;
    if (dmin !== null && value < dmin) {
      out.push({ code: "min", message: `Pick a date on or after ${dmin}.` });
    }
    if (dmax !== null && value > dmax) {
      out.push({ code: "max", message: `Pick a date on or before ${dmax}.` });
    }
  }

  checkFormat(formatKindFor(component), value, out, cv);
  // E1-C1: swap in the authored copy for every value-wrong failure collected
  // above (required already returned; only "wrong value" codes remain here).
  if (errText !== undefined) {
    for (const failure of out) failure.message = errText;
  }
  return out;
}

// LeadGen Rework — narrow object guard (props / validation specs arrive as
// untyped JSON; kept local to this DOM-free module, no server import).
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// §6.8: a from_to / dual_range slider records TWO number sub-fields
// {base}_min / {base}_max (answers.ts fieldsOf M7 — the field universe), so
// validateSection cannot gate it through the scalar validateValue(answers[base])
// path (base itself is never recorded). base = the component's internal_field;
// single / stepper / radial keep the scalar path. Returns [minField, maxField]
// or null.
function dualSliderFields(component: LgComponentConfig): [string, string] | null {
  const st = (component.props ?? {})["slider_type"];
  const base = component.internal_field;
  if (
    component.type === "NumberRangeQuestion" &&
    (st === "dual_range" || st === "from_to") &&
    typeof base === "string" &&
    base !== ""
  ) {
    return [`${base}_min`, `${base}_max`];
  }
  return null;
}

// §6.10: one address field's own rule — required first, then the format rule
// (none / zip5 / {regex,message}). A bad custom regex degrades to "no rule"
// (never a runtime throw), the same defensive idiom validateValue's pattern leg
// uses. The 200-char floor gates the REGEX WORK ONLY — .test() never runs on
// an over-long value, so a hostile authored pattern can never backtrack over
// unbounded visitor input (ReDoS defense, the phone leg's own ≤40-char floor
// above uses the same idiom).
//
// P8-5 G5 fix — MEASURED (tsx, real validateSection, no mocks): the pre-fix
// version skipped the WHOLE branch past 200 chars, so a 201-char answer
// against a digits-only custom rule cleared with ZERO failures (a 200-char
// answer, and a 150-char answer, both correctly failed). That's a silent
// PASS, not a safety trade-off — the phone leg this claimed to "mirror"
// actually fails CLOSED past its own floor (`ok` starts false, only flips
// true on a passing test — see checkFormat's phone branch). This now does
// the same: the regex still never runs past 200 chars, but over-length is a
// real "too long" failure, never a silent accept.
function validateAddressField(
  spec: Record<string, unknown>,
  value: unknown,
): LgValidationFailure[] {
  const out: LgValidationFailure[] = [];
  if (!isAnswered(value)) {
    if (spec["required"] === true) out.push({ code: "required", message: REQUIRED_MSG });
    return out;
  }
  const text = typeof value === "string" ? value : String(value);
  const validation = spec["validation"];
  if (validation === "zip5") {
    if (!ZIP_RE.test(text.trim())) {
      out.push({ code: "zip_format", message: "Enter a valid 5-digit ZIP code." });
    }
  } else if (isRecord(validation)) {
    const regex = validation["regex"];
    if (typeof regex === "string" && regex !== "") {
      if (text.length > 200) {
        out.push({ code: "max_length", message: "Enter at most 200 characters." });
      } else {
        try {
          if (!new RegExp(regex).test(text)) {
            const message = validation["message"];
            out.push({
              code: "pattern",
              message:
                typeof message === "string" && message !== ""
                  ? message
                  : "The value has an invalid format.",
            });
          }
        } catch {
          /* unparseable authored regex → rule skipped */
        }
      }
    }
  }
  return out;
}

// Validate the VISIBLE components of one section (§3.5.4): the caller passes
// the dependency state so hidden components are never validated and
// required-now semantics apply. Returns one failure list entry per failing
// field (first failure per component wins for the inline message; all codes
// ride the beacon).
export function validateSection(
  components: readonly LgComponentConfig[],
  answers: Readonly<Record<string, unknown>>,
  visibility: readonly { question_id: string; visible: boolean; required_now: boolean }[],
): LgSectionValidationFailure[] {
  const out: LgSectionValidationFailure[] = [];
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const vis = visibility[i];
    if (component === undefined || vis === undefined) continue;
    if (!vis.visible) continue;

    // LeadGen Rework §6.10: an Address with authored props.fields[] validates
    // PER FIELD — each spec's answer key is derived from its OWN `field` kind
    // via addressFieldKey (props.maps.fills override else `{base}_{kind}`;
    // full_address ⇒ the base), the SAME derivation presets.ts m9AddressFieldName
    // records under and answers.ts fieldsOf mirrors — so required/zip5 gate the
    // real stored value. (The old positional groupSubfields read keyed
    // props.internal_fields, which the M9 studio never writes ⇒ every authored
    // address failed required regardless of input.) Each field carries its own
    // required + format rule; a hidden component is already skipped above.
    // Absent props.fields ⇒ the pre-M9 whole-group required check (below).
    if (component.type === "AddressAutocompleteQuestion") {
      const specs = (component.props ?? {})["fields"];
      if (Array.isArray(specs)) {
        for (const spec of specs) {
          if (!isRecord(spec)) continue;
          const kind = spec["field"];
          if (typeof kind !== "string") continue;
          const key = addressFieldKey(component, kind);
          for (const failure of validateAddressField(spec, answers[key])) {
            out.push({ ...failure, question_id: component.question_id, internal_field: key });
          }
        }
        continue;
      }
    }

    // LeadGen Rework §6.8: from_to / dual_range bounds — min ≤ from ≤ to ≤ max,
    // both required when the node is required. Recorded under {base}_min /
    // {base}_max (fieldsOf M7); the scalar validateValue path never sees them.
    const dual = dualSliderFields(component);
    if (dual !== null) {
      const cvRec = (component.client_validation ?? {}) as Record<string, unknown>;
      const required =
        vis.required_now || cvRec["required"] === true || component.required === true;
      const lo = answers[dual[0]];
      const hi = answers[dual[1]];
      if (required && (!isAnswered(lo) || !isAnswered(hi))) {
        out.push({
          code: "required",
          message: REQUIRED_MSG,
          question_id: component.question_id,
          internal_field: dual[0],
        });
      } else {
        const loNum = asFiniteNumber(lo);
        const hiNum = asFiniteNumber(hi);
        if (loNum !== null && hiNum !== null) {
          const min = ruleNumber(cvRec, "min");
          const max = ruleNumber(cvRec, "max");
          if (min !== null && loNum < min) {
            out.push({ code: "min", message: `Enter a value of at least ${min}.`, question_id: component.question_id, internal_field: dual[0] });
          }
          if (max !== null && hiNum > max) {
            out.push({ code: "max", message: `Enter a value of at most ${max}.`, question_id: component.question_id, internal_field: dual[1] });
          }
          if (loNum > hiNum) {
            out.push({ code: "invalid_value", message: "The first number must be less than or equal to the second.", question_id: component.question_id, internal_field: dual[0] });
          }
        }
      }
      continue;
    }

    const field = component.internal_field;
    if (field === undefined || field === "") {
      // PC-A2 (P4b): a multi-subfield group (NameFieldsGroup/Address) has no
      // single internal_field, so validateValue can't see it — it was skipped
      // entirely before. Enforce `required` across its sub-fields here: the
      // group is answered iff EVERY sub-field value is present. The failure is
      // keyed to the group's question_id (its error slot's data-lg-error-for),
      // so setFieldError paints the group-level message.
      const subs = groupSubfields(component);
      if (subs !== null) {
        const required =
          vis.required_now ||
          (component.client_validation as Record<string, unknown> | undefined)?.["required"] === true ||
          component.required === true;
        if (required && subs.some((f) => !isAnswered(answers[f]))) {
          out.push({
            code: "required",
            message: REQUIRED_MSG,
            question_id: component.question_id,
            internal_field: component.question_id,
          });
        }
      }
      continue;
    }
    const failures = validateValue(component, answers[field], vis.required_now);
    for (const failure of failures) {
      out.push({ ...failure, question_id: component.question_id, internal_field: field });
    }
  }
  return out;
}
