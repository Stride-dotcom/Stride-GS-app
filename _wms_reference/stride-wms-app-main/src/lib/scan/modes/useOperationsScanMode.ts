import { useCallback, useRef, useState } from 'react';
import { useScanEngine, type ScanEngineEvent } from '@/hooks/useScanEngine';

export interface OperationsScanItemCandidate {
  id: string;
  item_code: string;
}

export interface OperationsScanLocationCandidate {
  id: string;
  code: string;
}

export interface OperationsScanContainerCandidate {
  id: string;
  container_code: string;
}

export interface OperationsBlockingOverlayState {
  title: string;
  reason: string;
  code: string;
}

export interface UseOperationsScanModeOptions<
  TItem extends OperationsScanItemCandidate,
  TLocation extends OperationsScanLocationCandidate,
  TContainer extends OperationsScanContainerCandidate,
> {
  enabled: boolean;
  processing: boolean;
  setProcessing: (busy: boolean) => void;
  isGloballyBlocked?: () => boolean;

  lookupItem: (raw: string) => Promise<TItem | null>;
  lookupLocation: (raw: string) => Promise<TLocation | null>;
  lookupContainer: (raw: string) => Promise<TContainer | null>;
  isLikelyLocationCode: (raw: string) => boolean;
  isLikelyContainerCode: (raw: string) => boolean;
  validateContainer?: (container: TContainer) => string | null;

  getActiveContainer: () => TContainer | null;
  getStagedCount: () => number;
  isDuplicateStagedItem: (item: TItem) => boolean;
  isDuplicateActiveContainerItem?: (item: TItem, container: TContainer) => boolean;

  onStageItem: (item: TItem, event: ScanEngineEvent) => void | Promise<void>;
  onPackItemToActiveContainer: (
    item: TItem,
    container: TContainer,
    event: ScanEngineEvent,
  ) => void | Promise<void>;
  onPackStagedItemsToContainer: (
    container: TContainer,
    event: ScanEngineEvent,
  ) => void | Promise<void>;
  onMoveStagedItemsToLocation: (
    location: TLocation,
    event: ScanEngineEvent,
  ) => void | Promise<void>;
  onMoveActiveContainerToLocation: (
    location: TLocation,
    container: TContainer,
    event: ScanEngineEvent,
  ) => void | Promise<void>;
  onStartContainerSession: (
    container: TContainer,
    event: ScanEngineEvent,
  ) => void | Promise<void>;
  onSwitchContainerSession?: (
    nextContainer: TContainer,
    currentContainer: TContainer,
    event: ScanEngineEvent,
  ) => void | Promise<void>;
  onBlocked?: (reason: string, code: string) => void;
  onUnexpectedError?: (error: unknown, raw: string) => void;
}

/**
 * Unified operations scan mode:
 * - Item-only staging (batch move)
 * - Container session (container-first OR items-first then container)
 * - Location scans route to either item move or container move based on active context
 */
export function useOperationsScanMode<
  TItem extends OperationsScanItemCandidate,
  TLocation extends OperationsScanLocationCandidate,
  TContainer extends OperationsScanContainerCandidate,
