// T20 [E3]: real POST /api/admin/ai/logo handler.
//
// Generates a logo mark for ONE site and applies it. Reuses the T8 logo
// generator (generateLogoImage in ../ai/generators/image): prompt build,
// OpenAI image call, R2 put under the deterministic ai/<site>/logo/ key,
// media row insert, ai_generations receipt — all owned by the generator.
// This handler adds the admin-endpoint contract on top: 501 no-key, 400
// bad input, 404 unknown site, and the setting write — the resulting
// media id is written to site_settings.logo_media_id for the POSTed
// site_id ONLY (tenant guard: brand inputs are read from that site's own
// sites row, never trusted from the request body; every write binds that
// site_id). A 2xx response is returned ONLY after both the media row and
// the setting write exist.

import type { Context } from "hono";
import type { Env } from "../env";
import { getImageModel } from "../ai/models";
import { generateLogoImage } from "../ai/generators/image";

// T24: the admin AI-logo panel posts a LogoRequest — the operator's free-text
// description (wire field `prompt`), a `style` keyword, and a `colorScheme`.
// These are creative DIRECTION (not tenant identity), so they are read from the
// request body; the site's brand inputs are still read from its own sites row.
interface LogoBody {
  site_id?: string;
  prompt?: string;
  style?: string;
  colorScheme?: string;
}

// Operator-direction inputs are length-capped so a hostile body cannot bloat
// the outbound prompt; an empty/whitespace value is treated as absent.
function directedField(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 500) : "";
}

const LOGO_SETTING_KEY = "logo_media_id";

export async function handleAdminAiLogo(c: Context<{ Bindings: Env }>) {
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: "OPENAI_API_KEY is not configured" }, 501);
  }
  let body: LogoBody = {};
  try {
    body = await c.req.json<LogoBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const site_id = typeof body.site_id === "string" ? body.site_id.trim() : "";
  if (!site_id) return c.json({ error: "site_id is required" }, 400);

  try {
    getImageModel(c.env);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }

  // Tenant guard: the logo targets ONE site's settings. Brand inputs come
  // from that site's row — a missing row means no writes of any kind.
  const site = await c.env.DB.prepare(
    "SELECT id, name, vertical_slug FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(site_id)
    .first<{ id: string; name: string | null; vertical_slug: string | null }>();
  if (!site) return c.json({ error: `site not found: ${site_id}` }, 404);

  const brand_name =
    typeof site.name === "string" && site.name.length > 0 ? site.name : site.id;
  const vertical =
    typeof site.vertical_slug === "string" && site.vertical_slug.length > 0
      ? site.vertical_slug
      : "general topics";

  // T24: forward the operator's direction (LogoRequest) into the prompt. Each
  // field refines the mark only when present; absent, generateLogoImage builds
  // the undirected default exactly as before.
  const description = directedField(body.prompt);
  const style = directedField(body.style);
  const colorScheme = directedField(body.colorScheme);

  try {
    const outcome = await generateLogoImage(c.env, {
      site_id,
      vertical,
      brand_name,
      ...(description ? { description } : {}),
      ...(style ? { style } : {}),
      ...(colorScheme ? { colorScheme } : {}),
    });
    if (outcome.status === "skipped_no_api_key") {
      // Unreachable (key presence checked above) but kept for the 501
      // contract rather than inventing a fake success.
      return c.json({ error: "OPENAI_API_KEY is not configured" }, 501);
    }
    if (outcome.status !== "success" || outcome.media_id <= 0) {
      // The generator already wrote the failed/fallback receipt row.
      // Never 2xx without the media row — and without it, no setting write.
      return c.json(
        { error: "AI logo generation failed", ai_generation_id: outcome.ai_generation_id },
        502,
      );
    }

    // Apply the logo: the admin explicitly clicked "generate" for THIS
    // site, so the setting overwrites any previous value (unlike
    // provisioning's fill-if-empty seed) — still bound to the posted
    // site_id only.
    await c.env.DB.prepare(
      "INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?) " +
        "ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value",
    )
      .bind(site_id, LOGO_SETTING_KEY, outcome.storage_key)
      .run();

    return c.json({
      ok: true,
      media_id: outcome.media_id,
      storage_key: outcome.storage_key,
      image_url: `/media/${outcome.storage_key}`,
      ai_generation_id: outcome.ai_generation_id,
      setting_key: LOGO_SETTING_KEY,
      // T24: echo the direction that was applied so the panel (and tests) can
      // confirm a DIRECTED regenerate, not a fixed-prompt one.
      directed: Boolean(description || style || colorScheme),
      applied_direction: { prompt: description, style, colorScheme },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
}
