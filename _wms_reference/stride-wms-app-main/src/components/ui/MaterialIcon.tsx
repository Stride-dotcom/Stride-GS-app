import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface MaterialIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  filled?: boolean;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
}

const sizeMap = {
  sm: 'text-base', // 16px
  md: 'text-xl',   // 20px
  lg: 'text-2xl',  // 24px
  xl: 'text-4xl',  // 36px
};

export const MaterialIcon = forwardRef<HTMLSpanElement, MaterialIconProps>(
  ({ name, className, size = 'md', filled = false, weight = 300, style, onClick, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'material-symbols-outlined select-none',
          sizeMap[size],
          onClick && 'cursor-pointer',
          className
        )}
        style={{
          fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
          ...style,
        }}
        onClick={onClick}
        {...props}
      >
        {name}
      </span>
    );
  }
);

MaterialIcon.displayName = 'MaterialIcon';
