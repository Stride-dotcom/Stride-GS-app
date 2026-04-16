# Decision Ledger Builder Prompts (Conflict-Safe Packet Workflow)

Use these prompts with any coding builder (Cursor agent, Claude, ChatGPT code agent) to keep decision capture complete **without** creating merge conflicts on shared ledger files.

Master control reference: `docs/ledger/MASTER_LEDGER.md`

---

## Prompt 0 (required preflight): baseline sync + scaffold guard

```md
Run this preflight before any ledger work in this branch.

Requirements:
1) Verify baseline files exist:
   - docs/ledger/MASTER_LEDGER.md
   - docs/ledger/README.md
   - docs/ledger/packets/PACKET_TEMPLATE.md
   - scripts/ledger/apply-packets.mjs
   - docs/DECISION_LEDGER_BUILDER_PROMPTS.md
2) If any are missing, sync branch from main first:
   - git fetch origin main
   - git rebase origin/main
   (or git pull origin main if rebase is unavailable in this runtime)
3) Re-check the required files.
4) If still missing after sync, stop and report the blocker.
5) Do NOT create alternate/custom ledger scaffolding in this branch.
6) Validate tooling:
   - npm run ledger:apply-packets:dry-run
7) Return:
   - sync status
   - required-file check result
   - dry-run result
```

---

## Prompt A (chat/source capture): create source + pending packet only

```md
Capture decisions from this chat/source into conflict-safe artifacts.

CHAT_TOPIC: <short topic title, e.g., "Locations & Containers">
TOPIC_SLUG: <UPPER_SNAKE_OR_SLUG, e.g., LOCATIONS_CONTAINERS>
CHAT_ID: <chat/session id or short unique id>
SOURCE_MODE: <current_chat|file_path>
SOURCE_PATH: <path to PDF/markdown/transcript if SOURCE_MODE=file_path>
TODAY: <YYYY-MM-DD>
ACTOR: <builder/agent name>

MASTER_LEDGER_PATH: docs/LOCKED_DECISION_LEDGER.md
MASTER_LOG_PATH: docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md
SOURCE_DIR: docs/ledger/sources
PENDING_PACKET_DIR: docs/ledger/packets/pending

Requirements:
0) Preflight gate:
   - Run Prompt 0 first in this branch.
   - If baseline files are missing, sync from main. Do not bootstrap custom ledger files.
1) Create a source artifact:
   - docs/ledger/sources/LOCKED_DECISION_SOURCE_<TOPIC_SLUG>_<TODAY>_chat-<CHAT_ID>.md
   - If SOURCE_MODE=current_chat: extract Q&A from the active chat.
   - If SOURCE_MODE=file_path: read SOURCE_PATH fully and normalize Q&A/decision excerpts.
2) Extract explicit decisions only (no guesses), group duplicates, and map each extracted Q&A item to:
   - existing decision ID (already present in master), or
   - new decision ID candidate.
3) Determine decision states:
   - draft if uncertain/conflicting,
   - accepted if clear and approved in source,
   - locked only if source is explicitly authoritative/final.
4) Build one pending packet:
   - docs/ledger/packets/pending/LDP-<TODAY>-<TOPIC_SLUG>-<CHAT_ID>.md
   - Include sections:
     a) Decision Index Rows
     b) Detailed Decision Entries
     c) Implementation Log Rows (`planned` for accepted/locked)
5) Preserve immutability:
   - Never rewrite locked decision bodies.
   - If locked behavior changes, create a superseding decision entry.
6) IMPORTANT conflict rule:
   - Do NOT edit MASTER_LEDGER_PATH or MASTER_LOG_PATH in this prompt.
   - Only add/update source + pending packet files.
7) Return summary:
   - source artifact path
   - packet path
   - mapped existing decisions
   - new decisions prepared
   - unresolved/open questions (draft)
8) Commit and push with message:
   "docs: add decision packet from <source/chat name>"
```

---

## Prompt B (chat progress capture): create progress packet only

```md
Capture implementation progress updates as a pending packet (no master edits).

TOPIC_SLUG: <topic slug>
CHAT_ID: <chat/session id or short unique id>
TODAY: <YYYY-MM-DD>
ACTOR: <builder/agent name>
EVIDENCE: <commit hashes, PR links, files changed, test results>
TARGET_DECISIONS: <comma-separated IDs>
NEW_EVENT_TYPE: <in_progress|completed|verified|blocked>
PENDING_PACKET_DIR: docs/ledger/packets/pending

Requirements:
1) Create one pending packet in:
   - docs/ledger/packets/pending/LDP-<TODAY>-<TOPIC_SLUG>-<CHAT_ID>-progress.md
2) Packet must include:
   - empty or omitted Decision Index Rows unless new decisions are introduced
   - empty or omitted Detailed Decision Entries unless decisions changed
   - Implementation Log Rows with one row per TARGET_DECISION
3) Do not edit:
   - docs/LOCKED_DECISION_LEDGER.md
   - docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md
4) Return summary table of planned log rows.
5) Commit and push with message:
   "docs: add decision progress packet (<NEW_EVENT_TYPE>)"
```

---

## Prompt C (integration only): apply pending packets to master

```md
Integrate all pending packets into master ledger/log and archive them.

MASTER_LEDGER_PATH: docs/LOCKED_DECISION_LEDGER.md
MASTER_LOG_PATH: docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md
PENDING_PACKET_DIR: docs/ledger/packets/pending
APPLIED_PACKET_DIR: docs/ledger/packets/applied
TODAY: <YYYY-MM-DD>

Requirements:
1) Run:
   - npm run ledger:apply-packets
2) Validate:
   - No conflict markers in master files
   - No duplicate decision IDs inserted
   - No duplicate event IDs inserted
3) Ensure packet files were moved from pending -> applied.
4) Return summary:
   - packets applied
   - decisions inserted
   - events inserted
   - packets skipped/deduped
5) Commit and push with message:
   "docs: apply pending decision packets to master ledger"
```

---

## Prompt D (milestone lock): lock accepted decisions through packet + integration

```md
Lock accepted decisions for milestone closure using packet workflow.

TARGET_DECISIONS: <decision IDs>
TOPIC_SLUG: <topic slug>
CHAT_ID: <id>
TODAY: <YYYY-MM-DD>
ACTOR: <builder/agent>

Requirements:
1) Create a pending packet that:
   - updates target decisions to state=locked with locked date
   - appends `verified` implementation log rows with evidence
2) Do not edit master files directly in this step.
3) Commit/push packet branch.
4) In integration branch, run Prompt C to apply packet to master.
5) Final integration commit message:
   "docs: lock approved decisions for milestone <name>"
```

---

## Quick usage pattern

1. Run Prompt 0 at the start of each chat branch.
2. Reuse a stable `TOPIC_SLUG` per workstream.
3. For every chat, run Prompt A (and Prompt B if progress-only updates).
4. Keep chat branches packet-only to prevent merge conflicts.
5. Run Prompt C in integration flow to update master once.
6. Use Prompt D at milestone close to lock finalized decisions.

