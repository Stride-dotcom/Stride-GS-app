import { useCallback, useRef } from 'react';
import { parseScanPayload, type ParsedScanPayload, type ScanEntityType } from '@/lib/scan/parseScanPayload';
import type { ScanAckGate, ScanAckToastConfig } from '@/hooks/useScanAckGate';

export type NormalizedScanEntityType = ScanEntityType;

export interface ScanEngineEvent {
  /** Trimmed raw scan string from the scanner. */
  raw: string;
  /** Parsed payload (best-effort). */
  payload: ParsedScanPayload;
  /** Normalized type (item/location/container/unknown). */
  type: NormalizedScanEntityType;
  /** Best-effort code for display/lookups (payload.code || payload.id || raw). */
  code: string;
}

export interface UseScanEngineOptions {
  /** Disable processing scans (default: true). */
  enabled?: boolean;
  /** Maximum queued scans to buffer while processing one (default: 3). */
  maxQueueLength?: number;
  /** Ignore exact same scan value within this window (ms). Default: 0 (disabled). */
  dedupeMs?: number;

  /**
   * Optional external "busy" flag. If true and the engine isn't already processing,
   * scans are ignored (not queued). This prevents scan interleaving with non-scan work.
   */
  isExternallyBusy?: boolean;

  /**
   * Optional setter for an external busy flag (ex: page-level `processing` state).
   * If provided, the engine will set it true while draining scans, and false when idle.
   */
  setExternallyBusy?: (busy: boolean) => void;

  /**
   * Optional "blocked" predicate. If it returns true, scans are ignored.
   * Useful for modals (ex: quarantine warning) or locked screens.
   */
  isBlocked?: () => boolean;

  /**
   * Optional "ack required" gate.
   * When blocked, scans are ignored until the user dismisses the associated toast/banner.
   */
  ackGate?: ScanAckGate;

  /**
   * If provided, only these types are allowed to proceed to onScan.
   * (ex: item-only pages can disallow location/container scans.)
   */
  allowedTypes?: ReadonlyArray<NormalizedScanEntityType>;

  /**
   * If true (default), and a disallowed scan type is received, the engine will
   * auto-trigger `ackGate.block(...)` (when ackGate is provided) unless the page
   * handler already blocked.
   */
  ackOnBlockedType?: boolean;

  /** Optional toast config builder used by the auto ackOnBlockedType behavior. */
  blockedTypeToast?: (event: ScanEngineEvent) => ScanAckToastConfig;

  /**
   * Called when a scan is disallowed by `allowedTypes`.
   * If not provided, disallowed scans are silently ignored.
   */
  onBlockedType?: (event: ScanEngineEvent) => void | Promise<void>;

  /** Main scan processor (called sequentially). */
  onScan: (event: ScanEngineEvent) => void | Promise<void>;

  /** Optional error handler for unexpected processing errors. */
  onError?: (error: unknown, raw: string) => void;

  /**
   * If true (default), unexpected errors will auto-trigger `ackGate.block(...)`
   * (when ackGate is provided) unless the page handler already blocked.
   */
  ackOnError?: boolean;

  /** Optional toast config builder used by the auto ackOnError behavior. */
  errorToast?: (error: unknown, raw: string) => ScanAckToastConfig;
}

function normalizeType(type: ParsedScanPayload['type']): NormalizedScanEntityType {
  if (type === 'item' || type === 'location' || type === 'container' || type === 'unknown') return type;
  return 'unknown';
}

function toEvent(raw: string, payload: ParsedScanPayload): ScanEngineEvent {
  const type = normalizeType(payload.type);
  const code = (payload.code || payload.id || raw).trim();
  return { raw, payload, type, code };
}

function defaultBlockedTypeToast(event: ScanEngineEvent, allowed?: ReadonlyArray<NormalizedScanEntityType>): ScanAckToastConfig {
  const typeLabel =
    event.type === 'location' ? 'location' :
      event.type === 'container' ? 'container' :
        event.type;

  const expects = allowed?.length ? ` This screen expects ${allowed.join(', ')}.` : '';

  if (event.type === 'location') {
    return {
      type: 'error',
      title: 'Location scanned',
      subtitle: `"${event.code}" is a ${typeLabel}.${expects}`,
      durationMs: 0,
    };
  }
  if (event.type === 'container') {
    return {
      type: 'error',
      title: 'Container scanned',
      subtitle: `"${event.code}" is a ${typeLabel}.${expects}`,
      durationMs: 0,
    };
  }

  return {
    type: 'error',
    title: 'Invalid scan',
    subtitle: `"${event.code}" is a ${typeLabel}.${expects}`,
    durationMs: 0,
  };
}

function defaultErrorToast(_error: unknown, raw: string): ScanAckToastConfig {
  const value = (raw ?? '').trim();
  return {
    type: 'error',
    title: 'Scan error',
    subtitle: value ? `Failed to process "${value}".` : 'Failed to process scan.',
    durationMs: 0,
  };
}

