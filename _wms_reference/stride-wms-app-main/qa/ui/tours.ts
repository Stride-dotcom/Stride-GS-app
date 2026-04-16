/**
 * Page Tours - Scripted UI Interactions
 *
 * Defines interactive tours for each route to test UI states and functionality.
 * Tours are "safe" - they default to read-only interactions (open/close dialogs).
 *
 * Priority Levels:
 * - P0: Mission Critical - FAIL run if any fail
 * - P1: Important - report failures, do not fail run
 * - P2: Informational/Dev - screenshots only
 */

export type TourAction =
  // === Original safe actions ===
  | 'click'
  | 'openDropdown'
  | 'openModal'
  | 'closeModal'
  | 'type'
  | 'scroll'
  | 'scrollToBottom'
  | 'scrollToElement'
  | 'waitFor'
  | 'expectVisible'
  | 'navigateBack'
  | 'screenshot'
  | 'pressKey'
  // === Deep E2E actions (write/mutate data) ===
  | 'fill'              // Clear field then type a value (for form inputs)
  | 'selectOption'      // Pick a value from a <select> or SearchableSelect
  | 'selectCombobox'    // Open a combobox/popover, search, and pick a match
  | 'clickByText'       // Click an element that contains specific text
  | 'uploadFile'        // Attach a file to an <input type="file">
  | 'assertText'        // Assert that a selector contains specific text
  | 'assertVisible'     // Assert selector is visible (hard fail if not)
  | 'assertHidden'      // Assert selector is hidden / not visible
  | 'assertUrl'         // Assert current URL matches a pattern
  | 'assertToast'       // Wait for a toast notification with specific text
  | 'assertCount'       // Assert number of elements matching selector
  | 'submitForm'        // Click submit button and wait for navigation/toast
  | 'navigate'          // Go to a specific URL
  | 'storeValue'        // Store a value from the page into shared context
  | 'useStoredValue'    // Use a previously stored value in a fill/type action
  | 'waitForNavigation' // Wait for URL to change
  | 'waitForNetwork'    // Wait for network requests to settle
  | 'clearField'        // Clear a form field
  | 'checkCheckbox'     // Check a checkbox (idempotent)
  | 'uncheckCheckbox'   // Uncheck a checkbox (idempotent)
  | 'toggleSwitch'      // Toggle a switch component
  | 'selectTab'         // Click a tab by its text or index
  | 'selectDate'        // Fill a date input with a formatted date
  | 'clickTableRow'     // Click a row in a table that contains specific text
  | 'dragAndDrop'       // Drag from one selector to another
  | 'pause';            // Wait a fixed number of milliseconds

export type RoleContext = 'admin' | 'warehouse_user' | 'client';
export type Priority = 'P0' | 'P1' | 'P2';
export type TourMode = 'safe' | 'deep';

export interface TourStep {
  action: TourAction;
  selector?: string;
  value?: string;
  /** Second selector (used by dragAndDrop, selectCombobox popover target, etc.) */
  targetSelector?: string;
  /** Numeric value (used by assertCount expected count, pause duration ms, etc.) */
  count?: number;
  /** Key to store/retrieve values in shared context across steps */
  storeKey?: string;
  screenshotAfter?: boolean;
  note?: string;
  optional?: boolean; // If true, step failure won't fail the tour
  timeout?: number;
}

export interface PageTour {
  route: string;
  name: string;
  roleContext: RoleContext;
  priority: Priority;
  mode: TourMode;          // 'safe' = read-only, 'deep' = creates/modifies data
  requiresId?: boolean;    // Route has :id param
  /** If set, this tour needs data created by a previous tour */
  dependsOn?: string[];
  /** Tags for filtering (e.g., 'shipments', 'billing', 'photos') */
  tags?: string[];
  primaryActionSelector?: string; // Save/Submit/Complete button for buffer check
  steps: TourStep[];
}

/**
 * Error codes for UI Visual QA failures
 */
