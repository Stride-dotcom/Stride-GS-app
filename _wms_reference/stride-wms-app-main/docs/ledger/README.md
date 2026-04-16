# Locked Decision Ledger Architecture (Merge-Conflict Safe)

This folder introduces a packet-based workflow so multiple chats can log decisions without editing the same shared lines in the master ledger files.

## No-data-loss guarantee

All current decisions remain in canonical master files:

- `docs/LOCKED_DECISION_LEDGER.md`
- `docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md`

This migration changes **how new updates are staged**, not historical content.

## Folder map

- `docs/ledger/MASTER_LEDGER.md`  
  Operating model and guardrails.
- `docs/ledger/sources/`  
  Per-chat/per-source extraction artifacts.
- `docs/ledger/packets/pending/`  
  New decision/progress packets from active chats.
- `docs/ledger/packets/applied/`  
  Archived packets already applied to master.
- `docs/ledger/packets/PACKET_TEMPLATE.md`  
  Required packet structure.

## Commands

Apply pending packets into canonical master files:

```bash
npm run ledger:apply-packets
```

Dry-run packet processing:

```bash
npm run ledger:apply-packets:dry-run
```

## Conflict prevention rule

Normal chat branches must **not** edit the master files directly.  
They should only add files under:

- `docs/ledger/sources/`
- `docs/ledger/packets/pending/`

Integration applies packets to master in one controlled pass.
