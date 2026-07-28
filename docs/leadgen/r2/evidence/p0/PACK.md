# P0 OWNER REVIEW PACK — LeadGen R2, phase P0 (async, non-blocking)

Delivered 2026-07-28. P0 merges on adversarial SHIP (F6); this pack is for the owner's eye —
an unapproved async pack surfaces as an open row at the cutover gate, never blocks mid-program.

## What P0 delivered
1. **Step 0 preservation (F1):** your verbatim instructions committed at
   `docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md` (line-diff-identical to Contract Appendix A;
   reviewer-verified 53/53 lines) + all 36 images (checksum-identical) + `images/MANIFEST.md`.
2. **Traceability register** seeded at imperative granularity — now **84 rows / 0 validator
   violations** (`docs/leadgen/source-of-truth/traceability.md`), including the review-forced
   #11C/#11D expansion (16 extra imperative rows) so every one of your sentences has a row.
3. **S0-B1 activation unblock:** root cause was the SAVE-time advisory preflight omitting the
   rework activation problems (`storeVariantPreflight`), so the panel went green while activation
   later 409'd "from nowhere". Fixed (7e6c442 + 60c056b) with a fail-before/pass-after regression.
   The fresh-context reviewer authored its own quote and drove: block reason VISIBLE → fix →
   activation `enabled:true` → live visitor journey (screenshots in `evidence/p0/review/b1-*.png`).
4. **S0-C seed fixture:** `npm run seed:leadgen-fixture` — real-admin-API baseline (activity/
   vertical/quote/funnel/shared page/Buttons/offer/answer-map/auction + Test-tool pass), idempotent,
   `--drive` emits a REAL provider payload row (`{"lead":{"r2fix_carrier":"beta_mutual"}}` in
   `leadgen_provider_request_log`). Fail-closed local-host guard added.
5. **S0-D byte-cap raise (your D1 ruling):** 51,200 → 53,248; bundle unchanged at 50,833 (95.5%);
   no stale gate string survives.
6. **Baseline sweeps (in-use re-proof of the probe-PERFECT clauses):**
   - Sweep-A (studio): ✓-in-button, phone mask (your literal hyphen patterns byte-exact),
     Other-dropdown (Buttons+Cards), cards centered + add-outside, dropdown editor clean —
     **5/5 re-proved** (`evidence/p0/sweep-a/`, 17 screenshots + REPORT.md).
   - Sweep-B (quotes): board probes + template save/reuse re-proved; page reorder (menu AND drag)
     persisting; slot A/B + device-ruled slots driven live; funnel-level A/B both arms;
     theme-per-funnel; UTM + device routing rules each landing in their target funnel with
     recorded outcomes (`evidence/p0/sweep-b/`, 35 screenshots + REPORT.md).

## Deviations found and routed (nothing on faith)
- **SRC-11B DEVIATES:** the funnel-card **Template chip opens an embedded apply-popover inside
  the Funnel builder** — your "old and wrong option in the funnel builder" class. Fix lands in P2
  (with ADJ-B4). Evidence: `sweep-b/8b-template-chip-click-1280.png`.
- **SRC-11C-B gap:** slot A/B + slot rules work at the data/render layer but a funnel page's chip
  menu offers NO operator entry to author them (raw API only) — P2 adds the operator path.
- **ADJ-B3 wider than probed:** the rules rail clips funnel cards at 1440 too (not only
  1600–1680) — P2's responsive fix must clear all widths.
- New adjacent defects (register rows, your fix-or-defer ruling, async): ADJ-N1 (a test-ui
  helper's silent no-op assertion), ADJ-N2 (aria-invalid never set on phone/email failure),
  ADJ-N3 (fire-and-forget section-cache invalidate → raw-API authoring lags live SSR by 40s+),
  ADJ-N4 (dead advisory-preflight KV write + false comment), ADJ-N5 ("Slides" as a quote-level
  blocker group heading), ADJ-N6 (header chip reads "draft" after successful activation).

## OWNER ACTION NEEDED (one small item) — the R1a production inventory
The session's permission layer blocks remote production D1 reads from the conductor shell, so the
read-only R1a data-consistency inventory is **BLOCKED(owner)** (register row ADJ-R1a). To close it,
run from any checkout's `api/` directory (read-only SELECTs; nothing is written):
```
npx wrangler d1 execute kodigital-homepages-cms-db --env production --remote --json \
  --command "SELECT id, public_id, site_id, content_json FROM leadgen_sections WHERE content_json LIKE '%TwoButtonYesNo%'"
npx wrangler d1 execute kodigital-homepages-cms-db --env production --remote --json \
  --command "SELECT id, section_id, question_id, internal_field, output_value_map, value_transform FROM leadgen_section_answer_maps"
npx wrangler d1 execute kodigital-homepages-cms-db --env production --remote --json \
  --command "SELECT id, quote_id, rule_name, conditions_json, target_funnel_id FROM leadgen_quote_routing_rules"
npx wrangler d1 execute kodigital-homepages-cms-db --env production --remote --json \
  --command "SELECT id, funnel_id, rule_type, conditions_json FROM leadgen_funnel_rules"
```
Paste the outputs back (or grant the permission and I run them); I filter the
`choices[].value ∉ {true,false}` candidates, cross-join, and land the inventory in the register.
Any data remediation is DRAFTED for your approval — never executed by me.

## Gate evidence
- Gate log: `docs/leadgen/r2/gate-logs/phase-0.log` — typecheck 0 · **vitest 6,963/6,963
  (423/423 files)** · verify:all 0 · orphan-scan 0 · fixture fresh+idempotent+drive with the full
  D1 payload row · register 84/0 · F5 deferral grep clean (2 self-referential log echoes,
  classified).
- Adversarial review: FIX-FIRST (1 blocker, 1 major, 12 minors — every finding closed in-phase)
  → scoped re-review **SHIP** (closure table verified, several closures re-executed by the
  reviewer's own hand).
