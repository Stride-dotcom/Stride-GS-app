export type GlobalHelpSourceType = 'native' | 'label' | 'injected';

export interface GlobalHelpToolSeed {
  pageKey: string;
  pageLabel: string;
  fieldKey: string;
  fieldLabel: string;
  routePath: string;
  helpText: string;
  sourceType: GlobalHelpSourceType;
  targetSelector?: string | null;
}

export interface GlobalHelpPageDefinition {
  pageKey: string;
  label: string;
  fallbackRoute: string;
}

export const HELP_QUERY_PAGE = 'helpPage';
export const HELP_QUERY_FIELD = 'helpField';
export const HELP_QUERY_SELECTOR = 'helpSelector';
export const HELP_QUERY_RETURN = 'helpReturn';
export const HELP_QUERY_ROW = 'helpRow';
export const HELP_PICKER_MODE = 'helpPicker';
export const HELP_PICKER_CHANNEL = 'helpPickerChannel';
export const HELP_PICKER_PAGE = 'helpPickerPage';

const HELP_LAST_ROUTE_PREFIX = 'stride.help.lastRoute.';

const slugify = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

export function buildAutoFieldKeyFromTooltip(tooltip: string): string {
  const slug = slugify(tooltip).slice(0, 52) || 'help_tip';
  return `auto_${slug}`;
}

export function buildAutoFieldLabelFromTooltip(tooltip: string): string {
  const short = tooltip.length > 64 ? `${tooltip.slice(0, 61)}...` : tooltip;
  return short;
}

export function getGlobalHelpLastRouteStorageKey(pageKey: string): string {
  return `${HELP_LAST_ROUTE_PREFIX}${pageKey}`;
}

const fromTooltip = (input: {
  pageKey: string;
  pageLabel: string;
  routePath: string;
  tooltip: string;
  fieldLabel: string;
  sourceType?: GlobalHelpSourceType;
}): GlobalHelpToolSeed => ({
  pageKey: input.pageKey,
  pageLabel: input.pageLabel,
  fieldKey: buildAutoFieldKeyFromTooltip(input.tooltip),
  fieldLabel: input.fieldLabel,
  routePath: input.routePath,
  helpText: input.tooltip,
  sourceType: input.sourceType ?? 'native',
});

export const GLOBAL_HELP_PAGE_DEFINITIONS: GlobalHelpPageDefinition[] = [
  { pageKey: 'settings.locations', label: 'Settings · Locations', fallbackRoute: '/settings?tab=locations' },
  { pageKey: 'settings.service_rates', label: 'Settings · Service Rates', fallbackRoute: '/settings?tab=service-rates' },
  { pageKey: 'settings.organization', label: 'Settings · Organization', fallbackRoute: '/settings?tab=organization' },
  { pageKey: 'settings.alerts', label: 'Settings · Alerts', fallbackRoute: '/settings?tab=alerts' },
  { pageKey: 'incoming.list', label: 'Incoming · List', fallbackRoute: '/incoming/manager?tab=incoming' },
  { pageKey: 'incoming.manifest_detail', label: 'Incoming · Manifest Detail', fallbackRoute: '/incoming/manager?tab=manifests' },
  { pageKey: 'incoming.expected_detail', label: 'Incoming · Expected Detail', fallbackRoute: '/incoming/manager?tab=expected' },
  { pageKey: 'receiving.stage1', label: 'Receiving · Stage 1', fallbackRoute: '/incoming/manager?tab=intakes' },
  { pageKey: 'incoming.allocation_picker', label: 'Incoming · Allocation Picker', fallbackRoute: '/incoming/manager?tab=incoming' },
  { pageKey: 'incoming.dock_intake_matching', label: 'Incoming · Dock Intake Matching', fallbackRoute: '/incoming/manager?tab=intakes' },
  { pageKey: 'incoming.manifest_import', label: 'Incoming · Manifest Import', fallbackRoute: '/incoming/manager?tab=manifests' },
  { pageKey: 'warehouses.map_builder', label: 'Warehouse · Map Builder', fallbackRoute: '/settings?tab=locations' },
  { pageKey: 'quotes.detail', label: 'Quotes · Detail', fallbackRoute: '/quotes' },
  { pageKey: 'locations.detail', label: 'Locations · Detail', fallbackRoute: '/settings?tab=locations' },
  { pageKey: 'containers.list', label: 'Containers · List', fallbackRoute: '/containers' },
  { pageKey: 'containers.detail', label: 'Containers · Detail', fallbackRoute: '/containers' },
  { pageKey: 'containers.create_dialog', label: 'Containers · Create Dialog', fallbackRoute: '/containers' },
  { pageKey: 'containers.scan_to_container_dialog', label: 'Containers · Scan To Container', fallbackRoute: '/containers' },
];

