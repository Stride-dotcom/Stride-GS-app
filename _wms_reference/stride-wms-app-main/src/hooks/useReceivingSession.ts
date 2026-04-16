import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  queueReturnShipmentProcessedAlert,
  queueShipmentReceivedAlert,
  queueShipmentCompletedAlert,
  queueCoverageAppliedAlert,
  queueCoveragePendingDeclaredValueAlert,
} from '@/lib/alertQueue';
import { calculateShipmentBillingPreview } from '@/lib/billing/billingCalculation';
import { mergeServiceTimeSnapshot } from '@/lib/time/serviceTimeSnapshot';
import { isReturnIntakeShipment } from '@/lib/shipments/returnIntake';

interface ReceivingSession {
  id: string;
  shipment_id: string;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
  notes: string | null;
  verification_data: any;
  started_by_user?: {
    first_name: string | null;
    last_name: string | null;
    email: string;
  };
}

interface VerificationData {
  expected_items: { description: string; quantity: number }[];
  received_items: { description: string; quantity: number; item_id?: string; receivedWithoutId?: boolean; shipment_item_id?: string }[];
  discrepancies: { description: string; expected: number; received: number }[];
  backorder_items?: { description: string; quantity: number }[];
  [key: string]: unknown;
}

export interface FinishSessionResult {
  success: boolean;
  createdItemIds: string[];
}

