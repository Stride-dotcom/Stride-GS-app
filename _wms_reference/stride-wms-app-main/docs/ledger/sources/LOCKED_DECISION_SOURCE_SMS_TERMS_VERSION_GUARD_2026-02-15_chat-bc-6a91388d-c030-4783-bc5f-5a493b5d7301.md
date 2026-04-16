# Locked Decision Source Artifact

- Topic: Enforce fixed SMS terms version server-side
- Topic Slug: `SMS_TERMS_VERSION_GUARD`
- Date: `2026-02-15`
- Chat ID: `bc-6a91388d-c030-4783-bc5f-5a493b5d7301`
- Source Mode: `current_chat`

## Captured Q&A

### QA-2026-02-15-SMS-TV-001
User requested continuation of remaining SaaS build-out/planning.

### QA-2026-02-15-SMS-TV-002
Remaining SaaS hardening identified:
- Decision `DL-2026-02-14-090` keeps `terms_version` fixed at `sms-addon-v1`.
- Direct RPC callers should not be able to persist alternate terms versions.

## Decision mapping (existing)

- `DL-2026-02-14-090` — keep `terms_version` fixed at `sms-addon-v1` in current phase
- `DL-2026-02-14-068` — terms acceptance audit evidence integrity

## Implementation summary

- Added migration `supabase/migrations/20260215110000_sms_terms_version_fixed_guard.sql`.
- Added trigger function `public.enforce_sms_addon_terms_version_fixed()` and trigger
  `enforce_sms_addon_terms_version_fixed_trigger`.
- Guard enforces `sms-addon-v1` whenever `terms_version` is inserted/changed on
  `public.tenant_sms_addon_activation`.
