/**
 * EntityActivityFeed - Reusable activity timeline for shipments, tasks, and accounts.
 * For shipments, aggregates data from multiple sources (activity table, audit log,
 * billing events, receiving sessions, photos) for a comprehensive timeline.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';
import type { ActivityEntityType } from '@/lib/activity/logActivity';
import { parseMessageWithLinks } from '@/utils/parseEntityLinks';
import { useEntityMap } from '@/hooks/useEntityMap';
import { ActivityDetailsDisplay } from '@/components/activity/ActivityDetailsDisplay';

interface ActivityRow {
  id: string;
  actor_name: string | null;
  event_type: string;
  event_label: string;
  details: Record<string, unknown>;
  created_at: string;
}

interface EntityActivityFeedProps {
  entityType: Exclude<ActivityEntityType, 'item'> | 'manifest';
  entityId: string;
  title?: string;
  description?: string;
}

type EntityActivityFilterCategory =
  | 'all'
  | 'operations'
  | 'status'
  | 'billing'
  | 'media'
  | 'items'
  | 'update';

const FILTER_OPTIONS: Array<{ value: EntityActivityFilterCategory; label: string; icon: string }> = [
  { value: 'all', label: 'All', icon: 'done_all' },
  { value: 'operations', label: 'Operations', icon: 'qr_code_scanner' },
  { value: 'status', label: 'Status', icon: 'swap_horiz' },
  { value: 'billing', label: 'Billing', icon: 'receipt_long' },
  { value: 'media', label: 'Photos & Docs', icon: 'photo_camera' },
  { value: 'items', label: 'Items', icon: 'inventory_2' },
  { value: 'update', label: 'Updates', icon: 'edit' },
];

const TABLE_MAP: Record<string, { table: string; idColumn: string }> = {
  shipment:     { table: 'shipment_activity',     idColumn: 'shipment_id' },
  task:         { table: 'task_activity',         idColumn: 'task_id' },
  account:      { table: 'account_activity',      idColumn: 'account_id' },
  claim:        { table: 'claim_activity',        idColumn: 'claim_id' },
  repair_quote: { table: 'repair_quote_activity', idColumn: 'repair_quote_id' },
  quote:        { table: 'quote_activity',        idColumn: 'quote_id' },
  invoice:      { table: 'invoice_activity',      idColumn: 'invoice_id' },
  stocktake:    { table: 'stocktake_activity',    idColumn: 'stocktake_id' },
};

function getEventIcon(eventType: string): string {
  if (eventType.includes('photo')) return 'photo_camera';
  if (eventType.includes('created') || eventType.includes('creation')) return 'add_circle';
  if (eventType.includes('receiving') || eventType.includes('session')) return 'assignment_turned_in';
  if (eventType.includes('invoiced') || eventType.includes('billing')) return 'receipt_long';
  if (eventType.includes('updated') || eventType.includes('edited') || eventType.includes('field')) return 'edit';
  if (eventType.includes('voided') || eventType.includes('uninvoiced')) return 'undo';
  if (eventType.includes('cancel')) return 'block';
  if (eventType.includes('status') || eventType.includes('reassign')) return 'swap_horiz';
  if (eventType.includes('assigned') || eventType.includes('account')) return 'person';
  if (eventType.includes('completed') || eventType.includes('shipped')) return 'check_circle';
  if (eventType.includes('charge') || eventType.includes('credit') || eventType.includes('billing_charge')) return 'attach_money';
  if (eventType.includes('received') || eventType.includes('scanned') || eventType.includes('pull') || eventType.includes('release')) return 'qr_code_scanner';
  if (eventType.includes('item_added')) return 'inventory_2';
  if (eventType.includes('partial')) return 'content_cut';
  return 'history';
}

function getEventColor(eventType: string): string {
  if (eventType.includes('created') || eventType.includes('creation'))
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
  if (eventType.includes('photo'))
    return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';
  if (eventType.includes('receiving') || eventType.includes('session'))
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (eventType.includes('invoiced') && !eventType.includes('uninvoiced'))
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
  if (eventType.includes('uninvoiced') || eventType.includes('voided') || eventType.includes('cancel'))
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  if (eventType.includes('updated') || eventType.includes('edited'))
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  if (eventType.includes('completed') || eventType.includes('shipped'))
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (eventType.includes('charge') || eventType.includes('credit') || eventType.includes('billing_charge'))
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
  if (eventType.includes('pull') || eventType.includes('release') || eventType.includes('scan'))
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
  if (eventType.includes('item'))
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
  if (eventType.includes('status') || eventType.includes('reassign'))
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
}

function getEventCategory(eventType: string): string {
  if (eventType.includes('invoice') || eventType.includes('billing') || eventType.includes('charge') || eventType.includes('credit')) return 'billing';
  if (eventType.includes('status') || eventType.includes('completed') || eventType.includes('assigned') || eventType.includes('cancel') || eventType.includes('shipped')) return 'status';
  if (eventType.includes('receiving') || eventType.includes('session') || eventType.includes('pull') || eventType.includes('release') || eventType.includes('scan')) return 'operations';
  if (eventType.includes('photo')) return 'media';
  if (eventType.includes('item')) return 'items';
  return 'update';
}

function dedupeAndSort(rows: ActivityRow[]): ActivityRow[] {
  const seen = new Set<string>();
  const deduplicated = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  deduplicated.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return deduplicated;
}

function formatActionLabel(action: string, fallbackPrefix?: string): string {
  const a = String(action || '').trim();
  if (!a) return fallbackPrefix ? `${fallbackPrefix} updated` : 'Updated';
  if (a === 'created') return fallbackPrefix ? `${fallbackPrefix} created` : 'Created';
  if (a.startsWith('status_changed_to_')) {
    const status = a.replace('status_changed_to_', '').replace(/_/g, ' ');
    return `Status changed to ${status}`;
  }
  return a.replace(/_/g, ' ');
}

async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .in('id', ids);
    if (users) {
      for (const u of users as any[]) {
        const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Unknown';
        map.set(u.id, name);
      }
    }
  } catch {
    // best-effort name resolution
  }
  return map;
}

async function fetchClaimComprehensiveActivity(claimId: string): Promise<ActivityRow[]> {
  const allRows: ActivityRow[] = [];

  // 1) claim_activity table (if it exists)
  try {
    const { data: activityData, error: activityError } = await (supabase as any)
      .from('claim_activity')
      .select('*')
      .eq('claim_id', claimId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!activityError && activityData) allRows.push(...(activityData as ActivityRow[]));
  } catch {
    // ignore
  }

  // 2) claim_audit (canonical audit table used today)
  try {
    const { data: auditRows, error: auditError } = await supabase
      .from('claim_audit')
      .select('id, action, actor_id, details, created_at')
      .eq('claim_id', claimId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (auditError) throw auditError;

    const actorIds = (auditRows || []).map((r: any) => r.actor_id).filter(Boolean) as string[];
    const userNameMap = await resolveUserNames(actorIds);

    for (const row of (auditRows || []) as any[]) {
      const actorName = row.actor_id ? (userNameMap.get(row.actor_id) || null) : null;
      const action = String(row.action || 'updated');
      allRows.push({
        id: `claim-audit-${row.id}`,
        actor_name: actorName,
        event_type: `claim_${action}`,
        event_label: formatActionLabel(action, 'Claim'),
        details: (row.details as any) || {},
        created_at: row.created_at,
      });
    }
  } catch (err: any) {
    if (err?.code !== '42P01') console.error('[EntityActivityFeed] claim_audit fetch failed:', err);
  }

  // 3) billing events linked to claim
  try {
    const { data: billingEvents, error } = await (supabase as any)
      .from('billing_events')
      .select('id, charge_type, description, total_amount, created_at')
      .eq('claim_id', claimId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    if (billingEvents) {
      for (const b of billingEvents as any[]) {
        allRows.push({
          id: `claim-billing-${b.id}`,
          actor_name: null,
          event_type: b.charge_type === 'CREDIT' ? 'billing_credit' : 'billing_charge_added',
          event_label: `${b.description || 'Billing event'}${b.total_amount != null ? ` $${Number(b.total_amount).toFixed(2)}` : ''}`,
          details: { charge_type: b.charge_type, amount: b.total_amount },
          created_at: b.created_at,
        });
      }
    }
  } catch {
    // ignore
  }

  return dedupeAndSort(allRows);
}

async function fetchRepairQuoteComprehensiveActivity(repairQuoteId: string): Promise<ActivityRow[]> {
  const allRows: ActivityRow[] = [];

  // 1) repair_quote_activity table (if it exists)
  try {
    const { data: activityData, error: activityError } = await (supabase as any)
      .from('repair_quote_activity')
      .select('*')
      .eq('repair_quote_id', repairQuoteId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!activityError && activityData) allRows.push(...(activityData as ActivityRow[]));
  } catch {
    // ignore
  }

  // 2) repair_quotes.audit_log (existing system of record)
  try {
    const { data: rq, error } = await (supabase as any)
      .from('repair_quotes')
      .select('audit_log')
      .eq('id', repairQuoteId)
      .maybeSingle();
    if (error) throw error;

    const auditLog = (rq?.audit_log || []) as any[];
    for (let i = 0; i < auditLog.length; i++) {
      const entry = auditLog[i] || {};
      const at = entry.at || entry.created_at || null;
      if (!at) continue;
      const action = String(entry.action || 'updated');
      allRows.push({
        id: `repair-quote-audit-${i}-${String(at)}`,
        actor_name: entry.by_name || null,
        event_type: `repair_quote_${action}`,
        event_label: formatActionLabel(action, 'Repair quote'),
        details: (entry.details as any) || {},
        created_at: String(at),
      });
    }
  } catch (err: any) {
    if (err?.code !== '42P01') console.error('[EntityActivityFeed] repair_quotes.audit_log fetch failed:', err);
  }

  return dedupeAndSort(allRows);
}

function formatQuoteEventLabel(eventType: string, payload: Record<string, unknown> | null | undefined): string {
  switch (eventType) {
    case 'created':
      return 'Quote created';
    case 'updated':
      return 'Quote updated';
    case 'emailed':
      return `Quote emailed${payload && (payload as any).recipient_email ? ` to ${(payload as any).recipient_email}` : ''}`;
    case 'email_failed':
      return 'Quote email failed';
    case 'exported_pdf':
      return 'PDF exported';
    case 'exported_excel':
      return 'Excel exported';
    case 'viewed':
      return 'Quote viewed';
    case 'accepted':
      return 'Quote accepted';
    case 'declined':
      return 'Quote declined';
    case 'expired':
      return 'Quote expired';
    case 'voided':
      return 'Quote voided';
    case 'attachment_added':
      return `Attachment added${payload && (payload as any).file_name ? `: ${(payload as any).file_name}` : ''}`;
    case 'attachment_removed':
      return `Attachment removed${payload && (payload as any).file_name ? `: ${(payload as any).file_name}` : ''}`;
    default:
      return formatActionLabel(eventType, 'Quote');
  }
}

async function fetchQuoteComprehensiveActivity(quoteId: string): Promise<ActivityRow[]> {
  const allRows: ActivityRow[] = [];

  // 1) quote_activity table (if it exists)
  try {
    const { data: activityData, error: activityError } = await (supabase as any)
      .from('quote_activity')
      .select('*')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!activityError && activityData) allRows.push(...(activityData as ActivityRow[]));
  } catch {
    // ignore
  }

  // 2) quote_events (actual audit/event table used by quotes tool)
  try {
    const { data: events, error } = await (supabase as any)
      .from('quote_events')
      .select('id, event_type, payload_json, created_by, created_at')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const userIds = (events || []).map((e: any) => e.created_by).filter(Boolean) as string[];
    const userNameMap = await resolveUserNames(userIds);

    for (const evt of (events || []) as any[]) {
      const actorName = evt.created_by ? (userNameMap.get(evt.created_by) || null) : null;
      const eventType = String(evt.event_type || 'updated');
      allRows.push({
        id: `quote-event-${evt.id}`,
        actor_name: actorName,
        event_type: `quote_${eventType}`,
        event_label: formatQuoteEventLabel(eventType, (evt.payload_json as any) || null),
        details: ((evt.payload_json as any) || {}) as Record<string, unknown>,
        created_at: evt.created_at,
      });
    }
  } catch (err: any) {
    if (err?.code !== '42P01') console.error('[EntityActivityFeed] quote_events fetch failed:', err);
  }

  return dedupeAndSort(allRows);
}

async function fetchStocktakeComprehensiveActivity(stocktakeId: string): Promise<ActivityRow[]> {
  const allRows: ActivityRow[] = [];

  // 1) stocktake_activity table (if it exists)
  try {
    const { data: activityData, error: activityError } = await (supabase as any)
      .from('stocktake_activity')
      .select('*')
      .eq('stocktake_id', stocktakeId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!activityError && activityData) allRows.push(...(activityData as ActivityRow[]));
  } catch {
    // ignore
  }

  // 2) core stocktake lifecycle from stocktakes table
  let stocktake: any = null;
  try {
    const { data, error } = await (supabase as any)
      .from('stocktakes')
      .select('id, stocktake_number, status, created_at, created_by, started_at, completed_at, closed_at, closed_by, updated_at')
      .eq('id', stocktakeId)
      .maybeSingle();
    if (error) throw error;
    stocktake = data;
  } catch {
    // ignore
  }

  const lifecycleUserIds: string[] = [];
  if (stocktake?.created_by) lifecycleUserIds.push(stocktake.created_by);
  if (stocktake?.closed_by) lifecycleUserIds.push(stocktake.closed_by);

  // 3) scans + results (collect user IDs for single user resolution pass)
  let scans: any[] = [];
  let results: any[] = [];

  try {
    const { data } = await (supabase as any)
      .from('stocktake_scans')
      .select(`
        id,
        scanned_at,
        scanned_by,
        scanned_location:locations!stocktake_scans_scanned_location_id_fkey(id, code),
        item_code,
        scan_result,
        auto_fix_applied,
        old_location_id,
        new_location_id
      `)
      .eq('stocktake_id', stocktakeId)
      .order('scanned_at', { ascending: false })
      .limit(200);
    scans = (data || []) as any[];
  } catch {
    // ignore
  }

  try {
    const { data } = await (supabase as any)
      .from('stocktake_results')
      .select('id, item_code, result, resolved, resolved_by, resolved_at, resolution_notes, created_at')
      .eq('stocktake_id', stocktakeId)
      .eq('resolved', true)
      .order('resolved_at', { ascending: false })
      .limit(120);
    results = (data || []) as any[];
  } catch {
    // ignore
  }

  const userIds = [
    ...lifecycleUserIds,
    ...scans.map((s) => s.scanned_by).filter(Boolean),
    ...results.map((r) => r.resolved_by).filter(Boolean),
  ] as string[];
  const userNameMap = await resolveUserNames(userIds);

  if (stocktake?.created_at) {
    allRows.push({
      id: `stocktake-created-${stocktake.id}`,
      actor_name: stocktake.created_by ? (userNameMap.get(stocktake.created_by) || null) : null,
      event_type: 'stocktake_created',
      event_label: `Stocktake ${stocktake.stocktake_number || ''} created`.trim(),
      details: { stocktake_number: stocktake.stocktake_number || null, name: stocktake.name || null },
      created_at: stocktake.created_at,
    });
  }

  if (stocktake?.started_at) {
    allRows.push({
      id: `stocktake-started-${stocktake.id}`,
      actor_name: null,
      event_type: 'status_active',
      event_label: 'Stocktake started',
      details: {},
      created_at: stocktake.started_at,
    });
  }

  if (stocktake?.completed_at) {
    allRows.push({
      id: `stocktake-completed-${stocktake.id}`,
      actor_name: null,
      event_type: 'status_completed',
      event_label: 'Stocktake completed',
      details: {},
      created_at: stocktake.completed_at,
    });
  }

  if (stocktake?.closed_at) {
    allRows.push({
      id: `stocktake-closed-${stocktake.id}`,
      actor_name: stocktake.closed_by ? (userNameMap.get(stocktake.closed_by) || null) : null,
      event_type: 'status_closed',
      event_label: 'Stocktake closed',
      details: {},
      created_at: stocktake.closed_at,
    });
  }

  if (stocktake?.status === 'cancelled') {
    const at = stocktake.updated_at || stocktake.closed_at || stocktake.completed_at || stocktake.created_at;
    if (at) {
      allRows.push({
        id: `stocktake-cancelled-${stocktake.id}`,
        actor_name: null,
        event_type: 'status_cancelled',
        event_label: 'Stocktake cancelled',
        details: {},
        created_at: at,
      });
    }
  }

  for (const scan of scans) {
    const actorName = scan.scanned_by ? (userNameMap.get(scan.scanned_by) || null) : null;
    const locCode = scan.scanned_location?.code || null;
    const itemCode = scan.item_code || null;
    const result = String(scan.scan_result || 'scan');
    allRows.push({
      id: `stocktake-scan-${scan.id}`,
      actor_name: actorName,
      event_type: `scan_${result}`,
      event_label: `${itemCode ? `Item ${itemCode}` : 'Item'} scanned${locCode ? ` at ${locCode}` : ''} (${result.replace(/_/g, ' ')})`,
      details: {
        item_code: itemCode,
        scanned_location_code: locCode,
        scan_result: result,
        auto_fix_applied: !!scan.auto_fix_applied,
        old_location_id: scan.old_location_id || null,
        new_location_id: scan.new_location_id || null,
      },
      created_at: scan.scanned_at,
    });
  }

  for (const r of results) {
    const actorName = r.resolved_by ? (userNameMap.get(r.resolved_by) || null) : null;
    const at = r.resolved_at || r.created_at;
    if (!at) continue;
    allRows.push({
      id: `stocktake-result-resolved-${r.id}`,
      actor_name: actorName,
      event_type: 'stocktake_result_resolved',
      event_label: `Variance resolved${r.item_code ? `: ${r.item_code}` : ''}`,
      details: {
        item_code: r.item_code || null,
        result: r.result || null,
        resolution_notes: r.resolution_notes || null,
      },
      created_at: at,
    });
  }

  return dedupeAndSort(allRows);
}

/**
 * For shipments, fetches activity from multiple sources to build a comprehensive timeline.
 */
