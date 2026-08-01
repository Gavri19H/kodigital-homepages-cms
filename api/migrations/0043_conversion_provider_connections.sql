-- Private Conversions provider-configuration authority. Additive, strict and
-- intentionally seedless: predeployment permits disabled/test-only state only.
PRAGMA foreign_keys = ON;

CREATE TABLE conversion_provider_credential_aliases (
  credential_alias_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK(length(credential_alias_id)=36 AND credential_alias_id=lower(credential_alias_id)
      AND substr(credential_alias_id,9,1)='-' AND substr(credential_alias_id,14,1)='-'
      AND substr(credential_alias_id,15,1)='7' AND substr(credential_alias_id,19,1)='-'
      AND substr(credential_alias_id,20,1) IN ('8','9','a','b') AND substr(credential_alias_id,24,1)='-'
      AND length(replace(credential_alias_id,'-',''))=32
      AND replace(credential_alias_id,'-','') NOT GLOB '*[^0-9a-f]*'),
  workspace_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_workspaces(workspace_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  destination_connection_id TEXT NOT NULL COLLATE BINARY,
  adapter_type TEXT NOT NULL COLLATE BINARY CHECK(adapter_type IN ('meta','google_data_manager')),
  purpose TEXT NOT NULL COLLATE BINARY CHECK(
    (adapter_type='meta' AND purpose='meta_access_token') OR
    (adapter_type='google_data_manager' AND purpose='google_oauth_access_token')
  ),
  status TEXT NOT NULL COLLATE BINARY CHECK(status IN ('test_only','disabled')),
  secret_present INTEGER NOT NULL CHECK(secret_present IN (0,1) AND (status!='test_only' OR secret_present=1)),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  created_by_principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
  updated_by_principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  row_version INTEGER NOT NULL CHECK(row_version BETWEEN 1 AND 2147483647),
  UNIQUE(credential_alias_id,workspace_id,destination_connection_id,adapter_type,purpose),
  UNIQUE(workspace_id,destination_connection_id,adapter_type,purpose)
) STRICT;

CREATE TABLE conversion_provider_connection_versions (
  workspace_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_workspaces(workspace_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  destination_connection_id TEXT NOT NULL COLLATE BINARY,
  config_version INTEGER NOT NULL CHECK(config_version BETWEEN 1 AND 2147483647),
  adapter_type TEXT NOT NULL COLLATE BINARY
    CHECK(adapter_type IN ('meta','google_data_manager','newsbreak','outbrain','taboola')),
  account_public_id TEXT NOT NULL COLLATE BINARY
    CHECK(length(CAST(account_public_id AS BLOB)) BETWEEN 1 AND 256
      AND account_public_id NOT GLOB '*[^!-~]*'),
  snapshot_json TEXT NOT NULL COLLATE BINARY
    CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
  snapshot_sha256 BLOB NOT NULL CHECK(length(snapshot_sha256)=32),
  credential_alias_id TEXT COLLATE BINARY,
  credential_purpose TEXT COLLATE BINARY,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  created_by_principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  PRIMARY KEY(destination_connection_id,config_version),
  UNIQUE(destination_connection_id,config_version,snapshot_sha256,workspace_id),
  CHECK((credential_alias_id IS NULL)=(credential_purpose IS NULL)),
  CHECK(
    (credential_alias_id IS NULL AND credential_purpose IS NULL) OR
    (adapter_type='meta' AND credential_purpose='meta_access_token') OR
    (adapter_type='google_data_manager' AND credential_purpose='google_oauth_access_token')
  ),
  CHECK(adapter_type IN ('meta','google_data_manager') OR credential_alias_id IS NULL),
  FOREIGN KEY(credential_alias_id,workspace_id,destination_connection_id,adapter_type,credential_purpose)
    REFERENCES conversion_provider_credential_aliases(
      credential_alias_id,workspace_id,destination_connection_id,adapter_type,purpose
    ) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE conversion_provider_connection_heads (
  destination_connection_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY,
  workspace_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_workspaces(workspace_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  current_config_version INTEGER NOT NULL CHECK(current_config_version BETWEEN 1 AND 2147483647),
  current_snapshot_sha256 BLOB NOT NULL CHECK(length(current_snapshot_sha256)=32),
  status TEXT NOT NULL COLLATE BINARY CHECK(status IN ('disabled','test_only')),
  updated_at INTEGER NOT NULL CHECK(updated_at>=0),
  row_version INTEGER NOT NULL CHECK(row_version BETWEEN 1 AND 2147483647),
  UNIQUE(destination_connection_id,workspace_id),
  FOREIGN KEY(destination_connection_id,current_config_version,current_snapshot_sha256,workspace_id)
    REFERENCES conversion_provider_connection_versions(
      destination_connection_id,config_version,snapshot_sha256,workspace_id
    ) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_conversion_provider_versions_workspace_provider_account_version
  ON conversion_provider_connection_versions(workspace_id,adapter_type,account_public_id,config_version);
CREATE INDEX idx_conversion_provider_heads_workspace_status_destination
  ON conversion_provider_connection_heads(workspace_id,status,destination_connection_id);
CREATE INDEX idx_conversion_provider_aliases_workspace_provider_status
  ON conversion_provider_credential_aliases(workspace_id,adapter_type,status);
CREATE INDEX idx_conversion_provider_aliases_destination_purpose
  ON conversion_provider_credential_aliases(destination_connection_id,purpose);

CREATE TRIGGER trg_conversion_provider_version_immutable_update
BEFORE UPDATE ON conversion_provider_connection_versions
BEGIN SELECT RAISE(ABORT,'conversion_provider_version_immutable'); END;

CREATE TRIGGER trg_conversion_provider_version_immutable_delete
BEFORE DELETE ON conversion_provider_connection_versions
BEGIN SELECT RAISE(ABORT,'conversion_provider_version_immutable'); END;

CREATE TRIGGER trg_conversion_provider_head_identity_immutable
BEFORE UPDATE OF destination_connection_id,workspace_id ON conversion_provider_connection_heads
WHEN NEW.destination_connection_id IS NOT OLD.destination_connection_id
  OR NEW.workspace_id IS NOT OLD.workspace_id
BEGIN SELECT RAISE(ABORT,'conversion_provider_head_identity_immutable'); END;

CREATE TRIGGER trg_conversion_provider_head_protected_delete
BEFORE DELETE ON conversion_provider_connection_heads
BEGIN SELECT RAISE(ABORT,'conversion_provider_head_protected'); END;

CREATE TRIGGER trg_conversion_provider_alias_identity_immutable
BEFORE UPDATE OF credential_alias_id,workspace_id,destination_connection_id,adapter_type,purpose,
  created_at,created_by_principal_id ON conversion_provider_credential_aliases
WHEN NEW.credential_alias_id IS NOT OLD.credential_alias_id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.destination_connection_id IS NOT OLD.destination_connection_id
  OR NEW.adapter_type IS NOT OLD.adapter_type
  OR NEW.purpose IS NOT OLD.purpose
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.created_by_principal_id IS NOT OLD.created_by_principal_id
BEGIN SELECT RAISE(ABORT,'conversion_provider_alias_identity_immutable'); END;

CREATE TRIGGER trg_conversion_provider_alias_protected_delete
BEFORE DELETE ON conversion_provider_credential_aliases
BEGIN SELECT RAISE(ABORT,'conversion_provider_alias_protected'); END;

CREATE TRIGGER trg_conversion_provider_alias_cas_transition
BEFORE UPDATE OF status,secret_present,updated_at,updated_by_principal_id,row_version
  ON conversion_provider_credential_aliases
WHEN NEW.row_version!=OLD.row_version+1 OR NEW.updated_at<OLD.updated_at
  OR NEW.updated_by_principal_id IS NULL
  OR (NEW.status='test_only' AND NEW.secret_present!=1)
BEGIN SELECT RAISE(ABORT,'conversion_provider_alias_cas_invalid'); END;
