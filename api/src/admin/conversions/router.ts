import { Hono } from "hono";
import type { Context } from "hono";
import type { AccessAuthVariables } from "../../auth/access-auth";
import { isConversionsUiEnabled, type Env } from "../../env";
import { adminLayout, escapeHtml } from "../templates/layout";
import { ADMIN_ASSET_MANIFEST } from "./asset-manifest.generated";
import {
  PermanentAuthorityError,
  resolvePermanentConversionsActor,
} from "./permanent-authority";

type ConversionsEnv = { Bindings: Env; Variables: AccessAuthVariables };
type ConversionsContext = Context<ConversionsEnv>;
type ManifestAsset =
  | typeof ADMIN_ASSET_MANIFEST.conversions.js
  | typeof ADMIN_ASSET_MANIFEST.conversions.css
  | typeof ADMIN_ASSET_MANIFEST.reporting.js
  | typeof ADMIN_ASSET_MANIFEST.reporting.css;

export const conversionsUi = new Hono<ConversionsEnv>();

interface ShellPage {
  key: "flows" | "connections" | "activity" | "controls" | "reports";
}

const PAGE_BY_PATH = new Map<string, ShellPage>([
  ["/admin/conversions", { key: "flows" }],
  ["/admin/conversions/flows", { key: "flows" }],
  ["/admin/conversions/connections", { key: "connections" }],
  ["/admin/conversions/activity", { key: "activity" }],
  ["/admin/conversions/controls", { key: "controls" }],
  ["/admin/reporting", { key: "reports" }],
]);

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const ASSETS_BY_URL = new Map<string, ManifestAsset>([
  [ADMIN_ASSET_MANIFEST.conversions.js.url, ADMIN_ASSET_MANIFEST.conversions.js],
  [ADMIN_ASSET_MANIFEST.conversions.css.url, ADMIN_ASSET_MANIFEST.conversions.css],
  [ADMIN_ASSET_MANIFEST.reporting.js.url, ADMIN_ASSET_MANIFEST.reporting.js],
  [ADMIN_ASSET_MANIFEST.reporting.css.url, ADMIN_ASSET_MANIFEST.reporting.css],
]);

function isEnabled(c: ConversionsContext): boolean {
  return isConversionsUiEnabled(c.env.CONVERSIONS_UI_ENABLED);
}

function notFound(c: ConversionsContext): Response {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.json({ error: "Not Found" }, 404);
}

function dependencyUnavailable(c: ConversionsContext): Response {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  return c.json({ error: "Static assets unavailable" }, 503);
}

function getUserEmail(c: ConversionsContext): string | undefined {
  const access = c.get("access");
  return access?.mode === "identity" ? access.email : undefined;
}

interface ParsedEntityTag {
  nextIndex: number;
  opaqueTag: string;
}

function skipOptionalWhitespace(value: string, startIndex: number): number {
  let index = startIndex;
  while (value[index] === " " || value[index] === "\t") index += 1;
  return index;
}

function parseEntityTag(value: string, startIndex: number): ParsedEntityTag | null {
  let index = startIndex;
  if (value.startsWith("W/", index)) index += 2;
  if (value[index] !== '"') return null;

  const opaqueStart = index;
  index += 1;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 0x22) {
      return {
        nextIndex: index + 1,
        opaqueTag: value.slice(opaqueStart, index + 1),
      };
    }
    // RFC 9110 entity-tag characters: ! / # through ~ / obs-text.
    if (code !== 0x21 && !(code >= 0x23 && code <= 0x7e) && !(code >= 0x80 && code <= 0xff)) {
      return null;
    }
    index += 1;
  }
  return null;
}

export function ifNoneMatchMatches(header: string | undefined, currentEtag: string): boolean {
  if (header === undefined) return false;

  let index = skipOptionalWhitespace(header, 0);
  if (header[index] === "*") {
    index = skipOptionalWhitespace(header, index + 1);
    return index === header.length;
  }

  const currentStart = skipOptionalWhitespace(currentEtag, 0);
  const current = parseEntityTag(currentEtag, currentStart);
  if (current === null || skipOptionalWhitespace(currentEtag, current.nextIndex) !== currentEtag.length) {
    return false;
  }

  let matched = false;
  let parsedAny = false;
  while (index < header.length) {
    const candidate = parseEntityTag(header, index);
    if (candidate === null) return false;
    parsedAny = true;
    matched = matched || candidate.opaqueTag === current.opaqueTag;
    index = skipOptionalWhitespace(header, candidate.nextIndex);
    if (index === header.length) return parsedAny && matched;
    if (header[index] !== ",") return false;
    index = skipOptionalWhitespace(header, index + 1);
    if (index === header.length) return false;
  }
  return false;
}

