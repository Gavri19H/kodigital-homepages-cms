// Articles admin CRUD (contract §7.1 / §11 / §23).
//
// An Article is the PER-SITE stable URL identity; content lives on Versions
// (§5.2). Creating an Article auto-creates ONE control Version (label 'A',
// 100%, is_control=1) in the same D1 batch — the two INSERTs commit or roll
// back together (§5.3 "in a txn").

import { mintPublicId } from "../../listicles/ids";
import {
  validateArticle,
  validateExperiment,
  validateVersion,
  validateVersionFields,
  ARTICLE_STATUSES,
  type FieldErrors,
} from "../../listicles/validation";
import {
  buildConflictPayload,
  detectRuleConflicts,
  parseConditions,
  type RuleGuardEntry,
} from "../../listicles/rules";
import {
  type AdminContext,
  buildPaging,
  chunk,
  escapeLike,
  idSelector,
  parseDateRange,
  parsePaging,
  placeholders,
  readJsonBody,
} from "./shared";
import { loadPagesForVersions, type StructurePage } from "./structure";

export interface ArticleRowL {
  id: number;
  public_id: string;
  site_id: string;
  slug: string;
  article_name: string;
  status: string;
  active_experiment_id: number | null;
  published_at: number | null;
  scheduled_at: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface VersionRowL {
  id: number;
  public_id: string;
  article_id: number;
  experiment_id: number | null;
  variant_label: string;
  is_control: number;
  traffic_allocation: number;
  headline: string;
  intro_paragraph: string;
  hero_media_id: number | null;
  hero_media_url: string | null;
  layout_style_id: string;
  byline_json: string | null;
  ai_settings_json: string | null;
  content_version: number;
  status: string;
  created_at: number;
}

interface ExperimentRowL {
  id: number;
  public_id: string;
  article_id: number;
  name: string;
  status: string;
  started_at: number | null;
  stopped_at: number | null;
  created_at: number;
}

export async function resolveArticleRow(
  db: D1Database,
  idParam: string,
): Promise<ArticleRowL | null> {
  const selector = idSelector(idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM listicle_articles WHERE id = ? LIMIT 1"
      : "SELECT * FROM listicle_articles WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<ArticleRowL>();
  return row ?? null;
}

// GET /api/admin/listicles/articles?site_id=&search=&page=&page_size= —
// site-scoped list + pager (§7.1; same envelope as the offers list).
// ?search= filters on article_name/slug (LIKE, wildcard-escaped) — the DEV-10
// deferral ("search ships with the Phase-5 builder") closes here.
export async function listArticlesHandler(c: AdminContext): Promise<Response> {
  const siteId = c.req.query("site_id")?.trim() ?? "";
  if (siteId === "") {
    return c.json(
      { error: "Validation failed", fields: { site_id: "site_id is required" } },
      400,
    );
  }
  const search = c.req.query("search")?.trim() ?? "";
  const { page, pageSize, offset } = parsePaging(c);

  let where = "a.site_id = ?";
  const whereBinds: unknown[] = [siteId];
  if (search !== "") {
    const like = `%${escapeLike(search)}%`;
    where += " AND (a.article_name LIKE ? ESCAPE '\\' OR a.slug LIKE ? ESCAPE '\\')";
    whereBinds.push(like, like);
  }

  const rows = await c.env.DB.prepare(
    `SELECT a.*,
            (SELECT COUNT(*) FROM listicle_article_versions v
              WHERE v.article_id = a.id AND v.status = 'active') AS version_count,
            (SELECT e.status FROM listicle_article_experiments e
              WHERE e.id = a.active_experiment_id) AS experiment_status
     FROM listicle_articles a
     WHERE ${where}
     ORDER BY a.updated_at DESC, a.id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...whereBinds, pageSize, offset)
    .all<ArticleRowL & { version_count: number; experiment_status: string | null }>();
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM listicle_articles a WHERE ${where}`,
  )
    .bind(...whereBinds)
    .first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);
  return c.json({
    articles: rows.results ?? [],
    paging: buildPaging(page, pageSize, total),
    site_id: siteId,
  });
}

async function slugTaken(
  db: D1Database,
  siteId: string,
  slug: string,
  excludeId?: number,
): Promise<boolean> {
  const row =
    excludeId === undefined
      ? await db
          .prepare("SELECT id FROM listicle_articles WHERE site_id = ? AND slug = ? LIMIT 1")
          .bind(siteId, slug)
          .first<{ id: number }>()
      : await db
          .prepare(
            "SELECT id FROM listicle_articles WHERE site_id = ? AND slug = ? AND id != ? LIMIT 1",
          )
          .bind(siteId, slug, excludeId)
          .first<{ id: number }>();
  return row !== null && row !== undefined;
}

// POST /api/admin/listicles/articles — create base + ONE control Version
// atomically (env.DB.batch). The version row attaches via a scalar subselect
// on the article's freshly-minted unique public_id.
export async function createArticleHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const base = validateArticle(body);
  const versionFields = validateVersionFields(body);
  const errors: FieldErrors = { ...base.errors, ...versionFields.errors };
  if (base.value === null || versionFields.value === null) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  const site = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
    .bind(base.value.site_id)
    .first<{ id: string }>();
  if (!site) {
    return c.json(
      { error: "Validation failed", fields: { site_id: `unknown site_id: ${base.value.site_id}` } },
      400,
    );
  }
  if (await slugTaken(c.env.DB, base.value.site_id, base.value.slug)) {
    return c.json(
      {
        error: "Validation failed",
        fields: { slug: `slug '${base.value.slug}' already exists for this site` },
      },
      400,
    );
  }

