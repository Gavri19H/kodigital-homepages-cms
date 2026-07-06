# LeadGen CMS — Contract 03 · API & Admin UI

Covers **§8 API / route design** and **§9 Frontend / admin UI design**. Mounting mirrors Listicles exactly: a JSON API router (`leadgenApi`) under `/api/admin/leadgen`, and an HTML shell router (`leadgenUi`) under `/admin/leadgen`, both mounted from `src/admin/router.ts` so the existing `accessAuth` gate + `ADMIN_HOST` 404 wall + `no-store` policy apply unchanged.

---

## 8. API / route design

### 8.1 Mount + middleware

```
src/admin/router.ts:
  admin.route("/", leadgenUi);       // HTML shells   /admin/leadgen*
  admin.route("/", leadgenApi);      // JSON CRUD     /api/admin/leadgen/*
```

Both routers set `Cache-Control: private, no-store` + `X-Content-Type-Options: nosniff` on every response (the 3-line `use("*")` pattern from `listicles/router.ts`/`ui.ts`). Registration order: **static paths before param paths** (e.g. `/offers/search` before `/offers/:id`, `/sections/preview` before `/sections/:id`). Every `:id` param accepts **either** the internal numeric id **or** the `public_id` (via `isPublicId(kind, value)`).

### 8.2 Admin JSON API — `/api/admin/leadgen/*`

Standard verbs per entity: `GET` (list, filtered+paged), `POST` (create), `GET /:id`, `PATCH /:id`, `DELETE /:id` (archive). Additional endpoints below.

**Offers**
| Route | Method | Purpose |
|---|---|---|
| `/offers` | GET | List (filter: `search`,`provider`,`vertical`,`activity`,`status`,`offer_type`,`dynamic`; page). |
| `/offers` | POST | Create (validation §35). |
| `/offers/search` | GET | Typeahead (used by Section/Auction pickers; filters by activity+vertical). |
| `/offers/:id` | GET / PATCH / DELETE | Read / update / archive. |
| `/offers/:id/usage` | GET | Sections that map to it + Auctions it participates in. |
| `/offers/:id/analytics` | GET | Offer analytics (from `leadgen_analytics_offer`, timeframe). |
| `/offers/:id/payload-schemas` | GET / POST | List / create a new immutable payload-schema version. |
| `/offers/:id/payload-schemas/from-example` | POST | Auto-generate schema from a pasted example JSON (§11.2). |
| `/offers/:id/test` | POST | Run a live Test request (staging/production) — server-side proxy (§11.6). |
| `/offers/:id/cap` | GET | Current cap counter status (near-real-time). |

**Sections**
| Route | Method | Purpose |
|---|---|---|
| `/sections` `/sections/:id` | GET/POST/PATCH/DELETE | CRUD. Save rebuilds derived `section_offers` + `section_answer_maps` from `content_json`. |
| `/sections/preview` | POST | Server-render a Section (desktop + mobile) from a draft `content_json` (no persist). |
| `/sections/:id/usage` | GET | Quotes/variants using it. |
| `/sections/:id/offers` | GET | Available Offers for its activity+vertical + current mappings + completeness. |
| `/sections/:id/analytics` | GET | Section analytics + answer distribution. |
| `/sections/:id/validate-payload` | POST | Given selected Offers, list missing required mappings (drives the validation panel). |