/**
 * Shared scan engine:
 * - Parses scan payloads consistently (JSON / URL / raw)
 * - Dedupes camera chatter
 * - Queues rapid back-to-back scans and processes sequentially
 *
 * Page-specific behavior stays in `onScan`.
 */
export function useScanEngine(options: UseScanEngineOptions) {
  const optionsRef = useRef<UseScanEngineOptions>(options);
  // Keep latest callbacks/options without re-creating the onScan handler.
  optionsRef.current = options;

  const processingRef = useRef(false);
  const inFlightScanRef = useRef<string | null>(null);
  const queueRef = useRef<string[]>([]);
  const lastSeenRef = useRef<{ value: string; at: number } | null>(null);
  const runIdRef = useRef(0);

  const reset = useCallback(() => {
    // Invalidate any in-flight async loop.
    runIdRef.current += 1;
    processingRef.current = false;
    inFlightScanRef.current = null;
    queueRef.current = [];
    lastSeenRef.current = null;
    optionsRef.current.setExternallyBusy?.(false);
  }, []);

  const onScan = useCallback((data: string) => {
    const opts = optionsRef.current;
    if (opts.enabled === false) return;

    const raw = (data ?? '').trim();
    if (!raw) return;

    if (opts.ackGate?.isBlocked()) return;
    if (opts.isBlocked?.()) return;

    // If some other workflow is using a shared "busy" flag, ignore scans rather than interleave.
    if (opts.isExternallyBusy && !processingRef.current) return;

    const dedupeMs = opts.dedupeMs ?? 0;
    if (dedupeMs > 0) {
      const last = lastSeenRef.current;
      const now = Date.now();
      if (last && last.value === raw && now - last.at < dedupeMs) return;
      lastSeenRef.current = { value: raw, at: now };
    }

    const enqueue = (value: string) => {
      const v = value.trim();
      if (!v) return;
      if (inFlightScanRef.current && v === inFlightScanRef.current) return;

      const q = queueRef.current;
      const last = q.length > 0 ? q[q.length - 1] : null;
      if (last && v === last) return;

      const maxQueue = opts.maxQueueLength ?? 3;
      if (q.length >= maxQueue) return;
      q.push(v);
    };

    if (processingRef.current) {
      enqueue(raw);
      return;
    }

    processingRef.current = true;
    inFlightScanRef.current = raw;

    // New run token for cancellation (reset() increments this).
    const runId = (runIdRef.current += 1);

    opts.setExternallyBusy?.(true);

    void (async () => {
      let currentRaw = raw;
      try {
        let nextRaw: string | null = raw;

        while (nextRaw) {
          if (runId !== runIdRef.current) return;
          const currentOpts = optionsRef.current;
          if (currentOpts.enabled === false) {
            queueRef.current = [];
            return;
          }
          if (currentOpts.ackGate?.isBlocked()) {
            queueRef.current = [];
            return;
          }
          if (currentOpts.isBlocked?.()) {
            queueRef.current = [];
            return;
          }

          currentRaw = nextRaw;
          const payload = parseScanPayload(nextRaw);
          if (payload) {
            const event = toEvent(nextRaw, payload);
            const allowed = currentOpts.allowedTypes;
            if (allowed && !allowed.includes(event.type)) {
              await currentOpts.onBlockedType?.(event);
              if (
                currentOpts.ackGate &&
                (currentOpts.ackOnBlockedType ?? true) &&
                !currentOpts.ackGate.isBlocked()
              ) {
                const cfg = (currentOpts.blockedTypeToast ?? ((e) => defaultBlockedTypeToast(e, allowed)))(event);
                currentOpts.ackGate.block(cfg);
              }
            } else {
              await currentOpts.onScan(event);
            }
          }

          // If a handler blocked scans (ex: persistent error toast), stop processing immediately.
          const postOpts = optionsRef.current;
          if (postOpts.ackGate?.isBlocked() || postOpts.isBlocked?.()) {
            queueRef.current = [];
            return;
          }

          // Drain the next queued scan (if any). Allow UI state to flush between scans.
          nextRaw = queueRef.current.shift() || null;
          if (nextRaw) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            inFlightScanRef.current = nextRaw;
          }
        }
      } catch (err) {
        const currentOpts = optionsRef.current;
        currentOpts.onError?.(err, currentRaw);
        if (
          currentOpts.ackGate &&
          (currentOpts.ackOnError ?? true) &&
          !currentOpts.ackGate.isBlocked()
        ) {
          const cfg = (currentOpts.errorToast ?? defaultErrorToast)(err, currentRaw);
          currentOpts.ackGate.block(cfg);
        }
      } finally {
        if (runId !== runIdRef.current) return;
        processingRef.current = false;
        inFlightScanRef.current = null;
        optionsRef.current.setExternallyBusy?.(false);
      }
    })();
  }, []);

  return { onScan, reset };
}