  const articlePublicId = mintPublicId("article");
  const versionPublicId = mintPublicId("version"); // == the control lander_v (§15.6)
  const v = versionFields.value;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO listicle_articles (public_id, site_id, slug, article_name, status)
         VALUES (?, ?, ?, ?, 'draft')`,
      ).bind(articlePublicId, base.value.site_id, base.value.slug, base.value.article_name),
      c.env.DB.prepare(
        `INSERT INTO listicle_article_versions
           (public_id, article_id, variant_label, is_control, traffic_allocation,
            headline, intro_paragraph, hero_media_id, hero_media_url,
            layout_style_id, ai_settings_json, content_version, status)
         VALUES (?, (SELECT id FROM listicle_articles WHERE public_id = ?),
                 'A', 1, 100, ?, ?, ?, ?, ?, ?, 1, 'active')`,
      ).bind(
        versionPublicId,
        articlePublicId,
        v.headline,
        v.intro_paragraph,
        v.hero_media_id,
        v.hero_media_url,
        v.layout_style_id,
        v.ai_settings_json,
      ),
    ]);
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/UNIQUE/i.test(message) && /slug|listicle_articles/i.test(message)) {
      return c.json(
        {
          error: "Validation failed",
          fields: { slug: `slug '${base.value.slug}' already exists for this site` },
        },
        400,
      );
    }
    // The batch is transactional: nothing was written.
    return c.json({ error: `Create failed: ${message}` }, 400);
  }

  const article = await c.env.DB.prepare(
    "SELECT * FROM listicle_articles WHERE public_id = ? LIMIT 1",
  )
    .bind(articlePublicId)
    .first<ArticleRowL>();
  const version = await c.env.DB.prepare(
    "SELECT * FROM listicle_article_versions WHERE public_id = ? LIMIT 1",
  )
    .bind(versionPublicId)
    .first<VersionRowL>();
  if (!article || !version) return c.json({ error: "Insert failed" }, 500);
  return c.json({ article, version }, 201);
}

// PATCH /api/admin/listicles/articles/:id — base fields only
// (site/slug/name/status — §7.1); slug uniqueness per site → field-keyed 400.
export async function patchArticleHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveArticleRow(c.env.DB, c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const errors: FieldErrors = {};
  const setClauses: string[] = [];
  const bindings: unknown[] = [];

  let targetSiteId = existing.site_id;
  if (body.site_id !== undefined) {
    if (typeof body.site_id !== "string" || body.site_id.trim() === "") {
      errors.site_id = "site_id must be a non-empty string";
    } else {
      const site = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
        .bind(body.site_id.trim())
        .first<{ id: string }>();
      if (!site) {
        errors.site_id = `unknown site_id: ${body.site_id.trim()}`;
      } else {
        targetSiteId = body.site_id.trim();
        setClauses.push("site_id = ?");
        bindings.push(targetSiteId);
      }
    }
  }
  if (body.article_name !== undefined) {
    if (typeof body.article_name !== "string" || body.article_name.trim() === "") {
      errors.article_name = "article_name must be a non-empty string";
    } else {
      setClauses.push("article_name = ?");
      bindings.push(body.article_name.trim());
    }
  }
  let targetSlug = existing.slug;
  if (body.slug !== undefined) {
    const check = validateArticle({
      site_id: targetSiteId,
      article_name: existing.article_name,
      slug: body.slug,
    });
    if (check.value === null) {
      errors.slug = check.errors.slug ?? "invalid slug";
    } else {
      targetSlug = check.value.slug;
      setClauses.push("slug = ?");
      bindings.push(targetSlug);
    }
  }
  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !(ARTICLE_STATUSES as readonly string[]).includes(body.status)
    ) {
      errors.status = "status must be one of draft, published, scheduled, archived";
    } else {
      setClauses.push("status = ?");
      bindings.push(body.status);
    }
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }
  if (setClauses.length === 0) return c.json({ error: "No updatable fields provided" }, 400);

  // UNIQUE(site_id, slug): re-check whenever either half changes.
  if (
    (targetSlug !== existing.slug || targetSiteId !== existing.site_id) &&
    (await slugTaken(c.env.DB, targetSiteId, targetSlug, existing.id))
  ) {
    return c.json(
      {
        error: "Validation failed",
        fields: { slug: `slug '${targetSlug}' already exists for this site` },
      },
      400,
    );
  }

  setClauses.push("updated_at = unixepoch()");
  bindings.push(existing.id);
  try {
    await c.env.DB.prepare(
      `UPDATE listicle_articles SET ${setClauses.join(", ")} WHERE id = ?`,
    )
      .bind(...bindings)
      .run();
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/UNIQUE/i.test(message)) {
      return c.json(
        {
          error: "Validation failed",
          fields: { slug: `slug '${targetSlug}' already exists for this site` },
        },
        400,
      );
    }
    return c.json({ error: message || "Update failed" }, 500);
  }
  const updated = await c.env.DB.prepare("SELECT * FROM listicle_articles WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<ArticleRowL>();
  return c.json({ article: updated });
}

// POST /api/admin/listicles/articles/:id/experiments — create article-level
// A/B (§15.8/§23: Σ allocations == 100, exactly one control; the 0032 partial
// unique index enforces at most ONE running experiment per article — a
// violation surfaces as a clean 409).
//
// Phase 5 addition: `status: "draft"` creates the experiment WITHOUT starting
// it (started_at NULL, article.active_experiment_id untouched — §5.2 keeps
// that pointer for the RUNNING experiment). The builder always creates as
// draft so operators can build every arm's pages (PUT /versions/:id only
// 409s on RUNNING experiments) and then POST /experiments/:id/start. The
// default stays "running" — the Phase-2 create-and-start behavior unchanged.
export async function createExperimentHandler(c: AdminContext): Promise<Response> {
  const article = await resolveArticleRow(c.env.DB, c.req.param("id") ?? "");
  if (article === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  let createStatus: "draft" | "running" = "running";
  if (body.status !== undefined) {
    if (body.status !== "draft" && body.status !== "running") {
      return c.json(
        {
          error: "Validation failed",
          fields: { status: "experiment status at create must be draft or running" },
        },
        400,
      );
    }
    createStatus = body.status;
  }

  const { errors, value } = validateExperiment(body);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  // Pre-check for the clean path; the partial unique index still guards races.
  const running = await c.env.DB.prepare(
    "SELECT id, public_id FROM listicle_article_experiments WHERE article_id = ? AND status = 'running' LIMIT 1",
  )
    .bind(article.id)
    .first<{ id: number; public_id: string }>();
  if (running) {
    return c.json(
      {
        error: "experiment_already_running",
        fields: {
          experiment: `article already has running experiment '${running.public_id}' — stop it before starting another (at most one running experiment per Article)`,
        },
      },
      409,
    );
  }

  // Resolve version_id entries to internal rows belonging to THIS article.
  const refErrors: FieldErrors = {};
  const resolvedIds: Array<number | null> = [];
  for (let i = 0; i < value.versions.length; i++) {
    const entry = value.versions[i];
    if (entry === undefined || entry.version_id === null) {
      resolvedIds.push(null);
      continue;
    }
    const selector =
      typeof entry.version_id === "number"
        ? { sql: "SELECT * FROM listicle_article_versions WHERE id = ? LIMIT 1", bind: entry.version_id }
        : {
            sql: "SELECT * FROM listicle_article_versions WHERE public_id = ? LIMIT 1",
            bind: entry.version_id,
          };
    const row = await c.env.DB.prepare(selector.sql).bind(selector.bind).first<VersionRowL>();
    if (!row || row.article_id !== article.id) {
      refErrors[`versions[${i}].version_id`] = `unknown version for this article: ${String(entry.version_id)}`;
      resolvedIds.push(null);
    } else {
      resolvedIds.push(row.id);
    }
  }
  if (Object.keys(refErrors).length > 0) {
    return c.json({ error: "Validation failed", fields: refErrors }, 400);
  }

  const experimentPublicId = mintPublicId("experiment");
  const statements: D1PreparedStatement[] = [
    createStatus === "running"
      ? c.env.DB.prepare(
          `INSERT INTO listicle_article_experiments (public_id, article_id, name, status, started_at)
           VALUES (?, ?, ?, 'running', unixepoch())`,
        ).bind(experimentPublicId, article.id, value.name)
      : c.env.DB.prepare(
          `INSERT INTO listicle_article_experiments (public_id, article_id, name, status)
           VALUES (?, ?, ?, 'draft')`,
        ).bind(experimentPublicId, article.id, value.name),
  ];
  const versionPublicIds: string[] = [];
  for (let i = 0; i < value.versions.length; i++) {
    const entry = value.versions[i];
    if (entry === undefined) continue;
    const label = entry.variant_label ?? String.fromCharCode(65 + (i % 26));
    const resolvedId = resolvedIds[i] ?? null;
    if (resolvedId !== null) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE listicle_article_versions
           SET experiment_id = (SELECT id FROM listicle_article_experiments WHERE public_id = ?),
               traffic_allocation = ?, is_control = ?, variant_label = ?
           WHERE id = ?`,
        ).bind(
          experimentPublicId,
          entry.traffic_allocation,
          entry.is_control ? 1 : 0,
          label,
          resolvedId,
        ),
      );
    } else if (entry.new_version !== null) {
      const fields = validateVersionFields(entry.new_version);
      if (fields.value === null) {
        return c.json({ error: "Validation failed", fields: fields.errors }, 400);
      }
      const versionPublicId = mintPublicId("version");
      versionPublicIds.push(versionPublicId);
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO listicle_article_versions
             (public_id, article_id,
              experiment_id, variant_label, is_control, traffic_allocation,
              headline, intro_paragraph, hero_media_id, hero_media_url,
              layout_style_id, ai_settings_json, content_version, status)
           VALUES (?, ?,
                   (SELECT id FROM listicle_article_experiments WHERE public_id = ?),
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
        ).bind(
          versionPublicId,
          article.id,
          experimentPublicId,
          label,
          entry.is_control ? 1 : 0,
          entry.traffic_allocation,
          fields.value.headline,
          fields.value.intro_paragraph,
          fields.value.hero_media_id,
          fields.value.hero_media_url,
          fields.value.layout_style_id,
          fields.value.ai_settings_json,
        ),
      );
    }
  }
  // §5.2: active_experiment_id points at the RUNNING experiment only — a
  // draft creation leaves it untouched (start flips it).
  statements.push(
    createStatus === "running"
      ? c.env.DB.prepare(
          `UPDATE listicle_articles
           SET active_experiment_id = (SELECT id FROM listicle_article_experiments WHERE public_id = ?),
               updated_at = unixepoch()
           WHERE id = ?`,
        ).bind(experimentPublicId, article.id)
      : c.env.DB.prepare(
          "UPDATE listicle_articles SET updated_at = unixepoch() WHERE id = ?",
        ).bind(article.id),
  );

  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/UNIQUE/i.test(message)) {
      // The 0032 partial unique index (one RUNNING experiment per article)
      // fired mid-batch — the whole batch rolled back.
      return c.json(
        {
          error: "experiment_already_running",
          fields: {
            experiment:
              "article already has a running experiment (at most one running experiment per Article)",
          },
        },
        409,
      );
    }
    return c.json({ error: `Experiment create failed: ${message}` }, 400);
  }

  const experiment = await c.env.DB.prepare(
    "SELECT * FROM listicle_article_experiments WHERE public_id = ? LIMIT 1",
  )
    .bind(experimentPublicId)
    .first<ExperimentRowL>();
  const versions = await c.env.DB.prepare(
    `SELECT * FROM listicle_article_versions
     WHERE experiment_id = (SELECT id FROM listicle_article_experiments WHERE public_id = ?)
     ORDER BY is_control DESC, variant_label ASC`,
  )
    .bind(experimentPublicId)
    .all<VersionRowL>();
  return c.json({ experiment, versions: versions.results ?? [] }, 201);
}

