# Phase 5 v3 Locked Decision Import

Imported: 2026-02-14  
Importer: builder  
Source document: `/home/ubuntu/.cursor/projects/workspace/uploads/Stride_SaaS_Authoritative_Implementation_Record_Phase5v3.pdf`

## Import policy

- This import is a direct extraction from the authoritative Phase 5 v3 record.
- Entries DL-2026-02-14-005 through DL-2026-02-14-050 are `locked`.
- If any locked entry must change, use a new superseding decision in `LOCKED_DECISION_LEDGER.md`.

---

## Governance and architecture (DL-005..DL-020)

| ID | Locked decision | Why | Implementation impact |
|---|---|---|---|
| DL-2026-02-14-005 | Builder prompts include phase + version tags (example: Phase 5 v3). | Prevent ambiguity across iterative builder runs. | Prompt templates and execution handoffs include explicit phase/version. |
| DL-2026-02-14-006 | Builder prompts follow NVPC and include execution summary in one code block. | Keeps deterministic implementation and auditability. | Prompt artifacts and output format constraints are standardized. |
| DL-2026-02-14-007 | No prior SaaS/Stripe implementation existed in this codebase before Phase 5. | Establishes migration baseline and avoids hidden dependencies. | Treat migration/function additions as first source-of-truth artifacts. |
| DL-2026-02-14-008 | Do not use `super_admin` for RLS; use `public.current_user_is_admin_dev()`. | Aligns with current role model and existing helpers. | RLS write policy uses helper function gate. |
| DL-2026-02-14-009 | Use `public.user_tenant_id()` for tenant resolver standard. | Maintains one consistent tenant-derivation mechanism. | New RPC/RLS work resolves tenant via helper, not client payloads. |
| DL-2026-02-14-010 | Routing remains in `src/App.tsx`; do not create `src/routes/`. | Matches current codebase architecture. | All gate route wrapping changes remain in App routes. |
| DL-2026-02-14-011 | `saas_plans` is global and has no `tenant_id`. | Plan catalog is tenant-agnostic governance data. | Schema/RLS must not attempt tenant scoping for this table. |
| DL-2026-02-14-012 | Stripe webhook is server-to-server only; no CORS headers and no OPTIONS handler. | Browser CORS behavior is irrelevant for Stripe callbacks. | Edge function handles POST only; no preflight logic. |
| DL-2026-02-14-013 | First tenant subscription mapping is bootstrapped via `checkout.session.completed` metadata. | Ensures initial tenant-to-Stripe mapping exists. | Webhook initializes `tenant_subscriptions` from checkout metadata. |
| DL-2026-02-14-014 | Checkout session creation must include `metadata.tenant_id`; missing value logs and returns 200. | Prevents hard webhook failures while preserving observability. | Webhook validates metadata and safely no-ops when absent. |
| DL-2026-02-14-015 | All webhook handlers must be idempotent; writes use UPSERT/SET-only semantics. | Stripe replay tolerance and state safety. | RPC/database logic avoids non-idempotent transitions. |
| DL-2026-02-14-016 | Service-role-only RPCs use REVOKE/GRANT hardening (no PUBLIC/authenticated execute). | Enforces mutation isolation. | SQL grants follow explicit service-role-only pattern. |
| DL-2026-02-14-017 | Gate logic is fail-open when no `tenant_subscriptions` row exists. | Avoids accidental lockout before checkout flow is complete. | Gate RPC returns active when row is missing. |
| DL-2026-02-14-018 | Do not modify `ProtectedRoute`; only wrap specified routes with `SubscriptionGate`. | Limits blast radius and preserves existing auth behavior. | Route-level wrappers applied to target paths only. |
| DL-2026-02-14-019 | Client portal shipment creation routes are gated the same as internal routes. | Subscription applies at tenant level, not user surface. | Add gate wrapper to client creation pages too. |
| DL-2026-02-14-020 | Required rollout sequence: merge -> migration -> webhook/env -> Stripe CLI tests. | Prevents webhook calls to missing schema/RPCs. | Deployment checklist enforces schema-first release order. |

