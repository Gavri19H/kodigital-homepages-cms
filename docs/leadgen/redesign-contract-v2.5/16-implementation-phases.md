# 16 · Implementation Phases

Forward-only, additive; every phase independently shippable behind the data’s NULL-default semantics. No deploys or secret writes by the agent (existing policy).

## Phase A — Composition foundation (data + renderer + parity)

Migration `0041` (`03 §3.1`) · `designs/frames.ts` (templates + `effectiveFrame`) · `designs/theme.ts` (`resolveTokens`, role map, scales) · `designs/frame.ts` (`renderQuoteFrame` + legacy shell fallback) · `src/leadgen/branding.ts` + resolver branding load · serve.ts composition swap · engine audit for frame-level back/continue mounts (`11 §11.6`) · content_version bump on frame/theme save · catalog `scope` field + schema `bind` field + choice extensions + `warnings[]` (`03 §3.4–3.5`, `08 §8.4`) · presets: bound-text ctx + new choice fields + subtitle/badge slots in token files.
**Exit:** vitest rows 1–10 + 13–16 of `15 §15.1` green; a fixture funnel with a frame serves a composed `/lg` page; `frame=null` snapshot byte-identical.

## Phase B — Quote Builder

Frame studio UI (`04`): structure panel, frame canvas + region selection, region inspectors, template picker, theme editor (`09 §9.3`), variant overrides, preview modes + site selector · routes `04 §4.8` · Rules tab adopts the visual condition builder (existing v2.4 06 §6.10 spec) · preflight additions (`14`) + publish chip.
**Exit:** Quote-Builder Playwright rows green; patterns A–E frames configurable; preflight fixture suite green.

## Phase C — Section Builder correction

Canonical headline binding UX (`05 §5.2`) + legacy link banner · palette re-scope + callout (`08 §8.3`) · toolbar (`06`) incl. undo/redo + presets KV · scope-aware inspector (`07`) · choice-depth editors (`05 §5.5`) · Section role overrides mode (`09 §9.5`) · preview-in-frame mode (`13 §13.4` sections/preview extension) · move-to-frame assistant · glossary/hex copy pass + lints.
**Exit:** Section-Builder Playwright rows + copy lints green; F1–F8 demonstrably closed (traceability `17`).

## Phase D — Integration hardening

Mapping panel polish per `12 §12.1` columns + overlay · quote preview parity work finishing `13 §13.5` · site-settings branding bump hook (`10 §10.2`) · activation surfacing (`14 §14.2`) · all-slides stepper perf (render `pages[]` lazily per step for >8 sections).
**Exit:** parity vitest + runtime Playwright rows green.

## Phase E — Patterns, visual regression, QA honesty

Build A–E fixtures through the UI · visual-regression set (`15 §15.4`) · manualQA.md updates + operator sign-off · `docs/leadgen/traceability.md` updated from `17` · contract copied to `docs/leadgen/redesign-contract-v2.5/`.
**Exit:** `18` checklist fully checkable; `verify:all` green.

**Dependencies:** B and C both require A; D requires B+C; E last. B and C are parallelizable.

**v2.5.1 deltas (land with their phase):** Phase A — `compat` group (`03 §3.3`), `sectionCtx.continue_placement` + `duplicate_continue` dedupe (`11 §11.5`), per-Offer value-map projection fields (C1 data legs). Phase B — template merge/confirm/preview-before-apply dialog (`04 §4.3`), all-sites preview selector with badges (`10 §10.5`), Advanced legacy-override control (`04 §4.4`). Phase C — Choices↔Mapping separation UI (C1), Section/slide wording sweep + local vs funnel-wide labels (C6/C7). Phase D — activation chrome block (C2). Tests per `15` (`per-offer-provider-values`, `continue-single-dom`, `template-switch-merge`, `activation-chrome-block`).
