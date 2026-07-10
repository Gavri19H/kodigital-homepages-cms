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

---

# Part C — v2.5.1 Quote & Section Authoring Redesign scenarios (MQA-V25-1 … MQA-V25-4)

The four manual-QA scenarios mandated by redesign contract v2.5.1
`15-testing-qa-contract.md` §15.5 (Phase E). They are **designer-comprehension
and authoring-UX** scenarios: the automated v2.5 suites (cited per scenario)
already prove the mechanics in CI; what CI cannot prove is that a **human
designer** can drive the shipped surfaces without raw JSON, without code
labels, and with the correct Quote-vs-Section mental model. That human leg is
**operator-owned** — every row of the Part C sign-off table is
**BLOCKED(operator, manual_qa_visual)** until a real designer executes it.
The same evidence rules as Parts A/B apply (E1/E2/E4/E6; blank = FAIL;
results are never fabricated).

Every named button, tab, control and copy string in the steps below was
verified against the shipped SSR surfaces (`api/src/admin/leadgen/ui-quotes.ts`,
`api/src/admin/leadgen/ui-section-studio.ts`, `api/src/admin/leadgen/ui-sections.ts`,
frame templates in `api/src/public/leadgen/designs/frames.ts`) — the steps are
executable verbatim.

**Who runs it:** a designer/operator who did **not** build this product.
Scenario 2 in particular must be asked cold (no coaching, no tour of the
answer sheet beforehand).

**Prerequisites (Part C):**

- CF Access admin credentials for `ADMIN_HOST` (all four scenarios are
  admin-surface scenarios; no live tenant is required — the preview stack is
  the runtime composition, proven byte-equal by
  `test/leadgen-endpoint-parity.test.ts`).
- An activity/vertical with at least **one active Offer** that has an
  **active payload schema** (mapping + activation preflight need it), and an
  **Auction** configured for that activity (the §5.2 preflight validates it).
- At least **two CMS sites**, at least one with a **logo** set in its site
  settings (the branding-swap legs of MQA-V25-3; one site may stay
  unactivated — the selector must list it too).
- DevTools open for the console + screenshot evidence; responsive/mobile
  checks use the builder's own `Mobile 375` viewport buttons (true 375px
  iframes, not scaled desktop).

## Part C scenario index

| ID | Title | Surface | Status |
|---|---|---|---|
| MQA-V25-1 | Designer builds a complete 4-slide Quote (frame + theme + Sections + mapping + activation) — zero raw JSON, zero code labels | Admin (Quote Builder + Section Builder) | BLOCKED(operator, manual_qa_visual) |
| MQA-V25-2 | The unprompted ownership question: "what belongs to the Quote vs the Section?" | Interview + Admin | BLOCKED(operator, manual_qa_visual) |
| MQA-V25-3 | Preview all slides in one frame; switch site branding; confirm logo swap | Admin (Quote Builder preview) | BLOCKED(operator, manual_qa_visual) |
| MQA-V25-4 | Break-it pass: page chrome in a Section / type hex / duplicate headlines — impossible or clearly redirected | Admin (adversarial) | BLOCKED(operator, manual_qa_visual) |

---

### MQA-V25-1: Designer builds a complete 4-slide Quote touching zero raw JSON and zero code labels

- **Objective:** Prove a designer can assemble a complete, activatable 4-slide
  Quote — question units, page frame, funnel theme, Offer mapping, activation —
  entirely through the shipped UI: no raw JSON is ever typed or read outside a
  collapsed "Advanced" disclosure, and no control exposes a code identifier as
  its primary label.