export const ERROR_CODES = {
  SCROLL_LOCKED: 'SCROLL_LOCKED',
  INSUFFICIENT_SCROLL_BUFFER: 'INSUFFICIENT_SCROLL_BUFFER',
  PRIMARY_ACTION_NOT_REACHABLE: 'PRIMARY_ACTION_NOT_REACHABLE',
  HORIZONTAL_OVERFLOW: 'HORIZONTAL_OVERFLOW',
  BLANK_CONTENT: 'BLANK_CONTENT',
  CONSOLE_ERROR: 'CONSOLE_ERROR',
  UNCAUGHT_EXCEPTION: 'UNCAUGHT_EXCEPTION',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  AXE_CRITICAL: 'AXE_CRITICAL',
  AXE_SERIOUS: 'AXE_SERIOUS',
  TOUR_STEP_FAILED: 'TOUR_STEP_FAILED',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export const pageTours: PageTour[] = [
  // ============================================================
  // P0 - MISSION CRITICAL
  // ============================================================

  // SCAN HUB - P0 (warehouse operations critical)
  {
    route: '/scan',
    name: 'Scan Hub Tour',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'safe',
    primaryActionSelector: '[data-testid="confirm-move-button"]',
    steps: [
      { action: 'screenshot', note: 'Scan hub initial' },
      { action: 'expectVisible', selector: '[data-testid="scan-input"]', optional: true },
      { action: 'click', selector: '[data-testid="move-mode-toggle"]', note: 'Toggle move mode', optional: true },
      { action: 'screenshot', note: 'Move mode enabled' },
      { action: 'click', selector: '[data-testid="move-mode-toggle"]', note: 'Toggle move mode off', optional: true },
      { action: 'click', selector: '[data-testid="location-search-button"]', note: 'Open location search', optional: true },
      { action: 'screenshot', note: 'Location search open' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final scan hub' },
    ],
  },

  // SHIPMENT DETAIL - P0 (receiving/releasing critical)
  {
    route: '/shipments/:id',
    name: 'Shipment Detail Tour',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'safe',
    requiresId: true,
    primaryActionSelector: '[data-testid="finish-receiving-button"], [data-testid="complete-outbound-button"]',
    steps: [
      { action: 'screenshot', note: 'Shipment detail initial' },
      { action: 'expectVisible', selector: '[data-testid="shipment-header"]', optional: true },
      { action: 'click', selector: '[data-testid="shipment-tab-overview"]', screenshotAfter: true, note: 'Overview tab', optional: true },
      { action: 'click', selector: '[data-testid="shipment-tab-items"]', screenshotAfter: true, note: 'Items tab', optional: true },
      { action: 'click', selector: '[data-testid="shipment-tab-photos"]', screenshotAfter: true, note: 'Photos tab', optional: true },
      { action: 'click', selector: '[data-testid="shipment-tab-tasks"]', screenshotAfter: true, note: 'Tasks tab', optional: true },
      { action: 'click', selector: '[data-testid="add-photo-button"]', note: 'Open add photo', optional: true },
      { action: 'pressKey', value: 'Escape', note: 'Close photo dialog' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'click', selector: '[data-testid="finish-receiving-button"]', note: 'Open finish receiving', optional: true },
      { action: 'screenshot', note: 'Finish receiving dialog' },
      { action: 'pressKey', value: 'Escape', note: 'Cancel finish receiving' },
      { action: 'screenshot', note: 'Final shipment detail' },
    ],
  },

  // TASK DETAIL - P0 (task completion critical)
  {
    route: '/tasks/:id',
    name: 'Task Detail Tour',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'safe',
    requiresId: true,
    primaryActionSelector: '[data-testid="complete-task-button"], [data-testid="start-task-button"]',
    steps: [
      { action: 'screenshot', note: 'Task detail initial' },
      { action: 'expectVisible', selector: '[data-testid="task-header"]', optional: true },
      { action: 'click', selector: '[data-testid="start-task-button"]', note: 'Open start task', optional: true },
      { action: 'screenshot', note: 'Start task confirmation' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'click', selector: '[data-testid="add-note-button"]', note: 'Open add note', optional: true },
      { action: 'screenshot', note: 'Add note dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'click', selector: '[data-testid="add-photo-button"]', note: 'Open add photo', optional: true },
      { action: 'screenshot', note: 'Add photo dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'click', selector: '[data-testid="complete-task-button"]', note: 'Open complete task', optional: true },
      { action: 'screenshot', note: 'Complete task dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'screenshot', note: 'Final task detail' },
    ],
  },

  // STOCKTAKE SCAN - P0 (inventory counting critical)
  {
    route: '/stocktakes/:id/scan',
    name: 'Stocktake Scan Tour',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'safe',
    requiresId: true,
    primaryActionSelector: '[data-testid="close-stocktake-button"], [data-testid="start-stocktake-button"]',
    steps: [
      { action: 'screenshot', note: 'Stocktake scan initial' },
      { action: 'expectVisible', selector: '[data-testid="scan-input"]', optional: true },
      { action: 'click', selector: '[data-testid="start-stocktake-button"]', note: 'Start stocktake', optional: true },
      { action: 'screenshot', note: 'Stocktake started' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final stocktake scan' },
    ],
  },

  // REPAIR QUOTE DETAIL - P0 (quote acceptance critical)
  {
    route: '/repair-quotes/:id',
    name: 'Repair Quote Detail Tour',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'safe',
    requiresId: true,
    primaryActionSelector: '[data-testid="send-quote-button"], [data-testid="save-pricing-button"]',
    steps: [
      { action: 'screenshot', note: 'Repair quote detail initial' },
      { action: 'expectVisible', selector: '[data-testid="quote-header"]', optional: true },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final repair quote detail' },
    ],
  },

  // CLIENT PORTAL - P0 (client-facing critical)
  {
    route: '/client',
    name: 'Client Dashboard Tour',
    roleContext: 'client',
    priority: 'P0',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Client dashboard initial' },
      { action: 'expectVisible', selector: '[data-testid="client-header"]', optional: true },
      { action: 'click', selector: '[data-testid="client-nav-items"]', note: 'Navigate to items', optional: true },
      { action: 'screenshot', note: 'Client items page' },
      { action: 'navigateBack' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final client dashboard' },
    ],
  },
  {
    route: '/client/items',
    name: 'Client Items Tour',
    roleContext: 'client',
    priority: 'P0',
    mode: 'safe',
    primaryActionSelector: '[data-testid="request-repair-quote-button"]',
    steps: [
      { action: 'screenshot', note: 'Client items initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]', optional: true },
      { action: 'type', selector: '[data-testid="search-input"]', value: 'test', note: 'Search items', optional: true },
      { action: 'screenshot', note: 'Search results' },
      { action: 'click', selector: '[data-testid="item-row"]:first-child', note: 'Click first item', optional: true },
      { action: 'screenshot', note: 'Item detail dialog' },
      { action: 'scrollToElement', selector: '[data-testid="request-repair-quote-button"]', note: 'Scroll to repair quote button', optional: true },
      { action: 'screenshot', note: 'Repair quote section visible' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final client items' },
    ],
  },
  {
    route: '/client/quotes',
    name: 'Client Quotes Tour',
    roleContext: 'client',
    priority: 'P0',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Client quotes initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]', optional: true },
      { action: 'click', selector: '[data-testid="quote-row"]:first-child', note: 'Click first quote', optional: true },
      { action: 'screenshot', note: 'Quote detail' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final client quotes' },
    ],
  },
  {
    route: '/client/claims',
    name: 'Client Claims Tour',
    roleContext: 'client',
    priority: 'P0',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Client claims initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]', optional: true },
      { action: 'click', selector: '[data-testid="claim-row"]:first-child', note: 'Click first claim', optional: true },
      { action: 'screenshot', note: 'Claim detail' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final client claims' },
    ],
  },

  // ============================================================
  // P1 - IMPORTANT (report failures, don't fail run)
  // ============================================================

  // DASHBOARD - P1
  {
    route: '/',
    name: 'Dashboard Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Initial dashboard state' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]', note: 'Page header visible' },
      { action: 'expectVisible', selector: '[data-testid="dashboard-tile-put_away"]', note: 'Put Away tile visible', optional: true },
      { action: 'click', selector: '[data-testid="dashboard-tile-put_away"]', screenshotAfter: true, note: 'Click Put Away tile', optional: true },
      { action: 'navigateBack' },
      { action: 'click', selector: '[data-testid="dashboard-tile-inspection"]', screenshotAfter: true, note: 'Click Inspection tile', optional: true },
      { action: 'navigateBack' },
      { action: 'click', selector: '[data-testid="dashboard-tile-incoming_shipments"]', screenshotAfter: true, note: 'Click Incoming Shipments tile', optional: true },
      { action: 'navigateBack' },
      { action: 'click', selector: '[data-testid="dashboard-expand-put_away"]', screenshotAfter: true, note: 'Expand Put Away details', optional: true },
      { action: 'click', selector: '[data-testid="refresh-button"]', note: 'Click refresh', optional: true },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final dashboard state' },
    ],
  },

  // SHIPMENTS HUB & LIST - P1
  {
    route: '/shipments',
    name: 'Shipments Hub Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Shipments hub initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="create-shipment-button"]', note: 'Open create shipment' },
      { action: 'screenshot', note: 'Create dialog open' },
      // Verify dialog has all shipment type options
      { action: 'expectVisible', selector: '[data-testid="shipment-type-continue"]', note: 'Continue button visible', optional: true },
      { action: 'pressKey', value: 'Escape', note: 'Close dialog' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final shipments state' },
    ],
  },
  {
    route: '/shipments/list',
    name: 'Shipments List Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Shipments list initial' },
      { action: 'expectVisible', selector: '[data-testid="shipments-table"]', optional: true },
      { action: 'click', selector: '[data-testid="status-filter"]', note: 'Open status filter', optional: true },
      { action: 'screenshot', note: 'Status filter open' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'type', selector: '[data-testid="search-input"]', value: 'TEST', note: 'Search shipments', optional: true },
      { action: 'screenshot', note: 'Search results' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final shipments list' },
    ],
  },
  {
    route: '/shipments/new',
    name: 'New Shipment Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    primaryActionSelector: '[data-testid="create-shipment-submit"]',
    steps: [
      { action: 'screenshot', note: 'New shipment form' },
      { action: 'expectVisible', selector: '[data-testid="shipment-form"]', optional: true },
      { action: 'click', selector: '[data-testid="account-select"]', note: 'Open account select', optional: true },
      { action: 'screenshot', note: 'Account dropdown' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final new shipment' },
    ],
  },

  // TASKS LIST - P1
  {
    route: '/tasks',
    name: 'Tasks List Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Tasks list initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="create-task-button"]', note: 'Open create task', optional: true },
      { action: 'screenshot', note: 'Create task dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'click', selector: '[data-testid="task-type-filter"]', note: 'Open type filter', optional: true },
      { action: 'screenshot', note: 'Type filter open' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final tasks list' },
    ],
  },

  // STOCKTAKES LIST - P1
  {
    route: '/stocktakes',
    name: 'Stocktakes Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Stocktakes initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="create-stocktake-button"]', note: 'Open create stocktake', optional: true },
      { action: 'screenshot', note: 'Create stocktake dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final stocktakes' },
    ],
  },

  // REPAIR QUOTES LIST - P1
  {
    route: '/repair-quotes',
    name: 'Repair Quotes Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Repair quotes initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="status-filter"]', note: 'Open status filter', optional: true },
      { action: 'screenshot', note: 'Status filter open' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'type', selector: '[data-testid="search-input"]', value: 'test', note: 'Search quotes', optional: true },
      { action: 'screenshot', note: 'Search results' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final repair quotes' },
    ],
  },

  // INVENTORY - P1
  {
    route: '/inventory',
    name: 'Inventory Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Inventory initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="status-filter"]', note: 'Open status filter', optional: true },
      { action: 'screenshot', note: 'Status filter open' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'type', selector: '[data-testid="search-input"]', value: 'test', note: 'Search items', optional: true },
      { action: 'screenshot', note: 'Search results' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final inventory' },
    ],
  },
  {
    route: '/inventory/:id',
    name: 'Item Detail Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    requiresId: true,
    primaryActionSelector: '[data-testid="save-item-button"]',
    steps: [
      { action: 'screenshot', note: 'Item detail initial' },
      { action: 'expectVisible', selector: '[data-testid="item-header"]', optional: true },
      { action: 'click', selector: '[data-testid="item-tab-details"]', screenshotAfter: true, note: 'Details tab', optional: true },
      { action: 'click', selector: '[data-testid="item-tab-photos"]', screenshotAfter: true, note: 'Photos tab', optional: true },
      { action: 'click', selector: '[data-testid="item-tab-history"]', screenshotAfter: true, note: 'History tab', optional: true },
      { action: 'click', selector: '[data-testid="edit-item-button"]', note: 'Open edit', optional: true },
      { action: 'screenshot', note: 'Edit dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final item detail' },
    ],
  },

  // CLAIMS - P1
  {
    route: '/claims',
    name: 'Claims Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Claims initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="create-claim-button"]', note: 'Open create claim', optional: true },
      { action: 'screenshot', note: 'Create claim dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final claims' },
    ],
  },

  // ACCOUNTS - P1
  {
    route: '/accounts',
    name: 'Accounts Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Accounts initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="create-account-button"]', note: 'Open create account', optional: true },
      { action: 'screenshot', note: 'Create account dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'type', selector: '[data-testid="search-input"]', value: 'test', note: 'Search accounts', optional: true },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final accounts' },
    ],
  },

  // BILLING - P1
  {
    route: '/billing',
    name: 'Billing Hub Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Billing initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final billing' },
    ],
  },
  {
    route: '/billing/invoices',
    name: 'Invoices Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Invoices initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="invoices-tab-list"]', screenshotAfter: true, note: 'List tab', optional: true },
      { action: 'click', selector: '[data-testid="invoices-tab-template"]', screenshotAfter: true, note: 'Template tab', optional: true },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final invoices' },
    ],
  },

  // SETTINGS - P1
  {
    route: '/settings',
    name: 'Settings Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Settings initial' },
      { action: 'expectVisible', selector: '[data-testid="settings-tabs"]', optional: true },
      { action: 'click', selector: '[data-testid="settings-tab-company"]', screenshotAfter: true, note: 'Company tab', optional: true },
      { action: 'click', selector: '[data-testid="settings-tab-warehouses"]', screenshotAfter: true, note: 'Warehouses tab', optional: true },
      { action: 'click', selector: '[data-testid="settings-tab-users"]', screenshotAfter: true, note: 'Users tab', optional: true },
      { action: 'click', selector: '[data-testid="settings-tab-pricing"]', screenshotAfter: true, note: 'Pricing tab', optional: true },
      { action: 'click', selector: '[data-testid="settings-tab-prompts"]', screenshotAfter: true, note: 'Prompts tab', optional: true },
      { action: 'click', selector: '[data-testid="settings-tab-communications"]', screenshotAfter: true, note: 'Communications tab', optional: true },
      { action: 'click', selector: '[data-testid="settings-tab-invoice"]', screenshotAfter: true, note: 'Invoice tab', optional: true },
      { action: 'click', selector: '[data-testid="settings-tab-qa"]', screenshotAfter: true, note: 'QA Tests tab', optional: true },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final settings' },
    ],
  },

  // REPORTS / ANALYTICS - P1
  {
    route: '/reports',
    name: 'Analytics Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Analytics initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="report-tab-billing"]', screenshotAfter: true, note: 'Billing tab', optional: true },
      { action: 'click', selector: '[data-testid="report-tab-inventory"]', screenshotAfter: true, note: 'Inventory tab', optional: true },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final analytics' },
    ],
  },

  // QUOTES - P1
  {
    route: '/quotes',
    name: 'Quotes Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Quotes initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="create-quote-button"]', note: 'Navigate to new quote', optional: true },
      { action: 'screenshot', note: 'New quote page' },
      { action: 'navigateBack' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final quotes' },
    ],
  },

  // MESSAGES - P1
  {
    route: '/messages',
    name: 'Messages Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Messages initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="messages-tab-inbox"]', screenshotAfter: true, note: 'Inbox tab', optional: true },
      { action: 'click', selector: '[data-testid="messages-tab-notifications"]', screenshotAfter: true, note: 'Notifications tab', optional: true },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final messages' },
    ],
  },

  // MANIFESTS - P1
  {
    route: '/manifests',
    name: 'Manifests Tour',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Manifests initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'click', selector: '[data-testid="create-manifest-button"]', note: 'Open create manifest', optional: true },
      { action: 'screenshot', note: 'Create manifest dialog' },
      { action: 'pressKey', value: 'Escape' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final manifests' },
    ],
  },

  // ============================================================
  // P2 - INFORMATIONAL / DEV (screenshots only)
  // ============================================================

  // AUTH PAGES - P2
  {
    route: '/auth',
    name: 'Auth Page Tour',
    roleContext: 'admin',
    priority: 'P2',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Auth page' },
      { action: 'expectVisible', selector: '[data-testid="auth-form"]', optional: true },
      { action: 'screenshot', note: 'Final auth' },
    ],
  },
  {
    route: '/client/login',
    name: 'Client Login Tour',
    roleContext: 'client',
    priority: 'P2',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Client login page' },
      { action: 'expectVisible', selector: '[data-testid="client-login-form"]', optional: true },
      { action: 'screenshot', note: 'Final client login' },
    ],
  },

  // DIAGNOSTICS - P2
  {
    route: '/diagnostics',
    name: 'Diagnostics Tour',
    roleContext: 'admin',
    priority: 'P2',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Diagnostics initial' },
      { action: 'expectVisible', selector: '[data-testid="page-header"]' },
      { action: 'screenshot', note: 'Final diagnostics' },
    ],
  },

  // COMPONENTS DEMO - P2
  {
    route: '/components-demo',
    name: 'Components Demo Tour',
    roleContext: 'admin',
    priority: 'P2',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Components demo' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final components demo' },
    ],
  },

  // MATERIAL ICONS - P2
  {
    route: '/material-icons',
    name: 'Material Icons Tour',
    roleContext: 'admin',
    priority: 'P2',
    mode: 'safe',
    steps: [
      { action: 'screenshot', note: 'Material icons' },
      { action: 'scrollToBottom', note: 'Scroll to bottom' },
      { action: 'screenshot', note: 'Final material icons' },
    ],
  },
];

