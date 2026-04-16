# Phase 5 Deployment Command Script (Copy/Paste Order)

Last updated: 2026-02-14  
Use with: `docs/PHASE5_STRIPE_CLI_VALIDATION_CHECKLIST.md`

This is a practical deployment sequence for Phase 5 SaaS subscription enforcement.
Follow in order. Replace placeholders before running.

## Quick start (helper script)

```bash
bash scripts/phase5_validate.sh \
  --project-ref "<your-project-ref>" \
  --app-url "https://<your-app-domain>" \
  --stripe-secret-key "sk_test_..." \
  --stripe-webhook-secret "whsec_..." \
  --db-password "<remote-db-password>" \
  --tenant-id "<tenant-uuid>"
```

Use `--dry-run` first to preview commands.

## 0) Set placeholders (required)

```bash
# Required: set your values
export PROJECT_REF="<your-supabase-project-ref>"
export APP_URL="https://<your-app-domain>"
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."   # from stripe listen
export DB_PASSWORD="<remote-db-password>"  # optional but recommended for non-interactive db push
```

Optional:

```bash
export TENANT_ID="<tenant-uuid-for-validation>"
```

## 1) Verify branch + latest code

```bash
git branch --show-current
git pull origin cursor/locked-decision-ledger-cbef
```

Expected: on `cursor/locked-decision-ledger-cbef` with latest commits.

## 2) Apply database migration first

```bash
# Link to project first (required once per environment)
supabase link --project-ref "$PROJECT_REF"

# Push migrations (non-interactive if DB_PASSWORD is provided)
supabase db push --linked --password "$DB_PASSWORD"
```

If your org applies migrations through CI/CD, run your normal migration pipeline first.

## 3) Deploy edge functions

```bash
# Stripe webhook receives Stripe-origin requests directly (no JWT)
supabase functions deploy stripe-webhook --project-ref "$PROJECT_REF" --no-verify-jwt

# Checkout session creator for new subscribers (Phase 5.1)
supabase functions deploy create-stripe-checkout-session --project-ref "$PROJECT_REF"

# Portal session function is app-authenticated
supabase functions deploy create-stripe-portal-session --project-ref "$PROJECT_REF"
```

## 4) Set function secrets (env vars)

```bash
supabase secrets set \
  STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
  STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" \
  APP_URL="$APP_URL" \
  --project-ref "$PROJECT_REF"
```

## 5) Start Stripe event forwarding (validation session)

```bash
stripe login
stripe listen --forward-to "https://${PROJECT_REF}.functions.supabase.co/stripe-webhook"
```

Copy the printed `whsec_...` and update `STRIPE_WEBHOOK_SECRET` if needed.

If updated, re-run:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" --project-ref "$PROJECT_REF"
```

## 6) Trigger/validate core event flows

## A) Checkout bootstrap

Run your checkout creator with:
- `metadata.tenant_id=<TENANT_ID>`

Expected:
- `checkout.session.completed` arrives
- `tenant_subscriptions` row created/updated to `active`

## B) Payment failure -> blocked

Use Stripe test failure path (invoice/payment failure).

Expected:
- webhook gets `invoice.payment_failed`
- status -> `past_due`
- app redirects to `/subscription/update-payment`
- page auto-opens Stripe portal

## C) Recovery -> unlock

Update payment in Stripe portal and complete recovery.

Expected:
- webhook gets paid/recovery events
- status -> `active`
- grace fields cleared
- app unblocks

## D) Mapping fallback + replay safety

Trigger:
- `customer.subscription.updated`
- replay recent events

Expected:
- customer-first then subscription fallback mapping works
- no state corruption on replay

## 7) SQL spot checks (run in SQL editor)

```sql
select tenant_id, stripe_customer_id, stripe_subscription_id, status, grace_until, last_payment_failed_at, updated_at
from public.tenant_subscriptions
where tenant_id = '<TENANT_ID>';
```

## 8) Evidence capture checklist

- Stripe CLI logs (event type + HTTP response)
- SQL before/after snapshots
- short screen capture:
  - blocked redirect
  - portal launch
  - unlock after recovery
- commit references:
  - `28b25dc`
  - `3f2b622`
  - `c4d5c66`

## 9) After validation: lock accepted decisions

When all checks pass:
1. Move `DL-2026-02-14-051` through `DL-2026-02-14-062` to `locked`
2. Set `Locked at` date
3. Append `verified` events in `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md`

