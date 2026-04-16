# Master Locked Decision Ledger Control

## Canonical master files

- Decision ledger (master): `docs/LOCKED_DECISION_LEDGER.md`
- Implementation log (master): `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md`

These two files remain the canonical historical record. No existing decisions are removed.

## Why this control file exists

Multiple feature branches editing the same central markdown table rows causes frequent merge conflicts.
To prevent this, branch-level chat capture now writes to packet/source shards only.

## Conflict-safe operating model

### Branch/chat agents (normal mode)

Branch/chat agents should:

1. Create a per-chat source artifact in `docs/ledger/sources/`.
2. Create a per-chat import packet in `docs/ledger/packets/pending/`.
3. **Do not edit** the canonical master ledger/log files directly in feature branches.

### Integration pass (mainline mode)

Integrator should:

1. Run `npm run ledger:apply-packets` on an integration branch.
2. Review updates to master files.
3. Move applied packets from `pending/` to `applied/`.
4. Commit/push once as an integration update.

## Required naming conventions

- Source artifact:
  - `LOCKED_DECISION_SOURCE_<TOPIC_SLUG>_<YYYY-MM-DD>_chat-<chat-id>.md`
- Packet artifact:
  - `LDP-<YYYY-MM-DD>-<TOPIC_SLUG>-<chat-id>.md`

Use stable topic slugs across related chats to keep traceability grouped.

## Guardrails

1. Locked decision bodies are immutable.
2. Any change to a locked decision must be captured as a superseding decision.
3. All new accepted/locked decisions must include a `planned` event in the implementation log.
4. Packets are append-only records; never rewrite prior packet history.
