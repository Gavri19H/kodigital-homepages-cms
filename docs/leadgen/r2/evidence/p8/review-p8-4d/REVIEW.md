# P8-4 fix-round re-review — F10 + F11 only — **FIX-FIRST**

Scope: fix rounds **F10 + F11** at gate sha `c507ea49` (branch `leadgen-r2-p8-5`, whose first
commit `45053dfe` adds only `docs/leadgen/r2/gate-logs/p8-phase-4-run6.log` —
`git diff --stat c507ea49 45053dfe` = 1 file). F10/F11's own diff is 6 files:
`api/src/admin/leadgen/frame-handlers.ts`, `api/src/public/leadgen/designs/frames.ts`,
`api/src/public/leadgen/designs/default-funnel/styles.ts` (all three **comment-only** —
verified: 0 non-comment changed lines), `api/test/leadgen-p8-m3-apply-template.test.ts`,
`api/test/leadgen-r2-dead-controls-guard.test.ts`, `docs/leadgen/r2/P8-REGISTER.md`.

Drove the already-running instance on :8901 as a CLIENT (never started/stopped/bound it).
14 artifacts at 1280 **and** 375 in this directory. Everything authored was restored
(`templates.ts` shasum back to `8d4527c3811eb3fc62552bfbc27d0f810b13c5dd`; four driven quotes
and one frame-template record deleted through the real routes).

## Per-clause verdict table

| Claim under review | Drive evidence | Verdict |
|---|---|---|
| **F10-1 — the new check catches a HELPER-emitted control for an exempted key** | Injected `frameSelect("Slot padding", "section_slot.padding", …)` into `templates.ts`; `npx vitest run test/leadgen-r2-dead-controls-guard.test.ts` → **1 failed / 62 passed**, `exemption section_slot.padding … expected [ 'templates.ts' ] to deeply equal []` | **PERFECT** |
| **F10-2 — …and a LITERAL-attribute one too** | Injected `<select … data-frame-key="section_slot.padding">`; same file → **1 failed / 62 passed**, same assertion naming `templates.ts` | **PERFECT** |
| **F10-3 — `offeredIn` "resolves a control in EVERY shape the panels emit"** (test:1338-1339, :1627-1628; exemption reasons :1346/:1351) | `s3-sabotage-live-control-1280.png` shows an unlabelled Slot-padding select live in the real **B · Logo** inspector; `drive.log` `[S3-3]` shows the real Save PUT `{"frame_config_json":{"section_slot":{"padding":"s"},…}}` and `[S3-6]` the served `effective_frame.section_slot.padding = "s"` — while the guard stays **63 passed / 0 failed** | **DEVIATES (MAJOR-1)** |
| **F11-1 — a real Save PUTs the stored column + only the touched paths** | `a2-logo-panel-align-left-1280.png` (Logo → Alignment → Left through the real control), `a3-after-save-1280.png` (banner "Saved."); intercepted PUT body `{"frame_config_json":{"header":{"logo_align":"left"},"template":"centered","version":1}}`; column read back identical | **PERFECT** |
| **F11-2 — the 28→2 correction: comparable 29 · shadowed 2 · honoured 27** | Independently recomputed live against the REAL driven column and a template created through the real `POST /frame-template-records`: F11 fixture column → **29 / 2 / 27** (`back.label`, `header.tagline`); old whole-projection fixture → **28 / 27 / 1**. Raw logs agree: run5 `29 · 28 · 1`, run6 `29 · 2 · 27` | **PERFECT (arithmetic)** |
| **F11-3 — the new fixture is "what the product writes"** | The real Save also stamps `template` (funnel.ts:1926-1927); the fixture writes `version` but not `template`. Measured impact **zero** (census case C identical) — but the two leaves it calls "the operator's own customisations" are **not authorable by any control**: `header.tagline` has 0 occurrences in `src/admin`; live enumeration of every `[data-frame-key]` across all six editor tabs at 1280 and 375 = **18 keys** (`k-live-controls-1280.png` / `-375.png`), none of them `header.tagline`, `back.label` or `section_slot.*` | **DEVIATES (MAJOR-2 / MINOR-2)** |
| **F11-4 — three false in-file claims corrected** | `frame-handlers.ts:675-696` matches the code and the frames.ts F9 invariant ✓; `frames.ts:2181-2199` line citations 1696/1809/1877-1886/1921-1933 all correct and the quoted PUT body matches mine ✓; `styles.ts:2661` opening grep re-verified 0 hits ✓ — but its tail clause is newly false | **DEVIATES (MINOR-1)** |
| **Visitor unaffected** (comment-only src diff) | `v-visitor-1280.png` / `-375.png`: HTTP 200, white card `border-radius 16px` + shadow, `animationName none` / `opacity 1` (F9's revert holds), `scrollWidth == innerWidth`, 0 console errors — **pixel-identical** to review-4c's certified `j16-visitor-restored-1280.png` | **PERFECT** |

## Findings

### MAJOR-1 — `offeredIn` is blind to single-quoted key paths; a live dead control keeps a green exemption
`api/test/leadgen-r2-dead-controls-guard.test.ts:1276` — `s.text.includes(`"${keyPath}"`)`.
Violates the F10 comment at :1338-1339 ("EVERY shape the panels emit") and the two exemption
reasons at :1346/:1351 ("the shape that catches BOTH ways a control is written"), which are
what §4 R3's second branch rests on. DRIVEN: a `data-frame-key='section_slot.padding'`
control renders, writes, saves, stores and serves (`drive.log` `[S3-2]`..`[S3-6]`,
`s3-sabotage-live-control-1280.png`, `s3-sabotage-after-save-1280.png`) and paints nothing
(F9 reverted its CSS) — with the guard at 63/63. Not hypothetical: `quotes-tabs/funnel.ts:2016`
already writes four frame paths single-quoted (`'back.label'`, `'disclosure.link_label'`,
`'disclosure.text'`, `'header.cta.label'`) and the island layer is single-quote-idiomatic.
The nine per-emission-shape pins at :1660-1682 cannot detect the class either — every one
anchors on `` `"${key}"` ``.

### MAJOR-2 — ADJ-P8-39 asks the owner to rule on a sentence that is not true of the product
`docs/leadgen/r2/P8-REGISTER.md:138`: "the 2 shadowed are exactly the operator's own edits
(`back.label`, `header.tagline`)". No operator can author either leaf (0 admin occurrences of
`header.tagline`; `back.label` only in a normalisation map). The number survives — my census
with two genuinely offered-control edits (`header.logo_align`, `header.logo_size`) gives
**comparable 27 · shadowed 2 · honoured 25** — but that measurement does not exist anywhere in
the phase, and the row as written invites "the pre-fix behaviour was already right for
operators" from a fixture that never used an operator-reachable leaf. Same misdescription at
`test/leadgen-p8-m3-apply-template.test.ts:333-335`.

