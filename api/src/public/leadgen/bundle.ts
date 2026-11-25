import { leadgenBundleKey } from "../../cache/cache-keys";
import { renderReadDb } from "../../db/read-session";
import type { Env } from "../../env";
import { isFunnelVariantId } from "../../leadgen/funnel";
import type { WaitUntilContext } from "../../wait-until-context";
import { readLiveAttemptConfig } from "./attempt";
import {
  loadQuoteRoutingRules, loadShellLogoDimensions, resolveActivatedFunnelByVariant, sectionsFromPages,
  withShellLogoDimensions, type ResolvedActivatedFunnel,
} from "./resolver";
import { frameSourceOf, loadFunnelShellInputs, resolveFrameComposition } from "./serve";
import { getFunnelDesign } from "./designs/registry";

export interface PreparedFunnelBundle {
  resolved: ResolvedActivatedFunnel;
  shell: Awaited<ReturnType<typeof loadFunnelShellInputs>>;
}

const bundleTtl = 7 * 24 * 60 * 60;

// Some definition readers deliberately serve a fallback on a D1 error. That
// result is usable for this request, but must not become a seven-day cache hit.
function bundleReadDb(db: D1Database, onError: () => void): D1Database {
  async function read<T>(execute: () => Promise<T>): Promise<T> {
    try {
      return await execute();
    } catch (err) {
      onError();
      throw err;
    }
  }
  function statement(prepare: () => D1PreparedStatement): D1PreparedStatement {
    return {
      bind: (...values) => statement(() => prepare().bind(...values)),
      first: <T>(column?: string) => read(() => column === undefined ? prepare().first<T>() : prepare().first<T>(column)),
      all: <T>() => read(() => prepare().all<T>()),
      run: <T>() => prepare().run<T>(),
      get raw() { const stmt = prepare(); return stmt.raw.bind(stmt); },
    };
  }
  return {
    prepare: sql => statement(() => db.prepare(sql)),
    batch: statements => db.batch(statements),
    exec: sql => db.exec(sql),
    dump: () => db.dump(),
    withSession: constraint => db.withSession(constraint),
  };
}

// Bind the serialized definition to its full key. This catches a misplaced
// value or damage inside a nested rule/page, even when it is still valid JSON.
async function bundleDigest(key: string, body: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key + "\n" + body));
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

type StoredBundle = Omit<PreparedFunnelBundle, "resolved"> & { resolved: Omit<ResolvedActivatedFunnel, "sections"> };

async function decodeBundle(key: string, raw: string, siteId: string, variantId: string): Promise<PreparedFunnelBundle | null> {
  try {
    const { body, digest }: { body?: unknown; digest?: unknown } = JSON.parse(raw);
    if (typeof body !== "string" || typeof digest !== "string" || await bundleDigest(key, body) !== digest) return null;
    const { resolved, shell }: StoredBundle = JSON.parse(body);
    if (resolved.site_quote.site_id !== siteId || resolved.variant.public_id !== variantId ||
        !Array.isArray(resolved.pages) || !Array.isArray(resolved.routing_rules)) return null;
    const definition = { ...resolved, sections: sectionsFromPages(resolved.pages) };
    return { resolved: withShellLogoDimensions(definition, resolved.site_branding?.logoDimensions), shell };
  } catch {
    return null;
  }
}

async function storeBundle(kv: KVNamespace, key: string, bundle: PreparedFunnelBundle): Promise<void> {
  // Every section is already in its page/slot. Keep one copy of its content.
  const body = JSON.stringify({ ...bundle, resolved: { ...bundle.resolved, sections: undefined } });
  const digest = await bundleDigest(key, body);
  await kv.put(key, JSON.stringify({ body, digest }), { expirationTtl: bundleTtl });
}

function bundleSnapshotVersion(headers: Headers): string | null {
  const version = headers.get("x-cms-snap-version");
  return version && /^[0-9a-f]{64}$/.test(version) ? version : null;
}

