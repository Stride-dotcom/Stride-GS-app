# Locked Decision Source Artifact

- Topic: Ledger workflow sync to main + packet-only continuation
- Topic Slug: `LEDGER_WORKFLOW_SYNC`
- Date: `2026-02-15`
- Chat ID: `bc-6a91388d-c030-4783-bc5f-5a493b5d7301`
- Source Mode: `current_chat`

## Captured instruction excerpts

### Q&A 2026-02-15 LWS-001
User directed:
- Sync branch with `main` before any packet updates.
- Verify existence of packet-ledger workflow files.
- Validate with `npm run ledger:apply-packets:dry-run`.
- Continue with packet workflow only:
  - update `docs/ledger/sources/*`
  - update `docs/ledger/packets/pending/*`
  - do not directly edit legacy master files.

### Q&A 2026-02-15 LWS-002
Migration rule:
- Do not bootstrap custom ledger scaffolding in this branch.
- Use the official packet-ledger workflow files merged from mainline history.

## Extracted decisions

1. Use sync-first + verify-first sequence before packet updates in this chat.
2. Continue packet-only updates under `docs/ledger/sources` and `docs/ledger/packets/pending`.
