/**
 * BillingBatchContext — App-level state for in-flight invoice creation batches.
 *
 * v38.184.0 (2026-05-04). Background invoice processing — modal closes after a
 * brief "Started!" confirmation, the user can navigate away, and the rest of the
 * batch runs in JS-runtime background. The state that drives the bottom-right
 * progress toast lives here in App-level context (not in Billing.tsx) so it
 * survives any page unmount/remount: when Billing.tsx unmounts mid-batch the
 * in-flight async functions continue running (browser doesn't kill them just
 * because their caller component left the screen) and their state-setter
 * callbacks point at this provider, which stays mounted.
 *
 * What does NOT survive: a full page refresh / browser tab close. The fetch
 * promises get cancelled. Resilience to that requires persisting the queue to
 * Supabase + a background worker — separate, bigger change.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Per-batch result row, kept after completion so the operator can review. */
export interface BatchInvoiceResult {
  client: string;
  success: boolean;
  invoiceNo?: string;
  error?: string;
}

export interface BillingBatchState {
  /** True while a batch is being processed. UI uses this to gate re-submit. */
  active: boolean;
  /** Cumulative totals — `processed = succeeded + failed + skipped`. */
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Ledger row IDs whose per-invoice POST is currently in flight. */
  invoicingLedgerIds: ReadonlySet<string>;
  /** Last completed batch's results — null while a batch is active or if no
   *  batch has been run yet. Cleared when the operator dismisses the toast. */
  lastResults: BatchInvoiceResult[] | null;
  /** When the active batch was kicked off (used to auto-dismiss stale toasts). */
  startedAt: number | null;
}

interface StartBatchInput {
  total: number;
  /** Initial set of ledger row IDs. Each invoice's IDs are unmarked from
   *  invoicingLedgerIds when its POST returns (success or failure). */
  invoicingLedgerIds: string[];
}

export interface BillingBatchContextValue extends BillingBatchState {
  /**
   * Mark a new batch as started. Called from Billing.tsx right before the
   * background processing kicks off. Resets counters; sets `active=true`.
   */
  startBatch: (input: StartBatchInput) => void;
  /** Mark one invoice complete (success or failure). Updates counters and
   *  removes its ledger row IDs from invoicingLedgerIds. */
  recordInvoice: (input: {
    ok: boolean;
    skipped?: boolean;
    ledgerRowIds: string[];
    result: BatchInvoiceResult;
  }) => void;
  /** Mark the whole batch complete. Sets active=false, stamps lastResults. */
  finishBatch: (results: BatchInvoiceResult[]) => void;
  /** Clear lastResults — called when the operator dismisses the result toast. */
  dismissResults: () => void;
}

// ─── Implementation ──────────────────────────────────────────────────────────

const initialState: BillingBatchState = {
  active: false,
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  invoicingLedgerIds: new Set(),
  lastResults: null,
  startedAt: null,
};

const BillingBatchContext = createContext<BillingBatchContextValue | null>(null);

export function BillingBatchProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BillingBatchState>(initialState);

  // Use a ref mirror so the closure inside startBatch can read the latest set
  // without re-render churn, and recordInvoice can mutate the set in place.
  const stateRef = useRef(state);
  stateRef.current = state;

  const startBatch = useCallback((input: StartBatchInput) => {
    setState({
      active: true,
      total: input.total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      invoicingLedgerIds: new Set(input.invoicingLedgerIds),
      lastResults: null,
      startedAt: Date.now(),
    });
  }, []);

  const recordInvoice = useCallback((input: {
    ok: boolean;
    skipped?: boolean;
    ledgerRowIds: string[];
    result: BatchInvoiceResult;
  }) => {
    setState(prev => {
      const nextSet = new Set(prev.invoicingLedgerIds);
      for (const id of input.ledgerRowIds) nextSet.delete(id);
      return {
        ...prev,
        processed: prev.processed + 1,
        succeeded: prev.succeeded + (input.ok ? 1 : 0),
        failed: prev.failed + (!input.ok && !input.skipped ? 1 : 0),
        skipped: prev.skipped + (input.skipped ? 1 : 0),
        invoicingLedgerIds: nextSet,
      };
    });
  }, []);

  const finishBatch = useCallback((results: BatchInvoiceResult[]) => {
    setState(prev => ({
      ...prev,
      active: false,
      // Drain the in-progress set in case any IDs slipped past recordInvoice
      // (defense in depth — if the caller's per-invoice tracking missed
      // something, the toast won't be left rendering an invalid badge).
      invoicingLedgerIds: new Set(),
      lastResults: results,
    }));
  }, []);

  const dismissResults = useCallback(() => {
    setState(prev => ({ ...prev, lastResults: null }));
  }, []);

  const value = useMemo<BillingBatchContextValue>(() => ({
    ...state,
    startBatch,
    recordInvoice,
    finishBatch,
    dismissResults,
  }), [state, startBatch, recordInvoice, finishBatch, dismissResults]);

  return (
    <BillingBatchContext.Provider value={value}>
      {children}
    </BillingBatchContext.Provider>
  );
}

export function useBillingBatch(): BillingBatchContextValue {
  const ctx = useContext(BillingBatchContext);
  if (!ctx) {
    throw new Error('useBillingBatch must be used inside <BillingBatchProvider>');
  }
  return ctx;
}
