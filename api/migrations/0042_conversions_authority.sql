-- Permanent KODigital CMS identity/workspace/permission authority.
-- Additive and intentionally seedless: production identity and ownership rows
-- remain deployment-stage data mutations.
PRAGMA foreign_keys = ON;

CREATE TABLE conversion_admin_principals (
  principal_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK(length(principal_id)=36 AND principal_id=lower(principal_id)
      AND substr(principal_id,9,1)='-' AND substr(principal_id,14,1)='-'
      AND substr(principal_id,15,1)='7' AND substr(principal_id,19,1)='-'
      AND substr(principal_id,20,1) IN ('8','9','a','b') AND substr(principal_id,24,1)='-'
      AND length(replace(principal_id,'-',''))=32
      AND replace(principal_id,'-','') NOT GLOB '*[^0-9a-f]*'),
  canonical_email TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK(canonical_email=lower(trim(canonical_email))
      AND length(CAST(canonical_email AS BLOB)) BETWEEN 3 AND 254
      AND canonical_email NOT GLOB '* *' AND canonical_email NOT GLOB '*[^!-~]*'),
  access_subject TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK(length(CAST(access_subject AS BLOB)) BETWEEN 1 AND 255
      AND access_subject NOT GLOB '*[^!-~]*'),
  display_name TEXT NOT NULL
    CHECK(display_name=trim(display_name) AND length(CAST(display_name AS BLOB)) BETWEEN 1 AND 128),
  status TEXT NOT NULL CHECK(status IN ('active','disabled')),
  is_accountable_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_accountable_owner IN (0,1)),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_conversion_principals_one_active_accountable_owner
  ON conversion_admin_principals(is_accountable_owner)
  WHERE status='active' AND is_accountable_owner=1;

