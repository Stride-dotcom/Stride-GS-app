# Locked Decision Source — Dock Intake UI Cleanup + Discrepancy Exception Filtering
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

> The use unidentified button should not be there. Unidentified is just an account that users select. Plus that button doesn’t work. The vendor name field in shipment details and summary does not be there. The title shipment details and summary should just be renamed to Shipment Summary. The extra button at the top of the page for “no account” mark mis-ship and return to sender need to be removed. ... In the exception chips field we discussed all of the matching system exceptions not going in here because these are not shipment exceptions... (Item count mismatch, vendor mismatch, description mismatch, sidemark ... mismatch, shipper mismatch, tracking mismatch, reference mismatch) ... should be removed form this field.

## Baseline observation

- Dock Intake Stage 1 showed a "Use UNIDENTIFIED" helper button even though UNIDENTIFIED is an account option.
- Dock Intake Stage 1 displayed a Vendor Name input in the summary section.
- The Receiving view included admin exception action controls (No Account / Mark Mis-Ship / Return to Sender).
- The Stage 1 Exceptions chip selector included matching/discrepancy-style mismatch codes.

## Decision summary

- Remove the "Use UNIDENTIFIED" button from Dock Intake Stage 1 (user must select the UNIDENTIFIED account directly).
- Remove Vendor Name input from Dock Intake Stage 1 summary and rename the section to "Shipment Summary".
- Remove the top-of-page admin exception action controls (mis-ship/return-to-sender buttons) from the Receiving view.
- Filter out matching/discrepancy mismatch exception codes from Dock Intake exception-selection UX and from the standard Exceptions UI/badges (these are not user-selected condition exceptions).

## Implementation references

- `src/components/receiving/Stage1DockIntake.tsx`
  - Removed UNIDENTIFIED helper button.
  - Removed Vendor Name field; renamed section to Shipment Summary.
  - Removed mismatch exception codes from the chip selector.
- `src/components/receiving/ReceivingStageRouter.tsx`
  - Removed the ShipmentExceptionActions block from the Receiving view.
- `src/hooks/useShipmentExceptions.ts`
  - Added filtering for matching/discrepancy mismatch exception codes (default hidden).

