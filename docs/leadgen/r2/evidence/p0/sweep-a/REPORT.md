# P0 baseline sweep — cluster A (studio clauses) — 2026-07-28

Method: fresh `db:reset:local` + `seed:leadgen-fixture`; authored via the real admin APIs /
Studio; driven as a real visitor (Playwright chromium, real UA) at 1280 and 375. Evidence in
this directory (17 files, commit 3813c9a). Verdicts recorded by the conductor from the sweep
agent's driven evidence (agent verdicts are leads; screenshots are the proof).

| Clause | Owner expectation (short) | Verdict | Evidence |
|---|---|---|---|
| 4a ✓-in-button | "the √ inside the button for the chosen answer" | RE-PROVED — ✓ renders inside the selected button (wash + faint white check; the contrast nit is real and is lifted in P1 per Contract §2) | 4a-check-in-button-1280.png, 4a-check-in-button-375.png |
| 4b phone mask | "(3)-3-4 … (___)-___-____; (2)-4-1 … (__)-____-_" | RE-PROVED — authored the owner's literal hyphen patterns: progressive fill "(555)-123-____" byte-exact; incomplete input BLOCKS Continue with "Enter a complete phone number."; "(2)-4-1" fills "(12)-3456-7" | 4b-phone-mask-a-fill-*.png, 4b-phone-mask-a-blocked-*.png, 4b-phone-mask-b-fill-*.png |
| 4c Other-dropdown | "'other' group - a dropdown element, inside the button … same for Cards" | RE-PROVED on Buttons AND Cards — base choices intact; Other reveals a dropdown of the 3 authored values; selection records (required satisfied → Continue) | 4c-buttons-other-*.png, 4c-cards-other-*.png |
| 4d cards centered + add outside | "why the cards are aligned to the left and the '+ add choice' is inside the component and widening it???" (fixed state = opposite) | RE-PROVED — visitor cards centered (wrapped row centered); Studio "+ Add choice" is a small sibling BELOW the component box, non-widening | 4d-cards-centered-*.png, 4d-cards-studio-ghost-*.png |
| 4e dropdown editor clean | "why is there 'enable other group'???" (fixed = absent) | RE-PROVED — Dropdown inspector full-height capture shows no Other-group control ([data-other-editor-block] hidden); the KNOWN leftover on the Offers Payload Builder (ui-payload-builder.ts ~:624) confirmed still present — in SRC-10's P5 scope | 4e-dropdown-editor-clean-1280.png |

## Separator-variant note (resolves the sweep agent's flagged "conflict" — no owner ruling needed)
The mask grammar preserves the operator-authored literal separators: this sweep proved the
owner's HYPHEN patterns byte-exactly; the 2026-07-27 probe proved the SPACE variant
("(3) 3-4" → "(___) ___-____") the same way. Both are expressions of the same
operator-defined-pattern mechanism the owner demanded; the owner's verbatim examples are
satisfied as written.

## New adjacent defects found by this sweep (register rows ADJ-N2, ADJ-N3)
1. `aria-invalid` is never set on failed Phone/Email validation — `setFieldError`'s
   querySelector targets a void `<input>` that cannot have descendants (runtime `render.ts`).
2. Raw-API `PATCH /sections/:id` (200, D1 updated) does not reliably propagate to live
   `/lg/<slug>` SSR (reproduced 8s+ no-convergence; browser needed 40s+), while Studio-UI
   Save converges instantly. Correlates with `scheduleSectionContentInvalidate(...)` called
   without `await` (`sections-handlers.ts:1173`) — the d1-database-safety fire-and-forget
   class. Mission-operational rule until ruled: API-authored drives must poll for
   convergence before judging verdicts.
3. `aria-checked` never updates on selection — already tracked as ADJ-R8 (P5); re-confirmed.
