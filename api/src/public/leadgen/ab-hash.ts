// LeadGen Funnel A/B — deterministic allocation + assignment engine (contract
// 06 §16.2). PURE: a total function of exactly (abTestPublicId, revision,
// sessionId, variants) so the edge and any future client twin compute the
// IDENTICAL assignment. No I/O; Stage-B wires it into the resolver + config DTO.
//
// This is NOT the listicles FNV-1a hash. §16.2 mandates SHA-256 over the
// COLON-joined triple `${funnel_ab_test_id}:${funnel_ab_test_revision}:
// ${session_id}`, the FIRST 4 digest bytes read as a big-endian uint32, then
// `% 10000` → a bucket in 0..9999. Then: sort variants by `variant_label`,
// accumulate `traffic_allocation_bp`, and pick the FIRST variant whose
// cumulative upper bound is STRICTLY GREATER than the bucket.
//
// `funnel_ab_test_revision` is load-bearing in the hash input: changing the
// allocations or the variant set bumps the revision, which cleanly re-buckets
// every session into a FRESH, independent assignment without polluting the
// prior comparison.

import { sha256Hex } from "./auction/parse";

// ---------------------------------------------------------------------------
// §16.2 bucket
// ---------------------------------------------------------------------------

// `sha256Hex` renders the digest as 8 uint32 words, each `.toString(16)`
// zero-padded to 8 hex chars and concatenated big-endian (most-significant
// nibble first). Therefore the FIRST 8 hex chars are exactly the first digest
// word — i.e. the first 4 digest BYTES serialized big-endian. `parseInt(hex8,
// 16)` reconstructs that word as a JS number in 0..2^32-1 (≤ 4294967295, well
// inside Number.MAX_SAFE_INTEGER, so the parse is exact), and it is always
// non-negative. `% 10000` maps it into the basis-point bucket space 0..9999.
export function abBucket(
  abTestPublicId: string,
  revision: number,
  sessionId: string,
): number {
  const digest = sha256Hex(`${abTestPublicId}:${revision}:${sessionId}`);
  const firstWord = parseInt(digest.slice(0, 8), 16); // first 4 bytes, big-endian uint32
  return firstWord % 10000;
}

// ---------------------------------------------------------------------------
// Assignment vocabulary + shapes
// ---------------------------------------------------------------------------

// The §16.3 `assignment_reason` tracking dim. ONE vocabulary shared by the P8
// running-test path (`ab_hash`) and the P7 single-variant seam
// (`single_control`, already emitted by config-dto.ts) — so both phases stamp
// the SAME strings on `quote_view` and downstream events.
export type LeadgenAssignmentReason = "ab_hash" | "single_control";

// The two load-bearing fields the allocation engine needs from a variant. A
// full `LeadgenFunnelVariantRow` structurally satisfies this, so callers pass
// rows directly and the generic returns the ORIGINAL row back (no widening).
export interface AbVariantLike {
  variant_label: string;
  traffic_allocation_bp: number;
}

// The result of an assignment. `assignment_bucket` is the §16.2 bucket (0..9999)
// on the ab_hash path, and `null` on the single_control path (no bucket is
// drawn when there is no running test). These are the §16.3 tracking dims.
export interface VariantAssignment<V extends AbVariantLike> {
  variant: V;
  assignment_bucket: number | null;
  assignment_reason: LeadgenAssignmentReason;
}

// ---------------------------------------------------------------------------
// §16.2 cumulative pick
// ---------------------------------------------------------------------------

// Locale-INDEPENDENT stable order by `variant_label` (a plain `<`/`>` code-unit
// comparator — never `localeCompare`, whose result varies by locale/ICU and
// would break cross-runtime reproducibility). Array.prototype.sort is stable
// (ES2019+), so equal labels keep input order.
function sortByVariantLabel<V extends AbVariantLike>(variants: readonly V[]): V[] {
  return [...variants].sort((a, b) =>
    a.variant_label < b.variant_label ? -1 : a.variant_label > b.variant_label ? 1 : 0,
  );
}

