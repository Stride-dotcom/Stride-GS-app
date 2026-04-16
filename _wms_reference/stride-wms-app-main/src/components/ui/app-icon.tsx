import { useEffect, useState } from 'react';
import { ICON_IMAGES_LIGHT, ICON_IMAGES_DARK, IconName } from '@/lib/icon-assets';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';

export interface AppIconProps {
  /**
   * The name of the icon to display
   */
  name: IconName;
  /**
   * Size of the icon in pixels (default: 24)
   */
  size?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Alt text for accessibility (defaults to icon name)
   */
  alt?: string;
  /**
   * Optional click handler
   */
  onClick?: () => void;
  /**
   * Force a specific theme (overrides automatic detection)
   */
  theme?: 'light' | 'dark';
}

/**
 * AppIcon - Renders Apple-style app icons with automatic light/dark mode support
 *
 * Usage:
 * ```tsx
 * <AppIcon name="tasks" size={32} />
 * <AppIcon name="scan" className="opacity-80" />
 * <AppIcon name="damagedPackage" size={48} alt="Damaged package indicator" />
 * <AppIcon name="checklist" theme="dark" /> // Force dark mode
 * ```
 */
export function AppIcon({
  name,
  size = 24,
  className,
  alt,
  onClick,
  theme: forcedTheme,
}: AppIconProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Wait for client-side hydration to avoid mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Determine active theme
  const activeTheme = forcedTheme ?? (mounted ? (resolvedTheme === 'dark' ? 'dark' : 'light') : 'light');

  const iconSet = activeTheme === 'dark' ? ICON_IMAGES_DARK : ICON_IMAGES_LIGHT;
  const src = iconSet[name];

  if (!src) {
    console.warn(`[AppIcon] Unknown icon name: ${name}`);
    return null;
  }

  return (
    <img
      src={src}
      alt={alt || name}
      width={size}
      height={size}
      className={cn('inline-block flex-shrink-0', className)}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    />
  );
}

/**
 * Preload icons to prevent flashing
 * Call this early in app initialization if needed
 */
export function preloadAppIcons(): void {
  Object.values(ICON_IMAGES_LIGHT).forEach((src) => {
    const img = new Image();
    img.src = src;
  });
  Object.values(ICON_IMAGES_DARK).forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

export default AppIcon;
