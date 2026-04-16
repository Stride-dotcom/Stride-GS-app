# Locked Decision Source Artifact

- Topic: SMS RPC direct-call hardening (idempotency, race safety, audit integrity)
- Topic Slug: `SMS_RPC_HARDENING`
- Date: `2026-02-15`
- Chat ID: `bc-6a91388d-c030-4783-bc5f-5a493b5d7301`
- Source Mode: `current_chat`

## Captured Q&A

### QA-2026-02-15-SMS-RPC-001
User requested to continue SMS system build-out.

### QA-2026-02-15-SMS-RPC-002
Implementation focus selected from open workstream:
- Harden SMS add-on/provisioning direct-call RPC paths for:
  - idempotency
  - race safety
  - audit integrity
- Keep platform-managed sender behavior aligned with readiness gating.

## Decision mapping (existing)

- `DL-2026-02-14-068` — terms acceptance audit evidence requirements
- `DL-2026-02-14-069` — tenant-admin self-deactivation flow
- `DL-2026-02-14-073` — automated provisioning workflow
- `DL-2026-02-14-075` — SMS enablement gated by sender verification approval
- `DL-2026-02-14-089` — reactivation terms re-acceptance behavior

## Implementation summary from this chat

- Added migration `supabase/migrations/20260215102000_sms_rpc_direct_call_hardening.sql`.
- Replaced function bodies for:
  - `public.rpc_activate_sms_addon`
  - `public.rpc_deactivate_sms_addon`
  - `public.rpc_request_sms_sender_provisioning`
- Added tenant-scoped advisory locking to serialize concurrent transitions.
- Reintroduced server-side activation readiness checks for platform-managed SMS model.
- Kept deactivation idempotency behavior for inactive state and strengthened race handling.
- Ensured provisioning request returns idempotently for in-flight/approved states and logs transition-accurate events.
