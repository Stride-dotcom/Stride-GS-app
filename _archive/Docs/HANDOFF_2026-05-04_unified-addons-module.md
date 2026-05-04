# HANDOFF: Unified Addons Module + Today's Wave

**Date authored:** 2026-05-04
**Author:** Claude Opus 4.7 session ending at 80% context
**Pickup ask:** Build the unified addons module (Step 1 only — Step 2 is a separate strategic decision).
**Live URL:** https://www.mystridehub.com

---

## TL;DR for the picking-up agent

Today we shipped 9 PRs (228–236) that fixed the WC ledger silent-skip bug, built hardening so the bug class can't recur, added a Coverage Audit tab, replaced the IIF→Payments friction with a Batches view, and rewrote the intake form for autopay opt-in. **Justin's last unfinished ask is a generalized "addons module" that plugs into Tasks, Repairs, Will Calls, and Item Detail pages.** Today's task_addons system is task-shaped; we want it polymorphic so adding addon support to a new entity is ~10 lines of GAS plus a JSX inclusion.

The full plan is in **§6 below**. Read §1–5 first to ground yourself in the current state.

---

## 1. What just shipped today (last ~10 hours)

| PR | Title | What it does |
|---|---|---|
| [#228](https://github.com/Stride-dotcom/Stride-GS-app/pull/228) | fix(billing): WC release writes Ledger Row ID | Forward fix for the bug that hid 84 WC ledger rows for a month + backfill admin entry. |
| [#229](https://github.com/Stride-dotcom/Stride-GS-app/pull/229) | chore(billing): hardening so the WC silent-skip class can't recur | CHECK constraints on 6 entity-key columns, sync-side surfacing of silent skips, supabaseBatchUpsert_ shape-split, runAuditMissingLedgerRowIds admin entry. |
| [#230](https://github.com/Stride-dotcom/Stride-GS-app/pull/230) | feat(billing): Coverage Audit tab | New Postgres view `billable_event_coverage` + tab on Billing page that cross-checks every billable event vs the ledger. |
| [#231](https://github.com/Stride-dotcom/Stride-GS-app/pull/231) | feat(payments): batches + auto-mirror, replace IIF upload | `handleQbExport_` now calls `_sbResyncAllStaxInvoices` (the missing fix) + writes `stax_invoice_batches` row + stamps `batch_id` on stax_invoices. New Payments → Batches tab. |
| [#232](https://github.com/Stride-dotcom/Stride-GS-app/pull/232) | feat(intake): autopay opt-in + weekly resign reminders | T&C §3 rewritten in Stride voice for opt-in autopay, 7-day grace, 3% CC fee, past-due safety net. New `apply-intake-on-submit` + `intake-resign-reminder-cron` edge functions. Schema additions to `client_intakes` + `clients`. Weekly cron scheduled (Pacific 9 AM). |
| [#233](https://github.com/Stride-dotcom/Stride-GS-app/pull/233) | fix(intakes): refresh-mode opens edit modal | "Apply Refresh to Client" button opens OnboardClientModal in edit mode (not "Onboard New Client") for existing-client refresh intakes. |
| [#234](https://github.com/Stride-dotcom/Stride-GS-app/pull/234) | feat(intakes): preview-then-save | Modal pre-fills form fields from the intake (overlay on existing client) + shows pending-intake banner + cert-from-intake badge in TaxExemptBlock. Save & Sync commits. |
| [#235](https://github.com/Stride-dotcom/Stride-GS-app/pull/235) | fix(intakes): T&C badge auto-refetch + cert UI clarity | useClientTcStatus subscribes to entityEvents 'client'; cert UI now leads with green "on file" block instead of misleading file picker. |
| [#236](https://github.com/Stride-dotcom/Stride-GS-app/pull/236) | fix(wc): items load eagerly + billing preview shows recorded WC rows | itemIds+inv fallback in `fetchWillCallsFromSupabase`; BillingPreviewCard filters on `shipment_number` for will_call (was incorrectly filtering on `task_id`). |

Schema migrations applied:
- `entity_id_nonempty_check_constraints` (PR #229)
- `billable_event_coverage` view (PR #230, dropped + recreated)
- `stax_invoice_batches` table + `batch_id` FK (PR #231)
- `intake_autopay_optin_schema` (PR #232 — 5 cols on `client_intakes`, 5 cols on `clients`, mirror-current-state script)
- `intake_tc_section3_rewrite` (PR #232 — surgical regexp_replace on email_templates body)
- `intake_reminder_cron_extensions` (PR #232 — pg_cron + pg_net enabled)

Cron job:
- `intake-resign-reminder-daily` (id=2): daily at 17:00 UTC (9 AM Pacific). Schedule SQL is in the migration file's comment header — Justin already ran it, the service-role key landed in `cron.job.command`.

---

## 2. State of the world right now

**WC billing pipeline:**
- 17 non-COD WCs released since 2026-04-01 → all 56 line items present in `billing` table (verified post-PR #228 backfill).
- 10 COD WCs intentionally skipped (per Decision #5).
- Modern Design Sofa is the only client whose intake was activated under the new T&C (status='activated', cert URL on file at `clients.resale_cert_url`).
- All other 52 active clients show `last_intake_body_sha256 = 'pre-v2-migration'` sentinel — they need to re-sign under the new §3 (cron will start nudging them once they have an active intake link).

**Pending operational steps:**
- Justin needs to click "Resend Intake" on each of the 52 clients without an active link to start the cron flow. He'll do this on his own cadence.
- The `will_call_items` Supabase table is silently empty (no GAS write path populates it). PR #236 added an itemIds+inv fallback so this doesn't matter for UI, but it's a real gap if anything ever reads from that table directly.

**Known issues NOT addressed:**
- `task_addons` table is empty in production — feature shipped 2026-05-02, never used. Will be replaced by the unified addons module (this handoff's ask).
- 4 ASM tasks have no billing row (3 BPI "pre-built" + 1 RC "Fail" — all `custom_price=0`). Likely operator-suppressed. Not investigated further.
- 174 RCVG misses for items received in April on `IMP-` shipments — confirmed intentional per Decision #1 (imports don't bill receiving).

---

## 3. Decisions log from today's conversation

These are the durable decisions Justin made. Reference them before re-asking.

| # | Topic | Decision |
|---|---|---|
| 1 | RCVG for imports | Items on `IMP-`/`SHP-MIGRATED-` shipments don't bill receiving (intentional). |
| 2 | Past-due safety net | Card on file is the safety net; charge after 7-day grace if past due. |
| 3 | Late fee | 1.5% per month per invoice, 7-day grace period. Matches QBO config. |
| 4 | Dispute window | 30 days from charge date. |
| 5 | COD WC billing | True-COD WCs intentionally skip ledger. Notes contain `[COD Paid <date>]` to mark genuinely-paid ones. |
| 6 | Schema CHECK pattern | Empty entity-key columns must fail loud at INSERT (PR #229). |
| 7 | T&C location | `email_templates` table, `template_key='DOC_CLIENT_TC'`, `body` HTML. |
| 8 | T&C version tracking | SHA-256 of body, not named versions. Stored in `client_intakes.body_sha256` + mirrored to `clients.last_intake_body_sha256`. |
| 9 | Card-on-file policy | Required for new clients + past-due clients; encouraged-not-required for grandfathered clean-history existing clients. Tracked in `clients.payment_method_required`. |
| 10 | Migration default for `payment_method_required` | Mirrored current state per client: TRUE if `stax_customer_id` present, FALSE if not. 40/53 → TRUE, 13/53 → FALSE. |
| 11 | Refresh-mode submission | Auto-applies on submit (no staff click required). Edge function `apply-intake-on-submit`. |
| 12 | Reminder cadence | Weekly until completed. No max attempts. Per-client `intake_reminder_snooze_until` override available. |
| 13 | Email infrastructure | Resend via existing `send-email` edge function. New template `INTAKE_RESIGN_REMINDER`. |
| 14 | Strategic direction | Get out of Google entirely over time (Decision #33 in conversation). New work defaults to Supabase + edge functions; GAS is legacy-only. |
| 15 | Consent mechanism | Checkbox + typed initials (D in conversation). |
| 16 | Accepted methods | Credit (3% bank fee disclosed), debit, ACH (no fee). |
| 17 | Stride voice | Friendly contractions, "In short:" callouts with orange left-border, "your stuff" not "your goods", no legalese. Match what's in §1/§2/§4/§5 of the T&C body. |

---

## 4. The unfinished ask: unified addons module

### Justin's exact words

> "can we copy the task add on system. make that a plug in module so add ons can be plugged in to any entity pages we want. like repairs or even item details page. can add on system be Supabase only or do we need gas?"

### My answer (paraphrased — full thread in conversation log)

- **Yes, generalize as a module.** Polymorphic `addons` table keyed on `(parent_type, parent_id)`. One reusable `<AddonsBlock>` React component. One `useEntityAddons` hook. Per-entity completion handlers each call a single helper.
- **Supabase-only is partial yes**: storage + UI + fetching can be 100% Supabase. But materializing into billing rows still needs to write the client `Billing_Ledger` sheet today, because `handleCreateInvoice_` reads from that sheet to build invoices, which flow to QBO. Going fully Supabase-native for billing is a bigger Step 2 that's a separate strategic decision (advances Decision #33).
- **Step 1 (this PR — recommended)**: Hybrid. Addons live in Supabase. Each entity's GAS completion handler gets a `api_writeAddonsToLedger_(ss, parentType, parentId)` helper that reads from Supabase + writes to the client sheet. Same pattern as today's task_addons. ~half-day build. Low risk, reversible.
- **Step 2 (future, separate)**: Refactor billing-row pipeline to be Supabase-native. `handleCreateInvoice_` reads from `billing` table; client sheet becomes a read-cache mirror. Real piece of work, not tied to addons specifically.

Justin said *"we have used 80% of context. can you create a hand off doc and i will have this work done in a new session"* — confirming he wants Step 1 built.

---

## 5. File locations + table names (so the next agent doesn't have to grep)

**Repo:** `C:\dev\Stride-GS-app` (canonical clone — work in a worktree, not directly).

| Concept | Location |
|---|---|
| Today's task_addons table | Supabase `public.task_addons` (currently empty). Migration: `stride-gs-app/supabase/migrations/20260502160000_task_addons.sql` |
| Today's task_addons GAS reader | `api_fetchTaskAddons_` in `AppScripts/stride-api/StrideAPI.gs` |
| Today's task_addons GAS materializer | Inside `handleCompleteTask_` in `AppScripts/stride-api/StrideAPI.gs` (line ~14995) |
| Where addon rows hit the client sheet | `Billing_Ledger` tab on each tenant's spreadsheet, with `Ledger Row ID = {taskId}-{svcCode}-ADDON-{n}` |
| Where addon rows hit Supabase | `billing` table, mirrored from sheet via `api_fullClientSync_(.., ['billing'])` |
| BillingPreviewCard | `stride-gs-app/src/components/shared/BillingPreviewCard.tsx` — line 211 has the `(entityType === 'task' && addons) ? addons : []` restriction that needs to be lifted |
| Entity detail panels | `TaskDetailPanel.tsx`, `RepairDetailPanel.tsx`, `WillCallDetailPanel.tsx`, `ItemDetailPanel.tsx` — all in `stride-gs-app/src/components/shared/` |
| Service catalog | `service_catalog` table in Supabase (active services with code/name/category). Use `useServiceCatalog` hook to fetch. |
| Existing entity completion handlers | `handleCompleteTask_` (~line 14860), `handleCompleteRepair_`, `handleProcessWcRelease_` (~line 17707), `handleReceiveItems_` — all in `AppScripts/stride-api/StrideAPI.gs` |
| Stride API project ID | `134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M` |
| Supabase project ID | `uqplppugeickmamycpuz` |
| Deploy commands (from `AppScripts/stride-client-inventory/`) | `npm run push-api && npm run deploy-api` |
| Deploy React (from `stride-gs-app/`) | `npm run deploy -- "commit message"` |
| Service-role key for cron | Lives in `cron.job.command` (job id 2). Not in source. |

---

## 6. Implementation plan for unified addons module

### Migration

```sql
-- Drop the never-used task-specific table; we're replacing it.
DROP TABLE IF EXISTS task_addons;

CREATE TABLE addons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  parent_type     text NOT NULL CHECK (parent_type IN ('task','repair','will_call','inventory')),
  parent_id       text NOT NULL CHECK (parent_id <> ''),
  service_code    text NOT NULL,
  service_name    text NOT NULL DEFAULT '',
  qty             numeric NOT NULL DEFAULT 1,
  rate            numeric NOT NULL DEFAULT 0,
  item_class      text,
  total           numeric NOT NULL DEFAULT 0,
  added_by        text NOT NULL DEFAULT '',
  added_by_name   text NOT NULL DEFAULT '',
  billed          boolean NOT NULL DEFAULT false,
  billed_at       timestamptz,
  ledger_row_id   text,  -- set when materialized; for traceback
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX addons_parent_idx ON addons (tenant_id, parent_type, parent_id);
CREATE INDEX addons_unbilled_idx ON addons (tenant_id, parent_type, parent_id) WHERE billed = false;

-- RLS: same model as task_addons today (admin/staff full, client SELECT own).
ALTER TABLE addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY addons_admin_staff ON addons FOR ALL TO authenticated USING (true);
CREATE POLICY addons_client_select ON addons FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT spreadsheet_id FROM clients WHERE ...));  -- adapt from existing pattern
GRANT SELECT, INSERT, UPDATE, DELETE ON addons TO authenticated, service_role;
```

Run via MCP `apply_migration`.

### GAS — write helper

In `AppScripts/stride-api/StrideAPI.gs`, after `sbBillingRow_` (line ~4594), add:

```js
/**
 * Polymorphic addons → ledger materializer. Called by every entity's
 * completion handler (handleCompleteTask_, handleProcessWcRelease_, etc.).
 *
 * Reads unbilled addon rows for (tenantId, parentType, parentId) from
 * Supabase, writes one Billing_Ledger row per addon to the client sheet,
 * marks each addon billed=true with its ledger_row_id stamp.
 *
 * Idempotent: skips already-billed addons. Safe to re-call on retry.
 *
 * Ledger Row ID format:
 *   '{serviceCode}-{parentType}-{parentId}-ADDON-{n}'
 * where n is the 1-indexed position among unbilled addons for this parent.
 *
 * @return { written: int, skipped: int, errors: string[] }
 */
function api_writeAddonsToLedger_(ss, parentType, parentId, opts) {
  // Fetch unbilled addons via GET to /rest/v1/addons?... filtering on
  // tenant_id, parent_type, parent_id, billed=eq.false.
  // For each: append to Billing_Ledger sheet via api_buildRow_ + setValues.
  // Then PATCH addons rows to mark billed=true with the new ledger_row_id.
  // Return counts for the caller's response.
}
```

Wire into 4 completion handlers (one line each):

```js
// Inside handleCompleteTask_, after the primary task line write:
api_writeAddonsToLedger_(ss, 'task', taskId, { clientName, callerEmail });

// Inside handleProcessWcRelease_, after the WC items loop:
api_writeAddonsToLedger_(ss, 'will_call', wcNumber, { clientName, callerEmail });

// Inside handleCompleteRepair_, after primary repair line write:
api_writeAddonsToLedger_(ss, 'repair', repairId, { clientName, callerEmail });

// Inside handleReceiveItems_, after the receiving rows loop:
// Optional — receive flow already supports addons via a separate path.
// Decide whether to migrate to the unified model or leave receiving alone.
```

Bump version header to `v38.167.0` — note the addon module shipping.

### React — `useEntityAddons` hook

`stride-gs-app/src/hooks/useEntityAddons.ts`:

```tsx
export type EntityAddonParent = 'task' | 'repair' | 'will_call' | 'inventory';

export interface EntityAddon {
  id: string;
  serviceCode: string;
  serviceName: string;
  qty: number;
  rate: number;
  itemClass: string | null;
  total: number;
  addedBy: string;
  addedByName: string;
  billed: boolean;
  billedAt: string | null;
  createdAt: string;
}

export function useEntityAddons(
  parentType: EntityAddonParent,
  parentId: string,
  tenantId: string
): {
  addons: EntityAddon[];
  loading: boolean;
  add: (input: { serviceCode: string; qty?: number; rate?: number; itemClass?: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
} {
  // Supabase select on addons filtered by (tenant_id, parent_type, parent_id)
  // Realtime subscription to the same filter
  // add() inserts a row (auto-derives total from qty * rate)
  // remove() deletes the row (only if not yet billed)
}
```

### React — `<AddonsBlock>` component

`stride-gs-app/src/components/shared/AddonsBlock.tsx`:

```tsx
interface AddonsBlockProps {
  parentType: EntityAddonParent;
  parentId: string;
  tenantId: string;
  itemClass?: string;        // for rate lookup
  visible: boolean;          // gate to staff/admin
}

export function AddonsBlock({ parentType, parentId, tenantId, itemClass, visible }: AddonsBlockProps) {
  // Renders:
  //   - List of existing addons (service name, qty, rate, total, billed badge)
  //   - "+ Add addon" picker (filtered to active services, excludes the
  //     primary svc code for this entity type)
  //   - Remove button per row (disabled if billed=true)
  // Auto-saves on add/remove. Realtime updates from useEntityAddons.
}
```

### React — wire into BillingPreviewCard

Replace line 211:
```tsx
const projectedAddons = useMemo(
  () => (entityType === 'task' && addons) ? addons : [],
  [entityType, addons],
);
```

With:
```tsx
// Lift task-only restriction. addons prop now comes from useEntityAddons
// for any supported entity type.
const projectedAddons = useMemo(() => addons || [], [addons]);
```

Update `primaryAlreadyBooked` for `will_call` to also check `shipment_number === entityId`. (PR #236 already did this for the recorded query, the check inside primaryAlreadyBooked should follow the same pattern.)

### React — wire into entity panels

In each panel, import `AddonsBlock` and render it next to or above `BillingPreviewCard`:

```tsx
<AddonsBlock parentType="will_call" parentId={wc.wcNumber} tenantId={clientSheetId || ''} visible={canRelease} />
<BillingPreviewCard
  entityType="will_call"
  entityId={wc.wcNumber}
  tenantId={clientSheetId || ''}
  svcCode="WC"
  itemClass={null}
  visible={canRelease}
  // NEW: pass the same addons data to BillingPreviewCard so it shows projected
  addons={addonsFromHook}
/>
```

(Or have `BillingPreviewCard` itself call `useEntityAddons` internally — cleaner, no prop drilling.)

### Verification flow

After deploy:

1. Open a Will Call detail panel → AddonsBlock visible → add a "Rush Release" addon → row appears with `billed=false`.
2. Click Release → handleProcessWcRelease_ writes WC items + calls `api_writeAddonsToLedger_` → addon row gets a Billing_Ledger entry → `billed=true` flips.
3. Re-open the WC → AddonsBlock shows the addon with a "Billed" badge → BillingPreviewCard's "Recorded" section now includes the addon row.
4. Same flow for a Task, Repair, or Item.

### Estimated scope

Half-day. Same shape as today's task_addons (which works) but generalized.

---

## 7. Operational gotchas to be aware of

- **Always use a worktree.** Never edit `C:\dev\Stride-GS-app` directly when other agents could be active. Per CLAUDE.md.
- **Commit early, commit often.** `npm run deploy` does `git add -A` on the parent repo — uncommitted edits get swept.
- **The deploy chain:** for GAS — `npm run push-api && npm run deploy-api` from `AppScripts/stride-client-inventory/`. For React — `npm run deploy -- "msg"` from `stride-gs-app/`. Schema migrations apply via MCP.
- **The build script blocks on tsc errors.** Run `node node_modules/typescript/lib/tsc.js --noEmit` before `npm run build` to catch them faster.
- **Edge functions** deploy via MCP `deploy_edge_function`. Service-role functions should keep `verify_jwt=true` — service role tokens are valid JWTs.
- **The cron service-role key** is in `cron.job.command` — do not echo it back to the user or paste it anywhere.

---

## 8. If something breaks

The full session conversation has the diagnostic context for any of today's PRs. Key debugging entry points:

- WC ledger issues → check `Coverage Audit` tab on the Billing page (PR #230). Filter to `MISSING` events.
- Silent skip suspicions → query `stax_run_log` for rows fired by `sbLogBlankIdSkips_` (PR #229).
- Intake form not loading values for existing client → `fetchRefreshPrefill` in `useClientIntake.ts`.
- Reminder cron not firing → check `cron.job_run_details` for jobid=2.
- Apply Refresh button still showing wrong modal → check `apiClients` is populated; if missing, it falls back to create mode.

Good luck. Justin's been a great collaborator today; just keep showing him diffs, asking before destructive operations, and matching the Stride voice in user-facing copy.
