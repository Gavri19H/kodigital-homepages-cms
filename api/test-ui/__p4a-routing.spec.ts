// LeadGen Round-4 P4a probe spec — RETIRED (§10/S5.1).
//
// This file used to prove the FIRST-generation per-variant routing-rules
// model (D-2) end to end on a REAL served funnel: an ENTRY rule
// (utm_source=facebook -> variant B) and a CHECKPOINT rule (age>=65 ->
// variant C), both seeded by writing `rule_type = 'route_funnel_variant'`
// directly into leadgen_funnel_rules via `wrangler d1 execute --local`
// (bypassing the admin API, since — per this file's own header — "P4b (the
// rules-builder admin UI) is a separate, not-yet-landed dispatch").
//
// Migration 0048_leadgen_rework_m3_routing.sql tightened
// leadgen_funnel_rules.rule_type's CHECK to
// `IN ('eligibility','disqualification','auction_entry','redirect_direct_offer')`
// — 'route_funnel_variant' is now a SQL constraint violation, so both of this
// file's `d1Local(...)` seed calls throw at setup and every test here fails
// before its real assertions ever run. The per-variant routing model itself
// is gone from the product (ui-rules-builder.ts's renderRoutingRulesPanel/
// ROUTING_RULES_SCRIPT + public/leadgen/resolver.ts's evaluateEntryRouting/
// evaluateCheckpointRouting/etc. — all deleted this sweep, confirmed 0 real
// callers, P5 orphan-scan). The REPLACEMENT mechanism is the quote-scoped
// leadgen_quote_routing_rules table (ParsedQuoteRule/loadQuoteRoutingRules/
// evaluateQuoteEntryRouting/evaluateQuoteCheckpointRouting/
// deriveQuoteCheckpointPages in resolver.ts — unit-tested in
// test/leadgen-quote-routing-rules.test.ts and friends).
//
// HONEST GAP (not silently papered over): at the time of this retirement, no
// test-ui spec drives a LIVE served funnel through an ENTRY or CHECKPOINT
// redirect via the NEW quote-scoped routing table the way this file once did
// for the old per-variant one — test-ui/__p4b-rules.spec.ts (a sibling
// retirement in this same sweep) only ever drove the now-deleted admin PANEL,
// never the quote-scoped table's live routing behavior, and no other spec
// seeds leadgen_quote_routing_rules directly. Rebuilding an equivalent live
// ENTRY/CHECKPOINT E2E proof against the new table is a legitimate follow-up,
// out of scope for this removal-sweep pass.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// The one thing still worth proving live: the CHECK constraint this
// retirement is grounded in actually rejects the old rule_type (a real
// regression guard — if migration 0048 ever regressed, this would catch it).
// foreign_keys=OFF in this project's D1 setup (0007/0008), so variant_id
// need not reference a real row — only the rule_type CHECK is under test.
test("route_funnel_variant is rejected by the leadgen_funnel_rules CHECK constraint (migration 0048/M3)", () => {
  expect(() =>
    execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "kodigital-homepages-cms-db",
        "--local",
        "--command",
        "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash) " +
          "VALUES ('lgfr_p4a_retired_probe', 999999, 'route_funnel_variant', '{}', 'probe')",
      ],
      { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
    ),
  ).toThrow();
});