export function useReceivingSession(shipmentId: string | undefined) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [session, setSession] = useState<ReceivingSession | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSession = useCallback(async () => {
    if (!shipmentId) return null;

    const { data, error } = await supabase
      .from('receiving_sessions')
      .select(`
        *,
        started_by_user:users!receiving_sessions_started_by_fkey(first_name, last_name, email)
      `)
      .eq('shipment_id', shipmentId)
      .eq('status', 'in_progress')
      .maybeSingle();

    if (!error && data) {
      setSession(data as any);
      return data;
    }
    setSession(null);
    return null;
  }, [shipmentId]);

  const startSession = async () => {
    if (!shipmentId || !profile?.tenant_id || !profile?.id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Unable to start receiving session',
      });
      return null;
    }

    setLoading(true);
    try {
      // Check if there's already an active session
      const existing = await fetchSession();
      if (existing) {
        toast({
          variant: 'destructive',
          title: 'Session Already Active',
          description: `This shipment is being received by another user.`,
        });
        return null;
      }

      const { data, error } = await supabase
        .from('receiving_sessions')
        .insert({
          tenant_id: profile.tenant_id,
          shipment_id: shipmentId,
          started_by: profile.id,
          status: 'in_progress',
        })
        .select()
        .single();

      if (error) throw error;

      // Update shipment status - use 'in_progress' (valid constraint value)
      const { error: shipmentError } = await supabase
        .from('shipments')
        .update({ status: 'in_progress' })
        .eq('id', shipmentId);

      if (shipmentError) throw shipmentError;

      // Auto-assign receiving location to items that are missing one
      try {
        const { data: assignResult } = await supabase.rpc(
          'rpc_assign_receiving_location_for_shipment',
          { p_shipment_id: shipmentId, p_note: 'Auto-assigned on Start Receiving' }
        );
        const result = assignResult as any;
        if (result?.ok && result.updated_count > 0) {
          toast({
            title: 'Receiving Started',
            description: `Assigned ${result.updated_count} item(s) to ${result.effective_location_code}.`,
          });
        } else if (result?.error_code === 'NO_DEFAULT_LOCATION') {
          toast({
            title: 'Receiving Started',
            description: 'No default receiving location set for this warehouse. Items will need a location before finishing.',
          });
        } else {
          toast({
            title: 'Receiving Started',
            description: 'You can now receive items for this shipment.',
          });
        }
      } catch {
        // Non-blocking: proceed even if auto-assign fails
        toast({
          title: 'Receiving Started',
          description: 'You can now receive items for this shipment.',
        });
      }

      setSession(data as any);
      return data;
    } catch (error: any) {
      console.error('Error starting session:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to start receiving session',
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateSessionNotes = async (notes: string) => {
    if (!session) return;

    const { error } = await supabase
      .from('receiving_sessions')
      .update({ notes })
      .eq('id', session.id);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save notes',
      });
    }
  };

  const finishSession = async (
    verificationData: VerificationData,
    createItems: boolean = true
  ): Promise<FinishSessionResult> => {
    if (!session || !profile?.tenant_id) return { success: false, createdItemIds: [] };

    setLoading(true);
    const createdItemIds: string[] = [];
    const nowIso = new Date().toISOString();
    try {
      // Update session
      const { error: sessionError } = await supabase
        .from('receiving_sessions')
        .update({
          status: 'completed' as const,
          finished_at: nowIso,
          verification_data: JSON.parse(JSON.stringify(verificationData)),
        })
        .eq('id', session.id);

      if (sessionError) throw sessionError;

      // Update shipment status
      const hasBackorders = verificationData.backorder_items && verificationData.backorder_items.length > 0;
      await supabase
        .from('shipments')
        .update({ 
          status: hasBackorders ? 'partial' : 'received',
          received_at: nowIso,
        })
        .eq('id', session.shipment_id);

      // Snapshot estimated service time on completion (best-effort; must not block finish)
      try {
        const preview = await calculateShipmentBillingPreview(profile.tenant_id, session.shipment_id, 'inbound');
        const estimatedMinutes = (preview?.lineItems || []).reduce(
          (sum, li) => sum + (li.estimatedMinutes || 0),
          0,
        );

        const { data: shipmentMeta } = await supabase
          .from('shipments')
          .select('metadata')
          .eq('id', session.shipment_id)
          .maybeSingle();

        const merged = mergeServiceTimeSnapshot(shipmentMeta?.metadata ?? null, {
          estimated_minutes: Math.round(estimatedMinutes),
          estimated_snapshot_at: nowIso,
          estimated_source: 'billing_preview',
          estimated_version: 1,
        });

        await supabase
          .from('shipments')
          .update({ metadata: merged })
          .eq('id', session.shipment_id);
      } catch (err) {
        console.warn('[useReceivingSession] Failed to snapshot estimated service time:', err);
      }

      // Create inventory items if requested
      if (createItems && verificationData.received_items.length > 0) {
        // Get shipment details for account info - include sidemark_id and shipment_type
        const { data: shipment } = await supabase
          .from('shipments')
          .select('account_id, warehouse_id, sidemark_id, shipment_type, coverage_type')
          .eq('id', session.shipment_id)
          .single();

        if (shipment) {
          const shipmentCoverageType = (shipment as any).coverage_type as string | null;
          const hasPaidCoverage = shipmentCoverageType === 'full_replacement_no_deductible' ||
            shipmentCoverageType === 'full_replacement_deductible';

          // Resolve default receiving location for this warehouse
          let receivingDockId: string | null = null;
          try {
            const { data: resolveResult } = await supabase.rpc(
              'rpc_resolve_receiving_location',
              { p_warehouse_id: shipment.warehouse_id, p_account_id: shipment.account_id }
            );
            const resolved = resolveResult as any;
            if (resolved?.ok) {
              receivingDockId = resolved.location_id;
            }
          } catch (resolveErr) {
            console.error('Error resolving receiving location:', resolveErr);
          }

          // Get the account to check auto_inspection and auto_assembly settings
          const { data: account } = await supabase
            .from('accounts')
            .select('auto_inspection_on_receiving, auto_assembly_on_receiving')
            .eq('id', shipment.account_id)
            .single();

          // Get tenant preferences for should_create_inspections and auto_assembly
          const { data: tenantPreferences } = await supabase
            .from('tenant_preferences')
            .select('should_create_inspections, auto_assembly_on_receiving')
            .eq('tenant_id', profile.tenant_id)
            .maybeSingle();

          // Use tenant preference if set, otherwise fall back to account setting
          const shouldCreateInspections = tenantPreferences?.should_create_inspections || account?.auto_inspection_on_receiving;
          const shouldCreateAssembly = tenantPreferences?.auto_assembly_on_receiving || account?.auto_assembly_on_receiving;

          for (const item of verificationData.received_items) {
            let currentItemId: string | null = null;

            // Check if this item already exists (created during shipment creation)
            // by looking up the shipment_item to see if it has an item_id
            if (item.shipment_item_id) {
              const { data: shipmentItem } = await (supabase
                .from('shipment_items') as any)
                .select('item_id, expected_class_id, declared_value')
                .eq('id', item.shipment_item_id)
                .single();

              if (shipmentItem?.item_id) {
                // Item already exists - UPDATE it instead of creating
                const updateData: Record<string, any> = {
                  current_location_id: receivingDockId || null,
                  description: item.description,
                  quantity: item.quantity,
                  status: 'active',
                  received_at: new Date().toISOString(),
                };

                // Carry over declared_value from shipment_items if present
                if (shipmentItem.declared_value != null && shipmentItem.declared_value > 0) {
                  updateData.declared_value = shipmentItem.declared_value;
                }

                // If shipment already has paid coverage applied (pre-receiving), ensure new/updated items reflect it
                if (hasPaidCoverage) {
                  updateData.coverage_type = (shipmentItem.declared_value != null && shipmentItem.declared_value > 0)
                    ? shipmentCoverageType
                    : 'pending';
                  updateData.coverage_source = 'shipment';
                }

                // Set received_without_id flag if checked
                if (item.receivedWithoutId) {
                  updateData.received_without_id = true;
                }

                const { error: updateError } = await (supabase
                  .from('items') as any)
                  .update(updateData)
                  .eq('id', shipmentItem.item_id);

                if (updateError) {
                  console.error('Error updating item:', updateError);
                  continue;
                }

                currentItemId = shipmentItem.item_id;
                createdItemIds.push(currentItemId);

                // Update shipment_item status
                await (supabase.from('shipment_items') as any)
                  .update({
                    status: 'received',
                    actual_quantity: item.quantity,
                  })
                  .eq('id', item.shipment_item_id);
              }
            }

            // If item doesn't exist yet, CREATE it (for backward compatibility)
            if (!currentItemId) {
              // Let DB trigger generate item_code (ITM-###-####)
              // Create item with received_without_id flag if set
              // Include sidemark_id from shipment if available
              // Fetch declared_value from shipment_item if available (DV carry-over)
              let shipmentItemDv: number | null = null;
              if (item.shipment_item_id) {
                const { data: siData } = await (supabase.from('shipment_items') as any)
                  .select('declared_value')
                  .eq('id', item.shipment_item_id)
                  .maybeSingle();
                if (siData?.declared_value != null && siData.declared_value > 0) {
                  shipmentItemDv = siData.declared_value;
                }
              }

              const itemData: Record<string, any> = {
                tenant_id: profile.tenant_id,
                account_id: shipment.account_id,
                warehouse_id: shipment.warehouse_id,
                current_location_id: receivingDockId || null,
                sidemark_id: (shipment as any).sidemark_id || null,
                // item_code is auto-generated by DB trigger
                description: item.description,
                quantity: item.quantity,
                status: 'active',
                receiving_shipment_id: session.shipment_id,
                received_at: new Date().toISOString(),
              };

              // Carry over declared_value from expected shipment_item
              if (shipmentItemDv != null) {
                itemData.declared_value = shipmentItemDv;
              }

              // If shipment already has paid coverage applied (pre-receiving), ensure new items reflect it
              if (hasPaidCoverage) {
                itemData.coverage_type = shipmentItemDv != null ? shipmentCoverageType : 'pending';
                itemData.coverage_source = 'shipment';
              }

              // Set received_without_id flag if checked
              if (item.receivedWithoutId) {
                itemData.received_without_id = true;
              }

              const { data: newItemData, error: itemError } = await (supabase
                .from('items') as any)
                .insert(itemData)
                .select('id, item_type_id, class_id')
                .single();

              if (itemError) {
                console.error('Error creating item:', itemError);
                continue;
              }

              // Track created item ID for label printing and link to shipment_item
              if (newItemData) {
                currentItemId = newItemData.id;
                createdItemIds.push(newItemData.id);

                // Link the created item back to the shipment_item
                if (item.shipment_item_id) {
                  await (supabase.from('shipment_items') as any)
                    .update({
                      item_id: newItemData.id,
                      status: 'received',
                      actual_quantity: item.quantity,
                    })
                    .eq('id', item.shipment_item_id);
                }
              }
            }

            // Use currentItemId for the rest of the logic (tasks, etc.)
            const newItem = currentItemId ? { id: currentItemId } : null;

            // Create inspection task if tenant preference or account setting is enabled
            if (shouldCreateInspections && newItem) {
              // Create the inspection task
              const { data: taskData } = await supabase
                .from('tasks')
                .insert({
                  tenant_id: profile.tenant_id,
                  title: `Inspect: ${item.description}`,
                  task_type: 'Inspection',
                  status: 'pending',
                  priority: 'normal',
                  account_id: shipment.account_id,
                  warehouse_id: shipment.warehouse_id,
                })
                .select('id')
                .single();

              // Link the item to the task via task_items
              if (taskData) {
                await supabase
                  .from('task_items')
                  .insert({
                    task_id: taskData.id,
                    item_id: newItem.id,
                  });
              }
            }

            // Create assembly task if tenant preference or account setting is enabled
            if (shouldCreateAssembly && newItem) {
              // Create the assembly task
              const { data: assemblyTaskData } = await supabase
                .from('tasks')
                .insert({
                  tenant_id: profile.tenant_id,
                  title: `Assemble: ${item.description}`,
                  task_type: 'Assembly',
                  status: 'pending',
                  priority: 'normal',
                  account_id: shipment.account_id,
                  warehouse_id: shipment.warehouse_id,
                })
                .select('id')
                .single();

              // Link the item to the task via task_items
              if (assemblyTaskData) {
                await supabase
                  .from('task_items')
                  .insert({
                    task_id: assemblyTaskData.id,
                    item_id: newItem.id,
                  });
                
                // Update item's assembly_status
                await (supabase
                  .from('items') as any)
                  .update({ assembly_status: 'pending' })
                  .eq('id', newItem.id);
              }
            }

            // NOTE: Billing event creation is handled separately (not in receiving flow)
          }
        }
      }

      // Safety-net: auto-assign receiving location to any items still missing one
      // This uses the atomic RPC which handles movements in a single transaction
      try {
        const { data: assignResult } = await supabase.rpc(
          'rpc_assign_receiving_location_for_shipment',
          { p_shipment_id: session.shipment_id, p_note: 'Auto-assigned on Finish Receiving' }
        );
        const assignRes = assignResult as any;
        if (assignRes?.ok && assignRes.updated_count > 0) {
          toast({
            title: 'Location Assigned',
            description: `${assignRes.updated_count} item(s) assigned to ${assignRes.effective_location_code}.`,
          });
        }
      } catch {
        // Non-blocking
      }

      // Queue shipment.received alert
      const { data: shipmentData } = await supabase
        .from('shipments')
        .select('shipment_number, shipment_type, return_type')
        .eq('id', session.shipment_id)
        .single();
      
      if (shipmentData && profile.tenant_id) {
        const isReturnIntake = isReturnIntakeShipment({
          shipment_type: shipmentData.shipment_type,
          return_type: shipmentData.return_type,
        });

        if (isReturnIntake) {
          // Option 1: return-intake sends only return-processed.
          await queueReturnShipmentProcessedAlert(
            profile.tenant_id,
            session.shipment_id,
            shipmentData.shipment_number || session.shipment_id,
            verificationData.received_items.length
          );
        } else {
          await queueShipmentReceivedAlert(
            profile.tenant_id,
            session.shipment_id,
            shipmentData.shipment_number || session.shipment_id,
            verificationData.received_items.length
          );

          // Also queue shipment.completed if no backorders
          const hasBackorders = verificationData.backorder_items && verificationData.backorder_items.length > 0;
          if (!hasBackorders) {
            await queueShipmentCompletedAlert(
              profile.tenant_id,
              session.shipment_id,
              shipmentData.shipment_number || session.shipment_id,
              verificationData.received_items.length
            );
          }
        }
      }

      // Auto-apply coverage if account has it enabled and shipment is received (not partial)
      if (!hasBackorders) {
        try {
          const { data: coverageResult } = await supabase.rpc('rpc_auto_apply_coverage_on_receipt', {
            p_shipment_id: session.shipment_id,
          });
          const cResult = coverageResult as any;
          if (cResult?.applied) {
            if (profile.tenant_id && shipmentData) {
              const sn = shipmentData.shipment_number || session.shipment_id;
              const ct = cResult.coverage_type as string;
              queueCoverageAppliedAlert(
                profile.tenant_id,
                session.shipment_id,
                sn,
                ct,
                verificationData.received_items.length
              ).catch(() => {});
              if (cResult.pending_count > 0) {
                queueCoveragePendingDeclaredValueAlert(
                  profile.tenant_id,
                  session.shipment_id,
                  sn,
                  cResult.pending_count
                ).catch(() => {});
              }
            }
            if (cResult.pending_count > 0) {
              toast({
                title: 'Coverage Auto-Applied',
                description: `Coverage applied. ${cResult.pending_count} item(s) need declared values.`,
              });
            }
          }
        } catch (coverageErr) {
          console.warn('[useReceivingSession] Auto-apply coverage failed (non-blocking):', coverageErr);
        }
      }

      setSession(null);
      toast({
        title: 'Receiving Completed',
        description: 'Shipment has been received and items created.',
      });

      return { success: true, createdItemIds };
    } catch (error: any) {
      console.error('Error finishing session:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to complete receiving',
      });
      return { success: false, createdItemIds: [] };
    } finally {
      setLoading(false);
    }
  };

  const cancelSession = async () => {
    if (!session) return;

    setLoading(true);
    try {
      await supabase
        .from('receiving_sessions')
        .update({
          status: 'cancelled',
          finished_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      // Revert shipment status
      await supabase
        .from('shipments')
        .update({ status: 'expected' })
        .eq('id', session.shipment_id);

      setSession(null);
      toast({
        title: 'Session Cancelled',
        description: 'Receiving session has been cancelled.',
      });
    } catch (error) {
      console.error('Error cancelling session:', error);
    } finally {
      setLoading(false);
    }
  };

  return {
    session,
    loading,
    fetchSession,
    startSession,
    updateSessionNotes,
    finishSession,
    cancelSession,
  };
}