const pageByKey = new Map(
  GLOBAL_HELP_PAGE_DEFINITIONS.map((definition) => [definition.pageKey, definition] as const)
);

export function getHelpPageLabel(pageKey: string): string {
  const fromMap = pageByKey.get(pageKey)?.label;
  if (fromMap) return fromMap;
  return pageKey
    .replace(/[_-]+/g, ' ')
    .replace(/\./g, ' / ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getHelpPageFallbackRoute(pageKey: string): string | null {
  return pageByKey.get(pageKey)?.fallbackRoute ?? null;
}

export function resolveHelpPageKeyFromLocation(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  if (pathname === '/settings') {
    const tab = params.get('tab');
    if (tab === 'locations') return 'settings.locations';
    if (tab === 'service-rates') return 'settings.service_rates';
    if (tab === 'organization') return 'settings.organization';
    if (tab === 'alerts') return 'settings.alerts';
  }
  if (pathname.startsWith('/incoming/manager')) {
    const tab = params.get('tab');
    if (tab === 'incoming') return 'incoming.list';
    if (tab === 'manifests') return 'incoming.manifest_detail';
    if (tab === 'expected') return 'incoming.expected_detail';
    if (tab === 'intakes') return 'receiving.stage1';
    return 'incoming.list';
  }
  if (pathname.startsWith('/incoming/manifest/')) return 'incoming.manifest_detail';
  if (pathname.startsWith('/incoming/expected/')) return 'incoming.expected_detail';
  if (pathname.startsWith('/incoming/dock-intake/')) return 'receiving.stage1';
  if (pathname.startsWith('/warehouses/') && pathname.endsWith('/map')) return 'warehouses.map_builder';
  if (pathname.startsWith('/locations/')) return 'locations.detail';
  if (pathname.startsWith('/quotes')) return 'quotes.detail';
  if (pathname === '/containers') return 'containers.list';
  if (pathname.startsWith('/containers/')) return 'containers.detail';
  return slugify(pathname.replace(/\//g, '.').replace(/^\.+|\.+$/g, '')) || 'app.unknown';
}

export function resolveHelpRouteFromEntry(pageKey: string, routePath: string | null | undefined): {
  routePath: string;
  usedFallback: boolean;
} {
  if (routePath && routePath.trim()) {
    return { routePath, usedFallback: false };
  }
  const fallback = getHelpPageFallbackRoute(pageKey);
  return { routePath: fallback || '/', usedFallback: true };
}

export function cleanHelpRuntimeQuery(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(HELP_QUERY_PAGE);
  params.delete(HELP_QUERY_FIELD);
  params.delete(HELP_QUERY_SELECTOR);
  params.delete(HELP_QUERY_RETURN);
  params.delete(HELP_QUERY_ROW);
  params.delete(HELP_PICKER_MODE);
  params.delete(HELP_PICKER_CHANNEL);
  params.delete(HELP_PICKER_PAGE);
  return params.toString();
}

export function appendHelpNavigationParams(routePath: string, values: {
  pageKey: string;
  fieldKey: string;
  selector?: string | null;
  returnTo?: string | null;
  rowId?: string | null;
}): string {
  const [path, query = ''] = routePath.split('?');
  const params = new URLSearchParams(query);
  params.set(HELP_QUERY_PAGE, values.pageKey);
  params.set(HELP_QUERY_FIELD, values.fieldKey);
  if (values.selector) params.set(HELP_QUERY_SELECTOR, values.selector);
  if (values.returnTo) params.set(HELP_QUERY_RETURN, values.returnTo);
  if (values.rowId) params.set(HELP_QUERY_ROW, values.rowId);
  return `${path}?${params.toString()}`;
}

export function matchesEntryRoute(routePath: string | null | undefined, pathname: string, search: string): boolean {
  if (!routePath) return false;
  const [targetPath, targetQuery = ''] = routePath.split('?');
  if (targetPath !== pathname) return false;

  const targetParams = new URLSearchParams(targetQuery);
  const activeParams = new URLSearchParams(search);
  for (const [key, value] of targetParams.entries()) {
    if (activeParams.get(key) !== value) return false;
  }
  return true;
}

export const GLOBAL_HELP_TOOL_SEEDS: GlobalHelpToolSeed[] = [
  {
    pageKey: 'settings.locations',
    pageLabel: 'Settings · Locations',
    fieldKey: 'import_export_help',
    fieldLabel: 'Import / Export workflow',
    routePath: '/settings?tab=locations',
    helpText: 'Tip: Export your current locations to Excel, edit the rows, then re-import to apply bulk updates. Import uses Warehouse + Code as the unique key: matching codes are updated (not duplicated), and new codes create new locations. For zone assignment imports, use CLEAR to explicitly unassign a zone.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.list',
    pageLabel: 'Incoming · List',
    fieldKey: 'filters_toolbar',
    fieldLabel: 'Filters toolbar',
    routePath: '/incoming/manager?tab=incoming',
    helpText: 'Filter and search inbound shipments. Click a row to view details, allocate items, or manage references.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.manifest_detail',
    pageLabel: 'Incoming · Manifest Detail',
    fieldKey: 'external_refs',
    fieldLabel: 'External references',
    routePath: '/incoming/manager?tab=manifests',
    helpText: 'BOL, PRO, tracking numbers, POs. Used for matching dock intakes to manifests and expected shipments.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.manifest_detail',
    pageLabel: 'Incoming · Manifest Detail',
    fieldKey: 'manifest_items',
    fieldLabel: 'Manifest items',
    routePath: '/incoming/manager?tab=manifests',
    helpText: 'Items on this manifest. Select items and click Allocate to assign them to an expected shipment.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.expected_detail',
    pageLabel: 'Incoming · Expected Detail',
    fieldKey: 'carrier_name',
    fieldLabel: 'Carrier name',
    routePath: '/incoming/manager?tab=expected',
    helpText: 'The shipping carrier or trucking company delivering this shipment.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.expected_detail',
    pageLabel: 'Incoming · Expected Detail',
    fieldKey: 'external_refs',
    fieldLabel: 'External references',
    routePath: '/incoming/manager?tab=expected',
    helpText: 'BOL, PRO, tracking numbers, POs. These references are used to match dock intakes to this expected shipment.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.expected_detail',
    pageLabel: 'Incoming · Expected Detail',
    fieldKey: 'expected_items',
    fieldLabel: 'Expected items',
    routePath: '/incoming/manager?tab=expected',
    helpText: 'Items expected in this shipment. Items may be created manually or through allocation from a manifest.',
    sourceType: 'native',
  },
  {
    pageKey: 'receiving.stage1',
    pageLabel: 'Receiving · Stage 1',
    fieldKey: 'carrier_count',
    fieldLabel: 'Carrier count',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Carrier paperwork piece count (what you sign for).',
    sourceType: 'native',
  },
  {
    pageKey: 'receiving.stage1',
    pageLabel: 'Receiving · Stage 1',
    fieldKey: 'dock_count',
    fieldLabel: 'Dock count',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Physical piece count at the dock (Stage 1 actual count).',
    sourceType: 'native',
  },
  {
    pageKey: 'receiving.stage1',
    pageLabel: 'Receiving · Stage 1',
    fieldKey: 'entry_count',
    fieldLabel: 'Entry count',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Read-only. Calculated from Stage 2 item rows.',
    sourceType: 'native',
  },
  {
    pageKey: 'receiving.stage1',
    pageLabel: 'Receiving · Stage 1',
    fieldKey: 'unit_breakdown',
    fieldLabel: 'Unit breakdown',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Enter cartons/pallets/crates. Dock Count will auto-calculate as the sum.',
    sourceType: 'native',
  },
  {
    pageKey: 'receiving.stage1',
    pageLabel: 'Receiving · Stage 1',
    fieldKey: 'exceptions',
    fieldLabel: 'Exceptions',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Select any exceptions observed at the dock. If you select an exception, add a note for each selected chip. Shortage/Overage auto-syncs when Carrier and Dock counts differ.',
    sourceType: 'native',
  },
  {
    pageKey: 'receiving.stage1',
    pageLabel: 'Receiving · Stage 1',
    fieldKey: 'photos',
    fieldLabel: 'Photos',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Capture or upload photos (paperwork, condition, etc.).',
    sourceType: 'native',
  },
  {
    pageKey: 'receiving.stage1',
    pageLabel: 'Receiving · Stage 1',
    fieldKey: 'documents',
    fieldLabel: 'Documents',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Capture or upload delivery paperwork. Tap a document thumbnail to open it, or use the download icon to email/print.',
    sourceType: 'native',
  },
  {
    pageKey: 'receiving.stage1',
    pageLabel: 'Receiving · Stage 1',
    fieldKey: 'billing',
    fieldLabel: 'Billing panel',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Shows billing preview + recorded charges. Use Add Charge/Add Credit to adjust billing. (Manager/Admin only)',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.allocation_picker',
    pageLabel: 'Incoming · Allocation Picker',
    fieldKey: 'allocation_workflow',
    fieldLabel: 'Allocation workflow',
    routePath: '/incoming/manager?tab=incoming',
    helpText: 'Select an expected shipment on the right, adjust quantities on the left, then click Allocate. This creates explicit provenance links between manifest items and expected items.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.allocation_picker',
    pageLabel: 'Incoming · Allocation Picker',
    fieldKey: 'expected_shipment_selector',
    fieldLabel: 'Expected shipment selector',
    routePath: '/incoming/manager?tab=incoming',
    helpText: 'Choose which expected shipment to allocate manifest items to. Items are copied to the expected shipment with explicit provenance.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.dock_intake_matching',
    pageLabel: 'Incoming · Dock Intake Matching',
    fieldKey: 'reference_lookup',
    fieldLabel: 'Reference lookup',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Enter a BOL, PRO, tracking, or PO number to find matching manifests/expected shipments. Results are account-scoped.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.dock_intake_matching',
    pageLabel: 'Incoming · Dock Intake Matching',
    fieldKey: 'matching_candidates',
    fieldLabel: 'Matching candidates',
    routePath: '/incoming/manager?tab=intakes',
    helpText: 'Candidates are shown only for the selected account and ranked by match priority: tracking, reference, SKU, vendor, description, then shipper.',
    sourceType: 'native',
  },
  {
    pageKey: 'incoming.manifest_import',
    pageLabel: 'Incoming · Manifest Import',
    fieldKey: 'spreadsheet_upload',
    fieldLabel: 'Spreadsheet upload',
    routePath: '/incoming/manager?tab=manifests',
    helpText: 'Upload a CSV or XLSX file with item details. Optionally include a ZIP file with photos to auto-attach.',
    sourceType: 'native',
  },
  {
    pageKey: 'warehouses.map_builder',
    pageLabel: 'Warehouse · Map Builder',
    fieldKey: 'zone_selection',
    fieldLabel: 'Zone selection',
    routePath: '/settings?tab=locations',
    helpText: 'Filter and select one zone to link locations or assign zone alias. Select multiple zones to stage zone group assignment.',
    sourceType: 'native',
  },
  {
    pageKey: 'warehouses.map_builder',
    pageLabel: 'Warehouse · Map Builder',
    fieldKey: 'location_staging',
    fieldLabel: 'Location staging',
    routePath: '/settings?tab=locations',
    helpText: 'Type to filter locations (for example A1). Select filtered locations, then stage them into the selected zone.',
    sourceType: 'native',
  },
  {
    pageKey: 'warehouses.map_builder',
    pageLabel: 'Warehouse · Map Builder',
    fieldKey: 'zone_alias',
    fieldLabel: 'Zone alias',
    routePath: '/settings?tab=locations',
    helpText: 'Zone alias is the text shown inside the zone block. Select one zone, then stage alias value and save.',
    sourceType: 'native',
  },
  {
    pageKey: 'warehouses.map_builder',
    pageLabel: 'Warehouse · Map Builder',
    fieldKey: 'zone_group',
    fieldLabel: 'Zone group',
    routePath: '/settings?tab=locations',
    helpText: 'Zone group is a shared tag across many zone blocks. Select one or more zones, choose group value, then stage and save.',
    sourceType: 'native',
  },
  {
    pageKey: 'quotes.detail',
    pageLabel: 'Quotes · Detail',
    fieldKey: 'documents',
    fieldLabel: 'Documents',
    routePath: '/quotes',
    helpText: 'Upload quote-related documents (specs, photos, paperwork). Tap a thumbnail to open, or use the download icon to download.',
    sourceType: 'native',
  },
  {
    pageKey: 'locations.detail',
    pageLabel: 'Locations · Detail',
    fieldKey: 'volume_utilization',
    fieldLabel: 'Volume utilization',
    routePath: '/settings?tab=locations',
    helpText: 'Shows the volume utilization of this location based on inventory units and containers stored here. Calculated using the org-level capacity mode (bounded footprint or units-only).',
    sourceType: 'native',
  },
  {
    pageKey: 'locations.detail',
    pageLabel: 'Locations · Detail',
    fieldKey: 'containers_at_location',
    fieldLabel: 'Containers at location',
    routePath: '/settings?tab=locations',
    helpText: 'Containers currently located at this storage location. Move containers between locations to relocate all their contents at once.',
    sourceType: 'native',
  },
  {
    pageKey: 'locations.detail',
    pageLabel: 'Locations · Detail',
    fieldKey: 'inventory_units',
    fieldLabel: 'Inventory units',
    routePath: '/settings?tab=locations',
    helpText: 'All inventory units physically present at this location, whether in containers or loose. Based on unit.location_id truth — not display-only.',
    sourceType: 'native',
  },
  {
    pageKey: 'locations.detail',
    pageLabel: 'Locations · Detail',
    fieldKey: 'group_by',
    fieldLabel: 'Group by',
    routePath: '/settings?tab=locations',
    helpText: 'Group units by shared attribute. View-only — does not affect data.',
    sourceType: 'native',
  },
  {
    pageKey: 'locations.detail',
    pageLabel: 'Locations · Detail',
    fieldKey: 'view_mode',
    fieldLabel: 'View mode',
    routePath: '/settings?tab=locations',
    helpText: 'Switch between detailed table rows and a compact single-line format.',
    sourceType: 'native',
  },
  {
    pageKey: 'containers.scan_to_container_dialog',
    pageLabel: 'Containers · Scan To Container',
    fieldKey: 'scan_units',
    fieldLabel: 'Scan / add units',
    routePath: '/containers',
    helpText: "Scan or type IC codes to add inventory units into this container. Units will be moved to the container's location automatically.",
    sourceType: 'native',
  },
  {
    pageKey: 'containers.create_dialog',
    pageLabel: 'Containers · Create Dialog',
    fieldKey: 'container_code',
    fieldLabel: 'Container code',
    routePath: '/containers',
    helpText: 'Optional override. Leave blank to auto-generate a CNT-##### barcode code.',
    sourceType: 'native',
  },
  {
    pageKey: 'containers.create_dialog',
    pageLabel: 'Containers · Create Dialog',
    fieldKey: 'container_type',
    fieldLabel: 'Container type',
    routePath: '/containers',
    helpText: 'The physical type of container. Affects default handling and capacity calculations.',
    sourceType: 'native',
  },
  {
    pageKey: 'containers.create_dialog',
    pageLabel: 'Containers · Create Dialog',
    fieldKey: 'container_footprint_cu_ft',
    fieldLabel: 'Container footprint volume',
    routePath: '/containers',
    helpText: 'The physical footprint volume of the container itself. Used in bounded footprint capacity calculations. Leave empty if unknown.',
    sourceType: 'native',
  },
  {
    pageKey: 'containers.detail',
    pageLabel: 'Containers · Detail',
    fieldKey: 'unit_count',
    fieldLabel: 'Unit count',
    routePath: '/containers',
    helpText: 'Total number of inventory units currently stored in this container.',
    sourceType: 'native',
  },
  {
    pageKey: 'containers.detail',
    pageLabel: 'Containers · Detail',
    fieldKey: 'footprint_volume',
    fieldLabel: 'Footprint volume',
    routePath: '/containers',
    helpText: 'The physical footprint volume of the container itself, used in bounded footprint capacity calculations. Click the edit icon to update.',
    sourceType: 'native',
  },
  {
    pageKey: 'containers.detail',
    pageLabel: 'Containers · Detail',
    fieldKey: 'inventory_units',
    fieldLabel: 'Container inventory units',
    routePath: '/containers',
    helpText: 'Inventory units stored inside this container. Removing a unit keeps it at the same location but detaches it from the container.',
    sourceType: 'native',
  },
  {
    pageKey: 'containers.detail',
    pageLabel: 'Containers · Detail',
    fieldKey: 'view_mode',
    fieldLabel: 'View mode',
    routePath: '/containers',
    helpText: 'Switch between detailed table rows and a compact single-line format.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'flag_alert_behavior_create',
    fieldLabel: 'Flag alert behavior (create)',
    routePath: '/settings?tab=service-rates',
    helpText: 'When enabled, applying this flag to an item will send email and in-app notifications to configured recipients.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'flag_active_state_create',
    fieldLabel: 'Flag active state (create)',
    routePath: '/settings?tab=service-rates',
    helpText: 'Inactive flags are hidden from the item flags panel and cannot be applied to items.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'flag_alert_behavior_edit',
    fieldLabel: 'Flag alert behavior (edit)',
    routePath: '/settings?tab=service-rates',
    helpText: 'When enabled, applying this flag to an item will send email and in-app notifications to configured recipients. A per-flag alert trigger is automatically created in Communications settings.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'flag_active_state_edit',
    fieldLabel: 'Flag active state (edit)',
    routePath: '/settings?tab=service-rates',
    helpText: 'Inactive flags are hidden from the item flags panel and cannot be applied to items.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.organization',
    pageLabel: 'Settings · Organization',
    fieldKey: 'scan_shortcuts',
    fieldLabel: 'Scan shortcuts',
    routePath: '/settings?tab=organization',
    helpText: 'Optional shortcuts when a user scans a container or location label in a workflow that expects item codes.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.organization',
    pageLabel: 'Settings · Organization',
    fieldKey: 'space_tracking_overview',
    fieldLabel: 'Space tracking overview',
    routePath: '/settings?tab=organization',
    helpText: 'Controls how inventory space usage is tracked across locations. Affects capacity calculations and utilization reporting.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.organization',
    pageLabel: 'Settings · Organization',
    fieldKey: 'space_tracking_mode',
    fieldLabel: 'Tracking mode',
    routePath: '/settings?tab=organization',
    helpText: 'None: no space tracking. Cubic Feet Only: track unit volumes without individual dimensions. Dimensions: store L x W x H per unit with auto-computed cubic feet and class-based defaults.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.organization',
    pageLabel: 'Settings · Organization',
    fieldKey: 'space_capacity_mode',
    fieldLabel: 'Capacity mode',
    routePath: '/settings?tab=organization',
    helpText: 'Units Only: sum all unit volumes directly. Bounded Footprint: use the container footprint as a ceiling when set — if total contents exceed the footprint, use contents volume instead. Falls back to units-only when footprint is not set.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.organization',
    pageLabel: 'Settings · Organization',
    fieldKey: 'company_name',
    fieldLabel: 'Company name',
    routePath: '/settings?tab=organization',
    helpText: 'This name will be displayed on quotes, invoices, and alert templates sent to your customers.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.alerts',
    pageLabel: 'Settings · Alerts',
    fieldKey: 'audience_filter_help',
    fieldLabel: 'Audience type',
    routePath: '/settings?tab=alerts',
    helpText: "Internal alerts go to your team (warehouse staff, managers). Client-facing alerts go to your customers' contacts. 'Both' means the alert targets both audiences.",
    sourceType: 'native',
  },
  {
    pageKey: 'settings.alerts',
    pageLabel: 'Settings · Alerts',
    fieldKey: 'module_group_help',
    fieldLabel: 'Module group help',
    routePath: '/settings?tab=alerts',
    helpText: 'Alerts grouped by module include category-level guidance about what each group represents.',
    sourceType: 'native',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'service_name',
    fieldLabel: 'Service Name',
    routePath: '/settings?tab=service-rates',
    helpText: 'The display name for this service. Appears on invoices, quotes, and work orders.',
    sourceType: 'label',
    targetSelector: '#serviceName',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'service_code',
    fieldLabel: 'Service Code',
    routePath: '/settings?tab=service-rates',
    helpText: 'A short unique code for this service. Auto-generated from the name but can be customized. Used in reports and integrations.',
    sourceType: 'label',
    targetSelector: '#serviceCode',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'description',
    fieldLabel: 'Description',
    routePath: '/settings?tab=service-rates',
    helpText: 'Brief description shown on invoices and reports. Helps staff and customers understand what this service covers.',
    sourceType: 'label',
    targetSelector: '#description',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'gl_code',
    fieldLabel: 'GL Account Code',
    routePath: '/settings?tab=service-rates',
    helpText: 'General Ledger code for accounting integration. Links charges to the correct revenue account.',
    sourceType: 'label',
    targetSelector: '#glCode',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'service_category',
    fieldLabel: 'Service Category',
    routePath: '/settings?tab=service-rates',
    helpText: 'Groups related services together for organization, reporting, and filtering.',
    sourceType: 'label',
    targetSelector: '[data-field="category"]',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'pricing_method',
    fieldLabel: 'Pricing Method',
    routePath: '/settings?tab=service-rates',
    helpText: "How rates are calculated. 'Class-Based' uses different rates per item class. 'Flat Per Item' charges the same for every item. 'Flat Per Task' charges once per job. 'Unit Price' is for sellable materials billed by quantity. 'No Charge' is for tracking-only services with no billing.",
    sourceType: 'label',
    targetSelector: '[data-field="pricing"]',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'billing_trigger',
    fieldLabel: 'Billing Trigger',
    routePath: '/settings?tab=service-rates',
    helpText: "Determines when the system automatically creates a charge. A charge can always be added manually, via Scan Hub, or via Flag regardless of this setting. 'Receiving' triggers on inbound processing. 'Task Completion' triggers when a linked task is marked done. 'Storage' accrues daily/monthly. 'Manual' means no automatic creation.",
    sourceType: 'label',
    targetSelector: '[data-field="trigger"]',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'active',
    fieldLabel: 'Active',
    routePath: '/settings?tab=service-rates',
    helpText: 'When active, this service is available for use on work orders, quotes, and billing. Inactive services are hidden from selection but historical data is preserved.',
    sourceType: 'label',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'taxable',
    fieldLabel: 'Taxable',
    routePath: '/settings?tab=service-rates',
    helpText: "When enabled, sales tax will be automatically applied to this charge based on the customer's tax rate settings.",
    sourceType: 'label',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'scan_hub_toggle',
    fieldLabel: 'Scan Hub',
    routePath: '/settings?tab=service-rates',
    helpText: 'If enabled, this service appears as a quick action in Scan Hub.',
    sourceType: 'label',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'flag_toggle',
    fieldLabel: 'Flag',
    routePath: '/settings?tab=service-rates',
    helpText: 'Enable flag behaviors for this service.',
    sourceType: 'label',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'flag_billing',
    fieldLabel: 'Flag Billing',
    routePath: '/settings?tab=service-rates',
    helpText: 'When flagged on an item, creates a billing event at the configured rate.',
    sourceType: 'label',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'flag_indicator',
    fieldLabel: 'Flag Indicator',
    routePath: '/settings?tab=service-rates',
    helpText: 'Shows a bold visual marker like FRAGILE on the item details page.',
    sourceType: 'label',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'flag_alert_office',
    fieldLabel: 'Flag Alert',
    routePath: '/settings?tab=service-rates',
    helpText: 'Sends an email notification to the office when this flag is applied to an item.',
    sourceType: 'label',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'internal_notes',
    fieldLabel: 'Internal Notes',
    routePath: '/settings?tab=service-rates',
    helpText: 'Notes visible only to staff. Use for internal guidance about when to apply this service, special handling instructions, or billing rules.',
    sourceType: 'label',
    targetSelector: '#internalNotes',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'rate',
    fieldLabel: 'Rate',
    routePath: '/settings?tab=service-rates',
    helpText: 'The charge amount for this service. Can be overridden per-customer in account pricing settings.',
    sourceType: 'label',
    targetSelector: '#flatRate',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'unit',
    fieldLabel: 'Unit',
    routePath: '/settings?tab=service-rates',
    helpText: 'The billing unit displayed on invoices. Auto-set based on pricing method but can be customized.',
    sourceType: 'label',
    targetSelector: '#flatUnit',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'min_charge',
    fieldLabel: 'Min Charge',
    routePath: '/settings?tab=service-rates',
    helpText: 'If the calculated charge falls below this amount, the minimum will be used instead. Protects against unprofitable small orders.',
    sourceType: 'label',
    targetSelector: '#flatMinCharge',
  },
  {
    pageKey: 'settings.service_rates',
    pageLabel: 'Settings · Service Rates',
    fieldKey: 'service_time',
    fieldLabel: 'Service Time',
    routePath: '/settings?tab=service-rates',
    helpText: 'Estimated time to complete this service in minutes. Used for scheduling, capacity planning, and dashboard time estimates.',
    sourceType: 'label',
    targetSelector: '#flatServiceTime',
  },
];

export const GLOBAL_HELP_FIELD_LABELS = new Map(
  GLOBAL_HELP_TOOL_SEEDS.map((seed) => [`${seed.pageKey}:${seed.fieldKey}`, seed.fieldLabel] as const)
);

export function getHelpFieldLabel(pageKey: string, fieldKey: string): string {
  const existing = GLOBAL_HELP_FIELD_LABELS.get(`${pageKey}:${fieldKey}`);
  if (existing) return existing;
  return fieldKey
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