**Quotes**
| Route | Method | Purpose |
|---|---|---|
| `/quotes` `/quotes/:id` | GET/POST/PATCH/DELETE | CRUD (base). |
| `/quotes/:id/variants` | GET/POST | List / create funnel variant. |
| `/quotes/:id/experiments` | POST | Create A/B test. |
| `/experiments/:id/start` `/experiments/:id/stop` | POST | A/B lifecycle. |
| `/variants/:id` | PUT | Save variant (lander/design/auction/section-order/rules). Running variant → fork (§16). |
| `/variants/:id/fork` | POST | Fork a running variant to an editable copy (new `funnel_variant_id`). |
| `/variants/:id/preview` | POST | Server-render the whole funnel (desktop/mobile) for review. |
| `/quotes/:id/structure` | GET | Full tree (variants + section order + rules) for the builder. |
| `/quotes/:id/analytics` | GET | Funnel analytics (per variant/site/source breakdowns). |
| `/quotes/:id/activation` | GET | All sites + activation state for this Quote. |
| `/quotes/:id/activation/:site_id` | PUT/DELETE | Activate/deactivate on a site (slug + overrides). |
| `/quotes/:id/funnels` | GET/POST | List / create stable **Funnels** under a Quote (§6.2). |
| `/funnels/:id` | GET/PATCH/DELETE | Read/update/archive a stable Funnel. |
| `/funnels/:id/variants` | GET/POST | List / create funnel **variants**. |
| `/funnels/:id/experiments` | POST | Create the funnel A/B test (variants live under the Funnel, not the Quote directly). |

**Auction**
| Route | Method | Purpose |
|---|---|---|
| `/auctions` `/auctions/:id` | GET/POST/PATCH/DELETE | CRUD. |
| `/auctions/:id/offers` | GET/PUT | Participating Offers (+ static order/bid). |
| `/auctions/:id/rules` | GET/POST/PATCH/DELETE | Offer-level + carrier-level rules. |
| `/auctions/:id/banner` | GET/PUT | Banner builder config (manual/automatic field map). |
| `/auctions/:id/analytics` | GET | Auction + carrier analytics. |
| `/auctions/:id/simulate` | POST | Dry-run the auction against sample answers → full explainability trace (§19), no revenue writes. |

**Shared**
| Route | Method | Purpose |
|---|---|---|
| `/analytics/rebuild-range` | POST | Manual CH→D1 backfill for `[from,to]` (§24). |
| `/media-platforms` `/media-platforms/:id` | GET/POST/PATCH | S2S platform config (§26). |
| `/verticals` `/activities` | GET | DISTINCT filter options (fixed-literal reads, like Listicles `distinctOfferValues`). |

### 8.3 Public runtime routes — `/lg/*`

(Enumerated in §4.3.) Includes **`GET /lg/attempt`** (no-store) — returns `funnel_attempt_id` + session-bound `signed_config_token`; `/lg/config/:funnel_variant_id` stays fully cacheable with no per-session data. All served on tenant hosts, registered **before** `publicRouter`'s `/:slug` catch-all. Runtime handlers live in `src/public/leadgen/` and are mounted by a `leadgenPublicRouter` added to `index.ts` next to `analyticsRouter`.

### 8.4 Response envelope + errors

- JSON only. Success `200` with `{ ...entity }` or `{ items, paging }`. Errors `{ error: "message" }` with `400` (validation), `404` (not found / off-admin-host), `401/403` (auth), `500` (typed JSON via the app-level `onError`). Never return raw secret values.
- Paging shape identical to Listicles: `{ page, page_size, total, has_next, has_prev }`.
- List filters + timeframe read via `resolveTimeframe(range)` and `sanitizeEnum`.

### 8.5 Row vs API shape split (MUST)

Every table gets a `Row` type (DB shape: snake_case, `INTEGER` bools, JSON as `string`) and an `API` type (camelCase or snake stable keys, `boolean`, parsed arrays/objects). Handlers map Row→API on read and validate API→Row on write. This is the `admin/listicles/db-types.ts` + reference `admin/db-types.ts` convention.

---

## 9. Frontend / admin UI design

### 9.1 Shell + shared conventions

- All LeadGen admin screens render inside the existing `adminLayout` (same header, sidebar with the new **LeadGen** nav item, same fonts/spacing). The four-tab bar sits under the page title: **Offers · Sections · Quotes · Auction**.
- **Create button top-left**, above the analytics filter row + timeframe control, on every tab (exact Listicles Offers layout).
- Tables: same column header / row / status-pill / row-actions styling as Listicles lists. Sortable where Listicles is. Empty-state and load-error banners use the same components.
- Modals: same modal shell, focus behavior, and validation-error display (inline field errors + a top-of-modal summary). Destructive actions confirm.
- Analytics: same timeframe control, loading skeletons, and metric-card/table styling; ratios rendered client-side from mirror counts with `NULLIF`-equivalent guards (render `—` when denominator is 0).
- Every screen is server-rendered and hydrates only where interaction requires it (payload builder, question builder, banner builder, rule builders, previews). Keep JS lean (§28).