// undefined delegates to the live route. null is an authoritative unserved
// variant/slug. Only a complete, session-independent definition goes into KV.
export async function loadPreparedFunnelBundle(
  env: Env, headers: Headers, siteId: string, variantId: string,
  ctx?: WaitUntilContext, quoteSlug?: string | null,
): Promise<PreparedFunnelBundle | null | undefined> {
  const snapshotVersion = bundleSnapshotVersion(headers);
  // PublicPage bypasses the inner HTML cache. Its selected shell can build
  // the same inputs in parallel even when it has no snapshot version for KV.
  if (snapshotVersion === null && (env.EDGE_INNER !== "1" || quoteSlug === undefined)) return undefined;
  if (!isFunnelVariantId(variantId)) return null;
  const key = snapshotVersion && leadgenBundleKey(siteId, variantId, snapshotVersion, env.CF_VERSION_METADATA?.id);
  try {
    const raw = key === null ? null : await env.CACHE.get(key);
    if (raw !== null && key !== null) {
      const bundle = await decodeBundle(key, raw, siteId, variantId);
      if (bundle !== null) return quoteSlug === undefined || bundle.resolved.site_quote.slug === quoteSlug ? bundle : null;
      // Finish the eviction before replacing it so a late delete cannot erase the repair.
      await env.CACHE.delete(key);
    }
  } catch {
    // KV is optional for serving. A failed read or eviction still rebuilds.
  }

  let complete = true;
  // PublicPage already supplies a bookmark-anchored DB to shell renders.
  const session = env.EDGE_INNER === "1" ? env.DB : renderReadDb(env.DB, headers.get("x-cms-bookmark"));
  const readEnv = { ...env, DB: bundleReadDb(session, () => { complete = false; }) };
  try {
    const resolved = await resolveActivatedFunnelByVariant(readEnv, siteId, variantId, { quoteSlug, includeRoutingRules: key !== null });
    if (resolved === null) return null;
    const frame = resolveFrameComposition(frameSourceOf(resolved, resolved.saved_template_defaults),
      getFunnelDesign(resolved.variant.funnel_design_id))?.frame ?? null;
    const [shell, dimensions] = await Promise.all([
      loadFunnelShellInputs(readEnv, resolved),
      loadShellLogoDimensions(readEnv.DB, resolved, frame),
    ]);
    const bundle = { resolved: withShellLogoDimensions(resolved, dimensions), shell };
    if (complete && key !== null) {
      const write = storeBundle(env.CACHE, key, bundle).catch(() => {});
      if (ctx) ctx.waitUntil(write);
      else await write;
    }
    return bundle;
  } catch {
    // An input needed only by the other consumer must not break this request.
    return undefined;
  }
}

export async function loadFunnelAttemptInputs(
  env: Env, headers: Headers, siteId: string, variantId: string, ctx?: WaitUntilContext,
) {
  if (!isFunnelVariantId(variantId)) return null;
  const useBundle = bundleSnapshotVersion(headers) !== null;
  const [definition, live] = await Promise.all([
    useBundle
      ? loadPreparedFunnelBundle(env, headers, siteId, variantId, ctx).then(bundle => bundle?.resolved)
      : resolveActivatedFunnelByVariant(env, siteId, variantId),
    readLiveAttemptConfig(env.DB, siteId, variantId, headers.get("x-cms-bookmark")).catch(() => undefined),
  ]);
  if (live === null) return null;
  if (definition && live && definition.variant.id === live.variant.variant_id &&
      definition.funnel.id === live.variant.funnel_id && definition.funnel.public_id === live.variant.funnel_public_id &&
      definition.quote.id === live.variant.quote_id && definition.quote.public_id === live.variant.quote_public_id) {
    return {
      resolved: {
        ...definition,
        quote: { ...definition.quote, default_funnel_id: live.variant.default_funnel_id },
        routing_rules: live.rules,
      },
      binding: live.binding,
    };
  }
  // An unavailable batch, an old schema or a reassigned variant takes the
  // original primary path. Only a definition read on the primary is reusable.
  const resolved = useBundle
    ? await resolveActivatedFunnelByVariant(env, siteId, variantId, { includeRoutingRules: true })
    : definition && { ...definition, routing_rules: await loadQuoteRoutingRules(env.DB, definition.quote.id) };
  return resolved ? { resolved, binding: undefined } : null;
}
