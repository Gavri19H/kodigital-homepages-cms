# Appendix A — Baseline Strings

Baseline per contract Appendix A; owner may edit at the P0 review; CI asserts the final strings verbatim afterward.

| ID | String | Surface | Owning Phase |
|----|--------|---------|--------------|
| A-1 | `No pages yet — drag a section here or click + Add page.` | Board empty column | P3b |
| A-2 | `+ Add funnel` / sub: `Visitors reach it through routing rules.` | Add-funnel stub | P3b |
| A-3 | `Default` / tooltip: `Visitors who match no rule see this funnel.` | Default chip tooltip | P3b |
| A-4 | `'{section}' is already in this funnel — a section can appear once per funnel.` | Uniqueness block | P3b |
| A-5 | `Can't delete '{funnel}': it is the default funnel.` / `…it is the target of rule '{rule}'.` | Delete guard ×2 forms | P3b |
| A-6 | `This rule can never apply before a visitor enters a funnel that asks these questions.` | Unreachable warning | P3b |
| A-7 | `Enter a complete phone number.` | Phone incomplete default | P2 |
| A-8 | `No logo — set it in Site settings.` | Logo placeholder chip | P4 |
| A-9 | `Sample section (add sections to preview your own).` | Canvas fixture label | P4 |
| A-10 | `Format must be digit groups with separators, like (3) 3-4.` | Mask pattern error | P2 |
| A-11 | `Pick at least one action for this rule.` | Rules ≥1 action | P3b |
