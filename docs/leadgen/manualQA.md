# Manual QA — LeadGen CMS · Fix-P5 (contract v2.4 §11.7 · Testing & Manual QA)

Browser-executed manual-QA scenarios for the LeadGen CMS. This document is the
operator sign-off deliverable for the **Fix-P5** phase of the LeadGen Fix
Contract v2.4 (§11.7 Manual QA + §11.8 Acceptance). It **extends** — it does
not discard — the v2.3.7 manual-QA set: the ten new **MQA-R** scenarios
(Part A) catch the specific failure class this fix mission targets, and the
original v2.3.7 checklist (Part B, including the runtime-critical **MQA-16**
site activation and **MQA-22** click resolver) is preserved beneath them.

> ## ⚠️ A blank sign-off table is a FAIL state
>
> **A blank sign-off table is a FAIL state for Fix-P5 PASS (the v2.3.7 lesson,
> contract §11.7).** These scenarios require a real activated tenant +
> production/staging environment and a human tester — they are **operator-owned
> and BLOCKED until executed**; the agent has prepared them and **will not
> fabricate results**. No `Result` cell in the sign-off tables may be filled by
> anyone but the human operator who actually ran the scenario on a live
> environment. Until a row is executed, its `Result` stays blank and the row is
> BLOCKED — never PASS.

**The failure class under test (why Part A exists).** v2.3.7 shipped a runtime
that passed its unit suite but was **non-operational end-to-end**: `/lg` did
not render a live funnel, the client engine never mounted, macro/computed
context came back empty, and the auction/quote gates were effectively dead. A
green unit suite is **not** proof the product works. Every MQA-R scenario
therefore demands a *runtime* observation on a *real activated tenant* — a
rendered, answered, auctioned, clicked funnel — not an admin-only or in-process
check.

Each scenario carries a link to the automated test that proves the same
behavior in CI, so the operator knows what is already machine-verified versus
what still needs human eyes on a live environment. **CI-green ≠ live-PASS:**
the automated test is the floor, the manual run on a live tenant is the ceiling.

Each preserved v2.3.7 scenario (Part B) maps 1:1 to a §32 checklist item (MQA-N
↔ §32 item N). Tightly related sub-checks that belong to one §32 bullet are
grouped inside that one scenario. Two surfaces are exercised:

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

# Part A — Fix-P5 runtime-operational scenarios (MQA-R1 … MQA-R10)

These ten scenarios are the §11.7 Fix-P5 gate. Each one is written to catch the
v2.3.7 failure class: *shipped code that is not operational end-to-end.* An
admin-only or in-process check does **not** satisfy an MQA-R row — the runtime
leg must be observed on a real activated tenant. Where a scenario has an
admin-side leg that is verifiable immediately, it is split into *Verifiable now*
vs *Needs live input* so the operator can make partial progress, but the row
does not reach PASS until its runtime leg is observed.

## Part A scenario index

