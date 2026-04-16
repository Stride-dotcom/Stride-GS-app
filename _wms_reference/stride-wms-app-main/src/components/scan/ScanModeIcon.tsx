import { cn } from '@/lib/utils';

interface ScanModeIconProps {
  mode: 'move' | 'batch-move' | 'lookup' | 'service-event' | 'container';
  className?: string;
  size?: number;
}

export function ScanModeIcon({ mode, className, size = 48 }: ScanModeIconProps) {
  const iconSize = size;

  const gradients = {
    'move': { id: 'grad-move', from: '#3B82F6', to: '#1D4ED8' },
    'batch-move': { id: 'grad-batch', from: '#8B5CF6', to: '#6D28D9' },
    'lookup': { id: 'grad-lookup', from: '#10B981', to: '#059669' },
    'service-event': { id: 'grad-service', from: '#F59E0B', to: '#D97706' },
    'container': { id: 'grad-container', from: '#06B6D4', to: '#0891B2' },
  };

  const grad = gradients[mode];

  const renderIcon = () => {
    switch (mode) {
      case 'move':
        return (
          <g>
            <rect x="8" y="6" width="4" height="36" rx="1" fill={`url(#${grad.id})`} />
            <rect x="15" y="6" width="2" height="36" rx="0.5" fill={`url(#${grad.id})`} />
            <rect x="20" y="6" width="5" height="36" rx="1" fill={`url(#${grad.id})`} />
            <rect x="28" y="6" width="3" height="36" rx="0.5" fill={`url(#${grad.id})`} />
            <rect x="34" y="6" width="6" height="36" rx="1" fill={`url(#${grad.id})`} />
          </g>
        );

      case 'batch-move':
        return (
          <g>
            <g opacity="0.6" transform="translate(-2, 2)">
              <rect x="6" y="8" width="3" height="28" rx="0.5" fill={`url(#${grad.id})`} />
              <rect x="11" y="8" width="1.5" height="28" rx="0.5" fill={`url(#${grad.id})`} />
              <rect x="14.5" y="8" width="4" height="28" rx="0.5" fill={`url(#${grad.id})`} />
              <rect x="20.5" y="8" width="2" height="28" rx="0.5" fill={`url(#${grad.id})`} />
              <rect x="24.5" y="8" width="4.5" height="28" rx="0.5" fill={`url(#${grad.id})`} />
            </g>
            <g transform="translate(6, -2)">
              <rect x="10" y="8" width="3.5" height="30" rx="0.5" fill={`url(#${grad.id})`} />
              <rect x="15.5" y="8" width="1.5" height="30" rx="0.5" fill={`url(#${grad.id})`} />
              <rect x="19" y="8" width="4.5" height="30" rx="0.5" fill={`url(#${grad.id})`} />
              <rect x="25.5" y="8" width="2.5" height="30" rx="0.5" fill={`url(#${grad.id})`} />
              <rect x="30" y="8" width="5" height="30" rx="0.5" fill={`url(#${grad.id})`} />
            </g>
          </g>
        );

      case 'lookup':
        return (
          <g>
            <circle cx="24" cy="24" r="18" fill="none" stroke={`url(#${grad.id})`} strokeWidth="3" />
            <circle cx="24" cy="15" r="2.5" fill={`url(#${grad.id})`} />
            <rect x="21.5" y="20" width="5" height="14" rx="2" fill={`url(#${grad.id})`} />
          </g>
        );

      case 'service-event':
        return (
          <g>
            <rect x="22" y="4" width="4" height="40" rx="2" fill={`url(#${grad.id})`} />
            <path
              d="M 34 16 C 34 10, 26 8, 20 10 C 14 12, 12 16, 18 20 L 30 26 C 36 30, 34 36, 28 38 C 22 40, 14 38, 14 32"
              fill="none"
              stroke={`url(#${grad.id})`}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </g>
        );

      case 'container':
        return (
          <g>
            {/* Box outline */}
            <rect
              x="10"
              y="10"
              width="28"
              height="28"
              rx="4"
              fill="none"
              stroke={`url(#${grad.id})`}
              strokeWidth="3"
            />
            {/* Lid line */}
            <path
              d="M 10 18 H 38"
              stroke={`url(#${grad.id})`}
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* Small label */}
            <rect x="18" y="22" width="12" height="8" rx="2" fill={`url(#${grad.id})`} opacity="0.9" />
          </g>
        );
    }
  };

  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('flex-shrink-0', className)}
    >
      <defs>
        <linearGradient id={grad.id} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={grad.from} />
          <stop offset="100%" stopColor={grad.to} />
        </linearGradient>
      </defs>
      {renderIcon()}
    </svg>
  );
}
