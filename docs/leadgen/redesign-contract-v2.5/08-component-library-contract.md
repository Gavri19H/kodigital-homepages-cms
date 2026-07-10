# 08 · Component Library Contract

## 8.1 Presentation (kept from v2.4, re-worded)

Every library item: live preset-rendered thumbnail (existing mechanism) · plain name · one-line “use when …” description · answer-type chip (plain words: “stores one choice”, “stores a number”) · “maps to Offer fields” badge for answer producers. Search across name + description. No type ids visible.

## 8.2 Scope assignment (D5 — the normative table; catalog gains `scope`)

| `scope` | Types | Consequence |
|---|---|---|
| `frame` | `ProgressBar`, `StepIndicator`, `HeaderLogo`, `BackButton`, `DisclosureLink`, `HeaderBar`, `FooterBar`, `BackgroundPanel` | Removed from the Section palette. Renderers preserved and reused by `designs/frame.ts` (`13 §13.1`). Legacy nodes inside Sections render unchanged + save warning `frame_scope_component` + preflight surfacing + “Move to Quote frame” assistant (`05 §5.4`) |
| `both` | `CardPanel`, `Stack`, `GridContainer`, `Columns`, `Spacer`, `TrustBar`, `LogoStrip`, `SecureFormBadge`, `ReassuranceBadge`, `LegalNote`, `SuccessState`, `CategoryLabel`, `QuestionHeadline`, `Subheadline`, `HelperText` | In the Section palette under unit-appropriate groups; also consumable by frame regions (trust strip/logo strip/benefit bar reuse `TrustBar`/`LogoStrip` presets). **UI labels differ by host (C7): “inside this question unit” in the Section palette vs “funnel-wide” in Quote Builder regions** |
| `unit` | all question/input/choice types, `ContinueButton`, `AutoAdvanceButton`, `ValidationError` | Section palette only |

## 8.3 Section palette groups (replaces `STUDIO_LIBRARY_GROUPS`; intent-first)

| Group | Items (display name → type) |
|---|---|
| **Question copy** | Category label→`CategoryLabel` · Question headline→bound `QuestionHeadline` · Subheadline→bound `Subheadline` · Helper text→`HelperText` |
| **Answer choices** | Simple answer buttons→`ButtonAnswerGroup` (“One-tap answer choices.”) · Yes / No→`TwoButtonYesNo` · Icon answer cards→`IconCardAnswerGrid` (“Use when each answer has an icon.”) · **Image answer cards**→`ImageCardAnswerGrid` (“Use when each answer has a logo or photo.”) · Multi-select cards→`MultiChoiceCardGroup` · Dropdown→`DropdownQuestion` · Searchable dropdown→`SearchableDropdownQuestion` · Main + “Other” choices→`OtherGroupSelector` |
| **Inputs** | Text→`FreeTextQuestion` · Number→`NumberInputQuestion` · Amount ($)→`CurrencyInputQuestion` · Slider→`RangeQuestion`/`NumberRangeQuestion` · Amount slider→`CurrencyRangeQuestion` · Date→`DateQuestion` · Name→`NameFieldsGroup` · Email→`EmailInputQuestion` · Phone→`PhoneInputQuestion` · ZIP→`ZIPInputQuestion` · Address→`AddressAutocompleteQuestion` |
| **Inside-card layout** | Question card→`CardPanel` · Stack→`Stack` · Answer grid→`GridContainer` · Two columns→`Columns` · Spacer→`Spacer` |
| **Trust & help — inside this question unit** | Reassurance badge→`ReassuranceBadge` (“Reassurance line inside this question unit.”) · Secure-form badge→`SecureFormBadge` · Trust points→`TrustBar` · Logo row→`LogoStrip` · Legal note→`LegalNote` · Error message slot→`ValidationError` · Success state→`SuccessState` |
| **Slide navigation** | Continue button→`ContinueButton` · Auto-advance→`AutoAdvanceButton` |

