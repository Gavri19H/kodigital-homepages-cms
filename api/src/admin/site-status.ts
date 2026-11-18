// Site status lifecycle (T36 [BCL-070]): for each CURRENT status, the statuses
// a site may legally move to. One source of truth for the server's PATCH
// /api/admin/sites/:id check (sites-handlers.ts) and the Domains "Change
// status" window (templates/domains.ts, X04), so the window never offers a
// status the server would refuse.
export const SITE_STATUS_NEXT: Readonly<Record<string, readonly string[]>> = {
  draft: ["provisioning", "disabled", "failed"],
  provisioning: ["active", "failed", "disabled"],
  active: ["disabled"],
  disabled: ["active", "draft"],
  failed: ["provisioning", "draft", "disabled"],
};
