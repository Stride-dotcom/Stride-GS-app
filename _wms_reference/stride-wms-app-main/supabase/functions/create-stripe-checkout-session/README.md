# create-stripe-checkout-session

Creates a Stripe Checkout Session (subscription mode) for tenants that need to start a subscription.

## Purpose

Implements Phase 5.1 checkout session creation with required `metadata.tenant_id` so
`checkout.session.completed` can bootstrap `tenant_subscriptions` reliably.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Stripe secret API key |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key for secure tenant lookup |
| `APP_URL` | recommended | App base URL used to build checkout success/cancel URLs |

## Behavior

- Requires authenticated user JWT.
- Resolves tenant from authenticated user (`users.tenant_id`).
- Selects active SaaS plan from `saas_plans` with `stripe_price_id_base`.
- Creates Checkout Session in subscription mode.
- Writes `metadata.tenant_id` and `subscription_data.metadata.tenant_id`.

## Deployment

```bash
supabase functions deploy create-stripe-checkout-session
```

