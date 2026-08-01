-- Exact, time-bounded production execution release for one immutable provider
-- configuration. This migration is seedless and releases nothing by itself.
-- The first supported scope is the separately approved Meta Test Events path.

PRAGMA foreign_keys = ON;

CREATE TABLE conversion_provider_execution_releases (
  release_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK(length(release_id)=36 AND release_id=lower(release_id)
      AND substr(release_id,9,1)='-' AND substr(release_id,14,1)='-'
      AND substr(release_id,15,1)='7' AND substr(release_id,19,1)='-'
      AND substr(release_id,20,1) IN ('8','9','a','b') AND substr(release_id,24,1)='-'
      AND length(replace(release_id,'-',''))=32
      AND replace(release_id,'-','') NOT GLOB '*[^0-9a-f]*'),
  workspace_id TEXT NOT NULL COLLATE BINARY,
  destination_connection_id TEXT NOT NULL COLLATE BINARY,
  config_version INTEGER NOT NULL CHECK(config_version BETWEEN 1 AND 2147483647),
  source_snapshot_sha256 BLOB NOT NULL CHECK(length(source_snapshot_sha256)=32),
  adapter_type TEXT NOT NULL COLLATE BINARY CHECK(adapter_type='meta'),
  account_public_id TEXT NOT NULL COLLATE BINARY
    CHECK(length(CAST(account_public_id AS BLOB)) BETWEEN 1 AND 256
      AND account_public_id NOT GLOB '*[^!-~]*'),
  release_mode TEXT NOT NULL COLLATE BINARY CHECK(release_mode='meta_test_event'),
  approval_packet_sha256 BLOB NOT NULL CHECK(length(approval_packet_sha256)=32),
  status TEXT NOT NULL COLLATE BINARY CHECK(status IN ('active','revoked','expired')),
  activated_at INTEGER NOT NULL CHECK(activated_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>activated_at AND expires_at-activated_at<=3600),
  activated_by_principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL CHECK(updated_at>=activated_at),
  updated_by_principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  row_version INTEGER NOT NULL CHECK(row_version BETWEEN 1 AND 2147483647),
  UNIQUE(release_id,destination_connection_id),
  FOREIGN KEY(destination_connection_id,config_version,source_snapshot_sha256,workspace_id)
    REFERENCES conversion_provider_connection_versions(
      destination_connection_id,config_version,snapshot_sha256,workspace_id
    ) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX uq_conversion_provider_release_one_active_destination
  ON conversion_provider_execution_releases(destination_connection_id)
  WHERE status='active';
CREATE INDEX idx_conversion_provider_releases_active_expiry
  ON conversion_provider_execution_releases(status,expires_at,destination_connection_id);
CREATE INDEX idx_conversion_provider_releases_approval
  ON conversion_provider_execution_releases(approval_packet_sha256,release_id);

CREATE TRIGGER trg_conversion_provider_release_identity_immutable
BEFORE UPDATE OF release_id,workspace_id,destination_connection_id,config_version,
  source_snapshot_sha256,adapter_type,account_public_id,release_mode,
  approval_packet_sha256,activated_at,expires_at,activated_by_principal_id
  ON conversion_provider_execution_releases
WHEN NEW.release_id IS NOT OLD.release_id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.destination_connection_id IS NOT OLD.destination_connection_id
  OR NEW.config_version IS NOT OLD.config_version
  OR NEW.source_snapshot_sha256 IS NOT OLD.source_snapshot_sha256
  OR NEW.adapter_type IS NOT OLD.adapter_type
  OR NEW.account_public_id IS NOT OLD.account_public_id
  OR NEW.release_mode IS NOT OLD.release_mode
  OR NEW.approval_packet_sha256 IS NOT OLD.approval_packet_sha256
  OR NEW.activated_at IS NOT OLD.activated_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.activated_by_principal_id IS NOT OLD.activated_by_principal_id
BEGIN SELECT RAISE(ABORT,'conversion_provider_release_identity_immutable'); END;

CREATE TRIGGER trg_conversion_provider_release_cas_transition
BEFORE UPDATE OF status,updated_at,updated_by_principal_id,row_version
  ON conversion_provider_execution_releases
WHEN OLD.status!='active'
  OR NEW.status NOT IN ('revoked','expired')
  OR NEW.row_version!=OLD.row_version+1
  OR NEW.updated_at<OLD.updated_at
  OR NEW.updated_by_principal_id IS NULL
BEGIN SELECT RAISE(ABORT,'conversion_provider_release_cas_invalid'); END;

CREATE TRIGGER trg_conversion_provider_release_protected_delete
BEFORE DELETE ON conversion_provider_execution_releases
BEGIN SELECT RAISE(ABORT,'conversion_provider_release_protected'); END;
