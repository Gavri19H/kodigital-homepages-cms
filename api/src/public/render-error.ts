// T14: styled public error pages (404 / 500).
//
// Public-content requests that miss (a bad URL) or blow up (an unexpected
// server error) must be answered with a FULL design-shell HTML document —
// never the bare `{"error":"Not Found"}` JSON or hono's default
// "Internal Server Error" text body. renderErrorPage composes the same
// renderLayout shell the content routes use (Nunito + /assets/public.css +
// site-header + site-footer) so the user sees a branded page.
//
// The renderer is intentionally DB-free: a 500 is frequently caused by the
// DB itself, so the error page must render from the hostname alone (no
// site_settings lookup that could re-throw). The site name therefore falls
// back to the tenant hostname. Error pages are `noindex, follow` so a
// crawler that hits a transient error/bad URL never indexes the error body
// while still following the links back into the live site.
//
// Tenant-boundary RED LINE: the hostname passed here is always the resolved
// tenant host (or the request host) — the admin host MUST NEVER appear.

import { renderLayout } from "./templates/layout";
import { renderHeader, renderFooter } from "./templates/components";

export interface ErrorPageOptions {
  // Resolved tenant hostname (used for the header/footer brand + canonical
  // host). Never the admin host.
  hostname: string;
  // HTTP status the page is served with (404 or 500).
  status: 404 | 500;
  // Optional overrides; sensible per-status defaults are used otherwise.
  heading?: string;
  message?: string;
  siteName?: string;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function defaultsFor(status: 404 | 500): { heading: string; message: string } {
  if (status === 404) {
    return {
      heading: "Page not found",
      message:
        "We couldn't find the page you were looking for. It may have moved or no longer exists.",
    };
  }
  return {
    heading: "Something went wrong",
    message:
      "An unexpected error occurred while loading this page. Please try again in a moment.",
  };
}

export function renderErrorPage(opts: ErrorPageOptions): string {
  const { status } = opts;
  const fallback = defaultsFor(status);
  const heading = opts.heading ?? fallback.heading;
  const message = opts.message ?? fallback.message;
  const siteName =
    opts.siteName !== undefined && opts.siteName.length > 0
      ? opts.siteName
      : opts.hostname;

  const headerSite = { name: siteName, hostname: opts.hostname };

  // The error body uses the shared design vocabulary (container/section) so
  // it inherits public.css styling and reads as part of the site, not a bare
  // browser error.
  const body =
    `<section class="error-page" data-error-status="${status}">` +
    `<div class="container">` +
    `<p class="error-code">${status}</p>` +
    `<h1 class="error-title">${escapeHtml(heading)}</h1>` +
    `<p class="error-message">${escapeHtml(message)}</p>` +
    `<p class="error-actions"><a class="btn-outline" href="/">Back to home</a></p>` +
    `</div></section>`;

  return renderLayout({
    site: { name: siteName, hostname: opts.hostname },
    meta: {
      title: `${heading} — ${siteName}`,
      description: message,
      // Error pages are noindex so a crawler never indexes a 404/500 body.
      robots: "noindex, follow",
    },
    body,
    header: renderHeader({ site: headerSite }),
    footer: renderFooter({ site: headerSite }),
  });
}
