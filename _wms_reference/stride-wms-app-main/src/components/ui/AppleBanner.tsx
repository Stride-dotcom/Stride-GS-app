import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppleBanner } from '@/contexts/AppleBannerContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

const typeConfig = {
  success: {
    gradient: 'linear-gradient(135deg, rgba(52, 211, 153, 0.75), rgba(16, 185, 129, 0.75))',
    gradientDark: 'linear-gradient(135deg, rgba(52, 211, 153, 0.85), rgba(16, 185, 129, 0.85))',
    persistentGradient: 'linear-gradient(135deg, rgba(52, 211, 153, 0.85), rgba(16, 185, 129, 0.85))',
    persistentGradientDark: 'linear-gradient(135deg, rgba(52, 211, 153, 0.95), rgba(16, 185, 129, 0.95))',
    icon: 'check_circle',
    borderClass: 'border-green-500/30',
  },
  info: {
    gradient: 'linear-gradient(135deg, rgba(96, 165, 250, 0.75), rgba(59, 130, 246, 0.75))',
    gradientDark: 'linear-gradient(135deg, rgba(96, 165, 250, 0.85), rgba(59, 130, 246, 0.85))',
    persistentGradient: 'linear-gradient(135deg, rgba(96, 165, 250, 0.85), rgba(59, 130, 246, 0.85))',
    persistentGradientDark: 'linear-gradient(135deg, rgba(96, 165, 250, 0.95), rgba(59, 130, 246, 0.95))',
    icon: 'info',
    borderClass: 'border-blue-500/30',
  },
  warning: {
    gradient: 'linear-gradient(135deg, rgba(251, 191, 36, 0.75), rgba(245, 158, 11, 0.75))',
    gradientDark: 'linear-gradient(135deg, rgba(251, 191, 36, 0.85), rgba(245, 158, 11, 0.85))',
    persistentGradient: 'linear-gradient(135deg, rgba(251, 191, 36, 0.85), rgba(245, 158, 11, 0.85))',
    persistentGradientDark: 'linear-gradient(135deg, rgba(251, 191, 36, 0.95), rgba(245, 158, 11, 0.95))',
    icon: 'warning',
    borderClass: 'border-amber-500/30',
  },
  error: {
    gradient: 'linear-gradient(135deg, rgba(248, 113, 113, 0.75), rgba(239, 68, 68, 0.75))',
    gradientDark: 'linear-gradient(135deg, rgba(248, 113, 113, 0.85), rgba(239, 68, 68, 0.85))',
    persistentGradient: 'linear-gradient(135deg, rgba(248, 113, 113, 0.85), rgba(239, 68, 68, 0.85))',
    persistentGradientDark: 'linear-gradient(135deg, rgba(248, 113, 113, 0.95), rgba(239, 68, 68, 0.95))',
    icon: 'error',
    borderClass: 'border-red-500/30',
  },
  destructive: {
    gradient: 'linear-gradient(135deg, rgba(220, 38, 38, 0.85), rgba(185, 28, 28, 0.85))',
    gradientDark: 'linear-gradient(135deg, rgba(220, 38, 38, 0.95), rgba(185, 28, 28, 0.95))',
    persistentGradient: 'linear-gradient(135deg, rgba(220, 38, 38, 0.95), rgba(185, 28, 28, 0.95))',
    persistentGradientDark: 'linear-gradient(135deg, rgba(220, 38, 38, 1), rgba(185, 28, 28, 1))',
    icon: 'dangerous',
    borderClass: 'border-red-700/40',
  },
} as const;

