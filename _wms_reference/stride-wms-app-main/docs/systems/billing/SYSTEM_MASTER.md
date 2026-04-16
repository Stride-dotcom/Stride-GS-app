# SYSTEM_MASTER — BILLING & PRICING ENGINE

> SALA v1.2  
> Role: Lead Systems Architect  
> Doc Version: 1.1.0  
> Last Updated: 2026-02-27  
> Change Log: 1.1.0 — Re-baselined to SALA Phase 13 DR-1..DR-16 evidence model (static inspection only).

## Scope Guardrails
- Static repository inspection only (no runtime verification).  
- Evidence precedence applied: `DB migration > SQL constraint > generated types.ts > backend constant > UI literal`.  
- Any unverifiable runtime outcome is labeled `[Unverified]`; structural concerns are labeled `[Risk]`.

## Repository / Build Awareness
- Build stack is Vite + React + TypeScript with Supabase client, matching billing UI/services architecture. Evidence: `package.json` scripts/deps, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`. (Confirmed)
- Billing routing is explicitly wired in `src/App.tsx` at `/billing/invoices` and `/billing/promo-codes`. (Confirmed)
- Generated DB surface includes `account_credits`, `billing_events`, `invoice_lines`, `invoices`, `service_events`, plus billing RPCs `apply_credit_to_invoice`, `generate_storage_for_date`, `mark_invoice_paid` in `src/integrations/supabase/types.ts`. (Confirmed)
- Prompt-named `services`/`service_rates` tables were not found; repository uses `service_events` as service catalog/price list source. (Confirmed + [Risk] terminology mismatch)

---

## DR-1 FUNCTIONAL SCOPE
- Billing engine covers event capture (`billing_events`), invoice assembly (`invoices`, `invoice_lines`), storage automation (`generate_storage_for_date`), credit application (`apply_credit_to_invoice`), and payment posting (`mark_invoice_paid`). (Confirmed)
- Cross-system touchpoints are visible in code paths: Tasks (`useTasks.ts`), Shipments (`billingCalculation.ts`), Claims (`useClaims.ts` + claims credit migration), Inventory/storage (`generate_storage_for_date`). (Confirmed)
- Non-goals observed: provider internals (Stripe dashboard) are not represented in repo except integration boundaries. (Confirmed)

Evidence:
- `supabase/migrations/20260118132652_499d4eb1-a88b-4731-964a-3362638971fe.sql` (`CREATE TABLE public.billing_events`).
- `supabase/migrations/20260124044004_453dfddc-767a-4298-b662-fda6ce66a0df.sql` (`CREATE TABLE public.invoices`, `invoice_lines`, `generate_storage_for_date`).
- `supabase/migrations/20260125160000_claims_credits_invoices.sql` (`apply_credit_to_invoice`, `mark_invoice_paid`).

## DR-2 SERVICE CATALOG MODEL
- Authoritative catalog is `public.service_events` (not `services/service_rates`), with class-based (`uses_class_pricing=true` + class rows) and flat-rate (`class_code IS NULL`) support. (Confirmed)
- Activation/inactivation exists via `is_active` boolean; add-flag/add-to-scan and trigger model live in same table (`add_flag`, `add_to_service_event_scan`, `billing_trigger`). (Confirmed)
- Tenant overrides are handled through account-level pricing adjustment logic in app layer (`useAccountPricing.ts`) rather than separate `service_rates` table. (Confirmed)
- Hard DB enforcement for “one default service charge type must exist” was not found. ([Risk])

Evidence:
- `supabase/migrations/20260126000000_service_events_pricing.sql` (`CREATE TABLE public.service_events`, `UNIQUE(tenant_id,class_code,service_code)`, RLS policy).
- `src/lib/billing/billingCalculation.ts` (`getRateByCategoryAndClass` fallback chain).
- `src/hooks/useTasks.ts` (`primary_service_code || default_service_code` usage).

## DR-3 BILLING EVENT MODEL
- `billing_events` has linkage fields (`account_id`, `item_id`, `task_id`, later `shipment_id`,`claim_id`,`sidemark_id` in evolved schema via generated types and subsequent migrations). (Confirmed)
- `event_type` enumeration is DB-constrained via `billing_events_event_type_check`; includes `task_completion`, `flag_change`, `coverage`, etc. (Confirmed)
- Duplicate prevention/idempotency is partial: storage path includes day-level `NOT EXISTS` guard and rollup uniqueness; broad global idempotency key was not found on `billing_events`. ([Partial] + [Risk])
- RLS exists on `billing_events` with tenant filter policies. (Confirmed)

Evidence:
- `supabase/migrations/20260118132652_499d4eb1-a88b-4731-964a-3362638971fe.sql` (table + RLS policy creation).
- `supabase/migrations/20260203053225_ac453f66-d09d-4619-904a-8e350f3960d2.sql` (latest `event_type` check).
- `supabase/migrations/20260124044004_453dfddc-767a-4298-b662-fda6ce66a0df.sql` (`generate_storage_for_date` duplicate guard).

## DR-4 EVENT CREATION PATHS
- `createTaskBillingEvents()` exists and emits `task_completion` charges using pricing lookup and task/class context. (Confirmed)
- `createServiceLineBillingEvents()` exists and emits service-line charges from completion values. (Confirmed)
- `convertTaskCustomChargesToBillingEvents()` exists and emits non-service-line custom charges as `addon`. (Confirmed)
- Shipment billing preview path exists via `calculateShipmentBillingPreview()`. (Confirmed)
- Direct insert paths exist outside a strict gateway (e.g., migrations/functions, some hook writes), so gateway pattern is not universally enforced. ([Risk])

Evidence:
- `src/hooks/useTasks.ts` (`createTaskBillingEvents`, `createServiceLineBillingEvents`, `convertTaskCustomChargesToBillingEvents`).
- `src/lib/billing/billingCalculation.ts` (`calculateShipmentBillingPreview`).
- `src/services/billing/billingGateway.ts` (gateway exists but not sole write path).

## DR-5 INVOICE GENERATION
- Invoice creation is application-driven (hook) rather than DB trigger: inserts `invoices`, then `invoice_lines`, then marks `billing_events` as invoiced. (Confirmed)
- Status transitions include at least `draft → sent` and `void` handling with event rollback to `unbilled`. (Confirmed)
- Credit application uses RPC `apply_credit_to_invoice`; manual payment uses `mark_invoice_paid` with partial/paid state logic. (Confirmed)
- Partial payment supported in function logic (`payment_status` transitions to `partial`). (Confirmed)

Evidence:
- `src/hooks/useInvoices.ts` (invoice draft create, line insert, billing_event update, void flow).
- `supabase/migrations/20260125160000_claims_credits_invoices.sql` (`apply_credit_to_invoice`, `mark_invoice_paid`, invoice payment fields).

## DR-6 STORAGE BILLING LOGIC
- Storage generation function computes daily charges using received/released dates, free-day threshold, and inserts only when date-eligible. (Confirmed)
- Duplicate prevention is explicit for same item/day (`NOT EXISTS` + rollup uniqueness). (Confirmed)
- Reopen and same-day edge handling beyond static predicates cannot be fully proven from current function alone. ([Unverified])

Evidence:
- `supabase/migrations/20260124044004_453dfddc-767a-4298-b662-fda6ce66a0df.sql` (`generate_storage_for_date`).
- `supabase/migrations/20260130120000_fix_storage_function_use_class_id.sql` (class-based storage lookup revision).
- Cross-reference present: `docs/systems/inventory/SYSTEM_MASTER.md`. (Confirmed)

## DR-7 DEFAULT SERVICE CHARGE TYPES
- Default mapping uses task-type fields (`primary_service_code` with `default_service_code` fallback). (Confirmed)
- Override mechanism exists through account pricing and manual rate lock on tasks. (Confirmed)
- Inactive vs deleted behavior in catalog represented by `is_active`; hard delete paths exist in admin tooling. (Confirmed)
- DB-level guarantee that exactly one default exists per core feature was not found. ([Risk])

Evidence:
- `src/hooks/useTasks.ts` (service code resolution + manual override checks).
- `supabase/migrations/20260212120001_task_waive_charges.sql` (task/type billing columns).

## DR-8 TASK BILLING INTEGRATION
- Task completion path conditionally creates billing events unless `waive_charges=true`. (Confirmed)
- Service-line vs legacy fallback logic is explicit (`completionValues` drives service-line path; fallback to `createTaskBillingEvents`). (Confirmed)
- Waive asymmetry exists: waive gate applies in completion flow; manual generate path and non-task event creation may still occur elsewhere. ([Risk])

Evidence:
- `src/hooks/useTasks.ts` (waive check around completion and billing generation).
- Cross-reference present: `docs/systems/tasks/SYSTEM_MASTER.md`. (Confirmed)

## DR-9 SHIPMENT BILLING INTEGRATION
- Shipment preview uses direction→service mapping (`inbound: RCVG`, `outbound: Will_Call`, `return: Returns`) with pricing lookup and charge simulation. (Confirmed)
- Receiving/outbound preview invocations exist in shipment/receiving flows. (Confirmed)
- Manifest-specific billing logic not conclusively identified in inspected shipment preview function. ([Unverified])

Evidence:
- `src/lib/billing/billingCalculation.ts` (`SHIPMENT_DIRECTION_TO_SERVICE_CODE`, `calculateShipmentBillingPreview`).
- `src/pages/ShipmentDetail.tsx`, `src/components/receiving/Stage2DetailedReceiving.tsx`, `src/hooks/useReceivingSession.ts` (preview call sites).

## DR-10 CLAIMS BILLING INTEGRATION
- Claims credit issuance path exists with insert into `account_credits` in claim workflows. (Confirmed)
- Claim-related event mapping exists in `event_type` allowed values (`claim`) and coverage-related migration inserts. (Confirmed)
- Payout linkage to external payout provider/system not statically proven. ([Unverified])

Evidence:
- `src/hooks/useClaims.ts` (`from('account_credits').insert`).
- `supabase/migrations/20260125160000_claims_credits_invoices.sql` (credit + payment model).
- Cross-reference present: `docs/systems/claims/SYSTEM_MASTER.md`. (Confirmed)

## DR-11 COVERAGE / DECLARED VALUE BILLING
- Coverage billing creation paths exist in coverage RPC migration with direct `INSERT INTO public.billing_events`. (Confirmed)
- Declared value adjustments and related event links are implemented in migration-level option-A RPCs. (Confirmed)
- Full end-to-end runtime linkage into invoice lines depends on invoicing flow and is not fully statically guaranteed for all branches. ([Unverified])

Evidence:
- `supabase/migrations/20260225120100_coverage_option_a_rpcs.sql` (coverage inserts into `billing_events`).
- `src/integrations/supabase/types.ts` (coverage/billing function surfaces). 

## DR-12 STRIPE INTEGRATION SURFACE
- Stripe portal session edge function exists (`create-stripe-portal-session`) with auth, tenant lookup, and comped-tenant gating. (Confirmed)
- Checkout session and webhook handlers exist (`create-stripe-checkout-session`, `stripe-webhook`). (Confirmed)
- Tenant isolation is implemented through tenant resolution from user profile/mappings before updates; downstream Stripe behavior remains `[Unverified]`. (Confirmed + [Unverified])

Evidence:
- `supabase/functions/create-stripe-portal-session/index.ts`.
- `supabase/functions/create-stripe-checkout-session/index.ts`.
- `supabase/functions/stripe-webhook/index.ts`.

## DR-13 ACCOUNT CREDITS
- `account_credits` enhanced with lifecycle fields (`credit_type`, `status`, `balance_remaining`, void metadata). (Confirmed)
- Credit application modeled via `credit_applications` + `apply_credit_to_invoice` RPC; invoice payment ledger via `invoice_payments`. (Confirmed)
- Expiration/reversal rules are schema-permitted (`status='expired'`, void fields) but automated expiry job not found in inspected code. ([Unverified])

Evidence:
- `supabase/migrations/20260125160000_claims_credits_invoices.sql` (table extensions, constraints, RPCs).
- `src/integrations/supabase/types.ts` (`account_credits`, `apply_credit_to_invoice`).

## DR-14 TENANT ISOLATION (CRITICAL)
- `billing_events`, `invoices`, and `invoice_lines` each have tenant-scoped RLS policies in migrations. (Confirmed)
- App layer typically includes tenant filters or tenant-context inserts; however, full “no cross-tenant credit application” is not fully proven because RPCs rely on record lookups and SECURITY DEFINER functions without explicit tenant equality checks between credit/invoice inside function body. ([Risk])
- “No cross-tenant invoice visibility” is strongly indicated by RLS on invoice tables. (Confirmed)

Evidence:
- `supabase/migrations/20260118132652_499d4eb1-a88b-4731-964a-3362638971fe.sql` (billing_events RLS).
- `supabase/migrations/20260124044004_453dfddc-767a-4298-b662-fda6ce66a0df.sql` (invoices/invoice_lines RLS).
- `supabase/migrations/20260125160000_claims_credits_invoices.sql` (`apply_credit_to_invoice` body lacks explicit `v_credit.tenant_id = v_invoice.tenant_id` guard). ([Risk])

## DR-15 PERFORMANCE / IDEMPOTENCY
- Indexes exist for `billing_events` by item/task; invoices and invoice lines have practical indexes. (Confirmed)
- Storage generation includes idempotent duplicate check per item/day. (Confirmed)
- Broad idempotency keys/retry tokens for all billing-event producers not found. ([Risk])
- Potential N+1 patterns exist in hook-driven per-item/looped event generation and logging. ([Risk])

Evidence:
- `supabase/migrations/20260118132652_499d4eb1-a88b-4731-964a-3362638971fe.sql` (`idx_billing_events_item`, `idx_billing_events_task`).
- `supabase/migrations/20260124044004_453dfddc-767a-4298-b662-fda6ce66a0df.sql` (invoice indexes, storage duplicate guard).
- `src/hooks/useInvoices.ts`, `src/hooks/useTasks.ts` (loop-based writes).

## DR-16 CROSS-SYSTEM CONSISTENCY AUDIT
- Billing aligns with existing system masters for Shipments, Tasks, Claims, Inventory in repository. (Confirmed)
- Client Portal SYSTEM_MASTER counterpart is not present at `docs/systems/client-portal/SYSTEM_MASTER.md` in inspected tree. ([N/A])
- Any semantic mismatch across docs is `[Unverified]` without full diff audit of each section. ([Unverified])

Evidence:
- Present docs: `docs/systems/shipments/SYSTEM_MASTER.md`, `docs/systems/tasks/SYSTEM_MASTER.md`, `docs/systems/claims/SYSTEM_MASTER.md`, `docs/systems/inventory/SYSTEM_MASTER.md`.

---

## Completion Checklist (Mandatory)
- [x] DR-1 evidence complete
- [x] DR-2 evidence complete
- [x] DR-3 evidence complete
- [x] DR-4 evidence complete
- [x] DR-5 evidence complete
- [x] DR-6 evidence complete
- [x] DR-7 evidence complete
- [x] DR-8 evidence complete
- [x] DR-9 evidence complete
- [x] DR-10 evidence complete
- [x] DR-11 evidence complete
- [x] DR-12 evidence complete
- [x] DR-13 evidence complete
- [x] DR-14 evidence complete
- [x] DR-15 evidence complete
- [x] DR-16 evidence complete

```text
Execution Summary
- Updated /docs/systems/billing/SYSTEM_MASTER.md only; no other files modified.
- Reframed document to SALA Phase 13 DR-1..DR-16 structure with static-evidence labels.
- Applied authority hierarchy and called out terminology mismatch (`service_events` vs requested `services/service_rates`).
- Confirmed core billing data model: billing_events, invoices, invoice_lines, account_credits.
- Traced task billing creation paths: createTaskBillingEvents, createServiceLineBillingEvents, convertTaskCustomChargesToBillingEvents.
- Traced shipment preview billing path via calculateShipmentBillingPreview and receiving/shipment callers.
- Documented storage billing logic and duplicate guard in generate_storage_for_date.
- Documented invoice generation, void rollback behavior, credit apply, and manual payment RPC flow.
- Documented Stripe integration surface across checkout, portal, and webhook edge functions.
- Audited tenant isolation posture via RLS policies and highlighted SECURITY DEFINER cross-tenant guard risk in apply_credit_to_invoice.
- Noted absent hard DB enforcement for “one default service must exist” and missing global idempotency keys.
- Added DR checklist immediately before this summary per prompt requirements.
- Marked unknown runtime behaviors as [Unverified] and structural gaps as [Risk]/[N/A] only.
```