/**
 * Get tour for a specific route
 */
export function getTourForRoute(route: string): PageTour | undefined {
  // First try exact match
  const exact = pageTours.find(t => t.route === route);
  if (exact) return exact;

  // Try pattern match (for :id params)
  const hasId = /\/[a-f0-9-]{36}/i.test(route) || /\/\d+/.test(route);
  if (hasId) {
    const normalized = route.replace(/\/[a-f0-9-]{36}/gi, '/:id').replace(/\/\d+/g, '/:id');
    return pageTours.find(t => t.route === normalized);
  }

  return undefined;
}

/**
 * Get all routes that have tours
 */
export function getRoutesWithTours(): string[] {
  return pageTours.map(t => t.route);
}

/**
 * Get tours by role context
 */
export function getToursByRole(role: RoleContext): PageTour[] {
  return pageTours.filter(t => t.roleContext === role);
}

/**
 * Get tours by priority
 */
export function getToursByPriority(priority: Priority): PageTour[] {
  return pageTours.filter(t => t.priority === priority);
}

/**
 * Check if a priority should fail the run
 */
export function shouldFailRun(priority: Priority): boolean {
  return priority === 'P0';
}

/**
 * Check if scroll/buffer checks apply to a priority
 */
export function shouldCheckScrollBuffer(priority: Priority): boolean {
  return priority === 'P0' || priority === 'P1';
}

