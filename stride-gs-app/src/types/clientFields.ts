/**
 * clientFields.ts — Single source of truth for client-editable fields.
 *
 * Replaces the hand-maintained field lists that were scattered across 9 layers
 * (OnboardClientModal, OnboardClientPayload, UpdateClientPayload, applyClientPatch,
 * postUpdateClient call, api_updateClientRow_, api_clientRowToPayload_,
 * api_writeClientSettings_, Supabase clients mapper). Every time a new field was
 * added, one of those layers was forgotten, causing silent regressions
 * (the "autoCharge keeps not saving" bug, documented in commits 08637a6 + b2a18c7).
 *
 * **How to add a new client-editable field:**
 *   1. Add one entry to CLIENT_FIELDS below
 *   2. Add matching entry to CLIENT_FIELDS_ in StrideAPI.gs (keep keys in sync)
 *   3. Add the Supabase column via migration (if supabaseColumn is set)
 *   4. Add the form input to OnboardClientModal.tsx
 *
 * Types, optimistic patch, API call, backend write, backend echo, client
 * Settings tab sync, and Supabase mapping all derive from CLIENT_FIELDS.
 *
 * A runtime drift detector (api_validateClientFieldSchema_ in StrideAPI.gs)
 * compares the keys at every handleUpdateClient_ call and logs a warning if
 * the TS and GAS schemas diverge.
 */

export type ClientFieldType = 'string' | 'number' | 'boolean';

export interface ClientFieldDef {
  /** CB Clients sheet column header (case-insensitive header map lookup) */
  cbHeader: string;
  /** Client's own Settings tab key (only for fields that should sync to per-client Settings) */
  clientSettingsKey?: string;
  /** Supabase clients table column name */
  supabaseColumn?: string;
  /** Value coercion type */
  type: ClientFieldType;
  /** True when field is only settable on create (e.g. importInventoryUrl) */
  createOnly?: boolean;
  /** True when field is only editable on update (e.g. active, folder IDs, webAppUrl) */
  editOnly?: boolean;
  /** Default value for CREATE when field is missing or empty */
  defaultValue?: string | number | boolean;
}

/**
 * Ordered by logical grouping for readability. Order doesn't affect runtime.
 */
export const CLIENT_FIELDS = {
  // ─── Identity ────────────────────────────────────────────────────────────
  clientName:             { cbHeader: 'Client Name',          supabaseColumn: 'name',             type: 'string' },
  clientEmail:            { cbHeader: 'Client Email',         supabaseColumn: 'email',            type: 'string' },
  contactName:            { cbHeader: 'Contact Name',         supabaseColumn: 'contact_name',     type: 'string' },
  phone:                  { cbHeader: 'Phone',                supabaseColumn: 'phone',            type: 'string' },

  // ─── Integrations ────────────────────────────────────────────────────────
  qbCustomerName:         { cbHeader: 'QB_CUSTOMER_NAME',     supabaseColumn: 'qb_customer_name', type: 'string' },
  staxCustomerId:         { cbHeader: 'Stax Customer ID',     supabaseColumn: 'stax_customer_id', type: 'string' },

  // ─── Billing settings (also propagated to client's own Settings tab) ─────
  paymentTerms:           { cbHeader: 'Payment Terms',        clientSettingsKey: 'PAYMENT_TERMS',         supabaseColumn: 'payment_terms',         type: 'string', defaultValue: 'Net 30' },
  freeStorageDays:        { cbHeader: 'Free Storage Days',    clientSettingsKey: 'FREE_STORAGE_DAYS',     supabaseColumn: 'free_storage_days',     type: 'number', defaultValue: 0 },
  discountStoragePct:     { cbHeader: 'Discount Storage %',   clientSettingsKey: 'DISCOUNT_STORAGE_PCT',  supabaseColumn: 'discount_storage_pct',  type: 'number', defaultValue: 0 },
  discountServicesPct:    { cbHeader: 'Discount Services %',  clientSettingsKey: 'DISCOUNT_SERVICES_PCT', supabaseColumn: 'discount_services_pct', type: 'number', defaultValue: 0 },

  // ─── Feature flags (boolean toggles) ─────────────────────────────────────
  enableReceivingBilling: { cbHeader: 'Enable Receiving Billing', clientSettingsKey: 'ENABLE_RECEIVING_BILLING', supabaseColumn: 'enable_receiving_billing', type: 'boolean' },
  enableShipmentEmail:    { cbHeader: 'Enable Shipment Email',    clientSettingsKey: 'ENABLE_SHIPMENT_EMAIL',    supabaseColumn: 'enable_shipment_email',    type: 'boolean' },
  enableNotifications:    { cbHeader: 'Enable Notifications',     clientSettingsKey: 'ENABLE_NOTIFICATIONS',     supabaseColumn: 'enable_notifications',     type: 'boolean' },
  autoInspection:         { cbHeader: 'Auto Inspection',          clientSettingsKey: 'AUTO_INSPECTION',          supabaseColumn: 'auto_inspection',          type: 'boolean' },
  separateBySidemark:     { cbHeader: 'Separate By Sidemark',     clientSettingsKey: 'SEPARATE_BY_SIDEMARK',     supabaseColumn: 'separate_by_sidemark',     type: 'boolean' },
  autoCharge:             { cbHeader: 'Auto Charge',              clientSettingsKey: 'AUTO_CHARGE',              supabaseColumn: 'auto_charge',              type: 'boolean' },

  // ─── Relationships + notes ───────────────────────────────────────────────
  parentClient:           { cbHeader: 'Parent Client',        supabaseColumn: 'parent_client',    type: 'string' },
  notes:                  { cbHeader: 'Notes',                supabaseColumn: 'notes',            type: 'string' },
  shipmentNote:           { cbHeader: 'Client Shipment Note', clientSettingsKey: 'CLIENT_SHIPMENT_NOTE', supabaseColumn: 'shipment_note', type: 'string' },

  // ─── Edit-only (auto-generated or set post-onboard) ──────────────────────
  active:                 { cbHeader: 'Active',               supabaseColumn: 'active',           type: 'boolean', editOnly: true, defaultValue: true },
  folderId:               { cbHeader: 'Client Folder ID',     clientSettingsKey: 'DRIVE_PARENT_FOLDER_ID', supabaseColumn: 'folder_id',         type: 'string', editOnly: true },
  photosFolderId:         { cbHeader: 'Photos Folder ID',     clientSettingsKey: 'PHOTOS_FOLDER_ID',        supabaseColumn: 'photos_folder_id',  type: 'string', editOnly: true },
  invoiceFolderId:        { cbHeader: 'Invoice Folder ID',    clientSettingsKey: 'MASTER_ACCOUNTING_FOLDER_ID', supabaseColumn: 'invoice_folder_id', type: 'string', editOnly: true },
  webAppUrl:              { cbHeader: 'Web App URL',          supabaseColumn: 'web_app_url',      type: 'string', editOnly: true },
} as const satisfies Record<string, ClientFieldDef>;

