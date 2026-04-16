import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToastBanner } from '@/contexts/ToastBannerContext';
import { cn } from '@/lib/utils';

const typeConfig = {
  success: {
    icon: 'check_circle',
    accent: 'bg-green-500',
  },
  info: {
    icon: 'info',
    accent: 'bg-blue-500',
  },
  warning: {
    icon: 'warning',
    accent: 'bg-amber-500',
  },
  error: {
    icon: 'error',
    accent: 'bg-red-500',
  },
  destructive: {
    icon: 'dangerous',
    accent: 'bg-red-600',
  },
} as const;

/**
 * ToastBanner — bottom "banner style" notifications.
 *
 * - Rolls up from bottom, auto-dismisses (default 3s), then rolls back down.
 * - Tap: navigates to target when provided.
 * - Mobile/tablet: swipe down to dismiss.
 * - Desktop: close button (pointer:fine).
 */
export function ToastBanner() {
  const { toast, hideToast } = useToastBanner();
  const navigate = useNavigate();

  const touchStartY = useRef<number | null>(null);
  const [touchDeltaY, setTouchDeltaY] = useState(0);

  const handleDismiss = useCallback(() => {
    hideToast();
    setTouchDeltaY(0);
    touchStartY.current = null;
  }, [hideToast]);

  const handleBannerClick = useCallback(() => {
    if (!toast) return;
    if (toast.navigateTo) {
      navigate(toast.navigateTo);
    }
    handleDismiss();
  }, [toast, navigate, handleDismiss]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY.current;
    // Only track downward swipe.
    if (deltaY > 0) {
      setTouchDeltaY(deltaY);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchDeltaY > 40) {
      handleDismiss();
    } else {
      setTouchDeltaY(0);
      touchStartY.current = null;
    }
  }, [touchDeltaY, handleDismiss]);

  if (!toast) return null;

  const config = typeConfig[toast.type] ?? typeConfig.info;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md',
        'origin-bottom',
        toast.closing ? 'animate-banner-roll-down-to-bottom' : 'animate-banner-roll-up-from-bottom',
        toast.navigateTo ? 'cursor-pointer' : 'cursor-default',
      )}
      style={{
        bottom: 'max(1rem, env(safe-area-inset-bottom))',
        transform: touchDeltaY > 0 ? `translateX(-50%) translateY(${touchDeltaY}px)` : 'translateX(-50%)',
        willChange: touchDeltaY !== 0 ? 'transform' : 'auto',
      }}
      onClick={handleBannerClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={cn(
          'backdrop-blur-xl backdrop-saturate-[180%]',
          'rounded-2xl border border-border/50 bg-card/90 shadow-lg',
          'px-4 py-3',
          'flex items-start gap-3',
        )}
      >
        {/* Accent icon */}
        <div className={cn('h-9 w-9 rounded-full flex items-center justify-center shrink-0', config.accent)}>
          <MaterialIcon name={config.icon} size="md" className="text-white" filled />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground leading-tight">
            {toast.title}
          </p>
          {toast.subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight line-clamp-2">
              {toast.subtitle}
            </p>
          )}
          {toast.navigateTo && (
            <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mt-1">
              Tap to view
            </p>
          )}
        </div>

        {/* Close button (desktop) */}
        <button
          type="button"
          aria-label="Dismiss notification"
          title="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          className={cn(
            'hidden [@media(pointer:fine)]:flex',
            'shrink-0 w-8 h-8 rounded-full',
            'bg-muted/50 hover:bg-muted/70 transition-colors',
            'items-center justify-center',
          )}
        >
          <MaterialIcon name="close" size="sm" className="text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