- **Steps (every step through the shipped UI, in order):**

  **Build the four Sections (repeat 1–9 per slide; vary the answer component):**
  1. Open `/admin/leadgen/sections` → click **+ Create a Section** (the studio
     opens at `/admin/leadgen/sections/new`).
  2. Top bar: fill **Section name ***; pick **Activity *** and **Vertical ***
     from the dropdowns (they are Offer-derived; **+ New activity…** /
     **+ New vertical…** exist behind an explicit confirm).
  3. Question strip: type the question into **Question headline *** and watch
     the canvas headline update live (it is a bound node — one store, two
     views); type the **Subheadline**; pick a **Continue behavior** radio —
     *Visitor taps Continue (validates first)* or *Advance automatically on
     answer*. Note the strip's own note: the Continue button's default style
     and position come from the Quote's frame.
  4. Left palette — exactly six groups: **Question copy** · **Answer choices**
     · **Inputs** · **Inside-card layout** · **Trust & help — inside this
     question unit** · **Navigation**. Add the slide's answer component from
     **Answer choices** — use a different type per slide to exercise depth,
     e.g. slide 1 an icon-card grid, slide 2 an **image-card grid**, slide 3 a
     yes/no pair, slide 4 a dropdown or input.
  5. Select the new component on the canvas → the right inspector header
     flashes **Editing: <component>** with scope pills, and shows only the
     tabs that apply (of: Content · Choices · Layout · Design · Validation ·
     Maps · Dependencies · Mapping · Advanced). Select a single choice card →
     the header re-scopes to the choice.
  6. Choices tab (slide 2, the image-card grid): per card set the image via
     the **real media picker dialog** (library pick, upload, or **Generate
     with AI**), the REQUIRED **alt text**, title, subtitle, and value. Confirm
     the C1 note on this tab: *"Answer choices own display and normalization
     only. Provider values are set per Offer in the Mapping tab — each row's
     chip shows them read-only."*
  7. Design tab: set a color through the **palette swatch strip** — swatches
     carry role names (e.g. *Brand primary*, *Soft fill*), never hex text.
  8. Bottom drawer → **Offer mapping** tab: map the answer to the Offer's
     payload field using the pickers only (fields appear by their human
     LABEL; raw paths live in tooltips/Advanced); where the Offer needs
     per-answer provider values, use the row's value-map editor (the
     *Fill provider values…* action) — then confirm the per-choice chip reads
     **Provider values: k/n Offers** and the top-bar badge reads **Mapping k/n
     Offers complete** (or **Mapping ready**).
  9. Top bar **Save** → the issues chip must read **No issues** (if not, open
     the drawer's **Validation** tab and fix by clicking each issue to focus
     its component). Repeat for all four Sections.

  **Assemble the Quote:**
  10. Open `/admin/leadgen/quotes` → click **+ Create a Quote** → the **New
      Quote** editor: set the quote name, activity and vertical(s); create.
  11. On the **Funnel builder** tab, left **Funnel structure** panel: pick
      each Section in the **Add section** select → **+ Add Section**, four
      times; reorder with the drag handle (⋮⋮ *Drag to reorder*) or the
      **↑/↓** buttons; confirm the **"Auction runs after this slide"** marker
      sits after the LAST slide (v2.5 model: the auction entry is the final
      slide — there is no separate flag to manage). Open the collapsed
      **Funnel settings** disclosure → pick the **Auction**.
  12. Canvas toolbar → **Template**: the **Frame template** picker offers six
      named cards — *Centered card* · *Site header + footer* · *Header + call
      CTA* · *Full background* · *White + trust bar* · *Minimal* — each with a
      thumbnail and an arrangement tooltip. Pick one. Note the picker's
      promise: *"Your copy, images and colors are kept. Layout comes from the
      template. Nothing changes until you Save."*
  13. Click each frame region directly on the canvas (or via the inspector
      panels): **Header** (logo, tagline, secure badge, header CTA),
      **Progress**, **Back**, **Disclosure**, **Footer**, **Trust strip**,
      **Benefit bar**, **Background**, **Section slot**. Every region
      inspector opens under a scope line — **"Editing: Funnel frame —
      <Region> · affects every slide of this funnel"**. Configure at minimum:
      Progress **Style** (radio: bar / dots / numbered / percent / hidden) and
      note *"Progress counts the slides of this funnel variant
      automatically"*; Back (note *"Hidden automatically on the first
      slide"*); Footer **Show on** (*Every slide / First slide / Final slide /
      Never*); Disclosure text.
  14. Toolbar → **Theme**: the **Funnel theme** drawer (*"affects every slide
      and every component default of this funnel"*): pick palette roles by
      swatch (the 14 named roles: *Brand primary*, *Accent*, *Page
      background*, *Card background*, *Button*, …), typography and scale
      selects. Confirm hex entry exists ONLY inside the collapsed **Advanced
      token administration** disclosure (*"Custom colors skip the design
      system — check contrast."*) — and do NOT use it in this scenario.
  15. Toolbar preview: flip **Desktop 1280** ⇄ **Mobile 375**; flip **Current
      slide** ⇄ **Step through all slides**; confirm the composed page (frame
      + first question unit) renders on both viewports.
  16. Click **Save** (one Save persists frame + theme + variant structure
      together) → the publish chip refreshes to the server verdict.
  17. Click **Publish…** → the **Activation** tab: the **Activation preflight
      (§5.2)** panel must show the green itemized checks (selected-offer
      mappings complete · required provider fields mapped · no orphaned
      provider fields · type conversions valid · payload schema versions
      present · visibility conditions resolve · auction configuration valid ·
      participating offers eligible). In the per-site row: tick the site's
      checkbox, set a slug (*"slug (blank = root /lg)"*), click **Save**; the
      preview URL link appears on the row.
  18. Sign-off sweep with the designer: at no point did any step require
      typing or reading raw JSON (JSON and hex surfaces exist only behind
      collapsed **Advanced** disclosures), and no control's primary label was
      a code identifier (ids like `lgs_…` appear only as secondary/Advanced
      metadata).
- **Expected:** the full flow completes exactly as written above using only
  the named controls; the Quote reaches an activated state through the green
  preflight; the designer confirms (and the screenshots show) zero raw-JSON
  and zero code-label touchpoints.
- **Automated-test proof (CI):** `test-ui/leadgen-quote-builder.spec.ts`
  (rows ①–⑨: badges/logo/progress/all-slides/footer/template-switch/override
  badge/one-Save/C2 publish block); `test-ui/leadgen-section-builder.spec.ts`
  (rows ①–⑨: binding, inspector scope, C1 chip, image-card picker round-trip,
  role swatches, picker-only mapping, real-width round-trip, chrome-free
  palette, move-to-frame); `test-ui/leadgen-studio-patterns.spec.ts` (v2.5.1
  patterns 1–4 + §8.12 flows); `test/leadgen-quote-builder-ui.test.ts` (§4.4
  control-by-control key mapping + SSR no-raw-JSON/no-hex legs);
  `test/leadgen-section-studio-ui.test.ts` (§8.7: the only raw-JSON control is
  the Advanced node editor); `test/leadgen-frame-routes.test.ts`;
  `test/leadgen-activation-preflight-v25.test.ts`;
  `test/leadgen-glossary-lint.test.ts` + `test/leadgen-hex-lint.test.ts`
  (no code terms / no hex in normal-mode copy, enforced over every emitted
  `ui-*.ts` string).
- **Evidence:** screenshots per major station (studio with mapping badge
  complete; frame canvas with a region inspector open; theme drawer; template
  picker; all-slides preview desktop + 375; green preflight + activated site
  row); the designer's zero-JSON / zero-code-label confirmation; console clean.

### MQA-V25-2: The unprompted ownership question — "what belongs to the Quote vs the Section?" (with answer sheet)

- **Objective:** Prove the shipped UX **teaches** the composition model. After
  (or during) the MQA-V25-1 build, the designer is asked cold — no coaching —
  to sort concerns between the Quote and the Section. Per contract §15.5-2:
  **a wrong answer fails the UX, not the designer** — a miss is a product
  finding against the surface that misled them, never a tester failure.
- **Steps:**
  1. Ask, verbatim: *"You're looking at slide 3 of your funnel. What belongs
     to the Quote, and what belongs to the Section?"* Let the designer answer
     free-form first.
  2. Then probe the specific rows of the answer sheet below (ask each item:
     "Quote or Section?"). Record every answer verbatim.
  3. Score against the answer sheet. For any miss, ask the designer to show
     you *where the UI told them otherwise* — record that surface in the
     findings.
- **Answer sheet (from contract `02 §2.2` — operator words):**

  | The designer is asked about… | Correct owner | The UI cue that teaches it |
  |---|---|---|
  | Site logo, header, tagline, secure badge, header call-CTA | **Quote** (the funnel's Page frame) | Header region inspector: "Editing: Funnel frame — Header · affects every slide of this funnel" |
  | Advertising disclosure, legal links, footer, funnel-wide trust/logo strips, benefit bar | **Quote** (frame) | Footer/Disclosure/Trust strip/Benefit bar region inspectors; the studio palette carries none of them |
  | Progress bar / step indicator | **Quote** (frame; counts the variant's slide order automatically) | Progress inspector note: "Progress counts the slides of this funnel variant automatically." |
  | Previous/Back control | **Quote** (frame; auto-hidden on the first slide) | Back inspector note: "Hidden automatically on the first slide." |
  | Page background, overall colors/typography/spacing, button + card defaults | **Quote** (Funnel theme) | Theme drawer: "affects every slide and every component default of this funnel" |
  | Slot geometry — card vs bare, width, padding, transition, default Continue placement | **Quote** (frame — Section slot region) | Section slot region inspector |
  | Question headline + subheadline (the canonical text) | **Section** (stored once, on the Section itself) | The Question strip is THE editor; the canvas node is the same value (one store, two views) |
  | Answer components, inputs, local media, helper/reassurance copy, error lines | **Section** (the question unit) | The six palette groups — all unit-scoped |
  | Answer normalization (internal field) + per-Offer payload mapping + provider values | **Section** (mapping is per-Offer, in the Mapping tab) | Choices-tab C1 note + "Provider values: k/n Offers" chip |
  | Validation rules, IF/THEN dependencies, whether Continue is needed (button vs auto-advance) | **Section** | Continue behavior radios in the Question strip; Validation/Dependencies tabs |
  | Per-choice content — label, value, icon/image/emoji, title/subtitle, badge, alt text | **Section** (the component/choice) | Choices tab per-card editors |
  | Containers INSIDE the unit (card panel, answer grid, columns, spacer) | **Section** | "Inside-card layout" palette group |
  | The Continue button itself | **Both, split**: the frame styles/places it by default; the Section decides *need* (button vs auto-advance) and may restyle its copy locally | The Question-strip note + the frame's Section-slot inspector |
  | Trust badges/logo rows/legal notes | **Both, split by scope**: "Trust & help — inside this question unit" (Section) vs funnel-wide strips in the Quote Builder | The palette group name itself + the C7 scope note under it |

- **Expected:** the free-form answer lands the core split (frame = what stays
  identical on every slide; Section = the question unit that changes), and
  every probed row is answered correctly — including the two "both, split"
  nuance rows. Any miss = **the UX failed**: file a finding naming the
  misleading surface (the row still records FAIL-with-finding, not
  tester error).
- **Automated-test proof (CI):** none can exist for human comprehension — the
  supporting floor is the language discipline the answer sheet leans on:
  `test/leadgen-glossary-lint.test.ts` (C6 — "slide" is Quote-Builder-only
  vocabulary; the Section Builder always says Section / question unit) and the
  C7 scope labels asserted in `test/leadgen-quote-builder-ui.test.ts` +
  `test/leadgen-section-studio-ui.test.ts`.
- **Evidence:** the designer's verbatim answers per row; the scored sheet;
  findings (if any) naming the misleading surface with a screenshot.

### MQA-V25-3: Preview all slides in one frame; switch site branding; confirm the logo swap

- **Objective:** Prove the one-frame promise and the per-site branding ladder
  are visible to a human: all four slides step inside ONE constant frame, and
  switching the preview site swaps the logo (including for a not-yet-activated
  site).
- **Steps:**
  1. Open the MQA-V25-1 Quote in the Quote Builder (**Funnel builder** tab).
  2. In the canvas toolbar set **Step through all slides**; use the **←/→**
     steppers to walk slides 1→4. On EVERY slide confirm the frame is
     IDENTICAL — same header/logo, same disclosure, same footer, same trust
     strip — while only the question unit inside the slot changes.
  3. Watch the progress region while stepping: the value/step advances with
     the slide position (1 of 4 … 4 of 4) in the style you configured
     (dots/bar/numbered/percent).
  4. Confirm the Back affordance is absent on slide 1 and present from
     slide 2 on.
  5. Flip to **Mobile 375** and re-step all four slides: same frame constancy,
     no horizontal overflow inside the canvas iframe.
  6. Open the **Preview site** selector: it must list **ALL** CMS sites, each
     suffixed with its badge — *Active* · *Activation off* · *Not activated
     yet* (Active sites sort first).
  7. Pick a second site that has a different logo (an unactivated site is
     valid — pre-activation branding preview is a feature): the header logo
     swaps to that site's logo immediately, on every slide of the all-slides
     walk.
  8. Confirmation steps: switch back to the first site → the original logo
     returns; re-step slides 1→4 once more → frame constancy holds after the
     swap.
- **Expected:** four slides, one constant frame (header/disclosure/footer/
  trust identical on every step); progress advances by slide position; Back
  hidden only on slide 1; the site selector lists every CMS site with the
  correct badge; the logo swaps per selected site (both directions) including
  an unactivated site; mobile behaves identically at a true 375px.
- **Automated-test proof (CI):** `test-ui/leadgen-quote-builder.spec.ts` ①
  (all sites + badges + unactivated-site branding preview), ② (logo
  auto-appears), ③ (switch site → logo swaps), ④ (all-slides stepping
  advances progress), ⑤ (footer/disclosure/trust around EVERY slide);
  `test/leadgen-preview-modes.test.ts`; `test/leadgen-branding.test.ts`
  (resolver ladder) + `test/leadgen-branding-bump.test.ts` (served-shell
  staleness); `test/leadgen-endpoint-parity.test.ts` (the preview composition
  the designer is looking at byte-equals the runtime composition).
- **Evidence:** screenshots of slides 1 and 4 in the all-slides walk (desktop
  + 375) showing the identical frame; the site selector open with its badge
  list; before/after logo-swap screenshots; console clean.

### MQA-V25-4: Break-it pass — page chrome in a Section, hex, duplicate headlines

- **Objective:** Adversarial pass (per the repo manual-QA doctrine: try to
  break it). Attempt the three classic v2.4-era mistakes; each must be
  **impossible or clearly redirected** by the shipped UX — the named
  refusal/redirect below is the expected behavior.
- **Steps + expected behavior per attempt:**

  **(a) Try to put page chrome in a Section.**
  1. Open any Section in the studio. Search the palette for a header, footer,
     progress bar or page-background item: the six groups (**Question copy /
     Answer choices / Inputs / Inside-card layout / Trust & help — inside this
     question unit / Navigation**) contain none of them.
  2. EXPECTED redirect: the dismissible palette callout reads *"Looking for
     the page header, footer, progress bar or background? Those live in the
     **Quote Builder** → Open"* — and the Open link lands on
     `/admin/leadgen/quotes`.
  3. In the inspector scope pills, the **Funnel frame** pill is disabled with
     the tooltip *"Page-frame elements are edited in the Quote Builder"*. The
     optional **Frame hint** toolbar toggle draws only a dimmed,
     non-interactive frame skeleton (*"presentation-only, edited in the Quote
     Builder"*).
  4. Legacy escape-hatch check (only if a pre-v2.5 Section with an embedded
     chrome node is available): the node renders under an amber badge —
     *"Page-frame element — belongs to the Quote frame"* — with exactly two
     actions, **[Move to Quote frame]** (confirm names the target funnel; the
     node leaves the Section and the funnel's frame gains the group) and
     **[Keep (legacy)]**; and publishing that funnel with the chrome kept is
     BLOCKED by the Activation preflight with the §14.1 copy + a fix link,
     downgrading to a warning only via the Advanced *"Allow slides to keep
     their own page chrome (legacy)"* override in the Quote Builder.
  5. FAIL condition: any palette/insert path places a header, footer,
     progress or background element inside the question unit with no refusal
     and no redirect.

  **(b) Try to type a hex color.**
  1. In the studio, select a component → **Design** tab: every color control
     is a swatch strip of named roles (e.g. *Brand primary*, *Soft fill*) —
     there is **no free-text color field** anywhere on the tab. Attempt to
     paste `#ff0000` into each visible control: nothing accepts it.
  2. In the Quote Builder → **Theme** drawer: palette editing is role
     swatches + named presets; typography/scales are selects.
  3. EXPECTED redirect: the ONLY hex entry in the product is inside the
     collapsed **Advanced token administration** disclosure of the Theme
     drawer, which warns *"Custom colors skip the design system — check
     contrast."* — i.e. hex exists exactly where the contract permits
     (Advanced/theme administration) and nowhere else.
  4. FAIL condition: any normal-mode control accepts or displays a raw hex
     string.

  **(c) Try to enter a duplicate headline.**
  1. In a Section whose bound headline is on the canvas, open the palette's
     **Question copy** group: the **Question headline** item is disabled with
     the tooltip *"This Section already shows its headline"* (same for
     **Subheadline**).
  2. Try to convert another text node into a question headline: the studio
     refuses with the toast *"This Section already shows its headline — use
     the shared field instead."*
  3. Type in the strip's **Question headline *** field, then double-click the
     canvas headline and edit inline: both edits land in the SAME value (one
     store, two views) — there is no second text field anywhere to diverge.
  4. Delete the bound headline node on the canvas: EXPECTED redirect — the
     canonical text is KEPT and a persistent chip appears next to the strip
     input: *"Hidden in this question unit · [Show]"*; **Show** re-inserts the
     bound node at the top. (Free-text extra headlines are not insertable —
     kicker/support copy is covered by the Category label / Helper text
     items.)
  5. FAIL condition: any path yields two independently-stored headline texts,
     or deleting the bound node loses the canonical text.

- **Expected (roll-up):** all three attack classes are impossible or clearly
  redirected exactly as named above; the refusal copy matches; nothing
  silently succeeds.
- **Automated-test proof (CI):** `test-ui/leadgen-section-builder.spec.ts` ⑧
  (chrome-free palette + callout) and ⑨ (legacy amber badge + move-to-frame
  end-to-end); `test/leadgen-component-scope.test.ts` (scope sets +
  `frame_scope_component` warning); `test-ui/leadgen-quote-builder.spec.ts` ⑨
  (C2 publish block + Advanced downgrade); `test/leadgen-hex-lint.test.ts`
  (no hex in normal-mode labels) + `test-ui/leadgen-section-builder.spec.ts`
  ⑤ (swatches store roles); `test/leadgen-headline-binding.test.ts` +
  `test-ui/leadgen-section-builder.spec.ts` ① (single store) +
  `test/leadgen-frame-serve.test.ts` (bound+props.text rejected at the API);
  `test/leadgen-activation-preflight-v25.test.ts` (chrome-block severities).
- **Evidence:** screenshots of: the palette + callout; the disabled Funnel
  frame pill tooltip; the Design-tab swatch strip; the Advanced token
  administration disclosure (collapsed and open); the disabled palette
  headline item tooltip; the refusal toast; the "Hidden in this question
  unit · Show" chip; (legacy leg, if run) the amber badge + the C2 publish
  block. Console clean throughout.

---

## Part C sign-off — MQA-V25-1 … MQA-V25-4 (contract v2.5.1 §15.5 / `18` box 20)

> **Operator-owned; BLOCKED, never PASS, until a real designer executes it
> (consent kind: `manual_qa_visual`).** These four rows are the human leg of
> `18` box 20 — the v2.5.1 program is code-complete without them, but final
> acceptance box 20 stays open until this table is signed. The agent prepared
> the scenarios and did NOT run them. The operator fills Operator / Date /
> Result (∈ {PASS, FAIL, BLOCKED}); a blank row is a FAIL state for §15.5
> sign-off, and a fabricated Result is a red-line violation.

| Scenario | Objective | Automated-test floor (CI, already green) | Status | Operator | Date | Result |
|---|---|---|---|---|---|---|
| MQA-V25-1 | Complete 4-slide Quote built through the UI — zero raw JSON, zero code labels | `leadgen-quote-builder.spec.ts` ①–⑨; `leadgen-section-builder.spec.ts` ①–⑨; `leadgen-studio-patterns.spec.ts` (v2.5.1); glossary + hex lints | BLOCKED(operator, manual_qa_visual) |  |  |  |
| MQA-V25-2 | Unprompted Quote-vs-Section ownership answers match the `02 §2.2` sheet (a miss = UX finding) | — (human comprehension; language floor: `leadgen-glossary-lint.test.ts` C6/C7 legs) | BLOCKED(operator, manual_qa_visual) |  |  |  |
| MQA-V25-3 | All-slides preview in ONE constant frame; site-branding switch; logo swap both directions | `leadgen-quote-builder.spec.ts` ①–⑤; `leadgen-preview-modes.test.ts`; `leadgen-branding.test.ts`; `leadgen-endpoint-parity.test.ts` | BLOCKED(operator, manual_qa_visual) |  |  |  |
| MQA-V25-4 | Break-it pass: chrome-in-Section / hex / duplicate headline — each impossible or redirected with the named copy | `leadgen-section-builder.spec.ts` ⑤⑧⑨ + ①; `leadgen-quote-builder.spec.ts` ⑨; `leadgen-hex-lint.test.ts`; `leadgen-headline-binding.test.ts` | BLOCKED(operator, manual_qa_visual) |  |  |  |
