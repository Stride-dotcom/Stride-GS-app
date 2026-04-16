import { useCallback, useEffect, useRef } from 'react';
import { useToastBannerSafe } from '@/contexts/ToastBannerContext';
import type { ToastBannerType } from '@/lib/toastShim';

export interface ScanAckToastConfig {
  title: string;
  subtitle?: string;
  type?: ToastBannerType;
  navigateTo?: string;
  /**
   * durationMs <= 0 means "persist until dismissed".
   * Defaults to 0 for scan failures.
   */
  durationMs?: number;
  /** When true, appends a "Tap to dismiss." hint to the subtitle. */
  appendTapToDismiss?: boolean;
}

export interface ScanAckGate {
  /** Whether scan processing should be blocked right now. */
  isBlocked: () => boolean;
  /**
   * Show a persistent toast and block scans until dismissed.
   * No-ops (and does not block) when ToastBannerProvider is missing.
   */
  block: (config: ScanAckToastConfig) => void;
  /**
   * Clears internal block state. If the active toast matches this gate's toast id,
   * it will be dismissed as well.
   */
  reset: () => void;
}

export interface UseScanAckGateOptions {
  enabled?: boolean;
  defaultType?: ToastBannerType;
  /** Default: true */
  appendTapToDismiss?: boolean;
  /** Default: true */
  replaceExisting?: boolean;
  /** Default: true */
  clearQueue?: boolean;
  /**
   * Safety: if our toast never becomes active, unblock after this delay.
   * Default: 1500ms.
   */
  armTimeoutMs?: number;
}

/**
 * useScanAckGate
 *
 * Shared "ack required" gating for scan failures:
 * - Shows a persistent ToastBanner (durationMs=0)
 * - Blocks further scan processing until the user dismisses the toast
 */
export function useScanAckGate(options?: UseScanAckGateOptions): ScanAckGate {
  const banner = useToastBannerSafe();

  const blockedRef = useRef(false);
  const toastIdRef = useRef<string | null>(null);
  const armedRef = useRef(false);
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bannerToastId = banner?.toast?.id ?? null;

  const clearArmTimeout = useCallback(() => {
    if (armTimeoutRef.current) {
      clearTimeout(armTimeoutRef.current);
      armTimeoutRef.current = null;
    }
  }, []);

  // When our toast disappears after being visible at least once, unlock scan processing.
  useEffect(() => {
    if (!blockedRef.current) return;
    const id = toastIdRef.current;
    if (!id) return;

    if (bannerToastId === id) {
      armedRef.current = true;
      return;
    }

    if (armedRef.current) {
      blockedRef.current = false;
      toastIdRef.current = null;
      armedRef.current = false;
      clearArmTimeout();
    }
  }, [bannerToastId, clearArmTimeout]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearArmTimeout();
    };
  }, [clearArmTimeout]);

  const isBlocked = useCallback(() => blockedRef.current, []);

  const reset = useCallback(() => {
    // If our toast is currently showing, dismiss it.
    if (banner && toastIdRef.current && banner.toast?.id === toastIdRef.current) {
      banner.hideToast();
    }

    blockedRef.current = false;
    toastIdRef.current = null;
    armedRef.current = false;
    clearArmTimeout();
  }, [banner, clearArmTimeout]);

  const block = useCallback(
    (config: ScanAckToastConfig) => {
      if (options?.enabled === false) return;
      if (blockedRef.current) return;
      if (!banner) {
        // Toast system missing; don't deadlock scan processing.
        return;
      }

      blockedRef.current = true;
      armedRef.current = false;
      clearArmTimeout();

      const type = config.type ?? options?.defaultType ?? 'error';
      const durationMs = typeof config.durationMs === 'number' ? config.durationMs : 0;

      const appendTapToDismiss = config.appendTapToDismiss ?? options?.appendTapToDismiss ?? true;
      const subtitle = appendTapToDismiss
        ? `${config.subtitle ? `${config.subtitle} ` : ''}Tap to dismiss.`
        : config.subtitle;

      const toastId = banner.showToast({
        title: config.title,
        subtitle,
        type,
        navigateTo: config.navigateTo,
        durationMs,
        replaceExisting: options?.replaceExisting ?? true,
        clearQueue: options?.clearQueue ?? true,
      });

      toastIdRef.current = toastId;

      const armTimeoutMs = options?.armTimeoutMs ?? 1500;
      if (armTimeoutMs > 0) {
        armTimeoutRef.current = setTimeout(() => {
          // If the toast never became active, unblock to avoid trapping scanning.
          if (!armedRef.current && toastIdRef.current === toastId) {
            blockedRef.current = false;
            toastIdRef.current = null;
            armedRef.current = false;
          }
        }, armTimeoutMs);
      }
    },
    [banner, clearArmTimeout, options],
  );

  return { isBlocked, block, reset };
}

