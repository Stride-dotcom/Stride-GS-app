import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';

type BannerType = 'success' | 'info' | 'warning' | 'error' | 'destructive';

interface BannerState {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  type: BannerType;
  navigateTo?: string;
  persistent?: boolean;
  /** Auto-dismiss timeout for non-persistent banners (default 3000ms). */
  durationMs?: number;
  senderAvatar?: string;
  messagePreview?: string;
  onDismiss?: () => void;
  /** Internal: used to play roll-up animation before removal. */
  closing?: boolean;
}

interface AppleBannerContextType {
  banner: BannerState | null;
  showBanner: (config: Omit<BannerState, 'id' | 'closing'>) => void;
  hideBanner: () => void;
}

const AppleBannerContext = createContext<AppleBannerContextType | undefined>(undefined);

export function AppleBannerProvider({ children }: { children: ReactNode }) {
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [bannerQueue, setBannerQueue] = useState<BannerState[]>([]);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerRef = useRef<BannerState | null>(null);

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    bannerRef.current = banner;
  }, [banner]);

  const clearTimers = useCallback(() => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
    if (closeRef.current) {
      clearTimeout(closeRef.current);
      closeRef.current = null;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const scheduleAutoDismiss = useCallback((next: BannerState) => {
    if (next.persistent) return;
    const duration = typeof next.durationMs === 'number' ? next.durationMs : 3000;
    autoDismissRef.current = setTimeout(() => {
      // Trigger roll-up before removal
      hideBanner();
    }, duration);
  }, []); // hideBanner declared below (safe: called after init via closure in runtime)

  const hideBanner = useCallback(() => {
    const current = bannerRef.current;
    // If we're already closing, do nothing (and don't clear the close timer).
    if (current?.closing) return;

    clearTimers();
    if (!current) {
      // If there's something queued but nothing showing, display the next one.
      setBannerQueue((prev) => {
        if (prev.length > 0) {
          const [next, ...rest] = prev;
          setBanner({ ...next, closing: false });
          scheduleAutoDismiss(next);
          return rest;
        }
        return prev;
      });
      return;
    }

    // Mark as closing so the component can animate out.
    const closingBanner = { ...current, closing: true };
    bannerRef.current = closingBanner;
    setBanner(closingBanner);

    closeRef.current = setTimeout(() => {
      // Call onDismiss callback after the roll-up completes.
      if (current.onDismiss) current.onDismiss();

      // Advance the queue (if any).
      setBannerQueue((prev) => {
        if (prev.length > 0) {
          const [next, ...rest] = prev;
          setBanner({ ...next, closing: false });
          scheduleAutoDismiss(next);
          return rest;
        }
        setBanner(null);
        return prev;
      });
    }, 250);
  }, [clearTimers, scheduleAutoDismiss]);

  const showBanner = useCallback((config: Omit<BannerState, 'id' | 'closing'>) => {
    clearTimers();

    const id = Date.now().toString() + Math.random().toString(36).slice(2, 9);
    const newBanner: BannerState = { ...config, id, closing: false };

    // If a persistent banner is already showing, queue anything new.
    if (bannerRef.current?.persistent) {
      setBannerQueue(prev => [...prev, newBanner]);
      return;
    }

    // Debounce rapid calls within 100ms for non-persistent banners
    if (!config.persistent) {
      debounceRef.current = setTimeout(() => {
        setBanner(newBanner);
        scheduleAutoDismiss(newBanner);
      }, 100);
    } else {
      // Persistent banners show immediately, no auto-dismiss
      setBanner(newBanner);
    }
  }, [clearTimers]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return (
    <AppleBannerContext.Provider value={{ banner, showBanner, hideBanner }}>
      {children}
    </AppleBannerContext.Provider>
  );
}

export function useAppleBanner(): AppleBannerContextType {
  const context = useContext(AppleBannerContext);
  if (context === undefined) {
    throw new Error('useAppleBanner must be used within an AppleBannerProvider');
  }
  return context;
}
