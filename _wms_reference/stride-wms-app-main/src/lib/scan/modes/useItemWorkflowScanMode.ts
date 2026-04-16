import { useCallback, useRef, useState } from 'react';
import { useScanEngine, type ScanEngineEvent } from '@/hooks/useScanEngine';

export interface ItemWorkflowBlockingOverlayState {
  title: string;
  reason: string;
  code: string;
}

export interface ItemWorkflowBlockConfig {
  reason: string;
  code?: string;
  title?: string;
}

export interface ItemWorkflowScanControls {
  block: (config: ItemWorkflowBlockConfig) => void;
}

export interface UseItemWorkflowScanModeOptions {
  enabled: boolean;
  processing: boolean;
  setProcessing: (busy: boolean) => void;
  isGloballyBlocked?: () => boolean;
  /**
   * Defaults to ['item', 'unknown'].
   */
  allowedTypes?: Array<'item' | 'unknown' | 'location' | 'container'>;
  onScan: (event: ScanEngineEvent, controls: ItemWorkflowScanControls) => void | Promise<void>;
  /**
   * Return true to signal that blocked-type handling was fully managed by caller.
   */
  onBlockedType?: (
    event: ScanEngineEvent,
    controls: ItemWorkflowScanControls,
  ) => boolean | void | Promise<boolean | void>;
  onBlocked?: (reason: string, code: string) => void;
  onUnexpectedError?: (error: unknown, raw: string) => void;
}

/**
 * Reusable "item workflow" scan mode.
 *
 * Designed for pages that primarily scan item labels but need
 * page-owned business logic while still sharing scanner runtime,
 * blocking overlay behavior, and explicit acknowledgment flow.
 */
export function useItemWorkflowScanMode(options: UseItemWorkflowScanModeOptions) {
  const [overlay, setOverlay] = useState<ItemWorkflowBlockingOverlayState | null>(null);
  const overlayRef = useRef<ItemWorkflowBlockingOverlayState | null>(null);

  const block = useCallback((config: ItemWorkflowBlockConfig) => {
    const reason = (config.reason || '').trim();
    const code = (config.code || '').trim();
    if (!reason) return;
    options.onBlocked?.(reason, code);
    const next: ItemWorkflowBlockingOverlayState = {
      title: (config.title || 'SCAN ERROR').trim(),
      reason,
      code,
    };
    overlayRef.current = next;
    setOverlay(next);
  }, [options]);

  const dismissOverlay = useCallback(() => {
    overlayRef.current = null;
    setOverlay(null);
  }, []);

  const controls: ItemWorkflowScanControls = {
    block,
  };

  const engine = useScanEngine({
    enabled: options.enabled,
    isExternallyBusy: options.processing,
    setExternallyBusy: options.setProcessing,
    allowedTypes: options.allowedTypes || ['item', 'unknown'],
    isBlocked: () => !!overlayRef.current || !!options.isGloballyBlocked?.(),
    onBlockedType: async (event) => {
      const handled = await options.onBlockedType?.(event, controls);
      if (handled) return;

      const typeLabel =
        event.type === 'location'
          ? 'LOCATION'
          : event.type === 'container'
            ? 'CONTAINER'
            : 'INVALID';
      block({
        title: 'SCAN ERROR',
        reason: `WRONG BARCODE TYPE (${typeLabel})`,
        code: (event.code || event.raw).trim(),
      });
    },
    onScan: async (event) => {
      await options.onScan(event, controls);
    },
    onError: (error, raw) => {
      options.onUnexpectedError?.(error, raw);
      block({
        title: 'SCAN ERROR',
        reason: 'FAILED TO PROCESS SCAN',
        code: (raw || '').trim(),
      });
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
    block,
  };
}

