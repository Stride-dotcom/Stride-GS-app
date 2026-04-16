import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { AccountSelect } from '@/components/ui/account-select';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { queueReturnShipmentCreatedAlert } from '@/lib/alertQueue';

type ExceptionType = 'UNKNOWN_ACCOUNT' | 'MIS_SHIP' | 'RETURN_TO_SENDER';

interface ShipmentExceptionActionsProps {
  shipmentId: string;
  shipmentNumber: string;
  accountId: string | null;
  exceptionType: string | null;
  /** Callback after any mutation */
  onUpdated: () => void;
}

export function ShipmentExceptionActions({
  shipmentId,
  shipmentNumber,
  accountId,
  exceptionType,
  onUpdated,
}: ShipmentExceptionActionsProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { hasRole } = usePermissions();
  const isAdmin = hasRole('admin');

  // Resolve Account dialog state
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveAccountId, setResolveAccountId] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [resolving, setResolving] = useState(false);

  // Exception flagging confirmation
  const [flagConfirmOpen, setFlagConfirmOpen] = useState(false);
  const [pendingFlag, setPendingFlag] = useState<'MIS_SHIP' | 'RETURN_TO_SENDER' | null>(null);
  const [flagging, setFlagging] = useState(false);

  // Return draft creation
  const [returnDraftOpen, setReturnDraftOpen] = useState(false);
  const [creatingReturn, setCreatingReturn] = useState(false);

  const appendUnifiedShipmentNote = useCallback(
    async (
      targetShipmentId: string,
      targetShipmentNumber: string | null | undefined,
      noteText: string,
      metadata: Record<string, unknown>,
      noteType: 'internal' | 'public' | 'exception' = 'internal'
    ) => {
      const trimmed = noteText.trim();
      if (!trimmed) return;
      const { error } = await (supabase as any).rpc('create_unified_note', {
        p_entity_type: 'shipment',
        p_entity_id: targetShipmentId,
        p_note_text: trimmed,
        p_note_type: noteType,
        p_source_entity_number: targetShipmentNumber || null,
        p_metadata: {
          source: 'shipment_exception_actions',
          ...metadata,
        },
      });
      if (error) {
        console.warn('[ShipmentExceptionActions] Failed to append unified shipment note:', error.message);
      }
    },
    []
  );

  // ── Resolve Account ──
  const handleResolveAccount = useCallback(async () => {
    if (!resolveAccountId || !resolveNote.trim() || !profile?.id) return;

    setResolving(true);
    try {
      // Verify the selected account belongs to the same tenant
      const { data: account, error: acctErr } = await supabase
        .from('accounts')
        .select('id, tenant_id')
        .eq('id', resolveAccountId)
        .single();

      if (acctErr || !account) throw new Error('Account not found');
      if (account.tenant_id !== profile.tenant_id) {
        throw new Error('Cross-tenant account assignment rejected');
      }

      const { error } = await supabase
        .from('shipments')
        .update({
          account_id: resolveAccountId,
          shipment_exception_type: null,
        })
        .eq('id', shipmentId);

      if (error) throw error;

      await appendUnifiedShipmentNote(
        shipmentId,
        shipmentNumber,
        `Resolved unknown account: ${resolveNote.trim()}`,
        {
          action: 'resolve_unknown_account',
          resolved_account_id: resolveAccountId,
          previous_exception_type: 'UNKNOWN_ACCOUNT',
        },
        'internal'
      );

      toast({ title: 'Account Resolved', description: `Account assigned to ${shipmentNumber}.` });
      setResolveOpen(false);
      setResolveAccountId('');
      setResolveNote('');
      onUpdated();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to resolve account',
      });
    } finally {
      setResolving(false);
    }
  }, [resolveAccountId, resolveNote, profile, shipmentId, shipmentNumber, toast, onUpdated, appendUnifiedShipmentNote]);

  // ── Flag Exception (MIS_SHIP / RETURN_TO_SENDER) ──
  const handleFlagException = useCallback(async () => {
    if (!pendingFlag || !profile?.id) return;

    setFlagging(true);
    try {
      // 1. Set exception type on shipment
      const { error: updateErr } = await (supabase.from('shipments') as any)
        .update({
          shipment_exception_type: pendingFlag,
          updated_by: profile.id,
        })
        .eq('id', shipmentId);

      if (updateErr) throw updateErr;

      // 2. Item-code mode: retroactively tag existing items for exception hold.
      // We keep historical context in item metadata instead of unit status rows.
      if (profile?.tenant_id) {
        const { data: shipmentItems, error: itemLoadErr } = await (supabase.from('items') as any)
          .select('id, metadata')
          .eq('tenant_id', profile.tenant_id)
          .eq('receiving_shipment_id', shipmentId)
          .is('deleted_at', null);

        if (itemLoadErr) {
          // Non-fatal: items may not exist yet (e.g., pre-receiving exception flagging)
          console.warn('[ExceptionActions] failed loading shipment items for exception hold:', itemLoadErr.message);
        } else {
          const taggedAt = new Date().toISOString();
          for (const row of shipmentItems || []) {
            const existingMeta =
              row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
            const nextMeta = {
              ...(existingMeta as any),
              exception_hold: true,
              shipment_exception_type: pendingFlag,
              exception_hold_source: 'shipment',
              exception_hold_updated_at: taggedAt,
            };

            const { error: itemUpdateErr } = await (supabase.from('items') as any)
              .update({ metadata: nextMeta })
              .eq('tenant_id', profile.tenant_id)
              .eq('id', row.id);
            if (itemUpdateErr) {
              console.warn('[ExceptionActions] failed tagging item exception_hold metadata:', itemUpdateErr.message);
            }
          }
        }
      }

      const label = pendingFlag === 'MIS_SHIP' ? 'Mis-Ship' : 'Return to Sender';
      toast({
        title: `Flagged: ${label}`,
        description: `${shipmentNumber} marked as ${label}. Existing received items were tagged for exception hold.`,
      });
      setFlagConfirmOpen(false);
      setPendingFlag(null);
      onUpdated();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to flag shipment',
      });
    } finally {
      setFlagging(false);
    }
  }, [pendingFlag, profile, shipmentId, shipmentNumber, toast, onUpdated]);

  // ── Create Return Shipment Draft ──
  const handleCreateReturnDraft = useCallback(async () => {
    if (!profile?.tenant_id || !profile?.id) return;

    setCreatingReturn(true);
    try {
      const { data, error } = await (supabase.from('shipments') as any)
        .insert({
          tenant_id: profile.tenant_id,
          shipment_type: 'return',
          status: 'expected',
          account_id: accountId,
          source_shipment_id: shipmentId,
          notes: `Return draft created from ${shipmentNumber}`,
          created_by: profile.id,
        })
        .select('id, shipment_number')
        .single();

      if (error) throw error;

      await appendUnifiedShipmentNote(
        data.id,
        data.shipment_number,
        `Return draft created from ${shipmentNumber}`,
        {
          action: 'create_return_draft',
          source_shipment_id: shipmentId,
          exception_type: exceptionType || null,
          legacy_field: 'shipments.notes',
        },
        'internal'
      );

      void queueReturnShipmentCreatedAlert(
        profile.tenant_id,
        data.id,
        data.shipment_number || data.id,
        exceptionType || undefined,
      );

      toast({
        title: 'Return Draft Created',
        description: `Return shipment ${data.shipment_number} created as draft.`,
      });
      setReturnDraftOpen(false);
      onUpdated();
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to create return draft',
      });
    } finally {
      setCreatingReturn(false);
    }
  }, [profile, accountId, shipmentId, shipmentNumber, toast, onUpdated, appendUnifiedShipmentNote, exceptionType]);

  const openFlagConfirm = (flag: 'MIS_SHIP' | 'RETURN_TO_SENDER') => {
    setPendingFlag(flag);
    setFlagConfirmOpen(true);
  };

  // Only show for inbound shipment types (dock_intake, manifest, expected)
  const hasException = exceptionType != null;
  const isUnknownAccount = exceptionType === 'UNKNOWN_ACCOUNT';
  const isMisShip = exceptionType === 'MIS_SHIP';
  const isReturnToSender = exceptionType === 'RETURN_TO_SENDER';

  return (
    <>
      {/* Exception Banner */}
      {hasException && (
        <div className={`flex flex-wrap items-center gap-2 px-4 py-2 rounded-md text-sm ${
          isUnknownAccount ? 'bg-amber-50 border border-amber-200 text-amber-800' :
          'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <MaterialIcon
            name={isUnknownAccount ? 'help_outline' : 'warning'}
            size="sm"
          />
          <span className="font-medium">
            {isUnknownAccount && 'Unknown Account'}
            {isMisShip && 'Mis-Ship'}
            {isReturnToSender && 'Return to Sender'}
          </span>
          {isUnknownAccount && (
            <span className="text-xs">— No account assigned. Receiving may proceed; admin must resolve before outbound.</span>
          )}
          {(isMisShip || isReturnToSender) && (
            <span className="text-xs">— Received items are tagged for exception hold. Create return drafts and continue outbound workflow as needed.</span>
          )}

          {/* Resolve Account (admin only, UNKNOWN_ACCOUNT only) */}
          {isUnknownAccount && isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 text-xs"
              onClick={() => setResolveOpen(true)}
            >
              <MaterialIcon name="person_add" size="sm" className="mr-1" />
              Resolve Account
            </Button>
          )}

          {/* Create Return Draft (for MIS_SHIP / RETURN_TO_SENDER) */}
          {(isMisShip || isReturnToSender) && isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 text-xs"
              onClick={() => setReturnDraftOpen(true)}
            >
              <MaterialIcon name="undo" size="sm" className="mr-1" />
              Create Return Draft
            </Button>
          )}
        </div>
      )}

      {/* Exception Action Buttons (when no exception is set yet) */}
      {!hasException && isAdmin && (
        <div className="flex flex-wrap gap-2">
          {!accountId && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 gap-1">
              <MaterialIcon name="help_outline" size="sm" />
              No Account
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => openFlagConfirm('MIS_SHIP')}
          >
            <MaterialIcon name="swap_horiz" size="sm" className="mr-1" />
            Mark Mis-Ship
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => openFlagConfirm('RETURN_TO_SENDER')}
          >
            <MaterialIcon name="keyboard_return" size="sm" className="mr-1" />
            Return to Sender
          </Button>
        </div>
      )}

      {/* ── Resolve Account Dialog ── */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Account</DialogTitle>
            <DialogDescription>
              Assign an account to shipment {shipmentNumber}. This clears the Unknown Account exception.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Account *</Label>
              <AccountSelect
                value={resolveAccountId}
                onChange={setResolveAccountId}
                placeholder="Select account..."
                clearable={false}
              />
            </div>
            <div className="space-y-2">
              <Label>Resolution Note *</Label>
              <Textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="Explain how the account was identified..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleResolveAccount}
              disabled={resolving || !resolveAccountId || !resolveNote.trim()}
            >
              {resolving ? 'Resolving...' : 'Resolve Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Flag Exception Confirmation ── */}
      <AlertDialog open={flagConfirmOpen} onOpenChange={setFlagConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingFlag === 'MIS_SHIP' ? 'Mark as Mis-Ship?' : 'Mark as Return to Sender?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will tag all existing received items on this shipment with an exception hold marker.
              Future received items can be tagged the same way during intake completion.
              Outbound processing can still proceed for return/disposition workflows.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={flagging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFlagException}
              disabled={flagging}
              className="bg-red-600 hover:bg-red-700"
            >
              {flagging ? 'Flagging...' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Create Return Draft Confirmation ── */}
      <AlertDialog open={returnDraftOpen} onOpenChange={setReturnDraftOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create Return Shipment Draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new return shipment draft linked to {shipmentNumber}.
              The return shipment must be completed manually — no automatic actions will be taken.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={creatingReturn}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCreateReturnDraft}
              disabled={creatingReturn}
            >
              {creatingReturn ? 'Creating...' : 'Create Draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
