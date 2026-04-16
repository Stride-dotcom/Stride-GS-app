import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface SortableCardProps {
  id: string;
  children: React.ReactNode;
}

export function SortableCard({ id, children }: SortableCardProps) {
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
      className={cn(
        'relative group backface-visibility-hidden',
        isDragging && 'z-50'
      )}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center',
          'cursor-grab active:cursor-grabbing',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          'text-muted-foreground hover:text-foreground',
          isDragging && 'opacity-100'
        )}
      >
        <MaterialIcon name="drag_indicator" size="md" />
      </div>
      
      {/* Card Content with left padding for drag handle */}
      <div className={cn(
        'pl-8 transition-shadow',
        isDragging && 'shadow-lg ring-2 ring-primary/20 rounded-lg'
      )}>
        {children}
      </div>
    </div>
  );
}