async function resolveExperimentRow(
  db: D1Database,
  idParam: string,
): Promise<ExperimentRowL | null> {
  const selector = idSelector(idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM listicle_article_experiments WHERE id = ? LIMIT 1"
      : "SELECT * FROM listicle_article_experiments WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<ExperimentRowL>();
  return row ?? null;
}

// POST /api/admin/listicles/experiments/:id/start — draft → running (§5.3
// "start experiment (→running)"). The body may carry the FINAL allocations
// ({ versions: [{version_id, traffic_allocation, is_control?, variant_label?}] })
// — the builder's rail edits allocations client-side while the experiment is
// draft and persists them HERE, atomically with the start. Validation
// (§15.8/§23): every ACTIVE version attached to the experiment ends with an
// integer allocation, Σ across them == 100, exactly one control. The 0032
// partial unique index still guards the one-running-per-article invariant
// against races (→ 409).
export async function startExperimentHandler(c: AdminContext): Promise<Response> {
  const experiment = await resolveExperimentRow(c.env.DB, c.req.param("id") ?? "");
  if (experiment === null) return c.json({ error: "Not Found" }, 404);
  if (experiment.status !== "draft") {
    return c.json(
      {
        error: "experiment_not_startable",
        fields: {
          experiment: `experiment '${experiment.public_id}' is ${experiment.status} — only a draft experiment can be started`,
        },
      },
      409,
    );
  }
  const body = (await readJsonBody(c)) ?? {};

  const versionRows = await c.env.DB.prepare(
    "SELECT * FROM listicle_article_versions WHERE experiment_id = ? AND status = 'active' ORDER BY id ASC",
  )
    .bind(experiment.id)
    .all<VersionRowL>();
  const versions = versionRows.results ?? [];
  if (versions.length === 0) {
    return c.json(
      {
        error: "Validation failed",
        fields: { versions: "the experiment has no active Versions to start" },
      },
      400,
    );
  }

  // Merge the caller's allocation entries over the stored rows.
  interface StartEntry {
    traffic_allocation: number;
    is_control: boolean | null;
    variant_label: string | null;
  }
  const overrides = new Map<number, StartEntry>();
  const errors: FieldErrors = {};
  if (body.versions !== undefined) {
    if (!Array.isArray(body.versions)) {
      return c.json(
        { error: "Validation failed", fields: { versions: "versions must be an array" } },
        400,
      );
    }
    body.versions.forEach((rawEntry, index) => {
      const key = (field: string): string => `versions[${index}].${field}`;
      if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
        errors[key("entry")] = "each version entry must be an object";
        return;
      }
      const entry = rawEntry as Record<string, unknown>;
      const ref = entry.version_id;
      const target = versions.find((v) =>
        typeof ref === "number" ? v.id === ref : typeof ref === "string" && v.public_id === ref.trim(),
      );
      if (target === undefined) {
        errors[key("version_id")] = `unknown version for this experiment: ${String(ref)}`;
        return;
      }
      const alloc = entry.traffic_allocation;
      if (typeof alloc !== "number" || !Number.isInteger(alloc) || alloc < 0 || alloc > 100) {
        errors[key("traffic_allocation")] = "traffic_allocation must be an integer 0-100";
        return;
      }
      overrides.set(target.id, {
        traffic_allocation: alloc,
        is_control:
          entry.is_control === undefined ? null : entry.is_control === true || entry.is_control === 1,
        variant_label:
          typeof entry.variant_label === "string" && entry.variant_label.trim() !== ""
            ? entry.variant_label.trim()
            : null,
      });
    });
  }
  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  // §15.8/§23 over the MERGED final state: Σ == 100 + exactly one control.
  const finalState = versions.map((v) => {
    const o = overrides.get(v.id);
    return {
      version: v,
      traffic_allocation: o?.traffic_allocation ?? v.traffic_allocation,
      is_control: o?.is_control ?? v.is_control === 1,
      variant_label: o?.variant_label ?? v.variant_label,
    };
  });
  const sum = finalState.reduce((acc, s) => acc + s.traffic_allocation, 0);
  if (sum !== 100) {
    errors.traffic_allocation = `version allocations must total 100 (got ${sum})`;
  }
  const controls = finalState.filter((s) => s.is_control).length;
  if (controls !== 1) {
    errors.is_control = `exactly one control version is required (got ${controls})`;
  }
  // FIX-3: variant labels identify arms (§15.7 article_variant_label) — a
  // start whose FINAL merged state carries a duplicate label is rejected.
  const seenLabels = new Map<string, string>();
  for (const s of finalState) {
    const key = s.variant_label.trim().toUpperCase();
    const other = seenLabels.get(key);
    if (other !== undefined) {
      errors.variant_label = `duplicate variant_label '${s.variant_label}' (also used by version '${other}') — arm labels must be unique within the experiment`;
      break;
    }
    seenLabels.set(key, s.version.public_id);
  }
  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  const statements: D1PreparedStatement[] = finalState.map((s) =>
    c.env.DB.prepare(
      `UPDATE listicle_article_versions
       SET traffic_allocation = ?, is_control = ?, variant_label = ?
       WHERE id = ?`,
    ).bind(s.traffic_allocation, s.is_control ? 1 : 0, s.variant_label, s.version.id),
  );
  statements.push(
    c.env.DB.prepare(
      "UPDATE listicle_article_experiments SET status = 'running', started_at = unixepoch() WHERE id = ?",
    ).bind(experiment.id),
    c.env.DB.prepare(
      "UPDATE listicle_articles SET active_experiment_id = ?, updated_at = unixepoch() WHERE id = ?",
    ).bind(experiment.id, experiment.article_id),
  );

  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/UNIQUE/i.test(message)) {
      return c.json(
        {
          error: "experiment_already_running",
          fields: {
            experiment:
              "article already has a running experiment (at most one running experiment per Article)",
          },
        },
        409,
      );
    }
    return c.json({ error: `Experiment start failed: ${message}` }, 500);
  }

  const updated = await resolveExperimentRow(c.env.DB, String(experiment.id));
  const updatedVersions = await c.env.DB.prepare(
    "SELECT * FROM listicle_article_versions WHERE experiment_id = ? ORDER BY is_control DESC, variant_label ASC",
  )
    .bind(experiment.id)
    .all<VersionRowL>();
  return c.json({ experiment: updated, versions: updatedVersions.results ?? [] });
}

