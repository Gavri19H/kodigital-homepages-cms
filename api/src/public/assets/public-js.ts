// Phase 5 generic public client script, served at /assets/public.js.
// Implements PART 5 progressive enhancements: a reading-progress bar driven
// by a passive scroll listener, and a Share / Copy-link button that prefers
// the Web Share API with a clipboard fallback. Exported as a string so the
// Worker can ship it without a bundler step. Designed to be tenant-neutral —
// it does not reference any brand or admin host string.
//
// Contract (T17 / C12): the progress bar is transform-driven — scaleX with
// an explicit transform-origin, never style.width (compositor-only updates,
// no layout/paint per scroll tick) — and the script literal is ES5-only so
// it runs without transpilation on every tenant browser baseline.

export const publicJs: string = `
(function () {
  if (typeof document === 'undefined') return;

  function initReadingProgress() {
    var bar = document.querySelector('.reading-progress-bar');
    if (!bar) return;
    var article = document.querySelector('.article-shell') || document.querySelector('article') || document.body;
    bar.style.setProperty('transform-origin', 'left center');
    function update() {
      var rect = article.getBoundingClientRect();
      var viewport = window.innerHeight || document.documentElement.clientHeight || 1;
      var total = Math.max(1, rect.height - viewport);
      var scrolled = Math.min(Math.max(0, -rect.top), total);
      var ratio = Math.min(1, Math.max(0, scrolled / total));
      bar.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function initShare() {
    var buttons = document.querySelectorAll('[data-share]');
    if (!buttons || !buttons.length) return;
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        var url = btn.getAttribute('data-share-url') || window.location.href;
        var title = btn.getAttribute('data-share-title') || document.title || '';
        var copyOnly = btn.getAttribute('data-share-action') === 'copy';
        function doCopy() {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function () {
              btn.setAttribute('data-share-status', 'copied');
              showToast('Link copied');
              window.setTimeout(function () { btn.removeAttribute('data-share-status'); }, 2000);
            }).catch(function () { btn.setAttribute('data-share-status', 'error'); });
          } else {
            btn.setAttribute('data-share-status', 'unsupported');
          }
        }
        if (!copyOnly && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          navigator.share({ title: title, url: url }).catch(function () { /* dismissed */ });
          return;
        }
        doCopy();
      });
    });
  }

  function getSaved() {
    try { return JSON.parse(window.localStorage.getItem('tiw_saved_stories') || '[]') || []; }
    catch (e) { return []; }
  }
  function setSaved(list) {
    try { window.localStorage.setItem('tiw_saved_stories', JSON.stringify(list)); } catch (e) {}
  }
  function applySavedState(btn, isSaved, label) {
    btn.setAttribute('data-saved', isSaved ? 'true' : 'false');
    btn.setAttribute('aria-pressed', isSaved ? 'true' : 'false');
    if (btn.className.indexOf('btn-outline') !== -1) {
      var node = btn.lastChild;
      if (node && node.nodeType === 3) { node.nodeValue = isSaved ? ' Saved' : ' ' + label; }
    }
  }
  function initSave() {
    var buttons = document.querySelectorAll('[data-share-action="save"]');
    if (!buttons || !buttons.length) return;
    var canonical = document.querySelector('link[rel="canonical"]');
    var fallbackUrl = (canonical && canonical.getAttribute('href')) || window.location.href;
    Array.prototype.forEach.call(buttons, function (btn) {
      var key = btn.getAttribute('data-share-url') || fallbackUrl;
      var label = (btn.lastChild && btn.lastChild.nodeType === 3) ? btn.lastChild.nodeValue.replace(/^\s+/, '') : 'Save this story';
      applySavedState(btn, getSaved().indexOf(key) !== -1, label);
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        var list = getSaved();
        var idx = list.indexOf(key);
        var nowSaved;
        if (idx === -1) { list.push(key); nowSaved = true; } else { list.splice(idx, 1); nowSaved = false; }
        setSaved(list);
        Array.prototype.forEach.call(buttons, function (b) {
          if ((b.getAttribute('data-share-url') || fallbackUrl) === key) applySavedState(b, nowSaved, label);
        });
        showToast(nowSaved ? 'Saved to your stories' : 'Removed');
      });
    });
  }
  var toastTimer = null;
  function showToast(msg) {
    var el = document.getElementById('tiw-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tiw-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(8px);background:#1a1d23;color:#fff;padding:10px 18px;border-radius:999px;font:600 14px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:9999;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(8px)';
    }, 2200);
  }

  function initNewsletter() {
    var forms = document.querySelectorAll('form.newsletter__form, form.newsletter-form');
    if (!forms || !forms.length) return;
    Array.prototype.forEach.call(forms, function (form) {
      var action = form.getAttribute('action') || '';
      if (action.indexOf('/api/newsletter/subscribe') === -1) return;
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var input = form.querySelector('input[type="email"]');
        var email = input ? input.value : '';
        var btn = form.querySelector('button');
        if (btn) btn.setAttribute('disabled', 'disabled');
        fetch(action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ email: email })
        }).then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (data) {
            if (data && data.ok) { if (input) input.value = ''; showToast('Subscribed - check your inbox'); }
            else { showToast('Enter a valid email address'); }
          })
          .catch(function () { showToast('Could not subscribe, please try again'); })
          .then(function () { if (btn) btn.removeAttribute('disabled'); });
      });
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    initReadingProgress();
    initShare();
    initSave();
    initNewsletter();
  });
})();
`;
