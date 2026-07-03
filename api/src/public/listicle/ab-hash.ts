// Canonical A/B hash — design contract §31.2, implemented VERBATIM.
//
// FNV-1a 32-bit over the UTF-8 bytes of `${sid}|${testId}`; bucket in basis
// points 0..9999. ONE implementation is shared by the edge Version picker
// (this module, Phase 6) and the client page selector (its ES5 twin lands in
// Phase 7 — same UTF-8 input, same modulus). The three §31.2 test vectors
// are FROZEN in api/test/listicles-ab-hash.test.ts; any algorithm drift
// breaks them.

export function lstBucket(sid: string, testId: string): number {
  const s = sid + "|" + testId;
  const bytes = new TextEncoder().encode(s); // UTF-8
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; // *16777619 mod 2^32
  }
  return h % 10000; // 0..9999 bps
}

// assignment: first arm whose cumulative allocation (in bps) > bucket (§31.2).
export interface AllocatedArm {
  /** whole-percent traffic allocation (Σ across arms == 100, §15.8) */
  allocation: number;
}

export function pickArmIndex(bucket: number, arms: ReadonlyArray<AllocatedArm>): number {
  let cumulativeBps = 0;
  for (let i = 0; i < arms.length; i++) {
    cumulativeBps += arms[i]!.allocation * 100; // percent → basis points
    if (cumulativeBps > bucket) return i;
  }
  // Defensive: allocations that do not sum to 100% (validation forbids it,
  // §15.8) fall through to the last arm rather than failing the render.
  return arms.length - 1;
}
