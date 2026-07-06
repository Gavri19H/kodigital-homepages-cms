# LeadGen — Component Capability Examples (screenshots / rich-builder examples only)

These are **capability examples only** — they show slides the *component capability registry* (`components/registry.ts`) can build. They are **NOT** a source of default styling. The **default look** is the measured default reference funnel design (`docs/leadgen/default-funnel-design-audit.md` + `designs/default-funnel/tokens.ts`). A different palette would be a separate visual design added to the registry.

| Screenshot pattern | Capability that produces it (`COMPONENT_CATALOG`) |
|---|---|
| Currency range "How much do you need?" ($10k–$1M+, live value) | `CurrencyRangeQuestion` / `RangeQuestion` |
| Business-type icon cards (Sole Proprietor / Partnership / LLC / C-Corp / S-Corp) | `IconCardAnswerGrid` |
| "Get your offers in 2 minutes or less" badge | `ReassuranceBadge` |
| Category eyebrow (e.g. BUSINESS LOAN) | `CategoryLabel` |
| Yes/No question | `TwoButtonYesNo` |
| Dependent insurer dropdown (shown when "insured = yes") | `DropdownQuestion` + conditional |
| Personal-details (name/email/phone/address/ZIP) | `NameFieldsGroup`,`EmailInputQuestion`,`PhoneInputQuestion`,`AddressAutocompleteQuestion`,`ZIPInputQuestion` |
| Progress bar / header logo / back / Disclosure / Continue | `ProgressBar`,`HeaderLogo`,`BackButton`,`DisclosureLink`,`ContinueButton` |

Each capability is skinned by the active visual design (default = the measured reference funnel: navy `#1B3A5C` + orange `#E85D26`, Literata/Sora — NOT the screenshot palette).
