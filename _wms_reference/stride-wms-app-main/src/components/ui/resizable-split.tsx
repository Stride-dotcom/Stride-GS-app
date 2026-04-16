import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ResizableSplitProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftPercent?: number;
  minLeftPercent?: number;
  maxLeftPercent?: number;
  className?: string;
}

/**
 * A horizontally resizable two-pane layout with a draggable divider.
 * Used for side-by-side editor + live preview on desktop.
 */
export function ResizableSplit({
  left,
  right,
  defaultLeftPercent = 50,
  minLeftPercent = 30,
  maxLeftPercent = 70,
  className,
}: ResizableSplitProps) {
  const [leftPercent, setLeftPercent] = useState(defaultLeftPercent);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleMove = useCallback(
    (clientX: number) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((clientX - rect.left) / rect.width) * 100;
      setLeftPercent(Math.max(minLeftPercent, Math.min(maxLeftPercent, percent)));
    },
    [minLeftPercent, maxLeftPercent]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) handleMove(e.touches[0].clientX);
    };
    const handleEnd = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [handleMove]);

  return (
    <div ref={containerRef} className={cn('flex h-full overflow-hidden', className)}>
      {/* Left Pane */}
      <div className="overflow-y-auto" style={{ width: `${leftPercent}%` }}>
        {left}
      </div>

      {/* Drag Handle */}
      <div
        className="relative flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-primary/20 active:bg-primary/30 transition-colors"
        onMouseDown={handleMouseDown}
        onTouchStart={(e) => {
          isDragging.current = true;
          if (e.touches.length > 0) handleMove(e.touches[0].clientX);
        }}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-border group-hover:bg-primary/40 transition-colors" />
        {/* Visible grip indicator in center */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-8 flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
          <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
          <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
        </div>
      </div>

      {/* Right Pane */}
      <div className="overflow-y-auto flex-1">
        {right}
      </div>
    </div>
  );
}
