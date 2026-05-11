/**
 * Protected production hostnames belonging to the sibling TheIWise stack.
 *
 * Per docs/no-touch-red-line.md, this Worker MUST NOT read from, write
 * to, deploy over, or share state with any TheIWise production resource.
 * The functions below are a runtime defense-in-depth check — used at the
 * boundary of any code path that mutates external Cloudflare resources
 * (DNS records, Worker routes, cache-purge, R2/D1 bindings) — so that a
 * caller-supplied hostname can be rejected before any Cloudflare API
 * call is issued.
 *
 * Ralph contract reminder: this file is on the verify-script Group B
 * allowlist. It legitimately contains the literal `theiwise.com` and is
 * the ONE place outside docs/ where that string is allowed to appear.
 */

export const PROTECTED_DOMAINS: readonly string[] = [
  "theiwise.com",
  "www.theiwise.com",
  "staging.theiwise.com",
  "app.theiwise.com",
];

/**
 * Normalize a hostname or URL-like input to a comparable lowercase
 * hostname. Strips scheme, userinfo, path, query, fragment, port, and a
 * trailing dot. Returns "" for null/undefined/empty/unparseable input
 * so callers can treat empty as "not protected".
 */
export function normalizeHostname(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  let s = String(input).trim();
  if (s.length === 0) return "";

  const schemeIdx = s.indexOf("://");
  if (schemeIdx >= 0) s = s.slice(schemeIdx + 3);

  const slashIdx = s.indexOf("/");
  if (slashIdx >= 0) s = s.slice(0, slashIdx);
  const queryIdx = s.indexOf("?");
  if (queryIdx >= 0) s = s.slice(0, queryIdx);
  const hashIdx = s.indexOf("#");
  if (hashIdx >= 0) s = s.slice(0, hashIdx);

  const atIdx = s.indexOf("@");
  if (atIdx >= 0) s = s.slice(atIdx + 1);

  const colonIdx = s.indexOf(":");
  if (colonIdx >= 0) s = s.slice(0, colonIdx);

  while (s.endsWith(".")) s = s.slice(0, -1);

  return s.toLowerCase();
}

export function isProtectedDomain(input: string | null | undefined): boolean {
  const h = normalizeHostname(input);
  if (h.length === 0) return false;
  return PROTECTED_DOMAINS.includes(h);
}

export function assertNotProtectedDomain(
  input: string | null | undefined,
): void {
  if (isProtectedDomain(input)) {
    const h = normalizeHostname(input);
    throw new Error(`Refusing to operate on protected hostname: ${h}`);
  }
}
