export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA: R2Bucket;
  // Contracted static-asset binding. Optional in unit environments so a
  // missing binding can fail closed with a typed dependency response.
  ADMIN_ASSETS?: Fetcher;
  // rescue-4 v3 — parallel provisioning fan-out queue. Optional: when
  // unbound (tests / local dev) the gen steps fall back to the serial
  // inline path, so the suite runs without a queue binding.
  PROVISION_QUEUE?: Queue<{ site_id: string; unit_index: number; stage: "text" | "image" }>;

  APP_ENV: string;
  ADMIN_HOST: string;
  ADMIN_BASE_URL: string;
  ADMIN_BASE_PATH: string;
  CACHE_API_ENABLED: string;
  HTML_CACHE_TTL_SECONDS: string;
  OPENAI_TEXT_MODEL: string;
  OPENAI_IMAGE_MODEL: string;
  SITE_PROVISIONING_DRY_RUN: string;
  SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: string;
  // Disabled by default in every environment. Enables only the local,
  // read-only Conversions route shell and its authenticated hashed assets.
  CONVERSIONS_UI_ENABLED?: string;
  // Independent release control for the same-origin Conversions admin proxy.
  // Only the exact literal "true" enables it; the UI flag never implies API
  // availability (and vice versa).
  CONVERSIONS_PROXY_ENABLED?: string;
  // Private Worker-to-Worker service binding. It is optional in local/unit
  // environments so the proxy can return a safe dependency-unavailable error.
  CONVERSIONS_CORE?: Fetcher;
  // Frozen actor-context.v1 primitive-test inputs. Runtime routes never read
  // these legacy bootstrap fields and Wrangler does not configure them.
  CONVERSIONS_ADMIN_EMAILS?: string;
  CONVERSIONS_ACTOR_ID_BY_EMAIL?: string;
  DEFAULT_WORKSPACE_ID?: string;
  CONVERSIONS_BOOTSTRAP_EXPIRES_AT?: string;
  // Permanent actor_context.v2 signing configuration. The signing key is an
  // encrypted Worker secret and must never be placed in wrangler.toml [vars].
  CONVERSIONS_ACTOR_AUDIENCE?: string;
  CONVERSIONS_ACTOR_ENVIRONMENT?: string;
  CONVERSIONS_ACTOR_SIGNING_KEY_B64URL?: string;
  // Four disjoint encrypted HMAC bindings for the private provider authority.
  // No value or provider credential is stored in Wrangler plaintext vars.
  CMS_PROVIDER_PREPARE_REQUEST_HMAC_KEY_B64URL?: string;
  CMS_PROVIDER_PREPARE_RESPONSE_HMAC_KEY_B64URL?: string;
  CMS_PROVIDER_EXECUTE_REQUEST_HMAC_KEY_B64URL?: string;
  CMS_PROVIDER_EXECUTE_RESPONSE_HMAC_KEY_B64URL?: string;
  // Non-secret, comma-separated exact allowlist for database-selected
  // outbound credential bindings. A stored reference is never resolved unless
  // it is both safe by name and present here (conversions plan section 18.7).
  LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS?: string;

  OPENAI_API_KEY?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_BYPASS_AUTH?: string;
  PREVIEW_SECRET?: string;
  CLOUDFLARE_PROVISIONING_API_TOKEN?: string;
  CLOUDFLARE_CACHE_API_TOKEN?: string;
  ALLOWED_CF_SERVICE_TOKEN_IDS?: string;

  // User-interaction analytics pipeline (POST /api/track -> AWS Kinesis
  // Firehose `homepage-events` -> S3 -> Athena). All optional: when unset the
  // firehose path is a no-op (tests / local dev / pre-provisioned envs).
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  EVENTS_FIREHOSE_STREAM?: string;
  // Listicles tracking pipeline (§16): POST /api/lst/track + /lc ->
  // Firehose `listicle-events` -> S3 -> Athena `listicles.events`/`sessions`.
  // Same AWS creds as the homepage stream; optional so the listicle pipeline
  // no-ops exactly like the homepage one until the stream is provisioned.
  LISTICLE_EVENTS_FIREHOSE_STREAM?: string;

  // Listicles ClickHouse aggregation (§17/§18). The CH Cloud HTTP interface
  // the mirror-sync reads to populate the five D1 analytics mirrors. All three
  // are ENCRYPTED SECRETS (set via `wrangler secret put`, Dashboard/CI only —
  // NEVER in wrangler.toml [vars]; see infra/listicles/clickhouse-apply.md).
  // Optional so the whole CH read path no-ops (like the Firehose path) until
  // the secrets are set + the external Athena->CH pipeline lands data.
  CH_URL?: string;
  CH_USER?: string;
  CH_PASSWORD?: string;

  // Listicles §19/§24 — inbound provider-postback shared secrets. One ENCRYPTED
  // secret per revenue provider, named LISTICLE_PB_TOKEN_<PROVIDER> where
  // <PROVIDER> is the UPPERCASED provider path param of POST /api/pb/<provider>.
  // Set via `wrangler secret put` (Dashboard/CI only — NEVER wrangler.toml).
  // Optional so the pipeline no-ops until configured: absent ⇒ that provider's
  // postbacks are rejected 401 (unverifiable), never silently accepted. The two
  // declared here back the seeded adapters (generic + capi); readEnvSecret()
  // resolves the name dynamically so a new provider needs only a secret + a
  // one-line adapter alias (see infra/listicles/revenue-secrets.md).
  LISTICLE_PB_TOKEN_GENERIC?: string;
  LISTICLE_PB_TOKEN_CAPI?: string;

  // Listicles §20 — outbound S2S platform tokens. One ENCRYPTED secret per media
  // platform, named by that platform row's `auth_secret_ref` (legacy convention
  // LISTICLE_S2S_TOKEN_<PLATFORM>). The name must be explicitly allowlisted and
  // bound; absent/empty/disallowed references fail closed before fetch. The one
  // declared here backs the seeded (disabled-by-default) facebook row.
  LISTICLE_S2S_TOKEN_FACEBOOK?: string;
}

