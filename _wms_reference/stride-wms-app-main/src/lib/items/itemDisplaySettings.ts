export type BuiltinItemColumnKey =
  | 'photo'
  | 'item_code'
  | 'sku'
  | 'quantity'
  | 'size'
  | 'vendor'
  | 'description'
  | 'location'
  | 'client_account'
  | 'sidemark'
  | 'room'
  | 'class'
  | 'received_date';

export type ItemColumnKey = BuiltinItemColumnKey | `cf:${string}`;

export type ItemCustomFieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox';

export interface ItemCustomFieldDefinition {
  id: string;
  /** Stable key stored on the item (metadata.custom_fields[key]) */
  key: string;
  label: string;
  type: ItemCustomFieldType;
  /** Only used for type === 'select' */
  options?: string[];
  enabled: boolean;
  show_in_lists: boolean;
  show_on_detail: boolean;
  /** When true, item forms should require a non-empty value. */
  required?: boolean;
}

export function isEmptyCustomFieldValue(field: ItemCustomFieldDefinition, raw: unknown): boolean {
  if (field.type === 'checkbox') return false; // checkbox fields are not treated as "required"
  if (raw === null || raw === undefined) return true;
  if (field.type === 'number') {
    if (typeof raw === 'string' && raw.trim().length === 0) return true;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    return !Number.isFinite(n);
  }
  const s = String(raw).trim();
  return s.length === 0;
}

export interface ItemListViewDefinition {
  id: string;
  name: string;
  is_default: boolean;
  order: ItemColumnKey[];
  hidden: ItemColumnKey[];
}

export interface ItemDisplaySettingsV1 {
  version: 1;
  views: ItemListViewDefinition[];
  custom_fields: ItemCustomFieldDefinition[];
  /**
   * Form-level requirements (separate from view column "required" semantics).
   * Stored in tenant_settings under ITEM_DISPLAY_SETTINGS_TENANT_KEY.
   */
  required_builtin?: Partial<Record<BuiltinItemColumnKey, boolean>>;
}

export const ITEM_DISPLAY_SETTINGS_TENANT_KEY = 'item_display_settings_v1';

export const BUILTIN_ITEM_COLUMNS: Array<{
  key: BuiltinItemColumnKey;
  label: string;
  required?: boolean;
  default_hidden?: boolean;
  /** When true, this column is treated as a tenant-specific custom field in settings UI. */
  tenant_custom?: boolean;
}> = [
  { key: 'photo', label: 'Photo' },
  { key: 'item_code', label: 'Item Code', required: true },
  { key: 'sku', label: 'SKU', default_hidden: true },
  { key: 'quantity', label: 'Qty' },
  { key: 'size', label: 'Size', default_hidden: true },
  { key: 'vendor', label: 'Vendor' },
  { key: 'description', label: 'Description' },
  { key: 'location', label: 'Location' },
  { key: 'client_account', label: 'Account' },
  { key: 'sidemark', label: 'Sidemark', tenant_custom: true },
  { key: 'room', label: 'Room', tenant_custom: true },
  { key: 'class', label: 'Class' },
  { key: 'received_date', label: 'Received Date', default_hidden: true },
];

export const REQUIRED_ITEM_COLUMNS = new Set<ItemColumnKey>(
  BUILTIN_ITEM_COLUMNS.filter((c) => c.required).map((c) => c.key)
);

export function customFieldColumnKey(fieldKey: string): ItemColumnKey {
  return `cf:${fieldKey}`;
}

export function parseCustomFieldColumnKey(columnKey: ItemColumnKey): string | null {
  if (!columnKey.startsWith('cf:')) return null;
  return columnKey.slice(3) || null;
}

export function createDefaultItemDisplaySettings(): ItemDisplaySettingsV1 {
  const order = BUILTIN_ITEM_COLUMNS.map((c) => c.key);
  const hidden = BUILTIN_ITEM_COLUMNS.filter((c) => c.default_hidden).map((c) => c.key);

  return {
    version: 1,
    custom_fields: [],
    views: [
      {
        id: 'default',
        name: 'Default',
        is_default: true,
        order,
        hidden,
      },
    ],
    required_builtin: {},
  };
}

function isItemColumnKey(value: unknown): value is ItemColumnKey {
  return typeof value === 'string' && (value.startsWith('cf:') || BUILTIN_ITEM_COLUMNS.some((c) => c.key === value));
}

