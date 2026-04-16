# Phase 5 SaaS Continuation Plan (Q&A Driven)

Last updated: 2026-02-14  
Primary source of truth: `docs/LOCKED_DECISION_LEDGER.md` + `docs/LOCKED_DECISION_LEDGER_PHASE5V3_IMPORT.md`

## Scope

Continue Phase 5 SaaS subscription automation using locked decisions and one-question-at-a-time clarification.
Current superseding direction: `DL-2026-02-14-051` (accepted) shifts from route-level gating to app-level restriction with payment-update redirect.
Redirect timing decision captured: `DL-2026-02-14-052` (accepted) starts redirect at `past_due` during grace.
Recovery UX decision captured: `DL-2026-02-14-053` (accepted) requires auto-check polling plus manual status refresh on blocked page.
Blocked destination route decision captured: `DL-2026-02-14-054` (accepted) sets path to `/subscription/update-payment`.
Ops visibility decision captured: `DL-2026-02-14-055` (accepted) adds a minimal `admin_dev` Stripe observability page with no credential editing.
Blocked-state allowlist captured: `DL-2026-02-14-056` (accepted) keeps auth/payment-update/logout/help-support reachable.
RPC identity decision captured: `DL-2026-02-14-057` (accepted) standardizes payment mutation on `stripe_subscription_id`.
Webhook lookup decision captured: `DL-2026-02-14-058` (accepted) uses `customer_id` fallback to `subscription_id` for `subscription.updated`.
Portal launch decision captured: `DL-2026-02-14-059` (accepted) auto-opens Stripe Customer Portal from `/subscription/update-payment`.
Shared destination decision captured: `DL-2026-02-14-060` (accepted) applies the same blocked route to `/client/*` and internal users.
Security boundary decision captured: `DL-2026-02-14-061` (accepted) keeps payment data entry Stripe-hosted, not in-app.
Support-channel decision captured: `DL-2026-02-14-062` (accepted) uses external mailto support from blocked flow.
Release-governance decision captured: `DL-2026-02-14-063` (accepted) keeps DL-051..DL-062 accepted until post-deploy Stripe CLI validation.
Authoritative outstanding item from the source record: **Phase 5.1 checkout session creator** that sets `metadata.tenant_id`.
Checkout-trigger decision captured: `DL-2026-02-14-064` (accepted) places trigger on Billing page with dynamic Start/Manage label.
Pricing-model decision captured: `DL-2026-02-14-065` (accepted) keeps one base plan and adds optional SMS add-on track.
SMS onboarding decision captured: `DL-2026-02-14-066` (accepted) activates SMS post-checkout in Settings with form + terms.
Billing visibility decision captured: `DL-2026-02-14-067` (accepted) requires subscription + SMS status visibility in Billing page.
SMS terms audit decision captured: `DL-2026-02-14-068` (accepted) requires version/time/user/ip/user-agent/source capture.
SMS lifecycle control decision captured: `DL-2026-02-14-069` (accepted) allows tenant-admin self-deactivation in Settings.
Historical visibility decision captured: `DL-2026-02-14-070` (accepted) keeps SMS billing/report history visible as read-only after deactivation.
Reactivation consent decision captured: `DL-2026-02-14-089` (accepted) requires terms re-acceptance on every SMS reactivation.
Terms-version backlog decision captured: `DL-2026-02-14-090` (accepted) keeps `sms-addon-v1` for now and defers configurable versioning to Phase 6.

## Current implementation snapshot

Confirmed present in repo:

- Migration: `supabase/migrations/20260213160000_saas_phase5_v3_stripe_subscription.sql`
- Migration: `supabase/migrations/20260215013000_saas_sms_addon_activation.sql`
- Webhook: `supabase/functions/stripe-webhook/index.ts`
- Checkout creator (Phase 5.1): `supabase/functions/create-stripe-checkout-session/index.ts`
- Portal creator: `supabase/functions/create-stripe-portal-session/index.ts`
- Gate hook: `src/hooks/useSubscriptionGate.ts`
- SMS activation hook: `src/hooks/useSmsAddonActivation.ts`
- Gate components: `src/components/subscription/SubscriptionGate.tsx`, `SubscriptionBlockedBanner.tsx`
- SMS activation UI: `src/components/settings/SmsAddonActivationCard.tsx`
- Route wiring: `src/App.tsx`
- Billing trigger: `src/pages/Billing.tsx` (dynamic Start/Manage subscription button)

## Decision-to-code alignment check (initial)

| Area | Locked decision reference | Current status | Evidence |
|---|---|---|---|
| Route-level gating list (`/incoming` and create-only paths) | DL-2026-02-14-050 | superseded | Superseded by DL-051 full-app redirect model |
| Global banner above routes | DL-2026-02-14-046 | superseded | Superseded by blocked destination page flow |
| invoice events identity | DL-2026-02-14-044 + DL-2026-02-14-057 | aligned | Webhook invoice handlers mutate via `stripe_subscription_id` |
| subscription.updated resolution fallback customer->subscription | DL-2026-02-14-058 | aligned | `stripe-webhook` now resolves customer first, then subscription fallback |
| Payment mark RPC identity contract | DL-2026-02-14-057 | aligned | Migration + webhook use `p_stripe_subscription_id` |
| SMS terms acceptance audit fields | DL-2026-02-14-068 | aligned | New SMS activation migration + RPC capture required terms evidence fields |
| SMS reactivation terms re-acceptance | DL-2026-02-14-089 | aligned | Settings activation flow requires terms checkbox each activation attempt and records fresh acceptance timestamp |
| Settings-based SMS activation flow | DL-2026-02-14-066 | aligned | `SmsAddonActivationCard` enforces readiness + explicit terms confirmation |
| Billing SMS visibility summary | DL-2026-02-14-067 | aligned | Billing page now includes consolidated subscription + SMS add-on summary card |
| Fail-open gate behavior when row missing | DL-2026-02-14-017/037 | aligned | `rpc_get_my_subscription_gate` returns active state when row not found |
| RLS and service-role grant pattern | DL-2026-02-14-030..034 | aligned | Migration includes expected policy and grant pattern |

## Planned continuation sequence

1. **Deploy new edge functions** `create-stripe-checkout-session` and `create-stripe-portal-session` with env vars (`STRIPE_SECRET_KEY`, `APP_URL`).
2. **Deploy updated stripe-webhook** and verify event mapping behavior in environment.
3. **Run Stripe CLI integration tests** (checkout bootstrap + payment failed -> blocked redirect + payment fixed -> unlock recovery).
4. **Lock accepted decisions DL-051..DL-062** after deployment verification.
5. **Log final verification evidence** in `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md`.

Current cloud-runner blocker:
- Supabase deploy commands require `SUPABASE_ACCESS_TOKEN` (management API auth), which is not present in this runtime session.
- Execution can resume immediately once token-based CLI auth is available.

## Deferred to Phase 6 backlog

- `DL-2026-02-14-090`: Admin-dev configurable SMS `terms_version` management (current state remains fixed at `sms-addon-v1`).

Execution checklist:
- `docs/PHASE5_STRIPE_CLI_VALIDATION_CHECKLIST.md`
- `docs/PHASE5_DEPLOYMENT_COMMAND_SCRIPT.md`
- `scripts/phase5_validate.sh`

## Q&A protocol (one question at a time)

For each unresolved item:

1. Ask one focused question.
2. Capture answer as either:
   - implementation decision (accepted/locked), or
   - superseding decision if it modifies existing locked decisions.
3. Update ledger and implementation log in same commit.

## Open questions queue (ask serially)

1. For Phase 6 configurable terms versioning, do we need a draft/publish workflow or a simple single-value update with audit log?