// POST /api/admin/listicles/experiments/:id/stop — running → stopped (§5.3
// "stopping keeps versions + history"): versions keep their experiment_id and
// allocations; only the status flips (+ stopped_at) and the article's
// active_experiment_id pointer clears (it is defined as the RUNNING
// experiment, §5.2).
//
// DECLARED (Phase 5): §5.3's "promote-winner clones winner to control" is
// deliberately OUT of this phase — a winner is an ANALYTICS verdict, and the
// per-version mirrors that identify one land in Phase 8. The §15.6-conformant
// clone primitive it needs (POST /versions/:id/fork) ships here, so
// promote-winner becomes a thin composition once the numbers exist.
export async function stopExperimentHandler(c: AdminContext): Promise<Response> {
  const experiment = await resolveExperimentRow(c.env.DB, c.req.param("id") ?? "");
  if (experiment === null) return c.json({ error: "Not Found" }, 404);
  if (experiment.status !== "running") {
    return c.json(
      {
        error: "experiment_not_running",
        fields: {
          experiment: `experiment '${experiment.public_id}' is ${experiment.status} — only a running experiment can be stopped`,
        },
      },
      409,
    );
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE listicle_article_experiments SET status = 'stopped', stopped_at = unixepoch() WHERE id = ?",
    ).bind(experiment.id),
    c.env.DB.prepare(
      "UPDATE listicle_articles SET active_experiment_id = NULL, updated_at = unixepoch() WHERE id = ? AND active_experiment_id = ?",
    ).bind(experiment.article_id, experiment.id),
  ]);
  const updated = await resolveExperimentRow(c.env.DB, String(experiment.id));
  return c.json({ experiment: updated });
}

