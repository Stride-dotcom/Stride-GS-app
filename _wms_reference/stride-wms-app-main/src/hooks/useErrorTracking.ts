import { useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackError, trackWarning, trackSupabaseError, trackApiError } from '@/lib/errorTracker';

/**
 * React hook for component-level error tracking
 * Provides convenient methods for tracking errors with component context
 */
export function useErrorTracking(componentName?: string) {
  const location = useLocation();
  const componentRef = useRef(componentName);
  
  /**
   * Track an error with component context
   */
  const handleError = useCallback((
    error: Error | string,
    actionContext?: string
  ) => {
    trackError(error, actionContext, componentRef.current);
  }, []);
  
  /**
   * Track a warning with component context
   */
  const handleWarning = useCallback((
    message: string,
    actionContext?: string
  ) => {
    trackWarning(message, actionContext, componentRef.current);
  }, []);
  
  /**
   * Track a Supabase error with table/operation context
   */
  const handleSupabaseError = useCallback((
    error: { message: string; code?: string; details?: string; hint?: string },
    actionContext?: string,
    table?: string,
    operation?: string
  ) => {
    trackSupabaseError(error, actionContext, {
      method: operation,
      table,
    });
  }, []);
  
  /**
   * Track an API error with request context
   */
  const handleApiError = useCallback((
    url: string,
    status: number,
    errorMessage: string,
    actionContext?: string,
    requestBody?: unknown
  ) => {
    trackApiError(url, status, errorMessage, actionContext, requestBody);
  }, []);
  
  /**
   * Wrap an async function to automatically catch and track errors
   */
  const wrapAsync = useCallback(<T extends unknown[], R>(
    fn: (...args: T) => Promise<R>,
    actionContext?: string
  ) => {
    return async (...args: T): Promise<R | undefined> => {
      try {
        return await fn(...args);
      } catch (error) {
        if (error instanceof Error) {
          handleError(error, actionContext);
        } else {
          handleError(String(error), actionContext);
        }
        throw error; // Re-throw so the caller can handle it
      }
    };
  }, [handleError]);
  
  /**
   * Wrap a Supabase query result to automatically track errors
   */
  const handleQueryResult = useCallback(<T>(
    result: { data: T | null; error: { message: string; code?: string } | null },
    actionContext?: string,
    table?: string,
    operation?: string
  ): { data: T | null; error: { message: string; code?: string } | null } => {
    if (result.error) {
      handleSupabaseError(result.error, actionContext, table, operation);
    }
    return result;
  }, [handleSupabaseError]);
  
  return {
    trackError: handleError,
    trackWarning: handleWarning,
    trackSupabaseError: handleSupabaseError,
    trackApiError: handleApiError,
    wrapAsync,
    handleQueryResult,
    componentName: componentRef.current,
    currentRoute: location.pathname,
  };
}
