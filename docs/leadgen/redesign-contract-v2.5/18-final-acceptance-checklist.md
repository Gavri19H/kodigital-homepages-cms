# 18 · Final Acceptance Checklist

Implementation is complete ONLY when every box is checkable with evidence (test name or artifact). Mission acceptance criteria 1–20 in order:

**Boundary & data**
☐ 1. Section headline/subheadline stored once (columns), rendered via bound nodes; no duplicate entry surface exists. *(canonical-headline vitest + studio Playwright)*
☐ 2. Quote Builder owns page frame + design language (`frame_config_json`, `theme_json` editable only there). *(quote-builder suite)*
☐ 3. Section Builder owns the question unit only; canvas shows unit only. *(palette + canvas Playwright)*

**Branding & chrome**
☐ 4. Site logo inherited automatically from the activated site; preview site selector swaps it; manual override Advanced-only. *(site-logo tests)*
☐ 5. Progress is frame-owned and computed from Funnel Variant section order. *(progress vitest + runtime Playwright)*
☐ 6. Back/previous frame-owned by default; hidden on first slide. *(back-behavior)*
☐ 7. Footer/disclosure/trust logos frame-owned; persist across slides. *(runtime persistence Playwright)*

**Depth & UX**
☐ 8. Question unit deeply designable (containers, roles, per-type editors, Section overrides). *(studio suite)*
☐ 9. Image Card Grid: per-card image + media picker/upload/AI + alt + title/subtitle + value + mapping shortcut. *(image-card tests)*
☐ 10. Inspector is context-aware and human-readable (scope header + blast-radius line). *(inspector Playwright)*
☐ 11. Normal color UX is palette/role-based; hex only in Advanced/theme administration. *(hex-lint)*
☐ 12. Layout managed via canvas toolbar + frame templates; no page-level components droppable into Sections. *(palette Playwright)*
☐ 13. Section canvas = question-unit layout only. *(canvas Playwright)*
☐ 14. Quote preview steps all Sections inside ONE consistent frame, desktop+mobile, per site, per variant. *(preview Playwright)*

**Parity & integration**
☐ 15. Runtime composition ≡ preview composition (shared functions; parity fixtures). *(preview-runtime-parity)*
☐ 16. Offer mapping visible and operable in Section Builder (badge, overlay, panel, both directions). *(mapping suite)*
☐ 17. Capability patterns A–E built through the UI without custom CSS. *(pattern fixtures + visual regression)*
☐ 18. No arbitrary CSS anywhere (schema-enforced roles/enums; CSS-escape guards intact). *(validators)*
☐ 19. No raw JSON in normal designer flows (frame, theme, choices, rules, mapping all picker-driven; JSON = Advanced only). *(no-raw-json test + rules-builder Playwright)*
☐ 20. Tests prove runtime/preview parity and all of the above; manual QA signed by a designer. *(15 §15.5 sign-off)*

**Non-regression**
☐ Legacy funnels (`NULL` frame/theme) serve byte-identical shells; legacy Sections render unchanged; activation of legacy Quotes yields zero new blocks. *(pinned snapshots + preflight fixture)*
☐ Mapping, auction, analytics mirrors, `/lg/config`+`/lg/attempt`, activation flows untouched (suite umbrellas green).

**v2.5.1 consistency pass**
☐ C1. No universal provider value anywhere; Choices tab is Section-owned fields only; per-Offer rows in Mapping; two-Offer divergence test green. *(per-offer-provider-values)*
☐ C2. Publish/activation blocks on Section page-chrome when a Quote Frame is configured; per-funnel Advanced legacy override (`compat.allow_section_chrome`) downgrades to warning; no double header/progress/footer/logo live by default. *(activation-chrome-block)*
☐ C3. Exactly one `data-lg-continue` control per visible Section in `inside_unit` AND `below_unit`; duplicates deduped with warning. *(continue-single-dom)*
☐ C4. Preview site selector lists ALL CMS sites with Active/Activation off/Not activated badges; pre-activation branding preview works; runtime servability unchanged. *(site-selector Playwright)*
☐ C5. Template switching preserves operator content, replaces layout defaults, confirms losses, and previews before apply; data never deleted. *(template-switch-merge)*
☐ C6. “Section / question unit” wording in Section Builder; “slide” only as Quote-Builder position vocabulary; reuse counts shown. *(glossary-lint)*
☐ C7. Trust/logo/legal affordances labeled “inside this question unit” vs “funnel-wide” — scope unmistakable on both surfaces. *(copy assertions)*

---

**Final status: LeadGen CMS — Quote & Section Authoring Redesign Contract v2.5.1 — READY FOR IMPLEMENTATION — AFTER USER APPROVAL.**
