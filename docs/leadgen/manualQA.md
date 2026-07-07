# Manual QA — LeadGen CMS (v2.3.7)

Browser-executed manual-QA scenarios for the LeadGen CMS. This is the
operator sign-off deliverable for contract §32 (Manual QA checklist) and
traceability row 49 / matrix row 32; a phase is not "done" until every
scenario below passes with recorded evidence.

Each scenario maps 1:1 to a §32 checklist item (MQA-N ↔ §32 item N). Tightly
related sub-checks that belong to one §32 bullet are grouped inside that one
scenario. Two surfaces are exercised:

- **Admin** — the CF-Access-gated CMS on `ADMIN_HOST`: the shell routes
  `/admin/leadgen*` and the JSON API `/api/admin/leadgen/*`.
- **Runtime** — the public `/lg/*` router, served on TENANT hosts only and
  dark until a quote is activated on a site (the admin host itself returns a
  safe 404 for `/lg/*`).

The funnel design under test is the `default-funnel` design (registry key
`default`) — the measured reference funnel.

## Prerequisites

**Access + environment**

- CF Access admin credentials for `ADMIN_HOST` (manual auth — automation
  stops at the Access login boundary). All admin scenarios run here.
- A test tenant site (a non-admin host mapped to a site, e.g.
  `https://test-tenant.example.com`) for every runtime `/lg/*` scenario.
- DevTools open for console / computed-style / `window.dataLayer` assertions;
  responsive mode for the 375px checks.

**Evidence rules** (same discipline as the repo `manualQA.md`)

- UI scenarios need a screenshot at the stated viewport (E6).
- Tracking / pixel / GA4 assertions need the HTTP request visible in the
  Network tab — a JS queue push is not server receipt (E4).
- Revenue / analytics claims are never proven from D1 alone where the source
  of truth is upstream; cite the D1 query AND the network/booking evidence.
- Every PASS/FAIL cites command + output (E1/E2).

**Operator-owned inputs each relevant scenario needs FIRST** (a scenario's
live leg is `[BLOCKED-until: …]` the matching input exists; the admin-side
authoring/validation legs are verifiable immediately):

- **Activate a quote on the test tenant site** — unblocks every runtime
  render / auction / click / track leg (MQA-6, 16, 18, 22, 26).
- **`ga4_measurement_id`** in the site's settings (`settings_overrides_json`)
  — the positive GA4 pass-through leg (MQA-26).
- **`GOOGLE_MAPS_BROWSER_KEY` + `GOOGLE_MAPS_SERVER_KEY`** — the address+ZIP
  autocomplete/validate leg of the Section builder (MQA-7).
- **`LEADGEN_CONFIG_SIGNING_KEY`** — the live signed-config binding used by
  `/lg/attempt` → `/lg/auction`; needed for the live auction + click legs
  (MQA-6, 18, 22).
- **Per-provider `LEADGEN_PB_TOKEN_<PROVIDER>`** — the postback token that
  authorizes `/lg/pb/:provider`; needed to book real revenue (MQA-24).
