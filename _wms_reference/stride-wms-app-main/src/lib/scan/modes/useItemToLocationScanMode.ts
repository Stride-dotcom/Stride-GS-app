import { useCallback, useRef, useState } from 'react';
import { useScanEngine } from '@/hooks/useScanEngine';

export interface ItemToLocationScanItemCandidate {
  id: string;
  item_code: string;
}

export interface ItemToLocationScanLocationCandidate {
  id: string;
  code: string;
  name: string | null;
  type?: string;
}

export interface ItemToLocationScanContainerCandidate {
  id: string;
  container_code: string;
}

export type ItemToLocationScanPhase = 'idle' | 'scanning-item' | 'scanning-location' | 'confirm';

export interface ItemToLocationBlockingOverlayState {
  title: string;
  reason: string;
  code: string;
}

export interface UseItemToLocationScanModeOptions<
  TItem extends ItemToLocationScanItemCandidate,
  TLocation extends ItemToLocationScanLocationCandidate,
  TContainer extends ItemToLocationScanContainerCandidate,
> {
  enabled: boolean;
  processing: boolean;
  setProcessing: (busy: boolean) => void;
  getPhase: () => ItemToLocationScanPhase;
  hasSelectedItem?: () => boolean;
  isGloballyBlocked?: () => boolean;

  lookupItem: (raw: string) => Promise<TItem | null>;
  lookupLocation: (raw: string) => Promise<TLocation | null>;
  lookupContainer?: (raw: string) => Promise<TContainer | null>;
  isLikelyLocationCode: (raw: string) => boolean;
  isLikelyContainerCode?: (raw: string) => boolean;

  onItemAccepted: (item: TItem) => void | Promise<void>;
  onLocationAccepted: (location: TLocation) => void | Promise<void>;
  isItemBlocked?: (item: TItem) => boolean | Promise<boolean>;
  onItemBlocked?: (item: TItem) => void | Promise<void>;
  openContainerShortcut?: (
    container: TContainer,
    phase: 'scanning-item' | 'scanning-location',
  ) => boolean | Promise<boolean>;

  onBlocked?: (reason: string, code: string) => void;
  onUnexpectedError?: (error: unknown, raw: string) => void;
}

/**
 * Reusable item -> location scan mode:
 * - Phase 1: scan item
 * - Phase 2: scan destination location
 * - Blocks camera scanning with a large overlay on invalid scans
 */
export function useItemToLocationScanMode<
  TItem extends ItemToLocationScanItemCandidate,
  TLocation extends ItemToLocationScanLocationCandidate,
  TContainer extends ItemToLocationScanContainerCandidate,
>(options: UseItemToLocationScanModeOptions<TItem, TLocation, TContainer>) {
  const [overlay, setOverlay] = useState<ItemToLocationBlockingOverlayState | null>(null);
  const overlayRef = useRef<ItemToLocationBlockingOverlayState | null>(null);

  const showOverlay = useCallback((reason: string, code?: string) => {
    const next: ItemToLocationBlockingOverlayState = {
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

  const blockScan = useCallback(
    (reason: string, code?: string) => {
      const normalizedCode = (code || '').trim();
      options.onBlocked?.(reason, normalizedCode);
      showOverlay(reason, normalizedCode);
    },
    [options, showOverlay],
  );

  const engine = useScanEngine({
    enabled: options.enabled,
    isExternallyBusy: options.processing,
    setExternallyBusy: options.setProcessing,
    isBlocked: () => !!overlayRef.current || !!options.isGloballyBlocked?.(),
    onScan: async (event) => {
      const phase = options.getPhase();
      if (phase !== 'scanning-item' && phase !== 'scanning-location') return;

      const effectivePhase =
        phase === 'scanning-item' && options.hasSelectedItem?.()
          ? 'scanning-location'
          : phase;

      const likelyContainer =
        event.type === 'container' || !!options.isLikelyContainerCode?.(event.raw);

      if (effectivePhase === 'scanning-item') {
        const likelyLocation = options.isLikelyLocationCode(event.raw);
        if (likelyLocation) {
          const loc = await options.lookupLocation(event.raw);
          if (loc) {
            const code = loc.code || event.code || event.raw;
            blockScan(`Expected an item barcode. Scanned location ${code}.`, code);
            return;
          }
        }

        if (options.lookupContainer && likelyContainer) {
          const container = await options.lookupContainer(event.raw);
          if (container) {
            const opened = (await options.openContainerShortcut?.(container, 'scanning-item')) ?? false;
            if (opened) return;

            const code = container.container_code || event.code || event.raw;
            blockScan(`Expected an item barcode. Scanned container ${code}.`, code);
            return;
          }
        }

        const item = await options.lookupItem(event.raw);
        if (item) {
          const isBlockedItem = (await options.isItemBlocked?.(item)) ?? false;
          if (isBlockedItem) {
            await options.onItemBlocked?.(item);
            return;
          }

          await options.onItemAccepted(item);
          return;
        }

        if (!likelyLocation) {
          const loc = await options.lookupLocation(event.raw);
          if (loc) {
            const code = loc.code || event.code || event.raw;
            blockScan(`Expected an item barcode. Scanned location ${code}.`, code);
            return;
          }
        }

        blockScan(`Item not found for "${event.code || event.raw}".`, event.code || event.raw);
        return;
      }

      const loc = await options.lookupLocation(event.raw);
      if (loc) {
        await options.onLocationAccepted(loc);
        return;
      }

      if (options.lookupContainer && likelyContainer) {
        const container = await options.lookupContainer(event.raw);
        if (container) {
          const opened = (await options.openContainerShortcut?.(container, 'scanning-location')) ?? false;
          if (opened) return;

          const code = container.container_code || event.code || event.raw;
          blockScan(`Expected a location barcode. Scanned container ${code}.`, code);
          return;
        }
      }

      const item = await options.lookupItem(event.raw);
      if (item) {
        const code = item.item_code || event.code || event.raw;
        blockScan(`Expected a location barcode. Scanned item ${code}.`, code);
        return;
      }

      blockScan(`Location not found for "${event.code || event.raw}".`, event.code || event.raw);
    },
    onError: (error, raw) => {
      options.onUnexpectedError?.(error, raw);
      blockScan('SCAN ERROR', raw || '');
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
