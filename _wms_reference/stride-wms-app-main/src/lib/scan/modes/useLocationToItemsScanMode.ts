import { useCallback, useRef, useState } from 'react';
import { useScanEngine, type ScanEngineEvent } from '@/hooks/useScanEngine';

export interface LocationToItemsScanItemCandidate {
  id: string;
  item_code: string;
}

export interface LocationToItemsScanLocationCandidate {
  id: string;
  code: string;
}

export interface LocationToItemsBlockingOverlayState {
  title: string;
  reason: string;
  code: string;
}

export interface LocationToItemsScanControls {
  block: (reason: string, code?: string) => void;
  isBlocked: () => boolean;
}

export interface UseLocationToItemsScanModeOptions<
  TItem extends LocationToItemsScanItemCandidate,
  TLocation extends LocationToItemsScanLocationCandidate,
> {
  enabled: boolean;
  processing: boolean;
  setProcessing: (busy: boolean) => void;
  isGloballyBlocked?: () => boolean;

  lookupItem: (raw: string) => Promise<TItem | null>;
  lookupLocation: (raw: string) => Promise<TLocation | null>;
  isLikelyLocationCode: (raw: string) => boolean;

  /**
   * Optional pre-item handler for container shortcuts or other custom scans.
   * Return true when handled (scan processing stops for this scan).
   */
  onBeforeItemLookup?: (
    event: ScanEngineEvent,
    controls: LocationToItemsScanControls,
  ) => void | Promise<void> | boolean | Promise<boolean>;

  /**
   * Called for location scans (explicit or location-like). Return true when handled.
   * If omitted or returns false, the mode will block with WRONG BARCODE TYPE.
   */
  onLocationScanned?: (
    location: TLocation,
    event: ScanEngineEvent,
    controls: LocationToItemsScanControls,
  ) => void | Promise<void> | boolean | Promise<boolean>;

  /**
   * Called when the scan looked like location, but lookup failed.
   * Return true when handled; otherwise default LOCATION NOT FOUND block is used.
   */
  onLocationNotFound?: (
    code: string,
    event: ScanEngineEvent,
    controls: LocationToItemsScanControls,
  ) => void | Promise<void> | boolean | Promise<boolean>;

  onItemScanned: (
    item: TItem,
    event: ScanEngineEvent,
    controls: LocationToItemsScanControls,
  ) => void | Promise<void>;

  /**
   * Called when item lookup fails. Return true when handled; otherwise default ITEM NOT FOUND block.
   */
  onItemNotFound?: (
    code: string,
    event: ScanEngineEvent,
    controls: LocationToItemsScanControls,
  ) => void | Promise<void> | boolean | Promise<boolean>;

  onBlocked?: (reason: string, code: string) => void;
  onUnexpectedError?: (error: unknown, raw: string) => void;
}

/**
 * Reusable location->items scan mode:
 * - Supports "active location / zone" workflows (e.g. stocktake by zone)
 * - Accepts item scans as primary
 * - Provides same blocking camera overlay behavior on scan failures
 */
export function useLocationToItemsScanMode<
  TItem extends LocationToItemsScanItemCandidate,
  TLocation extends LocationToItemsScanLocationCandidate,
>(options: UseLocationToItemsScanModeOptions<TItem, TLocation>) {
  const [overlay, setOverlay] = useState<LocationToItemsBlockingOverlayState | null>(null);
  const overlayRef = useRef<LocationToItemsBlockingOverlayState | null>(null);

  const showOverlay = useCallback((reason: string, code?: string) => {
    const next: LocationToItemsBlockingOverlayState = {
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
      if (overlayRef.current) return;
      const normalizedCode = (code || '').trim();
      options.onBlocked?.(reason, normalizedCode);
      showOverlay(reason, normalizedCode);
    },
    [options, showOverlay],
  );

  const controls: LocationToItemsScanControls = {
    block: blockScan,
    isBlocked: () => !!overlayRef.current || !!options.isGloballyBlocked?.(),
  };

  const engine = useScanEngine({
    enabled: options.enabled,
    isExternallyBusy: options.processing,
    setExternallyBusy: options.setProcessing,
    isBlocked: controls.isBlocked,
    onScan: async (event) => {
      const likelyLocation = event.type === 'location' || options.isLikelyLocationCode(event.raw);

      if (likelyLocation) {
        const loc = await options.lookupLocation(event.raw);
        if (loc) {
          const handled = await options.onLocationScanned?.(loc, event, controls);
          if (handled) return;
          controls.block('WRONG BARCODE TYPE', loc.code || event.code || event.raw);
          return;
        }

        const locationNotFoundHandled = await options.onLocationNotFound?.(
          (event.code || event.raw).trim(),
          event,
          controls,
        );
        if (locationNotFoundHandled) return;
        controls.block('LOCATION NOT FOUND', event.code || event.raw);
        return;
      }

      const handledBeforeLookup = await options.onBeforeItemLookup?.(event, controls);
      if (handledBeforeLookup) return;

      const item = await options.lookupItem(event.raw);
      if (!item) {
        const handled = await options.onItemNotFound?.((event.code || event.raw).trim(), event, controls);
        if (handled) return;
        controls.block('ITEM NOT FOUND', event.code || event.raw);
        return;
      }

      await options.onItemScanned(item, event, controls);
    },
    onError: (error, raw) => {
      options.onUnexpectedError?.(error, raw);
      controls.block('SCAN ERROR', (raw || '').trim());
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
    block: blockScan,
  };
}
