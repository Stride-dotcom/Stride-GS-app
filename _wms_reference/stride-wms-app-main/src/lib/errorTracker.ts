/**
 * Global Error Tracker
 * Captures JS errors, unhandled rejections, console errors/warnings, and API failures.
 * Sends sanitized data to the log-app-issue edge function.
 */

type UserContext = {
  id?: string;
  role?: string;
  accountId?: string;
  tenantId?: string;
};

type ErrorTrackerConfig = {
  getUser: () => UserContext | null;
  getRoute: () => string;
  appVersion?: string;
};

// Client-side deduplication cache
const recentFingerprints = new Map<string, number>();
const DEDUP_INTERVAL_MS = 60000; // 1 minute

// Store original console methods
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

let config: ErrorTrackerConfig | null = null;
let isInitialized = false;

/**
 * Generate a simple hash fingerprint from error details
 */
function generateFingerprint(level: string, message: string, route: string, stack?: string): string {
  const input = `${level}|${message}|${route}|${stack?.split('\n')[0] || ''}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check if we should skip logging due to deduplication
 */
function shouldSkipDuplicate(fingerprint: string): boolean {
  const now = Date.now();
  const lastSeen = recentFingerprints.get(fingerprint);
  
  if (lastSeen && now - lastSeen < DEDUP_INTERVAL_MS) {
    return true;
  }
  
  // Clean up old entries
  for (const [fp, timestamp] of recentFingerprints.entries()) {
    if (now - timestamp > DEDUP_INTERVAL_MS * 2) {
      recentFingerprints.delete(fp);
    }
  }
  
  recentFingerprints.set(fingerprint, now);
  return false;
}

/**
 * Determine environment from hostname
 */
function getEnvironment(): 'dev' | 'prod' {
  const hostname = window.location.hostname;
  if (
    hostname === 'localhost' ||
    hostname.includes('preview') ||
    hostname.includes('lovable.app') ||
    hostname.includes('lovableproject.com')
  ) {
    return 'dev';
  }
  return 'prod';
}

/**
 * Extract component name from stack trace if possible
 */
function extractComponentFromStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  
  // Look for React component patterns in stack
  const componentMatch = stack.match(/at\s+([A-Z][a-zA-Z0-9]+)\s+\(/);
  return componentMatch ? componentMatch[1] : undefined;
}

/**
 * Sanitize request body - only keep field names, not values
 */
function sanitizeRequestBody(body: unknown): { fields?: string[] } | null {
  if (!body || typeof body !== 'object') return null;
  
  try {
    const fields = Object.keys(body as Record<string, unknown>);
    return { fields };
  } catch {
    return null;
  }
}

/**
 * Send error to the edge function (fire and forget)
 */
async function sendToServer(params: {
  level: 'error' | 'warning';
  error_message: string;
  stack_trace?: string;
  component_name?: string;
  action_context?: string;
  http_status?: number;
  supabase_error_code?: string;
  request_summary?: Record<string, unknown>;
  has_blank_screen?: boolean;
}): Promise<void> {
  if (!config) return;
  
  try {
    const route = config.getRoute();
    const fingerprint = generateFingerprint(
      params.level,
      params.error_message,
      route,
      params.stack_trace
    );
    
    // Client-side deduplication
    if (shouldSkipDuplicate(fingerprint)) {
      return;
    }
    
    const user = config.getUser();
    
    const payload = {
      environment: getEnvironment(),
      app_version: config.appVersion,
      user_id: user?.id,
      user_role: user?.role,
      account_id: user?.accountId,
      tenant_id: user?.tenantId,
      route,
      component_name: params.component_name || extractComponentFromStack(params.stack_trace),
      action_context: params.action_context,
      level: params.level,
      error_message: params.error_message,
      stack_trace: params.stack_trace,
      http_status: params.http_status,
      supabase_error_code: params.supabase_error_code,
      request_summary: params.request_summary,
      has_blank_screen: params.has_blank_screen,
      fingerprint,
    };
    
    // Fire and forget - don't await
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-app-issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silently fail - we don't want error tracking to cause errors
    });
  } catch {
    // Never throw from error tracker
  }
}

/**
 * Initialize the global error tracker
 */
export function initErrorTracker(cfg: ErrorTrackerConfig): void {
  if (isInitialized) return;
  
  config = cfg;
  isInitialized = true;
  
  // Capture uncaught exceptions
  window.onerror = (message, source, lineno, colno, error) => {
    const messageStr = String(message);
    
    // Skip known noise
    if (
      messageStr.includes('ResizeObserver loop') ||
      messageStr.includes('cdn.tailwindcss.com') ||
      messageStr.includes('Script error.')
    ) {
      return false;
    }
    
    sendToServer({
      level: 'error',
      error_message: messageStr,
      stack_trace: error?.stack || `at ${source}:${lineno}:${colno}`,
      component_name: extractComponentFromStack(error?.stack),
    });
    return false; // Don't prevent default handling
  };
  
  // Capture unhandled promise rejections
  window.onunhandledrejection = (event) => {
    const error = event.reason;
    const msg = error?.message || String(error);
    
    // Skip auth session expiry noise
    if (msg.includes('Invalid Refresh Token') || msg.includes('Refresh Token Not Found')) {
      return;
    }
    
    sendToServer({
      level: 'error',
      error_message: msg,
      stack_trace: error?.stack,
      component_name: extractComponentFromStack(error?.stack),
    });
  };
  
  // Intercept console.error
  console.error = (...args) => {
    originalConsoleError.apply(console, args);
    
    // Skip React DevTools and other internal messages
    const message = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    
    // Skip common noise and browser-specific errors
    if (
      message.includes('Warning:') ||
      message.includes('React DevTools') ||
      message.includes('Download the React DevTools') ||
      message.includes('ResizeObserver loop') ||
      message.includes('cdn.tailwindcss.com') ||
      message.includes('Invalid Refresh Token') ||
      message.includes('Refresh Token Not Found')
    ) {
      return;
    }
    
    const error = args.find(a => a instanceof Error) as Error | undefined;
    
    sendToServer({
      level: 'error',
      error_message: message.substring(0, 1000),
      stack_trace: error?.stack,
    });
  };
  
  // Intercept console.warn (for warning-level tracking)
  console.warn = (...args) => {
    originalConsoleWarn.apply(console, args);
    
    const message = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    
    // Skip React warnings, common noise, and CDN warnings
    if (
      message.includes('Warning:') ||
      message.includes('validateDOMNesting') ||
      message.includes('React does not recognize') ||
      message.includes('cdn.tailwindcss.com') ||
      message.includes('ResizeObserver loop') ||
      message.includes('DialogTitle')
    ) {
      return;
    }
    
    sendToServer({
      level: 'warning',
      error_message: message.substring(0, 1000),
    });
  };
}

/**
 * Manually track an error with context
 */
export function trackError(
  error: Error | string,
  actionContext?: string,
  componentName?: string
): void {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  
  sendToServer({
    level: 'error',
    error_message: errorObj.message,
    stack_trace: errorObj.stack,
    action_context: actionContext,
    component_name: componentName || extractComponentFromStack(errorObj.stack),
  });
}

/**
 * Manually track a warning with context
 */
export function trackWarning(
  message: string,
  actionContext?: string,
  componentName?: string
): void {
  sendToServer({
    level: 'warning',
    error_message: message,
    action_context: actionContext,
    component_name: componentName,
  });
}

/**
 * Track a Supabase error with full context
 */
export function trackSupabaseError(
  error: { message: string; code?: string; details?: string; hint?: string },
  actionContext?: string,
  requestSummary?: { method?: string; table?: string; fields?: string[] }
): void {
  sendToServer({
    level: 'error',
    error_message: error.message,
    supabase_error_code: error.code,
    action_context: actionContext,
    request_summary: requestSummary ? {
      method: requestSummary.method,
      table: requestSummary.table,
      fields: requestSummary.fields,
    } : undefined,
  });
}

/**
 * Track an API/fetch error
 */
export function trackApiError(
  url: string,
  status: number,
  errorMessage: string,
  actionContext?: string,
  requestBody?: unknown
): void {
  sendToServer({
    level: 'error',
    error_message: errorMessage,
    http_status: status,
    action_context: actionContext,
    request_summary: {
      url: new URL(url, window.location.origin).pathname,
      status,
      ...sanitizeRequestBody(requestBody),
    },
  });
}

/**
 * Track a blank screen / crash situation
 */
export function trackBlankScreen(errorMessage: string): void {
  sendToServer({
    level: 'error',
    error_message: errorMessage,
    has_blank_screen: true,
  });
}
