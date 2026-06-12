/**
 * ActivityTimeline — unified, enriched activity feed for an entity.
 *
 * Replaces EntityHistory (v2026-06-12). One component backs the Activity tab
 * on every entity detail surface (Item, Task, Repair, Will Call, Shipment,
 * Delivery Order, Billing). Reads entity_audit_log as the spine and enriches
 * the timeline from the event tables that don't (or didn't historically)
 * write audit rows:
 *
 *   • email_sends       — outbound email events (template, recipients)
 *   • item_photos       — photo uploads (upload rows live in the table;
 *                         deletes arrive via photo_delete audit rows)
 *   • documents         — document uploads
 *   • move_history      — warehouse location moves (inventory only)
 *   • storage_credits   — storage waiver windows (inventory only)
 *   • billing           — ledger charges linked to this entity
 *   • dt_order_history  — DT driver events (dt_order only)
 *
 * Entries are color-coded by category (status=blue, edit=gray, billing=green,
 * email=orange, photo=purple, …), filterable via the category dropdown, and
 * expandable to show field-level old → new values. New events stream in live
 * via Supabase Realtime on the audit log + enrichment tables.
 *
 * Optional `relatedEntityIds` lets a host panel interleave audit rows from
 * linked entities (the Item page passes its task/repair/will-call ids so the
 * item's full story reads in one feed).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Pencil, Play, CheckCircle2, XCircle, RotateCcw, ArrowLeftRight,
  PackageCheck, Mail, Camera, FileText, MapPin, BadgePercent, DollarSign,
  Truck, Send, MessageSquare, Printer, User, Clock, ChevronDown, ChevronRight,
  ListFilter, type LucideIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { theme } from '../../styles/theme';
import { fmtDate, fmtDateTime } from '../../lib/constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ActivityEntityType =
  | 'repair' | 'task' | 'inventory' | 'will_call' | 'dt_order'
  | 'shipment' | 'client' | 'billing' | (string & {});

interface Props {
  entityType: ActivityEntityType;
  entityId: string;
  tenantId?: string;
  /** Audit rows from these linked entity ids (any type) interleave into the
   *  feed — the Item page passes its task/repair/WC ids. */
  relatedEntityIds?: string[];
  /** Compact mode renders without the header strip (count + filter). */
  compact?: boolean;
}

type Category =
  | 'status' | 'edit' | 'billing' | 'email' | 'photo' | 'document'
  | 'move' | 'credit' | 'lifecycle' | 'driver' | 'other';

interface Diff { field: string; old: string | null; new: string | null }

interface TimelineEvent {
  id: string;
  category: Category;
  icon: LucideIcon;
  color: string;
  /** Bold colored lead, e.g. "Status: Pending Quote → Quote Sent". */
  title: string;
  /** Secondary line under the title (amount, recipients, file name…). */
  detail?: string;
  who: string;
  whoIsEmail: boolean;
  when: string; // ISO — sort key
  source?: string;
  /** Field-level old → new rows shown when the entry is expanded. */
  diffs: Diff[];
  /** Id of the linked entity this row came from (related-entity mode). */
  relatedId?: string;
  /** item_photos.id / audit changes.photoId — dedupe key for photo events. */
  photoDedupeKey?: string;
  /** billing.ledger_row_id — drops the billing-enrichment twin of a
   *  charge_added audit row (manual charges carry attribution the
   *  enrichment row can't). */
  billingDedupeKey?: string;
  /** email_sends.id — drops the email-enrichment twin of a
   *  quote_email_sent audit row (the audit row carries attribution). */
  emailDedupeKey?: string;
}

// ─── Category palette ───────────────────────────────────────────────────────
// Spec: status=blue, edit=gray, billing=green, email=orange, photo=purple.

const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  status:    { label: 'Status',    color: '#1D4ED8' },
  edit:      { label: 'Edits',     color: '#6B7280' },
  billing:   { label: 'Billing',   color: '#15803D' },
  email:     { label: 'Emails',    color: '#EA580C' },
  photo:     { label: 'Photos',    color: '#7C3AED' },
  document:  { label: 'Documents', color: '#0891B2' },
  move:      { label: 'Moves',     color: '#0D9488' },
  credit:    { label: 'Credits',   color: '#CA8A04' },
  lifecycle: { label: 'Lifecycle', color: '#15803D' },
  driver:    { label: 'Driver',    color: '#6D28D9' },
  other:     { label: 'Other',     color: '#6B7280' },
};

