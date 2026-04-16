# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-15-LEDGER_CONFLICT_PREVENTION-bc-93553291`
- Topic: Ledger conflict prevention and master workflow
- Topic Slug: `LEDGER_CONFLICT_PREVENTION`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-15`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `3`
- Existing decisions mapped: `0`
- New decisions added: `DL-2026-02-15-017..DL-2026-02-15-020`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-15-017 | Use packet-based chat workflow to prevent shared-ledger merge conflicts | Governance | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lg-001` | - | - |
| DL-2026-02-15-018 | Maintain one canonical master ledger/log; do not create separate full ledger per chat | Governance | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lg-002` | - | - |
| DL-2026-02-15-019 | Per-chat source artifacts must include topic slug and chat ID in standardized naming | Governance | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lg-003` | - | - |
| DL-2026-02-15-020 | Preserve existing decisions unchanged while migrating ledger workflow | Governance | accepted | `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lg-003` | - | - |

## Detailed Decision Entries

### DL-2026-02-15-017: Use packet-based chat workflow to prevent shared-ledger merge conflicts
- Domain: Governance
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lg-001`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Chat/feature branches must stage decision updates as packet/source artifacts instead of directly editing shared master ledger files.

#### Why
Direct concurrent edits to shared index/log sections repeatedly create PR merge conflicts.

#### Implementation impact
- Use `docs/ledger/sources/` and `docs/ledger/packets/pending/` for chat updates.
- Reserve master file edits for controlled packet-apply integration passes.

### DL-2026-02-15-018: Maintain one canonical master ledger/log; do not create separate full ledger per chat
- Domain: Governance
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lg-002`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
The system keeps one canonical master decision ledger/log, with per-chat source artifacts for traceability; it does not create separate full ledgers per conversation.

#### Why
Single-source master governance avoids fragmentation while retaining chat-level evidence.

#### Implementation impact
- Keep canonical files at `docs/LOCKED_DECISION_LEDGER.md` and `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md`.
- Store per-chat evidence in `docs/ledger/sources/`.

### DL-2026-02-15-019: Per-chat source artifacts must include topic slug and chat ID in standardized naming
- Domain: Governance
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lg-003`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Per-chat source artifacts use standardized names that include topic slug and chat ID for deterministic traceability.

#### Why
Consistent naming makes multi-chat tracking reliable and reduces ambiguity during imports.

#### Implementation impact
- Enforce source naming convention in prompt templates and registry docs.

### DL-2026-02-15-020: Preserve existing decisions unchanged while migrating ledger workflow
- Domain: Governance
- State: accepted
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md#qa-2026-02-15-lg-003`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-15
- Locked at: -

#### Decision
Ledger workflow migration must not remove or rewrite existing decision content.

#### Why
Historical decision integrity is a hard requirement for auditability.

#### Implementation impact
- Maintain current canonical ledger/log contents intact.
- Add migration artifacts and workflow controls around, not over, existing history.

## Implementation Log Rows

| DLE-2026-02-15-014 | 2026-02-15 | DL-2026-02-15-017 | planned | Added packet workflow docs and apply script | builder | Captured accepted packet-based workflow to avoid shared-file merge conflicts. |
| DLE-2026-02-15-015 | 2026-02-15 | DL-2026-02-15-018 | planned | Added master control doc `docs/ledger/MASTER_LEDGER.md` | builder | Confirmed single canonical master model with per-chat sources. |
| DLE-2026-02-15-016 | 2026-02-15 | DL-2026-02-15-019 | planned | Updated prompt templates and source naming docs | builder | Standardized topic+chat-id naming for source artifacts. |
| DLE-2026-02-15-017 | 2026-02-15 | DL-2026-02-15-020 | planned | Migration artifacts added without altering existing ledger decisions | builder | Preserved current decision history while implementing conflict-safe workflow. |
