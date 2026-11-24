import { leadgenBundleKey } from "../../cache/cache-keys";
import { renderReadDb } from "../../db/read-session";
import type { Env } from "../../env";
import { isFunnelVariantId } from "../../leadgen/funnel";
import type { WaitUntilContext } from "../../wait-until-context";
import { attemptBindingExtras, loadAuctionConfigVersion, type AttemptBindingExtras } from "./attempt";
import { resolveActivatedFunnelByVariant, sectionsFromPages, type ResolvedActivatedFunnel } from "./resolver";
import { loadFunnelShellInputs } from "./serve";

export interface PreparedFunnelBundle {
  resolved: ResolvedActivatedFunnel;
  bindings: AttemptBindingExtras;
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
    const { resolved, bindings, shell }: StoredBundle = JSON.parse(body);
    if (resolved.site_quote.site_id !== siteId || resolved.variant.public_id !== variantId ||
        !Array.isArray(resolved.pages) || !Array.isArray(resolved.routing_rules)) return null;
    return { resolved: { ...resolved, sections: sectionsFromPages(resolved.pages) }, bindings, shell };
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

// undefined delegates to the live route. null is an authoritative unserved
// variant/slug. Only a complete, session-independent definition goes into KV.
export async function loadPreparedFunnelBundle(
  env: Env, headers: Headers, siteId: string, variantId: string,
  ctx?: WaitUntilContext, quoteSlug?: string | null,
): Promise<PreparedFunnelBundle | null | undefined> {
  const builtAt = headers.get("x-cms-snap-built-at");
  if (!builtAt || !Number.isSafeInteger(Number(builtAt))) return undefined;
  if (!isFunnelVariantId(variantId)) return null;
  const key = leadgenBundleKey(siteId, variantId, Number(builtAt), env.CF_VERSION_METADATA?.id);
  try {
    const raw = await env.CACHE.get(key);
    if (raw !== null) {
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
    const resolved = await resolveActivatedFunnelByVariant(readEnv, siteId, variantId, { quoteSlug, includeRoutingRules: true });
    if (resolved === null) return null;
    const [shell, auctionVersion] = await Promise.all([
      loadFunnelShellInputs(readEnv, resolved),
      loadAuctionConfigVersion(readEnv.DB, resolved.variant.auction_id),
    ]);
    const versions = resolved.sections.map(({ section }) => shell.answerMapVersions[section.public_id] ?? "0");
    const bundle = { resolved, shell, bindings: attemptBindingExtras(versions, auctionVersion) };
    if (complete) {
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