---

## Core safety and business constraints (DL-021..DL-027)

| ID | Locked decision | Why | Implementation impact |
|---|---|---|---|
| DL-2026-02-14-021 | Billing parity lock: Phase 5 does not modify billing events/invoices/pricing/storage logic/triggers. | Prevent regressions in revenue-critical subsystem. | Keep billing code untouched during SaaS automation work. |
| DL-2026-02-14-022 | Pricing remains database-driven and Stripe-controlled; no hardcoded plan pricing logic. | Ensures admin-managed pricing and Stripe parity. | UI/backend use stored plan data and Stripe status, not constants. |
| DL-2026-02-14-023 | Stripe is source of truth for subscription lifecycle state. | Centralized subscription authority. | Webhook events drive status transitions. |
| DL-2026-02-14-024 | Enforcement policy: active => full access; payment failure => 7-day grace; after grace => restrict receiving/outbound/create routes without deleting data. | Balances continuity with enforcement. | Gate logic and messaging must follow this lifecycle. |
| DL-2026-02-14-025 | Never trust client `tenant_id`; derive from auth via `user_tenant_id()`. | Multi-tenant isolation safety. | RLS and authenticated RPCs use auth-derived tenant resolution. |
| DL-2026-02-14-026 | `tenant_subscriptions` enforces tenant read isolation and blocks client writes. | Prevents tenant-side tampering with subscription state. | RLS includes SELECT policy only for authenticated tenant self-read. |
| DL-2026-02-14-027 | Webhook must verify Stripe signature before processing; invalid signatures return 400. | Authenticity and replay safety boundary. | Signature verification is first step in handler pipeline. |

---

## Database and permission model (DL-028..DL-034)

| ID | Locked decision | Why | Implementation impact |
|---|---|---|---|
| DL-2026-02-14-028 | Create `public.saas_plans` with global plan fields, `is_active` index, and `updated_at` trigger. | Establishes global plan catalog governance. | Migration adds table + index + trigger. |
| DL-2026-02-14-029 | Create `public.tenant_subscriptions` with Stripe IDs, status/grace fields, optional overrides, and indexes. | Establishes tenant subscription enforcement record. | Migration adds table + indexes + trigger. |
| DL-2026-02-14-030 | `saas_plans` RLS SELECT allows authenticated users to read active plans only. | Prevents exposure of inactive plan options. | Policy condition: `is_active = true`. |
| DL-2026-02-14-031 | `saas_plans` writes are restricted to admin-dev helper check. | Limits plan governance writes to authorized users. | FOR ALL policy uses `current_user_is_admin_dev()`. |
| DL-2026-02-14-032 | `tenant_subscriptions` SELECT policy allows only own tenant row. | Tenant isolation. | Policy condition: `tenant_id = user_tenant_id()`. |
| DL-2026-02-14-033 | `rpc_get_my_subscription_gate()` is callable by authenticated users only. | Controlled read path for gate state. | REVOKE PUBLIC + GRANT authenticated execute. |
| DL-2026-02-14-034 | Mutation RPCs are callable by `service_role` only. | Webhook-only mutation authority. | REVOKE PUBLIC/authenticated + GRANT service_role execute. |

---

## Status model and RPC logic (DL-035..DL-041)

