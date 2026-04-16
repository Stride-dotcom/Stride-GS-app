/**
 * Shared item column configuration for consistent display across the app
 * Used in Inventory, Shipments, Tasks, and other item tables
 * 
 * COLUMN ORDER STANDARD (per requirements):
 * 1) Item Code
 * 2) Qty
 * 3) Vendor
 * 4) Description
 * 5) Location
 * 6) Sidemark
 * 7) Room
 * 8) Item Type
 * 
 * EXCEPTION: Inventory table includes Thumbnail as column #0
 */

export interface ItemColumn {
  key: string;
  label: string;
  width?: string;
  sortable?: boolean;
  visible?: boolean;
  accessor?: (item: any) => string | number | null;
}

/**
 * Standard item columns for Inventory table
 * Includes thumbnail as first column (column #0)
 */
export const INVENTORY_TABLE_COLUMNS: ItemColumn[] = [
  { key: 'thumbnail', label: '', width: '56px', sortable: false },
  { key: 'item_code', label: 'Item Code', sortable: true },
  { key: 'quantity', label: 'Qty', width: '60px', sortable: true },
  { key: 'vendor', label: 'Vendor', sortable: true },
  { key: 'description', label: 'Description', sortable: true },
  { key: 'location', label: 'Location', sortable: true },
  { key: 'sidemark', label: 'Sidemark', sortable: true },
  { key: 'room', label: 'Room', sortable: true },
  { key: 'item_type', label: 'Item Type', sortable: true },
];

/**
 * Standard item columns for Shipments and Tasks tables
 * Same order as inventory but without thumbnail
 */
export const SHIPMENT_TASK_TABLE_COLUMNS: ItemColumn[] = [
  { key: 'item_code', label: 'Item Code', sortable: true },
  { key: 'quantity', label: 'Qty', width: '60px', sortable: true },
  { key: 'vendor', label: 'Vendor', sortable: true },
  { key: 'description', label: 'Description', sortable: true },
  { key: 'location', label: 'Location', sortable: true },
  { key: 'sidemark', label: 'Sidemark', sortable: true },
  { key: 'room', label: 'Room', sortable: true },
  { key: 'item_type', label: 'Item Type', sortable: true },
];

/**
 * Expected item fields for shipment creation
 * Order: Quantity, Vendor, Description, Item Type, Sidemark
 * NOTE: Item ID Code is NOT shown during creation - it's assigned at receiving
 */
export const EXPECTED_ITEM_FIELDS = [
  { key: 'quantity', label: 'Qty', required: true },
  { key: 'vendor', label: 'Vendor', required: false },
  { key: 'description', label: 'Description', required: true },
  { key: 'item_type_id', label: 'Item Type', required: false },
  { key: 'sidemark', label: 'Sidemark', required: false },
] as const;

/**
 * Mobile card display fields (subset for compact display)
 */
export const MOBILE_ITEM_FIELDS = [
  'item_code',
  'quantity',
  'vendor',
  'description',
  'location',
] as const;

/**
 * Get column header for a given key
 */
export function getColumnLabel(key: string): string {
  const column = [...INVENTORY_TABLE_COLUMNS, ...SHIPMENT_TASK_TABLE_COLUMNS].find(c => c.key === key);
  return column?.label || key;
}

/**
 * Item select fields for Supabase queries
 * Standardized select string for item queries with joins
 */
export const ITEM_SELECT_FIELDS = `
  id,
  item_code,
  quantity,
  vendor,
  description,
  sidemark,
  room,
  status,
  client_account,
  primary_photo_url,
  current_location_id,
  item_type_id,
  warehouse_id,
  created_at,
  updated_at,
  received_at,
  item_type:item_types(id, name),
  location:locations!current_location_id(id, code, name),
  warehouse:warehouses(id, name)
`.trim();

/**
 * Minimal item select for list views
 */
export const ITEM_LIST_SELECT_FIELDS = `
  id,
  item_code,
  quantity,
  vendor,
  description,
  sidemark,
  room,
  status,
  client_account,
  primary_photo_url,
  received_at
`.trim();

// ============================================
// SERVICE-BASED BILLING CONFIGURATION
// ============================================

/**
 * Service codes for billing (replacing item_type column-based pricing)
 * This is the source of truth for all billable services
 */
export const SERVICE_CODES = {
  // Core item services
  RECEIVING: 'receiving',
  SHIPPING: 'shipping',
  STORAGE: 'storage',
  ASSEMBLY: 'assembly',
  INSPECTION: 'inspection',
  REPAIR: 'repair',
  WILL_CALL: 'will_call',
  DISPOSAL: 'disposal',
  RETURNS_PROCESSING: 'returns_processing',

  // Handling services
  PICKING: 'picking',
  PACKING: 'packing',
  PULL_FOR_DELIVERY: 'pull_for_delivery',
  CUSTOM_PACKAGING: 'custom_packaging',

  // Accessorial services (flag-based)
  OVERSIZE: 'oversize',
  OVERWEIGHT: 'overweight',
  UNSTACKABLE: 'unstackable',
  CRATE_DISPOSAL: 'crate_disposal',
  MINOR_TOUCHUP: 'minor_touchup',
  RECEIVED_WITHOUT_ID: 'received_without_id',
} as const;

