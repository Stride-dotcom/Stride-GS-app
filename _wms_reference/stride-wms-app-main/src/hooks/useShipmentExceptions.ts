import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/activity/logActivity';
import { queueReceivingExceptionAlert } from '@/lib/alertQueue';

const SHIPMENT_EXCEPTIONS_SYNC_EVENT = 'shipment-exceptions-sync';

function emitShipmentExceptionsSync(shipmentId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SHIPMENT_EXCEPTIONS_SYNC_EVENT, {
      detail: { shipmentId },
    })
  );
}

export type ShipmentExceptionCode =
  | 'PIECES_MISMATCH'
  | 'VENDOR_MISMATCH'
  | 'DESCRIPTION_MISMATCH'
  | 'SIDEMARK_MISMATCH'
  | 'SHIPPER_MISMATCH'
  | 'TRACKING_MISMATCH'
  | 'REFERENCE_MISMATCH'
  | 'SHORTAGE'
  | 'OVERAGE'
  | 'DAMAGE'
  | 'WET'
  | 'OPEN'
  | 'MISSING_DOCS'
  | 'CRUSHED_TORN_CARTONS'
  | 'MIS_SHIP'
  | 'OTHER';

export const SHIPMENT_EXCEPTION_CODE_META: Record<
  ShipmentExceptionCode,
  { label: string; icon: string; requiresNote?: boolean }
> = {
  PIECES_MISMATCH: { label: 'Item Count Mismatch', icon: 'tag' },
  VENDOR_MISMATCH: { label: 'Vendor Mismatch', icon: 'storefront' },
  DESCRIPTION_MISMATCH: { label: 'Description Mismatch', icon: 'description' },
  SIDEMARK_MISMATCH: { label: 'Sidemark Mismatch', icon: 'sell' },
  SHIPPER_MISMATCH: { label: 'Shipper Mismatch', icon: 'local_shipping' },
  TRACKING_MISMATCH: { label: 'Tracking Mismatch', icon: 'qr_code' },
  REFERENCE_MISMATCH: { label: 'Reference Mismatch', icon: 'fingerprint' },
  SHORTAGE: { label: 'Shortage', icon: 'remove_circle' },
  OVERAGE: { label: 'Overage', icon: 'add_circle' },
  DAMAGE: { label: 'Damage', icon: 'broken_image' },
  WET: { label: 'Wet', icon: 'water_drop' },
  OPEN: { label: 'Open', icon: 'package_2' },
  MISSING_DOCS: { label: 'Missing Docs', icon: 'description' },
  CRUSHED_TORN_CARTONS: { label: 'Crushed/Torn Cartons', icon: 'inventory_2' },
  MIS_SHIP: { label: 'Mis-Ship', icon: 'swap_horiz' },
  OTHER: { label: 'Other', icon: 'more_horiz', requiresNote: true },
};

export const MATCHING_DISCREPANCY_CODES: ReadonlySet<ShipmentExceptionCode> = new Set([
  'PIECES_MISMATCH',
  'VENDOR_MISMATCH',
  'DESCRIPTION_MISMATCH',
  'SIDEMARK_MISMATCH',
  'SHIPPER_MISMATCH',
  'TRACKING_MISMATCH',
  'REFERENCE_MISMATCH',
]);

export interface ShipmentExceptionRow {
  id: string;
  tenant_id: string;
  shipment_id: string;
  code: ShipmentExceptionCode;
  note: string | null;
  status: 'open' | 'resolved';
  resolution_note: string | null;
  created_at: string;
  created_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  updated_at: string;
}

interface UseShipmentExceptionsReturn {
  exceptions: ShipmentExceptionRow[];
  openExceptions: ShipmentExceptionRow[];
  openCount: number;
  loading: boolean;
  refetch: () => Promise<void>;
  upsertOpenException: (code: ShipmentExceptionCode, note?: string | null) => Promise<ShipmentExceptionRow | null>;
  removeOpenException: (code: ShipmentExceptionCode) => Promise<boolean>;
  resolveException: (id: string, resolutionNote: string) => Promise<boolean>;
  reopenException: (id: string) => Promise<boolean>;
}

