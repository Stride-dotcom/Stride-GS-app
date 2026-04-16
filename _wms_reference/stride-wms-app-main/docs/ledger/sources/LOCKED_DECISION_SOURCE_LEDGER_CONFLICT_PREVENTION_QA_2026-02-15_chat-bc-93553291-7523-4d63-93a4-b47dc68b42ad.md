# Locked Decision Source — Ledger Conflict Prevention Q&A (2026-02-15)

## Source metadata

- Source type: Chat transcript (this session)
- Subject: Master ledger strategy and merge-conflict prevention workflow
- Chat ID: `bc-93553291-7523-4d63-93a4-b47dc68b42ad`
- Compiled by: builder
- Compiled on: 2026-02-15
- Purpose: Capture explicit governance/operations decisions for ledger process

## Q&A records (explicit only)

### QA-2026-02-15-LG-001
- Question/context: Why do ledger PRs keep conflicting?
- Explicit answer/decision:
  - Shared hot-file edits are the conflict source.
  - Move to a conflict-safe workflow where chat branches avoid direct master ledger/log edits.

### QA-2026-02-15-LG-002
- Question/context: Do we need a separate full ledger per conversation?
- Explicit answer/decision:
  - No; maintain one canonical master ledger/log.
  - Use per-conversation source artifacts for traceability.

### QA-2026-02-15-LG-003
- Question/context: What should be implemented now?
- Explicit answer/decision:
  - Create master-ledger workflow.
  - Update chat source files and prompt documentation for reliable ongoing tracking.
  - Preserve all current decisions with no data loss.
