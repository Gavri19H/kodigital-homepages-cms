import type { MiddlewareHandler } from "hono";
import type { AccessAuthVariables } from "../../auth/access-auth";
import type { Env } from "../../env";
import { PermanentAuthorityError, resolvePermanentConversionsActor } from "./permanent-authority";

const CONTENT_MARKER = '<div class="admin-content">';
const WARNING_ATTRIBUTE = "data-conversions-bootstrap-warning";

// OWNER 2026-09-08: a second person opened the Conversions tab and got
// "Critical: permanent Conversions authority is unavailable. Production effects
// remain blocked." That sentence describes an outage. The actual state was an
// account with no Conversions membership — resolvePermanentConversionsActor
// throws `forbidden` when no active principal + membership + workspace row
// matches the Access identity, and this banner collapsed `forbidden` and
// `unavailable` into the one outage sentence. The reader spent the next stretch
// debugging infrastructure that was healthy.
//
// Both messages stay non-secret: neither names an email, a workspace, a role,
// nor says anything about which accounts DO exist. "Not set up" is already
// known to the person reading it — they are the one who cannot get in.
const BLOCKED_MESSAGE = {
  forbidden: "This account is not set up for Conversions. Ask the workspace's "
    + "accountable owner to add it, then reload this page.",
  unavailable: "Critical: permanent Conversions authority is unavailable. "
    + "Production effects remain blocked.",
} as const;

type BlockedKind = keyof typeof BLOCKED_MESSAGE;

function banner(kind: BlockedKind): string {
  return `<div ${WARNING_ATTRIBUTE}="${kind}" role="status" `
    + 'style="background:#7f1d1d;color:#fff;border-color:#450a0a;border-style:solid;border-width:1px;'
    + 'border-radius:6px;padding:12px 16px;margin:0 0 16px;font-weight:650">'
    + `${BLOCKED_MESSAGE[kind]}</div>`;
}

// Registered after Access only on authenticated Conversions/Reporting HTML surfaces.
export const conversionsBootstrapWarning: MiddlewareHandler<{
  Bindings: Env;
  Variables: AccessAuthVariables;
}> = async (c, next) => {
  await next();
  const contentType = c.res.headers.get("content-type")?.toLowerCase();
  if (c.res.status < 200 || c.res.status >= 300 || !contentType?.startsWith("text/html")) return;

  let kind: BlockedKind;
  try {
    await resolvePermanentConversionsActor(c.env, c.get("access"));
    return;
  } catch (error) {
    // Fail closed to the outage message: only a positively identified
    // `forbidden` earns the enrollment wording.
    kind = error instanceof PermanentAuthorityError && error.kind === "forbidden"
      ? "forbidden"
      : "unavailable";
  }

  const original = await c.res.text();
  const warning = banner(kind);
  const html = original.includes(WARNING_ATTRIBUTE) ? original
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