// Action → presentation. `color` overrides the category color where the
// action itself carries the signal (cancel = red even though lifecycle).
const ACTION_META: Record<string, { label: string; category: Category; icon: LucideIcon; color?: string }> = {
  create:                { label: 'Created',              category: 'lifecycle', icon: Plus },
  update:                { label: 'Updated',              category: 'edit',      icon: Pencil },
  start:                 { label: 'Started',              category: 'lifecycle', icon: Play,        color: '#E85D2D' },
  complete:              { label: 'Completed',            category: 'lifecycle', icon: CheckCircle2 },
  cancel:                { label: 'Cancelled',            category: 'lifecycle', icon: XCircle,     color: '#DC2626' },
  reopen:                { label: 'Reopened',             category: 'lifecycle', icon: RotateCcw,   color: '#B45309' },
  release:               { label: 'Released',             category: 'lifecycle', icon: PackageCheck, color: '#7C3AED' },
  transfer:              { label: 'Transferred',          category: 'lifecycle', icon: ArrowLeftRight, color: '#0891B2' },
  transfer_in:           { label: 'Transferred In',       category: 'lifecycle', icon: ArrowLeftRight, color: '#0891B2' },
  assign:                { label: 'Assigned',             category: 'edit',      icon: User,        color: '#B45309' },
  status_change:         { label: 'Status',               category: 'status',    icon: ArrowLeftRight },
  item_work:             { label: 'Item Work',            category: 'status',    icon: CheckCircle2, color: '#0891B2' },
  quote_revised:         { label: 'Quote Revised',        category: 'status',    icon: Pencil,      color: '#B45309' },
  quote_resent:          { label: 'Quote Re-sent',        category: 'email',     icon: Send },
  cod_storage_set:       { label: 'COD Storage On',       category: 'billing',   icon: DollarSign,  color: '#CA8A04' },
  cod_storage_removed:   { label: 'COD Storage Off',      category: 'billing',   icon: DollarSign,  color: '#6B7280' },
  cod_storage_collected: { label: 'COD Storage Paid',     category: 'billing',   icon: DollarSign },
  create_invoice:        { label: 'Invoice Created',      category: 'billing',   icon: DollarSign },
  reissue_invoice:       { label: 'Invoice Re-issued',    category: 'billing',   icon: DollarSign,  color: '#B45309' },
  void_invoice:          { label: 'Invoice Voided',       category: 'billing',   icon: XCircle,     color: '#DC2626' },
  void:                  { label: 'Voided',               category: 'billing',   icon: XCircle,     color: '#DC2626' },
  qbo_push:              { label: 'Pushed to QuickBooks', category: 'billing',   icon: Send },
  qbo_push_failed:       { label: 'QuickBooks Push Failed', category: 'billing', icon: XCircle,     color: '#DC2626' },
  charge_added:          { label: 'Charge Added',         category: 'billing',   icon: DollarSign },
  insurance_charge:      { label: 'Insurance Charge',     category: 'billing',   icon: DollarSign },
  quote_email_sent:      { label: 'Quote Sent',           category: 'email',     icon: Mail },
  approve:               { label: 'Approved',             category: 'status',    icon: CheckCircle2, color: '#15803D' },
  reject:                { label: 'Rejected',             category: 'status',    icon: XCircle,     color: '#DC2626' },
  revision_requested:    { label: 'Revision Requested',   category: 'status',    icon: RotateCcw,   color: '#B45309' },
  push_to_dt:            { label: 'Pushed to DispatchTrack', category: 'status', icon: Send,        color: '#0891B2' },
  repush_to_dt:          { label: 'Re-pushed to DispatchTrack', category: 'status', icon: Send,     color: '#0891B2' },
  cancel_dt:             { label: 'DT Order Cancelled',   category: 'status',    icon: XCircle,     color: '#DC2626' },
  release_items:         { label: 'Items Released',       category: 'lifecycle', icon: PackageCheck, color: '#7C3AED' },
  convert_to_pd:         { label: 'Converted to P+D',     category: 'edit',      icon: ArrowLeftRight },
  driver_event:          { label: 'Driver',               category: 'driver',    icon: Truck },
  pickup_completed:      { label: 'Pickup Completed',     category: 'status',    icon: Truck,       color: '#15803D' },
  delivery_order_created:{ label: 'Added to Delivery Order', category: 'lifecycle', icon: Truck,    color: '#0891B2' },
  added_to_will_call:    { label: 'Added to Will Call',   category: 'lifecycle', icon: PackageCheck, color: '#0891B2' },
  removed_from_will_call:{ label: 'Removed from Will Call', category: 'lifecycle', icon: PackageCheck, color: '#B45309' },
  photo_upload:          { label: 'Photo Uploaded',       category: 'photo',     icon: Camera },
  photo_delete:          { label: 'Photo Deleted',        category: 'photo',     icon: Camera,      color: '#DC2626' },
  note_added:            { label: 'Note Added',           category: 'edit',      icon: MessageSquare, color: '#0891B2' },
  work_order_printed:    { label: 'Work Order Printed',   category: 'edit',      icon: Printer },
  created:               { label: 'Created',              category: 'lifecycle', icon: Plus },
};

