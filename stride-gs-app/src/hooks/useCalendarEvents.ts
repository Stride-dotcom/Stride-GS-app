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
import { useExpectedShipments } from './useExpectedShipments';
import { useAuth } from '../contexts/AuthContext';

export type CalendarEventType = 'shipment' | 'willcall' | 'repair';

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  date: string; // YYYY-MM-DD
  client: string;
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

export function useCalendarEvents() {
  const { user } = useAuth();
  const { items: expectedItems } = useExpectedShipments();
  const { willCalls, loading: wcLoading } = useWillCalls(true);
  const { repairs, loading: rpLoading } = useRepairs(true);

  const accessibleClientNames = useMemo<Set<string> | null>(() => {
    if (user?.role === 'client' && user.accessibleClientNames?.length) {
      return new Set(user.accessibleClientNames);
    }
    return null;
  }, [user?.role, user?.accessibleClientNames]);

  const events = useMemo<CalendarEvent[]>(() => {
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

    // Sort by date asc
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [expectedItems, willCalls, repairs, accessibleClientNames]);

  return {
    events,
    loading: wcLoading || rpLoading,
  };
}