/**
 * Get tours by mode (safe = read-only, deep = creates/modifies data)
 */
export function getToursByMode(mode: TourMode): PageTour[] {
  return pageTours.map(t => t).concat(deepTours).filter(t => t.mode === mode);
}

/**
 * Get all tours including deep tours
 */
export function getAllTours(): PageTour[] {
  return [...pageTours, ...deepTours];
}

/**
 * Get deep tours in dependency order. Tours with dependsOn run after their dependencies.
 */
export function getDeepToursOrdered(): PageTour[] {
  const resolved: PageTour[] = [];
  const resolvedNames = new Set<string>();
  const remaining = [...deepTours];

  // Simple topological sort
  let maxIterations = remaining.length * 2;
  while (remaining.length > 0 && maxIterations > 0) {
    maxIterations--;
    const idx = remaining.findIndex(t => {
      if (!t.dependsOn || t.dependsOn.length === 0) return true;
      return t.dependsOn.every(dep => resolvedNames.has(dep));
    });

    if (idx === -1) {
      // Circular dependency or unresolvable - add rest as-is
      resolved.push(...remaining);
      break;
    }

    const tour = remaining.splice(idx, 1)[0];
    resolved.push(tour);
    resolvedNames.add(tour.name);
  }

  return resolved;
}

/**
 * Get tours filtered by tags
 */
export function getToursByTags(tags: string[]): PageTour[] {
  return getAllTours().filter(t => t.tags?.some(tag => tags.includes(tag)));
}

// =============================================================================
// DEEP E2E TOURS - These tours create, modify, and delete data
// =============================================================================
// Deep tours run in sequence (not parallel) and can share state via storeKey.
// They test the full CRUD lifecycle through the actual UI.
//
// Naming convention: "Deep: <Feature> - <Action>"
// Tags help filter tours by area: 'shipments', 'tasks', 'inventory', 'claims',
//   'billing', 'settings', 'photos', 'accounts', 'stocktakes', 'client-portal'
// =============================================================================