### 9.2 Offers tab screens

- **List**: toolbar (`Create an Offer` + filters: search, provider, vertical, activity, status, offer type, dynamic/static) + timeframe; table columns: name, placement id, provider, vertical/activity, type, dynamic/static badge, cap badge, status, and analytics columns (impressions, clicks, CTR, conversions, CVR, revenue, RPC, RPM); row actions edit/archive/usage.
- **Create** opens a **modal** capturing required business fields (name, activity, vertical, conversion-tracking method, offer type, ≥1 placement, auction mode, cap toggle). On save a **draft** Offer + default placement are created; the **advanced full-page editor** opens **only after** draft creation (matches §10.1). Full-page editor tabs — **Basics** (name, placement id, activity, vertical, tag, conversion tracking method, offer type, dynamic-bid toggle, cap toggle), **Static** (bid value/currency/order, banner URL template, static fallback URL) shown when dynamic off, **Dynamic** (payload builder, headers, endpoints, token placement, Test tool, response parsing/carrier extraction) shown when dynamic on, **Rules** (region + answer rules), **Analytics** (read-only). See §10/§11.

### 9.3 Sections tab screens

- **List**: `Create a Section` + filters (search, activity, vertical, status) + timeframe; columns: name, activity/vertical, question count, mapped-Offer count, mapping-completeness badge, status, section analytics (views, continue rate, validation-error rate), row actions.
- **Editor** (full-page): left = the **question/answer builder canvas** (add/reorder components), right = **inspector** (selected-component tokens + mapping), plus **Desktop/Mobile preview** toggle and a **states** simulator (default/selected/error/dependency). See §12–14.

### 9.4 Quotes tab screens

- **List**: `Create a Quote` + filters + timeframe; columns: name, activity, verticals, variant count, A/B status, active-sites count, funnel analytics (visits, completion rate, avg RPS, unfilled rate, revenue), row actions.
- **Editor** (full-page): **Funnel builder** (variant selector; opening-lander toggle+editor; ordered Section list with add/remove/reorder + activity/vertical filter; mark final-before-auction; auction attribution; funnel design selector), **Rules** (IF/THEN builder), **A/B** (variants + traffic allocation + assignment preview), **Activation** (per-site enable + slug + overrides + preview URL), **Analytics**. See §15–17.

### 9.5 Auction tab screens

- **List**: `Create an Auction` + filters + timeframe; columns: name, quote attribution, type (static/dynamic), winner logic, participating-Offer count, multi-offer/backfill flags, auction analytics (auctions, fill rate, avg imp/auction, avg bid, avg RPC, revenue), row actions.
- **Editor** (full-page): **Settings** (name, quote attribution, type, winner logic, multi-offer, backfill, remove-clicked, timeout, floor, banner design), **Participating Offers** (picker filtered by activity/vertical; per-Offer status/cap/last-test/schema-version/last-test-status columns; static order/bid for static auctions), **Rules** (offer-level + carrier-level), **Banner builder** (manual/automatic; automatic maps canonical normalized Carrier fields only; saved provider sample responses configure each Offer's response parser (not raw auction-level mapping)), **Simulator** (sample answers → explainability trace), **Analytics**. See §18–21.

### 9.6 Interaction/error patterns (MUST match)

- Optimistic disabling of submit during save; spinner on the button; JSON error → inline messages.
- Unsaved-changes guard on editors.
- All destructive actions (archive/delete/deactivate) are reversible where the data model allows (status flips, not hard deletes) — matches Listicles archive semantics.
- The **Test** (Offers) and **Simulate** (Auction) tools show request/response/latency/status/parsed-carriers panels with secrets masked (§11.6/§19).
