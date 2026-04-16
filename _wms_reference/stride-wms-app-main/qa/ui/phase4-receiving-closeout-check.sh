#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

require_pattern() {
  local label="$1"
  local pattern="$2"
  local target="$3"
  if rg -n --no-heading "$pattern" "$target" >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label"
  fi
}

reject_pattern() {
  local label="$1"
  local pattern="$2"
  local target="$3"
  if rg -n --no-heading "$pattern" "$target" >/dev/null 2>&1; then
    fail "$label"
  else
    pass "$label"
  fi
}

echo "Running Phase 4 Receiving closeout checks..."
echo

# Stage 1 invariants
require_pattern \
  "Stage1 requires account selection for completion" \
  "Account is required \\(or use UNIDENTIFIED SHIPMENT\\)" \
  "src/components/receiving/Stage1DockIntake.tsx"

require_pattern \
  "Stage1 provides UNIDENTIFIED account action" \
  "Use UNIDENTIFIED" \
  "src/components/receiving/Stage1DockIntake.tsx"

require_pattern \
  "Stage1 includes document capture section" \
  "DocumentCapture" \
  "src/components/receiving/Stage1DockIntake.tsx"

require_pattern \
  "Stage1 enforces required note for REFUSED/OTHER" \
  "code === 'REFUSED' \\|\\| code === 'OTHER'" \
  "src/components/receiving/Stage1DockIntake.tsx"

# Stage 2 invariants
require_pattern \
  "Stage2 shows Class column (not Glass)" \
  "TableHead className=\\\"w-44\\\">Class<" \
  "src/components/receiving/Stage2DetailedReceiving.tsx"

reject_pattern \
  "Stage2 does not show Glass label" \
  "TableHead className=\\\"w-44\\\">Glass<" \
  "src/components/receiving/Stage2DetailedReceiving.tsx"

require_pattern \
  "Stage2 includes per-item flag tray" \
  "Flag tray" \
  "src/components/receiving/Stage2DetailedReceiving.tsx"

require_pattern \
  "Stage2 reads auto_apply_arrival_no_id_flag" \
  "auto_apply_arrival_no_id_flag" \
  "src/components/receiving/Stage2DetailedReceiving.tsx"

require_pattern \
  "Stage2 queues unidentified intake alert" \
  "queueUnidentifiedIntakeCompletedAlert" \
  "src/components/receiving/Stage2DetailedReceiving.tsx"

# Exception + outbound behavior invariants
require_pattern \
  "Exception actions explicitly allow outbound processing for return workflows" \
  "Outbound processing can still proceed for return/disposition workflows" \
  "src/components/receiving/ShipmentExceptionActions.tsx"

reject_pattern \
  "Quick release no longer blocks MIS_SHIP/RETURN_TO_SENDER by shipment exception" \
  "shipment_exception_type.*MIS_SHIP.*RETURN_TO_SENDER" \
  "src/components/inventory/QuickReleaseDialog.tsx"

# Search + badges invariants
require_pattern \
  "Incoming search includes line-level fields and refs" \
  "shipment_external_refs|expected_vendor|expected_description|expected_sidemark|room|notes" \
  "src/hooks/useIncomingShipments.ts"

require_pattern \
  "Exception badge uses open exceptions plus item flags" \
  "openCount \\+ itemFlagCount" \
  "src/components/shipments/ShipmentExceptionBadge.tsx"

# Manifest/Expected parity labels
require_pattern \
  "Manifest detail shows Class label" \
  "TableHead className=\\\"w-44\\\">Class<" \
  "src/pages/InboundManifestDetail.tsx"

reject_pattern \
  "Manifest detail does not show Glass label" \
  "TableHead className=\\\"w-44\\\">Glass<" \
  "src/pages/InboundManifestDetail.tsx"

require_pattern \
  "Expected detail shows Class label" \
  "TableHead className=\\\"w-44\\\">Class<" \
  "src/pages/ExpectedShipmentDetail.tsx"

reject_pattern \
  "Expected detail does not show Glass label" \
  "TableHead className=\\\"w-44\\\">Glass<" \
  "src/pages/ExpectedShipmentDetail.tsx"

# Tenant-safe field-help cache scope
require_pattern \
  "Field-help query keys include tenant/user scope" \
  "queryScope" \
  "src/hooks/useFieldHelpContent.ts"

require_pattern \
  "Field-help queries filter by tenant_id" \
  "\\.eq\\('tenant_id', tenantId\\)" \
  "src/hooks/useFieldHelpContent.ts"

echo
echo "Checks complete: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

