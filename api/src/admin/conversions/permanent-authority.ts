import type { AccessContext } from "../../auth/access-auth";
import type { Env } from "../../env";
import { isUuidV7 } from "./actor-envelope";

export const CMS_CONVERSIONS_CAPABILITIES = Object.freeze([
  "conversions.view",
  "connections.manage",
  "connections.credentials",
  "flows.manage",
  "flows.publish",
  "ownership.manage",
  "activity.replay",
  "conversions.external_redelivery",
  "controls.manage",
  "reporting.view",
  "reporting.manage",
  "reporting.export",
  "reporting.schedule",
  "conversions.dashboard.revenue.read",
] as const);

export type CmsConversionsCapability = (typeof CMS_CONVERSIONS_CAPABILITIES)[number];
export type CoreActorCapability = Exclude<CmsConversionsCapability, "conversions.dashboard.revenue.read">;
export const CORE_ACTOR_CAPABILITIES: ReadonlyArray<CoreActorCapability> = Object.freeze(
  CMS_CONVERSIONS_CAPABILITIES.slice(0, 13) as CoreActorCapability[],
);
export type ConversionMembershipRole = "accountable_owner" | "administrator" | "reporter";

const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const VISIBLE_ASCII = /^[!-~]{1,255}$/;
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CURRENCY = /^[A-Z]{3}$/;
const CAPABILITY_INDEX = new Map(CMS_CONVERSIONS_CAPABILITIES.map((value, index) => [value, index]));
const REPORTER_MAXIMUM = new Set<CmsConversionsCapability>([
  "conversions.view",
  "reporting.view",
  "conversions.dashboard.revenue.read",
]);

export interface ConversionAccountScope {
  readonly account_id: string;
  readonly currency: string;
}

interface AuthorityRow {
  principal_id: unknown;
  canonical_email: unknown;
  access_subject: unknown;
  is_accountable_owner: unknown;
  workspace_id: unknown;
  role: unknown;
  capabilities_json: unknown;
  account_scope_json: unknown;
  reporting_currency: unknown;
  time_zone: unknown;
  accountable_owner_principal_id: unknown;
}

export interface PermanentConversionsAuthority {
  readonly principalId: string;
  readonly canonicalEmail: string;
  readonly accessSubject: string;
  readonly workspaceId: string;
  readonly role: ConversionMembershipRole;
  readonly cmsCapabilities: ReadonlyArray<CmsConversionsCapability>;
  readonly coreCapabilities: ReadonlyArray<CoreActorCapability>;
  readonly accountScope: ReadonlyArray<ConversionAccountScope>;
  readonly reportingCurrency: string;
  readonly timeZone: string;
}

export class PermanentAuthorityError extends Error {
  constructor(readonly kind: "forbidden" | "unavailable") {
    super("permanent conversions authority unavailable");
    this.name = "PermanentAuthorityError";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validRole(value: unknown): value is ConversionMembershipRole {
  return value === "accountable_owner" || value === "administrator" || value === "reporter";
}

export function parseCanonicalMembershipCapabilities(
  raw: unknown,
  role: ConversionMembershipRole,
): ReadonlyArray<CmsConversionsCapability> | undefined {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 2_048) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || JSON.stringify(parsed) !== raw) return undefined;
  let priorIndex = -1;
  const result: CmsConversionsCapability[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") return undefined;
    const index = CAPABILITY_INDEX.get(item as CmsConversionsCapability);
    if (index === undefined || index <= priorIndex) return undefined;
    const capability = CMS_CONVERSIONS_CAPABILITIES[index]!;
    if (role === "administrator" && capability === "ownership.manage") return undefined;
    if (role === "reporter" && !REPORTER_MAXIMUM.has(capability)) return undefined;
    priorIndex = index;
    result.push(capability);
  }
  return Object.freeze(result);
}

export function parseCanonicalAccountScope(
  raw: unknown,
  reportingCurrency: string,
): ReadonlyArray<ConversionAccountScope> | undefined {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 65_536 || !CURRENCY.test(reportingCurrency)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length > 256) return undefined;
  const normalized: ConversionAccountScope[] = [];
  let prior = "";
  for (const item of parsed) {
    if (!isPlainRecord(item) || !exactKeys(item, ["account_id", "currency"])) return undefined;
    const accountId = item.account_id;
    const currency = item.currency;
    if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)
        || typeof currency !== "string" || currency !== reportingCurrency
        || (prior !== "" && accountId <= prior)) return undefined;
    normalized.push(Object.freeze({ account_id: accountId, currency }));
    prior = accountId;
  }
  if (JSON.stringify(normalized) !== raw) return undefined;
  return Object.freeze(normalized);
}

