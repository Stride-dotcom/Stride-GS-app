import { useCallback, useRef, useState } from 'react';
import { useScanEngine } from '@/hooks/useScanEngine';

export interface ItemOnlyScanCandidate {
  id: string;
  item_code: string;
}

export interface ItemOnlyBlockingOverlayState {
  title: string;
  reason: string;
  code: string;
}

export interface UseItemOnlyScanModeOptions<TItem extends ItemOnlyScanCandidate> {
  enabled: boolean;
  processing: boolean;
  setProcessing: (busy: boolean) => void;
  isGloballyBlocked?: () => boolean;

  lookupItem: (raw: string) => Promise<TItem | null>;
  isLikelyLocationCode: (raw: string) => boolean;
  lookupLocationCode?: (raw: string) => Promise<string | null>;

  isDuplicate: (item: TItem) => boolean;
  addItem: (item: TItem) => void;

  onItemAdded?: (item: TItem) => void;
  onBlocked?: (reason: string, code: string) => void;
  onUnexpectedError?: (error: unknown, raw: string) => void;
}

/**
 * Reusable item-only scanner flow mode.
 *
 * - Accepts only item scans
 * - Blocks on wrong type / not found / duplicates
 * - Exposes a camera-sized blocking overlay model for the UI
 */
export function useItemOnlyScanMode<TItem extends ItemOnlyScanCandidate>(
  options: UseItemOnlyScanModeOptions<TItem>,
) {
  const [overlay, setOverlay] = useState<ItemOnlyBlockingOverlayState | null>(null);
  const overlayRef = useRef<ItemOnlyBlockingOverlayState | null>(null);

  const showOverlay = useCallback((reason: string, code?: string) => {
    const next: ItemOnlyBlockingOverlayState = {
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
    allowedTypes: ['item', 'unknown'],
    isBlocked: () => !!overlayRef.current || !!options.isGloballyBlocked?.(),
    onBlockedType: async (event) => {
      if (event.type === 'location' || event.type === 'container' || options.isLikelyLocationCode(event.raw)) {
        const locCode = await options.lookupLocationCode?.(event.raw);
        const code = (locCode || event.code || event.raw).trim();
        options.onBlocked?.(`Expected an item barcode. Scanned location ${code}.`, code);
        showOverlay(`Expected an item barcode. Scanned location ${code}.`, code);
        return;
      }

      const code = (event.code || event.raw).trim();
      options.onBlocked?.(`Invalid scan "${code}".`, code);
      showOverlay(`Invalid scan "${code}".`, code);
    },
    onScan: async (event) => {
      if (options.isLikelyLocationCode(event.raw)) {
        const locCode = await options.lookupLocationCode?.(event.raw);
        const code = (locCode || event.code || event.raw).trim();
        options.onBlocked?.(`Expected an item barcode. Scanned location ${code}.`, code);
        showOverlay(`Expected an item barcode. Scanned location ${code}.`, code);
        return;
      }

      const item = await options.lookupItem(event.raw);
      if (!item) {
        const code = (event.code || event.raw).trim();
        options.onBlocked?.(`Item not found for "${code}".`, code);
        showOverlay(`Item not found for "${code}".`, code);
        return;
      }

      if (options.isDuplicate(item)) {
        const code = (item.item_code || event.code || event.raw).trim();
        options.onBlocked?.(`Duplicate scan: ${code} is already in the batch.`, code);
        showOverlay(`Duplicate scan: ${code} is already in the batch.`, code);
        return;
      }

      options.addItem(item);
      options.onItemAdded?.(item);
    },
    onError: (error, raw) => {
      const code = (raw || '').trim();
      options.onBlocked?.('Scan error. Please retry.', code);
      showOverlay('Scan error. Please retry.', code);
      options.onUnexpectedError?.(error, raw);
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

