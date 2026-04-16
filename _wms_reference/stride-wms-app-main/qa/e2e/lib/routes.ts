export interface RouteEntry {
  path: string;
  label: string;
}

export interface DynamicRouteEntry {
  path: string;
  label: string;
  table: string;
}

/** Admin routes — static pages accessible to authenticated admin users. */
export const ADMIN_ROUTES: RouteEntry[] = [
  { path: '/', label: 'Dashboard' },
  { path: '/inventory', label: 'Inventory' },
  { path: '/shipments', label: 'Shipments' },
  { path: '/tasks', label: 'Tasks' },
  { path: '/messages', label: 'Messages' },
  { path: '/billing', label: 'Billing' },
  { path: '/claims', label: 'Claims' },
  { path: '/stocktakes', label: 'Stocktakes' },
  { path: '/manifests', label: 'Manifests' },
  { path: '/reports', label: 'Reports' },
  { path: '/accounts', label: 'Accounts' },
  { path: '/employees', label: 'Employees' },
  { path: '/settings', label: 'Settings' },
];

/** Client portal routes — accessible to client-role users. */
export const CLIENT_ROUTES: RouteEntry[] = [
  { path: '/client', label: 'Client Dashboard' },
  { path: '/client/items', label: 'Client Items' },
  { path: '/client/quotes', label: 'Client Quotes' },
  { path: '/client/claims', label: 'Client Claims' },
];

/** Dynamic routes that require a real ID from the database. */
export const DYNAMIC_ROUTES: DynamicRouteEntry[] = [
  { path: '/inventory/:id', label: 'Item Detail', table: 'items' },
  { path: '/shipments/:id', label: 'Shipment Detail', table: 'shipments' },
  { path: '/tasks/:id', label: 'Task Detail', table: 'tasks' },
  { path: '/claims/:id', label: 'Claim Detail', table: 'claims' },
  { path: '/repair-quotes/:id', label: 'Repair Quote Detail', table: 'repair_quotes' },
  { path: '/manifests/:id', label: 'Manifest Detail', table: 'manifests' },
];
