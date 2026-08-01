import type { MiddlewareHandler } from "hono";
import type { AccessAuthVariables } from "../../auth/access-auth";
import type { Env } from "../../env";
import { resolvePermanentConversionsActor } from "./permanent-authority";

const CONTENT_MARKER = '<div class="admin-content">';
const WARNING_MARKER = 'data-conversions-bootstrap-warning="critical"';

function banner(): string {
  return '<div data-conversions-bootstrap-warning="critical" role="status" '
    + 'style="background:#7f1d1d;color:#fff;border-color:#450a0a;border-style:solid;border-width:1px;'
    + 'border-radius:6px;padding:12px 16px;margin:0 0 16px;font-weight:650">'
    + 'Critical: permanent Conversions authority is unavailable. Production effects remain blocked.</div>';
}

// Registered after Access only on authenticated Conversions/Reporting HTML surfaces.
export const conversionsBootstrapWarning: MiddlewareHandler<{
  Bindings: Env;
  Variables: AccessAuthVariables;
}> = async (c, next) => {
  await next();
  const contentType = c.res.headers.get("content-type")?.toLowerCase();
  if (c.res.status < 200 || c.res.status >= 300 || !contentType?.startsWith("text/html")) return;

  try {
    await resolvePermanentConversionsActor(c.env, c.get("access"));
    return;
  } catch {
    // Every permanent-authority failure renders the same non-secret blocked state.
  }

  const original = await c.res.text();
  const warning = banner();
  const html = original.includes(WARNING_MARKER) ? original
    : original.includes(CONTENT_MARKER)
      ? original.replace(CONTENT_MARKER, `${CONTENT_MARKER}${warning}`)
      : original.replace(/(<body(?:\s[^>]*)?>)/i, `$1${warning}`);
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  c.res = new Response(html, { status: c.res.status, statusText: c.res.statusText, headers });
  // Hono's response setter may retain an existing response header map; remove
  // the now-stale byte count after assignment as well.
  c.res.headers.delete("content-length");
};
