/**
 * Shared status color utility functions for consistent highlighting across the app.
 */

// ── Shipment Status Colors ──────────────────────────────────────────────────
// Used by: Shipment Hub, Shipment Detail, Item Details shipment history

export function getShipmentStatusClasses(status: string): string {
  const normalized = status.toLowerCase().replace(/[_\s-]/g, '');

  switch (normalized) {
    case 'expected':
    case 'pending':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'inprogress':
    case 'processing':
    case 'receiving':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
    case 'released':
    case 'completed':
    case 'delivered':
    case 'received':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    case 'cancelled':
    case 'rejected':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    case 'onhold':
    case 'hold':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  }
}

// ── Shipment Type Colors ────────────────────────────────────────────────────
// Used by: Item Details shipment history

export function getShipmentTypeBadgeClasses(type: string): string {
  const normalized = type.toLowerCase().replace(/[_\s-]/g, '');

  switch (normalized) {
    case 'inbound':
    case 'incoming':
    case 'receiving':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'outbound':
    case 'outgoing':
    case 'release':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  }
}

// Alias for backwards compatibility
export const getShipmentTypeClasses = getShipmentTypeBadgeClasses;

// ── Invoice-style Status Colors ─────────────────────────────────────────────
// Used by: Saved Invoices, Invoice Builder, Report Builder, Quotes, Repair Quotes

export function getInvoiceStatusClasses(status: string): string {
  const normalized = status.toLowerCase().replace(/[_\s-]/g, '');

  switch (normalized) {
    case 'draft':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'sent':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    case 'paid':
    case 'accepted':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'void':
    case 'expired':
      return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
    case 'declined':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    case 'countered':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
    case 'overdue':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  }
}

// ── Quote Status Colors (delegates to invoice) ──────────────────────────────

export function getQuoteStatusClasses(status: string): string {
  return getInvoiceStatusClasses(status);
}

// ── Task-style Status Colors (bold text, no background) ─────────────────────
// Used by: Tasks page

export function getTaskStatusTextClasses(status: string): string {
  const normalized = status.toLowerCase().replace(/[_\s-]/g, '');

  switch (normalized) {
    case 'pending':
    case 'notstarted':
    case 'draft':
      return 'text-orange-500 dark:text-orange-400 font-bold';
    case 'inprogress':
    case 'counting':
    case 'active':
      return 'text-yellow-500 dark:text-yellow-400 font-bold';
    case 'completed':
    case 'verified':
    case 'closed':
      return 'text-green-500 dark:text-green-400 font-bold';
    case 'unabletocomplete':
    case 'cancelled':
    case 'discrepancy':
      return 'text-red-500 dark:text-red-400 font-bold';
    default:
      return 'text-gray-500 dark:text-gray-400 font-bold';
  }
}

// Alias for backwards compatibility
export const getTaskStatusClasses = getTaskStatusTextClasses;

// ── Stocktake Status Colors (badge variant matching task style) ─────────────

export function getStocktakeStatusClasses(status: string): string {
  const normalized = status.toLowerCase().replace(/[_\s-]/g, '');

  switch (normalized) {
    case 'draft':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-500/20';
    case 'active':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-500/20';
    case 'closed':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-500/20';
    case 'cancelled':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-500/20';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400 border-gray-500/20';
  }
}
