# P8-4 — conductor's own verification of the apply-template journey

Review #1 of P8-4 filed **F-10: the phase shipped zero conductor evidence artifacts** (contract §2/§10.4).
This closes it. Driven by the conductor against the running local instance, real Chromium at 1280.
Script `api/scripts/p8/drive-p84.mjs` (mission evidence tooling, never wired into CI). Raw: `drive.txt`.

## What was verified, and the numbers

| Leg | Measured |
|---|---|
| dry run on a pristine funnel | `changes=6`, **`replaced_customisations=[]`** — the F-1 defect (a previous apply counted as the operator's own edits) does not reproduce |
| apply | HTTP 200, `changes=6` |
| what gets stored | **2 leaves** — `{"version":1,"template":"centered"}`. The fix stores the funnel's DIFFERENCE from the template base, not a copy of the template |
| re-apply | `changes=0`, `replaced=[]`, confirmation reads *"This template matches what the funnel already shows — nothing on the page changes."* |
| applying a DIFFERENT template | 3 frame properties moved: `lg-frame--centered` → `lg-frame--header-footer`; header `--center` → `--left`; slot **`--card` → `--bare`** |
| is the confirmation true? | it said *"The question unit changes from a card to a bare layout"* — the slot class moved `--card` → `--bare`. **True of the result.** |
| page errors | none, across every load |

Fixture restored afterwards and verified by re-reading: `frame_config: {}`, `frame_template_id: None`,
visitor renders the default `lg-frame--centered`.

## A conductor error, corrected in place

My first pass sampled `.lg-question-card` presence as the card-vs-bare signal and reported "the page did
not change". That was wrong: `.lg-question-card` is the per-question wrapper and exists on every page
regardless of the frame's `section_slot.card` — I had already measured 10 of them on this page during
P8-3. The frame's own classes are the real signal. The probe now samples those and carries the mistake
in its own comment. My first run also posted a built-in arrangement id (`"centered"`) where the handler
resolves against the SAVED-records table, and read the 400 as a product fault before reading the handler.

## Two findings this drive produced

**1. `header.sticky` is class-only — it corroborates the guard's red.** The served header carries
`lg-frame-header--sticky` while its computed `position` is **`relative`**, at every sample. The class is
present and nothing paints it. `header.sticky` is one of the seven keys the corrected paint predicate
flagged, and this is an independent, driven confirmation from a different instrument.

**2. Clearing a template leaves its look behind.** `POST apply-template {template_id:null}` clears the
pointer (`frame_template_id: None`) but leaves the materialised `frame_config` intact — after unlinking,
the funnel still rendered `lg-frame--header-footer`. That is arguably correct under the new materialise
semantics (the values are now the funnel's own), but it is a semantics change an operator could read
either way: "remove the template" leaving the page identical is defensible, and so is expecting a revert.
The handler's own doc comment says `{template_id:null}` "clears the pointer" and does not say the look
stays. Surfaced, not decided.
