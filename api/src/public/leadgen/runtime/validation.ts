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
  const type = `${component.type} ${component.answer_type ?? ""}`.toLowerCase();
  if (type.indexOf("email") !== -1) return "email";
  if (type.indexOf("phone") !== -1 || type.indexOf("tel") !== -1) return "phone";
  if (type.indexOf("zip") !== -1 || type.indexOf("postal") !== -1) return "zip";
  return null;
}

// PC-5/PC-A5 (P4b): a date-input component. Its config carries RESOLVED ISO
// min/max (config-dto resolved any dynamic token server-side), so the client
// gate is a pure lexical ISO compare — no token grammar ships in the bundle.
function isDateComponent(component: LgComponentConfig): boolean {
  return `${component.type} ${component.answer_type ?? ""}`.toLowerCase().indexOf("date") !== -1;
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

function checkFormat(kind: LgFormatKind, value: unknown, out: LgValidationFailure[]): void {
  if (kind === null) return;
  if (typeof value !== "string" || value === "") return; // emptiness is `required`'s job
  if (kind === "email" && !EMAIL_RE.test(value.trim())) {
    out.push({ code: "email_format", message: "Enter a valid email address." });
  } else if (kind === "phone") {
    if (normalizePhoneE164(value) === null) {
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
    if (required) out.push({ code: "required", message: "This field is required." });
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

  checkFormat(formatKindFor(component), value, out);
  // E1-C1: swap in the authored copy for every value-wrong failure collected
  // above (required already returned; only "wrong value" codes remain here).
  if (errText !== undefined) {
    for (const failure of out) failure.message = errText;
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
    const field = component.internal_field;
    if (field === undefined || field === "") continue;
    const failures = validateValue(component, answers[field], vis.required_now);
    for (const failure of failures) {
      out.push({ ...failure, question_id: component.question_id, internal_field: field });
    }
  }
  return out;
}