// ─── Field/value formatting ─────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  itemClass: 'Class', item_class: 'Class', dueDate: 'Due Date', due_date: 'Due Date',
  taskNotes: 'Notes', task_notes: 'Notes', itemNotes: 'Notes', item_notes: 'Notes',
  repair_notes: 'Notes', assignedTo: 'Assigned To', assigned_to: 'Assigned To',
  customPrice: 'Custom Price', custom_price: 'Custom Price', declaredValue: 'Declared Value',
  declared_value: 'Declared Value', coverageOptionId: 'Coverage', coverage_option_id: 'Coverage',
  svcCode: 'Service', svc_code: 'Service', invoiceNo: 'Invoice', invoice_no: 'Invoice',
  wcNumber: 'Will Call', dtIdentifier: 'DT Order', reviewStatus: 'Review Status',
  qboDocNumber: 'QBO Doc #', qboInvoiceId: 'QBO Invoice Id',
};

function prettyField(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

const MONEY_KEYS = /(total|amount|price|rate|fee|value)$/i;

function fmtVal(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number' && MONEY_KEYS.test(key)) return `$${v.toFixed(2)}`;
  if (Array.isArray(v)) return v.map(x => String(x)).join(', ');
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  const s = String(v);
  if (MONEY_KEYS.test(key) && s !== '' && !Number.isNaN(Number(s))) return `$${Number(s).toFixed(2)}`;
  return s;
}

function formatWho(raw: string | null | undefined): { who: string; isEmail: boolean } {
  const s = (raw ?? '').trim();
  if (!s) return { who: 'System', isEmail: false };
  // EF/system labels like 'update-task-sb' or 'system' read as System-ish.
  if (!s.includes('@')) {
    if (/^[a-z0-9-]+$/.test(s) && s.includes('-')) return { who: 'System', isEmail: false };
    return { who: s, isEmail: false };
  }
  return { who: s.slice(0, s.indexOf('@')), isEmail: true };
}

function prettyTemplateKey(key: string): string {
  const k = key.replace(/^DOC_|^EMAIL_/i, '').replace(/_/g, ' ').toLowerCase().trim();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

// Pull a display-worthy amount out of email_sends.tokens, if one exists.
function amountFromTokens(tokens: Record<string, unknown> | null): string | null {
  if (!tokens || typeof tokens !== 'object') return null;
  for (const k of ['GRAND_TOTAL', 'QUOTE_TOTAL', 'TOTAL', 'AMOUNT', 'INVOICE_TOTAL']) {
    const v = tokens[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      const s = String(v).trim();
      return s.startsWith('$') ? s : (Number.isNaN(Number(s)) ? s : `$${Number(s).toFixed(2)}`);
    }
  }
  return null;
}

// ─── Audit-row → TimelineEvent mapping ──────────────────────────────────────

interface AuditRow {
  id: string;
  entity_id: string;
  action: string;
  changes: Record<string, unknown> | null;
  performed_by: string | null;
  performed_by_name: string | null;
  performed_at: string;
  source: string | null;
}

const FRAMING_KEYS = new Set(['summary', 'status', 'result', 'requestId', 'resend', 'revision', 'skipEmail']);

function diffsFromChanges(changes: Record<string, unknown> | null): Diff[] {
  if (!changes || typeof changes !== 'object') return [];
  const out: Diff[] = [];
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'summary') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && ('old' in (v as object) || 'new' in (v as object))) {
      const d = v as { old?: unknown; new?: unknown };
      out.push({ field: prettyField(k), old: d.old != null && d.old !== '' ? fmtVal(k, d.old) : null, new: d.new != null && d.new !== '' ? fmtVal(k, d.new) : null });
    } else if (v !== undefined && v !== null && v !== '' && k !== 'status') {
      out.push({ field: prettyField(k), old: null, new: fmtVal(k, v) });
    }
  }
  return out;
}

