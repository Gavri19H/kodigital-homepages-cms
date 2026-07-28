# P0 baseline sweep — cluster B (quotes surfaces + 11C capability seeds) — 2026-07-28

Method: fresh `db:reset:local` + `seed:leadgen-fixture`; authored via the real admin APIs;
driven as a real visitor (Playwright chromium, real UA, tenant-host resolver). Captures are
1280 throughout; 375 additionally on the viewport-sensitive legs only (8b both chips, 8c board,
11c-b mobile leg, 11c-r device leg — 5 of 35 files). This sweep SEEDS proof; the P2 packs
capture the full 1280+375 pairs per E6.
35 evidence files in this directory (commit 165fcde). Conductor-persisted from the sweep
agent's driven evidence; conductor spot-verified 8b + 11c-b screenshots by eye.

| Clause | Verdict | Key evidence |
|---|---|---|
| 8b top-bar-only | **DEVIATES** — Theme chip navigates to the top-bar Themes tab ✓; the funnel-card **Template chip opens an embedded apply-popover INSIDE the Funnel-builder tab** (`openTemplatePicker()`, `quotes-tabs/funnel.ts` ~:4462) — the owner's banned "old and wrong option in the funnel builder" class. Joins the P2 fix list (with ADJ-B4, whose probe-era "unresponsive" description is stale). | 8b-theme-chip-nav-*.png, 8b-template-chip-click-*.png |
| 8c board spot-probes | RE-PROVED — 3 funnels side-by-side; library drag adds a chip; verbatim uniqueness message; rules modal plain-language sentence + 2-action rule; no overflow at 1280/375. | 8c-three-funnels-*.png, 8c-drag-*.png, 8c-uniqueness-message-1280.png, 8c-rules-modal-*.png |
| 5d templates save/reuse | RE-PROVED — two templates created; cross-quote apply-with-preview; set-default atomic (global semantics = the known B2/D5 item P2 changes); A/B fork with per-arm template. | 5d-*.png |
| SRC-11C-A page order | SEEDED — BOTH menu and DRAG reorder persist after reload (closes the probe's UNCONFIRMED drag leg). | 11c-a-menu-*.png, 11c-a-drag-*.png |
| SRC-11C-B multi-section + slots | SEEDED with an in-clause gap — A/B + device-ruled + state=CA-ruled slots author (API) and render; LIVE device drive: mobile UA → section X, desktop → Y; state=CA slot saves + renders its "Rule: CA Section" chip (live-geo leg stays post-deploy per GATE-INCONC). **Gap:** the funnel-page section-chip kebab (`data-board-menu="funnel-chip"`, funnel.ts:400) offers NO "A/B this slot"/"Slot rule" entries (unlike shared-page chips) — the mechanism is unreachable by an operator on funnel pages (raw API only), and the per-slot ruled dialog has no generated plain-language sentence (static description + field/op/value rows). Both belong to SRC-11C-B's owner clause ("we should be able to…") → P2 scope. | 11c-b-board-chips-1280.png, 11c-b-mobile-render-375.png, 11c-b-desktop-render-1280.png, 11c-b-funnel-chip-menu-1280.png |
| SRC-11C-C funnel A/B | SEEDED — 2 arms at 5000/5000 bp; 16 fresh-context draws split 9/7 (both arms live). Methodology: a STOPPED experiment collapses to the deterministic single-arm fallback — keep experiments RUNNING when driving splits (P2 drives must honor this). | 11c-c-variant-config-1280.png, 11c-c-visitor-entry-1280.png |
| SRC-11C-D theme-per-funnel | SEEDED — two funnels render two visually distinct themes (dark-blue vs red progress chrome). | 11c-d-funnel-a-theme-1280.png, 11c-d-funnel-b-theme-1280.png |
| SRC-11C-R params routing | SEEDED — utm_source rule + device rule each route INTO their target funnel; non-matching legs hit the default; `leadgen_routing_outcomes` rows carry `routed_to_funnel` + `matched_rule_hash` on the MATCHED legs (a defaulted leg writes no outcome row — `recordRoutingOutcome` fires only on match, runtime-routes.ts:194; default legs are proven by the served funnel). | 11c-r-*.png + D1 rows in the sweep transcript |

## Findings routed
1. **SRC-11B → DEVIATES** (register updated): Template chip = embedded apply in the builder; owner-compliant fix (navigate to the top-bar Templates tab, or remove the chip) lands in P2 with ADJ-B4.
2. **SRC-11C-B gap** (register enriched): operator UI entry point for slot A/B + rules on funnel pages + the ruled-slot plain-language sentence — P2 scope, inside the owner's clause.
3. ADJ-B4 description refreshed (stale "unresponsive" → present embedded-apply behavior; same fix home).