| ID | Locked decision | Why | Implementation impact |
|---|---|---|---|
| DL-2026-02-14-035 | Status values: `active`, `past_due`, `canceled`, `inactive`; trialing is treated as active. | Normalized lifecycle vocabulary. | Stripe-to-internal status mapping is explicit. |
| DL-2026-02-14-036 | Grace formula is exact: `grace_until = now() + interval '7 days'`. | Deterministic enforcement window. | RPC logic uses exact interval expression. |
| DL-2026-02-14-037 | `rpc_get_my_subscription_gate()` returns `is_active`, `is_in_grace`, `is_restricted`, `grace_until`, `status` with fail-open ordering. | Central gate evaluation contract for UI. | Hook and route wrappers consume consistent response schema. |
| DL-2026-02-14-038 | `rpc_initialize_tenant_subscription_from_checkout(...)` is service-role bootstrap UPSERT and idempotent. | First-write safety during checkout completion. | Webhook initializes/refreshes tenant mapping safely. |
| DL-2026-02-14-039 | `rpc_upsert_tenant_subscription_from_stripe(...)` is service-role lifecycle UPSERT and idempotent. | Replay-safe status synchronization. | Webhook uses upsert RPC for update/delete lifecycle events. |
| DL-2026-02-14-040 | `rpc_mark_payment_failed_and_start_grace(...)` sets `past_due`, stamps failure time, and sets grace window. | Consistent failure-to-grace transition. | Invoice failure event calls this mutation path. |
| DL-2026-02-14-041 | `rpc_mark_payment_ok(...)` clears failure/grace and sets status active. | Recovery path after successful payment. | Invoice paid event calls this mutation path. |

---

## Webhook behavior and event handling (DL-042..DL-045)

| ID | Locked decision | Why | Implementation impact |
|---|---|---|---|
| DL-2026-02-14-042 | Handled Stripe events are fixed (`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`); unknown events log and return 200. | Robust event intake without unnecessary retries on unknown types. | Switch handler logs default and returns success response. |
| DL-2026-02-14-043 | `checkout.session.completed` reads `metadata.tenant_id`, validates tenant, and bootstraps row; missing mapping logs and returns 200. | Safe bootstrap with non-fatal metadata gaps. | Checkout handler performs validation and guarded RPC call. |
| DL-2026-02-14-044 | `invoice.paid` clears grace/sets active, and `invoice.payment_failed` starts grace through service-role RPCs. | Explicit payment-state transitions. | Invoice event handlers invoke mark-ok / mark-failed RPCs. |
| DL-2026-02-14-045 | `customer.subscription.updated/deleted` resolve tenant mapping and upsert mapped status. | Keeps status synchronized with Stripe lifecycle updates. | Subscription event handlers perform lookup + upsert mutation. |

---

## UI gate behavior (DL-046..DL-050)

| ID | Locked decision | Why | Implementation impact |
|---|---|---|---|
| DL-2026-02-14-046 | Render `SubscriptionBlockedBanner` globally in authenticated shell above Routes. | Persistent subscription-state visibility. | App shell placement required in provider tree with auth access. |
| DL-2026-02-14-047 | Banner text is fixed by gate state: restricted vs in-grace messaging. | Consistent user-facing enforcement communication. | Banner component renders deterministic state-based copy. |
| DL-2026-02-14-048 | `SubscriptionGate` wrapper blocks restricted routes and prevents route-level action execution. | Enforces subscription access at operational entry points. | Target route elements wrap with gate component. |
| DL-2026-02-14-049 | `useSubscriptionGate` uses React Query key `['subscription-gate']`, staleTime 5 min, refetchOnWindowFocus true, and RPC data source. | Stable and efficient client gate refresh behavior. | Hook configuration is constrained to these settings. |
| DL-2026-02-14-050 | Exact gated routes include receiving/creation paths across internal and client portal flows. | Scope-limited enforcement and no whole-app lockout. | Route list: `/incoming`, `/incoming/dock-intake/:id`, `/shipments/new`, `/shipments/create`, `/shipments/return/new`, `/shipments/outbound/new`, `/client/shipments/new`, `/client/shipments/outbound/new`. |

---

## Notes for future supersession

- Any deviation from these locked entries requires a new decision record that references `supersedes`.
- Do not mutate the body text of locked entries in this import file.

