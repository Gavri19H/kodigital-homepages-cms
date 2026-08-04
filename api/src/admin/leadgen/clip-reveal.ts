// R2 P8-3 FIX ROUND F12 — THE CLIP REVEAL, SCOPED TO LEADGEN.
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
// WHY IT IS NOT IN templates/layout.ts. F10 put these bytes in ADMIN_SCRIPTS,
// which is the admin shell SHARED WITH THE CONVERSIONS PRODUCT: one worker
// serves several products, so a leadgen theme fix silently added 5,477 bytes
// of JavaScript to every conversions admin page and turned
// test/conversions-admin-shell.test.ts's byte-identical legacy-shell pin red.
// This module is the same mechanism with the blast radius removed: adminLayout
// output for a caller that does not opt in is byte-identical to before the
// phase, and the leadgen surfaces that need the reveal include it themselves —
//   * quotes-tabs/themes.ts's renderThemesTabPanel, which ships inside the
//     quote-editor page, so ONE include covers the Themes rail AND the whole
//     quote-editor board; and
//   * ui-theme-manager.ts, for the standalone Themes manager page.
// Both includes are page-global by construction (a document-level sweep,
// document-level listeners and one MutationObserver over document.body), which
// is the property that made F10 choose this design and it survives the move.
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
export const LG_CLIP_REVEAL_SCRIPT = `
(function () {
  if (window.lgRevealClippedSelects) { return; }
  function lgSelectedOptionText(sel) {
    var idx = sel.selectedIndex;
    if (typeof idx !== 'number' || idx < 0 || !sel.options || !sel.options[idx]) { return ''; }
    return sel.options[idx].textContent || '';
  }
  function lgRevealClippedSelect(sel) {
    if (!sel || !sel.tagName || String(sel.tagName).toUpperCase() !== 'SELECT') { return; }
    var text = lgSelectedOptionText(sel);
    if (sel.scrollWidth > sel.clientWidth && text !== '') {
      sel.setAttribute('data-lg-clipped', '1');
      sel.setAttribute('title', text);
      if (sel.style) { sel.style.textOverflow = 'ellipsis'; }
    } else if (sel.getAttribute && sel.getAttribute('data-lg-clipped') === '1') {
      sel.removeAttribute('data-lg-clipped');
      sel.removeAttribute('title');
      if (sel.style) { sel.style.textOverflow = ''; }
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
  function lgTouchesASelect(rec) {
    if (rec.target && rec.target.nodeName === 'SELECT') { return true; }
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
    }).observe(document.body, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', lgQueueReveal);
  lgRevealClippedSelects(document);
}());
`;