>(options: UseOperationsScanModeOptions<TItem, TLocation, TContainer>) {
  const [overlay, setOverlay] = useState<OperationsBlockingOverlayState | null>(null);
  const overlayRef = useRef<OperationsBlockingOverlayState | null>(null);

  const showOverlay = useCallback((reason: string, code?: string) => {
    const next: OperationsBlockingOverlayState = {
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
      const activeContainer = options.getActiveContainer();
      const stagedCount = options.getStagedCount();
      const likelyContainer = event.type === 'container' || options.isLikelyContainerCode(event.raw);
      const likelyLocation = event.type === 'location' || options.isLikelyLocationCode(event.raw);

      if (activeContainer) {
        if (likelyLocation) {
          const loc = await options.lookupLocation(event.raw);
          if (loc) {
            await options.onMoveActiveContainerToLocation(loc, activeContainer, event);
            return;
          }
          const scannedCode = event.code || event.raw;
          blockScan(`Location "${scannedCode}" not found. Scan a valid destination location label.`, scannedCode);
          return;
        }

        if (likelyContainer) {
          const nextContainer = await options.lookupContainer(event.raw);
          if (!nextContainer) {
            const scannedCode = event.code || event.raw;
            blockScan(`Container "${scannedCode}" not found. Scan a valid container label.`, scannedCode);
            return;
          }

          const invalidReason = options.validateContainer?.(nextContainer);
          if (invalidReason) {
            blockScan(invalidReason, nextContainer.container_code || event.code || event.raw);
            return;
          }

          if (nextContainer.id === activeContainer.id) {
            const code = nextContainer.container_code || event.code || event.raw;
            blockScan(`Container ${code} is already the active container session.`, code);
            return;
          }

          if (options.onSwitchContainerSession) {
            await options.onSwitchContainerSession(nextContainer, activeContainer, event);
          } else {
            await options.onStartContainerSession(nextContainer, event);
          }
          return;
        }

        const item = await options.lookupItem(event.raw);
        if (item) {
          if (options.isDuplicateActiveContainerItem?.(item, activeContainer)) {
            const code = item.item_code || event.code || event.raw;
            blockScan(`${code} is already packed in active container ${activeContainer.container_code}.`, code);
            return;
          }
          await options.onPackItemToActiveContainer(item, activeContainer, event);
          return;
        }

        // Fallback if a location code didn't match quick heuristics.
        const fallbackLoc = !likelyLocation ? await options.lookupLocation(event.raw) : null;
        if (fallbackLoc) {
          await options.onMoveActiveContainerToLocation(fallbackLoc, activeContainer, event);
          return;
        }

        const scannedCode = event.code || event.raw;
        blockScan(`No item or location found for "${scannedCode}".`, scannedCode);
        return;
      }

      // No active container session.
      if (likelyContainer) {
        const container = await options.lookupContainer(event.raw);
        if (!container) {
          const scannedCode = event.code || event.raw;
          blockScan(`Container "${scannedCode}" not found. Scan a valid container label.`, scannedCode);
          return;
        }

        const invalidReason = options.validateContainer?.(container);
        if (invalidReason) {
          blockScan(invalidReason, container.container_code || event.code || event.raw);
          return;
        }

        if (stagedCount > 0) {
          await options.onPackStagedItemsToContainer(container, event);
          return;
        }

        await options.onStartContainerSession(container, event);
        return;
      }

      if (likelyLocation) {
        const loc = await options.lookupLocation(event.raw);
        if (!loc) {
          const scannedCode = event.code || event.raw;
          blockScan(`Location "${scannedCode}" not found. Scan a valid destination location label.`, scannedCode);
          return;
        }

        if (stagedCount > 0) {
          await options.onMoveStagedItemsToLocation(loc, event);
          return;
        }

        const code = loc.code || event.code || event.raw;
        blockScan(
          `Scan one or more item labels or a container label before scanning destination ${code}.`,
          code,
        );
        return;
      }

      const item = await options.lookupItem(event.raw);
      if (item) {
        if (options.isDuplicateStagedItem(item)) {
          const code = item.item_code || event.code || event.raw;
          blockScan(`${code} is already staged for this batch.`, code);
          return;
        }
        await options.onStageItem(item, event);
        return;
      }

      // Fallback if quick location detection missed.
      const fallbackLoc = await options.lookupLocation(event.raw);
      if (fallbackLoc) {
        if (stagedCount > 0) {
          await options.onMoveStagedItemsToLocation(fallbackLoc, event);
          return;
        }
        const code = fallbackLoc.code || event.code || event.raw;
        blockScan(
          `Scan one or more item labels or a container label before scanning destination ${code}.`,
          code,
        );
        return;
      }

      const scannedCode = event.code || event.raw;
      blockScan(`Item "${scannedCode}" not found. Scan a valid item barcode.`, scannedCode);
    },
    onError: (error, raw) => {
      options.onUnexpectedError?.(error, raw);
      blockScan(`Scanner error while processing "${raw || 'unknown code'}". Try again.`, raw || '');
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