CREATE TABLE conversion_workspaces (
  workspace_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK(length(workspace_id)=36 AND workspace_id=lower(workspace_id)
      AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-'
      AND substr(workspace_id,15,1)='7' AND substr(workspace_id,19,1)='-'
      AND substr(workspace_id,20,1) IN ('8','9','a','b') AND substr(workspace_id,24,1)='-'
      AND length(replace(workspace_id,'-',''))=32
      AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*'),
  workspace_name TEXT NOT NULL
    CHECK(workspace_name=trim(workspace_name) AND length(CAST(workspace_name AS BLOB)) BETWEEN 1 AND 128),
  status TEXT NOT NULL CHECK(status IN ('active','disabled')),
  reporting_currency TEXT NOT NULL COLLATE BINARY
    CHECK(length(reporting_currency)=3 AND reporting_currency=upper(reporting_currency)
      AND reporting_currency NOT GLOB '*[^A-Z]*'),
  time_zone TEXT NOT NULL COLLATE BINARY
    CHECK(length(CAST(time_zone AS BLOB)) BETWEEN 1 AND 128 AND time_zone NOT GLOB '*[^!-~]*'),
  accountable_owner_principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE INDEX idx_conversion_workspaces_status ON conversion_workspaces(status,workspace_id);

CREATE TABLE conversion_workspace_memberships (
  principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_admin_principals(principal_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL COLLATE BINARY
    REFERENCES conversion_workspaces(workspace_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('accountable_owner','administrator','reporter')),
  status TEXT NOT NULL CHECK(status IN ('active','suspended','revoked')),
  capabilities_json TEXT NOT NULL COLLATE BINARY
    CHECK(json_valid(capabilities_json) AND json_type(capabilities_json)='array'),
  account_scope_json TEXT NOT NULL COLLATE BINARY
    CHECK(json_valid(account_scope_json) AND json_type(account_scope_json)='array'),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  PRIMARY KEY(principal_id,workspace_id)
);

CREATE INDEX idx_conversion_memberships_workspace_status
  ON conversion_workspace_memberships(workspace_id,status,principal_id);
CREATE INDEX idx_conversion_memberships_principal_status
  ON conversion_workspace_memberships(principal_id,status,workspace_id);
CREATE INDEX idx_conversion_memberships_role
  ON conversion_workspace_memberships(workspace_id,role,status);
CREATE UNIQUE INDEX uq_conversion_memberships_one_active_workspace_per_principal
  ON conversion_workspace_memberships(principal_id) WHERE status='active';
CREATE UNIQUE INDEX uq_conversion_memberships_one_active_owner_per_workspace
  ON conversion_workspace_memberships(workspace_id)
  WHERE status='active' AND role='accountable_owner';

CREATE TRIGGER trg_conversion_workspace_owner_insert BEFORE INSERT ON conversion_workspaces
WHEN NOT EXISTS (
  SELECT 1 FROM conversion_admin_principals p
  WHERE p.principal_id=NEW.accountable_owner_principal_id
    AND p.status='active' AND p.is_accountable_owner=1
)
BEGIN SELECT RAISE(ABORT,'conversion_workspace_owner_invalid'); END;

CREATE TRIGGER trg_conversion_workspace_owner_update
BEFORE UPDATE OF accountable_owner_principal_id,status ON conversion_workspaces
WHEN NOT EXISTS (
  SELECT 1 FROM conversion_admin_principals p
  WHERE p.principal_id=NEW.accountable_owner_principal_id
    AND p.status='active' AND p.is_accountable_owner=1
)
BEGIN SELECT RAISE(ABORT,'conversion_workspace_owner_invalid'); END;

CREATE TRIGGER trg_conversion_principal_owner_update
BEFORE UPDATE OF status,is_accountable_owner ON conversion_admin_principals
WHEN EXISTS (
  SELECT 1 FROM conversion_workspaces w
  WHERE w.accountable_owner_principal_id=OLD.principal_id AND w.status='active'
) AND (NEW.status!='active' OR NEW.is_accountable_owner!=1)
BEGIN SELECT RAISE(ABORT,'conversion_accountable_owner_protected'); END;

CREATE TRIGGER trg_conversion_principal_owner_delete BEFORE DELETE ON conversion_admin_principals
WHEN EXISTS (
  SELECT 1 FROM conversion_workspaces w
  WHERE w.accountable_owner_principal_id=OLD.principal_id AND w.status='active'
)
BEGIN SELECT RAISE(ABORT,'conversion_accountable_owner_protected'); END;

CREATE TRIGGER trg_conversion_membership_owner_insert BEFORE INSERT ON conversion_workspace_memberships
WHEN NEW.role='accountable_owner' AND NOT EXISTS (
  SELECT 1 FROM conversion_workspaces w JOIN conversion_admin_principals p
    ON p.principal_id=w.accountable_owner_principal_id
  WHERE w.workspace_id=NEW.workspace_id AND w.accountable_owner_principal_id=NEW.principal_id
    AND w.status='active' AND p.status='active' AND p.is_accountable_owner=1
)
BEGIN SELECT RAISE(ABORT,'conversion_membership_owner_invalid'); END;

CREATE TRIGGER trg_conversion_membership_owner_update
BEFORE UPDATE OF principal_id,workspace_id,role,status ON conversion_workspace_memberships
WHEN NEW.role='accountable_owner' AND NOT EXISTS (
  SELECT 1 FROM conversion_workspaces w JOIN conversion_admin_principals p
    ON p.principal_id=w.accountable_owner_principal_id
  WHERE w.workspace_id=NEW.workspace_id AND w.accountable_owner_principal_id=NEW.principal_id
    AND w.status='active' AND p.status='active' AND p.is_accountable_owner=1
)
BEGIN SELECT RAISE(ABORT,'conversion_membership_owner_invalid'); END;

CREATE TRIGGER trg_conversion_membership_owner_protect_update
BEFORE UPDATE OF principal_id,workspace_id,role,status ON conversion_workspace_memberships
WHEN OLD.role='accountable_owner' AND OLD.status='active'
  AND EXISTS (SELECT 1 FROM conversion_workspaces w
    WHERE w.workspace_id=OLD.workspace_id AND w.status='active'
      AND w.accountable_owner_principal_id=OLD.principal_id)
  AND (NEW.principal_id!=OLD.principal_id OR NEW.workspace_id!=OLD.workspace_id
    OR NEW.role!='accountable_owner' OR NEW.status!='active')
BEGIN SELECT RAISE(ABORT,'conversion_membership_owner_protected'); END;

CREATE TRIGGER trg_conversion_membership_owner_protect_delete
BEFORE DELETE ON conversion_workspace_memberships
WHEN OLD.role='accountable_owner' AND OLD.status='active'
  AND EXISTS (SELECT 1 FROM conversion_workspaces w
    WHERE w.workspace_id=OLD.workspace_id AND w.status='active'
      AND w.accountable_owner_principal_id=OLD.principal_id)
BEGIN SELECT RAISE(ABORT,'conversion_membership_owner_protected'); END;

CREATE TRIGGER trg_conversion_membership_active_principal_insert
BEFORE INSERT ON conversion_workspace_memberships
WHEN NEW.status='active' AND NOT EXISTS (
  SELECT 1 FROM conversion_admin_principals p
  JOIN conversion_workspaces w ON w.workspace_id=NEW.workspace_id
  WHERE p.principal_id=NEW.principal_id AND p.status='active' AND w.status='active'
)
BEGIN SELECT RAISE(ABORT,'conversion_membership_active_authority_invalid'); END;

CREATE TRIGGER trg_conversion_membership_active_principal_update
BEFORE UPDATE OF principal_id,workspace_id,status ON conversion_workspace_memberships
WHEN NEW.status='active' AND NOT EXISTS (
  SELECT 1 FROM conversion_admin_principals p
  JOIN conversion_workspaces w ON w.workspace_id=NEW.workspace_id
  WHERE p.principal_id=NEW.principal_id AND p.status='active' AND w.status='active'
)
BEGIN SELECT RAISE(ABORT,'conversion_membership_active_authority_invalid'); END;

CREATE TRIGGER trg_conversion_principal_active_membership_protect
BEFORE UPDATE OF status ON conversion_admin_principals
WHEN NEW.status!='active' AND EXISTS (
  SELECT 1 FROM conversion_workspace_memberships m
  WHERE m.principal_id=OLD.principal_id AND m.status='active'
)
BEGIN SELECT RAISE(ABORT,'conversion_principal_active_membership_protected'); END;
