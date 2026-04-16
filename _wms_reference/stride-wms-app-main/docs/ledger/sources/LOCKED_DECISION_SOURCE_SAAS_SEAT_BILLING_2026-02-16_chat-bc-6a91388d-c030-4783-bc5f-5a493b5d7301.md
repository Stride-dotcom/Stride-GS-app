# Locked Decision Source Artifact

- Topic: SaaS seat-based billing (staff user count -> Stripe quantity)
- Topic Slug: `SAAS_SEAT_BILLING`
- Date: `2026-02-16`
- Chat ID: `bc-6a91388d-c030-4783-bc5f-5a493b5d7301`
- Source Mode: `current_chat`

## Q&A excerpts

### QA-2026-02-16-SEATS-001
User asked:
- “Once a tenant user starts adding staff users… will the system track user count and update Stripe billing, monthly invoices, etc?”
- “If not yet can we build this in”

## Implementation intent captured

1) Define a deterministic billable staff seat count per tenant.
2) Sync Stripe subscription per-user price quantity to that seat count.
3) Trigger sync automatically when tenant admins add/remove staff users (best-effort; must not block user admin flows).

## Notes / constraints

- Must be safe under direct calls and not depend on manual Stripe Dashboard operations.
- Stripe invoices remain Stripe-source-of-truth; app snapshots are recorded via webhook.
