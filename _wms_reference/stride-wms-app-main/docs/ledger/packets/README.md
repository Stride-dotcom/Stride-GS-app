# Ledger Import Packets

Packets are conflict-safe append-only artifacts. Feature/chat branches add packet files here instead of editing the master ledger files directly.

## Folder layout

- `docs/ledger/packets/pending/` — packets awaiting integration into master files.
- `docs/ledger/packets/applied/` — packets already integrated.

## Packet naming

`LDP-<YYYY-MM-DD>-<TOPIC_SLUG>-<chat-id>.md`

Example:

`LDP-2026-02-15-LOCATIONS_CONTAINERS-bc-93553291.md`

## Required packet sections

1. `## Decision Index Rows`
2. `## Detailed Decision Entries`
3. `## Implementation Log Rows`

Use `docs/ledger/packets/PACKET_TEMPLATE.md`.

## Integration

Only integration passes should update canonical files:

- `docs/LOCKED_DECISION_LEDGER.md`
- `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md`

Apply pending packets using:

```bash
npm run ledger:apply-packets
```
