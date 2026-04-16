# Locked Decision Source — Document Scanner: B/W PDF + Preview/Download + Correct Counts
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

> When adding documents if you take multiple photos ( click, click, click ) then save only one saves. But the document count remains at 0. And the documents are not able to be clicked to preview nor can they be downloaded. These all need to be fixed. The document scanner was supposed to save documents as a black and white pdf but it is just a photo.

## Baseline observation

- `DocumentCapture` rendered a thumbnail grid but thumbnails were not interactive (no open/preview/download affordance).
- Dock Intake Stage 1 showed a documents badge count sourced from a separate `useDocuments()` instance, so it could remain stale after document uploads.
- Web scanner PDFs were created from full-color images (not a black/white "scanner" look).

## Decision summary

- Document thumbnails must support **open/preview** and **download** actions.
- Dock Intake Stage 1 documents count must refresh after adding/removing documents.
- Web-scanned documents must be stored as **black & white PDFs** (scanner-style output).

## Implementation references

- `src/components/scanner/DocumentThumbnail.tsx`
  - Added click-to-open and download actions.
- `src/components/receiving/Stage1DockIntake.tsx`
  - Refetch documents count on add/remove via `onDocumentAdded` / `onDocumentRemoved`.
- `src/lib/scanner/webScanner.ts`
  - Added scan filter pipeline with default `filter: 'bw'`.
- `src/lib/scanner/uploadService.ts`
  - Added `mimeType` override to correctly store non-PDF uploads when applicable.
- `src/components/scanner/DocumentCapture.tsx` + `src/components/scanner/DocumentUploadButton.tsx`
  - Ensure uploads call the correct callbacks and pass through mime type data.

