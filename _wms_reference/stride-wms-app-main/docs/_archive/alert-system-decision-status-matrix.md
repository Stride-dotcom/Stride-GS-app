# Alert System Decision Status Matrix

Date: 2026-02-20  
Branch: `cursor/alert-system-implementation-plan-5d2b`

Status legend:
- **Implemented**: behavior is present end-to-end in code.
- **Partial**: core behavior exists but one or more required pieces are still missing.
- **Missing**: not implemented in code yet.

| # | Decision / Requirement | Status | Evidence | Gap / Note |
|---|---|---|---|---|
| 1 | Dev migration strategy: full reset in dev, additive sync in prod, emergency super-admin override | **Implemented** | Additive sync via `rpc_admin_sync_trigger_catalog_to_tenants`; emergency override RPC `rpc_admin_force_reset_tenant_alert_templates` with explicit override token (`20260224100000_alert_legacy_registry_and_template_guardrails.sql`) and Template Ops UI controls (`src/pages/admin/AlertTemplateOps.tsx`) | — |
| 2 | Legacy triggers remain active but are hidden/labeled; legacy registry/folder for old templates | **Implemented** | Catalog now has explicit `is_legacy` + `legacy_replacement_key`; dedicated `communication_legacy_trigger_registry` table + refresh RPC; legacy hidden-by-default controls in tenant/admin UI (`AlertList.tsx`, `CreateAlertDialog.tsx`, `AlertTemplateOps.tsx`) | — |
| 3 | Maintain legacy + dotted trigger compatibility while rolling forward | **Implemented** | Both key styles are represented in trigger catalog and default templates (`communication_trigger_catalog`, `defaultAlertTemplates.ts`) | — |
| 4 | New trigger added => templates auto-provisioned for all tenants | **Implemented** | Auto-provision trigger + backfill migration (`supabase/migrations/20260220142000_trigger_catalog_auto_template_provisioning.sql`) and admin sync RPC | — |
| 5 | Every generated template uses branded wrapper; tenant edits subject/body/tokens | **Implemented** | Shared renderer `supabase/functions/_shared/emailBranding.ts`; applied in `send-alerts` and `send-test-email`; plain text templates wrapped at send-time | — |
| 6 | Branding source strictness (organization/company info as source of company identity) | **Implemented** | Tenant company fields loaded from `tenant_company_settings` (`useCommunications`, send functions); logo sourced from company settings in send functions | Accent color still persists in `communication_brand_settings`, but managed from Organization Settings UI |
| 7 | Super-admin (admin_dev) template ops page with powerful editing/preview/wrapper/versioning/rollouts | **Implemented** | `src/pages/admin/AlertTemplateOps.tsx` route-gated to `admin_dev` in `src/App.tsx`; wrapper/template CRUD RPCs in `20260220133000_admin_alert_template_ops.sql` | — |
| 8 | “Run Catalog Sync Now” for selected/all active triggers | **Implemented** | Buttons and handler in `AlertTemplateOps.tsx` calling `rpc_admin_sync_trigger_catalog_to_tenants` | — |
| 9 | Template rollout choices: Replace All / Layout Only / Do Not Update with tenant control and opt-out | **Implemented** | Rollout modes in admin RPC + UI; tenant inbox + decision RPCs (`TemplateRolloutInboxCard.tsx`, `20260220173000_alert_rollout_automation_and_tenant_decisions.sql`) | — |
| 10 | Security-critical updates forced after grace window (mandatory replace-all semantics) | **Implemented** | `is_security_critical`, `security_grace_until`, forced replace logic in `rpc_admin_execute_template_rollout`; due processor RPC + pg_cron scheduler wiring (`20260220190000_schedule_template_rollout_processor.sql`) | — |
| 11 | Audit logging should be append-only | **Implemented** | Rollout audit writes in rollout executor + immutable trigger added (`20260220174500_platform_rollout_audit_append_only.sql`) | — |
| 12 | Tenant edit boundaries: subject/body/tokens/recipients only (layout controlled centrally) | **Implemented** | DB trigger guard `enforce_communication_template_edit_boundaries` blocks non-admin_dev mutation of platform-managed fields and only allows tenant-editable scope (`20260224100000_alert_legacy_registry_and_template_guardrails.sql`) | — |
| 13 | In-app control should include role eligibility + individual preferences (management UI) | **Implemented** | Tenant role-eligibility policy table + RPCs (`tenant_in_app_role_eligibility`, `rpc_get_my_in_app_role_eligibility`, `rpc_set_my_in_app_role_eligibility`), tenant management card (`InAppRoleEligibilityCard.tsx`), send-time enforcement in `send-alerts`, and end-user toggle UI in avatar dropdown persisted to `user_preferences.preference_key='in_app_alerts'` | — |
| 14 | Recipient UX: combined token + manual entries; chips-like UX | **Partial** | Token insertion + comma-separated recipient fields in editor | No chip-based recipient entry UX yet |
| 15 | SMS entries should enforce E.164 and provide helper/warning | **Implemented** | E.164 validation + helper text + save blocking for invalid SMS recipients in `AlertTemplateEditor.tsx` | — |
| 16 | Email domain handling should be non-blocking with typo warnings | **Implemented** | Non-blocking typo warnings for common domains in `AlertTemplateEditor.tsx` | — |
| 17 | SMS channel availability visible but locked when no SMS subscription | **Implemented** | SMS lock state shown in alert list and create flow (`AlertList.tsx`, `CreateAlertDialog.tsx`, `AlertTemplateEditor.tsx`) via `useSmsAddonActivation` | — |
| 18 | Curated default alert set for client/internal operations | **Partial** | Large curated defaults exist in trigger catalog + `defaultAlertTemplates.ts` with audience metadata and in-app defaults | No explicit “default profile manager” UI/workflow to tune curated bundles per audience |
| 19 | Scheduled rollout execution (not only “Launch Now”) | **Implemented** | Processor function (`supabase/functions/process-template-rollouts/index.ts`), due-rollout RPC, and pg_cron schedule registration migration (`20260220190000_schedule_template_rollout_processor.sql`) | — |

## Net conclusion

Core backlog items from the alert-system ledger are now closed for launch-critical scope.
The only remaining optional enhancements are UX refinements (chips-style recipient editing polish and a curated default-profile manager UI), which are not blockers for production rollout.
