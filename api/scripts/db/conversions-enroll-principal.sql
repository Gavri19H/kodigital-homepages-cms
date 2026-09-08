-- Conversions: enrol a CMS admin principal (deployment-stage data mutation).
--
-- 0042_conversions_authority.sql is "additive and intentionally seedless:
-- production identity and ownership rows remain deployment-stage data
-- mutations." There is deliberately no INSERT for these tables anywhere in
-- src/ or migrations/, so enrolling a person is this file, run by hand against
-- the target environment. Migrations are the wrong home: this is per-person
-- data, not schema, and it must not replay onto every database.
--
-- OWNER 2026-09-08: ido@kodigital.io opened /admin/conversions and was told
-- "permanent Conversions authority is unavailable. Production effects remain
-- blocked." The real state was simply this: no principal row. Production held
-- exactly one principal (the accountable owner).
--
-- HOW THE IDENTITY BINDS. access_subject is seeded to the placeholder
-- 'deployment-held:<principal_id>'. On the person's FIRST authenticated visit,
-- resolvePermanentConversionsActor finds no (email, subject) match, falls back
-- to the placeholder lookup, and bindVerifiedAccessSubject swaps in the real
-- Cloudflare Access subject from their verified JWT — writing an audit row to
-- conversion_authority_subject_binding_audit in the same batch. That is a
-- one-shot path: it only fires while the placeholder is present. Never invent
-- an access_subject by hand; a wrong one locks the account out permanently,
-- because the re-bind can never fire again.
--
-- ROLE. 'administrator' is every capability EXCEPT ownership.manage —
-- parseCanonicalMembershipCapabilities rejects that pairing outright. Both
-- JSON columns must be byte-exact canonical JSON: capabilities in
-- CMS_CONVERSIONS_CAPABILITIES order, account_scope sorted by account_id with
-- currency equal to the workspace reporting_currency. The parser compares
-- against JSON.stringify of its own normalised value, so any added whitespace
-- or reordering fails the row into `forbidden`.
--
-- RUN (production), from api/:
--   npx wrangler d1 execute kodigital-homepages-cms-db --env production --remote \
--     --file scripts/db/conversions-enroll-principal.sql
--
-- Both statements are guarded by NOT EXISTS, so a re-run is a no-op rather
-- than a UNIQUE(canonical_email) failure.

INSERT INTO conversion_admin_principals (
  principal_id, canonical_email, access_subject, display_name,
  status, is_accountable_owner, created_at, updated_at
)
SELECT
  '01a08188-8c1c-7706-8e79-36983e600674',
  'ido@kodigital.io',
  'deployment-held:01a08188-8c1c-7706-8e79-36983e600674',
  'Ido',
  'active',
  0,
  unixepoch(),
  unixepoch()
WHERE NOT EXISTS (
  SELECT 1 FROM conversion_admin_principals WHERE canonical_email = 'ido@kodigital.io'
);

INSERT INTO conversion_workspace_memberships (
  principal_id, workspace_id, role, status,
  capabilities_json, account_scope_json, created_at, updated_at
)
SELECT
  p.principal_id,
  w.workspace_id,
  'administrator',
  'active',
  '["conversions.view","connections.manage","connections.credentials","flows.manage","flows.publish","activity.replay","conversions.external_redelivery","controls.manage","reporting.view","reporting.manage","reporting.export","reporting.schedule","conversions.dashboard.revenue.read"]',
  '[{"account_id":"1586188322402777","currency":"USD"}]',
  unixepoch(),
  unixepoch()
FROM conversion_admin_principals p
JOIN conversion_workspaces w ON w.status = 'active'
WHERE p.canonical_email = 'ido@kodigital.io'
  AND NOT EXISTS (
    SELECT 1 FROM conversion_workspace_memberships m WHERE m.principal_id = p.principal_id
  );
