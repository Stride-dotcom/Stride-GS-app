/**
 * Route to File Hints Mapping
 *
 * Maps routes to their corresponding source files for the "Copy Fix Prompt" feature.
 * This helps developers quickly identify which files need to be modified to fix UI issues.
 */

export interface RouteFileHint {
  route: string;
  files: string[];
  description?: string;
}

export const routeToFileHints: RouteFileHint[] = [
  // Public / Auth routes
  { route: '/auth', files: ['src/pages/Auth.tsx'], description: 'Login/signup page' },
  { route: '/reset-password', files: ['src/pages/ResetPassword.tsx'], description: 'Password reset page' },
  { route: '/repair-access', files: ['src/pages/RepairTechAccess.tsx'], description: 'Technician magic link access' },
  { route: '/quote/tech', files: ['src/pages/TechQuoteSubmit.tsx'], description: 'Technician quote submission' },
  { route: '/quote/review', files: ['src/pages/ClientQuoteReview.tsx'], description: 'Client quote review' },
  { route: '/claim/accept/:token', files: ['src/pages/ClaimAcceptance.tsx'], description: 'Claim acceptance page' },
  { route: '/quote/accept', files: ['src/pages/QuoteAcceptance.tsx'], description: 'Quote acceptance page' },
  { route: '/activate', files: ['src/pages/ClientActivate.tsx'], description: 'Client activation page' },
  { route: '/client/login', files: ['src/pages/ClientLogin.tsx'], description: 'Client portal login' },
  { route: '/print-preview', files: ['src/pages/PrintPreview.tsx'], description: 'Print preview page' },

  // Dashboard
  { route: '/', files: ['src/pages/Dashboard.tsx', 'src/hooks/useDashboardStats.ts'], description: 'Command Center dashboard' },

  // Inventory
  { route: '/inventory', files: ['src/pages/Inventory.tsx', 'src/hooks/useItems.ts'], description: 'Inventory list' },
  { route: '/inventory/:id', files: ['src/pages/ItemDetail.tsx', 'src/hooks/useItems.ts'], description: 'Item detail page' },

  // Shipments
  { route: '/shipments', files: ['src/pages/Shipments.tsx'], description: 'Shipments hub' },
  { route: '/shipments/list', files: ['src/pages/ShipmentsList.tsx', 'src/hooks/useShipments.ts'], description: 'All shipments list' },
  { route: '/shipments/incoming', files: ['src/pages/ShipmentsList.tsx', 'src/hooks/useShipments.ts'], description: 'Incoming shipments' },
  { route: '/shipments/outbound', files: ['src/pages/ShipmentsList.tsx', 'src/hooks/useShipments.ts'], description: 'Outbound shipments' },
  { route: '/shipments/received', files: ['src/pages/ShipmentsList.tsx', 'src/hooks/useShipments.ts'], description: 'Received shipments' },
  { route: '/shipments/released', files: ['src/pages/ShipmentsList.tsx', 'src/hooks/useShipments.ts'], description: 'Released shipments' },
  { route: '/shipments/new', files: ['src/pages/ShipmentCreate.tsx'], description: 'New inbound shipment' },
  { route: '/shipments/create', files: ['src/pages/ShipmentCreate.tsx'], description: 'Create shipment' },
  { route: '/shipments/return/new', files: ['src/pages/ShipmentCreate.tsx'], description: 'New return shipment' },
  { route: '/shipments/outbound/new', files: ['src/pages/OutboundCreate.tsx'], description: 'New outbound shipment' },
  { route: '/shipments/:id', files: ['src/pages/ShipmentDetail.tsx', 'src/hooks/useShipmentDetail.ts'], description: 'Shipment detail' },

  // Tasks
  { route: '/tasks', files: ['src/pages/Tasks.tsx', 'src/hooks/useTasks.ts'], description: 'Tasks list' },
  { route: '/tasks/:id', files: ['src/pages/TaskDetail.tsx', 'src/hooks/useTasks.ts'], description: 'Task detail' },

  // Scan
  { route: '/scan', files: ['src/pages/ScanHub.tsx'], description: 'Scan hub' },
  { route: '/put-away', files: ['src/pages/PutAwayAssistant.tsx', 'src/hooks/usePutAwayQueue.ts', 'src/hooks/useLocationSuggestions.ts'], description: 'Put Away Assistant' },
  { route: '/scan/item/:codeOrId', files: ['src/pages/ScanItemRedirect.tsx'], description: 'Scan item redirect' },

  // Messages
  { route: '/messages', files: ['src/pages/Messages.tsx', 'src/hooks/useMessages.ts'], description: 'Messages center' },

  // Billing
  { route: '/billing', files: ['src/pages/Billing.tsx'], description: 'Billing hub' },
  { route: '/billing/reports', files: ['src/pages/BillingReports.tsx'], description: 'Billing reports' },
  { route: '/billing/report', files: ['src/pages/BillingReport.tsx'], description: 'Single billing report' },
  { route: '/billing/invoices', files: ['src/pages/Invoices.tsx', 'src/hooks/useInvoices.ts'], description: 'Invoices' },
  { route: '/billing/promo-codes', files: ['src/pages/PromoCodes.tsx'], description: 'Promo codes' },

  // Claims
  { route: '/claims', files: ['src/pages/Claims.tsx', 'src/hooks/useClaims.ts'], description: 'Claims list' },
  { route: '/claims/:id', files: ['src/pages/ClaimDetail.tsx', 'src/hooks/useClaims.ts'], description: 'Claim detail' },

  // Coverage
  { route: '/coverage', files: ['src/pages/CoverageQuickEntry.tsx'], description: 'Coverage quick entry' },

  // Stocktakes
  { route: '/stocktakes', files: ['src/pages/Stocktakes.tsx', 'src/hooks/useStocktakes.ts'], description: 'Cycle counts list' },
  { route: '/stocktakes/:id/scan', files: ['src/pages/Stocktakes.tsx'], description: 'Stocktake scan' },
  { route: '/stocktakes/:id/report', files: ['src/pages/Stocktakes.tsx'], description: 'Stocktake report' },

  // Manifests
  { route: '/manifests', files: ['src/pages/Manifests.tsx', 'src/hooks/useManifests.ts'], description: 'Manifests list' },
  { route: '/manifests/:id', files: ['src/pages/ManifestDetail.tsx'], description: 'Manifest detail' },
  { route: '/manifests/:id/scan', files: ['src/pages/ManifestScan.tsx'], description: 'Manifest scan' },
  { route: '/manifests/:id/history', files: ['src/pages/ManifestDetail.tsx'], description: 'Manifest history' },

  // Reports
  { route: '/reports', files: ['src/pages/Reports.tsx'], description: 'Analytics' },

  // Accounts
  { route: '/accounts', files: ['src/pages/Accounts.tsx', 'src/hooks/useAccounts.ts'], description: 'Accounts list' },

  // Employees
  { route: '/employees', files: ['src/pages/Employees.tsx', 'src/hooks/useEmployees.ts'], description: 'Employees list' },

  // Technicians
  { route: '/technicians', files: ['src/pages/Technicians.tsx'], description: 'Technicians list' },

  // Repair Quotes
  { route: '/repair-quotes', files: ['src/pages/RepairQuotes.tsx', 'src/hooks/useRepairQuotes.ts'], description: 'Repair quotes list' },
  { route: '/repair-quotes/:id', files: ['src/pages/RepairQuotes.tsx', 'src/components/repair-quotes/RepairQuoteDetailDialog.tsx'], description: 'Repair quote detail' },

  // Quotes
  { route: '/quotes', files: ['src/pages/Quotes.tsx', 'src/hooks/useQuotes.ts'], description: 'Quotes list' },
  { route: '/quotes/new', files: ['src/pages/QuoteBuilder.tsx'], description: 'New quote' },
  { route: '/quotes/:id', files: ['src/pages/QuoteBuilder.tsx'], description: 'Quote detail' },

  // Settings
  { route: '/settings', files: ['src/pages/Settings.tsx', 'src/components/settings/'], description: 'Settings' },

  // Diagnostics
  { route: '/diagnostics', files: ['src/pages/Diagnostics.tsx'], description: 'Diagnostics' },

  // Admin
  { route: '/admin/bot-qa', files: ['src/pages/AdminBotQA.tsx'], description: 'Bot QA admin page' },

  // Demo pages
  { route: '/components-demo', files: ['src/pages/ComponentsDemo.tsx'], description: 'Components demo' },
  { route: '/material-icons', files: ['src/pages/MaterialIconsSample.tsx'], description: 'Material icons sample' },

  // Client Portal
  { route: '/client', files: ['src/pages/ClientDashboard.tsx'], description: 'Client dashboard' },
  { route: '/client/items', files: ['src/pages/ClientItems.tsx'], description: 'Client items' },
  { route: '/client/quotes', files: ['src/pages/ClientQuotes.tsx'], description: 'Client quotes' },
  { route: '/client/claims', files: ['src/pages/ClientClaims.tsx'], description: 'Client claims' },
];

/**
 * Get file hints for a given route
 */
export function getFileHintsForRoute(route: string): RouteFileHint | undefined {
  // First try exact match
  const exact = routeToFileHints.find(h => h.route === route);
  if (exact) return exact;

  // Try pattern match (for :id params)
  const normalized = route.replace(/\/[a-f0-9-]{36}/gi, '/:id').replace(/\/\d+/g, '/:id');
  return routeToFileHints.find(h => h.route === normalized);
}

/**
 * Get all routes from the mapping
 */
export function getAllRoutes(): string[] {
  return routeToFileHints.map(h => h.route);
}
