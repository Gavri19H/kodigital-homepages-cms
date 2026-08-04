// R2 P8-3 FIX ROUND F13 — THE CLIP REVEAL, SCOPED TO LEADGEN, MEASURED IN A
// STATE ITS OWN STYLING CANNOT CHANGE.
//
// WHAT IT IS. A select element paints its selected option inside whatever box
// the layout gives it and clips the overflow silently: no ellipsis, no
// tooltip, no scroll. Measured on this build (driven, 127.0.0.1:8901,
// chromium): #lg-theme-preset-select 347.05px of text in a 288.00px box,
// #lg-theme-site-select 236.58 in 197.88, #lg-theme-target-select 469.77 in
// 186.00, #lg-tpl-section-select 531.80 in 226.00 — and every one of them
// reported an empty title, so the operator had no way to read the rest.
//
// Where the clipped text is product copy the fix is to make the copy fit (a
// per-string job whose regression is test/leadgen-p8-n-theme-ui.test.ts's box
// leg). Where it is the operator's OWN data — a site, funnel, section or saved
// preset name — no box can be guaranteed wide enough, so the honest close is
// to hand them the full text: a title carrying the selected option verbatim,
// plus an ellipsis so the clipping is visible rather than a word cut
// mid-glyph. It is SELF-MEASURING (scrollWidth vs clientWidth of the real
// painted box), so it needs no list of controls, no list of strings and no
// container class: a select added tomorrow, on any surface that includes this
// script, in any container, is covered on the same terms. It adds nothing when
// the text already fits, and it is not a gate — it blocks nothing and
// validates nothing.
//
// WHY THE PREDICATE MEASURES IN A FORCED `clip` STATE (FIX ROUND F13,
// BLOCKER-1). Setting `text-overflow: ellipsis` on a <select> makes Chromium
// report scrollWidth == clientWidth for that element: the ellipsis IS the
// element's way of fitting the text, so the overflow it was measuring
// disappears. F12's predicate was the bare `scrollWidth > clientWidth` in
// whatever state the element happened to be in, so the reveal's own styling
// falsified the condition the reveal tests. Driven on this build
// (127.0.0.1:8901, chromium, #tm-headline-font, identical at 1280 and 375):
// load 294/282 title=null -> sweep 282/282 title set -> sweep 294/282 title
// NULL -> sweep 282/282 title set. Every second `change`/`focusin`/`mouseover`
// stripped the title and the ellipsis while the text was still clipped.
// lgOverflows below closes it: a POSITIVE reading needs no repair (an ellipsis
// can only ever hide overflow, never invent it), and the only reading that can
// be a lie — "no overflow" on an element THIS SCRIPT has already styled — is
// re-taken with `text-overflow: clip` forced inline for the duration of the
// read and the previous value put straight back, inside one synchronous task,
// so nothing paints in between. The state therefore depends only on the
// element's natural (un-ellipsised) overflow, which the reveal cannot change,
// and running it any number of times in any order converges to that one state.
// The extra pair of forced layouts happens ONLY for an already-revealed select
// that reports it now fits, never for the page-load sweep (driven: 92 selects
// on /admin/leadgen/sections/new, one clean measurement pass).
// THE ONE CASE IT CANNOT SEE, stated rather than implied: if a STYLESHEET (not
// this script) ever set `text-overflow: ellipsis` on a select, the very first
// reading would already be collapsed and no title would be offered. No served
// sheet does (grep: no `select` rule carries text-overflow); if one ever does,
// this predicate needs the unconditional forced-clip read, at two forced
// layouts per select per sweep.
//
// FIX ROUND F14 (review-p8-3d MAJOR-1) — THE REVEAL DOES NOT OWN `title`.
// F13 widened the reveal to every leadgen admin route, and two selects on
// /admin/leadgen/sections/:id/edit already carry a tooltip the PRODUCT set:
// ui-section-studio.ts:15594 `pathSel.title = f.path` ("§12.1: options carry
// the field LABEL; the raw path rides the tooltip" — a promise the help copy at
// :3263 repeats to the operator, "the raw path also rides each Field cell's
// tooltip"), and the SSR `<select id="lg-content-type-swap" … title="Type —
// swaps the concrete stored type">` at :2601. F13's unconditional
// setAttribute/removeAttribute pair destroyed both.
// FAIL-BEFORE, driven this round through the real Mapping drawer -> Map fields
// at 375 (127.0.0.1:8901, chromium, with the F13 body put back for the run):
// step 0 title="lead.r2fix_carrier" -> step 1, once the label clips,
// title="Street address line one and two — text (required)" (the raw path
// OVERWRITTEN with text the closed control already shows) -> step 2, once it
// fits again, title=null (the raw path DELETED). 10 of 10 readings carried no
// author text, and the withdrawn element came back as
// `<select class="form-input" data-map-path="lead.r2fix_carrier"
// aria-label="Offer payload field" style="">` — the title gone and an empty
// style attribute left behind. #lg-content-type-swap reproduced it at BOTH
// widths ("Type — swaps the concrete stored type" -> "Headline" -> null). The
// mapping case does NOT reproduce at 1280 (394px box, the label fits), which is
// exactly why a desktop-only pass cannot see it. WHY F13'S OWN METRIC WAS
// BLIND: it counted `clipped-without-title`, i.e. MISSING titles; a destroyed
// title is present and wrong.
//
// THE RULE NOW. This script never destroys or alters what the product itself
// put on an element. On the first transition into the revealed state the
// author's title — if the attribute exists at all — is stashed verbatim in
// `data-lg-title-own`, and what the operator sees is a COMPOSITION: the
// author's sentence first, exactly as written, then a newline, then the full
// selected option. A composition rather than the author's text alone because
// the two are DIFFERENT facts — the raw dotted path (or what the control does)
// versus the text the box cut — and dropping either loses something the product
// promised: the help copy promises the path, and a clipped control the operator
// cannot read is the defect this whole module exists for. Author-first because
// it keeps the product's sentence where the operator already expects it and
// makes it recoverable by a plain prefix test as well as from the stash. When
// the two are the same string it is written once.
// WITHDRAWAL RESTORES, byte for byte: the stashed value goes back into the SAME
// attribute (setAttribute on the attribute that is already there, so its
// position in the element's attribute list is unchanged — remove-then-re-add
// would move it to the end), both data attributes are removed, and if the style
// attribute this script created is now empty it is removed too, so an element
// that had none keeps no `style=""` residue. Driven after the change at 375 and
// 1280 on both selects: 22 consecutive readings -> ONE state, 30 rAF frames ->
// ONE state, 0 readings without the author's text, `data-lg-title-own` holding
// the author's sentence throughout, and `sel.outerHTML` after withdrawal
// identical to the pre-reveal capture.
// TWO LIMITS, stated rather than implied. (1) An element that ALREADY carries
// an inline style attribute has that attribute re-serialised by the CSSOM on
// any style write — a property of the browser, not of this script; the
// declarations are preserved and neither author-titled select carries one
// (measured). (2) If another script re-titled a select WHILE the reveal is
// showing a composed title, the stash would keep the earlier sentence as the
// author's. No product path does that today — grep: the only author titles on a
// leadgen <select> are set once at creation (ui-section-studio.ts:15594) or in
// SSR (:2601), never on a live revealed element.
//
// WHY IT IS NOT IN templates/layout.ts. F10 put these bytes in ADMIN_SCRIPTS,
// which is the admin shell SHARED WITH THE CONVERSIONS PRODUCT: one worker
// serves several products, so a leadgen theme fix silently added 5,477 bytes
// of JavaScript to every conversions admin page and turned
// test/conversions-admin-shell.test.ts's byte-identical legacy-shell pin red.
// This module is the same mechanism with the blast radius removed: adminLayout
// output for a caller that does not opt in is byte-identical to before the
// phase, and the leadgen surfaces that need the reveal include it themselves.
// FIX ROUND F13 (MAJOR-2) — there is now exactly ONE include site for all of
// them: src/admin/leadgen/ui.ts's leadgenPageShell and its chromeless sibling
// leadgenStandalonePageShell, the two wrappers EVERY leadgen admin page is
// built from. Review #3 measured that F12's two per-renderer includes left
// ELEVEN select-bearing leadgen routes without the reveal, and that they clip:
// driven at 375 before this round, /admin/leadgen/offers 7 of 10 selects
// (worst +53px), /sections 4 of 4 (worst +11px), /auction 2 of 3 (worst
// +17px). Moving the include up to the two shells covers those routes, the
// quote-editor board, the Themes rail (which ships inside that page) and the
// standalone Themes manager with one copy each, and it still never enters the
// cross-product shell: adminLayout/adminStandalonePage receive these bytes
// only through the leadgen wrappers' own `scripts` argument, so a conversions
// page is byte-identical to before the phase (driven after this round: /admin
// and /admin/pages carry 0 copies and window.lgRevealClippedSelects is
// undefined there).
// It is page-global by construction (a document-level sweep, document-level
// listeners and one MutationObserver over document.body), which is the
// property that made F10 choose this design and it survives both moves.
//
// WHY THERE IS NO COMMENT INSIDE THE EMITTED SCRIPT BODY. Island bytes are
// served to the browser and string scanners (jargon, hex, glossary) read them;
// the rationale therefore lives here, in the TypeScript, and never ships. The
// emitted body is ES5 only (var, function, string concat — no arrow, no
// template literal, no backtick) and is wrapped in one IIFE with an install
// guard so a surface that ends up including it twice installs one copy.
//
// The three events are the ones an island-filled select actually produces:
// `change` (the operator picked a longer entry) and `focusin`/`mouseover` (the
// moment before a tooltip could be shown, so a select an island filled after
// load is current by the time it is read). The observer covers the remaining
// case — an island REPOPULATING a select changes the painted text with no user
// event at all — and is idle otherwise; the O(1) nodeName test keeps it off the
// hot path of pages that mutate heavily for other reasons. DOMContentLoaded
// gives the first full-page sweep regardless of where in the document the
// include sits. No polling, no timer of its own.
//
// THE THREE TRANSITIONS FIX ROUND F13 ADDS (MAJOR-3), each measured missing:
//   * an option's TEXT changing in place (#lg-theme-hex-role went 290/290 ->
//     531/290 with title still null): the observer now also takes
//     characterData records, and lgTouchesASelect accepts a record whose
//     target — or whose target's parent — is a SELECT/OPTION/OPTGROUP. BOTH
//     shapes are needed and neither implies the other: `option.textContent =
//     x` is a CHILDLIST record targeted at the OPTION (it swaps the text node,
//     driven: 128/128 -> 581/131), while `textNode.data = x` is a
//     CHARACTERDATA record targeted at the text node itself. Still O(1) per
//     record — a nodeName test and one parent hop, no tree walk — and still
//     one coalesced sweep.
//   * a RESIZE that starts a clip (#lg-theme-site-select 253/222, title null
//     after 375 -> 1280): one window `resize` listener into the same queue,
//     so a burst of resize events costs one sweep.
//   * a WEB FONT arriving after the boot sweep and widening the text:
//     document.fonts.ready re-sweeps once, when the page's fonts have settled.
//     STATED PRECISELY, because review #3 read this as the cause of the
//     manager's missing load-state title and the measurement says otherwise:
//     no admin page vendors an @font-face today (driven on
//     /admin/leadgen/themes: document.fonts.size === 0, status "loaded"), so
//     the two font selects paint the SYSTEM fallback for the family they name
//     — which is exactly what their "shows as default font" note says. The
//     measured cause of the null title at load was BLOCKER-1's double sweep:
//     the boot sweep set the title and the DOMContentLoaded sweep read the
//     collapsed scrollWidth and withdrew it. This leg is wired anyway because
//     the transition is real the moment any leadgen admin page serves a face,
//     and it costs one coalesced sweep.
// All three are guarded: an engine (or a vm harness) without MutationObserver,
// without window.addEventListener or without document.fonts still installs and
// still runs every other leg.
export const LG_CLIP_REVEAL_SCRIPT = `
(function () {
  if (window.lgRevealClippedSelects) { return; }
  function lgSelectedOptionText(sel) {
    var idx = sel.selectedIndex;
    if (typeof idx !== 'number' || idx < 0 || !sel.options || !sel.options[idx]) { return ''; }
    return sel.options[idx].textContent || '';
  }
  function lgOverflows(sel) {
    if (sel.scrollWidth > sel.clientWidth) { return true; }
    if (!sel.getAttribute || sel.getAttribute('data-lg-clipped') !== '1' || !sel.style) { return false; }
    var prev = sel.style.textOverflow;
    sel.style.textOverflow = 'clip';
    var over = sel.scrollWidth > sel.clientWidth;
    sel.style.textOverflow = prev;
    return over;
  }
  function lgRevealClippedSelect(sel) {
    if (!sel || !sel.tagName || String(sel.tagName).toUpperCase() !== 'SELECT') { return; }
    var text = lgSelectedOptionText(sel);
    var clipped = sel.getAttribute ? sel.getAttribute('data-lg-clipped') === '1' : false;
    var own;
    if (text !== '' && lgOverflows(sel)) {
      if (!clipped && sel.getAttribute) {
        own = sel.getAttribute('title');
        if (own !== null) { sel.setAttribute('data-lg-title-own', own); }
      }
      own = sel.getAttribute ? sel.getAttribute('data-lg-title-own') : null;
      sel.setAttribute('data-lg-clipped', '1');
      sel.setAttribute('title', own === null || own === text ? text : own + '\\n' + text);
      if (sel.style) { sel.style.textOverflow = 'ellipsis'; }
    } else if (clipped) {
      own = sel.getAttribute('data-lg-title-own');
      if (own === null) {
        sel.removeAttribute('title');
      } else {
        sel.setAttribute('title', own);
        sel.removeAttribute('data-lg-title-own');
      }
      sel.removeAttribute('data-lg-clipped');
      if (sel.style) {
        sel.style.textOverflow = '';
        if (sel.getAttribute('style') === '') { sel.removeAttribute('style'); }
      }
    }
  }
  function lgRevealClippedSelects(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var all = scope.querySelectorAll ? scope.querySelectorAll('select') : [];
    var i;
    for (i = 0; i < all.length; i++) { lgRevealClippedSelect(all[i]); }
  }
  window.lgRevealClippedSelect = lgRevealClippedSelect;
  window.lgRevealClippedSelects = lgRevealClippedSelects;
  function lgSelectOfEvent(target) {
    var el = target;
    while (el && el.tagName) {
      if (String(el.tagName).toUpperCase() === 'SELECT') { return el; }
      el = el.parentNode;
    }
    return null;
  }
  function lgOnSelectEvent(e) {
    var sel = lgSelectOfEvent(e.target);
    if (sel) { lgRevealClippedSelect(sel); }
  }
  document.addEventListener('change', lgOnSelectEvent, true);
  document.addEventListener('focusin', lgOnSelectEvent, true);
  document.addEventListener('mouseover', lgOnSelectEvent, true);
  var lgRevealQueued = false;
  function lgQueueReveal() {
    if (lgRevealQueued) { return; }
    lgRevealQueued = true;
    setTimeout(function () {
      lgRevealQueued = false;
      lgRevealClippedSelects(document);
    }, 0);
  }
  function lgIsSelectPart(node) {
    if (!node || !node.nodeName) { return false; }
    var name = node.nodeName;
    return name === 'SELECT' || name === 'OPTION' || name === 'OPTGROUP';
  }
  function lgTouchesASelect(rec) {
    if (lgIsSelectPart(rec.target)) { return true; }
    if (rec.target && lgIsSelectPart(rec.target.parentNode)) { return true; }
    var lists = [rec.addedNodes, rec.removedNodes];
    var l, i, node;
    for (l = 0; l < lists.length; l++) {
      for (i = 0; lists[l] && i < lists[l].length; i++) {
        node = lists[l][i];
        if (!node || !node.nodeName) { continue; }
        if (node.nodeName === 'SELECT' || node.nodeName === 'OPTION') { return true; }
        if (node.getElementsByTagName && node.getElementsByTagName('select').length > 0) { return true; }
      }
    }
    return false;
  }
  if (typeof MutationObserver === 'function' && document.body) {
    new MutationObserver(function (records) {
      var i;
      for (i = 0; i < records.length; i++) {
        if (lgTouchesASelect(records[i])) { lgQueueReveal(); return; }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  document.addEventListener('DOMContentLoaded', lgQueueReveal);
  if (window.addEventListener) { window.addEventListener('resize', lgQueueReveal); }
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(lgQueueReveal);
  }
  lgRevealClippedSelects(document);
}());
`;
