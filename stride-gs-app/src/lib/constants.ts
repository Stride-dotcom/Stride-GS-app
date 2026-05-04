import type {
  InventoryStatus,
  TaskStatus,
  RepairStatus,
  WillCallStatus,
} from './types';

export const INVENTORY_STATUSES: InventoryStatus[] = [
  'Active',
  'Released',
  'On Hold',
  'Transferred',
];

export const TASK_STATUSES: TaskStatus[] = ['Open', 'In Progress', 'Completed', 'Cancelled'];

export const REPAIR_STATUSES: RepairStatus[] = [
  'Pending Quote',
  'Quote Sent',
  'Approved',
  'Declined',
  'In Progress',
  'Complete',
  'Cancelled',
];

export const WILL_CALL_STATUSES: WillCallStatus[] = [
  'Pending',
  'Scheduled',
  'Released',
  'Partial',
  'Cancelled',
];

// Indexed by both legacy ServiceCode bucket values *and* full svcCode values
// (LABEL, PLLT, etc.). Tasks.tsx and detail panels look up by whichever code
// is on the row, so both must resolve to a human-readable name.
export const SERVICE_CODES: Record<string, string> = {
  RCVG: 'Receiving',
  INSP: 'Inspection',
  ASM: 'Assembly',
  REPAIR: 'Repair',
  STOR: 'Storage',
  DLVR: 'Delivery',
  WCPU: 'Will Call Pickup',
  WC: 'Will Call',
  LABEL: 'Label',
  PLLT: 'Palletize',
  PICK: 'Pick',
  DISP: 'Disposal',
  RSTK: 'Restock',
  MNRTU: 'Manual Return',
  NO_ID: 'No ID',
  MULTI_INS: 'Multi-Item Inspection',
  SIT: 'Sit Service',
  RUSH: 'Rush',
  OTHER: 'Other',
};

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', path: '/' },
  { id: 'inventory', label: 'Inventory', path: '/inventory' },
  { id: 'receiving', label: 'Receiving', path: '/receiving' },
  { id: 'tasks', label: 'Tasks', path: '/tasks' },
  { id: 'repairs', label: 'Repairs', path: '/repairs' },
  { id: 'willcalls', label: 'Will Calls', path: '/will-calls' },
  { id: 'settings', label: 'Settings', path: '/settings' },
] as const;

export const ITEM_CLASSES = [
  'Sofa',
  'Chair',
  'Armchair',
  'Ottoman',
  'Coffee Table',
  'Side Table',
  'Console Table',
  'Dining Table',
  'Dining Chair',
  'Bed Frame',
  'Dresser',
  'Nightstand',
  'Bookcase',
  'Cabinet',
  'Desk',
  'Mirror',
  'Lamp',
  'Rug',
  'Artwork',
  'Accessory',
  'Other',
] as const;

/**
 * Normalize a date-or-datetime string to the strict `YYYY-MM-DD` form that
 * `<input type="date">` requires. The browser silently rejects values like
 * `"2026-05-18 00:00:00"` (renders empty), and our equality guards then
 * misfire because the user-typed value never matches the time-decorated
 * fallback. Use this everywhere a sheet/Supabase date column is fed into a
 * date picker AND in the equality check that decides whether to fire a save.
 *
 * Returns "" on empty / unparseable inputs so the picker shows its placeholder.
 */
export function toDateInputValue(d?: string | null): string {
  if (!d) return '';
  const raw = String(d).trim();
  if (!raw) return '';
  // Already date-only (no time component) → return as-is if it looks like ISO.
  const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return ymd ? ymd[1] : '';
}

/** Format ISO date (YYYY-MM-DD) or datetime (YYYY-MM-DD HH:mm:ss) to MM/DD/YYYY */
export function fmtDate(d?: string | null): string {
  if (!d) return '\u2014';
  // Strip time portion if present — accept "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss"
  const datePart = String(d).split(/[T\s]/)[0];
  const s = datePart.includes('-') ? datePart : datePart.slice(0, 4) + '-' + datePart.slice(4, 6) + '-' + datePart.slice(6, 8);
  const dt = new Date(s + 'T12:00:00');
  if (isNaN(dt.getTime())) return '\u2014';
  return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

/** Format ISO datetime ("YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss")
 *  to MM/DD/YYYY HH:mm for display. Falls back to date-only if no time. */
export function fmtDateTime(d?: string | null): string {
  if (!d) return '\u2014';
  const raw = String(d).trim();
  if (!raw) return '\u2014';
  // Date-only input (no time component) → fall back to fmtDate
  if (!/[T\s]\d{2}:\d{2}/.test(raw)) return fmtDate(raw);
  // Normalize "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DDTHH:mm:ss" so Date parses it
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return fmtDate(raw);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${hh}:${mi}`;
}

export const WAREHOUSE_LOCATIONS = [
  'A-01-01', 'A-01-02', 'A-01-03',
  'A-02-01', 'A-02-02', 'A-02-03',
  'B-01-01', 'B-01-02', 'B-01-03',
  'B-02-01', 'B-02-02', 'B-02-03',
  'C-01-01', 'C-01-02',
  'RECEIVING', 'STAGING', 'OUTBOUND',
] as const;
