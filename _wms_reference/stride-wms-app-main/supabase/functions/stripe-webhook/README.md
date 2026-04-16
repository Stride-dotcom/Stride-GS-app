# Stripe Webhook — Stride SaaS Phase 5 v3

## Overview

Server-to-server Stripe webhook handler for subscription lifecycle management.
No CORS. No OPTIONS handler. Invoked only by Stripe.

## Required Environment Variables

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Webhook endpoint signing secret from Stripe Dashboard |
| `SUPABASE_URL` | Supabase project URL (auto-set in edge functions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (auto-set in edge functions) |

## Handled Events

| Stripe Event | Action |
|---|---|
| `checkout.session.completed` | Bootstrap tenant subscription from checkout metadata |
| `invoice.paid` | Mark subscription active, clear grace period |
| `invoice.payment_failed` | Mark past_due, start 7-day grace period |
| `customer.subscription.updated` | Upsert subscription status/period |
| `customer.subscription.deleted` | Set subscription to canceled |

## Checkout Metadata Contract

When creating a Stripe Checkout Session, include:

```json
{
  "metadata": {
    "tenant_id": "<uuid>"
  }
}
```

The `tenant_id` is required for `checkout.session.completed` to bootstrap
the tenant subscription row. If missing, the event is logged and skipped.

## Idempotency

All handlers use SET-based upserts (INSERT ... ON CONFLICT DO UPDATE).
Re-processing the same event produces the same result.

## Deployment

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

The `--no-verify-jwt` flag is required because Stripe sends raw HTTP
requests without a Supabase JWT. Authentication is via Stripe signature
verification instead.
