# Phase 5 Stripe CLI Validation Checklist

Last updated: 2026-02-14  
Applies to decisions: `DL-2026-02-14-051` through `DL-2026-02-14-062`  
Goal: collect deploy-time evidence before moving accepted decisions to `locked`

## 1) Preconditions

Complete these first:

1. Database migration applied:
   - `supabase/migrations/20260213160000_saas_phase5_v3_stripe_subscription.sql`
2. Edge functions deployed:
   - `stripe-webhook` (no JWT verify)
   - `create-stripe-checkout-session` (JWT verify enabled)
   - `create-stripe-portal-session` (JWT verify enabled)
3. Required env vars configured:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_URL` (used for Stripe portal return URL)
4. Test tenant/user available with known `tenant_id`
5. Stripe test mode enabled

## 2) Deploy commands (reference)

```bash
# Stripe webhook accepts Stripe-origin requests directly
supabase functions deploy stripe-webhook --no-verify-jwt

# Portal session function is app-authenticated (keep JWT verification)
supabase functions deploy create-stripe-portal-session
```

## 3) Stripe CLI forwarding setup

```bash
stripe login

# Forward events to deployed webhook
stripe listen --forward-to "https://<project-ref>.functions.supabase.co/stripe-webhook"
```

Copy the emitted signing secret into `STRIPE_WEBHOOK_SECRET`.

## 4) Validation matrix

## A. Checkout bootstrap mapping

### Trigger
- From Billing page, click `Start Subscription` for a tenant with no subscription row.
- Confirm the checkout session includes:
  - `metadata.tenant_id=<tenant-uuid>`

### Expected results
1. `checkout.session.completed` processed successfully
2. `tenant_subscriptions` row exists for tenant
3. Stripe IDs populated:
   - `stripe_customer_id`
   - `stripe_subscription_id`
4. Status is `active`

### Evidence SQL
```sql
select tenant_id, stripe_customer_id, stripe_subscription_id, status, grace_until, updated_at
from public.tenant_subscriptions
where tenant_id = '<tenant-uuid>';
```

## B. Payment failure enforcement (immediate block at past_due)

### Trigger
- Trigger payment failure in Stripe test mode for the tenant subscription
  - (realistic path preferred: test card/payment method scenarios)

### Expected results
1. Webhook receives `invoice.payment_failed`
2. `tenant_subscriptions.status = 'past_due'`
3. `grace_until` set (7-day window)
4. Logged-in users are redirected to `/subscription/update-payment`
5. `/subscription/update-payment` auto-launches Stripe Customer Portal
6. Page keeps polling and offers manual “Check status now”

### Evidence SQL
```sql
select tenant_id, status, last_payment_failed_at, grace_until, updated_at
from public.tenant_subscriptions
where tenant_id = '<tenant-uuid>';
```

## C. Payment recovery unlock

### Trigger
- In Stripe Customer Portal, update payment details and complete recovery
- Ensure Stripe emits success lifecycle events (for example `invoice.paid`)

### Expected results
1. Webhook receives paid/recovery event
2. `tenant_subscriptions.status = 'active'`
3. `grace_until` and `last_payment_failed_at` cleared
4. App access is restored (redirect exits blocked flow)

### Evidence SQL
```sql
select tenant_id, status, last_payment_failed_at, grace_until, updated_at
from public.tenant_subscriptions
where tenant_id = '<tenant-uuid>';
```

## D. subscription.updated mapping fallback

### Trigger
- Send `customer.subscription.updated` for a mapped subscription/customer

### Expected results
1. Tenant resolves by `stripe_customer_id` first (fallback to subscription ID if needed)
2. Webhook logs include resolution path
3. Upsert remains idempotent and status updates correctly

## E. Idempotency replay safety

### Trigger
- Replay recent Stripe events (Stripe CLI or dashboard resend)

### Expected results
1. No duplicate-row corruption
2. State remains consistent after reprocessing identical events
3. Webhook returns 200 for handled/unknown events (400 only for signature failure)

## 5) App behavior checklist (manual)

- [ ] Internal user blocked state redirects to `/subscription/update-payment`
- [ ] Client portal user blocked state also redirects to `/subscription/update-payment`
- [ ] Allowlist behavior works while blocked:
  - [ ] `/auth`
  - [ ] `/subscription/update-payment`
  - [ ] logout/sign-out
  - [ ] support mailto
- [ ] `admin_dev` can open `/admin/stripe-ops` and view status snapshot + Stripe links

## 6) Evidence to attach before locking decisions

Collect and attach:

1. Stripe CLI log snippets (event type + response code)
2. SQL before/after snapshots of `tenant_subscriptions`
3. Short screen recording or screenshots:
   - blocked redirect at `past_due`
   - Stripe portal launch
   - unlock after recovery
4. Commit hashes already implementing flow:
   - `28b25dc`
   - `3f2b622`
   - `c4d5c66`

## 7) Post-validation ledger actions

After all checks pass:

1. Update `DL-2026-02-14-051` through `DL-2026-02-14-062` from `accepted` -> `locked`
2. Set `Locked at` date
3. Append `verified` events in:
   - `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md`

