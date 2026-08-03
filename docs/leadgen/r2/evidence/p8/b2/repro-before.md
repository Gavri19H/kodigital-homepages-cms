# B2 before-fix reproduction (conductor-driven)
HEAD f240788, branch leadgen-r2-p8-1, local wrangler dev :8901, 2026-08-03.

Sequence (all commands executed, raw counts below):
1. POST /api/admin/leadgen/themes -> thm_p8-repro (brand_primary #112233) — 200
2. PUT /funnels/lgf_01KZ271383F5X1SQ3DXTXKNJE5/theme {"theme_json":{"theme_id":"thm_p8-repro"}} — 200
3. GET /lg/r2fix?_cb=<fresh> (Host: r2fix.e2e.test, Chrome UA) -> #112233 x18 (theme LIVE via the funnel-theme PUT path, which bumps content versions)
4. PATCH /themes/thm_p8-repro roles.brand_primary #112233 -> #AB1234 — 200
5. GET /lg/r2fix?_cb=<fresh> x3 (unique _cb each):
   fetch 1: old-color=18 new-color=0
   fetch 2: old-color=18 new-color=0
   fetch 3: old-color=18 new-color=0

Conclusion: a theme-record PATCH never reaches the live page across unique cache-busted
URLs — matches contract R2-2/B2 ("putFunnelThemeHandler calls bumpActiveVariantContentVersions;
the theme-record PATCH path does not").

Causal diagnostic (E7): after a second PATCH (#CD5678, HTTP 200), the active variant's
content_version stayed at 3 (GET /funnels/.../variants). The PUT-funnel-theme path had
bumped it; the theme-record PATCH path never does. Fix target confirmed.
