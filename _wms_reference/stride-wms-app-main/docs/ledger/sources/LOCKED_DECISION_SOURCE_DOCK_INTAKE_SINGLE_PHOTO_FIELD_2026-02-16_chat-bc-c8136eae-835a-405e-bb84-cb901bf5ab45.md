# Locked Decision Source — Dock Intake Single Photo Field (Legacy)
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

> The camera photos field from legacy incoming shipments was not brought over to dock intake. There are now 2 in dock intake and we want the legacy version to replace these 2. We only need one photo capture / upload field.

## Baseline observation

- Dock Intake (Stage 1) UI showed two separate required photo sections:
  - "Paperwork Photos" (required)
  - "Condition Photos" (required)
- Legacy incoming shipments UI uses a single consolidated "Photos" capture/upload section.

## Decision summary

- Replace Dock Intake Stage 1’s dual photo sections with the same single consolidated Photos capture/upload UX used on legacy incoming shipments.
- Store Dock Intake photos on `shipments.receiving_photos` (JSON), consistent with the legacy incoming shipments implementation.
- Require only **one** photo set (>= 1 photo total) for Stage 1 completion.
- Maintain backwards compatibility by bootstrapping any existing `shipment_photos` (from the prior Dock Intake UI) into `shipments.receiving_photos` so photos are not effectively “lost” after the UI swap.

## Implementation references

- `src/components/receiving/Stage1DockIntake.tsx`
  - Replaced the dual photo panels with the consolidated legacy Photos section (PhotoScannerButton + PhotoUploadButton + TaggablePhotoGrid).
  - Stage 1 validation updated to require at least 1 photo total.
  - Added one-time bootstrap from `shipment_photos` → `shipments.receiving_photos` for backward compatibility.
- `src/components/receiving/ConfirmationGuard.tsx`
  - Updated photo count display to read from `shipments.receiving_photos` (single photos count).