export type ClientFieldKey = keyof typeof CLIENT_FIELDS;

/**
 * Runtime-usable ordered list of all field keys. Loop this in code that needs
 * to iterate every field (e.g. building a payload, validating parity).
 */
export const CLIENT_FIELD_KEYS = Object.keys(CLIENT_FIELDS) as ClientFieldKey[];

/**
 * Filtered key lists for create vs update paths.
 */
export const CLIENT_CREATE_KEYS = CLIENT_FIELD_KEYS.filter(
  k => !(CLIENT_FIELDS[k] as ClientFieldDef).editOnly
);

export const CLIENT_UPDATE_KEYS = CLIENT_FIELD_KEYS.filter(
  k => !(CLIENT_FIELDS[k] as ClientFieldDef).createOnly
);

/**
 * Derived TypeScript type helpers — map each field key to its JS value type.
 */
type FieldValueType<T extends ClientFieldType> =
  T extends 'string' ? string :
  T extends 'number' ? number :
  T extends 'boolean' ? boolean :
  never;

/**
 * Partial shape of a client payload where every field is optional. Used by
 * both CREATE and UPDATE payloads — the specific lists of allowed keys are
 * enforced at the call site via CLIENT_CREATE_KEYS / CLIENT_UPDATE_KEYS.
 */
export type ClientFieldPayload = {
  [K in ClientFieldKey]?: FieldValueType<typeof CLIENT_FIELDS[K]['type']>;
};

/**
 * Build a payload object from a source object (typically the form's `data`),
 * picking only the keys allowed for the given mode. Missing keys are omitted
 * from the output; explicit `undefined` values are also omitted.
 *
 * Use in handleClientSubmit so you never have to hand-maintain the field list.
 */
export function buildClientPayload<T extends Record<string, unknown>>(
  source: T,
  mode: 'create' | 'update'
): ClientFieldPayload {
  const allowedKeys = mode === 'create' ? CLIENT_CREATE_KEYS : CLIENT_UPDATE_KEYS;
  const out: ClientFieldPayload = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (value === undefined) continue;
    const def = CLIENT_FIELDS[key];
    // Coerce to the expected type (matches GAS CLIENT_FIELDS_ coercion)
    if (def.type === 'number') {
      const n = Number(value);
      (out as Record<string, unknown>)[key] = Number.isFinite(n) ? n : 0;
    } else if (def.type === 'boolean') {
      (out as Record<string, unknown>)[key] = value === true || String(value).toUpperCase() === 'TRUE';
    } else {
      (out as Record<string, unknown>)[key] = String(value ?? '');
    }
  }
  return out;
}

/**
 * Schema fingerprint — a stable hash of the field keys. The GAS backend
 * has a mirror of CLIENT_FIELDS; computing this hash on both sides and
 * comparing at runtime surfaces drift instantly.
 *
 * Value is deterministic for a given CLIENT_FIELDS content.
 */
export const CLIENT_FIELD_SCHEMA_FINGERPRINT = CLIENT_FIELD_KEYS.join('|');
