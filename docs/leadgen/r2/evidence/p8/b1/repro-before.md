# B1 before-fix reproduction (conductor-driven)

HEAD f240788, wrangler dev :8901, 2026-08-03.

Setup: section "P8 Address Repro v3" (id=5, lgs_01KZ27DTF599M85YHNEDHS6WA0) authored through
the REAL save route (POST /api/admin/leadgen/sections, content-schema validated) with the D3
default AddressAutocompleteQuestion (empty props); attached at position 0 of funnel A's variant
(PUT /variants/lgn_01KZ271383SKKSFFWG23N1XGZK -> 200, content_version 3->4).

Served visitor shell (GET /lg/r2fix?_cb=<fresh>, Host: r2fix.e2e.test, Chrome UA) carries the
NESTED wire shape (raw attribute, HTML-entity-encoded as served):

    data-lg-maps="{&quot;enabled&quot;:true,&quot;jobs&quot;:{&quot;validate&quot;:false,&quot;auction&quot;:false,&quot;autocomplete&quot;:true},&quot;fills&quot;:{&quot;city&quot;:&quot;p8_addr_city&quot;,&quot;state&quot;:&quot;p8_addr_state&quot;,&quot;zip&quot;:&quot;p8_addr_zip&quot;}}"

Decoded top-level keys: {enabled, jobs, fills} — there is NO top-level `autocomplete` /
`enable_autocomplete`. parseMapsConfig (api/src/public/leadgen/runtime/maps.ts:60) reads only
those flat keys -> autocomplete:false -> initMapsFields (maps.ts:151) skips every field.
Producer emits nested (components/presets.ts renderAddressFieldSet ~:3336), consumer reads
flat: the R1-1/B1 shape divergence, reproduced on the live wire from the real authoring flow.

Constraint discovered for the fix: test/leadgen-p5f3-address-labels-and-chrome.test.ts
byte-pins STREET_ONLY (and sibling) baselines CONTAINING this nested attribute — the
convergence must update those pinned strings with in-file justification (label/structure
assertions preserved; only the maps attr shape changes).
