# M8 — "emptying a shared page leaves it live for visitors" DOES NOT REPRODUCE

Driven by the conductor on the live local instance before P8-6 was dispatched, because a read-only
scout found the described mechanism absent from the code and M8 is NOT in the contract's §8
"already fixed" list — an ambiguity that had to be settled by measurement, not by reading.

## The contract's claim (§6 M8)

> `PUT /quotes/:id/shared-page {slots:[]}` removes the slot but leaves an orphan
> `leadgen_funnel_variant_sections` row (`slot_id=NULL`); the admin reports `sections: []` while the
> resolver's by-`page_id` fallback still serves it (measured: 2 sections after the "emptying" PUT,
> 1 after deleting the orphan).

## What the product actually does at this HEAD

Quote `lgq_01KZ271383Y0MPV4BM2WKKCC4W`, shared page `lgpg_01KZ27139JWN7A4TZ1PAW7PH31`, one section
("R2Fix Fixture Shared Continue", `lgs_01KZ27138G80K46S7XBWKGA764`).

| Step | Result |
|---|---|
| baseline visitor page | `r2fix_shared_cont` present |
| `PUT {"slots":[]}` | HTTP 200; response `sections: []`, `slots: []` |
| admin GET after | `sections: []` |
| **visitor page after** | question count dropped by the shared section's questions; **`r2fix_shared_cont` count = 0** |
| restore `PUT {"slots":[{"position":0,"kind":"fixed","section_id":"lgs_…764"}]}` | HTTP 200; admin shows the section at position 0; `r2fix_shared_cont` back to 1 |

**The emptied page does not keep serving.** The admin and the visitor agree.

## Why, from the code (scout-grounded, conductor-confirmed by the drive)

`updateSharedPageHandler` (`quotes-handlers.ts:2496-2615`) runs an **unconditional**
`DELETE FROM leadgen_funnel_variant_sections WHERE quote_id = ?` (`:2573`) plus
`DELETE FROM leadgen_funnel_page_slots WHERE page_id = (…)` (`:2575`) and then reinserts from the
prepared list — which for `{slots:[]}` is empty. There is no `slot_id`-filtered delete that could
strand a row, and `grep "slot_id IS NULL"` across `api/src` returns **0 hits**. The resolver's
by-`page_id` fallback (`resolver.ts:732 loadDirectPageSections`, invoked from `loadSharedPages:812`)
is real and is exactly where the contract says it is — it simply has no orphan to find.

The sibling delete paths are clean too: `deleteFunnelHandler` (`:2134-2174`) cascades slots, variant
sections, pages, rules, variants and ab_tests explicitly; `deleteSharedPageHandler` (`:2618-2628`)
removes the variant sections and the page together. No standalone "delete one page" verb exists.

## Consequence for P8-6

M8 is **not a defect at this HEAD**. It is recorded as DEVIATES-refuted with this drive rather than
fixed, and no slice was dispatched for it. One path the scout could not fully trace is named honestly:
`putVariantHandler`'s pages-replace branch (`:3815-3816`) deletes `leadgen_funnel_pages` for a variant
— its `leadgen_funnel_variant_sections` coupling was UNCHECKED. If M8 has a live form, that is where
to look next.

**Fixture restored and verified by re-reading the admin and the visitor page.**
