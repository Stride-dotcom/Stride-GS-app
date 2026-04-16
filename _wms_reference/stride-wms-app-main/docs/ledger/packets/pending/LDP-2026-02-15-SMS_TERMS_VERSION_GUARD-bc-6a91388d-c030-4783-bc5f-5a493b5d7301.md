# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-15-SMS_TERMS_VERSION_GUARD-bc-6a91388d-c030-4783-bc5f-5a493b5d7301`
- Topic: SMS terms_version fixed guard
- Topic Slug: `SMS_TERMS_VERSION_GUARD`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_SMS_TERMS_VERSION_GUARD_2026-02-15_chat-bc-6a91388d-c030-4783-bc5f-5a493b5d7301.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-15`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `2`
- Existing decisions mapped: `2`
- New decisions added: `-`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

No new decision rows in this packet.

## Detailed Decision Entries

No new detailed decision entries in this packet.

## Implementation Log Rows

| DLE-2026-02-15-026 | 2026-02-15 | DL-2026-02-14-090,DL-2026-02-14-068 | completed | `supabase/migrations/20260215110000_sms_terms_version_fixed_guard.sql` | builder | Added DB trigger guard so `tenant_sms_addon_activation.terms_version` only accepts `sms-addon-v1` on insert/change, closing direct-call drift from fixed-version policy. |
