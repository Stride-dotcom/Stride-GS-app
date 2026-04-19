/**
 * useCalendarEvents — combines 3 data sources into a unified calendar event list.
 *   1. Expected shipments from useExpectedShipments (localStorage)
 *   2. Will calls with a scheduled/pickup date (from useWillCalls)
 *   3. Repairs with a scheduled date (from useRepairs)
 *
 * Client-role users only see their own accessible clients.
 */
import { useMemo } from 'react';
import { useWillCalls } from './useWillCalls';
import { useRepairs } from './useRepairs';
import { useTasks } from './useTasks';
import { useExpectedShipments } from './useExpectedShipments';
import { useAuth } from '../contexts/AuthContext';

export type CalendarEventType = 'shipment' | 'willcall' | 'repair' | 'task';

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  date: string; // YYYY-MM-DD
  client: string;
  clientSheetId?: string; // populated for willcall + repair + task; used for deep-link
  sourceId?: string;      // raw entity id (wcNumber, repairId, taskId) or expected-shipment id
  label: string;
  details: {
    title?: string;
    vendor?: string;
    carrier?: string;
    tracking?: string;
    pieces?: number;
    notes?: string;
    pickupParty?: string;
    status?: string;
    description?: string;
    repairVendor?: string;
    priority?: string;
  };
}

function normalizeDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // Accept YYYY-MM-DD or full ISO. Return YYYY-MM-DD.
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch { return null; }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function useCalendarEvents() {
  const { user } = useAuth();
  const { items: expectedItems } = useExpectedShipments();
  const { willCalls, loading: wcLoading } = useWillCalls(true);
  const { repairs, loading: rpLoading } = useRepairs(true);
  const { tasks, loading: tkLoading } = useTasks(true);

  const accessibleClientNames = useMemo<Set<string> | null>(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      return new Set(user.accessibleClientNames);
    }
    return null;
  }, [user?.role, user?.accessibleClientNames]);

  const events = useMemo<CalendarEvent[]>(() => {
    const now = Date.now();
    const out: CalendarEvent[] = [];

    // 1. Expected shipments
    for (const e of expectedItems) {
      const d = normalizeDate(e.expectedDate);
      if (!d) continue;
      if (accessibleClientNames && !accessibleClientNames.has(e.client)) continue;
      out.push({
        id: `ship-${e.id}`,
        type: 'shipment',
        date: d,
        client: e.client,
        clientSheetId: e.clientSheetId,
        sourceId: e.id,
        label: e.vendor || e.client || 'Expected',
        details: {
          title: e.vendor ? `${e.vendor}` : 'Expected Shipment',
          vendor: e.vendor,
          carrier: e.carrier,
          tracking: e.tracking,
          pieces: e.pieces,
          notes: e.notes,
        },
      });
    }

    // 2. Will calls — use scheduledDate (estimatedPickupDate) if present, else actualPickupDate
    for (const wc of willCalls) {
      const d = normalizeDate(wc.scheduledDate) || normalizeDate(wc.actualPickupDate);
      if (!d) continue;
      if (accessibleClientNames && !accessibleClientNames.has(wc.clientName)) continue;
      out.push({
        id: `wc-${wc.wcNumber}`,
        type: 'willcall',
        date: d,
        client: wc.clientName,
        clientSheetId: wc.clientSheetId,
        sourceId: wc.wcNumber,
        label: wc.wcNumber,
        details: {
          title: wc.wcNumber,
          pickupParty: wc.pickupParty,
          status: wc.status,
          pieces: wc.itemCount,
          notes: wc.notes,
        },
      });
    }

    // 3. Repairs — use approvedDate (scheduledDate) if present, else completedDate
    for (const rp of repairs) {
      const d = normalizeDate(rp.approvedDate) || normalizeDate(rp.completedDate);
      if (!d) continue;
      if (accessibleClientNames && !accessibleClientNames.has(rp.clientName)) continue;
      out.push({
        id: `rp-${rp.repairId}`,
        type: 'repair',
        date: d,
        client: rp.clientName,
        clientSheetId: rp.clientSheetId,
        sourceId: rp.repairId,
        label: rp.repairId,
        details: {
          title: rp.repairId,
          description: rp.description,
          repairVendor: rp.repairVendor,
          status: rp.status,
          notes: rp.notes,
        },
      });
    }

    // 4. Tasks — show on their dueDate
    // Include: Open/In Progress with dueDate, OR Completed within 30 days with dueDate
    for (const tk of tasks) {
      const d = normalizeDate(tk.dueDate);
      if (!d) continue;
      if (accessibleClientNames && !accessibleClientNames.has(tk.clientName)) continue;
      const isActive = tk.status === 'Open' || tk.status === 'In Progress';
      const isRecentlyCompleted = tk.status === 'Completed' && tk.completedAt
        ? (now - new Date(tk.completedAt).getTime()) < THIRTY_DAYS_MS
        : false;
      if (!isActive && !isRecentlyCompleted) continue;
      out.push({
        id: `tk-${tk.taskId}`,
        type: 'task',
        date: d,
        client: tk.clientName,
        clientSheetId: tk.clientSheetId,
        sourceId: tk.taskId,
        label: tk.taskId,
        details: {
          title: tk.taskId,
          description: tk.description,
          vendor: tk.vendor,
          status: tk.status,
          priority: tk.priority,
          notes: tk.taskNotes,
        },
      });
    }

    // Sort by date asc
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedItems, willCalls, repairs, tasks, accessibleClientNames]);

  return {
    events,
    loading: wcLoading || rpLoading || tkLoading,
  };
}
