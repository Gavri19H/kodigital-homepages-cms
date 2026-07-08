# 14 · Final Acceptance Checklist (for the implementation agent)

Binding DONE gate for the whole mission. Every box requires runtime-grade evidence (`11` §11.5 standard). Reproduced exactly as mandated:

**Runtime:**
☐ `/lg/:quote_slug` renders real first Section/question.  
☐ User can answer and continue/auto-advance.  
☐ Dependencies work.  
☐ Final Section triggers `/lg/auction`.  
☐ Banners render.  
☐ `carrier_impression` fires.  
☐ `offer_impression` fires.  
☐ `/lg/lc` resolves macros.  
☐ `/lg/config` remains cacheable public config only.  
☐ `/lg/attempt` returns session-bound attempt/token.  

**Payload:**
☐ Macro values include real request/Cloudflare/session/traffic context.  
☐ Computed values resolve at runtime and Test.  
☐ `placement_id` source resolves correctly.  
☐ Normal payload builder requires no raw JSON.  
☐ Value maps are visual.  
☐ Conditions/default/fallback are visual.  
☐ Object/array fields are visual.  
☐ Boolean/date/free-text presets work.  
☐ Large lists + Other grouping work.  
☐ Test tool sample answers are form-generated.  

**Offer:**
☐ Delete works only when safe.  
☐ Duplicate creates safe draft with new unique placement.  
☐ Usage report is complete.  
☐ Region rules are understandable.  
☐ Dynamic Offer eligibility gate blocks invalid Offers.  
☐ Simulate shows redacted per-offer payload.  

**Section Studio:**
☐ Activity dropdown from Offer activities.  
☐ Vertical dropdown filtered by Activity.  
☐ Available Offers filtered and shown.  
☐ Mapping completeness visible.  
☐ Visual component picker uses thumbnails.  
☐ Canvas supports drag/drop and layout containers.  
☐ Inspector is tabbed and operator-friendly.  
☐ Google Maps field-level config works.  
☐ Desktop/mobile preview works and is reversible.  
☐ Rich slide patterns can be created without custom CSS.  

**Quote/Funnel:**
☐ Quote activation blocks invalid required mappings.  
☐ Funnel order flexible.  
☐ Final Section before auction correct.  
☐ A/B identity preserved.  

**Analytics:**
☐ All required IDs persist.  
☐ 9 mirrors remain unchanged.  
☐ Events have producers.  
☐ False PASS tests removed/replaced.  

**QA:**
☐ Vitest green.  
☐ Playwright green.  
☐ verify:all green.  
☐ Manual QA signed.  
☐ Traceability updated.  

---

**Final status: Operational Fix Contract v2.4 — READY FOR IMPLEMENTATION after user approval.**