export function projectCoreActorCapabilities(
  capabilities: ReadonlyArray<CmsConversionsCapability>,
): ReadonlyArray<CoreActorCapability> | undefined {
  const present = new Set(capabilities);
  const projected = CORE_ACTOR_CAPABILITIES.filter((capability) => present.has(capability));
  return projected.length > 0 ? Object.freeze(projected) : undefined;
}

function canonicalEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 254 && EMAIL.test(normalized) ? normalized : undefined;
}

function exactSubject(value: unknown): string | undefined {
  return typeof value === "string" && VISIBLE_ASCII.test(value) ? value : undefined;
}

function validateAuthorityRow(row: AuthorityRow): PermanentConversionsAuthority | undefined {
  if (!isUuidV7(row.principal_id) || !isUuidV7(row.workspace_id)
      || !isUuidV7(row.accountable_owner_principal_id)
      || typeof row.canonical_email !== "string" || canonicalEmail(row.canonical_email) !== row.canonical_email
      || typeof row.access_subject !== "string" || exactSubject(row.access_subject) !== row.access_subject
      || !validRole(row.role) || (row.is_accountable_owner !== 0 && row.is_accountable_owner !== 1)
      || typeof row.reporting_currency !== "string" || !CURRENCY.test(row.reporting_currency)
      || typeof row.time_zone !== "string" || row.time_zone.length < 1 || row.time_zone.length > 128
      || !VISIBLE_ASCII.test(row.time_zone)) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: row.time_zone }).format(0);
  } catch {
    return undefined;
  }
  const ownerRelationship = row.role === "accountable_owner"
    ? row.is_accountable_owner === 1 && row.accountable_owner_principal_id === row.principal_id
    : row.is_accountable_owner === 0 && row.accountable_owner_principal_id !== row.principal_id;
  if (!ownerRelationship) return undefined;
  const capabilities = parseCanonicalMembershipCapabilities(row.capabilities_json, row.role);
  const accountScope = parseCanonicalAccountScope(row.account_scope_json, row.reporting_currency);
  const coreCapabilities = capabilities === undefined ? undefined : projectCoreActorCapabilities(capabilities);
  if (capabilities === undefined || accountScope === undefined || coreCapabilities === undefined) return undefined;
  return Object.freeze({
    principalId: row.principal_id,
    canonicalEmail: row.canonical_email,
    accessSubject: row.access_subject,
    workspaceId: row.workspace_id,
    role: row.role,
    cmsCapabilities: capabilities,
    coreCapabilities,
    accountScope,
    reportingCurrency: row.reporting_currency,
    timeZone: row.time_zone,
  });
}

const AUTHORITY_SELECT = `SELECT p.principal_id,p.canonical_email,p.access_subject,p.is_accountable_owner,
       m.workspace_id,m.role,m.capabilities_json,m.account_scope_json,
       w.reporting_currency,w.time_zone,w.accountable_owner_principal_id
FROM conversion_admin_principals p
JOIN conversion_workspace_memberships m ON m.principal_id=p.principal_id
JOIN conversion_workspaces w ON w.workspace_id=m.workspace_id`;

async function selectExactlyOne(env: Env, where: string, bindings: ReadonlyArray<string>): Promise<PermanentConversionsAuthority> {
  let rows: AuthorityRow[];
  try {
    const result = await env.DB.prepare(`${AUTHORITY_SELECT}\n${where}\nORDER BY p.principal_id,m.workspace_id\nLIMIT 2`)
      .bind(...bindings).all<AuthorityRow>();
    if (!result.success || !Array.isArray(result.results)) throw new Error("authority query failed");
    rows = result.results;
  } catch {
    throw new PermanentAuthorityError("unavailable");
  }
  if (rows.length !== 1) throw new PermanentAuthorityError("forbidden");
  const authority = validateAuthorityRow(rows[0]!);
  if (authority === undefined) throw new PermanentAuthorityError("forbidden");
  return authority;
}

