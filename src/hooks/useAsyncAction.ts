import { useState, useCallback, useRef } from 'react';

/**
 * Phase 7A Safety Net — useAsyncAction hook
 *
 * Manages loading/error/success state for any async operation.
 * Prevents duplicate clicks (double-submit protection).
 * Provides consistent UX contract for all write operations.
 *
 * Usage:
 *   const action = useAsyncAction(async () => { await api.doSomething(); });
 *   <button onClick={action.execute} disabled={action.isLoading}>
 *     {action.isLoading ? 'Processing...' : 'Submit'}
 *   </button>
 */

export type AsyncActionState = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncActionResult<T = unknown> {
  /** Current state of the action */
  state: AsyncActionState;
  /** Whether the action is currently running */
  isLoading: boolean;
  /** Whether the action completed successfully */
  isSuccess: boolean;
  /** Whether the action failed */
  isError: boolean;
  /** Error message if the action failed */
  error: string | null;
  /** Result data from the last successful execution */
  data: T | null;
  /** Execute the action. No-op if already loading (prevents double-click) */
  execute: (...args: unknown[]) => Promise<void>;
  /** Reset state back to idle */
  reset: () => void;
}

export function useAsyncAction<T = unknown>(
  fn: (...args: unknown[]) => Promise<T>,
  options?: {
    /** Called on success with the result */
    onSuccess?: (data: T) => void;
    /** Called on error with the error message */
    onError?: (error: string) => void;
    /** Auto-reset to idle after success (ms). 0 = no auto-reset */
    successResetMs?: number;
  }
): AsyncActionResult<T> {
  const [state, setState] = useState<AsyncActionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const inFlightRef = useRef(false);

  const execute = useCallback(async (...args: unknown[]) => {
    // Prevent duplicate execution
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setState('loading');
    setError(null);

    try {
      const result = await fn(...args);
      setData(result);
      setState('success');
      options?.onSuccess?.(result);

      // Auto-reset after success if configured
      if (options?.successResetMs && options.successResetMs > 0) {
        setTimeout(() => {
          setState('idle');
          setError(null);
        }, options.successResetMs);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setState('error');
      options?.onError?.(msg);
    } finally {
      inFlightRef.current = false;
    }
  }, [fn, options]);

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
    setData(null);
    inFlightRef.current = false;
  }, []);

  return {
    state,
    isLoading: state === 'loading',
    isSuccess: state === 'success',
    isError: state === 'error',
    error,
    data,
    execute,
    reset,
  };
}