### MINOR-1 — the F10-corrected `styles.ts` comment carries a new false measured claim
`api/src/public/leadgen/designs/default-funnel/styles.ts:2671-2673`: "the only `section_slot`
mention anywhere in admin is … (quotes-tabs/templates.ts:2190)". `grep -rn section_slot
src/admin` = **7 hits / 5 files**, including two real reads (`sections-handlers.ts:1904-1905`)
and an operator-facing group label (`quotes-tabs/shared.ts:636`). The `"section_slot`-prefixed
grep the sentence opens with is genuinely 0 ✓; the tail clause is not.

### MINOR-2 — the "realistic" fixture still diverges from the real Save
`newSavedFunnel` (:324-343) omits `template`, which `writeConfigValue` always stamps.
Zero measured impact (census case C == case B, because `frames.ts:944` strips `template`/
`version` from the funnel layer) — but it is a residual gap in a fixture justified as
"saves the way the product saves".

### MINOR-3 — `FAIL-BEFORE` no longer fails before
`test/leadgen-p8-m3-apply-template.test.ts:422` under `describe("… applying a template changes
what the page paints")` now asserts the pre-fix write already moves 27/29 leaves and preserves
the operator's copy. FAIL-BEFORE and PASS-AFTER now differ only on the 2-leaf delta.

### MINOR-4 — two narrow checks lost in the F9→F10 replacement
The old `/data-frame-key="([^"]+)"/` scan flagged ANY `section_slot*` literal (an undeclared
member, or the bare group key); the new leg tests only the 9 declared
`FrameSectionSlotConfig` members.

### MINOR-5 — the reviewed worktree was mutated concurrently
P8-5 edits landed during this review (`ui-section-studio.ts`, `sections.ts`,
`content-schema.ts` at 16:59-17:00; `styles.ts` — a P8-4 file — plus new spec/test files
by 17:20). Every P8-4 file was verified byte-identical to `c507ea49` **before** the sabotage
runs, and none of the concurrent edits touches a frame key; but `[status-empty=yes]` is no
longer reproducible here.