// DELETE /api/admin/listicles/articles/:id — hard delete; the 0032 FK
// cascades remove experiments → versions → pages → candidates → rules.
// Analytics mirror rows are keyed by public_id and intentionally retained
// (§5.3).
export async function deleteArticleHandler(c: AdminContext): Promise<Response> {
  const article = await resolveArticleRow(c.env.DB, c.req.param("id") ?? "");
  if (article === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare("DELETE FROM listicle_articles WHERE id = ?").bind(article.id).run();
  return c.json({ ok: true, id: article.id, public_id: article.public_id });
}

// GET /api/admin/listicles/articles/:id/structure — versions → pages →
// candidates + section names (§7.1), read-only.
export async function articleStructureHandler(c: AdminContext): Promise<Response> {
  const article = await resolveArticleRow(c.env.DB, c.req.param("id") ?? "");
  if (article === null) return c.json({ error: "Not Found" }, 404);

  const versionRows = await c.env.DB.prepare(
    "SELECT * FROM listicle_article_versions WHERE article_id = ? ORDER BY is_control DESC, variant_label ASC, id ASC",
  )
    .bind(article.id)
    .all<VersionRowL>();
  const versions = versionRows.results ?? [];
  const pagesByVersion = await loadPagesForVersions(
    c.env.DB,
    versions.map((v) => v.id),
  );

  // The RUNNING experiment (active_experiment_id, §5.2) wins; otherwise the
  // builder needs the latest DRAFT to resume configuring it (Phase 5 —
  // active_experiment_id intentionally stays running-only per §5.2, so a
  // draft is found by status). Stopped experiments are history, not surfaced
  // here.
  let experiment: ExperimentRowL | null = null;
  if (article.active_experiment_id !== null) {
    experiment =
      (await c.env.DB.prepare("SELECT * FROM listicle_article_experiments WHERE id = ? LIMIT 1")
        .bind(article.active_experiment_id)
        .first<ExperimentRowL>()) ?? null;
  }
  if (experiment === null) {
    experiment =
      (await c.env.DB.prepare(
        "SELECT * FROM listicle_article_experiments WHERE article_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1",
      )
        .bind(article.id)
        .first<ExperimentRowL>()) ?? null;
  }

  return c.json({
    article,
    experiment,
    versions: versions.map((version) => ({
      ...version,
      pages: pagesByVersion.get(version.id) ?? [],
    })),
  });
}

const ARTICLE_METRIC_SELECT = `
  SUM(total_visits) AS total_visits, SUM(unique_visits) AS unique_visits,
  SUM(impressions) AS impressions, SUM(clicks) AS clicks,
  SUM(unique_clicks) AS unique_clicks, SUM(conversions) AS conversions,
  SUM(revenue) AS revenue,
  CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0) AS ctr,
  CAST(SUM(conversions) AS REAL) / NULLIF(SUM(clicks), 0) AS cvr,
  SUM(revenue) / NULLIF(SUM(clicks), 0) AS rpc,
  SUM(revenue) / NULLIF(SUM(impressions), 0) * 1000 AS rpm,
  CAST(SUM(impressions) AS REAL) / NULLIF(SUM(total_visits), 0) AS pps`;

interface ArticleMetricRow {
  article_version_id?: string;
  total_visits: number | null;
  unique_visits: number | null;
  impressions: number | null;
  clicks: number | null;
  unique_clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  ctr: number | null;
  cvr: number | null;
  rpc: number | null;
  rpm: number | null;
  pps: number | null;
}

function normalizeArticleMetrics(row: ArticleMetricRow | null): Record<string, number> {
  return {
    total_visits: row?.total_visits ?? 0,
    unique_visits: row?.unique_visits ?? 0,
    impressions: row?.impressions ?? 0,
    clicks: row?.clicks ?? 0,
    unique_clicks: row?.unique_clicks ?? 0,
    conversions: row?.conversions ?? 0,
    revenue: row?.revenue ?? 0,
    ctr: row?.ctr ?? 0,
    cvr: row?.cvr ?? 0,
    rpc: row?.rpc ?? 0,
    rpm: row?.rpm ?? 0,
    pps: row?.pps ?? 0,
  };
}

// GET /api/admin/listicles/articles/:id/analytics?from&to — per-Version rows
// + the URL total (sums across Versions) from listicle_analytics_article
// (§18). Empty mirror ⇒ zero totals + empty versions, never a 500.
export async function articleAnalyticsHandler(c: AdminContext): Promise<Response> {
  const article = await resolveArticleRow(c.env.DB, c.req.param("id") ?? "");
  if (article === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) {
    return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);
  }

  const totalRow = await c.env.DB.prepare(
    `SELECT ${ARTICLE_METRIC_SELECT}
     FROM listicle_analytics_article
     WHERE article_public_id = ? AND date BETWEEN ? AND ?`,
  )
    .bind(article.public_id, range.from, range.to)
    .first<ArticleMetricRow>();

  const versionRows = await c.env.DB.prepare(
    `SELECT article_version_id, ${ARTICLE_METRIC_SELECT}
     FROM listicle_analytics_article
     WHERE article_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY article_version_id
     ORDER BY article_version_id ASC`,
  )
    .bind(article.public_id, range.from, range.to)
    .all<ArticleMetricRow>();

  return c.json({
    analytics: {
      from: range.from,
      to: range.to,
      total: normalizeArticleMetrics(totalRow ?? null),
      versions: (versionRows.results ?? []).map((row) => ({
        article_version_id: row.article_version_id ?? "",
        ...normalizeArticleMetrics(row),
      })),
    },
  });
}