function deploymentHeldSubject(authority: PermanentConversionsAuthority): string {
  return `deployment-held:${authority.principalId}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function bindVerifiedAccessSubject(
  env: Env,
  authority: PermanentConversionsAuthority,
  verifiedSubject: string,
  accessIssuedAt: number,
): Promise<void> {
  const placeholder = deploymentHeldSubject(authority);
  if (authority.accessSubject !== placeholder || verifiedSubject === placeholder
      || !Number.isSafeInteger(accessIssuedAt) || accessIssuedAt < 0) {
    throw new PermanentAuthorityError("forbidden");
  }
  const boundAt = Math.floor(Date.now() / 1000);
  if (boundAt < accessIssuedAt) throw new PermanentAuthorityError("forbidden");
  const [previousHash, boundHash] = await Promise.all([
    sha256Hex(placeholder),
    sha256Hex(verifiedSubject),
  ]);
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO conversion_authority_subject_binding_audit(
        principal_id,canonical_email,previous_subject_sha256,bound_subject_sha256,
        access_issued_at,bound_at,reason_code
      )
      SELECT ?1,?2,?3,?4,?5,?6,'verified_access_subject_binding'
      WHERE EXISTS (
        SELECT 1 FROM conversion_admin_principals
        WHERE principal_id=?1 AND canonical_email=?2 AND access_subject=?7
          AND status='active'
      )`).bind(
        authority.principalId, authority.canonicalEmail, previousHash, boundHash,
        accessIssuedAt, boundAt, placeholder,
      ),
      env.DB.prepare(`UPDATE conversion_admin_principals
      SET access_subject=?1,updated_at=?2
      WHERE principal_id=?3 AND canonical_email=?4 AND access_subject=?5
        AND status='active'
        AND EXISTS (
          SELECT 1 FROM conversion_authority_subject_binding_audit
          WHERE principal_id=?3 AND canonical_email=?4
            AND bound_subject_sha256=?6
        )`).bind(
        verifiedSubject, boundAt, authority.principalId, authority.canonicalEmail,
        placeholder, boundHash,
      ),
    ]);
    if (results.length !== 2
        || results.some((result) => result.success !== true)
        || results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      throw new Error("subject binding did not commit exactly once");
    }
  } catch {
    throw new PermanentAuthorityError("unavailable");
  }
}

export async function resolvePermanentConversionsActor(
  env: Env,
  access: AccessContext | undefined,
): Promise<PermanentConversionsAuthority> {
  if (access?.mode !== "identity") throw new PermanentAuthorityError("forbidden");
  const email = canonicalEmail(access.email);
  const subject = exactSubject(access.sub);
  if (email === undefined || subject === undefined) throw new PermanentAuthorityError("forbidden");
  try {
    const authority = await selectExactlyOne(env,
      `WHERE p.canonical_email=?1 AND p.access_subject=?2
  AND p.status='active' AND m.status='active' AND w.status='active'`, [email, subject]);
    if (authority.canonicalEmail !== email || authority.accessSubject !== subject) {
      throw new PermanentAuthorityError("forbidden");
    }
    return authority;
  } catch (error) {
    if (!(error instanceof PermanentAuthorityError) || error.kind === "unavailable") throw error;
  }

  const placeholderAuthority = await selectExactlyOne(env,
    `WHERE p.canonical_email=?1
  AND p.access_subject=('deployment-held:' || p.principal_id)
  AND p.status='active' AND m.status='active' AND w.status='active'`, [email]);
  const issuedAt = access.claims.iat;
  if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt)) {
    throw new PermanentAuthorityError("forbidden");
  }
  await bindVerifiedAccessSubject(env, placeholderAuthority, subject, issuedAt);
  return selectExactlyOne(env,
    `WHERE p.canonical_email=?1 AND p.access_subject=?2
  AND p.status='active' AND m.status='active' AND w.status='active'`, [email, subject]);
}

export async function resolvePermanentConversionsActorIdentity(
  env: Env,
  identity: { principalId: string; canonicalEmail: string; accessSubject: string; workspaceId: string },
): Promise<PermanentConversionsAuthority> {
  if (!isUuidV7(identity.principalId) || !isUuidV7(identity.workspaceId)
      || canonicalEmail(identity.canonicalEmail) !== identity.canonicalEmail
      || exactSubject(identity.accessSubject) !== identity.accessSubject) {
    throw new PermanentAuthorityError("forbidden");
  }
  const authority = await selectExactlyOne(env,
    `WHERE p.principal_id=?1 AND p.canonical_email=?2 AND p.access_subject=?3 AND m.workspace_id=?4
  AND p.status='active' AND m.status='active' AND w.status='active'`,
  [identity.principalId, identity.canonicalEmail, identity.accessSubject, identity.workspaceId]);
  return authority;
}
