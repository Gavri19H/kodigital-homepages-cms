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

function checkFormat(kind: LgFormatKind, value: unknown, out: LgValidationFailure[]): void {
  if (kind === null) return;
  if (typeof value !== "string" || value === "") return; // emptiness is `required`'s job
  if (kind === "email" && !EMAIL_RE.test(value.trim())) {
    out.push({ code: "email_format", message: "Enter a valid email address." });
  } else if (kind === "phone") {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      out.push({ code: "phone_format", message: "Enter a valid phone number." });
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
          out.push({ code: "step", message: `Use steps of ${step}.` });
        }
      }
    } else if (typeof value === "string" || typeof value === "number") {
      // A numeric rule on a non-numeric answer is itself a failure.
      out.push({ code: "invalid_value", message: "Enter a number." });
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

  checkFormat(formatKindFor(component), value, out);
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