export function AppleBanner() {
  const { banner, hideBanner } = useAppleBanner();
  const navigate = useNavigate();
  const touchStartY = useRef<number | null>(null);
  const [touchDeltaY, setTouchDeltaY] = useState(0);
  const bannerRef = useRef<HTMLDivElement>(null);

  const handleDismiss = useCallback(() => {
    hideBanner();
  }, [hideBanner]);

  const handleBannerClick = useCallback(() => {
    if (banner?.navigateTo) {
      navigate(banner.navigateTo);
      hideBanner();
    }
  }, [banner, navigate, hideBanner]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY.current;
    if (deltaY < 0) {
      setTouchDeltaY(deltaY);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (Math.abs(touchDeltaY) > 40) {
      handleDismiss();
    }
    setTouchDeltaY(0);
    touchStartY.current = null;
  }, [touchDeltaY, handleDismiss]);

  if (!banner) return null;

  const config = typeConfig[banner.type];
  const isDark = document.documentElement.classList.contains('dark');
  const isPersistent = !!banner.persistent;
  const isMessageNotification = banner.type === 'info' && isPersistent;

  const backgroundGradient = isPersistent
    ? (isDark ? config.persistentGradientDark : config.persistentGradient)
    : (isDark ? config.gradientDark : config.gradient);

  // Message notification layout (persistent info banners with avatar)
  if (isMessageNotification) {
    const senderInitial = banner.title?.charAt(0)?.toUpperCase() || '?';

    return (
      <div
        ref={bannerRef}
        role="alert"
        aria-live="polite"
        className={cn(
          'group absolute top-full left-1/2 -translate-x-1/2 z-[35] max-w-md w-[calc(100%-2rem)] mt-2',
          'origin-top',
          'backdrop-blur-xl backdrop-saturate-[180%] rounded-2xl border border-white/20',
          config.borderClass,
          banner.closing ? 'animate-banner-roll-up' : 'animate-banner-roll-down',
          'animate-banner-glow',
          banner.navigateTo && 'cursor-pointer'
        )}
        style={{
          background: backgroundGradient,
          boxShadow:
            '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.05)',
          transform: touchDeltaY < 0
            ? `translateX(-50%) translateY(${touchDeltaY}px)`
            : 'translateX(-50%)',
          willChange: touchDeltaY !== 0 ? 'transform' : 'auto',
        }}
        onClick={handleBannerClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          {/* Avatar */}
          {banner.senderAvatar ? (
            <img
              src={banner.senderAvatar}
              alt=""
              className="h-9 w-9 rounded-full object-cover shrink-0"
            />
          ) : (
            <div
              className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-semibold"
              style={{ background: 'linear-gradient(135deg, #007AFF, #5856D6)' }}
            >
              {senderInitial}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-white leading-tight">
              {banner.title}
            </p>
            {(banner.messagePreview || banner.subtitle) && (
              <p className="text-xs text-white/80 mt-0.5 leading-tight line-clamp-2">
                {banner.messagePreview || banner.subtitle}
              </p>
            )}
            {banner.navigateTo && (
              <p className="text-[10px] text-white/50 uppercase tracking-wider mt-1">
                Tap to view
              </p>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDismiss();
            }}
            className="shrink-0 w-7 h-7 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
            aria-label="Dismiss notification"
            type="button"
          >
            <svg
              width={8}
              height={8}
              viewBox="0 0 6 6"
              fill="none"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="0.5" y1="0.5" x2="5.5" y2="5.5" />
              <line x1="5.5" y1="0.5" x2="0.5" y2="5.5" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Standard banner layout
  return (
    <div
      ref={bannerRef}
      role="alert"
      aria-live="polite"
      className={cn(
        'group absolute top-full left-1/2 -translate-x-1/2 z-[35] max-w-md w-[calc(100%-2rem)] mt-2',
        'origin-top',
        'backdrop-blur-xl backdrop-saturate-[180%] rounded-2xl border border-white/20',
        config.borderClass,
        banner.closing ? 'animate-banner-roll-up' : 'animate-banner-roll-down',
        isPersistent && 'animate-banner-glow',
        banner.navigateTo && 'cursor-pointer'
      )}
      style={{
        background: backgroundGradient,
        boxShadow:
          '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.05)',
        transform: touchDeltaY < 0
          ? `translateX(-50%) translateY(${touchDeltaY}px)`
          : 'translateX(-50%)',
        willChange: touchDeltaY !== 0 ? 'transform' : 'auto',
      }}
      onClick={handleBannerClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <MaterialIcon
          name={banner.icon || config.icon}
          size="md"
          className="text-white shrink-0 mt-0.5"
          filled
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-white leading-tight">
            {banner.title}
          </p>
          {banner.subtitle && (
            <p className="text-xs text-white/90 mt-0.5 leading-tight">
              {banner.subtitle}
            </p>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          className="shrink-0 w-7 h-7 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
          aria-label="Dismiss notification"
          type="button"
        >
          <svg
            width={8}
            height={8}
            viewBox="0 0 6 6"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <line x1="0.5" y1="0.5" x2="5.5" y2="5.5" />
            <line x1="5.5" y1="0.5" x2="0.5" y2="5.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
