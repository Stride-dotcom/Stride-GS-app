import type { Page } from '@playwright/test';

export interface ErrorTracking {
  jsExceptions: Error[];
  consoleErrors: string[];
  requestFailures: string[];
  detach: () => void;
}

const CONSOLE_ALLOWLIST = [
  /ResizeObserver loop/i,
  /favicon/i,
  /React DevTools/i,
  /Download the React DevTools/i,
  /source.?map/i,
  /interest-cohort/i,
  /Permissions-Policy/i,
  /third.?party cookie/i,
  /runtime\.lastError/i,
];

function isRelevantRequest(url: string): boolean {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const appBaseUrl = process.env.APP_BASE_URL ?? '';

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    if (supabaseUrl) {
      try {
        const supabaseHostname = new URL(supabaseUrl).hostname;
        if (hostname === supabaseHostname) return true;
      } catch {
        // fallback below
      }
    }

    if (appBaseUrl) {
      try {
        const appHostname = new URL(appBaseUrl).hostname;
        if (hostname === appHostname) return true;
      } catch {
        // fallback below
      }
    }
  } catch {
    // URL parse failed — fallback to guarded includes
    if (supabaseUrl && url.includes(supabaseUrl)) return true;
    if (appBaseUrl && url.includes(appBaseUrl)) return true;
  }

  return false;
}

/** Attach error tracking listeners to a Playwright Page. */
export function attachErrorTracking(page: Page): ErrorTracking {
  const tracking: ErrorTracking = {
    jsExceptions: [],
    consoleErrors: [],
    requestFailures: [],
    detach: () => {},
  };

  const onPageError = (error: Error) => {
    tracking.jsExceptions.push(error);
  };

  const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ALLOWLIST.some((re) => re.test(text))) return;
    tracking.consoleErrors.push(text);
  };

  const onRequestFailed = (request: import('@playwright/test').Request) => {
    const resourceType = request.resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

    const method = request.method();
    if (method === 'HEAD') return;

    const failureText = request.failure()?.errorText ?? 'unknown';
    if (/net::ERR_ABORTED/i.test(failureText)) return;

    const url = request.url();
    if (!isRelevantRequest(url)) return;

    tracking.requestFailures.push(`${method} ${url} :: ${failureText}`);
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);

  tracking.detach = () => {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('requestfailed', onRequestFailed);
  };

  return tracking;
}