- **ClickHouse secrets + the Athena→ClickHouse ingest job (OQ-3)** — no
  `lg_*` rows (and therefore no populated `leadgen_analytics_*` mirrors)
  exist until data-ops runs it; needed for the populated-analytics leg
  (MQA-23). A staging provider endpoint (+ that offer's token secret) is also
  needed for MQA-3's live Test round-trip.

## Scenario index

| ID | §32 | Title | Surface | Live-leg status |
|---|---|---|---|---|
| MQA-1 | 1 | LeadGen nav + four tabs + bare redirect | Admin | Now |
| MQA-2 | 2 | Create an Offer (static) | Admin | Now |
| MQA-3 | 3 | Create an Offer (dynamic) + payload builder + Test | Admin | [BLOCKED-until: staging endpoint + offer token secret] |
| MQA-4 | 4 | Auto-from-example schema generation | Admin | Now |
| MQA-5 | 5 | Offer rules (region + answer) via simulate | Admin | Now |
| MQA-6 | 6 | Offer cap enforcement | Admin | [BLOCKED-until: activated quote + LEADGEN_CONFIG_SIGNING_KEY] |
| MQA-7 | 7 | Create a Section — every answer component | Admin | [BLOCKED-until: GOOGLE_MAPS_BROWSER_KEY + GOOGLE_MAPS_SERVER_KEY] |
| MQA-8 | 8 | Desktop/mobile preview + simulation + payload-mapping | Admin | Now |
| MQA-9 | 9 | Dependency reveal (IF/THEN) | Admin | Now |
| MQA-10 | 10 | Answer→Offer mapping + completeness | Admin | Now |
| MQA-11 | 11 | Continue behavior (button / auto-advance / no double-submit) | Admin | Now |
| MQA-12 | 12 | Default boolean → answer_source | Admin | Now |
| MQA-13 | 13 | Create a Quote + funnel builder | Admin | Now |
| MQA-14 | 14 | Funnel rules (redirect / disqualify / skip) | Admin | Now |
| MQA-15 | 15 | Funnel A/B (Σ=100, sticky, in analytics) | Admin | Now |
| MQA-16 | 16 | Site activation (2 sites, slug, preview, deactivate→404) | Admin + Runtime | [BLOCKED-until: live test tenant site] |
| MQA-17 | 17 | Create an Auction (static) | Admin | Now |
| MQA-18 | 18 | Create an Auction (dynamic) — winner/multi-offer/backfill/remove-clicked/timeout/floor | Admin | [BLOCKED-until: activated quote + LEADGEN_CONFIG_SIGNING_KEY] |
| MQA-19 | 19 | Carrier rules (incl. strictly_override) | Admin | Now |
| MQA-20 | 20 | Banner builder (manual + automatic) | Admin | Now |
| MQA-21 | 21 | Simulate — full explainability, writes nothing | Admin | Now |
| MQA-22 | 22 | Click resolver mints click_id + {response:slug} + 302 | Runtime | [BLOCKED-until: activated quote + LEADGEN_CONFIG_SIGNING_KEY] |
| MQA-23 | 23 | Analytics populate from D1 mirrors + em-dash on 0 denominator | Admin | [BLOCKED-until: CH secrets + Athena→CH ingest (OQ-3)] |
| MQA-24 | 24 | Revenue postback — book + dedupe no-op + unmatched queue | Runtime | [BLOCKED-until: LEADGEN_PB_TOKEN_<PROVIDER> + a booked click_id] |
| MQA-25 | 25 | S2S dispatch — enabled fires, disabled silent, no double-fire | Admin + Runtime | [BLOCKED-until: platform enabled + auth secret + matched conversion] |
| MQA-26 | 26 | GA4 pass-through keeps dataLayer/gtag working | Runtime | [BLOCKED-until: ga4_measurement_id + activated tenant funnel] |
| MQA-27 | 27 | Off-ADMIN_HOST → 404; unauth → 401/403 | Admin | Now |

---

### MQA-1: LeadGen nav + four tabs + bare redirect

- **Steps:** On `ADMIN_HOST` with CF Access, load `/admin/leadgen`. Confirm the
  LeadGen entry appears in the admin sidebar. Confirm the four sub-tabs render
  (`.leadgen-tabs`): Offers · Sections · Quotes · Auction, and each links to
  `/admin/leadgen/{offers,sections,quotes,auction}`. Request bare
  `/admin/leadgen` and inspect the response.
- **Expected:** LeadGen nav item present; four tabs load with the active tab
  highlighted (`aria-current="page"`); bare `/admin/leadgen` returns HTTP 302
  with `Location: /admin/leadgen/offers`.
- **Evidence:** screenshot of the four tabs; Network/`curl -sI` showing the
  302 → `/admin/leadgen/offers`.

### MQA-2: Create an Offer (static)

- **Steps:** Offers tab → New offer (`/admin/leadgen/offers/new`); pick the
  "Static — no provider request" mode. Save with required fields blank →
  observe validation. Fill `offer_name`, `placement_id`, `activity`,
  `vertical`, and (for static-auction use) static bid + static order + banner
  URL; save. Reopen the offer editor.
- **Expected:** required-field validation blocks the save and flags each
  missing field; on a valid save the Offer appears in the Offers list with its
  analytics columns (em-dashes until analytics populate); static bid/order and
  banner URL persist (visible on reopen).
- **Evidence:** screenshot of the validation panel + the new list row; D1
  `SELECT offer_name, static_bid, static_order, banner_url_template FROM leadgen_offers WHERE public_id = ?`.

### MQA-3: Create an Offer (dynamic) + payload builder + Test — [BLOCKED-until: reachable staging endpoint + the offer's api_token secret]

- **Steps:** New offer, mode "calls provider API". In the payload builder
  (`/admin/leadgen/offers/:id/edit`) build a NESTED payload (object containing
  an array); watch the live JSON preview + validation panel. Set request
  headers, `endpoint_production` + `endpoint_staging`, and token placement
  (header / payload / query). Save. Open the Test tool and run against staging
  (`POST /api/admin/leadgen/offers/:id/test`).
- **Expected:**
  - *Verifiable now:* the builder builds a nested payload with a live JSON
    preview; headers/endpoints/token placement persist. The saved Offer NEVER
    returns the raw token — `api_token_secret_ref` holds only the secret NAME
    (`GET /offers/:id` shows no token value). The Test response masks the
    token: a secret header value → `[REDACTED]`, the payload token node →
    `[REDACTED]` at its schema path, a query-placed token → `[REDACTED]` in the
    echoed URL. With the secret absent, Test reports the token leg skipped and
    still masks.
  - *Needs input:* a real staging round-trip showing payload / response /
    status / latency / parsed carriers / available fields, plus a persisted
    `sample_response_json`, needs a reachable staging endpoint + that offer's
    token secret configured.
- **Evidence:** screenshot of the builder + the Test result with `[REDACTED]`
  headers; Network `POST /api/admin/leadgen/offers/:id/test`; `GET /offers/:id`
  response with no token value; D1 `SELECT sample_response_json FROM leadgen_offer_payload_schemas WHERE offer_id = ?` (redacted).

### MQA-4: Auto-from-example schema generation

- **Steps:** In the payload builder use "auto from example"
  (`POST /api/admin/leadgen/offers/:id/payload-schemas/from-example`); paste a
  real provider payload. Review the generated editable schema; mark fields
  enum / required; save.
- **Expected:** the pasted payload produces an editable schema mirroring its
  shape (nested nodes editable); enum / required flags are settable; save
  persists a new schema version.
- **Evidence:** screenshot before/after generation; Network
  `POST …/payload-schemas/from-example` returning the schema.

### MQA-5: Offer rules (region + answer) via simulate

- **Steps:** On a dynamic Offer add a region rule (state=CA → exclude) and an
  answer rule (homeowner=false → exclude). Attach the Offer to an auction. Run
  the auction Simulate (`POST /api/admin/leadgen/auctions/:id/simulate`) once
  with a context matching CA + homeowner=false, and once with a non-matching
  context.
- **Expected:** in the matching context the simulate `offers_excluded` trace
  lists the Offer with the region rule and the answer rule as the exclusion
  reasons; in the non-matching context the Offer is included (bidirectional).
- **Evidence:** simulate JSON `offers_excluded[]` for both contexts; screenshot
  of the trace.

### MQA-6: Offer cap enforcement — [BLOCKED-until: activated quote + LEADGEN_CONFIG_SIGNING_KEY for the live redirect leg]

- **Steps:** On an Offer enable the cap; set amount + timezone + count-by
  (clicks | conversions); save. Prove exclusion via Simulate with the cap
  counter at/over the amount. *(Live)* exhaust the cap at runtime and confirm
  the capped Offer is excluded / redirected to its fallback.
- **Expected:**
  - *Verifiable now:* cap config persists (amount / timezone / count-by);
    Simulate excludes the capped Offer (`offers_excluded` reason = cap).
  - *Needs input:* the live cap redirect to `cap_fallback_offer_id` /
    `cap_fallback_url` requires an activated quote + signing key (runtime
    auction).
- **Evidence:** screenshot of the cap config; simulate JSON; D1
  `SELECT cap_enabled, cap_amount, cap_timezone, cap_count_by FROM leadgen_offers WHERE public_id = ?`.

### MQA-7: Create a Section — every answer component — [BLOCKED-until: GOOGLE_MAPS_BROWSER_KEY + GOOGLE_MAPS_SERVER_KEY for the address/ZIP autofill leg]

- **Steps:** Sections tab → New section (`/admin/leadgen/sections/new`). Set
  headline + subheadline. Via the question builder add EACH answer component:
  the icon-card grid with the 5 business-type choices; the currency range
  ($10k–$1M+, default value $330k); reassurance badge; progress bar; dropdown;
  multi-choice; free-text; email; phone; name; address+ZIP.
- **Expected:**
  - *Verifiable now:* every component preset is addable and renders in the
    builder; the icon-card grid shows the 5 business-type choices; the currency
    range spans $10k–$1M+ with default value $330k; badge / progress bar /
    dropdown / multi-choice / free-text / email / phone / name all build and
    validate.
  - *Needs input:* the address+ZIP Google-Maps autocomplete (browser key) and
    validate/geocode (server key) live autofill requires both keys.
- **Evidence:** screenshots (desktop 1280px + mobile 375px) of the built
  section showing each component; console clean.

### MQA-8: Desktop/mobile preview + simulation + payload-mapping

- **Steps:** In the section editor use Preview at desktop and mobile. Exercise
  the selected / error / dependency / auto-advance simulation controls. Open
  the payload-mapping preview (`POST /api/admin/leadgen/sections/preview`).
- **Expected:** desktop + mobile previews render; the selected / error /
  dependency / auto-advance states each simulate; the payload-mapping preview
  shows the generated payload for the sample answers.
- **Evidence:** screenshots at 375px + 1280px; screenshot of the
  payload-mapping preview JSON.

### MQA-9: Dependency reveal (IF/THEN)

- **Steps:** Add a dependency (IF insured = Yes THEN reveal the insurer
  dropdown). In preview set insured = Yes, then set it to No.
- **Expected:** the insurer dropdown is revealed when insured = Yes and hidden
  when insured = No (bidirectional — test both directions).
- **Evidence:** two screenshots (revealed / hidden).

### MQA-10: Answer→Offer mapping + completeness

- **Steps:** Map the SAME section answer to two different Offers, using
  different field names / values per Offer. Check the completeness badge. Leave
  a provider-required field unmapped.
- **Expected:** the same answer maps to distinct field names/values across the
  two Offers; the completeness badge reflects mapped coverage; a missing
  required mapping is flagged and blocks publish.
- **Evidence:** screenshot of the mapping UI showing both Offer mappings + the
  completeness badge + the missing-required flag.

### MQA-11: Continue behavior (button / auto-advance / no double-submit)

- **Steps:** Set a section's Continue to button mode → try to advance with no
  answer. Set auto-advance mode → click a choice. Rapidly double-click a
  choice / the Continue pill.
- **Expected:** button mode blocks advancing until an answer is given;
  auto-advance advances on a single choice click; a double-click produces one
  advance only (no double-submit).
- **Evidence:** screenshots / short recording of each mode; console clean.

### MQA-12: Default boolean → answer_source

- **Steps:** Add a boolean question with a default. In the preview simulation,
  leave it untouched (default applied), then change it.
- **Expected:** untouched → `answer_source=default`; a user change →
  `answer_source=user`. (At runtime this dimension rides the `/lg/track`
  event; in the admin simulation it is shown in the answer state /
  payload-mapping preview.)
- **Evidence:** screenshot of the simulation answer-state / payload-mapping
  showing `answer_source` before and after the change.

### MQA-13: Create a Quote + funnel builder

- **Steps:** Quotes tab → New quote (`/admin/leadgen/quotes/new`). Set
  `quote_name` / activity / vertical. Add + reorder Sections (the picker is
  filtered by activity/vertical). Mark exactly one Section final-before-auction.
  Select the `default-funnel` design. Attach an auction. Optionally set an
  opening lander. Save.
- **Expected:** Sections add and reorder; exactly-one final-before-auction is
  enforced; the funnel design is selectable; an auction is attachable; the
  optional opening lander persists; the quote saves.
- **Evidence:** screenshot of the funnel builder; Network
  `POST /api/admin/leadgen/quotes`; D1
  `SELECT quote_name, funnel_design_id FROM leadgen_quotes WHERE public_id = ?`.

### MQA-14: Funnel rules (redirect / disqualify / skip)

- **Steps:** On a quote variant add funnel rules: age < X → redirect;
  state-blocked → disqualify / static; homeowner = no → skip a section path.
  Preview / simulate the variant with matching and non-matching contexts
  (`POST /api/admin/leadgen/variants/:id/preview`).
- **Expected:** age < X redirects; a blocked state disqualifies or shows the
  static path; homeowner = no skips the configured path; each rule fires only
  on its matching context.
- **Evidence:** screenshots of each rule's preview outcome (matching vs
  non-matching).

