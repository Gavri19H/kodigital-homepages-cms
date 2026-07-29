# P1 OWNER REVIEW PACK — ① Question-Grid container (OWNER-BLOCKING, D10)

Delivered 2026-07-29. **This pack blocks: P1 merges and P2 dispatches only on your dated
approval** (a dated reply approving this pack; or direct fixes and the phase re-opens with your
words verbatim). All evidence below is committed under `docs/leadgen/r2/evidence/p1/review/`
(75 screenshots: the full adversarial drive + the `refix-*` re-drive).

## Your words → what was built → the driven proof

1. **"you can't treat the whole component as one unit … Each question in the component is
   independent field"** → ONE palette component ("Questions on one screen" tile; component label
   "Question grid") whose children are real, independent-field questions. Driven: one insert → one
   container with 5 children; the provider payload carried FIVE distinct fields from that one unit.
   → `a1-container-inserted-1600.png`, `vg-poor-1280-04-q5-answered.png`
2. **"inefendent defaults!!"** → per-question Default controls, live (edit a choice label → the
   Default select follows without save+reload), and **the authored default IS the answer**: the
   popped-in dropdown shows it and Continue is accepted untouched — your "if we set a 'default' and
   the user didn't change it - this is his answer and the 'required' rule is met", driven.
   → `a2-a3-live-default-1600.png`, `refix-b2-1280-02-yes-default-hex.png`, `refix-b2-1280-03-after-continue-untouched.png`
3. **"independent style"** (your D4 ruling: full axes incl. free colors) → per-question style
   deviation incl. a FREE-HEX color control; `#7B2FF7` on Q1 painted Q1 only, siblings on theme, at
   1280 and 375. → `refix-d4-hex-control-1600.png`, `refix-b2-375-02-yes-default-hex.png`
4. **"independent rules!" + "HOW DO I SET DROPDOWN???"** → the dependency editor speaks question
   terms: "Show this question when [sibling question, by its own label] [is / is not / one of /
   not one of / greater / less / between] [that question's ACTUAL answers]" — type-agnostic on both
   sides (your clarification): the review authored Q5 Buttons shown when the Credit-Score DROPDOWN
   is one of [Poor, Fair]. → `a3-dependency-editor-1600.png`, `a4-nonboolean-dependency-1600.png`
5. **"you left a lot of dead parts"** → the grid editor exposes NO Helper text / Answer format /
   sub-questions / Main question (whole-page text scan = empty). → `a6-grid-editor-full-1600.png`
6. **"+Add a question … small, out of the component"** → measured: ghost 120px wide vs the 506px
   component, a SIBLING outside the box; adding a question changed nothing about the component's
   width/border. Same pattern verified on every per-question "+ Add choice".
   → `recon-after-insert-1280.png`
7. **"marked/checked and only being tracked after … 'continue'; the user answer is the one that is
   being saved"** → no click advanced the page; the auction fired only on Continue; the visitor's
   override beat the default in the payload. → `vg-poor-1280-06/07` series
8. **"if the user clicked 'no' … it doesn't exist"** → the hidden question's LABEL disappears with
   its control, it is not required, and — after a server-side fix this phase — its default is NOT
   billed to the offer: the provider-log row for the No attempt omits the field entirely.
   → `vg-no-1280-02-no-q2-hidden.png`, `refix-b3-1280-02-no-hidden.png`
9. **"help us to decide the user jurney (the funnel)"** → a routing rule keyed on a grid question's
   field routed the matching visitor into its target funnel (recorded outcome + rule hash);
   non-matching visitors got the default; a flat control section routed IDENTICALLY (two-arm proof).
   → `a11-quote-board-rules-rail-1600.png`
10. **The ✓ inside the chosen button** (your Image4 pin) → white ✓ on a filled disc inside the
    selected button — the faint-contrast nit lifted. → `vg-poor-1280-04-q5-answered.png` (+375)
11. **The 18.30.25 reference** → the driven screen: stacked labeled questions, mixed types, the
    dependent dropdown popping in, ONE Continue. Place `vg-poor-1280-04-q5-answered.png` beside
    `docs/leadgen/source-of-truth/images/Screenshot 2026-07-27 at 18.30.25.png` — your eye is the
    judge here.

## How it was verified (the honest trail)
- Phase gate: full suite **7,128/7,128 (429 files)**, typecheck 0, verify:all 0, runtime bundle
  51,030 bytes (+197 of the +250 grid budget; cap 53,248) — raw log `docs/leadgen/r2/gate-logs/phase-1.log`.
- A fresh-context adversarial reviewer authored + drove everything itself and first returned
  **FIX-FIRST with 3 real blockers ON YOUR SENTENCES** (typing a question label was destroyed by a
  re-render; the authored default never became an answer so Continue blocked; a hidden question's
  default was injected into the offer payload server-side) **+ 1 major** (free colors not authorable
  — your D4 ruling undelivered). All were fixed in-phase with fail-before/pass-after regressions;
  the reviewer re-drove every closure and returned **SHIP**.
- One prior-era test pin ("no free-color input, §9.4") was narrowed under your D4 ruling — role
  controls stay selects-only; the free-hex control is now positively pinned.

## Honest notes (nothing hidden)
- A scripted (non-browser) POST could still assert an answer for a dependency-unmet question — the
  server gates DEFAULTS by visibility but trusts submitted values; real browsers omit hidden fields
  (driven). Registered as ADJ-N9 for your fix-or-defer ruling (hardening, P5-adjacent).
- The rules-rail card now names the QUESTION for the field side; the VALUE side still shows the raw
  value (`excellent_…`) — ADJ-N8, your ruling, natural home P2.
- A Continue-less multi-answer section can activate "clean" and dead-end the visitor — found while
  driving, outside every P1 clause — ADJ-N7, your ruling.
- A malformed hex typed into the new color box is silently ignored (value keeps the last valid) —
  matches the existing color-axes behavior; noting, not registered.

## What your approval does
A dated reply approving this pack → P1 squash-merges into the mission chain and P2 (② Templates
canvas + ③ Themes rebuild) dispatches. A reply directing fixes → the phase re-opens, your words go
verbatim to the implementers, the reviewer re-drives, and the pack returns to you.
