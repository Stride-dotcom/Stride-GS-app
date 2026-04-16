# Locked Decision Source — Put Away Config & Capacity Q&A (2026-02-23)

- Source Type: current_chat
- Chat ID: bc-b227f975-1cb4-4a21-a194-b687c66a9be0
- Date: 2026-02-23
- Scope: Put Away configuration, exclusion rules, flag-location compliance, and shared suggestion/capacity engine decisions.

## Q&A

### qa-paway-config-2026-02-23-001
- Q: Should excluded suggestion locations be per warehouse or global tenant-wide?
- A: Per warehouse (tenant-wide per warehouse).

### qa-paway-config-2026-02-23-002
- Q: Who can edit Put Away configuration?
- A: Admin and Manager only. `tenant_admin` should not be used.

### qa-paway-config-2026-02-23-003
- Q: Should active Put Away source locations be auto-excluded from suggestions?
- A: Yes.

### qa-paway-config-2026-02-23-004
- Q: Are exclusions hard or soft?
- A: Hard exclusions only.

### qa-paway-config-2026-02-23-005
- Q: How should flag-required storage locations be configured?
- A: On flag setup/details, add a “requires special storage location” toggle. When enabled, show searchable, scrollable, multi-select location picker with selected locations pinned at top.

### qa-paway-config-2026-02-23-006
- Q: Where should Put Away exclusion list settings be configured?
- A: Settings → Organization → Preferences → Storage & Automation, under the Free Storage Days row.

### qa-paway-config-2026-02-23-007
- Q: How should warehouse context be selected for those settings?
- A: Add warehouse selector top-right in Storage & Automation section header, defaulting to default warehouse; settings apply to selected warehouse.

### qa-paway-config-2026-02-23-008
- Q: Are special-storage flags hard requirements for suggestions/moves?
- A: Yes. If none match, show “no compliant locations” behavior.

### qa-paway-config-2026-02-23-009
- Q: Multiple required flags should use intersection or union?
- A: Intersection (“all flags”).

### qa-paway-config-2026-02-23-010
- Q: Items with no special-storage flags should use normal ranking?
- A: Yes.

### qa-paway-config-2026-02-23-011
- Q: Non-compliant manual destination should be blocking or overrideable?
- A: Warning + manager override with audit.

### qa-paway-config-2026-02-23-012
- Q: Are flags global or per warehouse?
- A: Flags are global definitions; required locations for a flag are per warehouse.

### qa-paway-config-2026-02-23-013
- Q: Preferred UI for per-warehouse flag location mapping?
- A: Table format listing all warehouses, with columns `Warehouse | Location search` (multi-select per row).

### qa-paway-config-2026-02-23-014
- Q: If a warehouse has no configured compliant locations for a required flag, should it block?
- A: No. Show prompt “No compliant locations configured for this warehouse,” but do not block.

### qa-paway-config-2026-02-23-015
- Q: If a location is both excluded and required by flag mapping, which wins?
- A: Exclusion wins. Exclusions affect suggestion engine only and should not alter receiving auto-assignment.

### qa-paway-config-2026-02-23-016
- Q: Should exclusion + flag-compliance rules be shared across all suggestion surfaces?
- A: Yes.