### MQA-15: Funnel A/B (Σ=100, sticky, in analytics)

- **Steps:** Create two variants under the quote/funnel
  (`POST /quotes/:id/variants`). Set allocations to Σ ≠ 100 → attempt to start
  the experiment (`POST /experiments/:id/start`) and confirm rejection. Set
  Σ = 100 → start. Use assignment-preview
  (`GET /experiments/:id/assignment-preview`) for several sample sessions;
  re-run the same session id.
- **Expected:** allocations must total 100% (start enforces the Σ==10000 bp
  gate; Σ≠100 is rejected); assignment is deterministic + sticky per session
  (same session id → same variant on re-run); the assigned variant appears as
  a dimension in analytics.
- **Evidence:** screenshot of the Σ≠100 rejection; assignment-preview JSON
  showing stable bucketing across repeats; the analytics variant dimension.

### MQA-16: Site activation (2 sites, slug, preview, deactivate→404) — [BLOCKED-until: a live test tenant site serving the runtime /lg render leg]

- **Steps:** On a quote, activate it on 2 sites
  (`PUT /api/admin/leadgen/quotes/:id/activation/:site_id`, `enabled=true`,
  per-site slug). Confirm the admin surfaces each site's preview URL. Open the
  preview URL on the tenant host (`/lg/:quote_slug`). Then deactivate one
  (`DELETE /quotes/:id/activation/:site_id` or `enabled=false`) and reload.