function auditToEvent(r: AuditRow, isRelated: boolean): TimelineEvent {
  const changes = (r.changes && typeof r.changes === 'object') ? r.changes as Record<string, unknown> : null;
  const meta = ACTION_META[r.action] ?? { label: prettyField(r.action), category: 'other' as Category, icon: Clock };
  const color = meta.color ?? CATEGORY_META[meta.category].color;
  // Prefer the display name when a writer recorded one (browser-side
  // logEntityAudit does); fall back to the email local-part.
  const { who, isEmail } = r.performed_by_name?.trim()
    ? { who: r.performed_by_name.trim(), isEmail: false }
    : formatWho(r.performed_by);

  let title = meta.label;
  let detail: string | undefined;
  let diffs: Diff[] = [];
  let category = meta.category;
  let photoDedupeKey: string | undefined;
  let billingDedupeKey: string | undefined;
  let emailDedupeKey: string | undefined;

  const summary = changes?.summary != null ? String(changes.summary) : '';
  const status = changes?.status && typeof changes.status === 'object'
    ? changes.status as { old?: string; new?: string } : null;

  if (status?.new) {
    title = status.old ? `Status: ${status.old} → ${status.new}` : `Status: → ${status.new}`;
    if (category === 'edit' || category === 'other') category = 'status';
    diffs = diffsFromChanges(changes).filter(d => d.field !== 'Status');
    if (changes?.result) detail = `Result: ${String(changes.result)}`;
  } else if (r.action === 'update') {
    diffs = diffsFromChanges(changes);
    const real = diffs.filter(d => d.old !== null);
    if (diffs.length === 1) {
      const d = diffs[0];
      title = d.old !== null ? `${d.field} changed: ${d.old} → ${d.new ?? '—'}` : `${d.field} set to ${d.new ?? '—'}`;
      diffs = [];
    } else if (diffs.length > 1) {
      title = `Updated ${diffs.map(d => d.field).join(', ')}`;
      if (real.length > 0) detail = `${real.length} field${real.length === 1 ? '' : 's'} changed`;
    } else if (summary) {
      title = 'Updated';
    }
  } else {
    diffs = diffsFromChanges(changes);
  }

  // Action-specific titles/details.
  switch (r.action) {
    case 'create_invoice': {
      const inv = changes?.invoiceNo ? String(changes.invoiceNo) : '';
      title = inv ? `Invoice ${inv} created` : 'Invoice created';
      const total = changes?.total != null ? fmtVal('total', changes.total) : null;
      const rows = changes?.rowsInvoiced != null ? `${changes.rowsInvoiced} row${Number(changes.rowsInvoiced) === 1 ? '' : 's'}` : null;
      detail = [total ? `Total: ${total}` : null, rows].filter(Boolean).join(' · ') || undefined;
      diffs = diffs.filter(d => !/^(Invoice|Total|Rows Invoiced|Ledger Row Ids)$/.test(d.field));
      break;
    }
    case 'qbo_push': {
      const doc = changes?.qboDocNumber ? String(changes.qboDocNumber) : '';
      detail = [doc ? `QBO Doc ${doc}` : null, changes?.total != null ? `Total: ${fmtVal('total', changes.total)}` : null]
        .filter(Boolean).join(' · ') || undefined;
      break;
    }
    case 'charge_added': {
      // Manual charge added from an entity page (universal "Add Charge").
      const svc = changes?.service ? String(changes.service) : (changes?.svcCode ? String(changes.svcCode) : '');
      const amt = changes?.total != null ? fmtVal('total', changes.total) : null;
      title = `Charge added${svc ? `: ${svc}` : ''}`;
      detail = amt ? `Amount: ${amt}` : undefined;
      billingDedupeKey = changes?.ledgerRowId ? String(changes.ledgerRowId) : undefined;
      diffs = [];
      break;
    }
    case 'added_to_will_call':
    case 'removed_from_will_call': {
      const wc = changes?.wcNumber ? String(changes.wcNumber) : '';
      if (wc) title = `${meta.label}: ${wc}`;
      break;
    }
    case 'delivery_order_created': {
      const dt = changes?.dt_identifier ? String(changes.dt_identifier) : '';
      if (dt) title = `${meta.label}: ${dt}`;
      diffs = [];
      break;
    }
    case 'pickup_completed': {
      const dt = changes?.dtIdentifier ? String(changes.dtIdentifier) : '';
      if (dt) detail = `Order ${dt}`;
      break;
    }
    case 'photo_upload':
    case 'photo_delete': {
      const fn = changes?.fileName ? String(changes.fileName) : '';
      if (fn) title = `${meta.label}: ${fn}`;
      photoDedupeKey = changes?.photoId ? String(changes.photoId) : undefined;
      diffs = [];
      break;
    }
    case 'note_added': {
      // Client-authored notes are called out — staff reading the feed
      // cares whether the customer or a colleague wrote it.
      const role = changes?.authorRole ? String(changes.authorRole) : '';
      if (role === 'client') title = 'Note added by client';
      if (summary) detail = summary;
      diffs = [];
      break;
    }
    case 'quote_email_sent': {
      const to = Array.isArray(changes?.recipients) ? (changes!.recipients as unknown[]).join(', ') : '';
      title = to ? `Quote sent to ${to}` : 'Quote email sent';
      const amt = changes?.amount != null ? fmtVal('amount', changes.amount) : null;
      detail = [amt ? `Amount: ${amt}` : null, changes?.revision ? 'Revision' : null, changes?.resend ? 'Re-send' : null]
        .filter(Boolean).join(' · ') || undefined;
      emailDedupeKey = changes?.emailSendId ? String(changes.emailSendId) : undefined;
      diffs = [];
      break;
    }
    case 'insurance_charge': {
      const amt = changes?.total != null ? fmtVal('total', changes.total) : null;
      title = amt ? `Insurance charge: ${amt}` : 'Insurance charge';
      const period = changes?.periodStart && changes?.periodEnd
        ? `${fmtDate(String(changes.periodStart))} → ${fmtDate(String(changes.periodEnd))}` : null;
      detail = [changes?.client ? String(changes.client) : null, period, changes?.final ? 'Final (cancellation)' : null]
        .filter(Boolean).join(' · ') || undefined;
      diffs = [];
      break;
    }
    case 'repush_to_dt': {
      const cf = Array.isArray(changes?.changedFields) ? (changes!.changedFields as unknown[]) : null;
      if (cf && cf.length) detail = `Changed: ${cf.join(', ')}`;
      break;
    }
    case 'release': {
      const ids = Array.isArray(changes?.releasedItemIds) ? (changes!.releasedItemIds as unknown[]) : null;
      if (ids && ids.length) detail = `${ids.length} item${ids.length === 1 ? '' : 's'}: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? '…' : ''}`;
      if (changes?.isPartial) title = 'Partially Released';
      break;
    }
  }

  if (!detail && summary && !status?.new) detail = summary;
  else if (summary && status?.new) detail = detail ? `${detail} · ${summary}` : summary;

  // Money tail per spec ("Amount: $228.20") for rows carrying a bare total.
  if (!detail && changes && !status?.new && r.action !== 'update') {
    const t = changes['total'] ?? changes['amount'];
    if (t != null && t !== '') detail = `Amount: ${fmtVal('total', t)}`;
  }

  // Drop framing-only diffs so the expand affordance means something.
  diffs = diffs.filter(d => !FRAMING_KEYS.has(d.field.toLowerCase()));

  return {
    id: `audit:${r.id}`,
    category, icon: meta.icon, color, title, detail,
    who, whoIsEmail: isEmail,
    when: r.performed_at, source: r.source ?? undefined, diffs,
    relatedId: isRelated ? r.entity_id : undefined,
    photoDedupeKey,
    billingDedupeKey,
    emailDedupeKey,
  };
}

