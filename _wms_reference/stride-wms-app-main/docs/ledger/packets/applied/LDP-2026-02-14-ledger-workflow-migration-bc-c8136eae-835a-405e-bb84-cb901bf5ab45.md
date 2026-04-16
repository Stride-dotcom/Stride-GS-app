# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-14-ledger-workflow-migration-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Ledger workflow migration (packet-only updates)
- Topic Slug: `LEDGER_WORKFLOW_MIGRATION`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_WORKFLOW_MIGRATION_2026-02-14_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-14`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `3`
- Existing decisions mapped: `0`
- New decisions added: `DL-2026-02-14-091..DL-2026-02-14-093`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-14-091 | Use packet workflow artifacts for decision updates | Governance | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_WORKFLOW_MIGRATION_2026-02-14_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-14 |
| DL-2026-02-14-092 | Legacy master ledger/log files are read-only for this chat; no direct edits allowed | Governance | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_WORKFLOW_MIGRATION_2026-02-14_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-14 |
| DL-2026-02-14-093 | Packet apply requires dry-run validation before execution | Governance | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_WORKFLOW_MIGRATION_2026-02-14_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-14 |

## Detailed Decision Entries

### DL-2026-02-14-091: Use packet workflow artifacts for decision updates
- Domain: Governance
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_WORKFLOW_MIGRATION_2026-02-14_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-14
- Locked at: 2026-02-14

#### Decision
This chat must use packet workflow artifacts for decision updates.

#### Why
Avoid conflicts on shared master ledger/log files during migration.

#### Implementation impact
- Capture decision deltas in `docs/ledger/sources/*` and `docs/ledger/packets/pending/*`.

### DL-2026-02-14-092: Legacy master ledger/log files are read-only for this chat; no direct edits allowed
- Domain: Governance
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_WORKFLOW_MIGRATION_2026-02-14_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-14
- Locked at: 2026-02-14

#### Decision
Do not directly edit `docs/LOCKED_DECISION_LEDGER.md` or `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md` in this chat/branch workflow.

#### Why
Maintain immutable canonical master files while updates are captured as packets.

#### Implementation impact
- All updates land via `docs/ledger/packets/pending/*` and are applied by `scripts/ledger/apply-packets.mjs` in integration passes.

### DL-2026-02-14-093: Packet apply requires dry-run validation before execution
- Domain: Governance
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_WORKFLOW_MIGRATION_2026-02-14_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-14
- Locked at: 2026-02-14

#### Decision
Run `npm run ledger:apply-packets:dry-run` before applying packets.

#### Why
Provides a parse/shape validation gate to prevent malformed packet content from being archived or partially applied.

#### Implementation impact
- Integration passes must dry-run first; failures block apply until packet shape is corrected.

## Implementation Log Rows

| DLE-2026-02-14-065 | 2026-02-14 | DL-2026-02-14-091 | completed | `git fetch origin main`, `git rebase origin/main` | builder | Synced branch with `origin/main` and verified up-to-date. |
| DLE-2026-02-14-066 | 2026-02-14 | DL-2026-02-14-091,DL-2026-02-14-092 | completed | Created `docs/ledger/sources/*` + `docs/ledger/packets/pending/*` artifacts | builder | Created this chat source artifact and pending packet under packet workflow paths. |
| DLE-2026-02-14-067 | 2026-02-14 | DL-2026-02-14-093 | blocked | `npm run ledger:apply-packets:dry-run` | builder | Command not available on this branch after sync; packet apply validation could not be executed. |