- **Expected:**
  - *Verifiable now:* activation persists per site with a per-site slug (slug
    must match `/^[a-z0-9-]+$/`; at most one enabled NULL-slug root per site;
    `UNIQUE(site_id, slug)` — a second enabled root is rejected); the admin
    shows a preview URL per activation.
  - *Needs input / runtime:* the preview URL renders the funnel at
    `/lg/:quote_slug` on the live tenant host; after deactivation the same URL
    returns 404 (the resolver returns null → the shell 404s).
- **Evidence:** screenshot of the two activations + slugs + preview URLs;
  runtime screenshot of `/lg/<slug>` rendering; `curl -sI https://<tenant-host>/lg/<slug>`
  → 200 while active, → 404 after deactivate.

### MQA-17: Create an Auction (static)

- **Steps:** Auction tab → New auction (`/admin/leadgen/auction/new`), type
  static. Add participating Offers with static order/bid + banners. Save. Open
  the auction (or Simulate) to view the ordering.
- **Expected:** Offers are ordered by static order/bid; each Offer's banner is
  shown; the static auction persists.
- **Evidence:** screenshot of the ordered offer list + banners; simulate JSON
  showing the static ordering.

### MQA-18: Create an Auction (dynamic) — winner/multi-offer/backfill/remove-clicked/timeout/floor — [BLOCKED-until: activated quote + LEADGEN_CONFIG_SIGNING_KEY for the live /lg/auction leg]

