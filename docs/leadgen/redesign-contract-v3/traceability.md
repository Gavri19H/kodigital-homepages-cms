# LeadGen CMS Section Builder & Themes — Contract v3.1 Traceability

**Program**: LeadGen CMS Section Builder & Themes, Design-Locked Build Contract v3.1

**Target Repository**: Gavri19H/kodigital-homepages-cms

**Baseline SHA**: 4521647

**Contract Source**: Claude Design project file "LeadGen CMS - Section Builder Build Contract v3.1 Design-Locked.html"

**Adoption Date**: 2026-07-12

---

## Verification header (Phase F close — conductor-verified by own hand)

**Merged to `main`** (one squash PR per phase; each SHIP'd by a fresh-context Opus adversarial review before merge):
A `6bc597a` (#101) · B `8ed9124` (#102) · C `8e34878` (#103) · D `133c229` (#104) · E `972f056` (#105).

**End-to-end close ritual on merged `main`** (`cd api`): `npm run typecheck` → 0 · `npm test` → **4903/4903 (355 files)**, 0 skips · `npx playwright test` → **204/204 == `--list` total** (fresh 3-shard sweep 72+68+64, 0 failed, 0 did-not-run, gate1c 7/7 ratio=0 in the polluted shard) · `npm run verify:all` → PASS, leadgen-runtime bundle **40,044 B / 40,960**. §1.3 preserve list (auction engine/configs, Offer payload schemas, `answer_maps` semantics, `/lg/config`+`/lg/attempt` signing, the 9 analytics mirrors, activation semantics, runtime event schema) untouched across all five phases (path diff).

**Gate enforcement proven** (Phase-E review): reverting product fixes turns the flipped gates RED — the §13 gates ENFORCE the golden, they do not merely document it.

## Design Element Traceability Matrix — ALL PASS (with executed evidence)

| Row | Design element | § | Gate | Status | Evidence (phase PR · proving gate/spec) |
|-----|---|---|---|---|---|
| 1 | Four-region shell & geometry | 2 | 1,3 | **PASS** | B #102 · E `gate3-geometry` (rails 292/344 render-enforced) + `gate1-parity` shell blocks + `gate1c` state-01 |
| 2 | Token set (color/type/space) | 3 | 1,3 | **PASS** | B `studio-tokens` · E `gate1-tokens` (§3/§3.1b audit) + `gate3-geometry` |
| 3 | Canonical headline (strip ↔ canvas) | 4 | 2,4 | **PASS** | B/C · E `gate2-strings` + `gate4` probe6 + `leadgen-section-builder` ① (live strip↔canvas round-trip) |
| 4 | Icon-tile library, merged Answer fields | 5 | 1,2,4 | **PASS** | B · E `gate1-parity` (20 byte-matched tile SVGs) + `gate2-strings` + `gate4` probe7 |
| 5 | Primitive collapse (Text/Image) | 5.3 | 4 | **PASS** | A schema · E `gate4` probe8 (Text/Image + role/source; no retired type placeable) |
| 6 | No disabled / no headline tiles | 5.4 | 4 | **PASS** | B · E `gate4` probe7 (no disabled field/attr; no headline tile) |
| 7 | Direct-manipulation selection + handles | 6 | 1,4 | **PASS** | B · E `gate1-parity` (8 handles exact tuples) + `leadgen-section-studio` §6.2 (live) |
| 8 | Frame hint | 6.3 | 1 | **PASS** | B · E `gate1-parity` (default-ON skeleton) + `gate2-strings` |
| 9 | Presets vs manual custom + Reset (C1) | 7 | 1,4 | **PASS** | B drag / C Style-tab · E `gate4` probe2/3 + `gate4-behavior` spec (real Reset click, presets-deselect) |
| 10 | Scope header, pills, affects lines | 8.1 | 2 | **PASS** | C · E `gate2-strings` (Editing eyebrow + 3 pills + affects sentences) |
| 11 | Dynamic tab matrix | 8.2 | 4 | **PASS** | C · E `gate4` probe1 + `leadgen-section-studio` §8.2 (live: field=5, choice=no Maps, headline/continue=2) |
| 12 | Field Content controls | 8.3 | 2,4 | **PASS** | C · E `gate2-strings` + `leadgen-section-studio-ui` (live populate/collect) |
| 13 | Inheritance tags (continue/style) | 8.4-8.5 | 2 | **PASS** | C · E `gate2-strings` (Color=Brand primary / Position=Bottom, both `inherited`) |
| 14 | Role-based color, no hex | 8.5 | 2,4 | **PASS** | C · E `gate1-tokens` (no raw hex on Style tab) + `gate2-strings` + `leadgen-section-builder` ⑤ (role stored) |
| 15 | Offers per-Offer mapping | 8.7 | 4 | **PASS** | C · `leadgen-section-studio-ui` §8.7 (live-D1 per-Offer answer maps) |
| 16 | Advanced (ids/JSON only here) | 8.8 | 2 | **PASS** | C · E `gate2-strings` (Advanced labels) + `leadgen-glossary-lint` (ids/JSON only under Advanced) |
| 17 | Google Maps jobs + warning (C3) | 9 | 2,4 | **PASS** | C · E `gate2-strings` + `gate4` probe4 + `gate4-behavior` spec (maps_no_job activation block 409) |
| 18 | Themes manager + roles + size language (C2) | 10 | 1,2,4 | **PASS** | D · E `gate1-parity`/`gate1-tokens`/`gate3-geometry`/`gate2-strings` + `leadgen-theme-manager-ui` |
| 19 | A/B theme per variant | 10.1,10.5 | 4 | **PASS** | A/D · `leadgen-theme-manager-ui` (`scanVariantThemeUsage` over real D1, variant-over-funnel precedence) |
| 20 | Preview-theme switcher | 10.6 | 1,4 | **PASS** | B/C · `leadgen-section-studio` §10.6 (live: real KV list, POST `theme_id`) |
| 21 | Runtime = preview parity | 12 | 4 | **PASS** | A/C · `leadgen-v31-themes-size-parity` (3-path HTTP byte-parity) + `leadgen-visual` (`/lg` runtime) |
| 22 | Search synonyms (data-name) | 5.5 | 2,4 | **PASS** | B · E `gate1-parity` (20 verbatim data-names) + `leadgen-section-studio-ui` §5.5 (live filter) |
| 23 | Insert semantics / Accept-swap | 5.6 | 4 | **PASS** | B · `leadgen-section-studio` §5.6 (live: 8-value Accept-swap preserves shared props) |
| 24 | Style tab per selection + enumerations | 8.5b | 2,4 | **PASS** | C · E `gate2-strings` (12-icon/8-Accept/role enums) + `leadgen-section-studio` §8.5/§8.5b (live writes + corners/border render) |
| 25 | Markup parity vs Artifact D | 13 Gate 1a | 1 | **PASS** | E · `gate1-parity` (23 tests) + `gate3-geometry` + `gate1c-baselines` (7 frozen states) |
| 26 | Source-validated schema claims | 11.0 | 4 | **PASS** | A · §11.0 line-cited validation (scout-grounded) + `gate4` storage probes |

All 26 rows PASS with executed evidence. Gate→test detail: `api/test/leadgen-v31-gate-map.md`. The four operator-owned rows below remain BLOCKED (user-authority).

---

## ERRATA

1. **§1.3 assumed migration 0041 not landed** → it landed on main and is byte-equal to §11.1; no migration work in this program.

2. **§11.5 `leadgen_sections.name`** → actual column is `section_name`.

3. **§10.1 "KV namespace lg-funnel-themes"** → implemented as key "lg-funnel-themes" in the shared CACHE KV binding, matching the cited v2.5.1 presets precedent (readComponentPresets / key "lg-component-presets").

4. **TextBlock/ImageBlock absent from the registry pre-build** → they are the new §5.3 primitives introduced by this program.

5. **The golden master's A/B assignment panel is read-only presentation** → theme assignment is storage/API only (PROPOSED per §0 rule); Gate 4 probes it at API level.

6. **§11.3's worked example nests `required` under `props`, but the repository's real, already-wired mechanism stores it at node top-level (`node.required`, read by hydration + the field renderers). The v3.1 schema validates the top-level field and REJECTS `props.required` as invalid — same repo-reality-over-contract-text precedent as erratum (2) (`name`→`section_name`). Contract §11.3's literal example would therefore fail validation; authoring must use top-level `required`. No Gate-4 storage probe tests `required` placement, so no acceptance impact.**

---

## CONTRACT GAPS (un-sourced values — resolve before the dependent gate)

Values the golden master and contract do not specify. Per §0.1 these are recorded as gaps, never invented in code. Until the dependent phase supplies a real design-token value, the resolver accepts and resolves them as DATA but emits NO fabricated dimension (the field falls through to base CSS).

| Gap | Contract ref | Current behavior | Resolve in |
|-----|--------------|-------------------|------------|
| Width preset `s` | §7.1/§8.5b | resolver returns preset name; no explicit width emitted | Phase B (Style-tab S/M/L width design tokens) |
| Width preset `m` | §7.1/§8.5b | same | Phase B |
| Width preset `l` | §7.1/§8.5b | same | Phase B |
| Height preset `small` | §7.1/§8.5b | resolver returns preset name; no explicit height emitted (golden `fieldBoxStyle` is padding-only `16px 18px`, no height term) | Phase B (Small/Medium/Large height design tokens) |
| Height preset `medium` | §7.1/§8.5b | same | Phase B |
| Height preset `large` | §7.1/§8.5b | same | Phase B |
| Text/bound-headline **Size step** control | §8.5b | OMITTED from the Style tab — no `design_overrides` storage key and no runtime consumer exist; per §0.1 not fabricated. Text ships Role + Text-color-role only. | Design addendum defining the storage key + a renderer consumer |
| Text/bound-headline **Align** control | §8.5b | OMITTED — same (no storage/consumer). | Design addendum |
| Corners `sharp` → `border-radius:0` | §3.3/§8.5b | Emitted, but `0` is INFERRED — §3.3 gives no explicit "sharp" px. `0` is the only reading of "no rounding"; `rounded`=8px and `pill`=20px ARE §3.3-cited. | Confirm `0` against a design addendum if a non-zero "sharp" is intended |

GROUNDED and emitted exactly: width `full`→`width:100%` (golden `fieldWrapStyle` non-custom branch; = 100% of the 600 unit column, Appendix B); `custom_px`→explicit `{axis}:{px}px` (§7.2, clamp [200,600], snap 4px). Absent size → no style (byte-identical to pre-v3.1). Corners `rounded`→8px / `pill`→20px and border-color roles (neutral→border/brand→primary/accent→accent) resolve at render time via the theme `design` object (§12), emitted as `--lg-field-border` so `:focus`/`[aria-invalid]` retain precedence (Phase C).

---

## OPERATOR-OWNED (Status: BLOCKED)

| Item | Gate | Status | Notes |
|------|------|--------|-------|
| Production deploy via workflow_dispatch | 1c | BLOCKED (operator) | Frozen-baseline design sign-off (manual visual QA of the 7 states); post-deploy D3/D4 behavioral verification required |
| GOOGLE_MAPS_BROWSER_KEY / GOOGLE_MAPS_SERVER_KEY production secrets | 9 | BLOCKED (operator) | Production secrets management; not in wrangler.toml |
| Live A/B theme activation on a real quote | 10 | BLOCKED (operator) | Live funnel variant assignment with theme override |
| Frozen-baseline design sign-off | 1c | BLOCKED (operator) | Manual visual QA of 7 required states before CI baseline lock |

---

## Per-phase progress tracker

| Phase | Scope | PR | Merged sha | Adversarial verdict | Rounds (impl / review) |
|---|---|---|---|---|---|
| A | Contract package + schema/primitives/size + themes storage/resolution/serve | #101 | `6bc597a` | FIX-FIRST → SHIP | 3 slices + 4 fix rounds / 1 review + 2 confirms |
| B | Studio shell + library + canvas (golden re-chrome) | #102 | `8ed9124` | FIX-FIRST → SHIP | staged 5 slices + 4 fix rounds / 1 review + 2 confirms |
| C | Scope-aware inspector + Maps jobs + save/validation + auction facet | #103 | `8e34878` | FIX-FIRST → SHIP | 1 slice + 3 fix rounds / 1 review + 1 confirm |
| D | Themes manager screen | #104 | `133c229` | SHIP (first pass) | 1 slice + 2 closure rounds / 1 review |
| E | §13 fidelity harness (Gates 1–4) + zero-deviation reconciliation | #105 | `972f056` | SHIP | harness + 5 reconciliation/stability rounds / 1 review |

## Cost & effort note (approximate — aggregated from dispatch usage results)

Delegated model tiers per the ladder: Fable 5 conductor (this session); Sonnet 5 default implementers; Opus 4.8 for studio-rebuild slices (B/C) + every adversarial review; Haiku 4.5 for scouts + the docs slice. The two largest cost amplifiers were both structural, not rework: (1) the Playwright suite exceeds the tool's 600s command timeout and background subagents *park* on it — several B/C cycles were spent isolating "run per-file / shard, never the full suite" as the workable loop (now recorded in `[[reference-kodigital-cms-playwright-ops]]`); (2) Phase E's fidelity harness surfaced 10 real product↔golden divergences that four per-phase reviews missed, and reconciling each to the golden (fix product + flip gate to enforce + re-mint baseline) drove E to five rounds. Every round was a real fix with fail-before/pass-after evidence, not churn. Per-dispatch token/duration figures are in each Agent-tool result in the session transcript; they were not separately tallied here (honesty note: the plan asked for a per-dispatch table recorded as-you-go and that ledger was not kept — the per-phase round counts above are the faithful summary).

## Operator handoff (the 4 user-authority stops — mission does NOT perform these)

1. **Production deploy** — code-complete + verified on `main`; deploy is `workflow_dispatch`-only (merging PRs does not deploy). Run the production deploy workflow when ready; then verify per deploy-safety D3/D4 (cf-cache-status + a behavioral assertion of the new Section Builder, not just HTTP 200). NOTE: `kodigital-homepages-cms-worker` serves 100+ zones — a deploy is repo-wide.
2. **Gate-1c frozen-baseline design sign-off** — the 7 committed baseline PNGs (`api/test-ui/__screenshots__/leadgen-v31-gate1c/`) are the artifact; a human must visually approve them as the design-locked reference (the harness diffs against them but cannot judge correctness).
3. **`GOOGLE_MAPS_BROWSER_KEY` / `GOOGLE_MAPS_SERVER_KEY`** — production secrets (Dashboard-only, never in wrangler.toml); the Maps validate/autocomplete legs no-op until set.
4. **Live A/B theme activation** on a real quote — the build ships fixture-driven proof (`scanVariantThemeUsage` over seeded D1); assigning a theme to a live funnel variant is an operator action.

**Follow-up (non-blocking, recorded):** CI (`deploy.yml`) pins Node 20; the DB-backed (`node:sqlite`, Node ≥22.5) gate blocks `describe.skip` in CI (pre-existing repo-wide pattern; studio-SSR reconciliation gates ARE CI-enforced). Bumping CI Node ≥22 would enable the themes-manager row-18 DB-backed gate rows in CI, after a full-suite Node-22 verification.
