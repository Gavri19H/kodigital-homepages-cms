-- Part A: a Meta destination may run "live" (real events, no test code) as well
-- as "test_only". Widens two CHECKs and adds an append-only change audit.
--
-- SQLite cannot alter a CHECK in place, so the two affected tables are rebuilt:
-- drop their triggers, create a _v2 copy identical except for the widened CHECK,
-- copy every row, drop the old table, rename, then recreate the indexes and
-- triggers verbatim from 0043/0044. Every existing row and every test_only rule
-- is unchanged. Nothing here creates a head, version, release or audit row.
PRAGMA defer_foreign_keys = ON;

-- 1. Provider connection heads: status gains 'live'.
DROP TRIGGER trg_conversion_provider_head_identity_immutable;
DROP TRIGGER trg_conversion_provider_head_protected_delete;

CREATE TABLE conversion_provider_connection_heads_v2 (
  destination_connection_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY,
  workspace_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_workspaces(workspace_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  current_config_version INTEGER NOT NULL CHECK(current_config_version BETWEEN 1 AND 2147483647),
  current_snapshot_sha256 BLOB NOT NULL CHECK(length(current_snapshot_sha256)=32),
  status TEXT NOT NULL COLLATE BINARY CHECK(status IN ('disabled','test_only','live')),
  updated_at INTEGER NOT NULL CHECK(updated_at>=0),
  row_version INTEGER NOT NULL CHECK(row_version BETWEEN 1 AND 2147483647),
  UNIQUE(destination_connection_id,workspace_id),
  FOREIGN KEY(destination_connection_id,current_config_version,current_snapshot_sha256,workspace_id)
    REFERENCES conversion_provider_connection_versions(
      destination_connection_id,config_version,snapshot_sha256,workspace_id
    ) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

INSERT INTO conversion_provider_connection_heads_v2(
  destination_connection_id,workspace_id,current_config_version,current_snapshot_sha256,
  status,updated_at,row_version
)
SELECT destination_connection_id,workspace_id,current_config_version,current_snapshot_sha256,
  status,updated_at,row_version
FROM conversion_provider_connection_heads;

DROP TABLE conversion_provider_connection_heads;
ALTER TABLE conversion_provider_connection_heads_v2 RENAME TO conversion_provider_connection_heads;

CREATE INDEX idx_conversion_provider_heads_workspace_status_destination
  ON conversion_provider_connection_heads(workspace_id,status,destination_connection_id);

CREATE TRIGGER trg_conversion_provider_head_identity_immutable
BEFORE UPDATE OF destination_connection_id,workspace_id ON conversion_provider_connection_heads
WHEN NEW.destination_connection_id IS NOT OLD.destination_connection_id
  OR NEW.workspace_id IS NOT OLD.workspace_id
BEGIN SELECT RAISE(ABORT,'conversion_provider_head_identity_immutable'); END;

CREATE TRIGGER trg_conversion_provider_head_protected_delete
BEFORE DELETE ON conversion_provider_connection_heads
BEGIN SELECT RAISE(ABORT,'conversion_provider_head_protected'); END;

-- 2. Execution releases: release_mode gains 'meta_live' (at most 366 days);
-- 'meta_test_event' keeps its one-hour limit.
DROP TRIGGER trg_conversion_provider_release_identity_immutable;
DROP TRIGGER trg_conversion_provider_release_cas_transition;
DROP TRIGGER trg_conversion_provider_release_protected_delete;

CREATE TABLE conversion_provider_execution_releases_v2 (
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
  release_mode TEXT NOT NULL COLLATE BINARY CHECK(release_mode IN ('meta_test_event','meta_live')),
  approval_packet_sha256 BLOB NOT NULL CHECK(length(approval_packet_sha256)=32),
  status TEXT NOT NULL COLLATE BINARY CHECK(status IN ('active','revoked','expired')),
  activated_at INTEGER NOT NULL CHECK(activated_at>=0),
  expires_at INTEGER NOT NULL,
  activated_by_principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL CHECK(updated_at>=activated_at),
  updated_by_principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  row_version INTEGER NOT NULL CHECK(row_version BETWEEN 1 AND 2147483647),
  UNIQUE(release_id,destination_connection_id),
  CHECK(expires_at>activated_at AND (
    (release_mode='meta_test_event' AND expires_at-activated_at<=3600) OR
    (release_mode='meta_live' AND expires_at-activated_at<=31622400)
  )),
  FOREIGN KEY(destination_connection_id,config_version,source_snapshot_sha256,workspace_id)
    REFERENCES conversion_provider_connection_versions(
      destination_connection_id,config_version,snapshot_sha256,workspace_id
    ) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

INSERT INTO conversion_provider_execution_releases_v2(
  release_id,workspace_id,destination_connection_id,config_version,source_snapshot_sha256,
  adapter_type,account_public_id,release_mode,approval_packet_sha256,status,
  activated_at,expires_at,activated_by_principal_id,updated_at,updated_by_principal_id,row_version
)
SELECT release_id,workspace_id,destination_connection_id,config_version,source_snapshot_sha256,
  adapter_type,account_public_id,release_mode,approval_packet_sha256,status,
  activated_at,expires_at,activated_by_principal_id,updated_at,updated_by_principal_id,row_version
FROM conversion_provider_execution_releases;

DROP TABLE conversion_provider_execution_releases;
ALTER TABLE conversion_provider_execution_releases_v2 RENAME TO conversion_provider_execution_releases;

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

-- 3. Append-only record of every Meta configuration change made in the CMS.
CREATE TABLE conversion_provider_change_audit (
  audit_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK(length(audit_id)=36 AND audit_id=lower(audit_id)
      AND substr(audit_id,9,1)='-' AND substr(audit_id,14,1)='-'
      AND substr(audit_id,15,1)='7' AND substr(audit_id,19,1)='-'
      AND substr(audit_id,20,1) IN ('8','9','a','b') AND substr(audit_id,24,1)='-'
      AND length(replace(audit_id,'-',''))=32
      AND replace(audit_id,'-','') NOT GLOB '*[^0-9a-f]*'),
  workspace_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_workspaces(workspace_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  destination_connection_id TEXT NOT NULL COLLATE BINARY,
  principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  action TEXT NOT NULL COLLATE BINARY CHECK(action='meta_configure'),
  from_status TEXT COLLATE BINARY
    CHECK(from_status IS NULL OR from_status IN ('disabled','test_only','live')),
  to_status TEXT NOT NULL COLLATE BINARY CHECK(to_status IN ('disabled','test_only','live')),
  config_version INTEGER NOT NULL CHECK(config_version BETWEEN 1 AND 2147483647),
  release_id TEXT COLLATE BINARY,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  FOREIGN KEY(destination_connection_id,config_version)
    REFERENCES conversion_provider_connection_versions(destination_connection_id,config_version)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(release_id,destination_connection_id)
    REFERENCES conversion_provider_execution_releases(release_id,destination_connection_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_conversion_provider_change_audit_destination_created
  ON conversion_provider_change_audit(workspace_id,destination_connection_id,created_at);

CREATE TRIGGER trg_conversion_provider_change_audit_no_update
BEFORE UPDATE ON conversion_provider_change_audit
BEGIN SELECT RAISE(ABORT,'conversion_provider_change_audit_append_only'); END;

CREATE TRIGGER trg_conversion_provider_change_audit_no_delete
BEFORE DELETE ON conversion_provider_change_audit
BEGIN SELECT RAISE(ABORT,'conversion_provider_change_audit_append_only'); END;
