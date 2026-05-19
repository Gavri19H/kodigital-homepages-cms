// Phase 5 generic public client script, served at /assets/public.js.
// Implements PART 5 progressive enhancements: a reading-progress bar driven
// by a passive scroll listener, and a Share / Copy-link button that prefers
// the Web Share API with a clipboard fallback. Exported as a string so the
// Worker can ship it without a bundler step. Designed to be tenant-neutral —
// it does not reference any brand or admin host string.

export const publicJs: string = `
(function () {
  if (typeof document === 'undefined') return;

  function initReadingProgress() {
    var bar = document.querySelector('.reading-progress-bar');
    if (!bar) return;
    var article = document.querySelector('.article-shell') || document.querySelector('article') || document.body;
    function update() {
      var rect = article.getBoundingClientRect();
      var viewport = window.innerHeight || document.documentElement.clientHeight || 1;
      var total = Math.max(1, rect.height - viewport);
      var scrolled = Math.min(Math.max(0, -rect.top), total);
      var pct = Math.min(100, Math.max(0, (scrolled / total) * 100));
      bar.style.width = pct.toFixed(2) + '%';
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
        var payload = { title: title, url: url };
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          navigator.share(payload).catch(function () { /* user dismissed share sheet */ });
          return;
        }
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            btn.setAttribute('data-share-status', 'copied');
            window.setTimeout(function () { btn.removeAttribute('data-share-status'); }, 2000);
          }).catch(function () {
            btn.setAttribute('data-share-status', 'error');
          });
          return;
        }
        btn.setAttribute('data-share-status', 'unsupported');
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
  });
})();
`;
