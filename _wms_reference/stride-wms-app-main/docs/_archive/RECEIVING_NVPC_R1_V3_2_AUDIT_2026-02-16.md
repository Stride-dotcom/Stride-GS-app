# NVPC PHASE R1 v3.2 — EXECUTION SUMMARY (Audit)

This is an **audit** of the current branch against the NVPC Phase R1 v3.2 prompt the team referenced.

BRANCH:
- cursor/receiving-structural-repairs-0165

COMMIT:
- dab1392 (HEAD at time of audit; includes prefix hardening migration)

TSC RESULT:
- PASS (`npx tsc --noEmit`)

PRE-FLIGHT RESULTS:

PF-1 (handleCreateInbound payload):
- DRIFT (non-critical): `IncomingManager.tsx` is now a wrapper that renders `IncomingContent` and does not contain the insert handler.
- PASS (behavior): "Start Dock Intake" insert payload matches PF-1 exactly in:
  - `src/pages/Shipments.tsx` (`handleStartDockIntake`)
  - `src/components/shipments/IncomingContent.tsx` (`handleCreateInbound('dock_intake')`)
  Payload (exact):
  {
    tenant_id: profile.tenant_id,
    shipment_type: "inbound",
    status: "expected",
    inbound_kind: "dock_intake",
    inbound_status: "draft",
    created_by: profile.id
  }

PF-2 (Shipments.tsx query fields + allowed additions):
- PASS: `src/pages/Shipments.tsx` queries use `inbound_kind`, `inbound_status`, `eta_start`, `eta_end` alongside legacy fields (`status`, `deleted_at`, `received_at`, `completed_at`, etc).

PF-3 (inbound_status routing):
- PASS: `src/components/receiving/ReceivingStageRouter.tsx` routes receiving stage logic using `inbound_status` (not shipment `status`).

PF-4 (signature columns):
- PASS (code-level verification): receiving flow references existing shipment signature columns:
  - `signature_data`
  - `signature_name`
  - `signature_timestamp`
  (see `ReceivingStageRouter.tsx` and `Stage1DockIntake.tsx` usage)

PF-5 (account_id nullable):
- PASS (code-level verification): application logic assumes nullable `account_id` (UNIDENTIFIED is UI-enforced).

PF-6 (regex locations found + changed):
- In-scope required locations updated:
  - `src/config/entities.ts`: `/\b((?:SHP|MAN|EXP|INT|OUT)-\d{5,6})\b/gi`
  - `src/services/chatbotTools.ts`: `/^(SHP|MAN|EXP|INT|OUT)-\d{5,6}$/i`
- Additional runtime locations found + updated for correctness:
  - `src/components/ai/AITenantBot.tsx` (clickable entity parsing + shipment detection)
  - `src/services/chatHandler.ts` (system prompt tool description text)
- Additional SHP-only examples found (not changed; non-critical):
  - `src/components/claims/ClaimCreateDialog.tsx` placeholder text
  - `src/hooks/useCommunications.ts` token sample strings

FILES MODIFIED (recent changes directly related to this audit finding):
- src/pages/ShipmentCreate.tsx
- src/pages/ClientInboundCreate.tsx
- src/components/ai/AITenantBot.tsx
- src/services/chatHandler.ts

FILES CREATED:
- supabase/migrations/20260216054000_harden_shipment_number_prefix_trigger.sql

MIGRATIONS:
- 20260216054000_harden_shipment_number_prefix_trigger.sql
  - Re-defines:
    - `public.generate_shipment_number(p_prefix text default 'SHP')` -> 5-digit LPAD + prefix
    - `public.generate_shipment_number()` wrapper (ensures no legacy 6-digit drift for callers)
    - `public.set_shipment_number()` mapping to MAN/EXP/INT/OUT/SHP
  - Ensures the `trigger_set_shipment_number` exists on `public.shipments`
  - Does NOT rewrite existing `shipments.shipment_number` values.

ADDITIONAL SUPPORTING EDITS (if any):
- Chat UI parsing changes were made to keep entity linking functional for new prefixes.

DATA MODEL:
- is_system_account column:
  - Implemented in `supabase/migrations/20260214100000_r1_receiving_repairs.sql`
- unidentified account function:
  - `public.ensure_unidentified_account(...)` implemented (and later hardened tenant-scope in a follow-up migration).
- prefix function updated:
  - Implemented in `supabase/migrations/20260214100000_r1_receiving_repairs.sql`
  - Hardened/ensured again in `supabase/migrations/20260216054000_harden_shipment_number_prefix_trigger.sql`

PREFIX CONFIRMATION (behavioral expectation):
- MAN: new inbound_kind='manifest' shipments should generate `MAN-#####`
- EXP: new inbound_kind='expected' shipments should generate `EXP-#####`
- INT: new inbound_kind='dock_intake' shipments should generate `INT-#####`
- OUT: new shipment_type='outbound' shipments should generate `OUT-#####`
- SHP (legacy): existing SHP-###### values remain unchanged (per prompt contract)

IMPORTANT NOTE ABOUT WHAT YOU ARE SEEING IN UI:
- If you are viewing records created BEFORE the prefix migration(s) ran, they will still show legacy `SHP-######`.
- If you are creating inbound shipments via older create flows that did not set `inbound_kind`, they would generate SHP.
  - This was identified and fixed by setting `inbound_kind: 'expected'` on:
    - `src/pages/ShipmentCreate.tsx`
    - `src/pages/ClientInboundCreate.tsx`

DEFERRED TO FUTURE PHASES (status in current repo):
- FUTURE-1 Will Call migration to outbound shipment type:
  - Implemented (UI moved Will Call off Tasks and into Outbound Shipments).
- FUTURE-2 Field-level help/tooltip content system:
  - Implemented (see `src/hooks/useFieldHelpContent.ts`, `src/components/ui/help-tip.tsx`, `src/components/settings/FieldHelpSettingsTab.tsx`).
- FUTURE-3 Automation toggles for unidentified intake flagging:
  - Implemented (tenant preference `auto_apply_arrival_no_id_flag` + Settings UI + Stage 2 respects toggle).

