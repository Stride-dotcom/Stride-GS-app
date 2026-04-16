# Locked Decision Import Packet

- Packet ID: `LDP-2026-02-16-document-scanner-bw-pdf-preview-download-bc-c8136eae-835a-405e-bb84-cb901bf5ab45`
- Topic: Document scanning B/W PDFs + preview/download + count sync
- Topic Slug: `DOCUMENT_SCANNER_BW_PDF_AND_DOCUMENT_PREVIEW_DOWNLOAD`
- Source Artifact: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCUMENT_SCANNER_BW_PDF_AND_DOCUMENT_PREVIEW_DOWNLOAD_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Source Mode: `current_chat`
- Source Path (if file): `-`
- Created Date: `2026-02-16`
- Actor: `builder`
- Status: `pending`

## Scope Summary

- Q&A items extracted: `1`
- Existing decisions mapped: `-`
- New decisions added: `DL-2026-02-16-011`
- Unresolved/open (draft): `-`
- Supersedes: `-`

## Decision Index Rows

| DL-2026-02-16-011 | Document scanning saves B/W PDFs, supports preview/download, and keeps counts in sync | Document Scanning UI | locked | `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCUMENT_SCANNER_BW_PDF_AND_DOCUMENT_PREVIEW_DOWNLOAD_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md` | - | 2026-02-16 |

## Detailed Decision Entries

### DL-2026-02-16-011: Document scanning saves B/W PDFs, supports preview/download, and keeps counts in sync
- Domain: Document Scanning UI
- State: locked
- Source: `docs/ledger/sources/LOCKED_DECISION_SOURCE_DOCUMENT_SCANNER_BW_PDF_AND_DOCUMENT_PREVIEW_DOWNLOAD_2026-02-16_chat-bc-c8136eae-835a-405e-bb84-cb901bf5ab45.md`
- Supersedes: -
- Superseded by: -
- Date created: 2026-02-16
- Locked at: 2026-02-16

#### Decision
Document scanning/upload must: (1) save web-scanner output as black & white PDFs, (2) allow preview + download from document thumbnails, and (3) keep document counts in sync after add/remove in Dock Intake.

#### Why
Paperwork capture must be verifiable and usable; preview/download and correct counts restore legacy usability and reduce compliance risk.

#### Implementation impact
- Scanner pipeline: generate black & white PDFs for web-scanned documents.
- UI: make document thumbnails openable and provide download actions.
- UI: ensure Dock Intake document count badges refresh after add/remove.

## Implementation Log Rows

| DLE-2026-02-16-018 | 2026-02-16 | DL-2026-02-16-011 | completed | `src/components/scanner/DocumentThumbnail.tsx` | builder | Document thumbnails are clickable to open and provide a download action. |
| DLE-2026-02-16-019 | 2026-02-16 | DL-2026-02-16-011 | completed | `src/components/receiving/Stage1DockIntake.tsx` | builder | Dock Intake Stage 1 documents badge refreshes after document add/remove. |
| DLE-2026-02-16-020 | 2026-02-16 | DL-2026-02-16-011 | completed | `src/components/scanner/DocumentScanner.tsx` | builder | Web scanner generates black & white PDFs via a scan filter pipeline. |

