# LeadGen CMS — Contract 06 · Quotes, Funnels, A/B & Site Activation (v2.3.7)

Covers **§15 Quote/funnel builder**, **§16 Funnel A/B**, **§17 Site activation**.

## 15. Quote / funnel builder

### 15.1 Quote vs Funnel identity (issue 8)
A **Quote** (`quote_id`=`lgq_…`) is the named offering. A **Funnel** is a stable flow identity under a Quote; a **Funnel Variant** is its A/B version (`funnel_id` (stable) ≠ `funnel_variant_id` (variant)=`lgn_…` + human `funnel_name`). Every Quote has ≥1 funnel variant. `funnel_id` + `funnel_name` are stamped on every runtime event, auction request, and analytics row. Fields: `quote_name`, `activity`, `verticals_json`; per-variant `funnel_name`, `funnel_design_id`, lander, `auction_id`, ordered sections, rules.

### 15.2 Opening lander
Per variant, usually disabled. When enabled: headline/subheadline/body/hero(+AI)/CTA. Emits `opening_lander_view` / `opening_lander_cta_click`.

### 15.3 Funnel builder — ordered sections; auction after the LAST section (issue 10)
Add / remove / reorder sections (filtered by activity+vertical); preview; validate required mappings. **The auction runs after the section with the highest `position`** in `leadgen_funnel_variant_sections`. There is **no "final" flag** — so an earlier section can never be marked final while later sections exist. Save/publish validation: positions are contiguous 0..n; the max-position section is the auction entry; a variant with 0 sections cannot publish.

### 15.4 Funnel design
`funnel_design_id` per variant selects a **visual design** from the registry (default → the reference funnel design). Separate from the component-capability registry (§14.0).

### 15.5 Funnel rules (`leadgen_funnel_rules`) — redirect safety (issue 11)
Types: `redirect_direct_offer`, `skip_section`, `show_section`, `eligibility`, `disqualification`, `auction_entry`. **Normal `redirect_direct_offer` uses `target_offer_id`** (the destination is resolved through the Offer's governed URL, so macros/caps/tracking apply). A **raw `redirect_url` is NOT allowed on the normal path** — it is honored only when `redirect_url_allowlisted=1` and the URL host is on the admin allowlist. Typed `conditions_json` (§21.4) + `priority`. `redirect_pct` semantics use `?? 0` (an explicit 0 = no redirect).

### 15.6 Quote analytics (from `leadgen_analytics_quote` + `_quote_drilldown`)
Per funnel: `visits`, `unique_visits`, `bounce_rate`, `completion_rate`, `avg_rpc`, `avg_rps`, `cvr` (both `conversions/clicks` and `conversions/completed` surfaced), `unfilled_rate`, `revenue` — NULLIF-guarded, keyed with `funnel_id`+`funnel_name`. Breakdowns (via `_quote_drilldown`, issue 30): funnel × site × traffic_source × device × state × section × question × answer.

## 16. Funnel A/B testing

### 16.1 Variants
Under one `leadgen_funnel_ab_tests` (per Quote, 0..1 running), differing by lander/headline/design/section-selection/order/rules/auction.

### 16.2 Allocation — basis points (issue 9)
`traffic_allocation_bp` on each variant; **per-test Σ == 10000**. **UI displays percent** (bp/100) and accepts percent, storing bp. Assignment:
```
bucket = uint32(SHA-256(`${funnel_ab_test_id}:${funnel_ab_test_revision}:${session_id}`)[0..3]) % 10000
```
Sort variants by `variant_label`; accumulate `traffic_allocation_bp`; pick the first whose cumulative upper bound > bucket. Sticky per session; recomputed identically at edge/client. `funnel_ab_test_revision` is part of the hash input, so **changing allocations or the variant set bumps the revision** and cleanly re-buckets without polluting the prior comparison. Validation: Σbp==10000 (reject otherwise); golden vectors + a 100k-session distribution test (±1%).

### 16.3 Tracking dims
`quote_id`, `funnel_id`, `funnel_name`, `funnel_ab_test_id`, `funnel_ab_test_revision`, `variant_label`, `traffic_allocation_bp`, `assignment_bucket`, `assignment_reason`, `section_order_hash` — on `quote_view` (assignment) and downstream events.

## 17. Site activation

### 17.1 Model (`leadgen_site_quotes`)
`site_id`, `quote_id`, `enabled`, `slug` (NULL = the site's single root funnel path), `settings_overrides_json`. `UNIQUE(site_id,quote_id)`, `UNIQUE(site_id,slug)`, **partial unique `uq_leadgen_sitequote_root` so at most one enabled root (NULL slug) per site** (issue 13). Activating a second root while one is enabled → validation error (must disable or give a slug).

### 17.2 Runtime route (issue 12)
Default: **tenant host + `/lg/:quote_slug`** (the site's activated Quote slugs), and `/lg` for the single enabled root activation. `:site_slug` is used **only** when a real multi-site-on-one-host need exists (documented per deployment). Resolution: host → `site_id`; path (`/lg` or `/lg/:quote_slug`) → enabled `leadgen_site_quotes` row → `quote_id`; then running A/B (or single variant) → `funnel_id`. Disabled/missing → 404.

### 17.3 Activation UI
See all Quotes; activate/deactivate per site; set slug; view active sites; preview URL per site. Activation warms the funnel-shell cache; deactivation invalidates it.