function normalizeView(view: Partial<ItemListViewDefinition>, allColumns: ItemColumnKey[]): ItemListViewDefinition {
  const allowed = new Set<ItemColumnKey>(allColumns);
  const rawOrder = Array.isArray(view.order)
    ? view.order.filter((k): k is ItemColumnKey => isItemColumnKey(k) && allowed.has(k as ItemColumnKey))
    : [];
  const rawHidden = Array.isArray(view.hidden)
    ? view.hidden.filter((k): k is ItemColumnKey => isItemColumnKey(k) && allowed.has(k as ItemColumnKey))
    : [];

  // Preserve order, de-dupe, append any new columns.
  const rawOrderSet = new Set<ItemColumnKey>(rawOrder);
  const seen = new Set<ItemColumnKey>();
  const order: ItemColumnKey[] = [];
  for (const k of rawOrder) {
    if (seen.has(k)) continue;
    seen.add(k);
    order.push(k);
  }
  for (const k of allColumns) {
    if (seen.has(k)) continue;
    seen.add(k);
    order.push(k);
  }

  // Ensure default-hidden columns stay hidden when newly introduced.
  const defaultHiddenColumns = new Set<ItemColumnKey>(
    BUILTIN_ITEM_COLUMNS.filter((c) => c.default_hidden).map((c) => c.key)
  );

  const hidden: ItemColumnKey[] = [];
  const hiddenSeen = new Set<ItemColumnKey>();
  for (const k of rawHidden) {
    if (REQUIRED_ITEM_COLUMNS.has(k)) continue;
    if (hiddenSeen.has(k)) continue;
    hiddenSeen.add(k);
    hidden.push(k);
  }
  for (const k of order) {
    if (rawOrderSet.has(k)) continue;
    if (!defaultHiddenColumns.has(k)) continue;
    if (REQUIRED_ITEM_COLUMNS.has(k)) continue;
    if (hiddenSeen.has(k)) continue;
    hiddenSeen.add(k);
    hidden.push(k);
  }

  return {
    id: typeof view.id === 'string' && view.id ? view.id : crypto.randomUUID(),
    name: typeof view.name === 'string' && view.name.trim() ? view.name.trim() : 'View',
    is_default: !!view.is_default,
    order,
    hidden,
  };
}

function normalizeCustomField(raw: Partial<ItemCustomFieldDefinition>): ItemCustomFieldDefinition | null {
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const type = raw.type;
  const enabled = raw.enabled !== false;
  const showInLists = raw.show_in_lists !== false;
  const showOnDetail = raw.show_on_detail !== false;

  if (!key || !label) return null;
  if (!['text', 'number', 'date', 'select', 'checkbox'].includes(String(type))) return null;

  const options =
    type === 'select' && Array.isArray(raw.options)
      ? raw.options.map((o) => String(o).trim()).filter(Boolean)
      : undefined;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    key,
    label,
    type: type as ItemCustomFieldType,
    options,
    enabled,
    show_in_lists: showInLists,
    show_on_detail: showOnDetail,
    required: raw.required === true && enabled && showOnDetail && type !== 'checkbox',
  };
}

export function normalizeItemDisplaySettings(raw: unknown): ItemDisplaySettingsV1 {
  const base = createDefaultItemDisplaySettings();
  const obj = (raw || {}) as Partial<ItemDisplaySettingsV1>;

  const customFields = Array.isArray(obj.custom_fields)
    ? (obj.custom_fields as Array<Partial<ItemCustomFieldDefinition>>)
        .map(normalizeCustomField)
        .filter((f): f is ItemCustomFieldDefinition => !!f)
    : [];

  // Columns available for lists = builtins + enabled custom fields that are allowed in lists
  const customColumns = customFields
    .filter((f) => f.enabled && f.show_in_lists)
    .map((f) => customFieldColumnKey(f.key));

  const allColumns: ItemColumnKey[] = [
    ...BUILTIN_ITEM_COLUMNS.map((c) => c.key),
    ...customColumns,
  ];

  const rawViews = Array.isArray(obj.views) ? (obj.views as Array<Partial<ItemListViewDefinition>>) : [];
  const normalizedViews = rawViews.length > 0 ? rawViews.map((v) => normalizeView(v, allColumns)) : base.views.map((v) => normalizeView(v, allColumns));

  // Ensure exactly one default view.
  let sawDefault = false;
  const views = normalizedViews.map((v) => {
    if (!v.is_default) return v;
    if (sawDefault) return { ...v, is_default: false };
    sawDefault = true;
    return v;
  });
  if (!views.some((v) => v.is_default)) {
    views[0] = { ...views[0], is_default: true };
  }

  // Normalize required builtin fields map (only allow known builtin keys; omit falsey values).
  const rawRequiredBuiltin = (obj as any).required_builtin;
  const requiredBuiltin: Partial<Record<BuiltinItemColumnKey, boolean>> = {};
  if (rawRequiredBuiltin && typeof rawRequiredBuiltin === 'object') {
    for (const col of BUILTIN_ITEM_COLUMNS) {
      const key = col.key;
      // item_code is system-generated; don't block forms even if someone toggles it in raw JSON.
      if (key === 'item_code') continue;
      const v = (rawRequiredBuiltin as any)[key];
      if (v === true) {
        requiredBuiltin[key] = true;
      }
    }
  }

  return {
    version: 1,
    custom_fields: customFields,
    views,
    required_builtin: requiredBuiltin,
  };
}

export function getDefaultViewId(settings: ItemDisplaySettingsV1): string {
  return settings.views.find((v) => v.is_default)?.id || settings.views[0]?.id || 'default';
}

export function getViewById(settings: ItemDisplaySettingsV1, viewId: string | null | undefined): ItemListViewDefinition | null {
  if (!viewId) return null;
  return settings.views.find((v) => v.id === viewId) || null;
}

export function getVisibleColumnsForView(view: ItemListViewDefinition): ItemColumnKey[] {
  return view.order.filter((k) => !view.hidden.includes(k));
}

export function getColumnLabel(settings: ItemDisplaySettingsV1, key: ItemColumnKey): string {
  const builtin = BUILTIN_ITEM_COLUMNS.find((c) => c.key === key);
  if (builtin) return builtin.label;

  const cfKey = parseCustomFieldColumnKey(key);
  if (!cfKey) return key;
  return settings.custom_fields.find((f) => f.key === cfKey)?.label || cfKey;
}