interface DrilldownRow {
  article_version_id: string;
  page_index: number;
  page_selection_mode: string | null;
  section_public_id: string;
  page_candidate_id: string;
  ab_test_id: string | null;
  page_rule_set_id: string | null;
  page_rule_id: string | null;
  page_rule_priority: number | null;
  selection_reason: string | null;
  impressions: number | null;
  clicks: number | null;
  unique_clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  visits: number | null;
  matched_sessions: number | null;
  fallback_sessions: number | null;
  ctr: number | null;
  cvr: number | null;
  rpc: number | null;
  rpm: number | null;
  rule_match_rate: number | null;
}

// GET /api/admin/listicles/articles/:id/drilldown?from&to — the
// Version → Page → candidate breakdown (§11); rule rows add
// matched_sessions / fallback_sessions / rule_match_rate at READ time
// (rule_match_rate = matched / NULLIF(matched + fallback)).
export async function articleDrilldownHandler(c: AdminContext): Promise<Response> {
  const article = await resolveArticleRow(c.env.DB, c.req.param("id") ?? "");
  if (article === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) {
    return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);
  }

  const rows = await c.env.DB.prepare(
    `SELECT article_version_id, page_index, page_selection_mode, section_public_id,
            page_candidate_id, ab_test_id, page_rule_set_id, page_rule_id,
            page_rule_priority, selection_reason,
            SUM(impressions) AS impressions, SUM(clicks) AS clicks,
            SUM(unique_clicks) AS unique_clicks, SUM(conversions) AS conversions,
            SUM(revenue) AS revenue, SUM(visits) AS visits,
            SUM(matched_sessions) AS matched_sessions,
            SUM(fallback_sessions) AS fallback_sessions,
            CAST(SUM(clicks) AS REAL) / NULLIF(SUM(impressions), 0) AS ctr,
            CAST(SUM(conversions) AS REAL) / NULLIF(SUM(clicks), 0) AS cvr,
            SUM(revenue) / NULLIF(SUM(clicks), 0) AS rpc,
            SUM(revenue) / NULLIF(SUM(impressions), 0) * 1000 AS rpm,
            CAST(SUM(matched_sessions) AS REAL)
              / NULLIF(SUM(matched_sessions) + SUM(fallback_sessions), 0) AS rule_match_rate
     FROM listicle_analytics_drilldown
     WHERE article_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY article_version_id, page_index, page_selection_mode, section_public_id,
              page_candidate_id, ab_test_id, page_rule_set_id, page_rule_id,
              page_rule_priority, selection_reason
     ORDER BY article_version_id ASC, page_index ASC, page_candidate_id ASC`,
  )
    .bind(article.public_id, range.from, range.to)
    .all<DrilldownRow>();

  // Nest version → page → candidate (§11 drilldown expansion).
  interface DrillPage {
    page_index: number;
    page_selection_mode: string;
    candidates: Array<Record<string, unknown>>;
  }
  interface DrillVersion {
    article_version_id: string;
    pages: DrillPage[];
  }
  const versions: DrillVersion[] = [];
  const versionIndex = new Map<string, DrillVersion>();
  for (const row of rows.results ?? []) {
    let version = versionIndex.get(row.article_version_id);
    if (version === undefined) {
      version = { article_version_id: row.article_version_id, pages: [] };
      versionIndex.set(row.article_version_id, version);
      versions.push(version);
    }
    let page = version.pages.find((p) => p.page_index === row.page_index);
    if (page === undefined) {
      page = {
        page_index: row.page_index,
        page_selection_mode: row.page_selection_mode ?? "single",
        candidates: [],
      };
      version.pages.push(page);
    }
    const isRuleBased = (row.page_selection_mode ?? "") === "rule_based";
    page.candidates.push({
      page_candidate_id: row.page_candidate_id,
      section_public_id: row.section_public_id,
      ab_test_id: row.ab_test_id,
      page_rule_set_id: row.page_rule_set_id,
      page_rule_id: row.page_rule_id,
      page_rule_priority: row.page_rule_priority,
      selection_reason: row.selection_reason,
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      unique_clicks: row.unique_clicks ?? 0,
      conversions: row.conversions ?? 0,
      revenue: row.revenue ?? 0,
      visits: row.visits ?? 0,
      ctr: row.ctr ?? 0,
      cvr: row.cvr ?? 0,
      rpc: row.rpc ?? 0,
      rpm: row.rpm ?? 0,
      matched_sessions: isRuleBased ? row.matched_sessions ?? 0 : null,
      fallback_sessions: isRuleBased ? row.fallback_sessions ?? 0 : null,
      rule_match_rate: isRuleBased ? row.rule_match_rate ?? 0 : null,
    });
  }

  return c.json({ drilldown: { from: range.from, to: range.to, versions } });
}

