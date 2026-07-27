// LeadGen Rework — shared, PURE rule-checkpoint derivation (§4.3-3).
//
// A quote-scoped routing rule (leadgen_quote_routing_rules) evaluates at a
// PLANE that is DERIVED from its condition fields, never authored:
//   (a) EVERY condition field is entry-known (utm/device/os/state/hour/weekday)
//       → ENTRY plane, evaluated at /lg/attempt.
//   (b) every ANSWER field (the non-entry-known condition fields) is collected
//       by the quote's SHARED first page → SHARED checkpoint, evaluated at the
//       existing /lg/ck after the shared page.
//   (c) any answer field is collected ONLY inside funnels → IN-FUNNEL checkpoint,
//       at the EARLIEST page (of a funnel that collects them all) where every
//       such field is known; UNREACHABLE when NO funnel collects them all.
//
// This module is the ONE derivation both the runtime evaluator (resolver.ts)
// and the admin builder (quotes-handlers.ts, read-only) share — so the
// builder's read-only "Entry / Shared page / In funnel X — page N" label and
// the runtime's plane partition can never diverge. Pure: no I/O, no DB; the
// CALLER supplies the field universes (built from the ONE component expander).
//
// No import from resolver.ts (which imports THIS module) — the entry-known set
// is defined here to keep the dependency edge one-directional.

// The entry-known ROUTING field universe (§4.3-3a): utm_source/utm_medium/
// utm_content + the utm_campaign alias / device / state / hour / weekday,
// UNION the M10 `os` dimension. §10/S5.1: resolver.ts's OWN parallel
// ROUTING_ENTRY_KNOWN_FIELDS (the pre-M3, non-os-inclusive per-variant
// registry) was removed — it had zero live consumers left once the
// route_funnel_variant evaluation chain it fed was deleted. This set (defined
// here, not imported, per the one-directional dependency edge above) is now
// the ONLY entry-known field registry in the leadgen namespace.
export const OS_ROUTING_FIELD = "os";

export const ENTRY_KNOWN_ROUTING_FIELDS: ReadonlySet<string> = new Set([
  "state",
  "device",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_campaign", // documented alias of utm_content (resolver.ts entryFlatCtx)
  "hour",
  "weekday",
  OS_ROUTING_FIELD, // M10
]);

export type RuleCheckpointPlane = "entry" | "shared" | "in_funnel";

// One funnel's page field universe, in page order. `fields` is the set of
// internal answer fields a page collects (built by the caller from the ONE
// component expander over each page's candidate sections).
export interface RuleCheckpointFunnel {
  id: number;
  publicId: string;
  name: string | null;
  pages: readonly { position: number; fields: ReadonlySet<string> }[];
}

// The derived checkpoint of ONE rule (§4.3-3). `funnelId`/`funnelPublicId`/
// `funnelName`/`pagePosition` are set ONLY on the `in_funnel` plane (the
// representative earliest funnel+page a builder renders as "In funnel X — page
// N"). `unreachable` is set (with plane 'in_funnel') when a class-(c) rule
// names answer fields NO funnel collects — the Appendix A-6 warning.
export interface RuleCheckpoint {
  plane: RuleCheckpointPlane;
  funnelId?: number;
  funnelPublicId?: string;
  funnelName?: string | null;
  pagePosition?: number;
  unreachable?: boolean;
}

// The earliest page position (in a single funnel) at which EVERY field in
// `fields` is known — i.e. the MAX over each field of the FIRST page that
// collects it. Returns null when the funnel does not collect every field.
function earliestPageKnowingAll(
  funnel: RuleCheckpointFunnel,
  fields: readonly string[],
): number | null {
  let maxFirstPage = -Infinity;
  for (const field of fields) {
    let firstPage: number | null = null;
    for (const page of funnel.pages) {
      if (page.fields.has(field)) {
        firstPage = page.position;
        break; // pages are supplied in position order; the FIRST match is earliest
      }
    }
    if (firstPage === null) return null; // this funnel never collects `field`
    if (firstPage > maxFirstPage) maxFirstPage = firstPage;
  }
  return maxFirstPage === -Infinity ? null : maxFirstPage;
}

// Derive one rule's checkpoint plane (§4.3-3). PURE.
//   * conditionFields  — the rule's condition field names (any order; dupes ok).
//   * sharedPageFields — the answer fields the quote's shared first page collects.
//   * funnels          — every funnel's per-page field universe, funnels in
//                        board (display_order) order so the "representative"
//                        in-funnel result is deterministic.
export function deriveRuleCheckpoint(
  conditionFields: readonly string[],
  sharedPageFields: ReadonlySet<string>,
  funnels: readonly RuleCheckpointFunnel[],
): RuleCheckpoint {
  // ENTRY (a): every condition field is entry-known → no answer field at all.
  const answerFields = conditionFields.filter((f) => !ENTRY_KNOWN_ROUTING_FIELDS.has(f));
  if (answerFields.length === 0) return { plane: "entry" };

  // SHARED (b): every answer field is collected by the shared page.
  if (answerFields.every((f) => sharedPageFields.has(f))) return { plane: "shared" };

  // IN-FUNNEL (c): at least one answer field is collected only inside funnels.
  // The rule can fire once the CURRENT funnel has collected every answer field
  // that is NOT already known from the shared page (shared answer fields are
  // known before the funnel starts). The representative checkpoint = the first
  // funnel (board order) that collects them all, at its earliest all-known page.
  const funnelOnlyFields = answerFields.filter((f) => !sharedPageFields.has(f));
  for (const funnel of funnels) {
    const page = earliestPageKnowingAll(funnel, funnelOnlyFields);
    if (page !== null) {
      return {
        plane: "in_funnel",
        funnelId: funnel.id,
        funnelPublicId: funnel.publicId,
        funnelName: funnel.name,
        pagePosition: page,
      };
    }
  }
  // No funnel collects every funnel-only field → the rule can never apply
  // (Appendix A-6 unreachable warning).
  return { plane: "in_funnel", unreachable: true };
}

// Convenience predicate the runtime entry/checkpoint partition shares: a rule
// is ENTRY-plane iff every condition field is entry-known (os-inclusive). A
// rule with NO condition fields (catch-all) is entry-plane (matches all entry
// traffic — a useful lowest-priority default route).
export function isEntryPlane(conditionFields: readonly string[]): boolean {
  return conditionFields.every((f) => ENTRY_KNOWN_ROUTING_FIELDS.has(f));
}
