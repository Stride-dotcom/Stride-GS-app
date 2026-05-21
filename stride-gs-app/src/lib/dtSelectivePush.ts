/**
 * dtSelectivePush — shared diff → DispatchTrack field-group classifier.
 *
 * Pairs with the dt-push-order Edge Function (v34+). A re-push from an
 * edit-save used to send the FULL order payload, which made DT re-run
 * route assignment / re-blank dispatcher-edited schedule + notes for
 * fields the operator never touched. Now the React save handlers diff
 * the form against the loaded order, classify what changed into logical
 * groups, ask the operator to confirm, and pass only the changed groups
 * to dt-push-order so DT keeps everything else as-is.
 *
 * Keep the group names in exact sync with DT_FIELD_GROUPS in
 * supabase/functions/dt-push-order/index.ts — they cross the wire.
 */

export type DtFieldGroup = 'items' | 'date' | 'contact' | 'notes' | 'custom';

// dt_orders column → which DT field group it maps to. A column NOT in
// this map is not pushed to DT at all (e.g. review_status, pricing)
// and so never triggers a re-push on its own.
//
// sidemark + client_reference live here under `items` because they are
// rendered into every item's <description> by the edge function's
// buildItemDesc — changing them must regenerate the <items> block.
// coverage/billing/details/notes all surface in the <description> CDATA
// or <notes> block → `notes`. service_time + po_number → `custom`
// (po_number lands in DT's <additional_field_1> per dt-push-order v36
// so a later PO edit visibly updates DT without rewriting anything else;
// pre-v36 po_number was create-time only).
const COLUMN_GROUP: Readonly<Record<string, DtFieldGroup>> = {
  local_service_date: 'date',
  window_start_local: 'date',
  window_end_local: 'date',
  contact_name: 'contact',
  contact_address: 'contact',
  contact_city: 'contact',
  contact_state: 'contact',
  contact_zip: 'contact',
  contact_phone: 'contact',
  contact_phone2: 'contact',
  contact_email: 'contact',
  details: 'notes',
  driver_notes: 'notes',
  order_notes: 'notes',
  internal_notes: 'notes',
  billing_method: 'notes',
  coverage_option_id: 'notes',
  declared_value: 'notes',
  sidemark: 'items',
  client_reference: 'items',
  service_time_minutes: 'custom',
  po_number: 'custom',
};

export const DT_GROUP_LABEL: Readonly<Record<DtFieldGroup, string>> = {
  items: 'Items',
  date: 'Delivery date / time window',
  contact: 'Customer contact & address',
  notes: 'Notes & description',
  custom: 'Service time / custom fields',
};

// Human label per column for the confirmation change list.
const COLUMN_LABEL: Readonly<Record<string, string>> = {
  local_service_date: 'Delivery date',
  window_start_local: 'Window start',
  window_end_local: 'Window end',
  contact_name: 'Customer name',
  contact_address: 'Address',
  contact_city: 'City',
  contact_state: 'State',
  contact_zip: 'Zip',
  contact_phone: 'Phone',
  contact_phone2: 'Secondary phone',
  contact_email: 'Email',
  details: 'Order details',
  driver_notes: 'Driver notes',
  order_notes: 'Order notes',
  internal_notes: 'Internal notes',
  billing_method: 'Billing method',
  coverage_option_id: 'Coverage',
  declared_value: 'Declared value',
  sidemark: 'Sidemark',
  client_reference: 'Client reference',
  service_time_minutes: 'Service time',
  po_number: 'PO / Reference number',
};

export interface DtFieldChange {
  /** Human label for the change list in the confirm dialog. */
  label: string;
  from: string;
  to: string;
}

export interface DtChangeSummary {
  /** Field groups to send as `changedFields` to dt-push-order. Empty =
   *  nothing DT-relevant changed → caller must SKIP the re-push entirely
   *  (an empty array would be read by the edge function as a FULL push). */
  groups: DtFieldGroup[];
  /** Per-field changes to render in the confirmation dialog. */
  changes: DtFieldChange[];
}

// Treat null / undefined / '' as the same "empty" value so a
// null→'' round-trip through the form doesn't read as a change. Numbers
// vs numeric strings compare via String() (so 5 === '5').
function normEq(a: unknown, b: unknown): boolean {
  const na = a === null || a === undefined || a === '' ? null : a;
  const nb = b === null || b === undefined || b === '' ? null : b;
  return String(na ?? '') === String(nb ?? '');
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  return String(v);
}

/**
 * Diff a column-keyed snapshot (loaded order) against a column-keyed
 * payload (about to be saved) and classify the changes into DT field
 * groups. Only columns present in COLUMN_GROUP are considered — fields
 * that never reach DT (review_status, po_number, pricing) are ignored
 * so they never force a re-push.
 *
 * `itemsChanged` is computed by the caller (the modal owns the item
 * editor state; OrderPage's inline edit can't touch items so it passes
 * false). When true it adds the `items` group + a summary change line.
 */
export function summarizeDtChanges(
  snapshot: Record<string, unknown>,
  payload: Record<string, unknown>,
  itemsChanged: boolean,
  itemsDetail?: { from: string; to: string },
): DtChangeSummary {
  const groups = new Set<DtFieldGroup>();
  const changes: DtFieldChange[] = [];

  for (const [col, group] of Object.entries(COLUMN_GROUP)) {
    if (!Object.prototype.hasOwnProperty.call(payload, col)) continue;
    if (normEq(snapshot[col], payload[col])) continue;
    groups.add(group);
    changes.push({
      label: COLUMN_LABEL[col] ?? col,
      from: fmtVal(snapshot[col]),
      to: fmtVal(payload[col]),
    });
  }

  if (itemsChanged) {
    groups.add('items');
    changes.push({
      label: 'Items',
      from: itemsDetail?.from ?? 'previous list',
      to: itemsDetail?.to ?? 'updated list',
    });
  }

  return { groups: [...groups], changes };
}