export type ServiceCode = typeof SERVICE_CODES[keyof typeof SERVICE_CODES];

/**
 * Service category for billing classification
 */
export type ServiceCategory = 'item_service' | 'accessorial' | 'storage' | 'labor';

/**
 * Service definition with metadata
 */
export interface ServiceDefinition {
  code: ServiceCode;
  name: string;
  category: ServiceCategory;
  description: string;
  chargeUnit: 'per_item' | 'per_hour' | 'per_day' | 'per_cubic_foot' | 'flat';
}

/**
 * All available services with their definitions
 */
export const SERVICES: ServiceDefinition[] = [
  { code: SERVICE_CODES.RECEIVING, name: 'Receiving', category: 'item_service', description: 'Item receiving and check-in', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.SHIPPING, name: 'Shipping', category: 'item_service', description: 'Item shipping and check-out', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.STORAGE, name: 'Storage', category: 'storage', description: 'Daily/monthly storage', chargeUnit: 'per_day' },
  { code: SERVICE_CODES.ASSEMBLY, name: 'Assembly', category: 'item_service', description: 'Item assembly', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.INSPECTION, name: 'Inspection', category: 'item_service', description: 'Item inspection', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.REPAIR, name: 'Repair', category: 'item_service', description: 'Repair services', chargeUnit: 'per_hour' },
  { code: SERVICE_CODES.WILL_CALL, name: 'Will Call', category: 'item_service', description: 'Will call pickup', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.DISPOSAL, name: 'Disposal', category: 'item_service', description: 'Item disposal', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.RETURNS_PROCESSING, name: 'Returns Processing', category: 'item_service', description: 'Return shipment processing', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.PICKING, name: 'Picking', category: 'item_service', description: 'Order picking', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.PACKING, name: 'Packing', category: 'item_service', description: 'Item packing', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.PULL_FOR_DELIVERY, name: 'Pull for Delivery', category: 'item_service', description: 'Pull item for delivery', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.CUSTOM_PACKAGING, name: 'Custom Packaging', category: 'item_service', description: 'Custom packaging service', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.OVERSIZE, name: 'Oversize Handling', category: 'accessorial', description: 'Extra handling for oversized items', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.OVERWEIGHT, name: 'Overweight Handling', category: 'accessorial', description: 'Extra handling for heavy items', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.UNSTACKABLE, name: 'Unstackable', category: 'accessorial', description: 'Non-stackable item surcharge', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.CRATE_DISPOSAL, name: 'Crate Disposal', category: 'accessorial', description: 'Crate/packaging disposal', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.MINOR_TOUCHUP, name: 'Minor Touchup', category: 'accessorial', description: 'Minor repair/touchup', chargeUnit: 'per_item' },
  { code: SERVICE_CODES.RECEIVED_WITHOUT_ID, name: 'Received Without ID', category: 'accessorial', description: 'Item received without identification', chargeUnit: 'per_item' },
];

/**
 * Get service definition by code
 */
export function getServiceByCode(code: ServiceCode): ServiceDefinition | undefined {
  return SERVICES.find(s => s.code === code);
}

/**
 * Map task type to service code
 */
export function taskTypeToServiceCode(taskType: string): ServiceCode {
  const mapping: Record<string, ServiceCode> = {
    'Receiving': SERVICE_CODES.RECEIVING,
    'Shipping': SERVICE_CODES.SHIPPING,
    'Assembly': SERVICE_CODES.ASSEMBLY,
    'Inspection': SERVICE_CODES.INSPECTION,
    'Repair': SERVICE_CODES.REPAIR,
    'Will Call': SERVICE_CODES.WILL_CALL,
    'Disposal': SERVICE_CODES.DISPOSAL,
    'Picking': SERVICE_CODES.PICKING,
    'Packing': SERVICE_CODES.PACKING,
    'Pull for Delivery': SERVICE_CODES.PULL_FOR_DELIVERY,
  };
  
  return mapping[taskType] || (taskType.toLowerCase().replace(/\s+/g, '_') as ServiceCode);
}

/**
 * Map item flag to service code
 */
export function flagToServiceCode(flagName: string): ServiceCode | null {
  const mapping: Record<string, ServiceCode> = {
    'is_oversize': SERVICE_CODES.OVERSIZE,
    'is_overweight': SERVICE_CODES.OVERWEIGHT,
    'is_unstackable': SERVICE_CODES.UNSTACKABLE,
    'is_crated': SERVICE_CODES.CRATE_DISPOSAL,
    'needs_minor_touchup': SERVICE_CODES.MINOR_TOUCHUP,
    'received_without_id': SERVICE_CODES.RECEIVED_WITHOUT_ID,
  };
  
  return mapping[flagName] || null;
}

/**
 * Get all services by category
 */
export function getServicesByCategory(category: ServiceCategory): ServiceDefinition[] {
  return SERVICES.filter(s => s.category === category);
}