- **Steps:** New dynamic auction. Add participating Offers — confirm each row
  shows status / cap / last-test / schema-version. Set `winner_logic`
  (`highest_bid` / `average_bid` / `sum`); set `multi_offer` (`disabled` /
  `enabled` / `enabled_unique`); set `backfill` (`disabled` / `enabled` /
  `enabled_unique`); set `removal_scope` (remove-clicked `offer` | `carrier`);
  set `timeout_ms` + `floor_percentage`. Prove each behavior via Simulate
  across contexts.
- **Expected:**
  - *Verifiable now (via Simulate):* the participating-offer rows show
    status/cap/last-test/schema-version; the winner matches `winner_logic`
    (highest / average / sum) with deterministic tie-breaking; `multi_offer`
    surfaces winner-only (`disabled`) / all-offer carriers (`enabled`) /
    carrier-deduped (`enabled_unique`); `backfill` fills empty slots per mode
    (`disabled` never backfills); remove-clicked removes at the configured
    scope; below-floor carriers are backfill-only; the timeout bounds the run.
  - *Needs input:* the live provider fetch at `POST /lg/auction` requires an
    activated quote + `LEADGEN_CONFIG_SIGNING_KEY` (the signed-config binding
    from `/lg/attempt`).
- **Evidence:** simulate JSON per `winner_logic` / `multi_offer` / `backfill`
  setting; screenshot of the participating-offers panel.