async function serveAdminAsset(c: ConversionsContext): Promise<Response> {
  if (!isEnabled(c)) return notFound(c);
  const asset = ASSETS_BY_URL.get(c.req.path);
  if (asset === undefined) return notFound(c);

  const method = c.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return notFound(c);
  const headers = new Headers({
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'none'; object-src 'none'; base-uri 'none'",
    "Content-Type": asset.contentType,
    ETag: asset.etag,
    "X-Content-Type-Options": "nosniff",
  });
  if (ifNoneMatchMatches(c.req.header("if-none-match"), asset.etag)) {
    return new Response(null, { status: 304, headers });
  }

  const binding = c.env.ADMIN_ASSETS;
  if (binding === undefined) return dependencyUnavailable(c);
  let upstream: Response;
  try {
    upstream = await binding.fetch(c.req.raw);
  } catch {
    return dependencyUnavailable(c);
  }
  if (upstream.status === 404) return notFound(c);
  if (!upstream.ok) return dependencyUnavailable(c);
  return new Response(method === "HEAD" ? null : upstream.body, { status: 200, headers });
}

conversionsUi.on(
  ["GET", "HEAD"],
  ["/assets/admin/conversions/:fileName", "/assets/admin/reporting/:fileName"],
  serveAdminAsset,
);

conversionsUi.get("/api/admin/conversions/ui-context", async (c) => {
  if (!isEnabled(c)) return notFound(c);
  try {
    const authority = await resolvePermanentConversionsActor(c.env, c.get("access"));
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    return c.json({
      schema_version: "cms_conversions_ui_context.v2",
      workspace_id: authority.workspaceId,
      role: authority.role,
      capabilities: authority.cmsCapabilities,
      account_scope: authority.accountScope,
      reporting_currency: authority.reportingCurrency,
      time_zone: authority.timeZone,
      recipient_scope: [{
        recipient_id: authority.principalId,
        display_label: authority.canonicalEmail,
      }],
    });
  } catch (error) {
    if (error instanceof PermanentAuthorityError) {
      c.header("Cache-Control", "no-store");
      return c.json(
        { error: { code: error.kind, message: "Conversions access is unavailable." } },
        error.kind === "forbidden" ? 403 : 503,
      );
    }
    c.header("Cache-Control", "no-store");
    return c.json(
      { error: { code: "unavailable", message: "Conversions access is unavailable." } },
      503,
    );
  }
});

function renderPage(c: ConversionsContext, page: ShellPage): Response {
  if (!isEnabled(c)) return notFound(c);
  const reporting = page.key === "reports";
  const assets = reporting ? ADMIN_ASSET_MANIFEST.reporting : ADMIN_ASSET_MANIFEST.conversions;
  const rootId = reporting ? "ko-reporting-root" : "ko-conversions-root";
  const content = `<div id="${rootId}" data-page="${escapeHtml(page.key)}" data-shell-state="dependency_unavailable" data-bootstrap-active="false"><noscript><div role="status">JavaScript is required to load Conversions and Reporting. No actions are available.</div></noscript></div>`;
  const html = adminLayout({
    title: reporting ? "Reporting" : "Conversions",
    activePath: reporting ? "/admin/reporting" : `/admin/conversions/${page.key}`,
    userEmail: getUserEmail(c),
    content,
    stylesheets: [assets.css.url],
    moduleScripts: [assets.js.url],
    conversionsUiEnabled: true,
  });
  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": PAGE_CSP,
      "Content-Type": "text/html; charset=UTF-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

for (const [path, page] of PAGE_BY_PATH) {
  conversionsUi.get(path, (c) => renderPage(c, page));
}

// Exact section-6 detail/create URLs use the same non-reflecting product shell.
// The client reads the normalized pathname and all business data still arrives
// only through authenticated same-origin JSON routes.
conversionsUi.get("/admin/conversions/flows/new", (c) => renderPage(c, { key: "flows" }));
conversionsUi.get("/admin/conversions/flows/:flowId", (c) => renderPage(c, { key: "flows" }));
conversionsUi.get("/admin/conversions/connections/new", (c) => renderPage(c, { key: "connections" }));
conversionsUi.get("/admin/conversions/connections/:connectionId", (c) => renderPage(c, { key: "connections" }));
conversionsUi.get("/admin/conversions/activity/:runId", (c) => renderPage(c, { key: "activity" }));
conversionsUi.get("/admin/reporting/new", (c) => renderPage(c, { key: "reports" }));
conversionsUi.get("/admin/reporting/:reportId", (c) => renderPage(c, { key: "reports" }));
