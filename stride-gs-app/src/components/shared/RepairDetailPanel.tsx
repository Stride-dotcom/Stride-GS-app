import React, { useEffect, useMemo, useState } from 'react';
import { X, Wrench, Package, ClipboardList, CheckCircle2, XCircle, AlertTriangle, Send, Loader2, Truck, Play, Pencil, MapPin, Plus, Trash2, Undo2 } from 'lucide-react';
import { TabbedDetailPanel, type TabbedDetailPanelTab } from './TabbedDetailPanel';
import { EntityPage } from './EntityPage';
import { DriveFoldersList, type DriveFolderLink } from './DriveFoldersList';
import { usePhotos } from '../../hooks/usePhotos';
import { useDocuments } from '../../hooks/useDocuments';
import { useEntityNotes } from '../../hooks/useEntityNotes';
import { PhotosPanel as _PhotosPanel, DocumentsPanel as _DocumentsPanel, NotesPanel as _NotesPanel } from './EntityAttachments';
import { EntityHistory } from './EntityHistory';
import { FolderButton } from './FolderButton';
import { DeepLink } from './DeepLink';
import { ItemIdBadges } from './ItemIdBadges';
import { useItemIndicators } from '../../hooks/useItemIndicators';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { postSendRepairQuote, postRespondToRepairQuote, postCompleteRepair, postStartRepair, postCancelRepair, postUpdateRepairNotes, postReopenRepair, postCorrectRepairResult, postVoidRepairQuote, isApiConfigured } from '../../lib/api';
import { entityEvents } from '../../lib/entityEvents';
import type { ApiRepair, SendRepairQuoteResponse, RespondToRepairQuoteResponse, CompleteRepairResponse, StartRepairResponse, SendRepairQuoteLine } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { writeSyncFailed } from '../../lib/syncEvents';
import { useAuth } from '../../contexts/AuthContext';

import type { Repair } from '../../lib/types';
interface Props {
  repair: ApiRepair;
  onClose: () => void;
  onRepairUpdated?: () => void;
  onNavigateToItem?: (itemId: string) => void;
  // Phase 2C — optimistic patch functions (optional)
  applyRepairPatch?: (repairId: string, patch: Partial<Repair>) => void;
  mergeRepairPatch?: (repairId: string, patch: Partial<Repair>) => void;
  clearRepairPatch?: (repairId: string) => void;
  addOptimisticRepair?: (repair: Repair) => void;
  removeOptimisticRepair?: (tempRepairId: string) => void;
  /** Session 80+ — render as full EntityPage instead of slide-out TabbedDetailPanel.
   *  Only swaps the outer shell. All tabs, handlers, modals, and edit logic
   *  are preserved exactly as-is. */
  renderAsPage?: boolean;
}

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  'Pending Quote': { bg: '#FEF3C7', color: '#B45309' }, 'Quote Sent': { bg: '#EFF6FF', color: '#1D4ED8' },
  'Approved': { bg: '#F0FDF4', color: '#15803D' }, 'Declined': { bg: '#FEF2F2', color: '#DC2626' },
  'In Progress': { bg: '#EDE9FE', color: '#7C3AED' }, 'Complete': { bg: '#F0FDF4', color: '#15803D' },
  'Cancelled': { bg: '#F3F4F6', color: '#6B7280' },
};

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) { return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>; }
function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) { return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, color: value ? theme.colors.text : theme.colors.textMuted, fontFamily: mono ? 'monospace' : 'inherit' }}>{String(value ?? '\u2014')}</div></div>; }

const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' };

