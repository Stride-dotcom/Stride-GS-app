# Locked Decision Source: LEDGER_WORKFLOW_MIGRATION

- Date: 2026-02-14
- Chat ID: bc-c8136eae-835a-405e-bb84-cb901bf5ab45
- Topic: migrate this chat to packet-based ledger workflow

## Captured directives from this chat

1. Switch this chat to conflict-safe packet ledger workflow.
2. Use packet workflow artifacts under `docs/ledger/sources/*` and `docs/ledger/packets/pending/*`.
3. Do not directly edit:
   - `docs/LOCKED_DECISION_LEDGER.md`
   - `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md`
4. Validate packet parsing with:
   - `npm run ledger:apply-packets:dry-run`
5. Migration-first handling:
   - sync branch with `origin/main`
   - verify canonical packet workflow files exist
   - continue packet-only updates.

## Verification evidence from this session

- Branch sync completed:
  - `git fetch origin main`
  - `git rebase origin/main`
  - `git pull origin main` (already up to date)
- Canonical packet files/tooling check on this rebased branch:
  - Missing:
    - `docs/ledger/MASTER_LEDGER.md`
    - `docs/ledger/README.md`
    - `docs/ledger/packets/PACKET_TEMPLATE.md`
    - `scripts/ledger/apply-packets.mjs`
  - Present:
    - `docs/DECISION_LEDGER_BUILDER_PROMPTS.md`
- Dry-run command result:
  - `npm run ledger:apply-packets:dry-run` -> missing script in `package.json`.
