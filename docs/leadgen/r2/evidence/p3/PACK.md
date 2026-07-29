# P3 OWNER REVIEW PACK — ④ the footer / bottom-of-page element "J"

Delivered 2026-07-30 (async per F6 — merges on adversarial SHIP; your eye collects at the terminal
gate). **This is the task you said was dropped at every prior intake** — its text appeared in no
earlier project document. Evidence: `docs/leadgen/r2/evidence/p3/` (review + fixround + review's
`rex3-*` closure set).

## Your sentence → what was built → the driven proof

Your A.2 clause, in order:

- **"free text (rich toolbar)"** → a real toolbar: bold, italic, link (via a proper modal, not a
  browser prompt), headings at any level 1–6, bulleted and checklist lists. Clicking the buttons
  formats — proven by driving, not by typing HTML.
- **"links to legal pages (from the 'pages' tab) that the user is choosing"** → a picker fed by
  your Pages plane, resolved **per serving site**: one saved template serves site A's privacy page
  on site A and site B's on site B, with a manual-URL fallback and — never a dead link — omission
  when a site has no match. → `rex3-img28-alpha-1280.png`, the bravo/charlie/delta captures
- **"Logo"** → site logo or manual, now size-constrained (a 2000px asset renders at 128×32).
- **"company details"** → the gray details paragraph with its inline NMLS link, matching Image28.
- **"could use different color, font and sizes then the main template"** → the footer's own design
  box: independent font family, sizes, background/text/link colours, per-block alignment, and an
  underline-links axis.
- **"Here are some exmamples … Image28 … Image45"** → **both rebuilt through the real editor and
  driven as a visitor at 1280 and 375**: Image28's six DISTINCT legal links with " | " separators;
  Image45's dark band, left-aligned body and headings, attached bullets, underlined links,
  "All Rights Reserved", centered constrained logo. → `rex3-img28-alpha-{1280,375}.png`,
  `rex3-img45-alpha-{1280,375}.png` — place each beside its pin.

The footer renders at the bottom of **every** funnel page, reflects live in the Templates canvas
(including the independent font), and shows identically in the Sections-tab preview.

## What the drives caught that no test could

1. **Element J could not render at all.** Authored, saved, validated — and invisible to visitors:
   a saved template's design never reached the serve path (and a sparse one crashed it). Root-fixed;
   this affected *any* template-seeded funnel, not just footers.
2. **One benign save silently wiped the footer, permanently.** Change the text size, hit Save, and
   the editor — which had hydrated from a different truth than the server serves — persisted an
   empty block list. It said "Saved". Root-fixed: the editor now hydrates from the served truth,
   plus a guard so an untouched block list can never be blanked.
3. **Picked legal links could point at the wrong page.** Your stock sites seed Privacy, Terms,
   Do-Not-Sell and Contact all with the *same* internal type, so distinct picks collided — three
   legally-distinct links serving the Privacy Policy. Found by investigating a 1-in-29 test flake
   rather than retrying it. Fixed at the source (each page now carries its own type) and made
   fail-safe: where a type is still ambiguous the resolver uses your manual URL or **omits** the
   link rather than guessing. On a compliance surface, a missing link (visible to you) beats a
   wrong one (invisible).
4. **Image45 was not reproducible**: the per-block alignment control emitted an attribute no CSS
   matched (everything centered), the new heading/list blocks shipped unstyled, links could not
   underline, and the "Checklist" style was offered, stored, and then ignored by the renderer. All
   fixed.

## Gate
typecheck 0 · **vitest 7,328/7,328 (443 files)** · verify:all 0 · orphan-scan 0 · runtime bundle
unchanged (51,030) · exactly ONE footer tile · F5 deferral scan clean · register 99 rows / 0
violations. Two fresh-context adversarial reviews; the second re-drove every closure and returned
SHIP.

## Needs your ruling
- **GATE-LEGALTYPE (cutover):** sites whose legal pages are already mistyped need the drafted
  remediation applied — or a re-provision — so their existing footer links resolve instead of
  omitting. The SQL is drafted, idempotent, with preflight/post-check/rollback, tested only against
  a copy of the local DB (48 rows / 12 sites there). **I will not run it against production.**
- **ADJ-N18** (the reviewer's "put this in front of the owner first"): on a site that renamed its
  legal slugs *and* has two differently-labelled picks pointing at one same-typed page, both land on
  that page. Off the default path; manual URL is the escape.
- ADJ-N16 (footer colours are references into the main palette rather than free colours),
  ADJ-N17 (the tile is labelled "G · Footer", not "J"), ADJ-N19 (page provisioning is async).
