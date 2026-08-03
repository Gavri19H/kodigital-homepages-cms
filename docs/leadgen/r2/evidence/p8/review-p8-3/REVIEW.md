# P8-3 adversarial review — FIX-FIRST

Reviewer: fresh-context adversarial review #1 for P8-3. Branch `leadgen-r2-p8-3`.
Gate sha `e30d299`; HEAD at review `381c3eb` (diff = docs + 3 gate logs only, verified).
Server: the already-running `wrangler dev` on 127.0.0.1:8901 (client only; nothing started/stopped/bound).
Evidence: this directory. Raw drive logs `r-*.txt`; screenshots `r-*.png`.

## Verdict: FIX-FIRST — 1 BLOCKER, 3 MAJOR, 11 MINOR

## Per-clause table

| Owner clause (verbatim anchor) | Drive evidence | Verdict |
|---|---|---|
| **M2/R3** "theme is only design language!!!! colors, fonts, sizes" — every authorable key paints a visible element or is removed | `r-m2-n18.txt`, `r-m2-cardbg-scope.txt`, `r-m2-pagebg.txt`, `r-m2-cardbg-success-1280.png` / `-375.png` | **DEVIATES** — 5 of 6 contract keys honoured; `card_defaults.background_role` still re-points the global `card_background` role (MAJOR-1) |
| **N1** — no raw enum tokens as labels; Base visual design labelled, duplicate removed | `r-themes-rail.txt`, `r-n1-basedesign-1280.png` / `-375.png` | **PERFECT** (obs MINOR-8: one-option select) |
| **N7** — no select shows a truncated version of its own value | `r-n7-deep.txt`, `r-n7-worst-option-1280.png`, `r-manager-fontselect-zoom-1280.png` | **DEVIATES** — BLOCKER-1 |
| **N11** "Presets are shared across every funnel." | `r-n1-n11.txt`, `r-n11-zero-1280.png` vs `r-n11-real-1280.png` | **DEVIATES** — MAJOR-2, MAJOR-3 |
| **N18** — `display_size` no longer scales the header logo | `r-n18.txt` + served-CSS probe | **PERFECT** (caveat MINOR-6) |
| **N20** — one font vocabulary; only served fonts offered fresh | `r-themes-rail.txt`, `r-manager.txt` | **DEVIATES-partial** — MINOR-1 |
| **B3** (P8-1 regression re-drive) | `r-b3b.txt`, `r-b3b-charlie-panel-1280.png`, `r-b3b-after-apply-1280.png` / `-375.png` | **PERFECT** |
| **B5** (P8-2 regression re-drive) | `r-b5b.txt`, `r-b5b-geometry-1280.png`, `r-b5b-after-drop-1280.png`, `r-b5b-board-375.png` | **PERFECT** |

Full finding list, severities and reproduction steps are in the review's returned report.

---

## Full finding list (persisted by the conductor)

The reviewer returned its complete findings in its report; only the verdict + table had been written
to disk, so a later slice had to work from quotes in its dispatch instead of this file. Recorded here
verbatim in substance so the record is citable. Artifact filenames refer to this directory (60 files).

### Every deviation found, listed before ranking

1. Rail selects `typography.display` / `typography.body` truncate their own value at 1280.
2. Themes-manager font selects truncate their own CURRENT value at 1280.
3. `button_defaults.selected` → "Bigger + check badge" overflows +10.82px at 1280.
4. `card_defaults.background_role` re-points the global `card_background` role token.
5. Disabled preset buttons are visually indistinguishable from enabled ones.
6. Zero-preset select says "create one below" while the help above says "from the Themes manager".
7. Two font vocabularies survive (3 names differ per surface).
8. The re-predicated guard closes the DEAD branch only, not MIS-TARGETED.
9. `roleInUseFrame` routes every colour role through `progress.color_role`.
10. `ROLE_META.brand_primary.used_by` narrowed below measured truth.
11. The board Theme chip prints the raw record id `thm_p8-repro`.
12. New unconditional `throw` on the quote-editor render path.
13. P8-3 added a 4th duplicate `GET /api/admin/leadgen/themes` per Themes-tab load.
14. N18 could not be driven on a visible `.lg-logo`.
15. `Base visual design` is now a one-option select.
16. Guard universe excludes five whole authorable element groups by name.
17. Themes manager at 375 is unusable (`#tm-headline-font` = 14.03px wide).

### Ranked

