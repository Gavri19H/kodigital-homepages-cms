# 13 · Traceability Matrix (v2.4)

Status values: **Specified** (designed in this contract, ready to implement) · Blocked by open question · Out of scope. Nothing is marked “fixed” — this is a design contract, not implementation. During the fix mission, the implementing agent appends per-row evidence (test file + name) and flips rows to *Implemented* only with runtime-grade evidence (`11` §11.5). Requirement column cites the governing v2.4 section.

| Issue | Severity | Fix phase | Requirement | Files/routes | Data impact | Runtime impact | UX impact | Tests | Acceptance | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | P0 | 1 | `03` engine: server-render + hydration, full lifecycle | `serve.ts`, `runtime/*`, `presets.ts`, `/lg/:slug`, `/lg/runtime/:v.js` | KV keys only | funnel operational | users answer questions | G1, G2, §11.6 | `03` §3.11 | Specified |
| R2 | P0 | 1 | `04` §§4.1–4.3, 4.7 canonical context into payloads | `runtime-context.ts`, `engine.ts`, `fetch.ts`, `serve-auction.ts` | mig 0040 column | real macro values | trustworthy fields | G2 macro table | `04` §4.9 | Specified |
| R3 | P0 | 1(+2 UI) | `04` §4.4 computed registry + rejection + population | `computed.ts`, `payload.ts`, `ui-payload-builder.ts` | none | computed resolves | dropdown | G2 registry | `04` §4.9 | Specified |
| R4 | P0 | 1 | `05` §5.1 eligibility gate wired ×4; EMPTY_SCHEMA removed | `validation.ts`, `auction/engine.ts`, `auctions-handlers.ts`, `ui-offers.ts` | none | ineligible excluded w/ reason | eligibility badges | G3 | `05` §5.7 | Specified |
| R5 | P0 | 1 | `05` §5.2 activation/variant gate + 409 report + preflight UI | `quotes-handlers.ts`, `sections.ts`, `ui-quotes.ts` | none | invalid Quotes can’t go live | actionable report | G3 | `05` §5.7 | Specified |
| R6 | P1 | 1 | `05` §5.4 version stamping server+engine; config DTO mapping version | `leadgen-events.ts`, `config-dto.ts`, `runtime/events.ts` | none | versioned events | — | G2 shapes | no empty versions on auction path | Specified |
| R7 | P1 | 1 | `03` §3.6 impressions returned + IO beacons + dedupe | `banner.ts`, `serve-auction.ts`, `auction-client.ts` | none | impressions land | analytics non-zero | G1 | one pair per slot per page_view | Specified |
| R8 | P1 | 1 | `04` §4.6 persisted snapshot + fresh request macros at `/lg/lc` | `click.ts`, `runtime-routes.ts`, mig 0040 | mig 0040 | templates resolve | — | G2+G1 redirect | full template resolution | Specified |
| R9 | P2 | 1 | `05` §5.3 tuple v2 (+session, mapping hash, auction version) | `attempt.ts`, `serve-auction.ts` | none | forgeries rejected | — | G3 tamper matrix | 422 per tampered field | Specified |
| A1 | P2 | 3 | `07` §7.2 usage-guarded hard delete + erratum §9.6 | `offers-handlers.ts`, `router.ts`, `ui-offers.ts` | guarded deletes | none | safe delete | G4 | 409 report / clean cascade | Specified |
| A2 | P2 | 3 | `07` §7.3 duplicate draft, new ids, placement required | `offers-handlers.ts`, `ui-offers.ts` | inserts | none | duplicate modal | G4 | draft+untested, nothing operational copied | Specified |
| A3 | P2 | 3 | `07` §7.4 full usage inventory | `offers-handlers.ts` | none | none | usage panel | G4 | all 12 kinds reported | Specified |
| B1 | P1 | 2 | `06` §§6.3, 6.9, 6.10 visual editors; JSON→Advanced | `ui-payload-builder.ts` | none | none | zero-JSON | G5 | `06` §6.14 | Specified |
| B2 | P1 | 2 | `06` §§6.1, 6.8 tree + nested builders | `ui-payload-builder.ts` | none | none | no dotted paths | G5 | nested authored visually | Specified |
| B3 | P1 | 1(+2 UI) | `04` §4.5 placement source/macro threading + pickers | `payload.ts`, `engine.ts`, `fetch.ts`, Test tab | none | correct placement sent | placement group | G2 | multi-placement matrix | Specified |
| B4 | P1 | 2 | `06` §6.12.1 generated sample-answer form | `payload-builder-handlers.ts`, UI | none | none | form-first Test | G4+G5 | passing Test w/o JSON | Specified |
| B5 | P2 | 2 | `06` §6.12.2 simulated context (shared builder) | `payload-builder-handlers.ts` | none | Test≡runtime | context panel | G4 | parity test | Specified |
| B6 | P1 | 2 | `06` §6.11 count + click-to-focus + inline | `ui-payload-builder.ts` | none | none | “N issues”+Jump | G5 | 5-issue focus test | Specified |
| B7 | P2 | 2 | `05` §5.5 pre-test validation, typed 400 | `payload-builder-handlers.ts` | none | none | explained block | G4 | 400+schema_errors | Specified |
| B8 | P2 | 2 | `04` §4.4 UI dropdown from registry | `ui-payload-builder.ts` | none | none | no free keys | with R3 | registry-only keys | Specified |
| B9 | P2 | 2(+1 rt) | `06` §6.4 choiceDisplay + Other renderer; real values only | `payload.ts`, `content-schema.ts`, `runtime/render.ts`, presets | content_json meta | real provider values | main+Other UX | G2+G5 | never literal “Other” | Specified |
| B10 | P2 | 2 | `06` §6.7 six boolean presets | `ui-payload-builder.ts`, `payload.ts` | none | none | preset select | G2 | per-preset shapes | Specified |
| B11 | P2 | 2 | `06` §6.6 date mode + format picker → formatDate | `ui-payload-builder.ts`, `payload.ts` | none | input→provider format | date picker UX | G2+G5 | format matrix | Specified |
| B12 | P2 | 2 | `06` §6.5 explicit free-text toggle | `ui-payload-builder.ts` | none | sanitized strings | clear mode | G5 | toggle disables map | Specified |
| C1 | P1 | 2 | `06` §6.12 Test tab operable w/o JSON (B4+B5+B7+pickers) | Test tab + handlers | none | none | non-technical Test | G4+G5 | end-to-end Test flow | Specified |
| D1 | P2 | 3 | `07` §7.5 two labeled behaviors; enum frozen; erratum | `rules.ts` labels, `ui-offers.ts` | none | none | 2 plain actions | G4+G5 | semantics regression | Specified |
| D2 | P3 | 3 | `07` §7.5 “Evaluation order” label+help | `ui-offers.ts` | none | none | labeled | G5 snapshot | renders | Specified |
| D3 | P2 | 3 | `07` §7.5 per-dimension validators + chips + paste | `validation.ts`, `ui-offers.ts` | none | bad rules unsavable | validated entry | G4 | bad zip rejected | Specified |
| E1 | P1 | 4 | `08` §8.2 Activity/Vertical comboboxes + pair warning | `ui-sections.ts`/studio | none | none | typo-proof | G5 | derived Offer list | Specified |
| E2 | P1 | 4 | `08` §8.7 mapping via pickers + value-map modal + per-row test | studio, `sections-handlers.ts` | none | none | zero raw ids/JSON | G5 | pickers-only mapping | Specified |
| E3 | P2 | 4 | `08` §§8.3–8.6 library/canvas/inspector | `ui-section-studio.ts` | none | none | operator-grade | G5 | §8.12 flows | Specified |
| E4 | P2 | 4 | `08` §8.5 tokenized containers (9) | `content-schema.ts`, `presets.ts`, designs | container nodes | containers render live | patterns achievable | G2+G5 | 4 patterns, no CSS | Specified |
| E5 | P1 | 4 | `09` §9.2 parameterized server-rendered sims; design honored | `sections-handlers.ts`, studio preview | none | none | 9/9 sims | G5 | sims differ; round-trip | Specified |
| E6 | P2 | 4(+1 rt) | `08` §8.8 field-level Maps config + engine wiring | presets, `runtime/maps.ts`, studio | content_json `maps` | autofill/validation live | chips+warnings | G6 | validate+autofill+fallback | Specified |
| E7 | P2 | 4 | `08` §8.10 NumberInput + CurrencyInput presets | registry/presets/schema | none | new inputs render | palette complete | G2 | place/render/map | Specified |
| E8 | P3 | 4 | `08` §8.10 SuccessState + success styling | registry/presets/designs | none | success visible | — | G2 | renders on valid | Specified |
| E9 | P3 | 4 | `08` §8.2 explicit no-Offers empty state | studio mapping panel | none | none | actionable empty | G5 | names pair + links | Specified |
| S1 | P2 | 3 | `07` §7.6 redacted per-offer payload + parser + exclusions in simulate | `auctions-handlers.ts`, `explain.ts` | none | none | explainable dry runs | G4 | payload present, dry | Specified |
| T1 | P1 | 1+5 | `11` §§11.2, 11.6 live-funnel suites + anti-false-PASS | `test-ui/*` | none | none | — | is the work | suites fail on empty mount | Specified |
| T2 | P1 | 5 | `11` §§11.5, 11.7 re-audit + executed signed QA | `docs/leadgen/*` | none | none | — | re-verification checklist | honest matrix + signed QA | Specified |
| M1 | P3 | 1 | `04` §4.3 `referrer` alias | `macros.ts` | none | both spellings | — | G2 | alias resolves | Specified |
| M2 | P3 | 2 | `06` §6.2 grouped macro picker | `ui-payload-builder.ts` | none | none | grouped labels | G5 | groups render | Specified |

**Row count: 42** (R×9, A×3, B×12, C×1, D×3, E×9, S×1, T×2, M×2). Zero rows Blocked-by-open-question; zero Out-of-scope. Every product-owner issue and investigation finding maps to exactly one row; umbrella C1’s normative content lives in B4/B5/B7 + `06` §6.12 so the owner-raised Test-tool cluster is never diluted.
