import { cn } from '@/lib/utils';
import { MaterialIcon } from './MaterialIcon';

export interface AppCardProps {
  /** Material Symbols icon name */
  icon: string;
  /** Label text */
  label: string;
  /** Background color/gradient class */
  colorClass?: string;
  /** Whether the card is currently active/selected */
  isActive?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional className */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

// Predefined Apple-style gradient colors for app icons
export const APP_CARD_COLORS = {
  blue: 'bg-gradient-to-br from-blue-400 to-blue-600',
  green: 'bg-gradient-to-br from-green-400 to-green-600',
  orange: 'bg-gradient-to-br from-orange-400 to-orange-600',
  purple: 'bg-gradient-to-br from-purple-400 to-purple-600',
  pink: 'bg-gradient-to-br from-pink-400 to-pink-600',
  red: 'bg-gradient-to-br from-red-400 to-red-600',
  yellow: 'bg-gradient-to-br from-yellow-400 to-yellow-500',
  teal: 'bg-gradient-to-br from-teal-400 to-teal-600',
  indigo: 'bg-gradient-to-br from-indigo-400 to-indigo-600',
  cyan: 'bg-gradient-to-br from-cyan-400 to-cyan-600',
  slate: 'bg-gradient-to-br from-slate-500 to-slate-700',
  amber: 'bg-gradient-to-br from-amber-400 to-amber-600',
} as const;

const sizeConfig = {
  sm: {
    container: 'w-8 h-8 rounded-lg',
    icon: 'sm' as const,
  },
  md: {
    container: 'w-10 h-10 rounded-xl',
    icon: 'md' as const,
  },
  lg: {
    container: 'w-14 h-14 rounded-2xl',
    icon: 'lg' as const,
  },
};

/**
 * Apple-style App Card with Material icon
 * Creates a rounded square (squircle) card with gradient background and centered icon
 */
export function AppCard({
  icon,
  label,
  colorClass = APP_CARD_COLORS.blue,
  isActive = false,
  size = 'md',
  className,
  onClick,
}: AppCardProps) {
  const config = sizeConfig[size];

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1.5 cursor-pointer group',
        className
      )}
      onClick={onClick}
      title={label}
    >
      {/* Icon container - Apple squircle style */}
      <div
        className={cn(
          config.container,
          colorClass,
          'flex items-center justify-center',
          'shadow-lg shadow-black/20',
          'ring-1 ring-white/20 ring-inset',
          'transition-all duration-200',
          'group-hover:scale-105 group-hover:shadow-xl',
          isActive && 'ring-2 ring-white ring-offset-2 ring-offset-background'
        )}
      >
        <MaterialIcon
          name={icon}
          size={config.icon}
          className="text-white drop-shadow-sm"
          weight={300}
        />
      </div>
    </div>
  );
}

/**
 * App Card specifically for navigation items
 * Includes hover states and active styling appropriate for nav
 */
export function NavAppCard({
  icon,
  colorClass = APP_CARD_COLORS.blue,
  isActive = false,
  collapsed = false,
}: {
  icon: string;
  colorClass?: string;
  isActive?: boolean;
  collapsed?: boolean;
}) {
  return (
    <div
      className={cn(
        'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
        colorClass,
        'shadow-md shadow-black/15',
        'ring-1 ring-white/20 ring-inset',
        'transition-all duration-200',
        isActive && 'shadow-lg scale-105'
      )}
    >
      <MaterialIcon
        name={icon}
        size="sm"
        className="text-white drop-shadow-sm"
        weight={300}
      />
    </div>
  );
}

export default AppCard;