// ─── Enrichment table mappings ──────────────────────────────────────────────

const DOC_CONTEXT_BY_ENTITY: Record<string, string> = {
  inventory: 'item', will_call: 'willcall', task: 'task', repair: 'repair', shipment: 'shipment', claim: 'claim',
};

const BILLING_LINK_COL: Record<string, string> = {
  inventory: 'item_id', task: 'task_id', repair: 'repair_id', shipment: 'shipment_number',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function ActivityTimeline({ entityType, entityId, tenantId, relatedEntityIds, compact }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  /** True when the Supabase session is gone — queries silently ran as anon
   *  and RLS filtered everything, so "no activity" would be a lie. */
  const [sessionMissing, setSessionMissing] = useState(false);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const relatedIds = useMemo(
    () => (relatedEntityIds ?? []).map(s => String(s ?? '').trim()).filter(s => s && s !== entityId),
    [relatedEntityIds, entityId],
  );
  // Stable dep key — callers commonly pass a fresh array literal each render.
  const relatedKey = relatedIds.join('\u0000');

  const loadEvents = useCallback(async () => {
    if (!entityId) return;
    const collected: TimelineEvent[] = [];

    const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch { /* best-effort per source */ } };

    await Promise.all([
      // 1. entity_audit_log — the spine.
      safe(async () => {
        let q = supabase
          .from('entity_audit_log')
          .select('id, entity_id, action, changes, performed_by, performed_by_name, performed_at, source')
          .eq('entity_type', entityType)
          .eq('entity_id', entityId)
          .order('performed_at', { ascending: false })
          .limit(150);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data } = await q;
        for (const r of (data ?? []) as AuditRow[]) collected.push(auditToEvent(r, false));
      }),

      // 1b. Linked entities' audit rows (Item page cross-entity story).
      safe(async () => {
        if (relatedIds.length === 0) return;
        let q = supabase
          .from('entity_audit_log')
          .select('id, entity_id, action, changes, performed_by, performed_by_name, performed_at, source')
          .in('entity_id', relatedIds.slice(0, 50))
          .order('performed_at', { ascending: false })
          .limit(150);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data } = await q;
        for (const r of (data ?? []) as AuditRow[]) collected.push(auditToEvent(r, true));
      }),

      // 2. email_sends — match on related_entity_id (ids are unique per type).
      safe(async () => {
        let q = supabase
          .from('email_sends')
          .select('id, template_key, to_emails, subject, status, error_message, tokens, sent_at, created_at')
          .eq('related_entity_id', entityId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data } = await q;
        for (const r of (data ?? []) as Array<{ id: string; template_key: string; to_emails: string[] | null; subject: string | null; status: string; error_message: string | null; tokens: Record<string, unknown> | null; sent_at: string | null; created_at: string }>) {
          const failed = r.status === 'failed';
          const to = (r.to_emails ?? []).join(', ');
          const amount = amountFromTokens(r.tokens);
          collected.push({
            id: `email:${r.id}`,
            category: 'email',
            icon: Mail,
            color: failed ? '#DC2626' : CATEGORY_META.email.color,
            title: failed
              ? `Email failed: ${prettyTemplateKey(r.template_key)}`
              : `${prettyTemplateKey(r.template_key)} sent${to ? ` to ${to}` : ''}`,
            detail: failed
              ? (r.error_message ?? undefined)
              : [amount ? `Amount: ${amount}` : null, r.subject || null].filter(Boolean).join(' · ') || undefined,
            who: 'System', whoIsEmail: false,
            when: r.sent_at ?? r.created_at,
            diffs: [],
          });
        }
      }),

      // 3. item_photos — uploads. (Deletes come from photo_delete audit rows;
      //    upload audit rows dedupe against these via photoId.)
      safe(async () => {
        if (!['inventory', 'task', 'repair', 'will_call', 'shipment', 'claim', 'batch'].includes(entityType)) return;
        let q = supabase
          .from('item_photos')
          .select('id, file_name, photo_type, uploaded_by_name, created_at')
          .order('created_at', { ascending: false })
          .limit(50);
        q = entityType === 'inventory'
          ? q.eq('item_id', entityId)
          : q.eq('entity_type', entityType).eq('entity_id', entityId);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data } = await q;
        for (const r of (data ?? []) as Array<{ id: string; file_name: string | null; photo_type: string | null; uploaded_by_name: string | null; created_at: string }>) {
          const { who, isEmail } = formatWho(r.uploaded_by_name);
          collected.push({
            id: `photo:${r.id}`,
            category: 'photo', icon: Camera, color: CATEGORY_META.photo.color,
            title: `Photo uploaded: ${r.file_name || 'photo'}`,
            detail: r.photo_type && r.photo_type !== 'general' ? prettyField(r.photo_type) : undefined,
            who, whoIsEmail: isEmail,
            when: r.created_at, diffs: [], photoDedupeKey: r.id,
          });
        }
      }),

      // 4. documents — uploads (soft-deleted excluded).
      safe(async () => {
        const ctx = DOC_CONTEXT_BY_ENTITY[entityType];
        if (!ctx) return;
        let q = supabase
          .from('documents')
          .select('id, file_name, uploaded_by_name, created_at')
          .eq('context_type', ctx)
          .eq('context_id', entityId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(50);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data } = await q;
        for (const r of (data ?? []) as Array<{ id: string; file_name: string; uploaded_by_name: string | null; created_at: string }>) {
          const { who, isEmail } = formatWho(r.uploaded_by_name);
          collected.push({
            id: `doc:${r.id}`,
            category: 'document', icon: FileText, color: CATEGORY_META.document.color,
            title: `Document uploaded: ${r.file_name}`,
            who, whoIsEmail: isEmail,
            when: r.created_at, diffs: [],
          });
        }
      }),

      // 5. move_history — inventory only.
      safe(async () => {
        if (entityType !== 'inventory') return;
        let q = supabase
          .from('move_history')
          .select('id, from_location, to_location, moved_by, moved_at, source, notes')
          .eq('item_id', entityId)
          .order('moved_at', { ascending: false })
          .limit(50);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data } = await q;
        for (const r of (data ?? []) as Array<{ id: string; from_location: string | null; to_location: string; moved_by: string | null; moved_at: string; source: string | null; notes: string | null }>) {
          const { who, isEmail } = formatWho(r.moved_by);
          collected.push({
            id: `move:${r.id}`,
            category: 'move', icon: MapPin, color: CATEGORY_META.move.color,
            title: `Moved: ${r.from_location || '—'} → ${r.to_location}`,
            detail: r.notes || undefined,
            who, whoIsEmail: isEmail,
            when: r.moved_at, source: r.source ?? undefined, diffs: [],
          });
        }
      }),

      // 6. storage_credits — inventory only; whole-client credits included
      //    because they waive this item's storage too.
      safe(async () => {
        if (entityType !== 'inventory' || !tenantId) return;
        const { data } = await supabase
          .from('storage_credits')
          .select('id, item_id, free_from, free_to, reason, created_by, created_at')
          .eq('tenant_id', tenantId)
          .or(`item_id.eq.${entityId},item_id.is.null`)
          .order('created_at', { ascending: false })
          .limit(25);
        for (const r of (data ?? []) as Array<{ id: string; item_id: string | null; free_from: string; free_to: string; reason: string | null; created_by: string | null; created_at: string }>) {
          const { who, isEmail } = formatWho(r.created_by);
          collected.push({
            id: `credit:${r.id}`,
            category: 'credit', icon: BadgePercent, color: CATEGORY_META.credit.color,
            title: `Storage credit: ${fmtDate(r.free_from)} → ${fmtDate(r.free_to)}`,
            detail: [r.item_id ? null : 'Whole client', r.reason || null].filter(Boolean).join(' · ') || undefined,
            who, whoIsEmail: isEmail,
            when: r.created_at, diffs: [],
          });
        }
      }),

      // 7. billing — ledger charges linked to this entity.
      safe(async () => {
        const col = BILLING_LINK_COL[entityType];
        if (!col) return;
        let q = supabase
          .from('billing')
          .select('ledger_row_id, svc_code, svc_name, total, status, invoice_no, date, created_at')
          .eq(col, entityId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data } = await q;
        for (const r of (data ?? []) as Array<{ ledger_row_id: string; svc_code: string | null; svc_name: string | null; total: number | null; status: string | null; invoice_no: string | null; date: string | null; created_at: string | null }>) {
          if (!r.created_at) continue;
          const name = r.svc_name || r.svc_code || 'Charge';
          collected.push({
            id: `billing:${r.ledger_row_id}`,
            category: 'billing', icon: DollarSign,
            color: r.status === 'Void' ? '#6B7280' : CATEGORY_META.billing.color,
            title: `Charge: ${name}${r.total != null ? ` — $${Number(r.total).toFixed(2)}` : ''}`,
            detail: [r.status || null, r.invoice_no ? `Invoice ${r.invoice_no}` : null, r.date ? `Service date ${r.date}` : null]
              .filter(Boolean).join(' · ') || undefined,
            who: 'System', whoIsEmail: false,
            when: r.created_at, diffs: [],
          });
        }
      }),

      // 8. dt_order_history — DT driver events (dt_order only).
      safe(async () => {
        if (entityType !== 'dt_order') return;
        const { data } = await supabase
          .from('dt_order_history')
          .select('id, code, description, owner_name, owner_type, happened_at')
          .eq('dt_order_id', entityId)
          .order('happened_at', { ascending: false })
          .limit(100);
        for (const r of (data ?? []) as Array<{ id: string; code: number | null; description: string | null; owner_name: string | null; owner_type: string | null; happened_at: string }>) {
          const { who, isEmail } = formatWho(r.owner_name);
          collected.push({
            id: `dt:${r.id}`,
            category: 'driver', icon: Truck, color: CATEGORY_META.driver.color,
            title: r.description || 'Driver event',
            detail: r.code != null ? `Code ${r.code}` : undefined,
            who, whoIsEmail: isEmail,
            when: r.happened_at, source: 'dt_export', diffs: [],
          });
        }
      }),
    ]);

    // Dedupe photo events: an audit photo_upload row and the item_photos row
    // describe the same upload — keep the enrichment row (richer), drop the
    // audit twin.
    const photoKeys = new Set(
      collected.filter(e => e.id.startsWith('photo:') && e.photoDedupeKey).map(e => e.photoDedupeKey as string),
    );
    // A manual charge writes a `charge_added` audit row (with attribution)
    // AND surfaces via the billing enrichment ("Charge: …", System). Drop the
    // enrichment twin so the attributed audit row wins; system-generated
    // charges have no audit twin and still show via enrichment.
    const manualChargeKeys = new Set(
      collected.filter(e => e.id.startsWith('audit:') && e.billingDedupeKey).map(e => e.billingDedupeKey as string),
    );
    // A quote send writes a quote_email_sent audit row (with attribution +
    // amount) AND surfaces via the email_sends enrichment. Drop the
    // enrichment twin so the attributed audit row wins.
    const auditEmailKeys = new Set(
      collected.filter(e => e.id.startsWith('audit:') && e.emailDedupeKey).map(e => e.emailDedupeKey as string),
    );
    const deduped = collected.filter(e =>
      !(e.id.startsWith('audit:') && e.photoDedupeKey && photoKeys.has(e.photoDedupeKey)) &&
      !(e.id.startsWith('billing:') && manualChargeKeys.has(e.id.slice('billing:'.length))) &&
      !(e.id.startsWith('email:') && auditEmailKeys.has(e.id.slice('email:'.length))));

    deduped.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
    if (mountedRef.current) setEvents(deduped.slice(0, 300));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, tenantId, relatedKey]);

  // Initial load.
  useEffect(() => {
    if (!entityId) return;
    setLoading(true);
    setLoaded(false);
    void (async () => {
      await loadEvents();
      // An expired/missing Supabase session makes every query above run as
      // ANON: entity_audit_log returns [] (RLS-filtered) instead of erroring,
      // which would render as a misleading "No activity recorded yet"
      // (item-211 incident, 2026-06-12). Detect it so the empty state can
      // say what's actually wrong. AuthContext's dead-session detector
      // bounces the app to the login screen shortly after; this covers
      // the gap until it fires.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (mountedRef.current) setSessionMissing(!session);
      } catch { /* transient — leave as-is */ }
    })().finally(() => {
      if (mountedRef.current) { setLoading(false); setLoaded(true); }
    });
  }, [entityId, loadEvents]);

  // Realtime — new audit rows / photos / docs / emails / moves stream in.
  // Single channel, multiple table listeners; refetch is debounced so a
  // burst of inserts coalesces into one reload.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded || !entityId) return;
    const scheduleReload = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => { void loadEvents(); }, 400);
    };
    const channel = supabase.channel(`activity_timeline_${entityType}_${entityId}`);
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'entity_audit_log', filter: `entity_id=eq.${entityId}` },
      scheduleReload);
    channel.on('postgres_changes',
      { event: '*', schema: 'public', table: 'item_photos',
        filter: entityType === 'inventory' ? `item_id=eq.${entityId}` : `entity_id=eq.${entityId}` },
      scheduleReload);
    const ctx = DOC_CONTEXT_BY_ENTITY[entityType];
    if (ctx) {
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'documents', filter: `context_id=eq.${entityId}` },
        scheduleReload);
    }
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'email_sends', filter: `related_entity_id=eq.${entityId}` },
      scheduleReload);
    if (entityType === 'inventory') {
      channel.on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'move_history', filter: `item_id=eq.${entityId}` },
        scheduleReload);
    }
    if (entityType === 'dt_order') {
      channel.on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dt_order_history', filter: `dt_order_id=eq.${entityId}` },
        scheduleReload);
    }
    channel.subscribe();
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [loaded, entityType, entityId, loadEvents]);

  // Categories present in the data drive the filter options.
  const presentCategories = useMemo(() => {
    const set = new Set<Category>();
    for (const e of events) set.add(e.category);
    return (Object.keys(CATEGORY_META) as Category[]).filter(c => set.has(c));
  }, [events]);

  const visible = filter === 'all' ? events : events.filter(e => e.category === filter);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div>
      {/* Header strip — count + category filter. */}
      {!compact && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          flexWrap: 'wrap',
        }}>
          <Clock size={14} style={{ color: theme.colors.textSecondary }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary }}>
            Activity
            {events.length > 0 && (
              <span style={{ fontWeight: 400, color: theme.colors.textMuted }}> ({visible.length}{filter !== 'all' ? ` of ${events.length}` : ''})</span>
            )}
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <ListFilter size={12} style={{ color: theme.colors.textMuted }} />
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as Category | 'all')}
              style={{
                fontSize: 11, padding: '3px 6px', borderRadius: 6,
                border: `1px solid ${theme.colors.border}`,
                background: '#fff', color: theme.colors.textSecondary,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              <option value="all">All activity</option>
              {presentCategories.map(c => (
                <option key={c} value={c}>{CATEGORY_META[c].label}</option>
              ))}
            </select>
          </span>
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>Loading…</div>
      )}

      {!loading && visible.length === 0 && (
        sessionMissing && events.length === 0 ? (
          <div style={{
            fontSize: 12, color: '#B45309', background: '#FFFBEB',
            border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px',
          }}>
            Your session has expired — sign in again to see activity history.
          </div>
        ) : (
          <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>
            {events.length === 0 ? 'No activity recorded yet' : 'No activity matches this filter'}
          </div>
        )
      )}

      {!loading && visible.length > 0 && (
        <div style={{
          borderLeft: `2px solid ${theme.colors.borderLight}`,
          marginLeft: 9, paddingLeft: 18,
        }}>
          {visible.map(ev => {
            const Icon = ev.icon;
            const expandable = ev.diffs.length > 0;
            const isExpanded = expandedIds.has(ev.id);
            return (
              <div
                key={ev.id}
                style={{ position: 'relative', paddingBottom: 14, cursor: expandable ? 'pointer' : 'default' }}
                onClick={expandable ? () => toggleExpanded(ev.id) : undefined}
              >
                {/* Timeline icon dot */}
                <div style={{
                  position: 'absolute', left: -29, top: 0,
                  width: 20, height: 20, borderRadius: '50%',
                  background: '#fff', border: `2px solid ${ev.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={10} style={{ color: ev.color }} />
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: ev.color }}>
                    {ev.title}
                  </span>
                  {ev.relatedId && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
                      background: theme.colors.bgSubtle ?? '#F3F4F6', color: theme.colors.textMuted,
                      letterSpacing: '0.3px',
                    }}>
                      {ev.relatedId}
                    </span>
                  )}
                  {expandable && (
                    isExpanded
                      ? <ChevronDown size={12} style={{ color: theme.colors.textMuted }} />
                      : <ChevronRight size={12} style={{ color: theme.colors.textMuted }} />
                  )}
                </div>

                {ev.detail && (
                  <div style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 2, overflowWrap: 'anywhere' }}>
                    {ev.detail}
                  </div>
                )}

                {expandable && isExpanded && (
                  <div style={{
                    marginTop: 6, padding: '6px 10px', borderRadius: 8,
                    background: theme.colors.bgSubtle ?? '#F8FAFC',
                    border: `1px solid ${theme.colors.borderLight}`,
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    {ev.diffs.map((d, i) => (
                      <div key={i} style={{ fontSize: 11, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 600, color: theme.colors.textSecondary }}>{d.field}:</span>
                        {d.old !== null ? (
                          <>
                            <span style={{ color: theme.colors.textMuted, textDecoration: 'line-through' }}>{d.old}</span>
                            <span style={{ color: theme.colors.orange, fontWeight: 700 }}>{'→'}</span>
                            <span style={{ color: theme.colors.text, fontWeight: 600 }}>{d.new ?? '—'}</span>
                          </>
                        ) : (
                          <span style={{ color: theme.colors.text }}>{d.new ?? '—'}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: theme.colors.textMuted, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <User size={10} /> {ev.who}
                  </span>
                  <span style={{ fontSize: 10, color: theme.colors.textMuted }}>
                    {(() => { try { return fmtDateTime(ev.when); } catch { return ev.when; } })()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
