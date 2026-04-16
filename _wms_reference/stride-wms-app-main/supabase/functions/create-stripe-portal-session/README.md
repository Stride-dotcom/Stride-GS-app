# create-stripe-portal-session

Creates a Stripe Customer Portal session URL for the authenticated user's tenant.

## Purpose

Used by `/subscription/update-payment` so blocked users update payment details directly in Stripe-hosted UI.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Stripe secret API key |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key for secure tenant lookup |
| `APP_URL` | recommended | App base URL used to build Stripe portal return URL |

## Auth model

- Requires authenticated user JWT (default `verify_jwt=true` behavior).
- Resolves tenant from authenticated user (`users.tenant_id`).
- Does not accept client-supplied tenant IDs.

## Deployment

```bash
supabase functions deploy create-stripe-portal-session
```

