# M3 — routing-rule re-pointing report (owner decision D2)

**Migration:** `0048_leadgen_rework_m3_routing.sql` (LeadGen Rework P1)
**Owner decision D2 (binding, 2026-07-22):** MIGRATE existing `route_funnel_variant`
rules — conditions / multiplier / redirect fields intact, `target_funnel_id` =
the owning funnel of the variant the rule hung on — plus this re-pointing report.

## What the migration does to each `route_funnel_variant` rule

Every `leadgen_funnel_rules` row of type `route_funnel_variant` is copied into the
new quote-scoped table `leadgen_quote_routing_rules` and then removed from
`leadgen_funnel_rules` (its CHECK is tightened to the four auction-domain types).
The mapping is **behavior-neutral on the day it ships**: the old action targeted a
sibling variant of the same funnel, so the new `target_funnel_id` is set to that
funnel itself. The owner re-points each migrated rule at its intended *destination*
funnel through the new rules UI (right rail of the rebuilt funnel builder).

| Migrated field | Source (`leadgen_funnel_rules`) | Value in the new row |
|---|---|---|
| `rule_name` | — | `Migrated rule <old id>` |
| `quote_id` | `variant → funnel.quote_id` | the owning quote |
| `target_funnel_id` | `variant.funnel_id` | **the owning funnel** (re-point later) |
| `priority` | `priority` | carried verbatim (rows inserted in old-id order) |
| `status` | `status` | carried (`active`/`disabled`; unknown → `active`) |
| `match_mode` | `match_mode` | carried |
| `conditions_json` / `conditions_hash` | same | carried byte-for-byte |
| `checkpoint_page` | `checkpoint_page` | carried (runtime re-derives per §4.3-3) |
| `value_multiplier` | `value_multiplier` | carried |
| `redirect_pct` | `redirect_pct` | carried |
| `target_offer_id` / `redirect_url` / `redirect_url_allowlisted` | same | carried |
| `feed_name` | — | `NULL` (no feed concept in the old model) |
| `public_id` | — | minted `lgqr_` + 26 Crockford chars |

## Worked example (round-trip test fixture)

The round-trip test (`api/test/leadgen-rework-migrations.test.ts`) seeds one
`route_funnel_variant` rule into the pre-M3 schema and asserts its migrated shape.
This is the shape a real migrated row takes:

| old rule id | hung on variant | owning funnel (new target) | conditions | multiplier | redirect % | note |
|---|---|---|---|---|---|---|
| 1 | `lgn_rw1` (id 1) | `lgf_rw1` (id 1) | `{"groups":[]}` (hash `hash_route`) | 1.5 | 50 | target = owning funnel (behavior-neutral); re-point via the new rules UI |

(The new row lands in quote `lgq_rw1` (id 1) with `rule_name = "Migrated rule 1"`
and a freshly-minted `public_id` of the form `lgqr_…`.)

## `skip_section` / `show_section` — NOT auto-converted (conflict; conductor-owned)

Contract §5-M3 also says `skip_section`/`show_section` rows should become "page
slot rules (mechanical; report)". **Code reality makes a faithful 1:1 conversion
impossible**, so the migration does NOT invent one and does NOT silently drop the
rows — it **aborts** if any exist (see the guard in `0048`), leaving the data
intact for a conductor decision. Evidence:

- Slot rules (`0042`) accept **only entry-known condition fields**; answer-field
  conditions are rejected at save (`quotes-handlers.ts:330-334`). `skip/show`
  rules are per-section navigation over **answer** fields
  (`public/leadgen/auction/engine.ts:1147` — "owned by the P11 client engine").
- A slot rule must resolve to exactly **one** section (`default_section_id`
  required, `resolver.ts:129-133`) — it cannot express "skip".

Local / CI / a fresh install have zero `skip/show` rows (the seed creates none),
so this is a clean no-op there. If production carries any, the migration will fail
loudly with a `CHECK constraint failed: ok = 1` from the guard — surfacing the gap
rather than corrupting data. **Decision needed from the conductor:** re-author the
affected screens as independent conditional components (the new model), OR drop the
rows (D2's alternative framing for early-stage data), OR define a dedicated
conversion for a follow-up migration.

## Regenerating this report against production data (operator, at deploy time)

Run this **before** applying `0048` (it reads the still-present `route_funnel_variant`
rows). It emits one row per rule to be migrated, plus the exact new `target_funnel_id`:

```sql
SELECT
  r.id                          AS old_rule_id,
  r.public_id                   AS old_rule_public_id,
  v.public_id                   AS hung_on_variant,
  f.public_id                   AS owning_funnel,          -- becomes target_funnel_id
  q.public_id                   AS owning_quote,
  r.priority,
  r.status,
  r.value_multiplier,
  r.redirect_pct,
  r.target_offer_id,
  r.redirect_url,
  r.conditions_hash,
  r.conditions_json
FROM leadgen_funnel_rules r
JOIN leadgen_funnel_variants v ON v.id = r.variant_id
JOIN leadgen_funnels         f ON f.id = v.funnel_id
JOIN leadgen_quotes          q ON q.id = f.quote_id
WHERE r.rule_type = 'route_funnel_variant'
ORDER BY r.id;
```

And, to confirm there are **no** `skip_section`/`show_section` rows that would trip
the guard (expected result: `0`):

```sql
SELECT COUNT(*) AS skip_show_rules
FROM leadgen_funnel_rules
WHERE rule_type IN ('skip_section','show_section');
```