### MQA-19: Carrier rules (incl. strictly_override)

- **Steps:** Add auction carrier/offer rules: device = mobile → hide Carrier A;
  state = NY → exclude Carrier C. Add a `strictly_override` rule plus a
  conflicting lower-priority rule targeting the same offer/carrier. Simulate
  with matching and non-matching contexts.
- **Expected:** the mobile context hides Carrier A; the NY context excludes
  Carrier C; a `strictly_override` rule forces its verdict regardless of other
  matching rules and priority (include-family forces in, exclude-family forces
  out), overriding the conflicting rule; a non-matching context leaves the
  carriers in.
- **Evidence:** simulate `offers_excluded` / carrier trace per context; the
  `strictly_override` outcome shown to win over the conflicting rule.

### MQA-20: Banner builder (manual + automatic)

- **Steps:** On the auction banner (`PUT /api/admin/leadgen/auctions/:id/banner`)
  build a banner MANUALLY (copy fields). Then use automatic mapping from a
  persisted sample response.
- **Expected:** the manual copy fields build a banner; automatic mapping
  populates banner fields from the sample response's parsed values; the preview
  renders both.
- **Evidence:** screenshots of the manual build + the auto-mapped build;
  Network `PUT …/auctions/:id/banner`.

### MQA-21: Simulate — full explainability, writes nothing

- **Steps:** On a dynamic auction run Simulate
  (`POST /api/admin/leadgen/auctions/:id/simulate`) with admin-supplied
  answers. Inspect the trace. Query the D1 result/revenue tables before and
  after the run.
- **Expected:** the trace shows offers considered, offers excluded, providers
  requested, provider responses, parsed carriers, filtered, winner, final
  surfaced, and unfilled reason; `dry_run=true`; and it WRITES NOTHING — no
  `leadgen_auction_result_log` / revenue rows are added (row counts identical
  pre/post).
- **Evidence:** simulate JSON (full trace); D1 `SELECT COUNT(*)` on
  `leadgen_auction_result_log` and the revenue table identical before and after.

### MQA-22: Click resolver mints click_id + {response:slug} + 302 — [BLOCKED-until: activated quote on a live tenant site + LEADGEN_CONFIG_SIGNING_KEY]

