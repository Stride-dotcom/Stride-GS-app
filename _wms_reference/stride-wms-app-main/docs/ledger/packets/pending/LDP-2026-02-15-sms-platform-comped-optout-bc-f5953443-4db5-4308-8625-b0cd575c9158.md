# Ledger Pending Packet

- Packet ID: `LDP-2026-02-15-sms-platform-comped-optout-bc-f5953443-4db5-4308-8625-b0cd575c9158`
- Date: `2026-02-15`
- Topic slug: `sms-platform-comped-optout`
- Chat ID: `bc-f5953443-4db5-4308-8625-b0cd575c9158`
- Source artifact:
  - `docs/ledger/sources/LOCKED_DECISION_SOURCE_SMS_PLATFORM_COMPED_OPTOUT_2026-02-15_chat-bc-f5953443-4db5-4308-8625-b0cd575c9158.md`

## Decision Index Rows

| Decision ID | Action | Title | State | Notes |
|---|---|---|---|---|
| DL-2026-02-14-073 | reference | SMS number provisioning and activation workflow must be fully automated | accepted | Existing decision implemented in this chat slice. |
| DL-2026-02-14-075 | reference | SMS remains disabled until toll-free verification is approved | accepted | Existing decision reinforced via sender flow + queue tooling. |
| DL-2026-02-14-076 | reference | SMS billing start trigger is verification approval timestamp | accepted | Existing decision reflected in sender lifecycle implementation. |
| DL-2026-02-14-078 | reference | Price-change notices send to company_email only | accepted | Existing decision updated with comped-tenant exclusion logic. |
| DL-2026-02-14-084 | reference | Public SMS opt-in page is tenant-branded and resolved by subdomain | accepted | Extended to explicit public web opt-out fork UX. |
| DL-2026-02-14-087 | reference | Internal comped billing override supports multiple internal tenants | accepted | Implemented with schema/RPC/admin UI and flow exclusions. |

## Detailed Decision Entries

### DL-2026-02-14-073 (reference)
- Existing accepted decision; no body change.
- Evidence in this packet: queue worker scaffold and admin bulk sender operations.

### DL-2026-02-14-075 (reference)
- Existing accepted decision; no body change.
- Evidence in this packet: sender queue controls preserve approved-state gating before operational enablement.

### DL-2026-02-14-076 (reference)
- Existing accepted decision; no body change.
- Evidence in this packet: sender lifecycle and billing-start behavior preserved.

### DL-2026-02-14-078 (reference)
- Existing accepted decision; no body change.
- Evidence in this packet: pricing notice send path excludes active comped tenants from targeting.

### DL-2026-02-14-084 (reference)
- Existing accepted decision; no body change.
- Evidence in this packet: `/sms` now presents explicit opt-in and opt-out forks; public opt-out form added.

### DL-2026-02-14-087 (reference)
- Existing accepted decision; no body change.
- Evidence in this packet: multi-tenant comped override controls, audit logs, and Stripe flow exclusions implemented.

## Implementation Log Rows

| Event ID | Date | Decision ID | Event Type | Evidence | Actor | Notes |
|---|---|---|---|---|---|---|
| DLE-2026-02-15-014 | 2026-02-15 | DL-2026-02-14-073,DL-2026-02-14-075 | completed | `supabase/functions/process-sms-sender-queue/index.ts` | builder | Added queue-worker scaffold for sender status transitions (`requested→provisioning`, `provisioning→pending_verification`). |
| DLE-2026-02-15-015 | 2026-02-15 | DL-2026-02-14-073,DL-2026-02-14-075,DL-2026-02-14-076 | completed | `src/hooks/useSmsSenderOpsAdmin.ts`, `src/pages/admin/SmsSenderOps.tsx` | builder | Added sender row selection, bulk updates, and queue-worker run controls in admin ops UI. |
| DLE-2026-02-15-016 | 2026-02-15 | DL-2026-02-14-087 | completed | `supabase/migrations/20260215073000_comped_billing_overrides.sql` | builder | Added tenant comped override state, audit log, admin RPCs, and subscription-gate bypass support. |
| DLE-2026-02-15-017 | 2026-02-15 | DL-2026-02-14-087,DL-2026-02-14-078 | completed | `supabase/functions/create-stripe-checkout-session/index.ts`, `supabase/functions/create-stripe-portal-session/index.ts`, `supabase/functions/send-pricing-update-notices/index.ts` | builder | Excluded active comped tenants from Stripe checkout/portal and pricing-notice billing targeting. |
| DLE-2026-02-15-018 | 2026-02-15 | DL-2026-02-14-087 | completed | `src/hooks/useBillingOverridesAdmin.ts`, `src/pages/admin/BillingOverridesOps.tsx`, `src/App.tsx` | builder | Implemented admin-dev multi-tenant comped override operations page with audit/history visibility. |
| DLE-2026-02-15-019 | 2026-02-15 | DL-2026-02-14-087 | completed | `src/hooks/useSubscriptionGate.ts`, `src/components/subscription/SubscriptionGate.tsx`, `src/pages/Billing.tsx` | builder | Surfaced comped status/expiry in tenant billing UX and blocked Stripe action button while comped. |
| DLE-2026-02-15-020 | 2026-02-15 | DL-2026-02-14-084 | completed | `src/pages/SmsOptOut.tsx`, `src/pages/SmsOptIn.tsx`, `src/PublicSmsOptInApp.tsx`, `src/main.tsx`, `src/App.tsx` | builder | Added public SMS opt-out page/routes and explicit opt-in/out navigation forks. |
| DLE-2026-02-15-021 | 2026-02-15 | DL-2026-02-14-084 | completed | `supabase/functions/sms-opt-in/index.ts` | builder | Extended public SMS function with `opt_out` action and unsubscribe consent logging. |
| DLE-2026-02-15-022 | 2026-02-15 | DL-2026-02-14-084 | completed | `src/pages/SmsInfoPage.tsx` | builder | Converted `/sms` into customer preference hub with explicit web opt-in and web opt-out entry points. |