export const deepTours: PageTour[] = [

  // ============================================================
  // PHASE 1: FOUNDATION - Create accounts, settings, warehouse data
  // ============================================================

  {
    route: '/accounts',
    name: 'Deep: Create Test Account',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'deep',
    tags: ['accounts', 'foundation'],
    steps: [
      { action: 'screenshot', note: 'Accounts page before' },
      { action: 'navigate', value: '/accounts' },
      { action: 'waitForNetwork' },
      { action: 'clickByText', value: 'Add Account', note: 'Open create account dialog', optional: true },
      { action: 'click', selector: '[data-testid="create-account-button"]', note: 'Fallback: click create button', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Create account dialog open' },
      { action: 'fill', selector: 'input[name="account_name"], input[placeholder*="account name" i]', value: 'QA-DEEP-TEST-ACCT', note: 'Enter account name' },
      { action: 'fill', selector: 'input[name="account_code"], input[placeholder*="account code" i]', value: 'QDTA', note: 'Enter account code' },
      { action: 'fill', selector: 'input[name="contact_email"], input[placeholder*="email" i], input[type="email"]', value: 'qa-deep@test.stride.com', note: 'Enter email' },
      { action: 'screenshot', note: 'Account form filled' },
      { action: 'clickByText', value: 'Create', note: 'Submit create account' },
      { action: 'assertToast', value: 'created', note: 'Verify success toast', timeout: 10000 },
      { action: 'screenshot', note: 'Account created successfully' },
      { action: 'waitForNetwork' },
      // Search for the created account to verify it persisted
      { action: 'navigate', value: '/accounts' },
      { action: 'waitForNetwork' },
      { action: 'fill', selector: '[data-testid="search-input"], input[placeholder*="search" i]', value: 'QA-DEEP-TEST', note: 'Search for test account', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'assertText', selector: 'table, [class*="card"], main', value: 'QA-DEEP-TEST-ACCT', note: 'Verify account appears in list' },
      { action: 'screenshot', note: 'Account verified in list' },
    ],
  },

  // ============================================================
  // PHASE 2: INBOUND SHIPMENT - Full receiving workflow
  // ============================================================

  {
    route: '/shipments/new',
    name: 'Deep: Create Inbound Shipment',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'deep',
    tags: ['shipments', 'receiving'],
    dependsOn: ['Deep: Create Test Account'],
    steps: [
      { action: 'navigate', value: '/shipments/new' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'New shipment form initial' },

      // Select account
      { action: 'selectCombobox', selector: 'input[placeholder*="Select account" i], [data-testid="account-select"]', value: 'QA-DEEP', note: 'Select QA test account' },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Account selected' },

      // Fill sidemark
      { action: 'fill', selector: 'input[placeholder*="sidemark" i], input[placeholder*="Living Room" i]', value: 'QA-Deep-Sidemark-001', note: 'Enter sidemark', optional: true },

      // Fill carrier
      { action: 'fill', selector: 'input[name="carrier"], input[placeholder*="carrier" i], input[placeholder*="FedEx" i]', value: 'QA Test Carrier', note: 'Enter carrier' },

      // Fill tracking
      { action: 'fill', selector: 'input[name="tracking"], input[placeholder*="tracking" i]', value: 'QA-TRACK-001', note: 'Enter tracking number' },

      // Fill PO
      { action: 'fill', selector: 'input[name="po"], input[placeholder*="purchase order" i]', value: 'QA-PO-001', note: 'Enter PO number', optional: true },

      // Fill notes
      { action: 'fill', selector: 'textarea[name="notes"], textarea[placeholder*="notes" i]', value: 'Deep QA test shipment - automated E2E testing', note: 'Enter notes', optional: true },

      { action: 'screenshot', note: 'Shipment header fields filled' },

      // Add expected items
      { action: 'scrollToBottom' },
      { action: 'fill', selector: 'input[placeholder*="description" i]:first-of-type, [data-testid="item-description-0"]', value: 'QA Test Sofa - Large 3-seater', note: 'Enter item 1 description', optional: true },
      { action: 'fill', selector: 'input[placeholder*="quantity" i]:first-of-type, input[name*="quantity"], [data-testid="item-quantity-0"]', value: '2', note: 'Enter item 1 quantity', optional: true },
      { action: 'screenshot', note: 'Expected items filled' },

      // Add a second expected item
      { action: 'clickByText', value: 'Add Item', note: 'Add second expected item', optional: true },
      { action: 'pause', count: 300 },
      { action: 'fill', selector: 'input[placeholder*="description" i]:last-of-type', value: 'QA Test Dining Table', note: 'Enter item 2 description', optional: true },

      { action: 'screenshot', note: 'All items added' },

      // Submit
      { action: 'scrollToBottom' },
      { action: 'submitForm', selector: 'button[type="submit"], [data-testid="create-shipment-submit"]', value: 'Shipment created', note: 'Submit shipment and wait for success' },
      { action: 'screenshot', note: 'Shipment created - redirected to detail' },

      // Verify we landed on shipment detail
      { action: 'assertUrl', value: '/shipments/', note: 'Verify redirected to shipment detail' },
      { action: 'storeValue', selector: 'window.location.pathname', storeKey: 'inbound_shipment_url', note: 'Store shipment URL for later' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Shipment detail page loaded' },
    ],
  },

  {
    route: '/shipments/:id',
    name: 'Deep: Receive Shipment Items',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'deep',
    tags: ['shipments', 'receiving', 'photos'],
    dependsOn: ['Deep: Create Inbound Shipment'],
    requiresId: true,
    steps: [
      // Navigate to the shipment we just created
      { action: 'useStoredValue', storeKey: 'inbound_shipment_url', note: 'Navigate to created shipment' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Shipment detail for receiving' },

      // Click items tab
      { action: 'click', selector: '[data-testid="shipment-tab-items"], [role="tab"]:has-text("Items")', note: 'Go to items tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Items tab' },

      // Add a received item via scan or manual add
      { action: 'clickByText', value: 'Add Item', note: 'Open add item', optional: true },
      { action: 'click', selector: '[data-testid="add-item-button"]', note: 'Fallback add item button', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Add item dialog/form' },

      // Fill item details
      { action: 'fill', selector: 'input[placeholder*="description" i], textarea[placeholder*="description" i]', value: 'QA Deep Sofa - Blue Velvet', note: 'Enter item description', optional: true },
      { action: 'fill', selector: 'input[placeholder*="vendor" i]', value: 'QA Test Vendor', note: 'Enter vendor', optional: true },
      { action: 'screenshot', note: 'Item details filled' },

      // Save item
      { action: 'clickByText', value: 'Save', note: 'Save item', optional: true },
      { action: 'clickByText', value: 'Add', note: 'Fallback add button', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Item saved' },

      // Go to photos tab and test photo upload
      { action: 'click', selector: '[data-testid="shipment-tab-photos"], [role="tab"]:has-text("Photos")', note: 'Go to photos tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Photos tab' },
      { action: 'click', selector: '[data-testid="add-photo-button"], button:has-text("Upload"), button:has-text("Photo")', note: 'Open photo upload', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Photo upload dialog' },
      // Upload a test image file
      { action: 'uploadFile', selector: 'input[type="file"]', value: 'qa/ui/fixtures/test-photo.jpg', note: 'Upload test photo', optional: true },
      { action: 'pause', count: 2000 },
      { action: 'screenshot', note: 'Photo uploaded' },
      { action: 'pressKey', value: 'Escape', note: 'Close photo dialog' },

      // Go to tasks tab
      { action: 'click', selector: '[data-testid="shipment-tab-tasks"], [role="tab"]:has-text("Tasks")', note: 'Go to tasks tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Tasks tab' },

      // Overview tab
      { action: 'click', selector: '[data-testid="shipment-tab-overview"], [role="tab"]:has-text("Overview")', note: 'Back to overview', optional: true },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Overview after receiving items' },
    ],
  },

  // ============================================================
  // PHASE 3: TASKS - Create and complete tasks
  // ============================================================

  {
    route: '/tasks',
    name: 'Deep: Create Task from Tasks Page',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'deep',
    tags: ['tasks'],
    steps: [
      { action: 'navigate', value: '/tasks' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Tasks page before' },

      // Open create task dialog
      { action: 'clickByText', value: 'Create Task', note: 'Open create task dialog', optional: true },
      { action: 'click', selector: '[data-testid="create-task-button"]', note: 'Fallback create button', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Create task dialog' },

      // Fill description
      { action: 'fill', selector: 'textarea[placeholder*="description" i], textarea:first-of-type, input[name="description"]', value: 'QA Deep Test Task - Inspect warehouse section A for damage', note: 'Enter task description' },

      // Select task type
      { action: 'selectCombobox', selector: '[data-testid="task-type-select"], select[name="task_type"], [role="combobox"]', value: 'Inspection', note: 'Select task type', optional: true },
      { action: 'pause', count: 300 },

      // Set priority
      { action: 'selectCombobox', selector: '[data-testid="priority-select"], select[name="priority"], [role="combobox"]:has-text("Priority")', value: 'urgent', note: 'Set urgent priority', optional: true },

      { action: 'screenshot', note: 'Task form filled' },

      // Submit
      { action: 'clickByText', value: 'Create', note: 'Submit create task' },
      { action: 'pause', count: 2000 },
      { action: 'assertToast', value: 'created', note: 'Verify task creation toast', timeout: 10000, optional: true },
      { action: 'screenshot', note: 'Task created' },
      { action: 'waitForNetwork' },
    ],
  },

  {
    route: '/tasks/:id',
    name: 'Deep: Start and Complete Task',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'deep',
    tags: ['tasks', 'photos'],
    dependsOn: ['Deep: Create Task from Tasks Page'],
    requiresId: true,
    steps: [
      // Navigate to tasks list and find the one we created
      { action: 'navigate', value: '/tasks' },
      { action: 'waitForNetwork' },
      { action: 'fill', selector: '[data-testid="search-input"], input[placeholder*="search" i]', value: 'QA Deep Test Task', note: 'Search for our task', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Search results for task' },

      // Click the task to go to detail
      { action: 'clickTableRow', selector: 'table tbody tr, [class*="card"]', value: 'QA Deep Test Task', note: 'Click our task', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Task detail page' },

      // Start the task
      { action: 'click', selector: '[data-testid="start-task-button"], button:has-text("Start")', note: 'Start the task', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Task started confirmation' },
      { action: 'clickByText', value: 'Confirm', note: 'Confirm start', optional: true },
      { action: 'clickByText', value: 'Yes', note: 'Confirm yes', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Task in progress' },

      // Add a note
      { action: 'click', selector: '[data-testid="add-note-button"], button:has-text("Note")', note: 'Add a note', optional: true },
      { action: 'pause', count: 500 },
      { action: 'fill', selector: 'textarea', value: 'QA Deep test note - inspection reveals no damage found in section A', note: 'Enter note text', optional: true },
      { action: 'clickByText', value: 'Save', note: 'Save note', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Note added' },

      // Add a photo
      { action: 'click', selector: '[data-testid="add-photo-button"], button:has-text("Photo")', note: 'Open add photo', optional: true },
      { action: 'pause', count: 500 },
      { action: 'uploadFile', selector: 'input[type="file"]', value: 'qa/ui/fixtures/test-photo.jpg', note: 'Upload task photo', optional: true },
      { action: 'pause', count: 2000 },
      { action: 'pressKey', value: 'Escape' },
      { action: 'screenshot', note: 'Photo added to task' },

      // Complete the task
      { action: 'click', selector: '[data-testid="complete-task-button"], button:has-text("Complete")', note: 'Complete the task', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Complete task confirmation' },
      { action: 'clickByText', value: 'Confirm', note: 'Confirm completion', optional: true },
      { action: 'clickByText', value: 'Complete', note: 'Fallback confirm', optional: true },
      { action: 'pause', count: 2000 },
      { action: 'screenshot', note: 'Task completed' },
    ],
  },

  // ============================================================
  // PHASE 4: OUTBOUND SHIPMENT - Create and process
  // ============================================================

  {
    route: '/shipments/outbound/new',
    name: 'Deep: Create Outbound Shipment',
    roleContext: 'admin',
    priority: 'P0',
    mode: 'deep',
    tags: ['shipments', 'outbound'],
    dependsOn: ['Deep: Receive Shipment Items'],
    steps: [
      { action: 'navigate', value: '/shipments/outbound/new' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Outbound create form' },

      // Select account (required - not optional)
      { action: 'selectCombobox', selector: '[data-testid="account-select"] button[role="combobox"], input[placeholder*="Select account" i]', value: 'QA-DEEP', note: 'Select QA test account' },
      { action: 'pause', count: 500 },

      // Select outbound type (required - not optional)
      { action: 'selectCombobox', selector: '[data-testid="outbound-type-select"] button[role="combobox"], input[placeholder*="Select type" i]', value: 'Will Call', note: 'Select Will Call type' },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Account and type selected' },

      // Enter notes
      { action: 'fill', selector: 'textarea[placeholder*="notes" i], textarea', value: 'QA Deep outbound test - automated E2E', note: 'Enter notes', optional: true },

      // Wait for items to load
      { action: 'pause', count: 1000 },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Items section' },

      // Select items (required - not optional)
      { action: 'checkCheckbox', selector: 'table tbody tr:first-child input[type="checkbox"], input[type="checkbox"]:first-of-type', note: 'Select first item' },
      { action: 'pause', count: 300 },
      { action: 'screenshot', note: 'Item selected' },

      // Submit (required - not optional)
      { action: 'submitForm', selector: '[data-testid="create-outbound-submit"], button[type="submit"]', value: 'created', note: 'Submit outbound shipment' },
      { action: 'screenshot', note: 'Outbound shipment created' },
      { action: 'assertUrl', value: '/shipments/', note: 'Verify redirected to shipment detail' },
      { action: 'storeValue', selector: 'window.location.pathname', storeKey: 'outbound_shipment_url', note: 'Store outbound URL' },
    ],
  },

  // ============================================================
  // PHASE 5: CLAIMS - Create and manage a claim
  // ============================================================

  {
    route: '/claims',
    name: 'Deep: Create Claim',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'deep',
    tags: ['claims'],
    dependsOn: ['Deep: Create Test Account'],
    steps: [
      { action: 'navigate', value: '/claims' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Claims page before' },

      // Open create claim dialog
      { action: 'clickByText', value: 'New Claim', note: 'Open new claim dialog', optional: true },
      { action: 'click', selector: '[data-testid="create-claim-button"]', note: 'Fallback create button', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Create claim dialog' },

      // Select property damage context (simplest - no items needed)
      { action: 'clickByText', value: 'Property', note: 'Select property claim context', optional: true },
      { action: 'selectTab', selector: '[role="tab"]', value: 'Property', note: 'Fallback select property tab', optional: true },
      { action: 'pause', count: 300 },

      // Fill claim fields
      { action: 'fill', selector: 'input[placeholder*="reference" i], input[name*="reference"]', value: 'QA-Deep-Property-Claim-001', note: 'Enter reference', optional: true },
      { action: 'fill', selector: 'input[placeholder*="location" i], input[name*="location"]', value: 'Warehouse Bay 12', note: 'Enter location', optional: true },
      { action: 'fill', selector: 'input[placeholder*="contact name" i], input[name*="contact_name"]', value: 'QA Test Contact', note: 'Enter contact name', optional: true },
      { action: 'fill', selector: 'input[type="email"], input[placeholder*="email" i]', value: 'qa-claim@test.stride.com', note: 'Enter contact email', optional: true },

      // Select claim type
      { action: 'selectCombobox', selector: 'select, [role="combobox"]', value: 'property', note: 'Select property damage type', optional: true },

      // Description
      { action: 'fill', selector: 'textarea', value: 'QA Deep test claim - forklift damage to warehouse floor section B12. Automated E2E testing.', note: 'Enter description' },

      { action: 'screenshot', note: 'Claim form filled' },

      // Submit
      { action: 'clickByText', value: 'Create', note: 'Submit claim' },
      { action: 'pause', count: 2000 },
      { action: 'assertToast', value: 'created', note: 'Verify claim created', timeout: 10000, optional: true },
      { action: 'screenshot', note: 'Claim created' },
    ],
  },

  // ============================================================
  // PHASE 6: STOCKTAKE - Create and scan
  // ============================================================

  {
    route: '/stocktakes',
    name: 'Deep: Create Stocktake',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'deep',
    tags: ['stocktakes'],
    steps: [
      { action: 'navigate', value: '/stocktakes' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Stocktakes page before' },

      // Create new stocktake
      { action: 'clickByText', value: 'Create', note: 'Open create stocktake', optional: true },
      { action: 'click', selector: '[data-testid="create-stocktake-button"]', note: 'Fallback create button', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Create stocktake dialog' },

      // Fill name
      { action: 'fill', selector: 'input[placeholder*="name" i], input[placeholder*="January" i]', value: 'QA Deep Stocktake - Automated Test', note: 'Enter stocktake name', optional: true },

      // Select warehouse
      { action: 'selectCombobox', selector: 'select, [role="combobox"]', value: '', note: 'Select first warehouse (any)', optional: true },
      { action: 'pause', count: 500 },

      // Select some locations if available
      { action: 'clickByText', value: 'Select All', note: 'Select all locations', optional: true },
      { action: 'pause', count: 300 },

      { action: 'screenshot', note: 'Stocktake form filled' },

      // Submit
      { action: 'clickByText', value: 'Create', note: 'Submit stocktake' },
      { action: 'pause', count: 2000 },
      { action: 'assertToast', value: 'created', note: 'Verify stocktake created', timeout: 10000, optional: true },
      { action: 'screenshot', note: 'Stocktake created' },
    ],
  },

  // ============================================================
  // PHASE 7: SETTINGS - Test all settings tabs
  // ============================================================

  {
    route: '/settings',
    name: 'Deep: Settings Tab Walkthrough',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'deep',
    tags: ['settings'],
    steps: [
      { action: 'navigate', value: '/settings' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Settings initial' },

      // Company tab - verify fields are editable
      { action: 'click', selector: '[data-testid="settings-tab-company"]', note: 'Company tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Company settings' },

      // Warehouses tab
      { action: 'click', selector: '[data-testid="settings-tab-warehouses"]', note: 'Warehouses tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Warehouses settings' },

      // Users tab
      { action: 'click', selector: '[data-testid="settings-tab-users"]', note: 'Users tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Users settings' },

      // Pricing tab - verify pricing table loads
      { action: 'click', selector: '[data-testid="settings-tab-pricing"]', note: 'Pricing tab', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Pricing settings' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Pricing settings scrolled' },

      // Prompts tab
      { action: 'click', selector: '[data-testid="settings-tab-prompts"]', note: 'Prompts tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Prompts settings' },

      // Communications tab
      { action: 'click', selector: '[data-testid="settings-tab-communications"]', note: 'Communications tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Communications settings' },

      // Invoice template tab
      { action: 'click', selector: '[data-testid="settings-tab-invoice"]', note: 'Invoice template tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Invoice template settings' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Invoice template scrolled' },

      // QA tab
      { action: 'click', selector: '[data-testid="settings-tab-qa"]', note: 'QA Tests tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'QA Tests settings' },
    ],
  },

  // ============================================================
  // PHASE 8: INVENTORY - Browse and edit item details
  // ============================================================

  {
    route: '/inventory',
    name: 'Deep: Inventory Search and Edit',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'deep',
    tags: ['inventory', 'photos'],
    steps: [
      { action: 'navigate', value: '/inventory' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Inventory page' },

      // Test search
      { action: 'fill', selector: '[data-testid="search-input"], input[placeholder*="search" i]', value: 'QA', note: 'Search for QA items', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Search results' },

      // Test status filter
      { action: 'click', selector: '[data-testid="status-filter"]', note: 'Open status filter', optional: true },
      { action: 'pause', count: 300 },
      { action: 'screenshot', note: 'Status filter open' },
      { action: 'pressKey', value: 'Escape' },

      // Clear search and click first item
      { action: 'clearField', selector: '[data-testid="search-input"], input[placeholder*="search" i]', note: 'Clear search', optional: true },
      { action: 'pause', count: 500 },

      // Click an item row to go to detail
      { action: 'click', selector: 'table tbody tr:first-child, [class*="card"]:first-child', note: 'Click first item', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Item detail page' },

      // Test all tabs
      { action: 'click', selector: '[data-testid="item-tab-details"], [role="tab"]:has-text("Details")', note: 'Details tab', optional: true },
      { action: 'pause', count: 300 },
      { action: 'screenshot', note: 'Details tab' },

      { action: 'click', selector: '[data-testid="item-tab-photos"], [role="tab"]:has-text("Photos")', note: 'Photos tab', optional: true },
      { action: 'pause', count: 300 },
      { action: 'screenshot', note: 'Photos tab' },

      // Upload a photo to the item
      { action: 'click', selector: 'button:has-text("Upload"), [data-testid="add-photo-button"]', note: 'Open photo upload', optional: true },
      { action: 'uploadFile', selector: 'input[type="file"]', value: 'qa/ui/fixtures/test-photo.jpg', note: 'Upload item photo', optional: true },
      { action: 'pause', count: 2000 },
      { action: 'screenshot', note: 'Photo uploaded to item' },

      { action: 'click', selector: '[data-testid="item-tab-history"], [role="tab"]:has-text("History")', note: 'History tab', optional: true },
      { action: 'pause', count: 300 },
      { action: 'screenshot', note: 'History tab' },

      // Test edit
      { action: 'click', selector: '[data-testid="edit-item-button"], button:has-text("Edit")', note: 'Open edit', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Edit dialog/form' },
      { action: 'pressKey', value: 'Escape', note: 'Close edit' },
    ],
  },

  // ============================================================
  // PHASE 9: BILLING - View billing report and invoices
  // ============================================================

  {
    route: '/billing',
    name: 'Deep: Billing and Invoice Walkthrough',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'deep',
    tags: ['billing'],
    steps: [
      { action: 'navigate', value: '/billing' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Billing hub' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Billing hub scrolled' },

      // Go to invoices
      { action: 'navigate', value: '/billing/invoices' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Invoices page' },

      // Test invoice list tab
      { action: 'click', selector: '[data-testid="invoices-tab-list"], [role="tab"]:has-text("Invoices")', note: 'List tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Invoice list' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Invoice list scrolled' },

      // Test template tab
      { action: 'click', selector: '[data-testid="invoices-tab-template"], [role="tab"]:has-text("Template")', note: 'Template tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Invoice template' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Invoice template scrolled' },

      // Go to billing reports
      { action: 'navigate', value: '/billing/reports' },
      { action: 'waitForNetwork' },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Billing reports' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Billing reports scrolled' },
    ],
  },

  // ============================================================
  // PHASE 10: SCAN HUB - Test scanning and movement
  // ============================================================

  {
    route: '/scan',
    name: 'Deep: Scan Hub Interaction',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'deep',
    tags: ['scan', 'inventory'],
    steps: [
      { action: 'navigate', value: '/scan' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Scan hub' },

      // Toggle move mode
      { action: 'click', selector: '[data-testid="move-mode-toggle"]', note: 'Enable move mode', optional: true },
      { action: 'pause', count: 300 },
      { action: 'screenshot', note: 'Move mode enabled' },

      // Type in scan input
      { action: 'fill', selector: '[data-testid="scan-input"], input[placeholder*="scan" i], input[placeholder*="search" i]', value: 'QA-TEST', note: 'Enter scan value', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Scan results' },

      // Clear and test location search
      { action: 'clearField', selector: '[data-testid="scan-input"], input[placeholder*="scan" i]', note: 'Clear scan', optional: true },
      { action: 'click', selector: '[data-testid="location-search-button"]', note: 'Open location search', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Location search open' },
      { action: 'pressKey', value: 'Escape' },

      // Toggle move mode off
      { action: 'click', selector: '[data-testid="move-mode-toggle"]', note: 'Disable move mode', optional: true },
      { action: 'screenshot', note: 'Move mode disabled' },
    ],
  },

  // ============================================================
  // PHASE 11: REPORTS / ANALYTICS
  // ============================================================

  {
    route: '/reports',
    name: 'Deep: Analytics Reports Walkthrough',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'deep',
    tags: ['reports'],
    steps: [
      { action: 'navigate', value: '/reports' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Analytics page' },

      // Billing report tab
      { action: 'click', selector: '[data-testid="report-tab-billing"], [role="tab"]:has-text("Billing")', note: 'Billing tab', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Billing report' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Billing report scrolled' },

      // Inventory report tab
      { action: 'click', selector: '[data-testid="report-tab-inventory"], [role="tab"]:has-text("Inventory")', note: 'Inventory tab', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Inventory report' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Inventory report scrolled' },
    ],
  },

  // ============================================================
  // PHASE 12: DASHBOARD - Verify tiles, navigation, stats
  // ============================================================

  {
    route: '/',
    name: 'Deep: Dashboard Full Interaction',
    roleContext: 'admin',
    priority: 'P1',
    mode: 'deep',
    tags: ['dashboard'],
    steps: [
      { action: 'navigate', value: '/' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Dashboard loaded' },

      // Click each tile and verify navigation works
      { action: 'click', selector: '[data-testid="dashboard-tile-put_away"]', note: 'Put Away tile', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Put Away page' },
      { action: 'navigateBack' },
      { action: 'pause', count: 500 },

      { action: 'click', selector: '[data-testid="dashboard-tile-inspection"]', note: 'Inspection tile', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Inspection page' },
      { action: 'navigateBack' },
      { action: 'pause', count: 500 },

      { action: 'click', selector: '[data-testid="dashboard-tile-incoming_shipments"]', note: 'Incoming tile', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Incoming shipments' },
      { action: 'navigateBack' },
      { action: 'pause', count: 500 },

      // Expand a tile's detail
      { action: 'click', selector: '[data-testid="dashboard-expand-put_away"]', note: 'Expand Put Away', optional: true },
      { action: 'pause', count: 300 },
      { action: 'screenshot', note: 'Put Away expanded' },

      // Refresh
      { action: 'click', selector: '[data-testid="refresh-button"], button:has-text("Refresh")', note: 'Refresh dashboard', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Dashboard refreshed' },

      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Dashboard bottom' },
    ],
  },

  // ============================================================
  // PHASE 13: MESSAGES
  // ============================================================

  {
    route: '/messages',
    name: 'Deep: Messages Interaction',
    roleContext: 'admin',
    priority: 'P2',
    mode: 'deep',
    tags: ['messages'],
    steps: [
      { action: 'navigate', value: '/messages' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Messages page' },

      // Test inbox tab
      { action: 'click', selector: '[data-testid="messages-tab-inbox"], [role="tab"]:has-text("Inbox")', note: 'Inbox tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Inbox' },

      // Test notifications tab
      { action: 'click', selector: '[data-testid="messages-tab-notifications"], [role="tab"]:has-text("Notification")', note: 'Notifications tab', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Notifications' },

      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Messages scrolled' },
    ],
  },

  // ============================================================
  // PHASE 14: CLIENT PORTAL - Full client experience
  // ============================================================

  {
    route: '/client',
    name: 'Deep: Client Portal Full Walkthrough',
    roleContext: 'client',
    priority: 'P1',
    mode: 'deep',
    tags: ['client-portal'],
    steps: [
      { action: 'navigate', value: '/client' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Client dashboard' },

      // Navigate to items
      { action: 'click', selector: '[data-testid="client-nav-items"], a[href*="items"]', note: 'Go to items', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Client items' },

      // Search items
      { action: 'fill', selector: '[data-testid="search-input"], input[placeholder*="search" i]', value: 'test', note: 'Search items', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Client search results' },

      // Click first item
      { action: 'click', selector: '[data-testid="item-row"]:first-child, table tbody tr:first-child', note: 'Click first item', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Client item detail' },

      // Look at repair quote button
      { action: 'scrollToElement', selector: '[data-testid="request-repair-quote-button"], button:has-text("Repair")', note: 'Find repair quote button', optional: true },
      { action: 'screenshot', note: 'Repair quote button visible' },
      { action: 'pressKey', value: 'Escape' },

      // Navigate to quotes
      { action: 'navigate', value: '/client/quotes' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Client quotes page' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Client quotes scrolled' },

      // Navigate to claims
      { action: 'navigate', value: '/client/claims' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Client claims page' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Client claims scrolled' },
    ],
  },

  // ============================================================
  // PHASE 15: MANIFESTS - Create and manage
  // ============================================================

  {
    route: '/manifests',
    name: 'Deep: Manifests Interaction',
    roleContext: 'admin',
    priority: 'P2',
    mode: 'deep',
    tags: ['manifests'],
    steps: [
      { action: 'navigate', value: '/manifests' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Manifests page' },

      // Create manifest
      { action: 'clickByText', value: 'Create', note: 'Open create manifest', optional: true },
      { action: 'click', selector: '[data-testid="create-manifest-button"]', note: 'Fallback create button', optional: true },
      { action: 'pause', count: 500 },
      { action: 'screenshot', note: 'Create manifest dialog' },

      // Fill manifest fields
      { action: 'fill', selector: 'input[placeholder*="name" i], input[name*="name"]', value: 'QA Deep Test Manifest', note: 'Enter manifest name', optional: true },
      { action: 'screenshot', note: 'Manifest form filled' },

      // Close dialog (don't actually create if we can't fully test)
      { action: 'pressKey', value: 'Escape' },
      { action: 'screenshot', note: 'Manifest dialog closed' },

      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Manifests scrolled' },
    ],
  },

  // ============================================================
  // PHASE 16: QUOTES
  // ============================================================

  {
    route: '/quotes',
    name: 'Deep: Quotes Walkthrough',
    roleContext: 'admin',
    priority: 'P2',
    mode: 'deep',
    tags: ['quotes'],
    steps: [
      { action: 'navigate', value: '/quotes' },
      { action: 'waitForNetwork' },
      { action: 'screenshot', note: 'Quotes page' },

      // Navigate to create quote
      { action: 'clickByText', value: 'Create', note: 'Go to new quote', optional: true },
      { action: 'click', selector: '[data-testid="create-quote-button"]', note: 'Fallback create button', optional: true },
      { action: 'pause', count: 1000 },
      { action: 'screenshot', note: 'Quote builder' },
      { action: 'scrollToBottom' },
      { action: 'screenshot', note: 'Quote builder scrolled' },

      { action: 'navigateBack' },
      { action: 'screenshot', note: 'Back to quotes list' },
    ],
  },
];
