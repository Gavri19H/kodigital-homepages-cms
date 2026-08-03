# B2 after-fix — conductor-driven acceptance (contract §5 B2 / R2-2)

Branch `leadgen-r2-p8-1`, local worker :8901, 2026-08-03.

## Leg 1 — a theme-record PATCH reaches the live page with NO activation save

Contract: *"PATCH a theme record, then load the live page with a fresh `?_cb=` and see the new
value **without** any activation save."*

```
baseline  GET /lg/r2fix?_cb=<fresh>            old #112233 x20   new #AB1234 x0
PATCH /api/admin/leadgen/themes/thm_p8-repro  roles.brand_primary #112233 -> #AB1234   HTTP 200
          GET /lg/r2fix?_cb=<fresh>            old #112233 x0    new #AB1234 x20
          GET /funnels/<A>/variants            content_version 109 -> 110
```

No activation PUT, no funnel-theme PUT, no server restart between the PATCH and the fetch.
Before the fix (same commands, HEAD f240788): 3 unique `?_cb=` fetches all painted the OLD
colour 18× and `content_version` stayed frozen at 3 — `repro-before.md`.

## Leg 2 — re-verify the ThemeRecord keys that were unverifiable before

Contract: *"Then re-verify the ThemeRecord keys that were unverifiable before, and report which
were actually alive."* Contract's prior state: *"all 25 ThemeRecord keys are UNVERIFIED."*

Authoritative conductor run of `api/scripts/p8/verify-themerecord-keys.mjs`
(full table + per-key mapping rationale: `themerecord-sweep-conductor.txt`):

**CORRECTED after review (see below): 25 keys swept — ALIVE 17 · DEAD 2 · MIS-TARGETED 1 · UNMEASURABLE 5.**
(The first run of this sweep reported "18 ALIVE / 0 DEAD / 7 UNMEASURABLE". That table could not
express MIS-TARGETED or DEAD at all, which is the exact defect class contract R3 is about, so it
certified a mis-targeted key as alive. Superseded — do not cite the old totals.)

Each ALIVE key is a measured painted value on a VISIBLE element across two flipped values, e.g.
`controls.corners` sharp→pill moved `.lg-question-card` border-radius 10px→20px;
`roles.text` moved `#lg-funnel-root` colour rgb(17,17,17)→rgb(238,238,238);
`button_style.selected` wash→mark took `.lg-check-hollow` count 0→3 on the carrier page.

**MIS-TARGETED (1) — the review's finding, now reproduced by the sweep itself:** `roles.card`.
Flipping it moves `input.lg-input` and `.lg-btn-answer` (rgb(250,250,255)→rgb(26,26,34)) while the
element its label implies, `.lg-question-card`, stays constant. Contract R3 names exactly this:
*"'Card background' repaints the **text input**."* Carried into P8-3's honour-or-remove sweep.

**DEAD (2) — zero consumers anywhere in `api/src`, proven by grep, not merely unrendered here:**
`roles.success` and `spacing` (`theme.ts` documents ThemeRecordSpacing as round-tripped and never
rendered). Per the contract, *"a control that cannot be honoured must not be offered"* — both are
honour-or-remove candidates for P8-3, not closed here.

**UNMEASURABLE (5) — a real consumer exists, this fixture's pages do not render it:** `roles.accent`
(per-node override), `roles.error`, `extra_roles.brand_secondary`, `extra_roles.surface_wash`
(RangeQuestion focus state), `extra_roles.button_secondary_bg` (benefit-bar region).
`roles.error` was proposed for DEAD during the fix round and that was REJECTED on evidence:
`default-funnel/styles.ts:279` `.lg-tscard[data-error="true"]` is a real consumer, reachable via
`button_style.layout="card"` plus a live validation-error state. It paints; it must not be removed.

## Scope note

The `caches.default` 300s staleness remains out of scope and untouched (contract §1,
owner-referred). It was observed during this phase on SECTION edits and is distinct from B2:
B2 is defeated by neither a fresh `?_cb=` nor time, and is now fixed at the version-bump layer.
A separate, pre-existing gap found while driving — `patchSectionHandler` never bumps content
versions at all — is surfaced as register row ADJ-P8-1 for the owner's ruling.