export function useShipmentExceptions(
  shipmentId: string | undefined,
  options?: { includeMatchingDiscrepancies?: boolean }
): UseShipmentExceptionsReturn {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [exceptions, setExceptions] = useState<ShipmentExceptionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const includeMatchingDiscrepancies = options?.includeMatchingDiscrepancies ?? false;

  const refetch = useCallback(async () => {
    if (!shipmentId || !profile?.tenant_id) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('shipment_exceptions')
        .select('*')
        .eq('shipment_id', shipmentId)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExceptions((data || []) as ShipmentExceptionRow[]);
    } catch (err) {
      console.error('[useShipmentExceptions] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [shipmentId, profile?.tenant_id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Keep multiple hook instances (e.g., tab list + header badge) in sync immediately.
  useEffect(() => {
    if (!shipmentId) return;
    if (typeof window === 'undefined') return;

    const handler = (evt: Event) => {
      const customEvt = evt as CustomEvent<{ shipmentId?: string }>;
      if (customEvt.detail?.shipmentId && customEvt.detail.shipmentId !== shipmentId) return;
      void refetch();
    };

    window.addEventListener(SHIPMENT_EXCEPTIONS_SYNC_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(SHIPMENT_EXCEPTIONS_SYNC_EVENT, handler as EventListener);
    };
  }, [shipmentId, refetch]);

  const upsertOpenException = useCallback(async (
    code: ShipmentExceptionCode,
    note?: string | null
  ): Promise<ShipmentExceptionRow | null> => {
    if (!shipmentId || !profile?.tenant_id || !profile?.id) return null;

    try {
      const normalizedNote = note?.trim() || null;
      const existingOpen = exceptions.find((e) => e.code === code && e.status === 'open');

      // Keep a chip-generated Exception note row in shipment_notes in sync.
      // This supports the shipment-level Notes system (All/Public/Internal/Exception)
      // while preserving shipment_exceptions.note as the primary quick-entry field.
      const syncChipGeneratedExceptionNote = async () => {
        try {
          const nowIso = new Date().toISOString();

          const { data: existingNote } = await (supabase as any).from('shipment_notes')
            .select('id')
            .eq('tenant_id', profile.tenant_id)
            .eq('shipment_id', shipmentId)
            .eq('note_type', 'exception')
            .eq('exception_code', code)
            .eq('is_chip_generated', true)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!normalizedNote) {
            // Note removed/cleared → soft-delete chip-generated note rows for this code
            await (supabase as any).from('shipment_notes')
              .update({ deleted_at: nowIso })
              .eq('tenant_id', profile.tenant_id)
              .eq('shipment_id', shipmentId)
              .eq('note_type', 'exception')
              .eq('exception_code', code)
              .eq('is_chip_generated', true)
              .is('deleted_at', null);
            return;
          }

          if (existingNote?.id) {
            await (supabase as any).from('shipment_notes')
              .update({
                note: normalizedNote,
                visibility: 'public',
                updated_at: nowIso,
              })
              .eq('id', existingNote.id);
          } else {
            await (supabase as any).from('shipment_notes').insert({
              tenant_id: profile.tenant_id,
              shipment_id: shipmentId,
              note: normalizedNote,
              note_type: 'exception',
              visibility: 'public',
              exception_code: code,
              is_chip_generated: true,
              created_by: profile.id,
              created_at: nowIso,
              updated_at: nowIso,
            });
          }
        } catch (noteErr) {
          // Notes should never block exception save.
          console.warn('[useShipmentExceptions] failed to sync shipment_notes exception note:', noteErr);
        }
      };

      if (existingOpen) {
        const previousNote = existingOpen.note ?? null;
        const { data, error } = await (supabase as any)
          .from('shipment_exceptions')
          .update({
            note: normalizedNote,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingOpen.id)
          .select('*')
          .single();

        if (error) throw error;
        setExceptions((prev) => prev.map((e) => (e.id === existingOpen.id ? (data as ShipmentExceptionRow) : e)));

        if (previousNote !== normalizedNote) {
          void logActivity({
            entityType: 'shipment',
            tenantId: profile.tenant_id,
            entityId: shipmentId,
            actorUserId: profile.id,
            eventType: 'shipment_exception_note_updated',
            eventLabel: 'Exception note updated',
            details: {
              code,
              label: SHIPMENT_EXCEPTION_CODE_META[code]?.label,
              previous_note: previousNote,
              note: normalizedNote,
            },
          });
        }

        // Mirror to shipment_notes (chip-generated exception note)
        void syncChipGeneratedExceptionNote();
        emitShipmentExceptionsSync(shipmentId);
        return data as ShipmentExceptionRow;
      }

      const { data, error } = await (supabase as any)
        .from('shipment_exceptions')
        .insert({
          tenant_id: profile.tenant_id,
          shipment_id: shipmentId,
          code,
          note: normalizedNote,
          status: 'open',
          created_by: profile.id,
        })
        .select('*')
        .single();

      if (error) throw error;
      setExceptions((prev) => [data as ShipmentExceptionRow, ...prev]);

      void logActivity({
        entityType: 'shipment',
        tenantId: profile.tenant_id,
        entityId: shipmentId,
        actorUserId: profile.id,
        eventType: 'shipment_exception_added',
        eventLabel: 'Exception added',
        details: {
          code,
          label: SHIPMENT_EXCEPTION_CODE_META[code]?.label,
          note: normalizedNote,
        },
      });

      // Queue internal-only exception alert (do not block UI save)
      if (!MATCHING_DISCREPANCY_CODES.has(code)) {
        void (async () => {
          try {
            // Guard: only queue if the tenant has explicitly enabled this trigger.
            // If there is no communication_alerts row, send-alerts would otherwise "fail open"
            // and send a generic email, which is not desired.
            const { data: commAlert } = await (supabase.from('communication_alerts') as any)
              .select('is_enabled, channels')
              .eq('tenant_id', profile.tenant_id)
              .eq('trigger_event', 'receiving.exception_noted')
              .maybeSingle();

            if (!commAlert || commAlert.is_enabled !== true || commAlert.channels?.email !== true) {
              return;
            }

            const { data: sh } = await (supabase.from('shipments') as any)
              .select('shipment_number')
              .eq('id', shipmentId)
              .maybeSingle();
            const shipmentNumber = (sh?.shipment_number as string | null) || shipmentId;
            await queueReceivingExceptionAlert(
              profile.tenant_id,
              shipmentId,
              shipmentNumber,
              SHIPMENT_EXCEPTION_CODE_META[code]?.label || code
            );
          } catch (alertErr) {
            console.warn('[useShipmentExceptions] failed to queue receiving exception alert:', alertErr);
          }
        })();
      }

      // Mirror to shipment_notes (chip-generated exception note)
      void syncChipGeneratedExceptionNote();
      emitShipmentExceptionsSync(shipmentId);
      return data as ShipmentExceptionRow;
    } catch (err: any) {
      console.error('[useShipmentExceptions] upsert error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to save exception',
      });
      return null;
    }
  }, [shipmentId, profile?.tenant_id, profile?.id, exceptions, toast]);

  const removeOpenException = useCallback(async (code: ShipmentExceptionCode): Promise<boolean> => {
    if (!shipmentId || !profile?.tenant_id) return false;
    try {
      const { error } = await (supabase as any)
        .from('shipment_exceptions')
        .delete()
        .eq('shipment_id', shipmentId)
        .eq('tenant_id', profile.tenant_id)
        .eq('code', code)
        .eq('status', 'open');

      if (error) throw error;
      setExceptions((prev) => prev.filter((e) => !(e.code === code && e.status === 'open')));

      // When a chip is removed, also remove (soft-delete) the chip-generated Exception note(s).
      if (profile?.tenant_id) {
        try {
          await (supabase as any).from('shipment_notes')
            .update({ deleted_at: new Date().toISOString() })
            .eq('tenant_id', profile.tenant_id)
            .eq('shipment_id', shipmentId)
            .eq('note_type', 'exception')
            .eq('exception_code', code)
            .eq('is_chip_generated', true)
            .is('deleted_at', null);
        } catch (noteErr) {
          console.warn('[useShipmentExceptions] failed to cleanup shipment_notes for removed chip:', noteErr);
        }
      }

      void logActivity({
        entityType: 'shipment',
        tenantId: profile.tenant_id,
        entityId: shipmentId,
        actorUserId: profile.id ?? null,
        eventType: 'shipment_exception_removed',
        eventLabel: 'Exception removed',
        details: {
          code,
          label: SHIPMENT_EXCEPTION_CODE_META[code]?.label,
        },
      });

      emitShipmentExceptionsSync(shipmentId);
      return true;
    } catch (err: any) {
      console.error('[useShipmentExceptions] remove error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to remove exception',
      });
      return false;
    }
  }, [shipmentId, profile?.tenant_id, profile?.id, toast]);

  const resolveException = useCallback(async (id: string, resolutionNote: string): Promise<boolean> => {
    if (!profile?.id) return false;
    try {
      const { data, error } = await (supabase as any)
        .from('shipment_exceptions')
        .update({
          status: 'resolved',
          resolution_note: resolutionNote.trim(),
          resolved_at: new Date().toISOString(),
          resolved_by: profile.id,
        })
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;
      setExceptions((prev) => prev.map((e) => (e.id === id ? (data as ShipmentExceptionRow) : e)));

      // Sync resolution note to shipment_notes so Stage 2 completion validation
      // can find it (validation checks shipment_notes with note_type='exception').
      const resolved = data as ShipmentExceptionRow;
      if (resolutionNote.trim()) {
        try {
          const { data: existingNote } = await (supabase as any)
            .from('shipment_notes')
            .select('id')
            .eq('tenant_id', resolved.tenant_id)
            .eq('shipment_id', resolved.shipment_id)
            .eq('note_type', 'exception')
            .eq('exception_code', resolved.code)
            .is('deleted_at', null)
            .limit(1)
            .maybeSingle();

          if (existingNote?.id) {
            await (supabase as any).from('shipment_notes')
              .update({
                note: resolutionNote.trim(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingNote.id);
          } else {
            await (supabase as any).from('shipment_notes').insert({
              tenant_id: resolved.tenant_id,
              shipment_id: resolved.shipment_id,
              note: resolutionNote.trim(),
              note_type: 'exception',
              visibility: 'public',
              exception_code: resolved.code,
              is_chip_generated: false,
              created_by: profile.id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        } catch (noteErr) {
          console.warn('[useShipmentExceptions] failed to sync resolution note to shipment_notes:', noteErr);
        }
      }

      void logActivity({
        entityType: 'shipment',
        tenantId: resolved.tenant_id,
        entityId: resolved.shipment_id,
        actorUserId: profile.id,
        eventType: 'shipment_exception_resolved',
        eventLabel: 'Exception resolved',
        details: {
          code: resolved.code,
          label: SHIPMENT_EXCEPTION_CODE_META[resolved.code]?.label,
          resolution_note: resolutionNote.trim(),
        },
      });

      emitShipmentExceptionsSync(shipmentId);
      return true;
    } catch (err: any) {
      console.error('[useShipmentExceptions] resolve error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to resolve exception',
      });
      return false;
    }
  }, [profile?.id, shipmentId, toast]);

  const reopenException = useCallback(async (id: string): Promise<boolean> => {
    if (!profile?.id) return false;
    try {
      const { data, error } = await (supabase as any)
        .from('shipment_exceptions')
        .update({
          status: 'open',
          resolution_note: null,
          resolved_at: null,
          resolved_by: null,
          reopened_at: new Date().toISOString(),
          reopened_by: profile.id,
        })
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;
      setExceptions((prev) => prev.map((e) => (e.id === id ? (data as ShipmentExceptionRow) : e)));

      void logActivity({
        entityType: 'shipment',
        tenantId: (data as ShipmentExceptionRow).tenant_id,
        entityId: (data as ShipmentExceptionRow).shipment_id,
        actorUserId: profile.id,
        eventType: 'shipment_exception_reopened',
        eventLabel: 'Exception reopened',
        details: {
          code: (data as ShipmentExceptionRow).code,
          label: SHIPMENT_EXCEPTION_CODE_META[(data as ShipmentExceptionRow).code]?.label,
        },
      });

      emitShipmentExceptionsSync((data as ShipmentExceptionRow).shipment_id || shipmentId || id);
      return true;
    } catch (err: any) {
      console.error('[useShipmentExceptions] reopen error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to reopen exception',
      });
      return false;
    }
  }, [profile?.id, shipmentId, toast]);

  const visibleExceptions = useMemo(() => {
    if (includeMatchingDiscrepancies) return exceptions;
    return exceptions.filter((e) => !MATCHING_DISCREPANCY_CODES.has(e.code));
  }, [exceptions, includeMatchingDiscrepancies]);

  const openExceptions = useMemo(
    () => visibleExceptions.filter((e) => e.status === 'open'),
    [visibleExceptions]
  );

  return {
    exceptions: visibleExceptions,
    openExceptions,
    openCount: openExceptions.length,
    loading,
    refetch,
    upsertOpenException,
    removeOpenException,
    resolveException,
    reopenException,
  };
}