export function RepairDetailPanel({ repair, onClose, onRepairUpdated, applyRepairPatch, clearRepairPatch, renderAsPage }: Props) {
  const { user } = useAuth();
  // v2026-04-22 — panel frame handled by TabbedDetailPanel shell.

  // Derive effective status from submit result (optimistic update).
  // Keep in sync with the repair prop — optimistic patches from the parent
  // hook (applyRepairPatch) update repair.status, and we need the header /
  // action footer to reflect that instead of the initial mount value.
  const [effectiveStatus, setEffectiveStatus] = useState<string>(repair.status);
  useEffect(() => { setEffectiveStatus(repair.status); }, [repair.status]);
  const sc = STATUS_CFG[effectiveStatus] || STATUS_CFG['Pending Quote'];
  const isActive = !['Complete', 'Cancelled', 'Declined'].includes(effectiveStatus);

  // (I)(A)(R) indicator badges for the Item card below.
  const { inspOpenItems, inspDoneItems, asmOpenItems, asmDoneItems, repairOpenItems, repairDoneItems, wcOpenItems, wcDoneItems } = useItemIndicators(repair.clientSheetId);

  const [repairNotes, setRepairNotes] = useState(repair.repairNotes || '');
  const [showResultPrompt, setShowResultPrompt] = useState<'fail' | null>(null);
  const [completed, setCompleted] = useState(false);

  // ─── Quote builder state (v38.120.0 multi-line) ──────────────────────────
  // The Quote Tool model (already established for ad-hoc customer quotes)
  // is reused here: pre-tax line items + a tax_areas dropdown + computed
  // grand total. The customer-facing email shows the tax-INCLUSIVE total;
  // the QB billing rows that get written on completion are PRE-tax (one
  // per line) so QB doesn't double-tax.
  type LineDraft = {
    svcCode: string;
    svcName: string;
    qty: string;   // string in state for free typing; coerced on submit
    rate: string;
    taxable: boolean;
  };
  type CatalogEntry = {
    code: string;
    name: string;
    category: string | null;
    taxable: boolean | null;
    flat_rate: number | null;
    // v38.124.1 — class-based pricing. `billing` is "flat" or
    // "class_based"; for class_based, `rates` is a jsonb keyed by
    // class id (XS / S / M / L / XL — see classes table) with a
    // numeric rate per class. Restocking, packaging, palletizing,
    // and most warehouse services use this. We resolve the rate at
    // line-add time using the repair's item class.
    billing: string | null;
    rates: Record<string, number | null> | null;
  };
  type TaxArea = { id: string; name: string; rate: number };

  const initialLines: LineDraft[] = (() => {
    if (Array.isArray(repair.quoteLines) && repair.quoteLines.length > 0) {
      return repair.quoteLines.map(l => ({
        svcCode: l.svcCode, svcName: l.svcName,
        qty: String(l.qty), rate: String(l.rate),
        taxable: l.taxable === true,
      }));
    }
    // Pre-fill a single REPAIR line. If a quoteAmount was carried over
    // from a legacy single-input draft, seed it as the rate.
    const legacyRate = repair.quoteAmount != null && repair.quoteAmount > 0 ? String(repair.quoteAmount) : '';
    return [{ svcCode: 'REPAIR', svcName: 'Repair', qty: '1', rate: legacyRate, taxable: true }];
  })();
  const [quoteLines, setQuoteLines] = useState<LineDraft[]>(initialLines);
  const [taxAreaId, setTaxAreaId] = useState<string>(repair.quoteTaxAreaId || '');
  const [serviceCatalog, setServiceCatalog] = useState<CatalogEntry[]>([]);
  const [taxAreas, setTaxAreas] = useState<TaxArea[]>([]);

  // Load service catalog + tax areas on mount. Catalog is filtered to
  // Warehouse + Repair categories per spec — those are the codes that
  // can legitimately ride on a repair quote alongside the actual repair
  // charge (prep, restocking, fuel, packaging, etc.).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [catRes, taxRes] = await Promise.all([
        supabase.from('service_catalog')
          .select('code, name, category, taxable, flat_rate, billing, rates')
          .in('category', ['Warehouse', 'Repair'])
          .eq('active', true)
          .order('category', { ascending: true })
          .order('name', { ascending: true }),
        supabase.from('tax_areas')
          .select('id, name, rate')
          .eq('active', true)
          .order('name', { ascending: true }),
      ]);
      if (cancelled) return;
      if (!catRes.error && Array.isArray(catRes.data)) {
        setServiceCatalog(catRes.data as CatalogEntry[]);
      }
      if (!taxRes.error && Array.isArray(taxRes.data)) {
        const list = taxRes.data as TaxArea[];
        setTaxAreas(list);
        // If the repair didn't carry a tax area selection (new quote) and
        // we have areas, pick the first one as a sensible default — admin
        // can switch before sending.
        if (!taxAreaId && list.length > 0) setTaxAreaId(list[0].id);
      }
    })();
    return () => { cancelled = true; };
  // taxAreaId intentionally omitted — we only want to set the default once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v38.124.1 — once the catalog finishes loading, back-fill rates on
  // any line that still has an empty rate (the initial state was built
  // at mount time before the catalog was available, so the default
  // REPAIR line started with rate=''). Class-based lines pick up the
  // class-resolved rate from resolveCatalogRate via the same path
  // addLineFromCatalog uses. User-typed rates are NEVER overwritten.
  useEffect(() => {
    if (serviceCatalog.length === 0) return;
    setQuoteLines(prev => prev.map(l => {
      if (l.rate && l.rate !== '0') return l;        // user typed something, leave it
      const entry = serviceCatalog.find(e => e.code === l.svcCode);
      if (!entry) return l;
      const filled = resolveCatalogRate(entry);
      if (!filled) return l;                          // catalog has nothing usable
      return { ...l, rate: filled, taxable: entry.taxable === true };
    }));
  // resolveCatalogRate closes over `repair.itemClass` + serviceCatalog;
  // re-run if the class or catalog changes. setQuoteLines is stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceCatalog, repair.itemClass]);

  // Live totals — recomputed on every keystroke; same math the server
  // re-runs on submit so what you see is what gets quoted.
  const totals = useMemo(() => {
    const area = taxAreas.find(a => a.id === taxAreaId);
    const taxRate = area ? Number(area.rate) || 0 : 0;
    let subtotal = 0, taxable = 0;
    for (const l of quoteLines) {
      const q = Number(l.qty) || 0;
      const r = Number(l.rate) || 0;
      const amt = Math.round(q * r * 100) / 100;
      subtotal += amt;
      if (l.taxable) taxable += amt;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    taxable  = Math.round(taxable * 100) / 100;
    const taxAmount = Math.round(taxable * (taxRate / 100) * 100) / 100;
    const grand = Math.round((subtotal + taxAmount) * 100) / 100;
    return { subtotal, taxable, taxRate, taxAmount, grand, taxAreaName: area?.name || '' };
  }, [quoteLines, taxAreaId, taxAreas]);

  // v38.124.1 — class-aware rate resolver. Mirrors the same logic the
  // Quote Tool uses (`quoteCalc.ts`):
  //   • billing='class_based' + repair has an itemClass → use rates[itemClass]
  //   • Otherwise → use flat_rate (covers REPAIR + any non-class service)
  //   • If the lookup yields nothing (item missing class, rate not set
  //     in the catalog for that class) → return '' so the operator sees
  //     the rate cell empty and types one in. Better than silently
  //     showing $0.
  // Returns a STRING because the line draft stores rate as a string for
  // free typing. Bare numbers go through String() — empty stays empty.
  function resolveCatalogRate(entry: CatalogEntry | undefined): string {
    if (!entry) return '';
    if (entry.billing === 'class_based' && repair.itemClass) {
      const cls = String(repair.itemClass).trim();
      const rate = entry.rates && entry.rates[cls];
      if (rate != null && Number(rate) > 0) return String(rate);
      // Try common case variants in case the catalog stores keys in a
      // different case than the inventory column (e.g. "M" vs "m").
      const upper = cls.toUpperCase();
      const lower = cls.toLowerCase();
      if (entry.rates) {
        if (entry.rates[upper] != null && Number(entry.rates[upper]) > 0) return String(entry.rates[upper]);
        if (entry.rates[lower] != null && Number(entry.rates[lower]) > 0) return String(entry.rates[lower]);
      }
      // Fall through to flat_rate (which is normally 0 for class-based,
      // but a few catalog rows may have a sane fallback set).
    }
    if (entry.flat_rate != null && Number(entry.flat_rate) > 0) return String(entry.flat_rate);
    return '';
  }

  function addLineFromCatalog(code: string) {
    const entry = serviceCatalog.find(e => e.code === code);
    if (!entry) return;
    setQuoteLines(prev => [...prev, {
      svcCode: entry.code,
      svcName: entry.name || entry.code,
      qty: '1',
      rate: resolveCatalogRate(entry),
      taxable: entry.taxable === true,
    }]);
  }
  function updateLineField(idx: number, field: keyof LineDraft, value: string | boolean) {
    setQuoteLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }
  function removeLine(idx: number) {
    setQuoteLines(prev => prev.filter((_, i) => i !== idx));
  }
  // When the user changes an svcCode dropdown on an existing line, pull
  // the new catalog entry's name + taxable + class-aware rate. Switching
  // services overwrites the rate (you picked a different service, so the
  // old custom rate doesn't apply); subsequent manual edits to the rate
  // input are preserved as before via updateLineField.
  function changeLineService(idx: number, code: string) {
    const entry = serviceCatalog.find(e => e.code === code);
    setQuoteLines(prev => prev.map((l, i) => i === idx ? {
      ...l,
      svcCode: code,
      svcName: entry?.name || code,
      taxable: entry?.taxable === true,
      rate: resolveCatalogRate(entry),
    } : l));
  }

  // Submit state (shared across actions)
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<SendRepairQuoteResponse | null>(null);

  // Approve / Decline state
  const [respondResult, setRespondResult] = useState<RespondToRepairQuoteResponse | null>(null);

  // Complete Repair state
  const [completeResult, setCompleteResult] = useState<CompleteRepairResponse | null>(null);

  // Start Repair state
  const [startResult, setStartResult] = useState<StartRepairResponse | null>(null);

  // v38.61.1 — Save Notes (before Start Repair) state. Separate from `submitting`
  // so the Save Notes button doesn't disable/spin the Approve/Start/Complete buttons.
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);

  // Track the last-saved notes so the Save button can enable only when dirty.
  const [savedRepairNotes, setSavedRepairNotes] = useState(repair.repairNotes || '');
  useEffect(() => { setSavedRepairNotes(repair.repairNotes || ''); }, [repair.repairNotes]);
  const notesDirty = repairNotes !== savedRepairNotes;

  // ─── Stage B: Reopen + Result correction ────────────────────────────────
  const canStaffEdit = user?.role === 'admin' || user?.role === 'staff';
  const [reopenLoading, setReopenLoading] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [showCorrectRepairResult, setShowCorrectRepairResult] = useState(false);
  const [correctRepairResultLoading, setCorrectRepairResultLoading] = useState(false);
  const [correctRepairResultError, setCorrectRepairResultError] = useState<string | null>(null);
  const [correctedRepairResult, setCorrectedRepairResult] = useState<'Pass' | 'Fail' | null>(null);

  const handleReopenRepairClick = async () => {
    if (!isApiConfigured() || !repair.clientSheetId) return;
    const cur = repair.status || '';
    let confirmMsg = '';
    if (cur === 'Completed' || cur === 'Complete') {
      confirmMsg = 'Reopen this repair?\n\nThis will:\n  • revert status to In Progress\n  • void any Unbilled billing row created by Complete\n  • clear Repair Result + Completed Date\n\nBlocked if billing already invoiced.';
    } else if (cur === 'In Progress') {
      confirmMsg = 'Reopen this repair?\n\nReverts status to Approved and clears Start Date. No billing impact.';
    } else {
      return;
    }
    const reason = window.prompt(confirmMsg + '\n\nReason (optional):');
    if (reason === null) return;
    setReopenLoading(true);
    setReopenError(null);
    try {
      const resp = await postReopenRepair({ repairId: repair.repairId, reason: reason || '' }, repair.clientSheetId);
      if (resp.ok && resp.data?.success) {
        onRepairUpdated?.();
      } else {
        setReopenError(resp.data?.error || resp.error || 'Failed to reopen repair');
      }
    } catch {
      setReopenError('Network error — please try again');
    }
    setReopenLoading(false);
  };

  const handleCorrectRepairResultClick = async (newResult: 'Pass' | 'Fail') => {
    if (!isApiConfigured() || !repair.clientSheetId) return;
    setCorrectRepairResultLoading(true);
    setCorrectRepairResultError(null);
    try {
      const resp = await postCorrectRepairResult({ repairId: repair.repairId, newResult }, repair.clientSheetId);
      if (resp.ok && resp.data?.success) {
        setCorrectedRepairResult(newResult);
        setShowCorrectRepairResult(false);
        onRepairUpdated?.();
      } else {
        setCorrectRepairResultError(resp.data?.error || resp.error || 'Failed to correct result');
      }
    } catch {
      setCorrectRepairResultError('Network error — please try again');
    }
    setCorrectRepairResultLoading(false);
  };

  const currentRepairResultForWidget: string = correctedRepairResult || repair.repairResult || '';

  // ─── Edit mode for repair fields (Repair Tech, Scheduled Date, Start Date) ──
  const [isEditing, setIsEditing] = useState(false);
  const [editRepairVendor, setEditRepairVendor] = useState(repair.repairVendor || '');
  const [editScheduledDate, setEditScheduledDate] = useState(repair.scheduledDate || '');
  const [editStartDate, setEditStartDate] = useState(repair.startDate || '');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  useEffect(() => {
    setEditRepairVendor(repair.repairVendor || '');
    setEditScheduledDate(repair.scheduledDate || '');
    setEditStartDate(repair.startDate || '');
  }, [repair.repairVendor, repair.scheduledDate, repair.startDate]);

  // ─── Save Repair Fields (Repair Tech, Scheduled Date, Start Date) ──────────
  const handleEditSave = async () => {
    const clientSheetId = repair.clientSheetId;
    if (!isApiConfigured() || !clientSheetId) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const payload: Record<string, unknown> = { repairId: repair.repairId };
      if (editRepairVendor !== (repair.repairVendor || '')) payload.repairVendor = editRepairVendor;
      if (editScheduledDate !== (repair.scheduledDate || '')) payload.scheduledDate = editScheduledDate || null;
      if (editStartDate !== (repair.startDate || '')) payload.startDate = editStartDate || null;
      if (Object.keys(payload).length > 1) {
        const res = await postUpdateRepairNotes(payload as any, clientSheetId);
        if (!res.ok || !res.data?.success) {
          setEditError(res.error || 'Save failed');
          setEditSaving(false);
          return;
        }
      }
      setIsEditing(false);
      onRepairUpdated?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    }
    setEditSaving(false);
  };

  // ─── Save Repair Notes (available on Approved / pre-Start) ─────────────────
  const handleSaveNotes = async () => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;
    if (demoMode) {
      setSavedRepairNotes(repairNotes);
      setNotesSavedAt(Date.now());
      return;
    }
    setSavingNotes(true);
    try {
      const resp = await postUpdateRepairNotes(
        { repairId: repair.repairId, repairNotes },
        clientSheetId
      );
      if (!resp.ok || !resp.data?.success) {
        setSubmitError(resp.error || resp.data?.error || 'Failed to save notes. Please try again.');
      } else {
        setSavedRepairNotes(repairNotes);
        setNotesSavedAt(Date.now());
        onRepairUpdated?.();
        // Clear "Saved" indicator after a few seconds
        setTimeout(() => setNotesSavedAt(n => (n && Date.now() - n >= 2500) ? null : n), 3000);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSavingNotes(false);
    }
  };

  // ─── Send Quote ────────────────────────────────────────────────────────────
  const handleSendQuote = async () => {
    setSubmitError(null);

    // ─── Validate the multi-line quote ──────────────────────────────────────
    // Backend accepts either shape, but we always send the multi-line form
    // from this UI. Client-side checks mirror server validation so the user
    // sees errors inline instead of a round-trip 400.
    if (quoteLines.length === 0) {
      setSubmitError('Add at least one line to the quote.');
      return;
    }
    const cleanLines: SendRepairQuoteLine[] = [];
    for (const l of quoteLines) {
      const code = l.svcCode.trim();
      if (!code) { setSubmitError('Every line needs a service code.'); return; }
      const q = Number(l.qty);
      const r = Number(l.rate);
      if (isNaN(q) || q <= 0) { setSubmitError(`Line "${code}" — qty must be greater than 0.`); return; }
      if (isNaN(r) || r < 0)  { setSubmitError(`Line "${code}" — rate must be 0 or greater.`); return; }
      cleanLines.push({ svcCode: code, svcName: l.svcName || code, qty: q, rate: r, taxable: l.taxable });
    }
    if (totals.subtotal <= 0) {
      setSubmitError('Quote subtotal is $0 — set rates / qty before sending.');
      return;
    }
    const taxArea = taxAreas.find(a => a.id === taxAreaId);
    if (!taxArea && totals.taxable > 0) {
      setSubmitError('Pick a tax area for the taxable lines.');
      return;
    }

    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      setEffectiveStatus('Quote Sent');
      setSubmitResult({
        success: true, repairId: repair.repairId,
        quoteAmount: totals.subtotal,
        quoteSubtotal: totals.subtotal,
        quoteTaxAmount: totals.taxAmount,
        quoteGrandTotal: totals.grand,
        quoteLineCount: cleanLines.length,
        emailSent: false, warnings: ['Demo mode — no API configured'],
      });
      return;
    }

    applyRepairPatch?.(repair.repairId, {
      status: 'Quote Sent',
      quoteAmount: totals.subtotal,
      quoteLines: cleanLines,
      quoteSubtotal: totals.subtotal,
      quoteTaxableSubtotal: totals.taxable,
      quoteTaxAreaId: taxArea?.id || '',
      quoteTaxAreaName: taxArea?.name || '',
      quoteTaxRate: totals.taxRate,
      quoteTaxAmount: totals.taxAmount,
      quoteGrandTotal: totals.grand,
    });
    setSubmitting(true);
    try {
      const resp = await postSendRepairQuote(
        {
          repairId:    repair.repairId,
          quoteLines:  cleanLines,
          taxAreaId:   taxArea?.id || '',
          taxAreaName: taxArea?.name || '',
          taxRate:     totals.taxRate,
        },
        clientSheetId
      );
      if (!resp.ok || !resp.data?.success) {
        clearRepairPatch?.(repair.repairId);
        const errMsg = resp.error || resp.data?.error || 'Failed to send repair quote. Please try again.';
        setSubmitError(errMsg);
        void writeSyncFailed({
          tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId,
          action_type: 'send_repair_quote', requested_by: user?.email ?? '',
          request_id: resp.requestId,
          payload: {
            repairId: repair.repairId, clientName: repair.clientName, description: repair.description,
            grandTotal: totals.grand, lineCount: cleanLines.length,
          },
          error_message: errMsg,
        });
      } else {
        setEffectiveStatus('Quote Sent');
        setSubmitResult(resp.data);
        onRepairUpdated?.();
      }
    } catch (err) {
      clearRepairPatch?.(repair.repairId);
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Void Quote ──────────────────────────────────────────────────────────
  // Per spec answer #5, lines are locked once Approved. Admin must Void
  // the quote first to make any changes — that resets the row to Pending
  // Quote and clears all the persisted quote columns so the builder can
  // start fresh.
  const handleVoidQuote = async () => {
    setSubmitError(null);
    if (typeof window !== 'undefined' && !window.confirm(
      'Void this quote? The customer will need a new quote. This cannot be undone.'
    )) return;

    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;
    if (demoMode) {
      setEffectiveStatus('Pending Quote');
      return;
    }

    setSubmitting(true);
    try {
      const resp = await postVoidRepairQuote({ repairId: repair.repairId }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        setSubmitError(resp.error || resp.data?.error || 'Failed to void quote.');
      } else {
        // Reset local state so the builder is empty and ready.
        setEffectiveStatus('Pending Quote');
        setQuoteLines([{ svcCode: 'REPAIR', svcName: 'Repair', qty: '1', rate: '', taxable: true }]);
        setSubmitResult(null);
        setRespondResult(null);
        applyRepairPatch?.(repair.repairId, {
          status: 'Pending Quote',
          quoteAmount: undefined, quoteLines: undefined,
          quoteSubtotal: undefined, quoteTaxableSubtotal: undefined,
          quoteTaxAreaId: undefined, quoteTaxAreaName: undefined,
          quoteTaxRate: undefined, quoteTaxAmount: undefined,
          quoteGrandTotal: undefined,
        });
        onRepairUpdated?.();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error voiding quote.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Approve / Decline Quote ──────────────────────────────────────────────
  const handleRespond = async (decision: 'Approve' | 'Decline') => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      setEffectiveStatus(decision === 'Approve' ? 'Approved' : 'Declined');
      setRespondResult({ success: true, repairId: repair.repairId, decision, emailSent: false, warnings: ['Demo mode — no API configured'] });
      return;
    }

    // Phase 2C: patch table row immediately
    applyRepairPatch?.(repair.repairId, { status: decision === 'Approve' ? 'Approved' : 'Declined' });
    setSubmitting(true);
    try {
      const resp = await postRespondToRepairQuote({ repairId: repair.repairId, decision }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        clearRepairPatch?.(repair.repairId); // rollback
        const errMsg = resp.error || resp.data?.error || `Failed to ${decision.toLowerCase()} repair. Please try again.`;
        setSubmitError(errMsg);
        void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'respond_repair_quote', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, decision, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
      } else {
        setEffectiveStatus(decision === 'Approve' ? 'Approved' : 'Declined');
        // Don't clear patch on success — let TTL handle it (prevents flicker while refetch loads)
        setRespondResult(resp.data);
        onRepairUpdated?.();
      }
    } catch (err) {
      clearRepairPatch?.(repair.repairId); // rollback
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Start Repair ────────────────────────────────────────────────────────
  // Session 74 optimistic-first rewrite: the Start button now hides the
  // moment it's clicked. The user no longer waits 30–60 s while GAS
  // renders the Work Order PDF — UI flips instantly, GAS runs in the
  // background. On failure we surface a retry banner but KEEP the
  // started state (the sheet row has usually been written even when
  // the downstream PDF step fails, and Realtime will reconcile if not).
  const handleStartRepair = async () => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      setEffectiveStatus('In Progress');
      setStartResult({ success: true, repairId: repair.repairId, startDate: new Date().toISOString().split('T')[0], warnings: ['Demo mode — no API configured'] });
      return;
    }

    // 1. OPTIMISTIC UI — flip panel + table row + cross-page hooks now.
    //    No setSubmitting(true): we don't want the full-panel
    //    ProcessingOverlay to cover the Work Order banner that's about
    //    to appear.
    setEffectiveStatus('In Progress');
    setStartResult({
      success: true,
      repairId: repair.repairId,
      startDate: new Date().toISOString().split('T')[0],
    });
    applyRepairPatch?.(repair.repairId, { status: 'In Progress' });
    entityEvents.emit('repair', repair.repairId);

    // 2. Fire GAS in background. We intentionally don't await here so
    //    the user can continue working; errors land in the retry
    //    banner without touching the optimistic success state.
    void (async () => {
      try {
        const resp = await postStartRepair({ repairId: repair.repairId }, clientSheetId);
        if (!resp.ok || !resp.data?.success) {
          const errMsg = resp.error || resp.data?.error || 'Work order generation failed.';
          setSubmitError(errMsg + ' You can retry from the Regenerate Work Order button.');
          void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'start_repair', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
        } else {
          // Refresh server-shaped data (URL, skipped flag, etc.) into the banner.
          setStartResult(resp.data);
          onRepairUpdated?.();
        }
      } catch (err) {
        setSubmitError(
          (err instanceof Error ? err.message : 'Network error')
          + ' while generating work order — you can retry from the Regenerate Work Order button.'
        );
      }
    })();
  };

  // ─── Complete Repair ──────────────────────────────────────────────────────
  // Session 74: same optimistic-first pattern as handleStartRepair —
  // flip to 'Complete' immediately, fire GAS in the background, keep
  // the optimistic state if GAS errors (surface a retry banner).
  const handleComplete = async (resultValue: 'Pass' | 'Fail') => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      setEffectiveStatus('Complete');
      setCompleted(true);
      setCompleteResult({ success: true, repairId: repair.repairId, resultValue, billingCreated: false, warnings: ['Demo mode — no API configured'] });
      return;
    }

    // 1. OPTIMISTIC UI
    setEffectiveStatus('Complete');
    setCompleted(true);
    setCompleteResult({
      success: true,
      repairId: repair.repairId,
      resultValue,
      billingCreated: false,
    });
    applyRepairPatch?.(repair.repairId, { status: 'Complete', completedDate: new Date().toISOString().slice(0, 10) });
    entityEvents.emit('repair', repair.repairId);

    // 2. Background GAS
    void (async () => {
      try {
        const resp = await postCompleteRepair(
          { repairId: repair.repairId, resultValue, repairNotes: repairNotes || undefined },
          clientSheetId
        );
        if (!resp.ok || !resp.data?.success) {
          const errMsg = resp.error || resp.data?.error || 'Completion recorded locally but the server call failed.';
          setSubmitError(errMsg + ' Refresh to reconcile, or retry.');
          void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'complete_repair', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, resultValue, repairNotes: repairNotes || undefined, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
        } else {
          setCompleteResult(resp.data);
          onRepairUpdated?.();
        }
      } catch (err) {
        setSubmitError(
          (err instanceof Error ? err.message : 'Network error')
          + ' while completing repair. Refresh to reconcile.'
        );
      }
    })();
  };

  const handleResult = (_result: 'pass' | 'fail') => {
    if (_result === 'fail') {
      setShowResultPrompt('fail');
    } else {
      handleComplete('Pass');
    }
  };

  const handleFailChoice = async (choice: 'complete' | 'cancel') => {
    setShowResultPrompt(null);
    if (choice === 'complete') {
      await handleComplete('Fail');
    } else {
      // "Cancel (No Bill)" — local state only, no billing written
      setEffectiveStatus('Cancelled');
      setCompleted(true);
      setCompleteResult({ success: true, repairId: repair.repairId, resultValue: 'Fail', billingCreated: false, warnings: ['Cancelled — no billing created'] });
    }
  };

  // ─── Tab renderers (modular) ────────────────────────────────────────
  const renderDetailsTab = () => (
    <div style={{ padding: 20 }}>

          {/* Item Info — uses repair's own fields from API */}
          {repair.itemId && (
            <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><Package size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Item</span></div>
              <div style={{ fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <DeepLink kind="inventory" id={repair.itemId} clientSheetId={repair.clientSheetId} />
                <ItemIdBadges
                  itemId={repair.itemId}
                  inspOpenItems={inspOpenItems}
                  inspDoneItems={inspDoneItems}
                  asmOpenItems={asmOpenItems}
                  asmDoneItems={asmDoneItems}
                  repairOpenItems={repairOpenItems}
                  repairDoneItems={repairDoneItems}
                  wcOpenItems={wcOpenItems}
                  wcDoneItems={wcDoneItems}
                />
                {repair.vendor ? <span>{` — ${repair.vendor}`}</span> : null}
                {/* Session 74: prominent warehouse-location pill next to the Item ID.
                    Warehouse staff use this to physically locate the item before
                    starting the repair; was previously rendered as a muted 11px
                    string well below the header. Blue pill gets the eye. */}
                {repair.location && (
                  <span
                    title="Warehouse location"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 999,
                      background: '#EFF6FF', color: '#1D4ED8',
                      border: '1px solid #BFDBFE',
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                    }}
                  >
                    <MapPin size={11} /> {repair.location}
                  </span>
                )}
              </div>
              {/* Item fields — canonical order: Qty · Vendor · Description · Location · Sidemark · Reference. */}
              <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11, color: theme.colors.textMuted, flexWrap: 'wrap' }}>
                {(repair as { qty?: number }).qty != null && <span><strong style={{ color: theme.colors.text, fontWeight: 600 }}>Qty:</strong> {(repair as { qty?: number }).qty}</span>}
                {repair.vendor && <span><strong style={{ color: theme.colors.text, fontWeight: 600 }}>Vendor:</strong> {repair.vendor}</span>}
              </div>
              {repair.description && <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 }}>{repair.description}</div>}
              <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11, color: theme.colors.textMuted, flexWrap: 'wrap' }}>
                {repair.location && <span><strong style={{ color: theme.colors.text, fontWeight: 600 }}>Location:</strong> {repair.location}</span>}
                {repair.sidemark && <span><strong style={{ color: theme.colors.text, fontWeight: 600 }}>Sidemark:</strong> {repair.sidemark}</span>}
                {(repair as { reference?: string }).reference && <span><strong style={{ color: theme.colors.text, fontWeight: 600 }}>Reference:</strong> {(repair as { reference?: string }).reference}</span>}
                {repair.room && <span><strong style={{ color: theme.colors.text, fontWeight: 600 }}>Room:</strong> {repair.room}</span>}
              </div>
              {/* Drive Folder Buttons — each one only renders when a real
                  Drive URL exists. Prior behaviour (grey disabled chip with
                  a tooltip) was noisy for legacy rows that will never have a
                  folder (pre-Drive entities, Supabase-only media flow). */}
              {!renderAsPage && (repair.repairFolderUrl || repair.taskFolderUrl || repair.shipmentFolderUrl) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {repair.repairFolderUrl && (
                    <FolderButton label="Repair Folder" url={repair.repairFolderUrl} icon={Wrench} />
                  )}
                  {repair.taskFolderUrl && (
                    <FolderButton label="Task Folder" url={repair.taskFolderUrl} icon={ClipboardList} />
                  )}
                  {repair.shipmentFolderUrl && (
                    <FolderButton label="Shipment Folder" url={repair.shipmentFolderUrl} icon={Truck} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Inspector Notes (from source task) */}
          {repair.sourceTaskId && (
            <div style={{ background: '#FFFBF5', border: '1px solid #FED7AA', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><ClipboardList size={14} color="#B45309" /><span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>Source Task: <DeepLink kind="task" id={repair.sourceTaskId} size="sm" style={{ color: '#B45309' }} /></span></div>
              <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{repair.taskNotes || 'No inspection notes available'}</div>
            </div>
          )}

          {/* Repair Details */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Repair Details</span>
            {isActive && !isEditing && (
              <button onClick={() => setIsEditing(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, color: theme.colors.orange, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>
          {isEditing ? (
            <div style={{ background: '#FAFAFA', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Repair Tech</div>
                  <input value={editRepairVendor} onChange={e => setEditRepairVendor(e.target.value)} placeholder="Assign tech..." style={input} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Scheduled Date</div>
                  <input type="date" value={editScheduledDate?.slice(0, 10) || ''} onChange={e => setEditScheduledDate(e.target.value)} style={input} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Start Date</div>
                  <input type="date" value={editStartDate?.slice(0, 10) || ''} onChange={e => setEditStartDate(e.target.value)} style={input} />
                </div>
              </div>
              {editError && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 8 }}>{editError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button onClick={() => { setIsEditing(false); setEditError(null); setEditRepairVendor(repair.repairVendor || ''); setEditScheduledDate(repair.scheduledDate || ''); setEditStartDate(repair.startDate || ''); }} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={handleEditSave} disabled={editSaving} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 8, border: 'none', background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: editSaving ? 0.6 : 1 }}>{editSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginBottom: 16 }}>
              <Field label="Repair Tech" value={repair.repairVendor} />
              <Field label="Created By" value={repair.createdBy} />
              <Field label="Created" value={fmtDate(repair.createdDate)} />
              <Field label="Scheduled Date" value={fmtDate(repair.scheduledDate)} />
              <Field label="Start Date" value={fmtDate(repair.startDate)} />
              {user?.role === 'admin' && <Field label="Quote Amount" value={repair.quoteAmount != null ? `$${repair.quoteAmount}` : null} />}
              {user?.role === 'admin' && <Field label="Approved Amount" value={repair.finalAmount != null ? `$${repair.finalAmount}` : null} />}
              <Field label="Quote Sent" value={fmtDate(repair.quoteSentDate)} />
              <Field label="Completed" value={fmtDate(repair.completedDate)} />
            </div>
          )}
          <Field label="Description" value={repair.description} />

          {/* Repair Notes (editable) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><Wrench size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Repair Notes</span></div>
            {isActive && !completed ? (
              <>
                <textarea value={repairNotes} onChange={e => setRepairNotes(e.target.value)} rows={3} placeholder="Notes about the repair job or outcome…" style={{ ...input, resize: 'vertical' }} />
                {/* v38.61.1 — inline Save button for pre-Start notes. Completing
                    the repair also persists notes via completeRepair, so we only
                    surface this when there are unsaved edits. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 20 }}>
                  {notesSavedAt && !notesDirty && (
                    <span style={{ fontSize: 11, color: '#15803D', fontWeight: 600 }}>✓ Saved</span>
                  )}
                  <button
                    onClick={handleSaveNotes}
                    disabled={!notesDirty || savingNotes}
                    style={{
                      padding: '5px 12px', fontSize: 11, fontWeight: 600,
                      border: `1px solid ${notesDirty && !savingNotes ? theme.colors.orange : theme.colors.border}`,
                      borderRadius: 6,
                      background: notesDirty && !savingNotes ? theme.colors.orange : '#fff',
                      color: notesDirty && !savingNotes ? '#fff' : theme.colors.textMuted,
                      cursor: notesDirty && !savingNotes ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    {savingNotes && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />}
                    {savingNotes ? 'Saving…' : 'Save Notes'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: repairNotes ? theme.colors.text : theme.colors.textMuted, lineHeight: 1.5 }}>{repairNotes || 'No notes'}</div>
            )}
          </div>

        {/* Photos + Notes now live in dedicated tabs via builtInTabs below. */}
    </div>
  );

  // Header actions — only Close (edit flow uses inline status-pill CTA).
  const headerActions = (
    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(255,255,255,0.7)' }}>
      <X size={18} />
    </button>
  );

  // Below-ID status row
  const belowIdContent = (
    <div style={{ display: 'flex', gap: 6 }}>
      <Badge t={effectiveStatus} bg={sc.bg} color={sc.color} />
      {repair.quoteAmount != null && <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text, padding: '2px 10px', background: theme.colors.bgSubtle, borderRadius: 10 }}>${repair.quoteAmount}</span>}
    </div>
  );

  // Status strip — start-result + error banners that need to persist
  // above the scrollable body.
  const statusStrip = (startResult?.success || submitError) ? (
    <>
      {startResult?.success && (
        <div style={{ padding: '10px 20px', background: '#F5F3FF', borderBottom: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Play size={16} color="#7C3AED" />
            <span style={{ fontSize: 13, color: '#7C3AED', fontWeight: 600 }}>
              {startResult.skipped
                ? 'Work Order folder ready'
                : (effectiveStatus === 'Complete' || effectiveStatus === 'In Progress'
                    ? 'Work Order PDF regenerated in Repair Folder'
                    : 'Repair started — Work Order PDF created in Repair Folder')}
            </span>
          </div>
          <button onClick={() => setStartResult(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#7C3AED', fontSize: 11, padding: 0, fontWeight: 600 }}>Dismiss</button>
        </div>
      )}
      {submitError && (
        <div style={{ padding: '10px 20px', background: '#FEF2F2', borderBottom: '1px solid #FECACA', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} color="#DC2626" />
            <span style={{ fontSize: 13, color: '#DC2626', fontWeight: 600 }}>{submitError}</span>
          </div>
          <button onClick={() => setSubmitError(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 11, padding: 0, fontWeight: 600 }}>Dismiss</button>
        </div>
      )}
    </>
  ) : undefined;

  // Footer — state-keyed CTAs. Each lifecycle state (Quote Sent, Approved,
  // In Progress, Completed) renders its own action row. EntityHistory
  // moved to the Activity tab via builtInTabs.
  const footer = (
    <>
      {/* Approve / Decline footer (Quote Sent) */}
        {isActive && !completed && effectiveStatus === 'Quote Sent' && !respondResult && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <WriteButton
                label={submitting ? 'Saving...' : 'Approve'}
                variant="primary"
                icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
                style={{ flex: 1, background: '#15803D', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
                disabled={submitting}
                onClick={() => handleRespond('Approve')}
              />
              <WriteButton
                label={submitting ? '...' : 'Decline'}
                variant="danger"
                icon={<XCircle size={16} />}
                style={{ flex: 1, padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
                disabled={submitting}
                onClick={() => handleRespond('Decline')}
              />
            </div>
          </div>
        )}

        {/* Success card after Approve / Decline */}
        {respondResult && respondResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: respondResult.decision === 'Approve' ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${respondResult.decision === 'Approve' ? '#86EFAC' : '#FECACA'}`, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {respondResult.decision === 'Approve'
                  ? <CheckCircle2 size={16} color="#15803D" />
                  : <XCircle size={16} color="#DC2626" />}
                <span style={{ fontSize: 13, fontWeight: 600, color: respondResult.decision === 'Approve' ? '#15803D' : '#DC2626' }}>
                  {respondResult.skipped ? 'Already ' + respondResult.decision + 'd' : 'Repair ' + respondResult.decision + 'd'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: respondResult.decision === 'Approve' ? '#166534' : '#991B1B' }}>
                Email: {respondResult.emailSent ? '✓ Sent to staff' : '✗ Not sent'}
              </div>
              {respondResult.warnings && respondResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {respondResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Start Repair / Regenerate Work Order — available on Approved, In Progress, Complete.
            Keep the button visible after success so the user can re-run regenerate as many
            times as they want without having to dismiss the confirmation first.
            Stage A: hidden for client role — clients don't start repairs or regenerate
            work orders; that's a staff action. */}
        {(user?.role === 'admin' || user?.role === 'staff') &&
         (effectiveStatus === 'Approved' || effectiveStatus === 'In Progress' || effectiveStatus === 'Complete') && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            <WriteButton
              label={submitting
                ? (effectiveStatus === 'Approved' ? 'Starting...' : 'Regenerating...')
                : (effectiveStatus === 'Approved' ? 'Start Repair' : 'Regenerate Work Order')}
              variant="primary"
              icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={16} />}
              style={{ width: '100%', background: '#7C3AED', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
              disabled={submitting}
              onClick={handleStartRepair}
            />
          </div>
        )}

        {/* Success card after Start Repair */}
        {startResult && startResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Play size={16} color="#7C3AED" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#7C3AED' }}>
                  {startResult.skipped ? 'Repair already in progress' : 'Repair started'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#5B21B6' }}>
                Start Date: {startResult.startDate || 'Today'}
              </div>
              {startResult.warnings && startResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {startResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Repair complete / failed footer (In Progress only) */}
        {isActive && !completed && effectiveStatus === 'In Progress' && !completeResult && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            {showResultPrompt === 'fail' ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><AlertTriangle size={16} color="#B45309" /><span style={{ fontSize: 13, fontWeight: 600 }}>Repair failed — what would you like to do?</span></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <WriteButton label={submitting ? 'Saving...' : 'Complete (Bill)'} variant="primary"
                    icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : undefined}
                    style={{ flex: 1, background: '#B45309', padding: '10px', fontSize: 12, opacity: submitting ? 0.7 : 1 }}
                    disabled={submitting}
                    onClick={async () => handleFailChoice('complete')} />
                  <WriteButton label="Cancel (No Bill)" variant="secondary" style={{ flex: 1, padding: '10px', fontSize: 12, opacity: submitting ? 0.7 : 1 }} disabled={submitting} onClick={async () => handleFailChoice('cancel')} />
                </div>
                <button onClick={() => setShowResultPrompt(null)} style={{ width: '100%', marginTop: 6, padding: '6px', fontSize: 11, border: 'none', background: 'transparent', color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}>Go back</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <WriteButton label={submitting ? 'Saving...' : 'Repair Complete'} variant="primary"
                  icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
                  style={{ flex: 1, background: '#15803D', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
                  disabled={submitting}
                  onClick={async () => handleResult('pass')} />
                <WriteButton label="Failed" variant="danger" icon={<XCircle size={16} />}
                  style={{ flex: 1, padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
                  disabled={submitting}
                  onClick={async () => handleResult('fail')} />
              </div>
            )}
          </div>
        )}

        {/* Success card after Repair Complete / Failed */}
        {/* Stage B — Reopen + Correct Result widgets (admin/staff only) */}
        {canStaffEdit && (effectiveStatus === 'Completed' || effectiveStatus === 'Complete' || effectiveStatus === 'In Progress') && (
          <div style={{ padding: '10px 20px 14px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {reopenError && (
              <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 6, padding: '4px 8px', background: '#FEF2F2', borderRadius: 6 }}>{reopenError}</div>
            )}
            {(effectiveStatus === 'Completed' || effectiveStatus === 'Complete') && (
              !showCorrectRepairResult ? (
                <div style={{ textAlign: 'center', marginBottom: 6 }}>
                  <button
                    onClick={() => setShowCorrectRepairResult(true)}
                    style={{ fontSize: 11, color: theme.colors.textMuted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: '2px 0', fontFamily: 'inherit' }}
                  >
                    Correct result...
                  </button>
                </div>
              ) : (
                <div style={{ marginBottom: 8, paddingTop: 6 }}>
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 6 }}>Change repair result:</div>
                  {correctRepairResultError && (
                    <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 6, padding: '4px 8px', background: '#FEF2F2', borderRadius: 6 }}>{correctRepairResultError}</div>
                  )}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      onClick={() => { if (!correctRepairResultLoading && currentRepairResultForWidget !== 'Pass') handleCorrectRepairResultClick('Pass'); }}
                      disabled={correctRepairResultLoading || currentRepairResultForWidget === 'Pass'}
                      style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', background: currentRepairResultForWidget === 'Pass' ? '#D1FAE5' : '#16A34A', color: currentRepairResultForWidget === 'Pass' ? '#6B7280' : '#fff', cursor: correctRepairResultLoading || currentRepairResultForWidget === 'Pass' ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: currentRepairResultForWidget === 'Pass' ? 0.55 : 1 }}
                    >
                      {correctRepairResultLoading && currentRepairResultForWidget !== 'Pass' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> : '✓'} Pass
                    </button>
                    <button
                      onClick={() => { if (!correctRepairResultLoading && currentRepairResultForWidget !== 'Fail') handleCorrectRepairResultClick('Fail'); }}
                      disabled={correctRepairResultLoading || currentRepairResultForWidget === 'Fail'}
                      style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '2px solid #DC2626', background: currentRepairResultForWidget === 'Fail' ? '#FEF2F2' : 'transparent', color: currentRepairResultForWidget === 'Fail' ? '#6B7280' : '#DC2626', cursor: correctRepairResultLoading || currentRepairResultForWidget === 'Fail' ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: currentRepairResultForWidget === 'Fail' ? 0.55 : 1 }}
                    >
                      {correctRepairResultLoading && currentRepairResultForWidget !== 'Fail' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> : '✕'} Fail
                    </button>
                    <button
                      onClick={() => { setShowCorrectRepairResult(false); setCorrectRepairResultError(null); }}
                      style={{ padding: '7px 10px', fontSize: 12, background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}
                    >Cancel</button>
                  </div>
                </div>
              )
            )}
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={handleReopenRepairClick}
                disabled={reopenLoading}
                style={{ fontSize: 11, color: '#DC2626', background: 'none', border: 'none', cursor: reopenLoading ? 'wait' : 'pointer', textDecoration: 'underline', padding: '2px 0', fontFamily: 'inherit' }}
              >
                {reopenLoading ? 'Reopening…' : (effectiveStatus === 'In Progress' ? 'Reopen repair (undo Start)...' : 'Reopen repair (undo Complete)...')}
              </button>
            </div>
          </div>
        )}

        {completeResult && completeResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: completeResult.resultValue === 'Pass' ? '#F0FDF4' : '#FEF3C7', border: `1px solid ${completeResult.resultValue === 'Pass' ? '#86EFAC' : '#FDE68A'}`, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <CheckCircle2 size={16} color={completeResult.resultValue === 'Pass' ? '#15803D' : '#B45309'} />
                <span style={{ fontSize: 13, fontWeight: 600, color: completeResult.resultValue === 'Pass' ? '#15803D' : '#B45309' }}>
                  {completeResult.skipped ? 'Already complete' : `Repair complete — ${completeResult.resultValue}`}
                </span>
              </div>
              <div style={{ fontSize: 12, color: completeResult.resultValue === 'Pass' ? '#166534' : '#92400E', lineHeight: 1.5 }}>
                <div>Billing: {completeResult.billingCreated ? `✓ Created${typeof completeResult.billingAmount === 'number' ? ' ($' + completeResult.billingAmount.toFixed(2) + ')' : ''}` : '✗ Not created'}</div>
                {completeResult.emailSent !== undefined && (
                  <div>Email: {completeResult.emailSent ? '✓ Sent to client' : '✗ Not sent'}</div>
                )}
              </div>
              {completeResult.warnings && completeResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {completeResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Send Quote footer (Pending Quote) */}
        {isActive && !completed && effectiveStatus === 'Pending Quote' && !submitResult && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {/* Error banner */}
            {submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            <RepairQuoteBuilder
              lines={quoteLines}
              taxAreaId={taxAreaId}
              taxAreas={taxAreas}
              catalog={serviceCatalog}
              totals={totals}
              disabled={submitting}
              onAddLine={addLineFromCatalog}
              onChangeService={changeLineService}
              onUpdateField={updateLineField}
              onRemoveLine={removeLine}
              onTaxAreaChange={setTaxAreaId}
            />
            <WriteButton
              label={submitting ? 'Sending...' : 'Send Quote to Client'}
              variant="primary"
              icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
              style={{ width: '100%', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1, marginTop: 12 }}
              disabled={submitting}
              onClick={handleSendQuote}
            />
          </div>
        )}

        {/* Quote Sent / Approved — read-only breakdown + Void escape hatch.
            Per spec, lines are locked at Approved; admin must Void to edit.
            Void available on Quote Sent too so admin can pull back a
            mis-built quote before the customer responds. Hidden once a
            repair starts (status=In Progress) — by then billing context
            is in flight and editing the quote shouldn't happen here. */}
        {isActive && (effectiveStatus === 'Quote Sent' || effectiveStatus === 'Approved')
          && Array.isArray(repair.quoteLines) && repair.quoteLines.length > 0 && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <RepairQuoteSummary
              lines={repair.quoteLines}
              subtotal={repair.quoteSubtotal ?? 0}
              taxAreaName={repair.quoteTaxAreaName ?? ''}
              taxRate={repair.quoteTaxRate ?? 0}
              taxAmount={repair.quoteTaxAmount ?? 0}
              grandTotal={repair.quoteGrandTotal ?? 0}
            />
            {canStaffEdit && (
              <button
                onClick={handleVoidQuote}
                disabled={submitting}
                style={{
                  marginTop: 10, width: '100%',
                  padding: '8px 12px', fontSize: 12, fontWeight: 600,
                  background: '#FFFFFF', color: '#B91C1C',
                  border: '1px solid #FCA5A5', borderRadius: 8,
                  cursor: submitting ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: submitting ? 0.6 : 1,
                }}
                title="Reset to Pending Quote so you can rebuild the line items"
              >
                <Undo2 size={13} /> Void Quote (re-issue)
              </button>
            )}
          </div>
        )}

        {/* Success card after sending quote */}
        {submitResult && submitResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <CheckCircle2 size={16} color="#15803D" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#15803D' }}>
                  {submitResult.skipped ? 'Quote already sent' : 'Quote sent successfully'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.5 }}>
                {/* v38.120.0 — show subtotal + tax + grand total when the
                    backend returned the multi-line totals; fall back to
                    a single Amount line for legacy single-amount quotes. */}
                {typeof submitResult.quoteSubtotal === 'number' ? (
                  <>
                    {typeof submitResult.quoteLineCount === 'number' && (
                      <div>Lines: <strong>{submitResult.quoteLineCount}</strong></div>
                    )}
                    <div>Subtotal: <strong>${submitResult.quoteSubtotal.toFixed(2)}</strong></div>
                    {typeof submitResult.quoteTaxAmount === 'number' && submitResult.quoteTaxAmount > 0 && (
                      <div>Tax: <strong>${submitResult.quoteTaxAmount.toFixed(2)}</strong></div>
                    )}
                    {typeof submitResult.quoteGrandTotal === 'number' && (
                      <div>Customer total (incl. tax): <strong>${submitResult.quoteGrandTotal.toFixed(2)}</strong></div>
                    )}
                  </>
                ) : (
                  <div>Amount: <strong>${typeof submitResult.quoteAmount === 'number' ? submitResult.quoteAmount.toFixed(2) : submitResult.quoteAmount}</strong></div>
                )}
                <div>Email: {submitResult.emailSent ? '✓ Sent to client' : '✗ Not sent (check settings)'}</div>
              </div>
              {submitResult.warnings && submitResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {submitResult.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Cancel Repair — available for all active statuses */}
        {isActive && !completed && effectiveStatus !== 'Cancelled' && (
          <div style={{ padding: '0 20px 8px', flexShrink: 0 }}>
            <button
              onClick={async () => {
                if (!confirm('Cancel this repair? Status will be set to Cancelled.')) return;
                const cid = repair.clientSheetId || '';
                if (!isApiConfigured() || !cid) return;
                // Phase 2C: patch table row immediately
                applyRepairPatch?.(repair.repairId, { status: 'Cancelled' });
                setSubmitting(true); setSubmitError(null);
                try {
                  const resp = await postCancelRepair({ repairId: repair.repairId }, cid);
                  if (resp.ok && resp.data?.success) {
                    // Don't clear patch on success — let TTL handle it (prevents flicker while refetch loads)
                    setEffectiveStatus('Cancelled'); setCompleted(true); onRepairUpdated?.();
                  } else {
                    clearRepairPatch?.(repair.repairId); // rollback
                    const errMsg = resp.data?.error || resp.error || 'Failed to cancel repair';
                    setSubmitError(errMsg);
                    void writeSyncFailed({ tenant_id: cid, entity_type: 'repair', entity_id: repair.repairId, action_type: 'cancel_repair', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
                  }
                } catch (_) {
                  clearRepairPatch?.(repair.repairId); // rollback
                  setSubmitError('Failed to cancel repair');
                }
                setSubmitting(false);
              }}
              style={{ width: '100%', padding: '7px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: 'transparent', color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#EF4444'; e.currentTarget.style.color = '#EF4444'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.border; e.currentTarget.style.color = theme.colors.textMuted; }}
            >
              Cancel Repair
            </button>
          </div>
        )}

      {(!isActive || completed) && !submitResult && (
        <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
      )}
    </>
  );

  // ─── Shell ────────────────────────────────────────────────────────────
  const tabs: TabbedDetailPanelTab[] = [
    { id: 'details', label: 'Details', keepMounted: true, render: renderDetailsTab },
  ];

  const builtInTabsCfg = {
    photos: {
      entityType: 'repair' as const,
      entityId: repair.repairId,
      tenantId: repair.clientSheetId,
      itemId: repair.itemId ? String(repair.itemId) : null,
      enableSourceFilter: !!repair.itemId,
    },
    docs: {
      contextType: 'repair' as const,
      contextId: repair.repairId,
      tenantId: repair.clientSheetId,
    },
    notes: {
      entityType: 'repair',
      entityId: repair.repairId,
      relatedEntities: [
        ...(repair.itemId ? [{ type: 'inventory', id: String(repair.itemId), label: `Item ${repair.itemId}` }] : []),
        ...(repair.sourceTaskId ? [{ type: 'task', id: String(repair.sourceTaskId), label: `Task ${repair.sourceTaskId}` }] : []),
      ],
      enableSourceFilter: !!repair.itemId,
      itemId: repair.itemId ? String(repair.itemId) : null,
    },
    activity: {
      entityType: 'repair',
      entityId: repair.repairId,
      tenantId: repair.clientSheetId,
    },
  };

  // ── Page-mode enhancements ──
  const { photos: rpPhotos } = usePhotos({
    entityType: 'repair',
    entityId: renderAsPage ? repair.repairId : null,
    tenantId: repair.clientSheetId ?? null,
    itemId: repair.itemId ? String(repair.itemId) : null,
    enabled: !!renderAsPage,
  });
  const { documents: rpDocs } = useDocuments({
    contextType: 'repair',
    contextId: renderAsPage ? repair.repairId : '',
    tenantId: repair.clientSheetId ?? null,
    enabled: !!renderAsPage,
  });
  const { notes: rpNotes } = useEntityNotes('repair', renderAsPage ? repair.repairId : '');
  const rpPhotoCount = renderAsPage ? rpPhotos.length : 0;
  const rpDocCount   = renderAsPage ? rpDocs.length   : 0;
  const rpNoteCount  = renderAsPage ? rpNotes.length  : 0;

  const repairDriveFolders: DriveFolderLink[] = [
    ...(repair.repairFolderUrl ? [{ label: `Repair ${repair.repairId}`, url: repair.repairFolderUrl }] : []),
    ...(repair.taskFolderUrl ? [{ label: repair.sourceTaskId ? `Task ${repair.sourceTaskId}` : 'Task Folder', url: repair.taskFolderUrl }] : []),
    ...(repair.shipmentFolderUrl ? [{ label: 'Shipment Folder', url: repair.shipmentFolderUrl }] : []),
  ];

  const renderRepairPhotosTab = () => (
    <div>
      <_PhotosPanel
        entityType="repair"
        entityId={repair.repairId}
        tenantId={repair.clientSheetId}
        itemId={repair.itemId ? String(repair.itemId) : null}
        enableSourceFilter={!!repair.itemId}
      />
      <DriveFoldersList folders={repairDriveFolders} />
    </div>
  );
  const renderRepairDocsTab = () => (
    <div>
      <_DocumentsPanel contextType="repair" contextId={repair.repairId} tenantId={repair.clientSheetId} />
      <DriveFoldersList folders={repairDriveFolders} />
    </div>
  );
  const renderRepairNotesTab = () => (
    <_NotesPanel
      entityType="repair"
      entityId={repair.repairId}
      relatedEntities={[
        ...(repair.itemId ? [{ type: 'inventory', id: String(repair.itemId), label: `Item ${repair.itemId}` }] : []),
        ...(repair.sourceTaskId ? [{ type: 'task', id: String(repair.sourceTaskId), label: `Task ${repair.sourceTaskId}` }] : []),
      ]}
      enableSourceFilter={!!repair.itemId}
      itemId={repair.itemId ? String(repair.itemId) : null}
      pinnedNote={{ label: 'Repair Notes', text: repair.repairNotes }}
    />
  );
  const renderRepairActivityTab = () => (
    <EntityHistory entityType="repair" entityId={repair.repairId} tenantId={repair.clientSheetId ?? undefined} />
  );

  // v38.124.0 / repair-quote follow-up — render the Quote builder /
  // summary in PAGE mode (RepairPage route). Previously the multi-line
  // builder only mounted in the slide-out panel render path; the page
  // route's pageFooter was just buttons, so the operator had no place
  // to add prices. This tab makes it work in page mode too.
  const renderRepairQuoteTab = () => {
    const sLocal = effectiveStatus;
    const isPending = isActive && !completed && sLocal === 'Pending Quote' && !submitResult;
    const isLockedWithLines = isActive && (sLocal === 'Quote Sent' || sLocal === 'Approved')
      && Array.isArray(repair.quoteLines) && repair.quoteLines.length > 0;
    const isLockedLegacy = isActive && (sLocal === 'Quote Sent' || sLocal === 'Approved')
      && !(Array.isArray(repair.quoteLines) && repair.quoteLines.length > 0);

    return (
      <div style={{ padding: 20 }}>
        {/* Submit success card */}
        {submitResult && submitResult.success && (
          <div style={{ padding: '12px 14px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <CheckCircle2 size={16} color="#15803D" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#15803D' }}>
                {submitResult.skipped ? 'Quote already sent' : 'Quote sent successfully'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.5 }}>
              {typeof submitResult.quoteSubtotal === 'number' ? (
                <>
                  {typeof submitResult.quoteLineCount === 'number' && (
                    <div>Lines: <strong>{submitResult.quoteLineCount}</strong></div>
                  )}
                  <div>Subtotal: <strong>${submitResult.quoteSubtotal.toFixed(2)}</strong></div>
                  {typeof submitResult.quoteTaxAmount === 'number' && submitResult.quoteTaxAmount > 0 && (
                    <div>Tax: <strong>${submitResult.quoteTaxAmount.toFixed(2)}</strong></div>
                  )}
                  {typeof submitResult.quoteGrandTotal === 'number' && (
                    <div>Customer total (incl. tax): <strong>${submitResult.quoteGrandTotal.toFixed(2)}</strong></div>
                  )}
                </>
              ) : (
                <div>Amount: <strong>${typeof submitResult.quoteAmount === 'number' ? submitResult.quoteAmount.toFixed(2) : submitResult.quoteAmount}</strong></div>
              )}
              <div>Email: {submitResult.emailSent ? '✓ Sent to client' : '✗ Not sent (check settings)'}</div>
            </div>
          </div>
        )}

        {/* Submit error */}
        {submitError && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{submitError}</span>
          </div>
        )}

        {/* Pending Quote → editable builder */}
        {isPending && (
          <>
            <RepairQuoteBuilder
              lines={quoteLines}
              taxAreaId={taxAreaId}
              taxAreas={taxAreas}
              catalog={serviceCatalog}
              totals={totals}
              disabled={submitting}
              onAddLine={addLineFromCatalog}
              onChangeService={changeLineService}
              onUpdateField={updateLineField}
              onRemoveLine={removeLine}
              onTaxAreaChange={setTaxAreaId}
            />
            <WriteButton
              label={submitting ? 'Sending...' : 'Send Quote to Client'}
              variant="primary"
              icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
              style={{ width: '100%', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1, marginTop: 12 }}
              disabled={submitting}
              onClick={handleSendQuote}
            />
          </>
        )}

        {/* Quote Sent / Approved + has line items → read-only summary */}
        {isLockedWithLines && (
          <>
            <RepairQuoteSummary
              lines={repair.quoteLines!}
              subtotal={repair.quoteSubtotal ?? 0}
              taxAreaName={repair.quoteTaxAreaName ?? ''}
              taxRate={repair.quoteTaxRate ?? 0}
              taxAmount={repair.quoteTaxAmount ?? 0}
              grandTotal={repair.quoteGrandTotal ?? 0}
            />
            {canStaffEdit && (
              <button
                onClick={handleVoidQuote}
                disabled={submitting}
                style={{
                  marginTop: 10, width: '100%',
                  padding: '8px 12px', fontSize: 12, fontWeight: 600,
                  background: '#FFFFFF', color: '#B91C1C',
                  border: '1px solid #FCA5A5', borderRadius: 8,
                  cursor: submitting ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: submitting ? 0.6 : 1,
                }}
                title="Reset to Pending Quote so you can rebuild the line items"
              >
                <Undo2 size={13} /> Void Quote (re-issue)
              </button>
            )}
          </>
        )}

        {/* Legacy single-amount quote — no line items captured. Show
            the old Quote Amount + a Void button so the operator can
            re-issue with the new multi-line builder. */}
        {isLockedLegacy && (
          <div style={{ background: theme.colors.bgSubtle, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              Quote ({sLocal})
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text, marginBottom: 4 }}>
              ${typeof repair.quoteAmount === 'number' ? repair.quoteAmount.toFixed(2) : '—'}
            </div>
            <div style={{ fontSize: 11, color: theme.colors.textMuted, lineHeight: 1.5, marginBottom: 12 }}>
              This quote was sent before multi-line repair quotes shipped, so there's no line-item breakdown to show. Void it to rebuild with the new builder (line items + tax + grand total).
            </div>
            {canStaffEdit && (
              <button
                onClick={handleVoidQuote}
                disabled={submitting}
                style={{
                  width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600,
                  background: '#FFFFFF', color: '#B91C1C',
                  border: '1px solid #FCA5A5', borderRadius: 8,
                  cursor: submitting ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                <Undo2 size={13} /> Void Quote (re-issue with line items)
              </button>
            )}
          </div>
        )}

        {/* Beyond Approved (In Progress / Complete / Cancelled / Declined)
            — read-only display only. */}
        {!isPending && !isLockedWithLines && !isLockedLegacy && !submitResult && (
          Array.isArray(repair.quoteLines) && repair.quoteLines.length > 0 ? (
            <RepairQuoteSummary
              lines={repair.quoteLines}
              subtotal={repair.quoteSubtotal ?? 0}
              taxAreaName={repair.quoteTaxAreaName ?? ''}
              taxRate={repair.quoteTaxRate ?? 0}
              taxAmount={repair.quoteTaxAmount ?? 0}
              grandTotal={repair.quoteGrandTotal ?? 0}
            />
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
              {sLocal === 'Cancelled' || sLocal === 'Declined'
                ? `Repair was ${sLocal}. No quote on file.`
                : typeof repair.quoteAmount === 'number' && repair.quoteAmount > 0
                  ? <>Quote: <strong style={{ color: theme.colors.text }}>${repair.quoteAmount.toFixed(2)}</strong> (legacy single-amount, no breakdown)</>
                  : 'No quote on file yet.'}
            </div>
          )
        )}
      </div>
    );
  };

  const pageTabs = [
    { id: 'details',  label: 'Details',  keepMounted: true, render: renderDetailsTab },
    // Quote tab — front-and-center for Pending Quote so the operator
    // sees the line-item builder immediately on landing. Stays useful
    // post-send too (read-only summary + Void).
    { id: 'quote',    label: 'Quote',    render: renderRepairQuoteTab },
    { id: 'photos',   label: 'Photos',   badgeCount: rpPhotoCount, render: renderRepairPhotosTab },
    { id: 'docs',     label: 'Docs',     badgeCount: rpDocCount,   render: renderRepairDocsTab },
    { id: 'notes',    label: 'Notes',    badgeCount: rpNoteCount,  render: renderRepairNotesTab },
    { id: 'activity', label: 'Activity', render: renderRepairActivityTab },
  ];

  // Page-mode footer — state-aware pill-styled buttons (reuses existing handlers).
  const pagePillBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 5, flex: '1 1 0',
    minWidth: 110,
    maxWidth: 170,
    padding: '10px 14px',
    borderRadius: 10, border: 'none',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.3px', cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const rpDark: React.CSSProperties = { ...pagePillBase, background: '#1C1C1C', color: '#fff' };
  const rpOrange: React.CSSProperties = { ...pagePillBase, background: theme.colors.orange, color: '#fff' };
  const rpLight: React.CSSProperties = { ...pagePillBase, background: '#fff', color: theme.colors.text, border: `1px solid ${theme.colors.border}` };
  const rpGreen: React.CSSProperties = { ...pagePillBase, background: '#15803D', color: '#fff' };
  const rpRed: React.CSSProperties = { ...pagePillBase, background: '#B91C1C', color: '#fff' };

  const s = effectiveStatus;
  const active = !['Complete', 'Cancelled', 'Declined'].includes(s);
  const pageFooter = (
    <>
      {/* Cancel Repair — active, not editing */}
      {active && (
        <button onClick={async () => {
          const ok = typeof window !== 'undefined' && window.confirm('Cancel this repair?');
          if (ok) {
            try {
              setSubmitting(true);
              const resp = await (await import('../../lib/api')).postCancelRepair({ repairId: repair.repairId }, repair.clientSheetId);
              if (resp.ok && resp.data?.success) { setEffectiveStatus('Cancelled'); onRepairUpdated?.(); }
            } finally { setSubmitting(false); }
          }
        }} style={rpLight}>Cancel Repair</button>
      )}
      {/* Reopen — admin/staff on Complete or In Progress */}
      {canStaffEdit && (s === 'Complete' || s === 'In Progress') && (
        <button onClick={handleReopenRepairClick} style={rpLight}>Reopen</button>
      )}
      {/* State-aware primary actions */}
      {s === 'Pending Quote' && (
        <button onClick={handleSendQuote} disabled={submitting} style={rpOrange}>
          Send Quote
        </button>
      )}
      {s === 'Quote Sent' && (
        <>
          <button onClick={() => handleRespond('Decline')} disabled={submitting} style={rpRed}>Decline</button>
          <button onClick={() => handleRespond('Approve')} disabled={submitting} style={rpGreen}>Approve</button>
        </>
      )}
      {s === 'Approved' && canStaffEdit && (
        <button onClick={handleStartRepair} disabled={submitting} style={rpOrange}>
          <Play size={13} /> Start Repair
        </button>
      )}
      {s === 'In Progress' && (
        <>
          <button onClick={async () => handleResult('fail')} disabled={submitting} style={rpRed}>Failed</button>
          <button onClick={async () => handleResult('pass')} disabled={submitting} style={rpGreen}>Complete</button>
        </>
      )}
      {/* Regenerate Work Order — In Progress / Complete */}
      {(s === 'In Progress' || s === 'Complete') && canStaffEdit && (
        <button onClick={handleStartRepair} disabled={submitting} style={rpDark}>
          Regenerate WO
        </button>
      )}
    </>
  );

  if (renderAsPage) {
    return (
      <EntityPage
        entityLabel="Repair"
        entityId={repair.repairId}
        clientName={repair.clientName}
        statusBadge={belowIdContent}
        headerActions={headerActions}
        statusStrip={statusStrip}
        tabs={pageTabs as unknown as Parameters<typeof EntityPage>[0]['tabs']}
        initialTabId={effectiveStatus === 'Pending Quote' || effectiveStatus === 'Quote Sent' || effectiveStatus === 'Approved' ? 'quote' : 'details'}
        footer={pageFooter}
      />
    );
  }

  return (
    <TabbedDetailPanel
      title={repair.repairId}
      clientName={repair.clientName}
      sidemark={repair.sidemark}
      idBadges={repair.itemId ? (
        <ItemIdBadges
          itemId={repair.itemId}
          inspOpenItems={inspOpenItems}
          inspDoneItems={inspDoneItems}
          asmOpenItems={asmOpenItems}
          asmDoneItems={asmDoneItems}
          repairOpenItems={repairOpenItems}
          repairDoneItems={repairDoneItems}
          wcOpenItems={wcOpenItems}
          wcDoneItems={wcDoneItems}
        />
      ) : undefined}
      belowId={belowIdContent}
      headerActions={headerActions}
      statusStrip={statusStrip}
      overlay={<ProcessingOverlay
        visible={submitting}
        message="Hold tight — saving your repair update"
        subMessage="Updating the repair record and any linked billing. You can leave this open."
      />}
      tabs={tabs}
      builtInTabs={builtInTabsCfg}
      footer={footer}
      onClose={onClose}
      resizeKey="repair"
      defaultWidth={460}
    />
  );
}

// ─── RepairQuoteBuilder ────────────────────────────────────────────────────
//
// Editable line-item table + tax-area dropdown + live totals. Parent
// owns all state; this component is purely presentational so the parent
// can validate + submit + reset without prop drilling.
//
// Layout: one row per line — Service (dropdown) | Qty | Rate | Tax flag
// | Amount | Trash. Below: tax area dropdown + an "+ Add line" picker
// + the totals strip (Subtotal / Tax / Grand Total). Customer total
// (incl. tax) is the bold number — that's what they see on the email.
//
// Picker is a separate dropdown so adding a line is one click — instead
// of "click + then pick the code from the new row's dropdown".
function RepairQuoteBuilder(props: {
  lines: Array<{ svcCode: string; svcName: string; qty: string; rate: string; taxable: boolean }>;
  taxAreaId: string;
  taxAreas: Array<{ id: string; name: string; rate: number }>;
  catalog: Array<{ code: string; name: string; category: string | null; taxable: boolean | null; flat_rate: number | null }>;
  totals: { subtotal: number; taxable: number; taxRate: number; taxAmount: number; grand: number; taxAreaName: string };
  disabled: boolean;
  onAddLine: (code: string) => void;
  onChangeService: (idx: number, code: string) => void;
  onUpdateField: (idx: number, field: 'svcCode' | 'svcName' | 'qty' | 'rate' | 'taxable', value: string | boolean) => void;
  onRemoveLine: (idx: number) => void;
  onTaxAreaChange: (id: string) => void;
}) {
  const { lines, taxAreaId, taxAreas, catalog, totals, disabled,
          onChangeService, onUpdateField, onRemoveLine, onAddLine, onTaxAreaChange } = props;
  const [pickerCode, setPickerCode] = useState<string>('');

  // Sort the catalog so REPAIR / REPAIRS_HR are first (they're the
  // primary repair charges) and Warehouse add-ons (PREP, RSTK, FUEL,
  // PACKAGING, etc.) follow alphabetically. Makes the dropdown scan
  // quick for the common case.
  const orderedCatalog = useMemo(() => {
    const isRepair = (c: { category: string | null }) => c.category === 'Repair';
    return [...catalog].sort((a, b) => {
      const ar = isRepair(a) ? 0 : 1;
      const br = isRepair(b) ? 0 : 1;
      if (ar !== br) return ar - br;
      return (a.name || a.code).localeCompare(b.name || b.code);
    });
  }, [catalog]);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        Quote Line Items
      </div>

      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 1.6fr) 60px 86px 56px 80px 30px',
        gap: 6,
        fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: 6, padding: '0 4px',
      }}>
        <div>Service</div>
        <div style={{ textAlign: 'right' }}>Qty</div>
        <div style={{ textAlign: 'right' }}>Rate</div>
        <div style={{ textAlign: 'center' }}>Tax</div>
        <div style={{ textAlign: 'right' }}>Amount</div>
        <div></div>
      </div>

      {/* Line rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {lines.map((l, idx) => {
          const q = Number(l.qty) || 0;
          const r = Number(l.rate) || 0;
          const amt = Math.round(q * r * 100) / 100;
          return (
            <div key={idx} style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px, 1.6fr) 60px 86px 56px 80px 30px',
              gap: 6, alignItems: 'center',
            }}>
              <select
                value={l.svcCode}
                onChange={e => onChangeService(idx, e.target.value)}
                disabled={disabled}
                style={{ ...quoteInputCell, padding: '6px 6px' }}
              >
                {!orderedCatalog.find(c => c.code === l.svcCode) && (
                  <option value={l.svcCode}>{l.svcName || l.svcCode}</option>
                )}
                {orderedCatalog.map(c => (
                  <option key={c.code} value={c.code}>{c.name || c.code}</option>
                ))}
              </select>
              <input
                type="number" min="0" step="1"
                value={l.qty}
                onChange={e => onUpdateField(idx, 'qty', e.target.value)}
                disabled={disabled}
                style={{ ...quoteInputCell, textAlign: 'right' }}
              />
              <input
                type="number" min="0" step="0.01"
                value={l.rate}
                onChange={e => onUpdateField(idx, 'rate', e.target.value)}
                disabled={disabled}
                placeholder="0.00"
                style={{ ...quoteInputCell, textAlign: 'right' }}
              />
              <div style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={l.taxable}
                  onChange={e => onUpdateField(idx, 'taxable', e.target.checked)}
                  disabled={disabled}
                  title="Apply sales tax to this line"
                  style={{ accentColor: theme.colors.orange }}
                />
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: theme.colors.text, fontWeight: 600 }}>
                ${amt.toFixed(2)}
              </div>
              <button
                onClick={() => onRemoveLine(idx)}
                disabled={disabled || lines.length <= 1}
                title={lines.length <= 1 ? 'A quote needs at least one line' : 'Remove this line'}
                style={{
                  background: 'none', border: 'none',
                  cursor: disabled || lines.length <= 1 ? 'not-allowed' : 'pointer',
                  color: lines.length <= 1 ? theme.colors.textMuted : '#B91C1C',
                  padding: 4, borderRadius: 4,
                  opacity: lines.length <= 1 ? 0.4 : 1,
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Add-line picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <select
          value={pickerCode}
          onChange={e => setPickerCode(e.target.value)}
          disabled={disabled}
          style={{ ...quoteInputCell, flex: 1, padding: '6px 8px' }}
        >
          <option value="">+ Add a line item…</option>
          {orderedCatalog.map(c => (
            <option key={c.code} value={c.code}>{c.name || c.code}{c.taxable === false ? ' (non-tax)' : ''}</option>
          ))}
        </select>
        <button
          onClick={() => {
            if (pickerCode) { onAddLine(pickerCode); setPickerCode(''); }
          }}
          disabled={disabled || !pickerCode}
          style={{
            padding: '6px 10px', fontSize: 11, fontWeight: 600,
            background: pickerCode ? theme.colors.orange : theme.colors.bgMuted,
            color: pickerCode ? '#fff' : theme.colors.textMuted,
            border: 'none', borderRadius: 6,
            cursor: disabled || !pickerCode ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {/* Tax area + totals */}
      <div style={{ marginTop: 12, padding: 10, background: theme.colors.bgSubtle, borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Tax Area
          </span>
          <select
            value={taxAreaId}
            onChange={e => onTaxAreaChange(e.target.value)}
            disabled={disabled}
            style={{ ...quoteInputCell, maxWidth: 200, padding: '4px 6px', fontSize: 12 }}
          >
            {!taxAreas.find(a => a.id === taxAreaId) && taxAreaId && (
              <option value={taxAreaId}>(unknown)</option>
            )}
            {taxAreas.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({Number(a.rate).toFixed(2)}%)</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12 }}>
          <span style={{ color: theme.colors.textSecondary }}>Subtotal</span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${totals.subtotal.toFixed(2)}</span>
          <span style={{ color: theme.colors.textSecondary }}>
            Sales tax{totals.taxAreaName ? ` (${totals.taxAreaName} · ${totals.taxRate.toFixed(2)}%)` : ''}
          </span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${totals.taxAmount.toFixed(2)}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: theme.colors.text, paddingTop: 4, borderTop: `1px solid ${theme.colors.border}`, marginTop: 4 }}>
            Customer total (incl. tax)
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: theme.colors.orange, textAlign: 'right', paddingTop: 4, borderTop: `1px solid ${theme.colors.border}`, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            ${totals.grand.toFixed(2)}
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: theme.colors.textMuted, lineHeight: 1.4 }}>
          QB applies its own sales tax on the invoice. The amount above is what the customer sees on the quote email; the QB total may differ by a few cents due to rounding.
        </div>
      </div>
    </div>
  );
}

const quoteInputCell: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  border: `1px solid ${theme.colors.border}`,
  borderRadius: 6,
  outline: 'none',
  fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
  boxSizing: 'border-box',
  background: '#fff',
};

// ─── RepairQuoteSummary ────────────────────────────────────────────────────
//
// Read-only render of the persisted quote — used on Quote Sent and
// Approved statuses, where the lines are locked. Same totals strip as
// the builder so the operator sees exactly what was sent.
function RepairQuoteSummary(props: {
  lines: Array<{ svcCode: string; svcName: string; qty: number; rate: number; taxable: boolean }>;
  subtotal: number;
  taxAreaName: string;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
}) {
  const { lines, subtotal, taxAreaName, taxRate, taxAmount, grandTotal } = props;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        Quote (sent)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 10, background: theme.colors.bgSubtle, borderRadius: 8 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12, color: theme.colors.text }}>
            <span>
              {l.svcName || l.svcCode}
              {l.qty > 1 && <span style={{ color: theme.colors.textMuted }}> × {l.qty}</span>}
              {!l.taxable && <span style={{ marginLeft: 6, fontSize: 10, color: theme.colors.textMuted }}>(non-tax)</span>}
            </span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              ${(l.qty * l.rate).toFixed(2)}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${theme.colors.border}`, display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12 }}>
          <span style={{ color: theme.colors.textSecondary }}>Subtotal</span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${subtotal.toFixed(2)}</span>
          <span style={{ color: theme.colors.textSecondary }}>
            Sales tax{taxAreaName ? ` (${taxAreaName} · ${Number(taxRate).toFixed(2)}%)` : ''}
          </span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${taxAmount.toFixed(2)}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: theme.colors.text }}>Customer total</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: theme.colors.orange, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            ${grandTotal.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
