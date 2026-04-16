# Locked Decision Source — Outbound Create: OUT# on Start + Item Selection Parity
Date: 2026-02-16  
Chat: bc-c8136eae-835a-405e-bb84-cb901bf5ab45

## User request (verbatim)

> In outbound shipments there is no way to select items to apply to the shipment. Something happened to this page, probably when we moved will call to outbound. It broke the entire work flow. Outbound should mirror inbound in that it is assigned an out# upon starting the creation. when you select an account the available items list should populate in a list format like the inventory page layout and allow you to select multiple items to add to the outbound shipment.

## Baseline observation

- Outbound create UX did not display an OUT# until after submission (shipment insert).
- Available-items query filtered out common storage statuses (e.g., `stored`), causing the list to appear empty.
- Item selection table did not surface inventory-like context (location/room/class), making it harder to select correctly.

## Decision summary

- Outbound create must **create a draft shipment immediately** to obtain an OUT-##### shipment number on entry.
- Selecting an account must populate an available items list that includes items in `stored` status.
- Item selection UI must support multi-select and present inventory-like columns (location/room/class/type/sidemark).

## Implementation references

- `src/pages/OutboundCreate.tsx`
  - Creates draft outbound shipment on entry and displays OUT# in the header.
  - Final submit updates the draft shipment and inserts selected items into `shipment_items`.
- `src/hooks/useOutbound.ts` (`useAccountItems`)
  - Includes `stored` status and selects additional fields for inventory-like display (location/room/class).

