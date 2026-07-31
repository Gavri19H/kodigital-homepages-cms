# LeadGen R2 — Cutover Pack

**For the owner. 2026-07-31. Branch `leadgen-r2` (P0–P5 merged) + `leadgen-r2-p6` (terminal).**

You rejected the previous build in use across six areas. This is what came back, what it cost,
what still needs you, and what I could not prove without production.

---

## 1. Your six areas — what to look at first

Each row is a thing you can go and do yourself in about a minute.

| Your words | Do this to check it | Evidence |
|---|---|---|
| ① *"you can't treat the whole component as one unit"* | Add a question grid, give each question its own type and default, set one to depend on another. Answer nothing, press Continue — the defaults count. Say "no" to the trigger and the dependent question genuinely stops existing. | `p6/terminal-review/tr1c-*` |
| ② *the templates canvas* | Templates tab — your own section renders in the middle, and switching theme repaints it. | `p6/terminal-review/tr20-canvas-theme-{A,B}-1440.png` |
| ③ *the themes rebuild* | Themes tab — section library left, one live canvas centre, design roles right. Build a preset, set corners to **Pill**, apply it: the live page now follows. | `p6/f1-preset-corners/a-preset-{sharp,pill}-1280.png` |
| ④ *the footer you said was dropped* | It renders at the bottom of a real funnel page, with legal links resolved **per site** — the same saved template serves site A's privacy page on A and site B's on B. | `p6/terminal-review/tr18-live-footer-{1280,375}.png` |
| ⑤ *"pick his desired slider from sliders list!!!"* | All five types, each with its own anatomy, each moves under a real pointer. | `p6/terminal-review/tr10-sliders-1280.png` |
| ⑥ *"the address — one of your worst executions"* | Author it three ways: free text only · street only · street+city autofilled with a manual ZIP. Enter a bad ZIP — it now **says so** instead of blocking silently. | `p6/terminal-review/tr13-c-badzip-375.png` |
| #7B *"the currency is only a graphic feature"* | One currency slider, three offers, three formats picked by **clicking** — your buyer receives `"$170,000"`, `170000`, `"170000"`. | `p6/terminal-review/tr15-*`, provider row id=8 |

---

## 2. What only showed up by driving it

None of the following was caught by a test suite. Each was found by a person operating the product.

- **The theme editor was invisible on a normal laptop.** At 1280px the whole editor column
  computed to zero width. Every control gone. It only appeared above ~1650px, and thousands of
  passing tests never noticed, because nothing asserted the panel had width.
- **A theme's corner setting did nothing.** You could pick Pill, save it, and the live page kept
  square corners. The control rendered, highlighted, saved, and no code read it.
- **Saving a payload schema silently destroyed the offer's response parsing** and then blocked
  activation with a 409 that never explained itself — on the live auction path.
- **Picking a theme then clicking A/B did nothing at all** — a background request landing one
  millisecond later wiped your selection, and the product told you to pick a theme you had
  just picked.
- **An "Other" value row you added and left blank was silently discarded**, with the editor
  reporting "No issues". So was the "Enable Other" checkbox itself if you removed every row.

---

## 3. What needs you — decisions

**Nothing here blocks the deploy.** These are yours to rule on, and each has its evidence.

### 3a. Two things I could not prove without production
| | Why | What resolves it |
|---|---|---|
| **`state=CA` routing** | Needs a real Cloudflare edge; local has no geography. | One request from a CA address and one from elsewhere, at cutover. |
| **Google Maps address autofill** | Your production Maps keys exist but cannot be read locally. | Type an address on the live site and watch it complete. |
| I did not fake either. The keyless behaviour *is* proven honest — it degrades to manual and says so. |

### 3b. Two picture tests waiting on your eye
Two suites compare the rendered page against stored screenshots. Both differ **because of changes
you asked for** — the slider thumb now sits on the rail, and the component library gained the
Phone tile and a renamed grid. Re-blessing those images is a decision about how your product
should look, so I left them failing rather than overwrite them.

### 3c. The list of smaller findings
**~20 registered items** await a fix-or-defer ruling. The register is
`docs/leadgen/source-of-truth/traceability.md`. The ones I would read first:

1. **ADJ-N39** — a theme edit can keep serving the old page for **up to 5 minutes in production**.
   Cache invalidation clears one layer and the read path checks another. Affects colours and fonts
   too, and the code's own comment claims the opposite. Pre-existing; measured precisely.
2. **ADJ-N28** — Image8 shows an autocomplete box above the address fields. I did **not** build it,
   because Image8 is the screenshot of the build you rejected — Maps unchecked, yet the composite
   forced anyway. If you want that box when autofill is configured, say so; it is small.
3. **ADJ-N42** — you named five footer examples (Image28–31, 45). Only two were ever built.
4. **ADJ-N34** — two name fields in one section would collide in the answer space.
5. **ADJ-N44** — editing "brand primary" does not move the Continue button. May be deliberate role
   separation; recorded as unverified rather than guessed.

---

## 4. Cutover checklist

1. **GATE-W89** — confirm the deploy source includes the wave-89 additive modules. A previous
   promotion shipped a stale base and replaced current LeadGen work; this is the guard against a
   repeat. **Check this before pressing anything.**
2. **GATE-LEGALTYPE** — sites whose legal pages were provisioned with the same internal type need
   the drafted remediation, or their footer links omit rather than resolve. The SQL is written,
   idempotent, with preflight, post-check and rollback, and was tested only against a copy of the
   local database. **I have not run it against production and will not.**
3. **Press deploy** — the one-button `workflow_dispatch`. I have never deployed, changed a secret,
   or written to production data in this program.
4. **Immediately after**, verify the specific behaviour rather than a 200: check `cf-cache-status`
   and `age`, then load a funnel and confirm a theme's corners, a slider drag and an address ZIP
   message.
5. **Resolve 3a** in the same sitting, or waive it in writing.

---

## 5. The numbers

| | |
|---|---|
| Unit tests | **7,455 / 7,455** across 448 files |
| Browser tests | **792 / 825**, 92 of 94 files clean |
| Runtime budget | 52,762 bytes of your 53,248 cap — **486 to spare** |
| Register | 132 rows, 0 violations |
| Owner sentences unproven | **2**, both listed in 3a |

Six phases, each gated on a full suite run and a fresh adversarial review that had to drive the
product before it could pass. The terminal review returned SHIP.

## 6. What I would tell you if you asked what worries me

The previous build shipped green and you rejected it. **This one found five real product defects
in its own final phase**, after five phases that were each gated, reviewed and shipped — including
a control that did nothing and a panel that was invisible at a normal screen size. Every one was
caught by driving the product, none by a test.

So the honest read is not "it is now perfect." It is: the things you named are fixed and proven by
use, the process now catches a class of defect it previously could not, and the residue is written
down instead of hidden. **ADJ-N39 is the one I would want fixed soon** — a five-minute stale page
after a theme edit will read as "the theme system is broken" to whoever uses this next.