## On ADJ-P8-39: do NOT unwind at this stage — agreed
The corrected number changes the SIZE of the pre-fix defect, not the correctness of the
post-fix behaviour; the other three M3 legs (four false dialog promises, no dry-run, A/B arms
byte-identical) were independently driven and are real, and the materialise write is what makes
`changes`/`replaced_customisations` computable and un-shadowed the arms. Reverting now is a
large behavioural change into a phase that has produced a defect every round, with no gate
covering the reverted shape. Keep it, ship the ruling to the owner — but fix MAJOR-2 first so
the row they rule on is true, and add the operator-authorable measurement (27/2/25) to it.

## Gate-log audit (recomputed, nothing re-run)
`docs/leadgen/r2/gate-logs/p8-phase-4-run6.log`
* `HEAD: c507ea4936d2586ce4901df487591b8f50394ff3` == gate sha ✓; `[status-empty=yes]` line 4 ✓.
* Five exit codes present and 0: `TYPECHECK_EXIT`, `VITEST_EXIT`, `VERIFY_ALL_EXIT`, `RUNTIME_EXIT`, `REGISTER_EXIT` ✓.
* Recomputed by parsing every `test/… (N tests)` line: **492 pass files + 2 skipped = 494**; **8252 passed + 30 skipped = 8282** — matches the summary exactly ✓.
* `verify:all` 0 ✓ · jargon `TOTAL: 0` ✓ · golden UNCLASSIFIED 0 / stale 0 ✓ · bundle `52930 bytes, 99.4%` ✓ · register `rows checked: 83 / TOTAL violations: 0`, independently recounted 83 data rows (6 headers, 6 separators) ✓.
* `[R3 sweep] … TOTAL=130` ✓ (34+25+67+4); dead sets `toEqual([])` on all three legs; 6 exemptions, exact-set pinned, each with a reason > 120 chars — 5 of 6 reasons verified TRUE by drive/grep; the 2 `section_slot` reasons are true of the product but rest on a scan with MAJOR-1's hole.
* **Zero-drift recomputed my own way** (per-file counts, phase-3-run9 baseline → run6): **0 pre-existing files removed**, **7 added**, exactly **1 changed** (`leadgen-r2-dead-controls-guard` 58→63; the dispatch's "26→63" uses an older baseline). Pre-existing sum 8156 → 8161. run5 vs run6 per-file diff is **empty** (F10 changed assertions in place).
* No rebaseline / untouched surfaces, phase-scoped (`351af3d2..c507ea49`): `api/src/admin/templates/**`, `api/test/conversions-admin-shell.test.ts`, `api/test-ui/__screenshots__/**` → **empty diff** ✓.
* No `wrangler deploy|secret`, no `--remote`, no `npm update|upgrade` in any P8-4 commit's code (the only matches are prose inside review markdown). `api/.dev.vars`: both `GOOGLE_MAPS_*` values length 0 ✓.
* Deferral scan over c507ea49's added lines (`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now", `defer(red)? to (v2|later|a follow-up)`, `simplified for (now|v1)`, `will be (done|added) later`): **0 hits**.
* **Reduced-model hunt, marker-free:** the three `src` files change **comments only** (0 non-comment lines) — no fewer fields, no locked options, no dead controls, no placeholder content added. The one reduced model found is MAJOR-1: a policing mechanism narrower than its stated property.
* **Every-consumer:** no interface, schema or route changed; `newSavedFunnel`'s return type is unchanged and all 7 call sites in the file destructure `funnelPublic` only (`:424, :499, :599, :679, :696, :697, :794`).
* **Security:** comment-only src diff — no SQL, no new route, no authz change, no secrets, no unparameterised query, no new parsing of external input.
* **F10's own numeric claims, all verified TRUE:** the old regex returns exactly 9 strings (5 × `${escapeHtml(key)}` at shared.ts:1115/1120/1125 + templates.ts:743/760, 2 querySelector literals at templates.ts:1955/2009, 2 real emissions at templates.ts:716/725); `>5` therefore passed only on the five non-keys; 24 of the 25 offered keys are not literal attributes; `offeredIn("template") == ["ab.ts"]`.
