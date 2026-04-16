# Locked Decision Import Packet

- Packet ID: `LDP-<YYYY-MM-DD>-<TOPIC_SLUG>-<chat-id>`
- Topic: `<human readable topic>`
- Topic Slug: `<TOPIC_SLUG>`
- Source Artifact: `docs/ledger/sources/<source-file>.md`
- Source Mode: `<current_chat|file_path>`
- Source Path (if file): `<path or ->`
- Created Date: `<YYYY-MM-DD>`
- Actor: `<builder/agent>`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `<n>`
- Existing decisions mapped: `<n>`
- New decisions added: `<DL IDs>`
- Unresolved/open (draft): `<DL IDs or ->`
- Supersedes: `<IDs or ->`

## Decision Index Rows

<!-- Add raw markdown table rows only. No header row. -->
| DL-<date>-<nnn> | <title> | <domain> | <state> | <source> | <supersedes> | <locked at or -> |

## Detailed Decision Entries

<!-- Add full entry blocks exactly as they should appear in master ledger. -->
### DL-<date>-<nnn>: <Short title>
- Domain: <Module or cross-cutting area>
- State: <draft|accepted|locked|superseded|rejected>
- Source: <links/paths to Q&A, docs, issue, PR>
- Supersedes: <Decision ID or ->
- Superseded by: <Decision ID or ->
- Date created: <YYYY-MM-DD>
- Locked at: <YYYY-MM-DD or ->

#### Decision
<single clear statement of what was decided>

#### Why
<rationale and constraints>

#### Implementation impact
<files/modules/routes/tables affected>

## Implementation Log Rows

<!-- Add raw markdown table rows only. No header row. -->
| DLE-<date>-<nnn> | <YYYY-MM-DD> | <Decision ID> | <planned|in_progress|completed|verified|blocked> | <evidence> | <actor> | <note> |