async function fetchShipmentComprehensiveActivity(shipmentId: string): Promise<ActivityRow[]> {
  const allRows: ActivityRow[] = [];

  // 1. Fetch from shipment_activity table (if it exists)
  try {
    const { data: activityData, error: activityError } = await (supabase as any)
      .from('shipment_activity')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (!activityError && activityData) {
      for (const row of activityData) {
        allRows.push({
          id: row.id,
          actor_name: row.actor_name || null,
          event_type: row.event_type,
          event_label: row.event_label,
          details: row.details || {},
          created_at: row.created_at,
        });
      }
    }
  } catch {
    // Table may not exist yet - continue
  }

  // 2. Fetch shipment creation/status info
  try {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, shipment_number, status, shipment_type, created_at, received_at, completed_at, created_by')
      .eq('id', shipmentId)
      .single();

    if (shipment) {
      const s = shipment as any;

      // Resolve creator name separately
      let creatorName: string | null = null;
      if (s.created_by) {
        try {
          const { data: creator } = await supabase
            .from('users')
            .select('first_name, last_name')
            .eq('id', s.created_by)
            .single();
          if (creator) creatorName = `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || null;
        } catch { /* ignore */ }
      }

      allRows.push({
        id: 'shipment-created',
        actor_name: creatorName,
        event_type: 'shipment_created',
        event_label: `${(s.shipment_type || '').replace('_', ' ')} shipment ${s.shipment_number} created`,
        details: { type: s.shipment_type },
        created_at: s.created_at,
      });

      if (s.received_at) {
        allRows.push({
          id: 'shipment-received',
          actor_name: null,
          event_type: 'status_completed',
          event_label: 'Receiving completed',
          details: {},
          created_at: s.received_at,
        });
      }

      if (s.completed_at && s.completed_at !== s.received_at) {
        allRows.push({
          id: 'shipment-completed',
          actor_name: null,
          event_type: 'status_shipped',
          event_label: 'Shipment completed',
          details: {},
          created_at: s.completed_at,
        });
      }

      if (s.status === 'cancelled') {
        allRows.push({
          id: 'shipment-cancelled',
          actor_name: null,
          event_type: 'status_cancelled',
          event_label: 'Shipment cancelled',
          details: {},
          created_at: s.created_at,
        });
      }
    }
  } catch (err) {
    console.error('[EntityActivityFeed] shipment info fetch failed:', err);
  }

  // 3. Fetch billing events
  try {
    const { data: billingEvents } = await supabase
      .from('billing_events')
      .select('id, event_type, charge_type, description, total_amount, created_at')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false });

    if (billingEvents) {
      for (const b of billingEvents as any[]) {
        allRows.push({
          id: `billing-${b.id}`,
          actor_name: null,
          event_type: b.charge_type === 'CREDIT' ? 'billing_credit' : 'billing_charge_added',
          event_label: `${b.description || b.event_type} ${b.total_amount != null ? `$${Number(b.total_amount).toFixed(2)}` : ''}`,
          details: { charge_type: b.charge_type, amount: b.total_amount },
          created_at: b.created_at,
        });
      }
    }
  } catch (err) {
    console.error('[EntityActivityFeed] billing_events fetch failed:', err);
  }

  // 4. Fetch receiving sessions
  try {
    const { data: sessions, error: sessionsError } = await supabase
      .from('receiving_sessions')
      .select('id, started_at, finished_at, started_by')
      .eq('shipment_id', shipmentId)
      .order('started_at', { ascending: false });

    if (sessionsError) {
      console.error('[EntityActivityFeed] receiving_sessions query error:', sessionsError);
    }

    if (sessions) {
      // Batch resolve session user names
      const sessionUserIds = [...new Set(sessions.map((s: any) => s.started_by).filter(Boolean))] as string[];
      const sessionUserMap = new Map<string, string>();
      if (sessionUserIds.length > 0) {
        try {
          const { data: users } = await supabase.from('users').select('id, first_name, last_name').in('id', sessionUserIds);
          if (users) {
            for (const u of users) sessionUserMap.set(u.id, `${u.first_name || ''} ${u.last_name || ''}`.trim());
          }
        } catch { /* ignore */ }
      }

      for (const session of sessions as any[]) {
        const userName = session.started_by ? (sessionUserMap.get(session.started_by) || null) : null;
        allRows.push({
          id: `session-start-${session.id}`,
          actor_name: userName,
          event_type: 'receiving_session_started',
          event_label: 'Receiving session started',
          details: {},
          created_at: session.started_at,
        });

        if (session.finished_at) {
          allRows.push({
            id: `session-end-${session.id}`,
            actor_name: userName,
            event_type: 'receiving_session_completed',
            event_label: 'Receiving session completed',
            details: {},
            created_at: session.finished_at,
          });
        }
      }
    }
  } catch (err) {
    console.error('[EntityActivityFeed] receiving_sessions fetch failed:', err);
  }

  // 5. Fetch photos
  try {
    const { data: photos, error: photosError } = await (supabase as any)
      .from('shipment_photos')
      .select('id, created_at, uploaded_by')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (photosError && photosError.code !== '42P01') {
      console.error('[EntityActivityFeed] photos query error:', photosError);
    }

    if (photos && photos.length > 0) {
      // Batch resolve uploader names
      const uploaderIds = [...new Set(photos.map((p: any) => p.uploaded_by).filter(Boolean))] as string[];
      const uploaderMap = new Map<string, string>();
      if (uploaderIds.length > 0) {
        try {
          const { data: uploaders } = await supabase.from('users').select('id, first_name, last_name').in('id', uploaderIds);
          if (uploaders) {
            for (const u of uploaders) uploaderMap.set(u.id, `${u.first_name || ''} ${u.last_name || ''}`.trim());
          }
        } catch { /* ignore */ }
      }

      for (const photo of photos) {
        allRows.push({
          id: `photo-${photo.id}`,
          actor_name: photo.uploaded_by ? (uploaderMap.get(photo.uploaded_by) || null) : null,
          event_type: 'photo_added',
          event_label: 'Photo uploaded',
          details: {},
          created_at: photo.created_at,
        });
      }
    }
  } catch (err) {
    console.error('[EntityActivityFeed] photos fetch failed:', err);
  }

  // 6. Fetch audit log entries (scans, overrides, partial releases, status changes)
  try {
    // First, fetch audit entries without the actor join (more reliable)
    const { data: auditEntries, error: auditError } = await (supabase as any)
      .from('admin_audit_log')
      .select('id, action, changes_json, created_at, actor_id')
      .eq('entity_type', 'shipment')
      .eq('entity_id', shipmentId)
      .order('created_at', { ascending: false });

    if (auditError) {
      console.error('[EntityActivityFeed] audit_log query error:', auditError);
    }

    if (auditEntries && auditEntries.length > 0) {
      // Batch-resolve actor names
      const actorIds = [...new Set(auditEntries.map((e: any) => e.actor_id).filter(Boolean))] as string[];
      const actorNameMap = new Map<string, string>();

      if (actorIds.length > 0) {
        try {
          const { data: actors } = await supabase
            .from('users')
            .select('id, first_name, last_name')
            .in('id', actorIds);
          if (actors) {
            for (const a of actors) {
              actorNameMap.set(a.id, `${a.first_name || ''} ${a.last_name || ''}`.trim());
            }
          }
        } catch {
          // Actor name resolution is optional
        }
      }

      for (const entry of auditEntries) {
        const action = String(entry.action || 'audit_event');

        let label = '';
        const changes = entry.changes_json || {};
        if (entry.action === 'account_reassigned') {
          const fromName = changes.previous_account_name || 'Unknown';
          const toName = changes.new_account_name || 'Unknown';
          label = `Account changed from "${fromName}" to "${toName}"`;
        } else if (entry.action === 'status_changed') {
          const actionNote = changes.action || '';
          const prevStatus = changes.previous_status || 'unknown';
          const newStatus = changes.new_status || 'unknown';
          label = actionNote || `Status changed from ${prevStatus} to ${newStatus}`;
        } else if (entry.action === 'pull_manual_override') {
          label = 'Item manually marked as pulled';
        } else if (entry.action === 'release_manual_override') {
          label = 'Item manually marked as released';
        } else if (entry.action === 'pull_scan_success') {
          label = 'Item scanned and pulled to dock';
        } else if (entry.action === 'release_scan_success') {
          label = 'Item scanned and released';
        } else if (entry.action === 'scan_invalid') {
          label = `Invalid scan: ${changes.message || 'wrong item'}`;
        } else if (entry.action === 'scan_duplicate') {
          label = `Duplicate scan: item already ${changes.message || 'processed'}`;
        } else if (entry.action === 'partial_release') {
          label = `Partial release: ${changes.removed_items?.length || 0} item(s) removed`;
        } else if (entry.action === 'pull_started') {
          label = 'Pull session started';
        } else if (entry.action === 'pull_completed') {
          label = 'Pull session completed - all items staged';
        } else if (entry.action === 'release_scan_started') {
          label = 'Release scanning started';
        } else if (entry.action === 'release_scan_completed') {
          label = 'Release scanning completed - all items released';
        } else if (entry.action === 'shipment_completed') {
          const overrides = changes.warnings_overridden;
          label = overrides
            ? `Shipment completed with ${overrides.length} warning override(s)`
            : 'Shipment marked as shipped';
        } else if (entry.action === 'scan_error') {
          label = `Scan error: ${changes.error || 'unknown error'}`;
        } else {
          label = changes.message || changes.note || action.replace(/_/g, ' ');
        }

        // Skip duplicate created events (already captured from shipment table)
        if (action === 'shipment_created') continue;

        allRows.push({
          id: `audit-${entry.id}`,
          actor_name: entry.actor_id ? (actorNameMap.get(entry.actor_id) || null) : null,
          event_type: action,
          event_label: label,
          details: changes,
          created_at: entry.created_at,
        });
      }
    }
  } catch (err) {
    console.error('[EntityActivityFeed] audit_log fetch failed:', err);
  }

  // 7. Fetch shipment items (additions)
  try {
    const { data: shipmentItems, error: siError } = await supabase
      .from('shipment_items')
      .select(`
        id, created_at, status, expected_quantity, actual_quantity,
        item:item_id(item_code)
      `)
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (siError) console.error('[EntityActivityFeed] shipment_items query error:', siError);

    if (shipmentItems) {
      for (const si of shipmentItems as any[]) {
        allRows.push({
          id: `item-${si.id}`,
          actor_name: null,
          event_type: 'item_added',
          event_label: si.item?.item_code
            ? `Item ${si.item.item_code} added to shipment`
            : `Expected ${si.expected_quantity || 1} item(s) added`,
          details: {
            item_code: si.item?.item_code,
            expected_qty: si.expected_quantity,
            actual_qty: si.actual_quantity,
            status: si.status,
          },
          created_at: si.created_at,
        });
      }
    }
  } catch (err) {
    console.error('[EntityActivityFeed] shipment_items fetch failed:', err);
  }

  // Deduplicate by id and sort newest first
  const seen = new Set<string>();
  const deduplicated = allRows.filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  deduplicated.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return deduplicated;
}

async function fetchManifestHistoryActivity(manifestId: string): Promise<ActivityRow[]> {
  const { data, error } = await (supabase as any)
    .from('stocktake_manifest_history')
    .select(`
      id,
      action,
      description,
      changed_at,
      old_values,
      new_values,
      affected_item_ids,
      changed_by_user:users!stocktake_manifest_history_changed_by_fkey(first_name, last_name, email)
    `)
    .eq('manifest_id', manifestId)
    .order('changed_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows = (data || []) as any[];
  return rows.map((row) => {
    const action = String(row.action || 'updated');
    const user = row.changed_by_user;
    const actorName =
      user
        ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || null
        : null;

    return {
      id: row.id,
      actor_name: actorName,
      event_type: action,
      event_label: row.description || action.replace(/_/g, ' '),
      details: {
        old_values: row.old_values || null,
        new_values: row.new_values || null,
        affected_item_ids: row.affected_item_ids || null,
      },
      created_at: row.changed_at,
    } satisfies ActivityRow;
  });
}

export function EntityActivityFeed({ entityType, entityId, title, description }: EntityActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<EntityActivityFilterCategory[]>(['all']);

  const filteredActivities = useMemo(() => {
    if (selectedCategories.includes('all')) return activities;
    const selected = selectedCategories.filter((c) => c !== 'all') as Array<Exclude<EntityActivityFilterCategory, 'all'>>;
    return activities.filter((a) => selected.includes(getEventCategory(a.event_type) as any));
  }, [activities, selectedCategories]);

  const activeFilterCount = selectedCategories.filter((c) => c !== 'all').length;
  const entityMap = useEntityMap(filteredActivities, '[EntityActivityFeed] entity resolution failed:');

  const mapping = TABLE_MAP[entityType];

  const fetchActivities = useCallback(async () => {
    if (!entityId) return;

    setLoading(true);
    try {
      // For shipments, use comprehensive multi-source fetch
      if (entityType === 'shipment') {
        const rows = await fetchShipmentComprehensiveActivity(entityId);
        setActivities(rows);
        return;
      }

      // For manifests, use stocktake manifest history
      if (entityType === 'manifest') {
        const rows = await fetchManifestHistoryActivity(entityId);
        setActivities(rows);
        return;
      }

      if (entityType === 'claim') {
        const rows = await fetchClaimComprehensiveActivity(entityId);
        setActivities(rows);
        return;
      }

      if (entityType === 'repair_quote') {
        const rows = await fetchRepairQuoteComprehensiveActivity(entityId);
        setActivities(rows);
        return;
      }

      if (entityType === 'quote') {
        const rows = await fetchQuoteComprehensiveActivity(entityId);
        setActivities(rows);
        return;
      }

      if (entityType === 'stocktake') {
        const rows = await fetchStocktakeComprehensiveActivity(entityId);
        setActivities(rows);
        return;
      }

      // For other entity types, use the single activity table
      if (!mapping) return;

      const { data, error } = await (supabase as any).from(mapping.table)
        .select('*')
        .eq(mapping.idColumn, entityId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        if (error.code !== '42P01') {
          console.error(`[EntityActivityFeed] Error for ${entityType}:`, error);
        }
        setActivities([]);
        return;
      }

      setActivities(data || []);
    } catch (err) {
      console.error(`[EntityActivityFeed] Unexpected error:`, err);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, mapping]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const displayTitle = title || 'Activity';
  const displayDescription = description || `Timeline of changes to this ${entityType}`;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="timeline" size="md" />
            {displayTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4 pl-10">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const toggleCategory = (cat: EntityActivityFilterCategory, checked: boolean) => {
    if (cat === 'all') {
      setSelectedCategories(['all']);
      return;
    }
    setSelectedCategories((prev) => {
      const withoutAll = prev.filter((c) => c !== 'all');
      const next = checked
        ? Array.from(new Set([...withoutAll, cat]))
        : withoutAll.filter((c) => c !== cat);
      return next.length === 0 ? ['all'] : next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="timeline" size="md" />
              {displayTitle}
            </CardTitle>
            <CardDescription>{displayDescription}</CardDescription>
          </div>

          {/* Filter button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="relative h-9 w-9 flex-shrink-0" aria-label="Filter activity">
                <MaterialIcon name="filter_list" size="sm" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-primary text-primary-foreground rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={selectedCategories.includes(opt.value)}
                  onCheckedChange={(checked) => toggleCategory(opt.value, !!checked)}
                >
                  <div className="flex items-center gap-2">
                    <MaterialIcon name={opt.icon} size="sm" className="text-muted-foreground" />
                    <span>{opt.label}</span>
                  </div>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start h-8 px-2 text-sm"
                onClick={() => setSelectedCategories(['all'])}
              >
                <MaterialIcon name="restart_alt" size="sm" className="mr-2 text-muted-foreground" />
                Reset
              </Button>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent>
        {filteredActivities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-center">
            <MaterialIcon name="timeline" className="text-[36px] text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {selectedCategories.includes('all')
                ? 'No activity recorded yet'
                : 'No matching activity for the selected filters'}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

              {/* Events */}
              <div className="space-y-3">
                {filteredActivities.map((activity) => (
                  <div key={activity.id} className="relative flex gap-3 pl-10">
                    {/* Timeline dot */}
                    <div className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center ${getEventColor(activity.event_type)}`}>
                      <MaterialIcon name={getEventIcon(activity.event_type)} className="text-[12px]" />
                    </div>

                    {/* Event content */}
                    <div className="flex-1 bg-muted/50 rounded-lg p-3 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <span className="font-medium text-sm leading-tight">
                          {parseMessageWithLinks(activity.event_label, entityMap, { variant: 'inline' })}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1 flex-shrink-0">
                          {getEventCategory(activity.event_type)}
                        </Badge>
                      </div>

                      {/* Actor + time */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {activity.actor_name && (
                          <>
                            <span className="font-medium">{activity.actor_name}</span>
                            <span>-</span>
                          </>
                        )}
                        <span title={format(new Date(activity.created_at), 'MMM d, yyyy h:mm:ss a')}>
                          {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                        </span>
                      </div>

                      {/* Expandable details */}
                      <ActivityDetailsDisplay details={activity.details} entityMap={entityMap} linkVariant="inline" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
