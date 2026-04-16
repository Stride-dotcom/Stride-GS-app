// src/lib/toastShim.ts
//
// A compatibility shim for the legacy shadcn toast() API used across the app.
// We route those calls to our bottom "toast banner" system so all existing
// call sites keep working without changing imports.

export type ToastBannerType = 'success' | 'info' | 'warning' | 'error' | 'destructive';

export interface ShowToastBannerConfig {
  title: string;
  subtitle?: string;
  type: ToastBannerType;
  navigateTo?: string;
  durationMs?: number;
}

// This will be set by the ToastBannerProvider on mount
let _showToastBanner: ((config: ShowToastBannerConfig) => string | void) | null = null;

export function registerToastBannerFunction(fn: typeof _showToastBanner) {
  _showToastBanner = fn;
}

function showOrFallback(config: ShowToastBannerConfig): string | null {
  if (_showToastBanner) {
    const id = _showToastBanner(config);
    return typeof id === 'string' ? id : null;
  }
  return null;
}

// Handles the shadcn toast({ title, description, variant }) pattern
export function shimToast(props: {
  title?: string;
  description?: string;
  variant?: string;
  type?: ToastBannerType;
  navigateTo?: string;
  duration?: number;
  [key: string]: unknown;
}) {
  const title = (typeof props.title === 'string' ? props.title : '') || 'Notification';
  const subtitle = typeof props.description === 'string' ? props.description : undefined;

  let type: ToastBannerType = 'success';
  if (props.type && ['success', 'info', 'warning', 'error', 'destructive'].includes(props.type)) {
    type = props.type;
  }
  if (props.variant === 'destructive') {
    type = 'error';
  }

  const id =
    showOrFallback({
    title,
    subtitle,
    type,
    navigateTo: typeof props.navigateTo === 'string' ? props.navigateTo : undefined,
    durationMs: typeof props.duration === 'number' ? props.duration : undefined,
    }) ?? Date.now().toString();

  // Return a compatible shape for any code expecting { id, dismiss, update }
  return {
    id,
    dismiss: () => {},
    update: () => {},
  };
}

// Direct API for explicit type calls (sonner-compatible)
// Second param accepts string description or options object (options are ignored)
export const toast = Object.assign(
  (message: string) => showOrFallback({ type: 'info', title: message }),
  {
    success: (message: string, opts?: string | Record<string, unknown>) => {
      const subtitle = typeof opts === 'string' ? opts : undefined;
      const navigateTo = typeof opts === 'object' ? (opts as any).navigateTo : undefined;
      const durationMs = typeof opts === 'object' ? (opts as any).durationMs : undefined;
      showOrFallback({ type: 'success', title: message, subtitle, navigateTo, durationMs });
    },
    error: (message: string, opts?: string | Record<string, unknown>) => {
      const subtitle = typeof opts === 'string' ? opts : undefined;
      const navigateTo = typeof opts === 'object' ? (opts as any).navigateTo : undefined;
      const durationMs = typeof opts === 'object' ? (opts as any).durationMs : undefined;
      showOrFallback({ type: 'error', title: message, subtitle, navigateTo, durationMs });
    },
    warning: (message: string, opts?: string | Record<string, unknown>) => {
      const subtitle = typeof opts === 'string' ? opts : undefined;
      const navigateTo = typeof opts === 'object' ? (opts as any).navigateTo : undefined;
      const durationMs = typeof opts === 'object' ? (opts as any).durationMs : undefined;
      showOrFallback({ type: 'warning', title: message, subtitle, navigateTo, durationMs });
    },
    info: (message: string, opts?: string | Record<string, unknown>) => {
      const subtitle = typeof opts === 'string' ? opts : undefined;
      const navigateTo = typeof opts === 'object' ? (opts as any).navigateTo : undefined;
      const durationMs = typeof opts === 'object' ? (opts as any).durationMs : undefined;
      showOrFallback({ type: 'info', title: message, subtitle, navigateTo, durationMs });
    },
  }
);