- **BLOCKER-1 — N7 falsified by a label THIS PHASE created.** contentBox 125.00px vs
  `"Literata (shows as default font)"` 191.43px (+66.43), `"Sora (…)"` +49.31, `"System (…)"` +66.41,
  `themes.ts:287 "Bigger + check badge"` +10.82; manager cell 107.00px vs `"Inter (…)"` 181.2 (+74.2),
  `"Roboto Mono (…)"` +131.2, `"Newsreader (…)"` +122.3. `scrollWidth 207 > clientWidth 149`,
  `text-overflow: clip`, no `title`. Pixels: `r-n7-worst-option-1280.png` reads "Literata (shows as ⌄";
  `r-manager-fontselect-zoom-1280.png` reads "Inter (shows as c⌄". At baseline f240788 the labels were
  bare and fit — fix round F2 lengthened them to 29–35 chars. The conductor measured only the DEFAULT
  option. 375 is fine; 1280 — the operator's normal screen — is broken. Shortening the string did not
  satisfy the clause: it fixed one value and left the box, so the next label overflowed.
- **MAJOR-1 — "Card background" re-points the global role token.** `theme.ts:1470-1471` wrote both
  `design.color.card` and `design.questionCard.background`. Driven with `palette.card_background` and
  `palette.page_background` pinned in BOTH arms, error→success moved `.lg-question-card` (intended),
  `input.lg-input` (4/4 visible, 326×54) AND `.lg-frame-background` (1280×900 fixed overlay). Control
  arm: all three `#FFFFFF`. So a component control silently overrode the operator's own palette swatch
  — a different control in the same rail. Sweep stamped it ALIVE; it never measured the frame.
  `r-m2-cardbg-success-1280.png`. Reviewer self-corrected an initial mis-read that blamed
  `palette.page_background` (`r-m2-pagebg.txt` refutes it).
- **MAJOR-2 — N11's disabled state is invisible.** Both states: colour/background/border/opacity/
  filter/text-decoration identical, `cursor: pointer` in both; a forced click surfaces `[]` — no
  message. Only a `title` tooltip. Explicitly cleared as NOT a §1 hardening violation.
- **MAJOR-3 — the zero-preset panel contradicts itself.** Help: "…save one from the Themes manager…";
  the select beneath (`funnel.ts:3926`): "No presets yet — create one below". Nothing is below. That
  string is contract M9.4's own cited lie, rendered inside N11's panel in N11's state.
- **MINOR-1** N20 unmet: 8 of 11 names converged; rail keeps Literata/Sora/System, manager keeps
  Newsreader/Inter/Roboto Mono. The `(shows as default font)` copy is factually correct.
- **MINOR-2** the guard cannot catch the class that produced MAJOR-1; its red-proof only injects a
  selector nothing renders. Exemptions independently falsified as honest; the pseudo-selector skip
  makes the predicate stricter, hides nothing.
- **MINOR-3** `roleInUseFrame` proves every colour role through the progress bar, not its own consumer.
- **MINOR-4** `shared.ts:493` narrowed `brand_primary` below truth — "progress fill" was true.
- **MINOR-5** board Theme chip prints `thm_p8-repro` (`funnel.ts:440-444`).
- **MINOR-6** N18 proven on served bytes; the fixture site has no logo so `.lg-logo` matched 0 nodes.
  Not a defect — an evidence gap to close when a site logo exists.
- **MINOR-7** `quotes-handlers.ts:6958` throws on the editor render path for an unlabelled design id.
- **MINOR-8** `Base visual design` is now a one-option select (clause met; no choice remains).
- **MINOR-9** 4× `GET /api/admin/leadgen/themes` per Themes-tab load; P8-3 added one.
- **MINOR-10** the guard's "CLOSED universe" is closed over scalars only.
- **MINOR-11** Themes manager at 375: `#tm-headline-font` = 14.03px wide (pre-existing, worsened).

### Audits that PASSED

Gate log sha == HEAD `e30d299`, tree clean, all exit codes present, counts recomputed by hand and
reproduced exactly. Zero-drift independently recomputed. F1's 8 pin updates all genuinely
product-correct (the byte-pin reverse-map still requires the new rule verbatim). p3a ×3 clean — no
hand-edited fixture. No SQL added; a CSS-injection probe against the real route returned HTTP 400 with
the funnel unchanged. No secrets touched; the empty `GOOGLE_MAPS_*` slots left as found.
B3 and B5 re-driven: both PERFECT.

### Reviewer's own two self-corrections

An apparent wrong-funnel write was its regex matching "Delta *Echo*"; an apparent silent drag no-op was
its harness using a document-space y as a viewport coordinate. Both product behaviours are correct.