A dismissible callout replaces the old Layout group: “Looking for the page header, footer, progress bar or background? Those live in the **Quote Builder** → [Open]”. The Trust & help group carries a scope note (C7): “These travel with this Section, inside the question unit. Funnel-wide trust strips, logo rows and the legal footer are configured in the Quote Builder.”

## 8.4 Choice schema extension (D8 — `content-schema.ts`, additive)

`LeadgenChoice` gains optional: `title`, `subtitle` (supersedes `description`; `description` kept as read alias), `badge`, `emoji`, `image_alt`, `disabled:boolean`, `aria_label`. Validator: `image_alt` REQUIRED when `imageMediaId` present on `ImageCardAnswerGrid` (`invalid_choice` code reused); `emoji` and `icon` mutually exclusive per choice. Presets render title/subtitle/badge/disabled/aria via the existing `iconCard` token slots + two new slot keys (`iconCard.subtitle*`, `iconCard.badge*`) added to every design token file. Per-choice hover/selected imagery is OUT of scope v2.5 (state styling is token-driven; a per-state image swap would require runtime changes disproportionate to value — revisit post-v2.5). Media acquisition: existing media picker + upload; “Generate with AI” reuses the `ai-api.ts` generation leg writing to `media` (no new infra) and is hidden when the AI route is unavailable.

## 8.5 Quote Builder “library”

The frame has NO free palette (regions are config-driven, `04`). The frame template picker + region inspectors ARE the Quote-side library; the mission’s Quote-library list maps: Header/Logo slot/Disclosure/Progress/Back/Footer/Legal links/Trust logos/Benefit bar/Page background/Funnel-wide CTA/Secure badge/Brand strip → the `03 §3.3` groups.

## 8.6 Legacy + validation summary

- Placing a frame-scope type via API into `content_json` → save succeeds with `problems[] warning frame_scope_component` (path-precise). UI cannot place them. **At Quote publish/activation this escalates to a blocking error for funnels with a configured frame unless `compat.allow_section_chrome` is set (C2, `14 §14.1`).**
- `validateSectionContent` return shape gains `warnings: SectionContentError[]` (additive; `ok` still keyed to errors only).
- Existing Sections render byte-identically until edited.

## 8.7 Capability patterns (A–E normative; the §10 mission set)

Each pattern MUST be producible with zero custom CSS. Frame column names the template + notable region config; Unit column names Section content. These become Playwright fixtures built through the UI (`15 §15.3`).

| Pattern | Quote frame | Section unit | Required tokens/controls |
|---|---|---|---|
| **A — Reference carrier comparison** | `centered`: logo top-center, progress bar under header, trust logo strip below unit, legal footer | Card: headline+sub (bound), button answer grid, Continue | progress roles, trust strip, footer links, grid gap/columns |
| **B — Simple site-branded lead form** | `header-footer`: site logo+tagline, secure badge, progress, LARGE site footer, back text link | headline, vertical answer buttons (Stack) | header tagline/secure, footer source=site, Stack gap |
| **C — Header-CTA service funnel** | `header-cta`: disclosure top bar, logo center, call CTA, progress, back link, benefit bar | large headline/sub, ZIP input with icon, Next button | cta tel, disclosure location, benefit items, input icon |
| **D — Full-background branded card** | `full-background`: brand background, logo, step dots, legal footer | white card, question, answer cards w/ title+subtitle, selected fill/underline | background role, dots style, card roles, choice title/subtitle |
| **E — Minimal high-conversion binary** | `minimal`: clean header, progress, back; no footer | large question, Yes/No pair | minimal template, type roles |

Mission 3.8’s Pattern E (ZIP lead capture) = C’s unit; 3.8’s Pattern F (multi-choice cards, branded bg) = D with `MultiChoiceCardGroup`. Both are asserted inside the C/D fixtures.