- **Steps:** From a live funnel run that reached an auction, click a banner →
  `GET /lg/lc/:offer_id?ck=<carrier_key>&aiid=<auction_instance_id>&brid=<banner_render_id>&slot=<n>&faid=<funnel_attempt_id>`.
  Observe the response, the minted `click_id`, and the click counts. Use an
  Offer whose banner template references `{response:slug}` to confirm response
  macro resolution.
- **Expected:** the click mints a `click_id`, counts the click (cap +
  remove-clicked + carrier_click / offer_click), resolves the destination (the
  provider `click_url`, or a `{response:<path>}` template such as
  `{response:slug}` plus `{click_id}`), and 302s to a safe http(s) `Location`.
  A required-missing / unsafe / no-target resolution returns a safe 204 (the
  click still counted) — never a broken redirect.
- **Evidence:** Network 302 with the resolved `Location`; D1
  `SELECT click_id, offer_public_id FROM leadgen_clicks WHERE …` (or the
  events table); a `{response:slug}`-resolved destination.

### MQA-23: Analytics populate from D1 mirrors + em-dash on 0 denominator — [BLOCKED-until: ClickHouse secrets + the Athena→ClickHouse ingest job (OQ-3)]

- **Steps:** Before any ingest, open each analytics surface (the Offer /
  Section / Quote / Auction / carrier analytics columns) and inspect the ratio
  cells. Run `POST /api/admin/leadgen/analytics/rebuild-range` for a window.
  After the every-minute cron / rebuild (once CH is populated), re-open.
- **Expected:**
  - *Verifiable now:* with empty D1 mirrors every ratio whose denominator is 0
    renders "—" (the NULLIF guard) — never `0`, `NaN`, or a division error;
    `rebuild-range` returns 200.
  - *Needs input:* after CH ingest + mirror sync, the Offer / Section / Quote /
    Auction / carrier tables populate from the `leadgen_analytics_*` D1 mirrors
    and the ratios compute.
- **Evidence:** screenshot showing "—" ratios pre-ingest; Network
  `POST …/analytics/rebuild-range` → 200; post-ingest D1
  `SELECT * FROM leadgen_analytics_offer_daily` (and peers) populated +
  screenshot of computed ratios.

### MQA-24: Revenue postback — book + dedupe no-op + unmatched queue — [BLOCKED-until: LEADGEN_PB_TOKEN_<PROVIDER> secret + a booked click_id to match]

- **Steps:** `POST /lg/pb/:provider` with a valid token + `external_txn_id` +
  a `click_id` that matches a real click → books. Repeat the SAME
  `(provider, external_txn_id)` → no-op. POST with a `click_id` matching no
  click → unmatched-queued. POST with a missing / wrong token → rejected.
- **Expected:**
  - *Verifiable now:* a bad/absent token is rejected by the runtime guard /
    token check; a replay of the same `(provider, external_txn_id)` is an
    idempotent HTTP 200 `{status:"duplicate"}` no-op (no second booking).
  - *Needs input:* a valid-token postback books revenue matched by `click_id`
    (FX-normalized to USD); an unmatched `click_id` is queued.
- **Evidence:** Network `POST /lg/pb/<provider>` responses (booked vs
  `{status:"duplicate"}` vs rejected); D1
  `SELECT * FROM leadgen_postback_log WHERE provider = ? AND external_txn_id = ?`
  (exactly one row) + the revenue table (one booking); the unmatched queue row.

### MQA-25: S2S dispatch — enabled fires, disabled silent, no double-fire — [BLOCKED-until: a media platform enabled with its auth secret + a matched CLEAN conversion]

- **Steps:** In Media platforms
  (`POST /api/admin/leadgen/media-platforms`) create/enable a platform with a
  `postback_url_template` + `auth_secret_ref` (secret NAME) + `value_multiplier`.
  Trigger a matched conversion. Then disable the platform and trigger again.