// Re-shape a stored version + its page tree into the validator's payload
// shape so publish re-runs the FULL §23 validation over persisted state.
function versionToValidatorPayload(
  version: VersionRowL,
  pages: StructurePage[],
): Record<string, unknown> {
  return {
    headline: version.headline,
    intro_paragraph: version.intro_paragraph,
    hero_media_id: version.hero_media_id,
    hero_media_url: version.hero_media_url,
    layout_style_id: version.layout_style_id,
    pages: pages.map((page) => ({
      public_id: page.public_id,
      page_index: page.page_index,
      selection_mode: page.selection_mode,
      ab_test_id: page.ab_test_id,
      rule_set_id: page.rule_set_id,
      candidates: page.candidates.map((cand) => ({
        public_id: cand.public_id,
        section_id: cand.section_id,
        label: cand.label,
        traffic_allocation: cand.traffic_allocation,
        is_fallback: cand.is_fallback === 1,
        rule:
          cand.rule === null
            ? null
            : {
                public_id: cand.rule.public_id,
                priority: cand.rule.priority,
                conditions: cand.rule.conditions_json,
              },
      })),
    })),
  };
}

// POST /api/admin/listicles/articles/:id/publish — validate publishable
// (≥1 active Version; every active Version passes full §23 validation +
// the §15.5 conflict guard) → status='published' + published_at.
export async function publishArticleHandler(c: AdminContext): Promise<Response> {
  const article = await resolveArticleRow(c.env.DB, c.req.param("id") ?? "");
  if (article === null) return c.json({ error: "Not Found" }, 404);

  const versionRows = await c.env.DB.prepare(
    "SELECT * FROM listicle_article_versions WHERE article_id = ? AND status = 'active' ORDER BY id ASC",
  )
    .bind(article.id)
    .all<VersionRowL>();
  const versions = versionRows.results ?? [];
  if (versions.length === 0) {
    return c.json(
      {
        error: "Article is not publishable",
        fields: { versions: "at least one active Version is required" },
      },
      400,
    );
  }

  const pagesByVersion = await loadPagesForVersions(
    c.env.DB,
    versions.map((v) => v.id),
  );

  const errors: FieldErrors = {};
  for (const version of versions) {
    const pages = pagesByVersion.get(version.id) ?? [];
    const result = validateVersion(versionToValidatorPayload(version, pages));
    for (const [field, message] of Object.entries(result.errors)) {
      errors[`version_${version.public_id}.${field}`] = message;
    }
    // §15.5 conflict guard over stored rules.
    for (const page of pages) {
      if (page.selection_mode !== "rule_based") continue;
      const entries: RuleGuardEntry[] = [];
      for (const cand of page.candidates) {
        if (cand.rule === null) continue;
        const parsed = parseConditions(cand.rule.conditions_json);
        if (!parsed.ok) {
          errors[`version_${version.public_id}.page_${page.page_index}.rules`] = parsed.error;
          continue;
        }
        entries.push({
          candidate_key: cand.section_name,
          priority: cand.rule.priority,
          conditions: parsed.conditions,
        });
      }
      const { conflicts } = detectRuleConflicts(entries);
      if (conflicts.length > 0) {
        const payload = buildConflictPayload(page.page_index, conflicts);
        for (const [field, value] of Object.entries(payload.fields)) {
          errors[`version_${version.public_id}.${field}`] =
            `${conflicts.length} equal-priority rule conflict(s): ` +
            value.map((v) => `${v.candidate_a} × ${v.candidate_b}`).join("; ");
        }
      }
    }
  }
  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Article is not publishable", fields: errors }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE listicle_articles SET status = 'published', published_at = unixepoch(), updated_at = unixepoch() WHERE id = ?",
  )
    .bind(article.id)
    .run();
  // TODO(listicles-phase6): cache invalidate + warm the per-lander_v shells
  // here (§22.2 fan-out + §7.1 "publish via existing workflow → invalidate +
  // warm"). Phase 2 has no public render surface yet — publish only flips
  // status/published_at.

  const updated = await c.env.DB.prepare("SELECT * FROM listicle_articles WHERE id = ? LIMIT 1")
    .bind(article.id)
    .first<ArticleRowL>();
  return c.json({ article: updated });
}
