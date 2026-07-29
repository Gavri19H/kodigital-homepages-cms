# P2 OWNER REVIEW PACK — ② Templates canvas + ③ Themes rebuild (+ D5, board defects)

Delivered 2026-07-29 (async per F6 — this phase merges on adversarial SHIP; your eye collects at
the terminal gate). Evidence: `docs/leadgen/r2/evidence/p2/review/` (187 screenshots) +
`fixround2/` (12 + drive logs).

## Your words → what was built → the driven proof

1. **"in the middle should be a *CANVAS* so the user will see what he is designing!!! the canvas
   should include one section in the middle"** → ONE preview path now serves empty AND populated
   funnels; the sample section renders INSIDE the full frame. **All nine** funnel-layout elements
   (Background, Logo, Phone/URL, Disclosure, Free text, Brand logos, Footer, Images, Progress)
   change the canvas the moment they're edited — the probe found 0/9 reflecting.
   → `e-00-templates-3pane-1440.png`, `e-99-templates-after-all-1440.png`, `e2-empty-templates-1440.png`
2. **"I want different types of progress bars and to design them with a dedicated box!"** → the
   Progress element has its own design box with all five styles; each renders distinctly (bar vs
   icon-on-track differ only by the thumb — the screenshots are the proof).
   → `p-bar-progress-crop.png`, `p-icon_on_track-progress-crop.png`, `p-dots-…`, `p-label-percent-…`
3. **"I chose a site - why I don't see its logo????"** → root cause was the preview request omitting
   the site; an authored logo now renders in the canvas (a logo-less site still shows the chip).
   → `r5-canvas-logo-1280.png`
4. **"Themes- Add a real section to the canvas … left section chooser by activity/vertical, sticky
   center canvas, right design elements, no duplicate canvases"** → exactly that: three panes, the
   placeholder strip and the embedded second page both gone, ONE canvas, sticky proven by
   measurement (the pane pins while the rail scrolls 1,400px). Three different real sections render
   under the draft theme. **Every** rail affordance — select, role-pick, harmony step, Advanced hex,
   font — moves the canvas live on a brand-new quote, and the same theme now reaches the live page.
   → `t-00-themes-3pane-1440.png`, `t2-sticky-after-scroll-1440.png`, `rex2-major1-01-harmony-1440.png`,
   `rex2-major1-02-advanced-hex-1440.png`
5. **"the buttons design not rich enough … for example - Image23"** → title+subtitle two-line cards
   render **full-width stacked**, including the Other row with its chevron, at 1280 and 375 — the
   theme now owns the width axis your pin implies. → `rex-major2-themecard-visitor-1280.png` (+375),
   beside `docs/leadgen/source-of-truth/images/Image23.png`
6. **"The user should be able to define the 'default' template, but to A/B test different
   templates."** → the default is now **per quote** (migration 0055), with the global as fallback:
   a funnel created after you set it inherits it; an existing funnel with its own template is
   untouched; another quote falls back. → `d5-set-per-quote-default-1440.png`
7. **"the 'themes' and the templates are moving to the top bar, why you kept the old and wrong
   option in the funnel builder??????"** → the funnel-card Template chip now NAVIGATES to the
   Templates tab (it had been opening an apply-popover inside the builder — found by driving, not
   by the probe). → `bd-template-chip-nav-1600.png`
8. **"each page could include more than one section and we should be able to A/B test or creating
   in-funnel rules"** → slot A/B and slot rules are now authorable from the board itself (they were
   API-only), each rendering a plain-language sentence, and a rejected save stays in the dialog with
   the server's reason. Driven live: mobile UA → section X, desktop → section Y.
   → `sl-ab-saved-1600.png`, `sl-ruled-live-desktop-1280.png`, `sl-ruled-live-mobile-375.png`,
   `rex-minor4-ruled-rejected-1600.png`
9. **"the routing rules table has got out of its box"** → formally closed: with six funnels and a
   populated rail, nothing is clipped at 1440/1600/1640/1680.
   → `bd-b3-1440.png` … `bd-b3-1680.png`
10. **"the funnel is decided per user answers … or per the user parameters (UTMs / device/os)"** →
    both entry-plane rules drive into their target funnels with recorded outcomes; non-matching
    visitors get the default. Funnel-level A/B splits 10/10 across 20 sessions; two funnels render
    two different themes.
11. **"'+ create' … with raw JS prompts"** → the whole activity/vertical create flow now fires
    **zero** raw browser dialogs (instrumented) — a studio modal with an inline error, and the
    no-offers gate still gates. → `a10-modal-1440.png`, `rex-minor3-gate-modal-1600.png`

## The honest trail
Two independent fresh-context reviewers drove this phase. The first returned **FIX-FIRST** with two
majors it found by driving what no slice had: on a brand-new quote the inline theme was dropped both
in the canvas and **on the live page**, and the "Full-width cards (Image23)" option didn't actually
control width. The second, auditing the fixes, found the first fix only **half** closed (two of three
Brand-primary affordances still inert) — fixed in a second round with a single convergent seam, then
verified. Along the way the implementer refuted two of the reviewer's mechanism claims with code
proof, and the reviewer retracted both — all on record.

Final gate: **7,215/7,215 tests (435 files)**, typecheck 0, verify:all 0, orphan-scan 0, runtime
bundle unchanged at 51,030, migration 0055 anchored in deploy.yml, F5 deferral scan clean, register
0 violations.

## For your fix-or-defer ruling (out-of-contract, none blocking)
ADJ-N11 (a section's `columns` control is silently inert under a card theme — the ruling is right,
the missing signal isn't), ADJ-N12 (the admin Themes pane clips at 375 — admin-only), ADJ-N13 (a
dead preview chain in the funnel tab still costs one wasted request per palette edit), ADJ-N14 (an
emptied theme `{"palette":{}}` serves ~30 KB of different chrome than a truly empty one). These join
ADJ-N1…N10 in the single list at the terminal gate.