| ID | Title | Surface | Live-leg status |
|---|---|---|---|
| MQA-R1 | Live `/lg` render + full funnel completion (desktop + real mobile device) | Runtime | [BLOCKED-until: activated quote on a live tenant + LEADGEN_CONFIG_SIGNING_KEY + a physical mobile device] |
| MQA-R2 | Auction banners render; impressions visible in analytics next sync | Runtime + Admin | [BLOCKED-until: activated quote + signing key (banners) + CH ingest / mirror-sync (analytics)] |
| MQA-R3 | Banner click → provider URL with resolved macros (inspect final URL) | Runtime | [BLOCKED-until: activated quote + signing key + a completed funnel that reached an auction] |
| MQA-R4 | Payload carries real geo/ip/traffic + computed + placement (provider echo) | Admin + Runtime | [BLOCKED-until: reachable staging endpoint + the offer's token secret; runtime leg also needs activated quote + signing key] |
| MQA-R5 | Invalid/untested Offer blocked from the auction (observe exclusion reason) | Admin (+ Runtime) | Admin Simulate verifiable now; live exclusion [BLOCKED-until: activated quote + signing key] |
| MQA-R6 | Invalid Quote activation blocked with a readable report | Admin | Now |
| MQA-R7 | Payload builder: author schema + run Test with zero raw JSON | Admin | Authoring now; live Test round-trip [BLOCKED-until: staging endpoint + token secret] |
| MQA-R8 | Section Studio: build capability pattern `08` §8.11-(4) start-to-finish | Admin | Now |
| MQA-R9 | Maps field-level config + missing-key fallback | Admin | Config + fallback now; live autofill [BLOCKED-until: GOOGLE_MAPS_BROWSER_KEY + GOOGLE_MAPS_SERVER_KEY] |
| MQA-R10 | Desktop/mobile preview round-trip | Admin | Now |

---

### MQA-R1: Live `/lg` render + full funnel completion (desktop + real mobile device) — [BLOCKED-until: activated quote on a live tenant + LEADGEN_CONFIG_SIGNING_KEY]

- **Objective:** Prove the public funnel renders and a human can complete it
  end-to-end on a real activated site, on both desktop and a physical mobile
  device — the exact behavior v2.3.7 shipped without.
- **Steps:**
  1. Confirm a Quote is activated on the test tenant site (the MQA-16 admin leg;
     note the per-site slug).
  2. On a **desktop** browser open `https://<tenant-host>/lg/<slug>` with
     DevTools → Network open. In DevTools settings **disable JavaScript** and
     reload; read the served HTML and confirm the first Section's question text
     is present (server render, no client JS).
  3. Re-enable JavaScript and reload. Answer each Section in turn: click a
     choice (auto-advance Sections advance on the click; Continue-mode Sections
     require the Continue pill). Click **Back** to a prior Section and confirm
     your earlier answers + the progress bar are restored. Trigger a dependency
     (an IF/THEN follow-up) and confirm the follow-up reveals, then hides when
     you undo it.
  4. Complete the final Section. In the Network tab confirm a `POST /lg/auction`
     fires carrying the funnel binding + answers, and the auction/banner step
     renders.
  5. Repeat steps 2–4 on a **real mobile device** (a physical phone, not just
     desktop responsive emulation) in portrait; confirm the funnel completes
     and there is no horizontal scroll.
- **Expected:** JS-disabled first question visible in the served HTML; every
  Section renders its components; answers select and persist across Back;
  auto-advance / Continue / dependency all behave; the final Section reaches
  `POST /lg/auction`; the funnel completes on desktop **and** the physical
  mobile device with no horizontal overflow and a clean console.
- **Automated-test proof (CI):** `test-ui/leadgen-live-funnel.spec.ts` —
  `Group 1 — server render without JS (11 §11.2 / 03 §3.11)`,
  `Group 1 — answers, defaults, auto-advance`,
  `Group 1 — validation, back-nav, dependencies`,
  `Group 1 — auction → banners → impressions → click` (test *"full traversal
  POSTs /lg/auction with binding+answers+versions; banners render; impressions
  beacon once; /lg/lc 302 resolves macros"*), and `Group 1 — mobile 375` (test
  *"mobile funnel renders, completes to banners; 375px screenshots; no
  horizontal overflow"*). Permanent anti-false-PASS floor:
  `§11.6 anti-false-PASS regression (permanent)` (test *"FAIL if: empty mount
  after ready · zero questions · no answer_click beacon · /lg/auction never
  called"*).
- **Evidence:** desktop + mobile screenshots of the completed funnel; Network
  showing `POST /lg/auction`; the JS-disabled HTML with the first question;
  console clean.

### MQA-R2: Auction banners render; impressions visible in analytics next sync — [BLOCKED-until: activated quote + LEADGEN_CONFIG_SIGNING_KEY (banners) + CH ingest / mirror-sync (analytics)]

- **Objective:** Prove the auction step paints real banners and that the
  impression beacons those banners fire land in the analytics surfaces after the
  next ingest/sync.
- **Steps:**
  1. From MQA-R1, complete a funnel to the auction step. Confirm one or more
     banners render (not an empty slot).
  2. With DevTools → Network filtered to `/lg/track`, scroll each banner slot
     into view once and confirm a `carrier_impression` / `offer_impression`
     beacon fires **once** per slot (scroll it out and back — it must not
     double-fire).
  3. Note the timestamp. After the every-minute analytics cron / a manual
     `POST /api/admin/leadgen/analytics/rebuild-range` for the window (once
     ClickHouse is populated and the mirror sync has run), open the Offer /
     Auction / carrier analytics columns in the admin.
- **Expected:** banners render from the auction result; each impression beacon
  is an actual HTTP `POST /lg/track` (E4 — a queue push is not receipt) that
  fires exactly once per slot; after ingest + mirror sync the impression counts
  appear in the `leadgen_analytics_*` D1 mirrors and the admin ratio cells
  compute (an empty denominator renders "—", never `0`/`NaN`).
- **Automated-test proof (CI):** `test-ui/leadgen-live-funnel.spec.ts` —
  `Group 1 — auction → banners → impressions → click` (impression-fires-once
  leg); `test/leadgen-events.test.ts` —
  `emitLeadgenRecords — §22.1 no-op vs §22.5 fail-open dispatch`;
  `test/leadgen-analytics-producers.test.ts` —
  `§10.2 producer map — lockstep over the frozen LEADGEN_EVENT_TYPES`;
  `test/leadgen-mirror-sync.test.ts` —
  `MIRRORS spec set (contract 08 §23/§24 + migration 0037)`;
  `test/leadgen-analytics-admin.test.ts` —
  `POST /api/admin/leadgen/analytics/rebuild-range (§24 manual CH→D1 backfill)`.
- **Evidence:** screenshot of rendered banners; Network `POST /lg/track`
  impression beacons (one per slot); post-sync screenshot of the populated
  analytics ratios + the D1 `SELECT` on `leadgen_analytics_offer_daily`.

### MQA-R3: Banner click → provider URL with resolved macros (inspect the final URL) — [BLOCKED-until: activated quote + LEADGEN_CONFIG_SIGNING_KEY + a completed funnel that reached an auction]

- **Objective:** Prove a real banner click resolves to the provider destination
  with every macro (`{session_id}`, `{utm_source}`, `{response:slug}`,
  `{click_id}`, …) substituted — never a raw `{token}` or a broken redirect.
- **Steps:**
  1. From a live funnel run that reached an auction (MQA-R1), use an Offer whose
     banner template references a response macro such as `{response:slug}`.
  2. With DevTools → Network (Preserve log on), click the banner. The request is
     `GET /lg/lc/:offer_id?ck=…&aiid=…&brid=…&slot=…&faid=…`.
  3. Inspect the 302 `Location` header on that request — read the **final URL**
     end to end.
- **Expected:** the click mints a `click_id`, counts the click, and 302s to a
  safe `http(s)` `Location` in which every macro is resolved to a real value
  (no literal `{…}` remains); a `{response:slug}` template resolves from the
  persisted response. A required-missing / unsafe / no-target resolution returns
  a safe **204** (the click still counted) — never a broken redirect.
- **Automated-test proof (CI):** `test/leadgen-runtime-routes.test.ts` —
  `GET /lg/lc/:offer_id — governed click resolver (§19.16 / §4.3)` (tests
  *"mints an lgl_ click_id + resolves {response:*} from the persisted
  (redacted) response into the 302"* and *"a required {response:*} missing at
  click time → safe non-302 (204, no-store) but the click STILL counts"*);
  `test/leadgen-click.test.ts` — `resolveLeadgenClick — URL resolution (§19
  step 16 / §10.5)`; `test/leadgen-macros.test.ts` —
  `resolveMacros — canonical runtime substitution` and
  `validateBannerUrlTemplate — §10.5 guards`;
  `test-ui/leadgen-live-funnel.spec.ts` — the `/lg/lc 302 resolves macros` leg.
- **Evidence:** Network 302 with the fully-resolved `Location`; the
  `{response:slug}`-resolved destination; D1
  `SELECT click_id, offer_public_id FROM leadgen_clicks WHERE …`.

### MQA-R4: Payload carries real geo/ip/traffic + computed + placement (staging provider echo) — [BLOCKED-until: reachable staging endpoint + the offer's token secret]

- **Objective:** Prove the payload sent to a provider contains the real runtime
  context (geo/ip/traffic slices), resolved computed keys, and placement values
  — not empty strings, the empty-context bug of v2.3.7.
- **Steps:**
  1. On a dynamic Offer with a staging endpoint + token secret configured, open
     the payload builder (`/admin/leadgen/offers/:id/edit`) and confirm the
     schema maps macros (e.g. `{geo:state}`, `{ip}`, `{utm_source}`), computed
     keys, and a `source:"placement"` value.
  2. Open the **Test** tool and run against **staging**
     (`POST /api/admin/leadgen/offers/:id/test`). Read the echoed request
     payload the provider received.
  3. (Runtime confirmation) After MQA-R1 reaches `/lg/auction` on a real
     activated tenant, confirm the provider fetch carries the same real context
     (via the simulate/echo or the provider's staging log).
- **Expected:** the staging echo shows real geo/ip/traffic values, resolved
  computed keys, and the correct placement value at their mapped schema paths;
  the token is masked (`[REDACTED]`) everywhere in the echo while sent for real
  outbound; the runtime `/lg/auction` payload carries the identical real context
  (not empty).
- **Automated-test proof (CI):** `test/leadgen-gates.test.ts` —
  `G2 — the live /lg/auction provider payload carries the REAL runtime context`,
  `§11.3 multi-placement matrix — one Offer, two placements, one auction (04
  §4.5)`, and `Test tool — the SAME simulated context yields the SAME payload
  as the runtime builder`; `test/leadgen-runtime-context.test.ts` —
  `buildLeadgenRuntimeContext — slice construction (§4.1/§4.2)`,
  `contextToMacros — the 32-macro projection table (§4.3)`, and
  `payload source:"placement" (§4.5 storage extension)`;
  `test/leadgen-computed.test.ts` — `COMPUTED_REGISTRY — the 12 keys (§4.4
  table)`; `test/leadgen-test-tool.test.ts` —
  `POST /offers/:id/test — §11.6 success cycle (mocked outbound fetch)`.
- **Evidence:** the Test result echo showing real context values + `[REDACTED]`
  token; Network `POST /api/admin/leadgen/offers/:id/test`; the provider staging
  log of the received payload.

### MQA-R5: Invalid/untested Offer blocked from the auction (attempt + observe the exclusion reason)

- **Objective:** Prove an ineligible Offer (invalid schema / untested / failed /
  missing parser / missing endpoint) is excluded from the auction with a typed,
  visible reason — the EMPTY_SCHEMA silent-participation bug is gone.
- **Steps:**
  1. Attach an untested (or invalid-schema) dynamic Offer to an auction.
  2. Run the auction **Simulate**
     (`POST /api/admin/leadgen/auctions/:id/simulate`) with a matching context.
     Read the `offers_excluded` trace.
  3. (Live, when unblocked) complete a funnel to that auction on a real tenant
     and confirm the Offer's provider is never called and it never surfaces.
- **Expected:** Simulate lists the Offer in `offers_excluded` with a typed
  `carrier_filtered_reason` (untested / invalid_schema / missing_endpoint /
  missing_parser); the mock provider records **zero** calls for the ineligible
  Offer; a clean, tested Offer in the same auction is included (bidirectional).
- **Automated-test proof (CI):** `test/leadgen-gates.test.ts` —
  `dynamicAuctionEligibility — 05 §5.1 extended codes`,
  `fetchProvider — missing runtime context is a typed no-call exclusion`, and
  `PUT /auctions/:id/offers — per-offer eligibility warnings, save accepted`;
  `test/leadgen-auction-simulate.test.ts` — test *"an offer-level exclude rule
  surfaces in offers_excluded with a typed reason"*;
  `test-ui/leadgen-offers-mgmt.spec.ts` — test ⑥ (simulate trace: redacted
  payload preview + parser id + dry-run note).
- **Evidence:** simulate JSON `offers_excluded[]` with the typed reason; the
  zero-provider-call proof; screenshot of the trace.

### MQA-R6: Invalid Quote activation blocked with a readable report

- **Objective:** Prove an incomplete Quote cannot be activated and the attempt
  returns a human-readable per-Section / per-Offer report with fix links —
  verifiable entirely on the admin surface (no live tenant required).
- **Steps:**
  1. Create a Quote whose Section has a provider-required field left unmapped
     (so it is not activation-ready).
  2. Attempt to activate it:
     `PUT /api/admin/leadgen/quotes/:id/activation/:site_id` with
     `enabled=true`. Read the response.
  3. Fix the missing mapping (use the fix link) and re-attempt.
- **Expected:** the activation attempt is **HARD-BLOCKED with HTTP 409** and a
  normative report body listing each blocking `{section_id, section_name,
  offer_id, offer_name, code, fields[], fix_links}`; the report is readable (not
  a bare 500 or opaque error); after the mapping is fixed a clean Quote
  activates (200).
- **Automated-test proof (CI):** `test/leadgen-gates.test.ts` —
  `R5 — quote activation preflight` (test *"activation PUT HARD-BLOCKS with the
  EXACT normative 409 report (code + fields + fix_links)"*);
  `test-ui/leadgen-section-studio.spec.ts` — test ⑤ *"R5: activation preflight
  BLOCKS on the missing required mapping; the fix link opens THIS studio on the
  mapping drawer"*; `test/leadgen-quotes-api.test.ts` — `§17 activation — one
  enabled root per site, dup slug, preview URL, both sides`.
- **Evidence:** Network `PUT …/activation/:site_id` → 409 with the report body;
  screenshot of the readable report + fix links; the follow-up 200 after fixing.

### MQA-R7: Payload builder — author a schema + run Test with zero raw JSON (as an operator, not an engineer)

- **Objective:** Prove a non-engineer can build a complete provider payload
  schema and Test it without ever hand-writing JSON.
- **Steps:**
  1. On a dynamic Offer open the payload builder
     (`/admin/leadgen/offers/:id/edit`). Using **only** the visual controls
     (pickers, Add-field, CSV paste, toggles — no raw JSON), build: a nested
     object; an array-of-objects; a value map with a main choice + "Other" (via
     CSV Add-many); a date field; a boolean preset; a condition; and a
     default/fallback. Watch the live JSON preview update.
  2. Save. Reopen and confirm the stored schema matches the visual edits.
  3. Open the **Test** tab, generate sample answers, pick a placement, and run
     against staging.
- **Expected:** every construct is authorable through the visual UI with a live
  JSON preview; raw JSON appears **only** inside collapsed "Advanced" drawers;
  the saved schema round-trips; Test returns a masked result with the context
  echo and a provider hit (on the mock in CI / staging live).
- **Automated-test proof (CI):** `test-ui/leadgen-payload-builder.spec.ts` —
  test ① *"zero-JSON authoring: nested object + array-of-objects + value map
  (Add many + CSV + main/Other) + date + boolean preset + condition +
  default/fallback → save → stored schema matches"*, test ④ *"§6.14: the
  rendered page exposes raw JSON only inside collapsed Advanced drawers"*, and
  test ⑤ *"Test tab: … staging run → masked result, context echo, provider hit
  on the mock"*; `test/leadgen-test-tool.test.ts` —
  `POST /offers/:id/test — §11.6 success cycle (mocked outbound fetch)`.
- **Evidence:** screenshots of the builder (no raw JSON visible) + the live
  preview + the Test result with masked headers.

### MQA-R8: Section Studio — build capability pattern `08` §8.11-(4) start-to-finish

- **Objective:** Prove an operator can author the fourth §8.11 capability
  pattern (full-background design with a centered card, step indicator, answer
  cards with title+subtext, Back, legal footer) entirely in Section Studio.
- **Steps:**
  1. Sections tab → New section (`/admin/leadgen/sections/new`). Select the
     full-background funnel design.
  2. Via the Studio library + inspectors build the pattern-4 layout: a centered
     card; a step indicator; answer cards each with a title **and** subtext; a
     Back control; a legal footer. Set headline + subheadline via the Content
     tab.
  3. Preview it, then save and reopen.
- **Expected:** every pattern-4 element is authorable through the Studio UI (no
  raw config editing); the preview renders the full-background centered-card
  layout with title+subtext answer cards, step indicator, Back, and legal
  footer; the section saves and reopens intact.
- **Automated-test proof (CI):** `test-ui/leadgen-studio-patterns.spec.ts` —
  `LeadGen Studio §8.11 — four capability patterns authored through the UI
  (Slice F)` (test *"pattern 4 — full-background design with centered card, step
  indicator, answer cards with title+subtext, Back, legal footer"*);
  `test-ui/leadgen-section-studio.spec.ts` — the Studio build flows (tests ①–⑦).
- **Evidence:** screenshots (desktop 1280px + mobile 375px) of the built
  pattern-4 section; console clean.

### MQA-R9: Maps field-level config + missing-key fallback — [BLOCKED-until: GOOGLE_MAPS_BROWSER_KEY + GOOGLE_MAPS_SERVER_KEY for the live autofill leg]

- **Objective:** Prove the address/ZIP Maps config persists at field level and
  that, with the key absent, the funnel degrades gracefully to manual entry
  (never a broken field).
- **Steps:**
  1. In Section Studio add an address+ZIP question. Via the inspector configure
     the field-level Maps mapping (autocomplete → street/city/state/ZIP internal
     fields). Save and reload; confirm the exact runtime keys persist and the
     linked-field chip + key banner show.
  2. **Missing-key fallback:** with no `GOOGLE_MAPS_BROWSER_KEY` present, load
     the field and confirm the studio shows the missing-key warning and manual
     entry still works (no-op autocomplete, no console error).
  3. (Live, when unblocked) with both keys set, confirm autocomplete autofills
     street/city/state/ZIP and a valid ZIP validates/geocodes.
- **Expected:** field-level Maps config persists through save/reload with the
  correct internal-field mapping; with the key absent the field falls back to
  manual entry + a Studio warning (graceful no-op, clean console); with the keys
  present the live autofill + ZIP validate work.
- **Automated-test proof (CI):** `test/leadgen-maps.test.ts` —
  `validateZip — §12.8 /^\d{5}$/`,
  `resolveBrowserMapsKey — §30.2 referrer-restricted browser key`, and
  `validateAddress — §12.8 server validate/geocode + §30.2 no-op`;
  `test-ui/leadgen-section-studio.spec.ts` — test ⑦ *"§8.8 ZIP Maps config via
  the inspector: exact runtime keys persist through save/reload; linked-field
  chip + key banner"*.
- **Evidence:** screenshots of the persisted field-level config + the
  missing-key warning + working manual entry; (live) autofill + ZIP validate.

### MQA-R10: Desktop/mobile preview round-trip

- **Objective:** Prove a Section previews faithfully at desktop and mobile and
  round-trips between them without drift — the honored `design_id` renders on a
  true 375px viewport, not a scaled desktop.
- **Steps:**
  1. In the Section editor open Preview. Switch desktop → mobile (real 375px, no
     transform scale) → back to desktop.
  2. Confirm the layout is faithful at each viewport and restores identically on
     the return to desktop.
- **Expected:** desktop and mobile previews each render the design faithfully at
  their true viewport (mobile is a real 375px, not a scaled desktop); switching
  back to desktop restores the layout pixel-identically; no horizontal overflow
  at 375px.
- **Automated-test proof (CI):** `test-ui/leadgen-studio-patterns.spec.ts` —
  test *"§9.4 viewport round-trip: desktop → REAL-375px mobile (no transform
  scale) → desktop restores pixel-identically"*; `test/leadgen-designs.test.ts`
  — `token fidelity — measured reference values (§14.10 computed-style
  contract)`; `test-ui/leadgen-visual.spec.ts` — the `/lg` visual/screenshot
  suite (navigates to `/lg`, never `setContent`).
- **Evidence:** screenshots at 375px + 1280px + the restored desktop; no
  horizontal overflow (`scrollWidth ≤ innerWidth`) at 375px.

---

# Part B — Preserved v2.3.7 scenarios (MQA-1 … MQA-27)

The original v2.3.7 manual-QA checklist is preserved verbatim below — it is
still in force. **MQA-16** (site activation → live `/lg` render → deactivate →
404) and **MQA-22** (click resolver mints `click_id` + `{response:slug}` + 302)
are the runtime-critical survivors the contract calls out; the Part A scenarios
MQA-R1 and MQA-R3 build directly on them (R1 completes the funnel that MQA-16
first renders; R3 inspects the resolved final URL of the click MQA-22 mints).
Each scenario below maps 1:1 to a v2.3.7 §32 checklist item (MQA-N ↔ §32 item
N).

## Scenario index (v2.3.7)

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

> **BLANK = FAIL (contract §11.7).** Every `Result` cell below is intentionally
> blank: no manual scenario has been executed by this mission. The agent
> prepared these scenarios and **did not** run them, because they require a real
> activated tenant + production/staging environment + a human tester — they are
> **operator-owned**. Each row is therefore **BLOCKED until executed**. Fix-P5
> does not reach §11.8 PASS while any `Result` is blank. The operator fills
> `Operator` / `Date` / `Result` (∈ {PASS, FAIL, BLOCKED}) during the live run;
> a BLOCKED row records the unblocking input from Prerequisites. **Do not
> fabricate a Result.**

### Fix-P5 gate — MQA-R1 … MQA-R10 (contract §11.7 / §11.8)

| Scenario | Objective | Automated-test proof (CI) | Operator | Date | Result |
|---|---|---|---|---|---|
| MQA-R1 | Live `/lg` renders + a human completes the funnel end-to-end on a real activated site (desktop + physical mobile) | `test-ui/leadgen-live-funnel.spec.ts` (Group 1 + §11.6 anti-false-PASS) |  |  |  |
| MQA-R2 | Auction banners render on the live funnel; impressions appear in analytics next sync | `test-ui/leadgen-live-funnel.spec.ts`; `test/leadgen-events.test.ts`; `test/leadgen-analytics-producers.test.ts`; `test/leadgen-mirror-sync.test.ts`; `test/leadgen-analytics-admin.test.ts` |  |  |  |
| MQA-R3 | Live banner click 302s to the provider URL with every macro resolved (final URL inspected) | `test/leadgen-runtime-routes.test.ts`; `test/leadgen-click.test.ts`; `test/leadgen-macros.test.ts`; `test-ui/leadgen-live-funnel.spec.ts` |  |  |  |
| MQA-R4 | Live/staging provider payload carries real geo/ip/traffic + computed + placement (echo) | `test/leadgen-gates.test.ts` (G2); `test/leadgen-runtime-context.test.ts`; `test/leadgen-computed.test.ts`; `test/leadgen-test-tool.test.ts` |  |  |  |
| MQA-R5 | Invalid/untested Offer excluded from the auction with a typed exclusion reason | `test/leadgen-gates.test.ts` (dynamicAuctionEligibility / fetchProvider); `test/leadgen-auction-simulate.test.ts`; `test-ui/leadgen-offers-mgmt.spec.ts` |  |  |  |
| MQA-R6 | Incomplete Quote cannot activate — readable per-Section/per-Offer 409 report | `test/leadgen-gates.test.ts` (R5 — quote activation preflight); `test-ui/leadgen-section-studio.spec.ts` (test ⑤); `test/leadgen-quotes-api.test.ts` (§17) |  |  |  |
| MQA-R7 | Operator authors a full payload schema + runs Test with zero raw JSON | `test-ui/leadgen-payload-builder.spec.ts` (tests ①/④/⑤); `test/leadgen-test-tool.test.ts` |  |  |  |
| MQA-R8 | Operator builds Section-Studio capability pattern `08` §8.11-(4) start-to-finish | `test-ui/leadgen-studio-patterns.spec.ts` (pattern 4); `test-ui/leadgen-section-studio.spec.ts` |  |  |  |
| MQA-R9 | Maps field-level config persists; key-absent → graceful manual-entry fallback | `test/leadgen-maps.test.ts`; `test-ui/leadgen-section-studio.spec.ts` (test ⑦) |  |  |  |
| MQA-R10 | Section desktop⇄mobile preview round-trips pixel-faithfully | `test-ui/leadgen-studio-patterns.spec.ts` (§9.4 viewport round-trip); `test/leadgen-designs.test.ts`; `test-ui/leadgen-visual.spec.ts` |  |  |  |

### Preserved v2.3.7 checklist — MQA-1 … MQA-27

| Scenario | Objective | Automated-test proof (CI) | Operator | Date | Result |
|---|---|---|---|---|---|
| MQA-1 | LeadGen nav + four tabs + bare redirect | `test-ui/leadgen-nav.spec.ts` |  |  |  |
| MQA-2 | Create an Offer (static) | `test/leadgen-offers-api.test.ts`; `test-ui/leadgen-offers.spec.ts` |  |  |  |
| MQA-3 | Create an Offer (dynamic) + payload builder + Test | `test/leadgen-test-tool.test.ts`; `test-ui/leadgen-payload-builder.spec.ts` |  |  |  |
| MQA-4 | Auto-from-example schema generation | `test/leadgen-sample-answers.test.ts`; `test-ui/leadgen-payload-builder.spec.ts` |  |  |  |
| MQA-5 | Offer rules (region + answer) via simulate | `test/leadgen-auction-simulate.test.ts`; `test/leadgen-rules.test.ts` |  |  |  |
| MQA-6 | Offer cap enforcement | `test/leadgen-caps.test.ts` |  |  |  |
| MQA-7 | Create a Section — every answer component | `test/leadgen-components-render.test.ts`; `test/leadgen-sections-api.test.ts` |  |  |  |
| MQA-8 | Desktop/mobile preview + simulation + payload-mapping | `test/leadgen-sections-api.test.ts`; `test-ui/leadgen-section-studio.spec.ts` |  |  |  |
| MQA-9 | Dependency reveal (IF/THEN) | `test/leadgen-dependencies.test.ts` |  |  |  |
| MQA-10 | Answer→Offer mapping + completeness | `test/leadgen-sections-api.test.ts`; `test-ui/leadgen-section-studio.spec.ts` |  |  |  |
| MQA-11 | Continue behavior (button / auto-advance / no double-submit) | `test/leadgen-runtime-engine.test.ts`; `test/leadgen-answers.test.ts` |  |  |  |
| MQA-12 | Default boolean → answer_source | `test/leadgen-runtime-engine.test.ts` (state: §3.4 answer-source transitions) |  |  |  |
| MQA-13 | Create a Quote + funnel builder | `test/leadgen-quotes-api.test.ts`; `test/leadgen-quotes-ui.test.ts` |  |  |  |
| MQA-14 | Funnel rules (redirect / disqualify / skip) | `test/leadgen-funnel.test.ts`; `test/leadgen-rules.test.ts` |  |  |  |
| MQA-15 | Funnel A/B (Σ=100, sticky, in analytics) | `test/leadgen-ab-hash.test.ts`; `test/leadgen-quotes-api.test.ts` |  |  |  |
| MQA-16 | Site activation (2 sites, slug, preview, deactivate→404) | `test/leadgen-quotes-api.test.ts` (§17 activation); `test/leadgen-runtime-routes.test.ts`; `test-ui/leadgen-live-funnel.spec.ts` |  |  |  |
| MQA-17 | Create an Auction (static) | `test/leadgen-auctions-api.test.ts`; `test/leadgen-auction-core.test.ts` |  |  |  |
| MQA-18 | Create an Auction (dynamic) — winner/multi-offer/backfill/timeout/floor | `test/leadgen-auction-runtime.test.ts`; `test/leadgen-auction-simulate.test.ts`; `test/leadgen-auction-core.test.ts` |  |  |  |
| MQA-19 | Carrier rules (incl. strictly_override) | `test/leadgen-auction-rules.test.ts` |  |  |  |
| MQA-20 | Banner builder (manual + automatic) | `test/leadgen-auction-banner.test.ts`; `test/leadgen-banner-design.test.ts` |  |  |  |
| MQA-21 | Simulate — full explainability, writes nothing | `test/leadgen-auction-simulate.test.ts` (returns the full §19.2 trace and writes NOTHING) |  |  |  |
| MQA-22 | Click resolver mints click_id + {response:slug} + 302 | `test/leadgen-runtime-routes.test.ts` (governed click resolver); `test/leadgen-click.test.ts` |  |  |  |
| MQA-23 | Analytics populate from D1 mirrors + em-dash on 0 denominator | `test/leadgen-analytics-admin.test.ts`; `test/leadgen-mirror-sync.test.ts`; `test/leadgen-clickhouse.test.ts` |  |  |  |
| MQA-24 | Revenue postback — book + dedupe no-op + unmatched queue | `test/leadgen-postback-route.test.ts`; `test/leadgen-revenue-ingest.test.ts` |  |  |  |
| MQA-25 | S2S dispatch — enabled fires, disabled silent, no double-fire | `test/leadgen-s2s-dispatch.test.ts`; `test/leadgen-pixel-route.test.ts`; `test/leadgen-media-platforms-admin.test.ts` |  |  |  |
| MQA-26 | GA4 pass-through keeps dataLayer/gtag working | `test-ui/leadgen-ga4.spec.ts` |  |  |  |
| MQA-27 | Off-ADMIN_HOST → 404; unauth → 401/403 | `test/leadgen-admin-shell.test.ts`; `test/leadgen-runtime-guard.test.ts` |  |  |  |
