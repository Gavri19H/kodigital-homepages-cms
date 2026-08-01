-- One-time, fail-closed binding of a deployment-held CMS principal to the
-- exact subject from a verified Cloudflare Access identity JWT.
PRAGMA foreign_keys = ON;

CREATE TABLE conversion_authority_subject_binding_audit (
  principal_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  canonical_email TEXT NOT NULL COLLATE BINARY,
  previous_subject_sha256 TEXT NOT NULL COLLATE BINARY
    CHECK(length(previous_subject_sha256)=64
      AND previous_subject_sha256 NOT GLOB '*[^0-9a-f]*'),
  bound_subject_sha256 TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK(length(bound_subject_sha256)=64
      AND bound_subject_sha256 NOT GLOB '*[^0-9a-f]*'),
  access_issued_at INTEGER NOT NULL CHECK(access_issued_at >= 0),
  bound_at INTEGER NOT NULL CHECK(bound_at >= access_issued_at),
  reason_code TEXT NOT NULL CHECK(reason_code='verified_access_subject_binding')
);

CREATE TRIGGER trg_conversion_authority_subject_binding_immutable_update
BEFORE UPDATE ON conversion_authority_subject_binding_audit
BEGIN SELECT RAISE(ABORT,'conversion_authority_subject_binding_immutable'); END;

CREATE TRIGGER trg_conversion_authority_subject_binding_immutable_delete
BEFORE DELETE ON conversion_authority_subject_binding_audit
BEGIN SELECT RAISE(ABORT,'conversion_authority_subject_binding_immutable'); END;

CREATE TRIGGER trg_conversion_principal_subject_change_guard
BEFORE UPDATE OF access_subject ON conversion_admin_principals
WHEN NOT (
  OLD.access_subject=('deployment-held:' || OLD.principal_id)
  AND NEW.access_subject!=OLD.access_subject
  AND EXISTS (
    SELECT 1 FROM conversion_authority_subject_binding_audit a
    WHERE a.principal_id=OLD.principal_id
      AND a.canonical_email=OLD.canonical_email
  )
)
BEGIN SELECT RAISE(ABORT,'conversion_authority_subject_change_forbidden'); END;
