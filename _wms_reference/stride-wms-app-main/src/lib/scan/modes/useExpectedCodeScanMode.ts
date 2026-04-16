import { useCallback, useMemo } from 'react';
import { useScanEngine } from '@/hooks/useScanEngine';

export interface UseExpectedCodeScanModeOptions {
  enabled: boolean;
  expectedCodes: string[];
  scannedCodes?: Set<string> | string[];
  processing?: boolean;
  setProcessing?: (busy: boolean) => void;
  isBlocked?: () => boolean;
  normalize?: (value: string) => string;
  onMatched: (code: string, normalizedCode: string) => void | Promise<void>;
  onUnknown?: (code: string, normalizedCode: string) => void | Promise<void>;
  onDuplicate?: (code: string, normalizedCode: string) => void | Promise<void>;
  onUnexpectedError?: (error: unknown, raw: string) => void;
}

/**
 * Standalone expected-code scanner mode used by manual or camera scanners.
 * Useful for "scan this exact label/code" flows (e.g. split-task verification).
 */
export function useExpectedCodeScanMode(options: UseExpectedCodeScanModeOptions) {
  const normalize = options.normalize ?? ((v: string) => (v || '').trim().toLowerCase());

  const expectedMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const code of options.expectedCodes) {
      const normalized = normalize(code);
      if (!normalized) continue;
      if (!map.has(normalized)) {
        map.set(normalized, code);
      }
    }
    return map;
  }, [normalize, options.expectedCodes]);

  const scannedSet = useMemo(() => {
    const raw = options.scannedCodes;
    if (!raw) return new Set<string>();
    const arr = raw instanceof Set ? Array.from(raw) : raw;
    return new Set(arr.map((v) => normalize(String(v))).filter(Boolean));
  }, [normalize, options.scannedCodes]);

  const scanEngine = useScanEngine({
    enabled: options.enabled,
    isExternallyBusy: options.processing,
    setExternallyBusy: options.setProcessing,
    isBlocked: options.isBlocked,
    onScan: async (event) => {
      const rawCode = (event.code || event.raw || '').trim();
      const normalized = normalize(rawCode);
      if (!normalized) return;

      const canonical = expectedMap.get(normalized);
      if (!canonical) {
        await options.onUnknown?.(rawCode, normalized);
        return;
      }

      if (scannedSet.has(normalized)) {
        await options.onDuplicate?.(canonical, normalized);
        return;
      }

      await options.onMatched(canonical, normalized);
    },
    onError: (error, raw) => {
      options.onUnexpectedError?.(error, raw);
    },
  });

  const reset = useCallback(() => {
    scanEngine.reset();
  }, [scanEngine.reset]);

  return {
    onScan: scanEngine.onScan,
    reset,
  };
}
