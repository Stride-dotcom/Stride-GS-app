# Locked Decision Source — Locations/Containers UI Model Clarification (2026-02-15)

## Source metadata

- Source type: Chat transcript (this session)
- Subject: Locations list vs container data model strategy
- Chat ID: `bc-93553291-7523-4d63-93a4-b47dc68b42ad`
- Compiled by: builder
- Compiled on: 2026-02-15
- Purpose: Capture explicit model choice between UI unification and schema migration

## Q&A records (explicit only)

### QA-2026-02-15-LC-001
- Question/context: Should container/location unification be implemented as UI-only or as a full data-model migration to `locations.type='container'`?
- Explicit answer/decision:
  - User selected **Option 1**.
  - Implement a **UI-unified Locations list/workflow** while keeping containers as a **separate entity/table**.
  - Do **not** migrate containers into `locations.type='container'` data model at this stage.

## Notes

- This source clarifies and resolves the prior draft ambiguity around container scanner/data identity model.
