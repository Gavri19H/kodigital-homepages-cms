# 17 · Traceability Matrix

Every mission requirement → contract clause → phase → proof. (Mission §refs = the v2.5 mission brief; F# = `01 §1.2`.)

| Req | Mission | Contract | Phase | Proof (test / artifact) |
|---|---|---|---|---|
| Boundary correction | §2 | `02`, `03` | A | frame-plus-unit-composition; runtime frame-constancy Playwright |
| One canonical headline | §3.1, AC1 | `03 §3.4`, `05 §5.2` | A+C | canonical-headline-binding; no-duplicate-headline-storage; studio Playwright |
| Scope-aware inspector | §3.2, AC10 | `07` | C | inspector Playwright; glossary-lint |
| Palette/token color UX | §3.3, AC11 | `09` | A+C | token-priority-order; hex-lint; color Playwright |
| Layout model fix | §3.4, AC12/13 | `08 §8.2–8.3`, `05 §5.4` | A+C | component-schema `frame_scope_component`; palette Playwright |
| Canvas toolbar | §3.5 | `06` | C | toolbar context-matrix Playwright |
| Card/choice depth | §3.6, AC9 | `08 §8.4`, `05 §5.5` | A+C | image-card-choice-data; image-card Playwright |
| Visual rich library | §3.7 | `08 §8.1/8.3` | C | palette Playwright |
| Pattern capability | §3.8/§10, AC17 | `08 §8.7`, `04 §4.3` | B+C+E | pattern fixtures + visual regression |
| Quote Builder modeling | §3.9, AC2 | `04`, `03 §3.3` | B | quote-builder Playwright; frame-config-serialization |
| Auto site logo | §3.10, AC4 | `10` | A+B | site-logo-inheritance; site-swap Playwright |
| Progress ownership | §3.11, AC5 | `11 §11.1` | A | progress-from-variant-order |
| Back ownership | §3.12, AC6 | `11 §11.2` | A | back-behavior |
| Footer/disclosure/trust | §3.13, AC7 | `11 §11.3–11.4` | A+B | runtime persistence Playwright |
| Continue ownership | §3.14 | `11 §11.5` | A | composition vitest (continue placement) |
| Deep section design | AC3/AC8 | `05`, `06`, `09 §9.5` | C | studio suite |
| Data/ownership model | §7, §12 | `03` | A | migration + serialization tests |
| API contract | §13 | `04 §4.8`, `10 §10.5`, `13 §13.4`, `03 §3.6` | A/B | handler vitest (routes, `problems[]`) |
| Runtime composition | §14, AC15 | `13` | A+D | preview-runtime-parity |
| Preview contract | §15, AC14 | `13 §13.4`, `04 §4.6`, `05 §5.3` | B+C+D | preview Playwright |
| Testing contract | §16, AC20 | `15` | E | suites themselves |
| Language alignment + glossary | §11 | `02 §2.4`, `12 §12.4` | C | glossary-lint |
| Mapping visibility | AC16 | `12` | D | mapping Playwright |
| No arbitrary CSS | AC18 | `03 §3.3`, `06`, `09` | all | schema validators + existing CSS_ESCAPE_RE tests |
| No raw JSON normal flows | AC19 | `04`, `07 §7.4` | B+C | no-raw-json-normal-mode |
| Preserve list | §0/§6 | `00` preserve table | all | regression umbrellas (mapping, auction, mirrors untouched — no migration beyond 0041) |

Amendments registry (explicit): AMENDS v2.4 08 §8.3/§8.5 (palette scope split, `01 §1.3`) · AMENDS current quote-preview markup (headline h2 removal, `03 §3.4`) · AMENDS mission §13 route sketch to repo-flat conventions (`04 §4.8`) · SUBSTITUTES grid/snap toggles with token-tree alignment (`06 §6.1`). No other prior clause is touched.

**v2.5.1 consistency pass (C1–C7) — requirement → clause → proof:**

| # | Fix | Contract | Proof |
|---|---|---|---|
| C1 | Section↔Offer separation: choices own display/normalization; provider values per Offer only | `07 §7.3`, `12 §12.2`, `05 §5.5`, `06 §6.4` | vitest `per-offer-provider-values`; Choices-tab Playwright; `glossary-lint` provider-value rule |
| C2 | Chrome-in-Section blocks activation when a frame is configured; `compat.allow_section_chrome` Advanced override (JSON field, no new table) | `03 §3.3/3.5`, `14 §14.1`, `04 §4.4`, `08 §8.6`, `05 §5.4` | vitest `activation-chrome-block`; publish-block Playwright |
| C3 | Exactly one `data-lg-continue` per visible Section; below_unit move/suppress semantics | `11 §11.5`, `13 §13.1` | vitest `continue-single-dom`; runtime Playwright |
| C4 | Preview site selector = all CMS sites + badges; pre-activation branding preview; servability untouched | `10 §10.5`, `04 §4.6`, `13 §13.4` | site-selector Playwright |
| C5 | Template switch merge classes, confirmation triggers, preview-before-apply via `draft_frame_config` | `04 §4.3`, `13 §13.4` | vitest `template-switch-merge`; template Playwright |
| C6 | “Section / question unit” in Section Builder; “slide” = Quote-Builder position vocabulary; reuse always shown | `02 §2.4`, `06 §6.1`, `07 §7.1–7.4`, `05 §5.2` | `glossary-lint` slide rule |
| C7 | Local vs funnel-wide labeling of shared trust/logo/legal affordances | `08 §8.2/8.3`, `04 §4.4` | palette-copy Playwright assertions |

On adoption: append these rows to `docs/leadgen/traceability.md` under a “v2.5” heading; each row flips Specified → Implemented with PR links.