- **Expected:**
  - *Verifiable now:* the platform config persists with the secret NAME only
    (the token VALUE never enters the table or a response); a disabled platform
    fires nothing.
  - *Needs input:* an enabled platform + configured secret fires ONE outbound
    pixel on a matched conversion (no double-fire — KV-deduped); a non-2xx
    provider response is logged, not thrown.
- **Evidence:** D1 `SELECT * FROM leadgen_media_platforms` (no secret value);
  the outbound S2S HTTP request visible in the Network tab / worker log on the
  enabled+matched path; zero requests on the disabled path.

### MQA-26: GA4 pass-through keeps dataLayer/gtag working — [BLOCKED-until: ga4_measurement_id in the site's settings + an activated tenant funnel]

- **Steps:** With no `ga4_measurement_id` set, load the funnel and confirm no
  gtag is injected. Set the site's `ga4_measurement_id` (in
  `settings_overrides_json`) + activate; load `/lg/:quote_slug`; open the
  DevTools console + Network.
- **Expected:**
  - *Verifiable now:* with no id, the shell injects no gtag and never resets an
    existing `dataLayer`.
  - *Needs input:* with the id set, the shell `<head>` emits the standard
    `gtag.js` loader + inline bootstrap; `window.dataLayer` exists and GROWS;
    `gtag('config', <site measurement id>)` fires; the LeadGen path never
    resets an existing `dataLayer`; zero GA4 console errors.
- **Evidence:** console `window.dataLayer.length` growing; Network request to
  the GA4 collect / `gtag.js` endpoint carrying the measurement id (E4 — an
  actual HTTP request, not just a queue push); zero console errors; screenshot.

### MQA-27: Off-ADMIN_HOST → 404; unauth → 401/403

- **Steps:** From OFF the ADMIN_HOST (a tenant host) request `/admin/leadgen`
  and `/api/admin/leadgen/offers`. From the ADMIN_HOST WITHOUT a valid CF
  Access session request the same paths.
- **Expected:** off-ADMIN_HOST → 404 (the index.ts ADMIN_HOST wall); on
  ADMIN_HOST without a valid CF Access JWT → 401/403 (the accessAuth gate).
  Every `/api/admin/leadgen/*` and `/admin/leadgen*` response carries
  `Cache-Control: private, no-store` + `X-Content-Type-Options: nosniff`.
- **Evidence:** `curl -sI https://<tenant-host>/admin/leadgen` → 404;
  `curl -sI https://<ADMIN_HOST>/api/admin/leadgen/offers` (no Access session)
  → 401/403; the response headers showing `private, no-store` + `nosniff`.

---

## Sign-off

Operator fills one row per scenario during the run. Status ∈ {PASS, FAIL,
BLOCKED}. A BLOCKED row records what unblocks it (the operator input from
Prerequisites); the mission is not done until every row is PASS.

| Scenario | Status | Operator | Date | Evidence |
|---|---|---|---|---|
| MQA-1 |  |  |  |  |
| MQA-2 |  |  |  |  |
| MQA-3 |  |  |  |  |
| MQA-4 |  |  |  |  |
| MQA-5 |  |  |  |  |
| MQA-6 |  |  |  |  |
| MQA-7 |  |  |  |  |
| MQA-8 |  |  |  |  |
| MQA-9 |  |  |  |  |
| MQA-10 |  |  |  |  |
| MQA-11 |  |  |  |  |
| MQA-12 |  |  |  |  |
| MQA-13 |  |  |  |  |
| MQA-14 |  |  |  |  |
| MQA-15 |  |  |  |  |
| MQA-16 |  |  |  |  |
| MQA-17 |  |  |  |  |
| MQA-18 |  |  |  |  |
| MQA-19 |  |  |  |  |
| MQA-20 |  |  |  |  |
| MQA-21 |  |  |  |  |
| MQA-22 |  |  |  |  |
| MQA-23 |  |  |  |  |
| MQA-24 |  |  |  |  |
| MQA-25 |  |  |  |  |
| MQA-26 |  |  |  |  |
| MQA-27 |  |  |  |  |
