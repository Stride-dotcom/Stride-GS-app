import { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

export function SortableDashboardTile({
  id,
  children,
  className,
  handleAriaLabel = 'Drag to reorder',
}: {
  id: string;
  children: ReactNode;
  className?: string;
  handleAriaLabel?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    willChange: isDragging ? 'transform' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('relative', isDragging && 'z-50', className)}
      data-dashboard-card={id}
    >
      <button
        type="button"
        aria-label={handleAriaLabel}
        title={handleAriaLabel}
        {...attributes}
        {...listeners}
        className={cn(
          'absolute left-1/2 -translate-x-1/2 top-1 z-20 inline-flex h-8 w-8 items-center justify-center rounded-md',
          'cursor-grab active:cursor-grabbing touch-none',
          'text-muted-foreground hover:text-foreground',
          // Always visible on mobile; subtle on desktop.
          'opacity-70 hover:opacity-100'
        )}
        onClick={(e) => {
          // Prevent drag handle click from activating underlying card actions.
          e.stopPropagation();
        }}
      >
        <MaterialIcon name="drag_indicator" size="sm" />
      </button>

      <div className={cn(isDragging && 'ring-2 ring-primary/20 rounded-lg')}>
        {children}
      </div>
    </div>
  );
}