// Pick the variant for a KNOWN bucket (§16.2): sort by variant_label, accumulate
// traffic_allocation_bp, and return the FIRST variant whose cumulative upper
// bound is STRICTLY GREATER than the bucket. A bucket sitting exactly on a
// cumulative boundary therefore falls to the NEXT variant.
//
// Defensive: if the allocations do not sum to 10000 (validation forbids it, but
// the engine must never throw at serve time on bad data) the bucket can exceed
// the final cumulative — we then fall through to the LAST variant rather than
// throwing. The ONLY error is an empty variant set, which is a caller contract
// violation (validateAbAllocations rejects it upstream).
export function pickVariantByBucket<V extends AbVariantLike>(
  bucket: number,
  variants: readonly V[],
): V {
  const sorted = sortByVariantLabel(variants);
  let cumulative = 0;
  let last: V | undefined;
  for (const variant of sorted) {
    last = variant;
    cumulative += variant.traffic_allocation_bp;
    if (cumulative > bucket) return variant;
  }
  if (last === undefined) {
    throw new Error("pickVariantByBucket requires at least one variant");
  }
  return last;
}

// The P8 running-test assignment: draw the §16.2 bucket from
// (abTestPublicId, revision, sessionId) and pick the variant. Sticky per
// session because it is a pure function of exactly those inputs. reason=ab_hash.
export function assignVariant<V extends AbVariantLike>(
  abTestPublicId: string,
  revision: number,
  sessionId: string,
  variants: readonly V[],
): VariantAssignment<V> {
  const assignment_bucket = abBucket(abTestPublicId, revision, sessionId);
  const variant = pickVariantByBucket(assignment_bucket, variants);
  return { variant, assignment_bucket, assignment_reason: "ab_hash" };
}

// The P7 no-running-test seam: serve the single control variant with no bucket.
// Shares the VariantAssignment shape + `assignment_reason` vocabulary so the
// resolver/config-dto emit identical tracking dims on both paths. reason=
// single_control.
export function singleControlAssignment<V extends AbVariantLike>(
  variant: V,
): VariantAssignment<V> {
  return { variant, assignment_bucket: null, assignment_reason: "single_control" };
}

// ---------------------------------------------------------------------------
// §16.2 allocation validation — the Σ==10000 gate
// ---------------------------------------------------------------------------

export type AbAllocationErrorCode =
  | "no_variants"
  | "allocation_not_integer"
  | "allocation_out_of_range"
  | "allocation_sum_mismatch";

export interface AbAllocationError {
  code: AbAllocationErrorCode;
  message: string;
  variant_label?: string;
}

export interface AbAllocationValidation {
  ok: boolean;
  errors: AbAllocationError[];
}

// §16.2 validation gate for the running test's variant set:
//   • at least one variant;
//   • every traffic_allocation_bp is an integer in [0, 10000];
//   • the per-test Σ traffic_allocation_bp == 10000 (reject Σ≠10000).
// The caller is responsible for passing EXACTLY the running test's variants
// (the `WHERE ab_test_id = <running>` scoping); this validates the numeric
// invariants of that set. Never throws — returns typed errors, mirroring the
// funnel.ts validators.
export function validateAbAllocations(
  variants: readonly AbVariantLike[],
): AbAllocationValidation {
  const errors: AbAllocationError[] = [];

  if (variants.length === 0) {
    errors.push({
      code: "no_variants",
      message: "an A/B test requires at least one variant",
    });
    return { ok: false, errors };
  }

  let sum = 0;
  for (const variant of variants) {
    const bp = variant.traffic_allocation_bp;
    if (!Number.isInteger(bp)) {
      errors.push({
        code: "allocation_not_integer",
        message: `traffic_allocation_bp must be an integer, got ${bp}`,
        variant_label: variant.variant_label,
      });
      continue;
    }
    if (bp < 0 || bp > 10000) {
      errors.push({
        code: "allocation_out_of_range",
        message: `traffic_allocation_bp must be in [0, 10000], got ${bp}`,
        variant_label: variant.variant_label,
      });
    }
    sum += bp;
  }

  if (sum !== 10000) {
    errors.push({
      code: "allocation_sum_mismatch",
      message: `per-test Σ traffic_allocation_bp must equal 10000, got ${sum}`,
    });
  }

  return { ok: errors.length === 0, errors };
}