// Read a named secret/var off the env by STRING key. Trusted code uses this for
// constructed inbound-provider names and fixed infrastructure constants. A
// database-controlled outbound reference must instead use the narrow wrapper
// below. Returns undefined for an absent / blank / non-string value.
export function readEnvSecret(env: Env, name: string): string | undefined {
  const v = (env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export const NEW_OUTBOUND_SECRET_REF_PREFIX = "OFFER_TOKEN_";

export type OutboundSecretReferenceFailureCode =
  | "invalid_syntax"
  | "infrastructure_reference"
  | "prefix_required"
  | "not_allowed"
  | "binding_missing";

export type OutboundSecretReferenceValidation =
  | { ok: true; name: string }
  | { ok: false; code: Exclude<OutboundSecretReferenceFailureCode, "binding_missing"> };

export type OutboundSecretResolution =
  | { ok: true; name: string; value: string }
  | { ok: false; code: OutboundSecretReferenceFailureCode };

const OUTBOUND_SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LEGACY_OUTBOUND_SECRET_REFS: ReadonlySet<string> = new Set([
  "LEADGEN_S2S_TOKEN_FACEBOOK",
  "LISTICLE_S2S_TOKEN_FACEBOOK",
]);

// These bindings belong to infrastructure, authentication, signing, storage,
// or debug-encryption paths. They remain forbidden even if an allowlist is
// accidentally broadened. Existing legitimate legacy S2S names are not in
// these families and may remain explicitly allowlisted while they are renamed.
function isInfrastructureSecretReference(name: string): boolean {
  const upperName = name.toUpperCase();
  return (
    /^(?:AWS_|CH_|CLOUDFLARE_|CF_ACCESS_|OPENAI_|GOOGLE_MAPS_)/.test(upperName) ||
    /^(?:LEADGEN|LISTICLE)_PB_TOKEN_/.test(upperName) ||
    /^(?:DB|DATABASE_URL|CACHE|MEDIA|PROVISION_QUEUE|PREVIEW_SECRET|DEV_BYPASS_AUTH|ALLOWED_CF_SERVICE_TOKEN_IDS)$/.test(
      upperName,
    ) ||
    /(?:_SIGNING_KEY(?:_B64URL)?|_ENCRYPTION_KEY|_PASSWORD)$/.test(upperName) ||
    upperName.includes("PROVISIONING_API_TOKEN") ||
    upperName.includes("CACHE_API_TOKEN")
  );
}

// Database-controlled outbound references live in a positive namespace. The
// only exceptions are the two exact value-free references found in the live
// inventory; they remain temporary compatibility names while being migrated.
// An allowlist typo can therefore never turn an arbitrary Worker binding such
// as CF_API_TOKEN/GITHUB_TOKEN into a provider credential.
function isPermittedOutboundSecretNamespace(name: string): boolean {
  return name.startsWith(NEW_OUTBOUND_SECRET_REF_PREFIX) || LEGACY_OUTBOUND_SECRET_REFS.has(name);
}

function outboundSecretAllowlist(env: Env): ReadonlySet<string> {
  const raw = env.LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS;
  if (typeof raw !== "string" || raw.trim() === "") return new Set<string>();
  return new Set(raw.split(",").map((item) => item.trim()).filter((item) => item !== ""));
}

export function validateAllowedOutboundSecretReference(
  env: Env,
  rawName: string,
  options?: { requireNewPrefix?: boolean },
): OutboundSecretReferenceValidation {
  const name = rawName.trim();
  if (!OUTBOUND_SECRET_NAME_RE.test(name)) return { ok: false, code: "invalid_syntax" };
  if (isInfrastructureSecretReference(name)) {
    return { ok: false, code: "infrastructure_reference" };
  }
  if (!isPermittedOutboundSecretNamespace(name)) {
    return { ok: false, code: "infrastructure_reference" };
  }
  if (options?.requireNewPrefix === true && !name.startsWith(NEW_OUTBOUND_SECRET_REF_PREFIX)) {
    return { ok: false, code: "prefix_required" };
  }
  if (!outboundSecretAllowlist(env).has(name)) return { ok: false, code: "not_allowed" };
  return { ok: true, name };
}

// The only helper database-controlled outbound paths may call. Validation and
// lookup are deliberately inseparable so a future caller cannot check a name
// and later pass a different or untrusted value to the generic helper.
export function resolveAllowedOutboundSecretReference(
  env: Env,
  rawName: string,
  options?: { requireNewPrefix?: boolean },
): OutboundSecretResolution {
  const validated = validateAllowedOutboundSecretReference(env, rawName, options);
  if (!validated.ok) return validated;
  const value = readEnvSecret(env, validated.name);
  return value === undefined
    ? { ok: false, code: "binding_missing" }
    : { ok: true, name: validated.name, value };
}

export function parseBoolean(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

// Release-control parser for the disabled-by-default Conversions UI. This is
// deliberately stricter than parseBoolean: aliases such as 1/yes/on and every
// malformed or missing value remain disabled. Case and surrounding whitespace
// are normalized so the accepted explicit literal remains operator-friendly.
export function isConversionsUiEnabled(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

// Keep the proxy release gate independent from the shell gate. Aliases such
// as 1/yes/on, malformed values and missing bindings all remain disabled.
export function isConversionsProxyEnabled(value: string | undefined | null): boolean {
  return value === "true";
}

export function parseNumber(value: string | undefined | null, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getAdminHost(env: Env): string {
  return env.ADMIN_HOST;
}

export function getAdminBaseUrl(env: Env): string {
  return env.ADMIN_BASE_URL;
}

export function isDryRunProvisioning(env: Env): boolean {
  return parseBoolean(env.SITE_PROVISIONING_DRY_RUN);
}

export function isRouteMutationAllowed(env: Env): boolean {
  return parseBoolean(env.SITE_PROVISIONING_ALLOW_ROUTE_MUTATION);
}
