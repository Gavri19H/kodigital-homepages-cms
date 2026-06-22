// First-party newsletter capture (rescue-4 round-2, issue 14). The public
// newsletter form is now always active; when no third-party provider is
// configured it posts here so the signup is never a dead control. Subscribers
// are stored in KV (CACHE) keyed by host + email (idempotent) -- no migration.
// A no-JS form submit gets a 303 redirect back with ?subscribed=1; an XHR/JSON
// caller gets {ok:true}. Public + unauthenticated (NOT under /api/admin, so the
// ADMIN_HOST gate does not apply on tenant hosts).
import { Hono } from "hono";
import type { Env } from "./env";

const newsletter = new Hono<{ Bindings: Env }>();

function isEmail(v: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

function appendQuery(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    const sep = url.indexOf("?") === -1 ? "?" : "&";
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

newsletter.post("/api/newsletter/subscribe", async (c) => {
  let email = "";
  const contentType = c.req.header("content-type") ?? "";
  try {
    if (contentType.indexOf("application/json") !== -1) {
      const body = await c.req.json<{ email?: unknown }>();
      email = typeof body.email === "string" ? body.email : "";
    } else {
      const form = await c.req.parseBody();
      const v = form["email"];
      email = typeof v === "string" ? v : "";
    }
  } catch {
    email = "";
  }
  email = email.trim().toLowerCase();
  const wantsHtml = (c.req.header("accept") ?? "").indexOf("text/html") !== -1;
  const back = c.req.header("referer") ?? "/";
  if (!isEmail(email) || email.length > 254) {
    if (wantsHtml) return c.redirect(appendQuery(back, "subscribed", "invalid"), 303);
    return c.json({ ok: false, error: "invalid_email" }, 400);
  }
  const host = new URL(c.req.url).hostname.toLowerCase();
  try {
    await c.env.CACHE.put(
      `newsletter:${host}:${email}`,
      JSON.stringify({ email, host, at: Date.now() }),
    );
  } catch {
    // best-effort capture; never fail the subscriber's submit on a KV hiccup.
  }
  if (wantsHtml) return c.redirect(appendQuery(back, "subscribed", "1"), 303);
  return c.json({ ok: true });
});

export default newsletter;
