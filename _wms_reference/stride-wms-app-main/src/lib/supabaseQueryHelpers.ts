/**
 * Schema-aware Supabase query helpers
 * Provides safe soft-delete filtering based on actual table schema
 * 
 * IMPORTANT: This file is the source of truth for table schema capabilities.
 * Update these sets when database schema changes.
 */

// Tables that have a deleted_at column for soft deletes (verified against types.ts)
export const TABLES_WITH_DELETED_AT = new Set([
  'accounts',
  'items',
  'locations',
  'shipments',
  'shipment_items',
  'warehouses',
  'tasks',
  'movements',
  'billing_events',
  'profiles',
  'rate_cards',
  'rate_card_details',
  'documents',
  'item_notes',
  'repair_quotes',
  'account_rate_overrides',
  'item_custom_field_values',
  'user_roles',
  'roles',
  'claims',
  'stocktakes',
  'sidemarks',
  // NOTE: item_photos does NOT have deleted_at
]);

// Tables that use is_active instead of deleted_at (verified against types.ts)
export const TABLES_WITH_IS_ACTIVE = new Set([
  'item_types',
  'employees',
  'billing_charge_templates',
  'labor_rates',
  'account_additional_charges',
  'item_additional_charges',
]);

// Tables with status column (for reference)
export const TABLES_WITH_STATUS = new Set([
  'accounts', // has status column (e.g., 'active', 'inactive')
  'shipments',
  'shipment_items',
  'tasks',
  'items',
  'invoices',
]);

// Tables where accounts should be filtered by status='active' instead of is_active
export const TABLES_USING_STATUS_ACTIVE = new Set([
  'accounts', // Use .eq('status', 'active') for accounts
]);

export type TableWithDeletedAt = 
  | 'accounts'
  | 'items'
  | 'locations'
  | 'shipments'
  | 'shipment_items'
  | 'warehouses'
  | 'tasks'
  | 'movements'
  | 'billing_events'
  | 'profiles'
  | 'rate_cards'
  | 'rate_card_details'
  | 'documents'
  | 'item_notes'
  | 'repair_quotes'
  | 'account_rate_overrides'
  | 'item_custom_field_values'
  | 'user_roles'
  | 'roles';

export type TableWithIsActive =
  | 'item_types'
  | 'employees'
  | 'billing_charge_templates'
  | 'labor_rates'
  | 'account_additional_charges'
  | 'item_additional_charges';

/**
 * Check if a table supports soft delete via deleted_at
 */
export function hasDeletedAt(tableName: string): boolean {
  return TABLES_WITH_DELETED_AT.has(tableName);
}

/**
 * Check if a table uses is_active for filtering
 */
export function hasIsActive(tableName: string): boolean {
  return TABLES_WITH_IS_ACTIVE.has(tableName);
}

/**
 * Check if a table has a status column
 */
export function hasStatus(tableName: string): boolean {
  return TABLES_WITH_STATUS.has(tableName);
}

/**
 * Check if a table uses status='active' for filtering (like accounts)
 */
export function usesStatusActive(tableName: string): boolean {
  return TABLES_USING_STATUS_ACTIVE.has(tableName);
}

/**
 * Apply appropriate "active records" filter to a Supabase query builder
 * Returns the query with the correct filter applied based on table schema
 * 
 * @example
 * const query = supabase.from('accounts').select('*');
 * const filtered = applyActiveFilter(query, 'accounts');
 * // Applies: .is('deleted_at', null) - accounts has deleted_at
 * 
 * @example
 * const query = supabase.from('item_types').select('*');
 * const filtered = applyActiveFilter(query, 'item_types');
 * // Applies: .eq('is_active', true)
 * 
 * @example
 * const query = supabase.from('item_photos').select('*');
 * const filtered = applyActiveFilter(query, 'item_photos');
 * // Returns query unchanged - no soft delete column
 */
export function applyActiveFilter<T extends { is: (col: string, val: null) => T; eq: (col: string, val: boolean | string) => T }>(
  query: T,
  tableName: string
): T {
  if (hasDeletedAt(tableName)) {
    return query.is('deleted_at', null);
  }
  if (hasIsActive(tableName)) {
    return query.eq('is_active', true);
  }
  // No filter needed for tables without soft delete
  return query;
}

/**
 * Get the filter config for a table (for documentation/debugging)
 */
export function getTableFilterConfig(tableName: string): {
  hasDeletedAt: boolean;
  hasIsActive: boolean;
  hasStatus: boolean;
  usesStatusActive: boolean;
  filterType: 'deleted_at' | 'is_active' | 'none';
} {
  const deletedAt = hasDeletedAt(tableName);
  const isActive = hasIsActive(tableName);
  const status = hasStatus(tableName);
  const statusActive = usesStatusActive(tableName);
  
  return {
    hasDeletedAt: deletedAt,
    hasIsActive: isActive,
    hasStatus: status,
    usesStatusActive: statusActive,
    filterType: deletedAt ? 'deleted_at' : isActive ? 'is_active' : 'none',
  };
}

/**
 * Standard select fields for common tables
 * Use these to ensure consistent field selection across the app
 */
export const TABLE_SELECT_FIELDS = {
  accounts: 'id, account_name, account_code, status',
  warehouses: 'id, name, code, address',
  item_types: 'id, name, is_active, sort_order',
  locations: 'id, code, name, warehouse_id, type',
  employees: 'id, first_name, last_name, email, role, is_active',
  item_photos: 'id, storage_url, photo_type, is_primary, item_id, file_name',
} as const;

/**
 * Standard order config for common tables
 */
export const TABLE_ORDER_CONFIG = {
  accounts: { column: 'account_name', ascending: true },
  warehouses: { column: 'name', ascending: true },
  item_types: [
    { column: 'sort_order', ascending: true, nullsFirst: true },
    { column: 'name', ascending: true },
  ],
  locations: { column: 'code', ascending: true },
  employees: { column: 'last_name', ascending: true },
} as const;

/**
 * Log a schema mismatch error with context for debugging
 */
export function logSchemaMismatchError(
  error: { message: string; code?: string; details?: string; hint?: string },
  context: {
    table: string;
    operation: 'select' | 'insert' | 'update' | 'delete';
    query?: string;
    component?: string;
  }
): void {
  const errorInfo = {
    timestamp: new Date().toISOString(),
    errorMessage: error.message,
    errorCode: error.code,
    details: error.details,
    hint: error.hint,
    ...context,
    tableConfig: getTableFilterConfig(context.table),
  };
  
  console.error('[Schema Mismatch]', errorInfo);
  
  // Also log to a more visible format for development
  if (error.code === '42703') { // Column does not exist
    console.error(
      `\n🚨 SCHEMA ERROR: Column does not exist\n` +
      `   Table: ${context.table}\n` +
      `   Operation: ${context.operation}\n` +
      `   Error: ${error.message}\n` +
      `   Component: ${context.component || 'unknown'}\n` +
      `   Hint: Check supabaseQueryHelpers.ts for correct columns\n`
    );
  }
}