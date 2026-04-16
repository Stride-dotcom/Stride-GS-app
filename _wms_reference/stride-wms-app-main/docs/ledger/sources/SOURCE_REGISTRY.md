# Ledger Source Registry

This registry tracks source artifacts used to derive locked decisions.

## Active canonical source location

- Preferred folder for new source artifacts: `docs/ledger/sources/`
- Naming convention:
  - `LOCKED_DECISION_SOURCE_<TOPIC_SLUG>_<YYYY-MM-DD>_chat-<chat-id>.md`

## Registered sources

| Source Artifact | Type | Topic | Date | Notes |
|---|---|---|---|---|
| `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | Chat Q&A extraction | Locations / Containers | 2026-02-15 | Canonical per-chat source for decisions `DL-2026-02-15-001..016`. |
| `docs/ledger/sources/LOCKED_DECISION_SOURCE_LOCATIONS_CONTAINERS_UI_MODE_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | Chat Q&A extraction | Locations / Containers UI model | 2026-02-15 | Captures explicit Option 1 decision: UI-unified list with containers retained as separate entity/table (`DL-2026-02-15-050` pending packet). |
| `docs/ledger/sources/LOCKED_DECISION_SOURCE_LEDGER_CONFLICT_PREVENTION_QA_2026-02-15_chat-bc-93553291-7523-4d63-93a4-b47dc68b42ad.md` | Chat Q&A extraction | Ledger / Governance | 2026-02-15 | Canonical per-chat source for pending governance packet `LDP-2026-02-15-LEDGER_CONFLICT_PREVENTION-bc-93553291`. |
| `docs/LOCKED_DECISION_QA_LOG_2026-02-14.md` | Q&A log | SMS / Twilio / Billing | 2026-02-14 | Legacy append-only Q&A source consumed by `DL-2026-02-14-071..088`. |
| `docs/LOCKED_DECISION_LEDGER_PHASE5V3_IMPORT.md` | Import trace | SaaS Stripe Phase 5 v3 | 2026-02-14 | Detailed extraction from authoritative PDF source. |

## Migration policy

1. Do not delete legacy source artifacts that are referenced by existing decisions.
2. New imports should write canonical source files under `docs/ledger/sources/`.
3. If legacy paths are superseded later, add new decisions with updated source references rather than rewriting locked decision bodies.
