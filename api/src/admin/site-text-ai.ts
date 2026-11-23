// X06 (SEO Fixes): POST /api/admin/ai/site-text — Settings → General
// "✨ Write with AI" next to "Tagline" and "Site Description".
//
// Body: { site_id, field: "tagline" | "site_description", site_name?, audience? }
// (site_name / audience are the form's unsaved values; when given and
// non-empty they win over the saved ones).
//
// Writes a fresh suggestion with the SAME generators and presets setup uses
// (generateSiteTagline / generateSiteDescription → the 'tagline' and
// 'site-description' presets, plus the shared "{{" check), from the Site Name,
// Vertical, Audience and the site's 5 newest Article titles.
//
// It never saves a setting: the operator decides with "Save settings". The
// only write is the usual ai_generations receipt (the AI log), under a fresh
// key per click so an earlier answer is never handed back.
//
// Responses:
//   200 { text }  — no "{{", a Site Description is at most 160 characters
//   400 { error } — bad JSON, site_id or field
//   404 { error: "Unknown site_id" }
//   502 { error: "The AI didn't answer. Nothing was changed." } — the AI
//       failed, or only the fallback text would come back (the button must
//       never fill in fallback text).

import type { Context } from "hono";
import type { Env } from "../env";
import {
  SITE_DESCRIPTION_MAX_CHARS,
  generateSiteDescription,
  generateSiteTagline,
} from "../ai/generators/text";
import { containsPlaceholder, resolveSiteAudience } from "../ai/site-audience";

type Ctx = Context<{ Bindings: Env }>;

export const SITE_TEXT_AI_FAILED = "The AI didn't answer. Nothing was changed.";
export const SITE_TEXT_FIELDS = ["tagline", "site_description"] as const;
export type SiteTextField = (typeof SITE_TEXT_FIELDS)[number];

const MAX_SITE_ID_LENGTH = 128;
const RECENT_TITLES = 5;

// A form override counts only when it is real text (empty or "{{" → ignored,
// the saved value is used instead).
function override(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length > 0 && !containsPlaceholder(v) ? v : null;
}

function cleanSaved(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length > 0 && !containsPlaceholder(v) ? v : null;
}

async function readSetting(db: D1Database, siteId: string, key: string): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT value FROM site_settings WHERE site_id = ? AND key = ? LIMIT 1")
      .bind(siteId, key)
      .first<{ value: string | null }>();
    return cleanSaved(row?.value);
  } catch {
    return null;
  }
}

async function readVerticalName(db: D1Database, slug: string | null): Promise<string | null> {
  if (!slug) return null;
  try {
    const row = await db
      .prepare("SELECT name FROM verticals WHERE slug = ? LIMIT 1")
      .bind(slug)
      .first<{ name: string | null }>();
    return cleanSaved(row?.name);
  } catch {
    return null;
  }
}

async function readRecentTitles(db: D1Database, siteId: string): Promise<string[]> {
  try {
    const res = await db
      .prepare(
        "SELECT title FROM articles WHERE site_id = ? AND status = 'published' " +
          "ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .bind(siteId, RECENT_TITLES)
      .all<{ title: string | null }>();
    return (res?.results ?? [])
      .map((r) => cleanSaved(r.title))
      .filter((t): t is string => t !== null);
  } catch {
    return [];
  }
}

function freshSuffix(field: SiteTextField): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `write-with-ai:${field}:${id}`;
}

export async function handleSiteTextAi(c: Ctx): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const parsed = (await c.req.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return c.json({ error: "Send a JSON object." }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return c.json({ error: "Send a JSON object." }, 400);
  }

  const siteId = typeof body.site_id === "string" ? body.site_id.trim() : "";
  if (siteId.length === 0 || siteId.length > MAX_SITE_ID_LENGTH) {
    return c.json({ error: "site_id is required." }, 400);
  }
  const field = body.field;
  if (field !== "tagline" && field !== "site_description") {
    return c.json({ error: 'field must be "tagline" or "site_description".' }, 400);
  }

  const db = c.env.DB;
  const site = await db
    .prepare("SELECT id, name, domain, vertical_slug FROM sites WHERE id = ? LIMIT 1")
    .bind(siteId)
    .first<{ id: string; name: string | null; domain: string | null; vertical_slug: string | null }>();
  if (!site) return c.json({ error: "Unknown site_id" }, 404);

  const siteName =
    override(body.site_name) ??
    (await readSetting(db, siteId, "site_name")) ??
    cleanSaved(site.name) ??
    siteId;
  const audience = override(body.audience) ?? (await resolveSiteAudience(db, siteId));
  const verticalSlug = cleanSaved(site.vertical_slug);
  const vertical =
    (await readVerticalName(db, verticalSlug)) ?? verticalSlug ?? "general topics";
  const recentTitles = await readRecentTitles(db, siteId);
  const common = {
    site_id: siteId,
    vertical,
    brand_name: siteName,
    audience,
    domain: cleanSaved(site.domain) ?? undefined,
    recent_titles: recentTitles,
    idempotency_suffix: freshSuffix(field),
  };

  let text = "";
  let ok = false;
  try {
    if (field === "tagline") {
      const result = await generateSiteTagline(c.env, common);
      ok = result.status === "success";
      text = (result.parsed.tagline ?? "").trim();
    } else {
      const tagline = await readSetting(db, siteId, "tagline");
      const result = await generateSiteDescription(c.env, {
        ...common,
        ...(tagline ? { tagline } : {}),
      });
      ok = result.status === "success";
      text = (result.parsed.description ?? "").trim();
    }
  } catch {
    ok = false;
  }

  if (
    !ok ||
    text.length === 0 ||
    containsPlaceholder(text) ||
    (field === "site_description" && text.length > SITE_DESCRIPTION_MAX_CHARS)
  ) {
    return c.json({ error: SITE_TEXT_AI_FAILED }, 502);
  }
  return c.json({ text }, 200);
}
