import { useCallback, useRef, useState } from 'react';
import { useScanEngine } from '@/hooks/useScanEngine';

export interface LookupModeItem {
  id: string;
  item_code: string;
}

export interface LookupModeLocation {
  id: string;
  code: string;
  name: string | null;
  type?: string;
}

export interface LookupModeContainer {
  id: string;
  container_code: string;
  container_type: string | null;
}

export interface UseLookupScanModeOptions {
  enabled: boolean;
  processing: boolean;
  setProcessing: (busy: boolean) => void;
  isGloballyBlocked?: () => boolean;

  lookupItem: (raw: string) => Promise<LookupModeItem | null>;
  lookupLocation: (raw: string) => Promise<LookupModeLocation | null>;
  lookupContainer?: (raw: string) => Promise<LookupModeContainer | null>;
  isLikelyLocationCode: (raw: string) => boolean;

  onFoundItem: (item: LookupModeItem) => void | Promise<void>;
  onFoundLocation: (location: LookupModeLocation) => void | Promise<void>;
  onFoundContainer?: (container: LookupModeContainer) => void | Promise<void>;
  onNotFound: (code: string) => void | Promise<void>;
  onUnexpectedError?: (error: unknown, raw: string) => void;
}

export interface LookupBlockingOverlayState {
  title: string;
  reason: string;
  code: string;
}

/**
 * Shared lookup scan mode:
 * - Accepts location, item, or container scans
 * - Resolves in the same order as the proven ScanHub lookup flow
 */
export function useLookupScanMode(options: UseLookupScanModeOptions) {
  const [overlay, setOverlay] = useState<LookupBlockingOverlayState | null>(null);
  const overlayRef = useRef<LookupBlockingOverlayState | null>(null);

  const showOverlay = useCallback((reason: string, code?: string) => {
    const next: LookupBlockingOverlayState = {
      title: 'SCAN ERROR',
      reason,
      code: (code || '').trim(),
    };
    overlayRef.current = next;
    setOverlay(next);
  }, []);

  const dismissOverlay = useCallback(() => {
    overlayRef.current = null;
    setOverlay(null);
  }, []);

  const engine = useScanEngine({
    enabled: options.enabled,
    isExternallyBusy: options.processing,
    setExternallyBusy: options.setProcessing,
    isBlocked: () => !!overlayRef.current || !!options.isGloballyBlocked?.(),
    onScan: async (event) => {
      const likelyLoc = options.isLikelyLocationCode(event.raw);

      if (likelyLoc) {
        const loc = await options.lookupLocation(event.raw);
        if (loc) {
          await options.onFoundLocation(loc);
          return;
        }
      }

      const item = await options.lookupItem(event.raw);
      if (item) {
        await options.onFoundItem(item);
        return;
      }

      if (options.lookupContainer && options.onFoundContainer) {
        const container = await options.lookupContainer(event.raw);
        if (container) {
          await options.onFoundContainer(container);
          return;
        }
      }

      if (!likelyLoc) {
        const loc = await options.lookupLocation(event.raw);
        if (loc) {
          await options.onFoundLocation(loc);
          return;
        }
      }

      const code = (event.code || event.raw).trim();
      await options.onNotFound(code);
      showOverlay(`Item, location, or container not found for "${code}".`, code);
    },
    onError: (error, raw) => {
      options.onUnexpectedError?.(error, raw);
      showOverlay('Scan error. Please retry.', (raw || '').trim());
    },
  });

  const reset = useCallback(() => {
    dismissOverlay();
    engine.reset();
  }, [dismissOverlay, engine.reset]);

  return {
    onScan: engine.onScan,
    reset,
    overlay,
    dismissOverlay,
    isOverlayBlocked: !!overlay,
  };
}

